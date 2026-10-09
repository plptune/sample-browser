//! Indexeur : un thread dédié, avec sa propre connexion, qui enchaîne les scans demandés et ceux déclenchés
//! par `notify` (1 s après le dernier changement dans une source). L'UI n'attend jamais un scan.
//!
//! Quand il n'a rien de plus urgent, il calcule par petits lots, dans cet ordre : les pics de waveform, puis
//! l'analyse (tempo, tonalité, boucle / one-shot) sur deux threads seulement, pour laisser la machine au DAW.
//! Tout est repris au lancement suivant : la base garde ce qui reste à faire (`peaks IS NULL`,
//! `analyzed_at IS NULL`).

use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use notify::{RecursiveMode, Watcher};

use crate::analysis;
use crate::db;
use crate::model::{AnalysisStatus, SampleKind, ScanStatus};
use crate::scan;

/// Reçoit la progression des scans (événement Tauri dans l'app).
pub type StatusSink = Arc<dyn Fn(ScanStatus) + Send + Sync>;

/// Drapeaux partagés avec la bibliothèque : la base a changé, le catalogue doit être rechargé.
#[derive(Default)]
pub struct Changes {
    /// Un lot a été écrit (rechargement au plus une fois par seconde).
    pub dirty: AtomicBool,
    /// Un scan vient de finir (rechargement immédiat).
    pub urgent: AtomicBool,
    /// Résultats d'analyse pas encore appliqués au catalogue (sans rechargement).
    pub analyzed: Mutex<Vec<AnalysisUpdate>>,
    analysis_done: AtomicU32,
    analysis_total: AtomicU32,
}

impl Changes {
    pub fn analysis_status(&self) -> AnalysisStatus {
        AnalysisStatus {
            done: self.analysis_done.load(Ordering::Relaxed),
            total: self.analysis_total.load(Ordering::Relaxed),
        }
    }
}

/// Résultat d'analyse d'un fichier, à reporter dans le catalogue.
#[derive(Debug, Clone, PartialEq)]
pub struct AnalysisUpdate {
    pub id: u32,
    pub bpm: Option<f64>,
    pub key: Option<String>,
    pub kind: SampleKind,
}

enum Msg {
    Scan(u32),
    Watch(u32, PathBuf),
    Unwatch(u32),
    Fs(Vec<PathBuf>),
    Stop,
}

const QUIET: Duration = Duration::from_secs(1);

pub struct Indexer {
    tx: Sender<Msg>,
    thread: Option<JoinHandle<()>>,
}

