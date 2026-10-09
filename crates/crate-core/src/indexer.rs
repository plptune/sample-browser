//! Indexeur : un thread dédié, avec sa propre connexion, qui enchaîne les scans demandés et ceux déclenchés
//! par `notify` (1 s après le dernier changement dans une source). L'UI n'attend jamais un scan.

use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use notify::{RecursiveMode, Watcher};

use crate::db;
use crate::model::ScanStatus;
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
                // Pics de waveform encore à calculer : par lots, entre deux messages, quand rien d'autre n'attend.
                let mut peaks_pending = true;
                loop {
                    let wait = if peaks_pending {
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
                    }
                    if peaks_pending && due.is_empty() {
                        peaks_pending = match peaks_batch(&conn) {
                            Ok(n) => n > 0,
                            Err(e) => {
                                eprintln!("[crate] pics : {e}");
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