/// Calcule les pics d'un lot de fichiers qui n'en ont pas (en parallèle). Renvoie le nombre traité.
/// Un fichier illisible reçoit des pics vides (pas de nouvel essai avant qu'il change).
pub fn peaks_batch(conn: &rusqlite::Connection) -> rusqlite::Result<usize> {
    use rayon::prelude::*;
    let todo: Vec<(u32, String)> = conn
        .prepare("SELECT id, path FROM files WHERE peaks IS NULL AND missing = 0 LIMIT 64")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    let done: Vec<(u32, Vec<u8>)> = todo
        .par_iter()
        .map(|(id, path)| (*id, crate::audio::compute_peaks(std::path::Path::new(path)).unwrap_or_default()))
        .collect();
    let tx = conn.unchecked_transaction()?;
    for (id, p) in &done {
        tx.execute("UPDATE files SET peaks = ?1 WHERE id = ?2", rusqlite::params![p, id])?;
    }
    tx.commit()?;
    Ok(done.len())
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Fichiers qui attendent l'analyse.
pub fn analysis_todo(conn: &rusqlite::Connection) -> rusqlite::Result<u32> {
    conn.query_row("SELECT COUNT(*) FROM files WHERE analyzed_at IS NULL AND missing = 0", [], |r| {
        r.get(0)
    })
}

/// Une nouvelle version de l'analyse refait tout (les anciens résultats restent affichés en attendant).
pub fn check_analysis_version(conn: &rusqlite::Connection) -> rusqlite::Result<()> {
    let have: Option<String> = conn
        .query_row("SELECT value FROM settings WHERE key = 'analysis_version'", [], |r| r.get(0))
        .ok();
    let want = analysis::VERSION.to_string();
    if have.as_deref() != Some(want.as_str()) {
        conn.execute("UPDATE files SET analyzed_at = NULL", [])?;
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('analysis_version', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [want],
        )?;
    }
    Ok(())
}

/// Analyse un lot de fichiers (en parallèle sur `pool`) et écrit les résultats. Un fichier illisible est marqué
/// analysé sans résultat (pas de nouvel essai avant qu'il change). Renvoie (fichiers traités, résultats).
pub fn analysis_batch(conn: &rusqlite::Connection, pool: &rayon::ThreadPool) -> rusqlite::Result<(usize, Vec<AnalysisUpdate>)> {
    use rayon::prelude::*;
    let todo: Vec<(u32, String)> = conn
        .prepare("SELECT id, path FROM files WHERE analyzed_at IS NULL AND missing = 0 ORDER BY id LIMIT 16")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    let done: Vec<(u32, Option<analysis::Analysis>)> = pool.install(|| {
        todo.par_iter()
            .map(|(id, path)| (*id, analysis::analyze(Path::new(path))))
            .collect()
    });
    let tx = conn.unchecked_transaction()?;
    let now = now_ms();
    let mut updates = Vec::new();
    for (id, a) in done.iter() {
        match a {
            Some(a) => {
                let kind = match a.kind {
                    SampleKind::Loop => "loop",
                    SampleKind::Oneshot => "oneshot",
                };
                tx.execute(
                    "UPDATE files SET bpm = ?2, musical_key = ?3, kind = ?4, analyzed_at = ?5 WHERE id = ?1",
                    rusqlite::params![id, a.bpm, a.key, kind, now],
                )?;
                updates.push(AnalysisUpdate {
                    id: *id,
                    bpm: a.bpm,
                    key: a.key.clone(),
                    kind: a.kind,
                });
            }
            None => {
                tx.execute("UPDATE files SET analyzed_at = ?2 WHERE id = ?1", rusqlite::params![id, now])?;
            }
        }
    }
    tx.commit()?;
    Ok((done.len(), updates))
}

impl Indexer {
    pub fn start(db_path: PathBuf, sink: StatusSink, changes: Arc<Changes>) -> Self {
        let (tx, rx) = channel::<Msg>();
        let fs_tx = tx.clone();
        let thread = std::thread::Builder::new()
            .name("crate-indexer".into())
            .spawn(move || {
                let mut conn = match db::open(&db_path) {
                    Ok(c) => c,
                    Err(e) => {
                        eprintln!("[crate] indexeur : base inaccessible ({e})");
                        return;
                    }
                };
                let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
                    if let Ok(ev) = res {
                        if !ev.kind.is_access() {
                            let _ = fs_tx.send(Msg::Fs(ev.paths));
                        }
                    }
                })
                .ok();
                let mut roots: HashMap<u32, PathBuf> = HashMap::new();
                let mut due: HashMap<u32, Instant> = HashMap::new();
                let mut queue: VecDeque<u32> = VecDeque::new();
                // Pics de waveform puis analyse encore à faire : par lots, entre deux messages, quand rien d'autre
                // n'attend.
                let mut peaks_pending = true;
                if let Err(e) = check_analysis_version(&conn) {
                    eprintln!("[crate] analyse : {e}");
                }
                let mut analysis_pending = true;
                let restart_count = |conn: &rusqlite::Connection| {
                    let n = analysis_todo(conn).unwrap_or(0);
                    let done = changes.analysis_done.load(Ordering::Relaxed);
                    let total = changes.analysis_total.load(Ordering::Relaxed);
                    // Rien en cours : on repart de zéro ; sinon le nouveau reste s'ajoute à ce qui est fait.
                    let base = if done >= total { 0 } else { done };
                    changes.analysis_done.store(base, Ordering::Relaxed);
                    changes.analysis_total.store(base + n, Ordering::Relaxed);
                };
                restart_count(&conn);
                let pool = rayon::ThreadPoolBuilder::new()
                    .num_threads(2)
                    .thread_name(|i| format!("crate-analyse-{i}"))
                    .build()
                    .expect("threads d'analyse");
                loop {
                    // Travail de fond en attente : on y retourne tout de suite, sauf si un rescan est programmé
                    // (le travail de fond attend alors le scan : on dort jusqu'à lui, sans tourner à vide).
                    let wait = if (peaks_pending || analysis_pending) && due.is_empty() {
                        Duration::ZERO
                    } else {
                        due.values()
                            .min()
                            .map(|t| t.saturating_duration_since(Instant::now()))
                            .unwrap_or(Duration::from_secs(3600))
                    };
                    match rx.recv_timeout(wait) {
                        Ok(Msg::Scan(id)) => {
                            due.remove(&id);
                            if !queue.contains(&id) {
                                queue.push_back(id);
                            }
                        }
                        Ok(Msg::Watch(id, path)) => {
                            if let Some(w) = watcher.as_mut() {
                                let _ = w.watch(&path, RecursiveMode::Recursive);
                            }
                            roots.insert(id, path);
                        }
                        Ok(Msg::Unwatch(id)) => {
                            if let (Some(w), Some(path)) = (watcher.as_mut(), roots.remove(&id)) {
                                let _ = w.unwatch(&path);
                            }
                            due.remove(&id);
                            queue.retain(|&x| x != id);
                        }
                        Ok(Msg::Fs(paths)) => {
                            for p in paths {
                                if let Some((&id, _)) = roots.iter().find(|(_, r)| p.starts_with(r)) {
                                    due.insert(id, Instant::now() + QUIET);
                                }
                            }
                        }
                        Ok(Msg::Stop) | Err(RecvTimeoutError::Disconnected) => break,
                        Err(RecvTimeoutError::Timeout) => {}
                    }
                    let now = Instant::now();
                    let ready: Vec<u32> = due.iter().filter(|(_, t)| **t <= now).map(|(id, _)| *id).collect();
                    for id in ready {
                        due.remove(&id);
                        if !queue.contains(&id) {
                            queue.push_back(id);
                        }
                    }
                    while let Some(id) = queue.pop_front() {
                        let mut on_status = |s: ScanStatus| sink(s);
                        let mut on_batch = || changes.dirty.store(true, Ordering::Release);
                        match scan::scan_source(&mut conn, id, &mut on_status, &mut on_batch) {
                            Ok(r) => {
                                if std::env::var_os("CRATE_TRACE").is_some() {
                                    eprintln!("[crate] scan {id} : {r:?}");
                                }
                            }
                            Err(e) => eprintln!("[crate] scan {id} : {e}"),
                        }
                        changes.urgent.store(true, Ordering::Release);
                        peaks_pending = true;
                        analysis_pending = true;
                        restart_count(&conn);
                    }
                    if peaks_pending && due.is_empty() {
                        peaks_pending = match peaks_batch(&conn) {
                            Ok(n) => n > 0,
                            Err(e) => {
                                eprintln!("[crate] pics : {e}");
                                false
                            }
                        };
                    } else if analysis_pending && due.is_empty() {
                        analysis_pending = match analysis_batch(&conn, &pool) {
                            Ok((0, _)) => {
                                let total = changes.analysis_total.load(Ordering::Relaxed);
                                changes.analysis_done.store(total, Ordering::Relaxed);
                                false
                            }
                            Ok((n, updates)) => {
                                changes.analysis_done.fetch_add(n as u32, Ordering::Relaxed);
                                changes.analyzed.lock().unwrap_or_else(|e| e.into_inner()).extend(updates);
                                true
                            }
                            Err(e) => {
                                eprintln!("[crate] analyse : {e}");
                                false
                            }
                        };
                    }
                }
            })
            .expect("thread de l'indexeur");
        Indexer { tx, thread: Some(thread) }
    }

    pub fn scan(&self, source_id: u32) {
        let _ = self.tx.send(Msg::Scan(source_id));
    }

    pub fn watch(&self, source_id: u32, path: &Path) {
        let _ = self.tx.send(Msg::Watch(source_id, path.to_path_buf()));
    }

    pub fn unwatch(&self, source_id: u32) {
        let _ = self.tx.send(Msg::Unwatch(source_id));
    }
}

impl Drop for Indexer {
    /// N'attend pas un scan en cours (quitter l'app reste instantané) : WAL garde la base cohérente,
    /// le prochain scan incrémental reprend où celui-ci s'est arrêté.
    fn drop(&mut self) {
        let _ = self.tx.send(Msg::Stop);
        drop(self.thread.take());
    }
}
