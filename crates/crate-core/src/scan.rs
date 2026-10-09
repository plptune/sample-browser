//! Scan d'une source : parcours des dossiers, lecture rapide des en-têtes audio, mise à jour incrémentale
//! de la base. Ne lit jamais l'audio lui-même et n'écrit jamais dans les dossiers de l'utilisateur.

use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::path::{Path, PathBuf};
use std::time::{Instant, UNIX_EPOCH};

use rayon::prelude::*;
use rusqlite::{params, Connection, OptionalExtension};
use symphonia::core::codecs::CodecParameters;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, TrackType};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;

use crate::model::ScanStatus;

/// Extensions indexées (en minuscules).
pub const AUDIO_EXTENSIONS: &[&str] = &["wav", "wave", "aif", "aiff", "aifc", "flac", "mp3", "ogg"];

/// Fichiers lus par lot : un lot = une transaction et un palier visible dans l'arbre.
const BATCH: usize = 1000;

pub fn is_audio(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| AUDIO_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
}

/// Métadonnées lues dans l'en-tête.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Meta {
    pub duration_ms: u32,
    pub sample_rate: u32,
    /// 0 si sans objet (formats compressés).
    pub bit_depth: u32,
    pub channels: u32,
}

/// Lit l'en-tête d'un fichier audio. `None` si le fichier est illisible ou n'est pas de l'audio.
pub fn probe(path: &Path) -> Option<Meta> {
    let file = File::open(path).ok()?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let reader = symphonia::default::get_probe()
        .probe(&hint, mss, FormatOptions::default(), MetadataOptions::default())
        .ok()?;
    let track = reader.default_track(TrackType::Audio)?;
    let Some(CodecParameters::Audio(a)) = &track.codec_params else {
        return None;
    };
    let sample_rate = a.sample_rate.unwrap_or(0);
    let seconds = match (track.num_frames, sample_rate) {
        (Some(n), sr) if sr > 0 => n as f64 / sr as f64,
        _ => match (track.duration, track.time_base) {
            (Some(d), Some(tb)) => tb.calc_duration(d).map(|t| t.as_secs_f64()).unwrap_or(0.0),
            _ => 0.0,
        },
    };
    Some(Meta {
        duration_ms: (seconds * 1000.0).round() as u32,
        sample_rate,
        bit_depth: a.bits_per_sample.unwrap_or(0),
        channels: a.channels.as_ref().map(|c| c.count() as u32).unwrap_or(0),
    })
}

/// Fichier trouvé sur le disque.
struct Found {
    path: PathBuf,
    size: i64,
    mtime: i64,
}

fn mtime_ms(meta: &std::fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn hidden(name: &std::ffi::OsStr) -> bool {
    let n = name.to_string_lossy();
    n.starts_with('.') || n == "__MACOSX"
}

/// Parcours récursif : dossiers (préordre, racine comprise) et fichiers audio. Cachés ignorés, liens non suivis.
fn walk(root: &Path) -> (Vec<PathBuf>, Vec<Found>) {
    let mut dirs = vec![];
    let mut files = vec![];
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        dirs.push(dir);
        let mut sub = vec![];
        for e in entries.flatten() {
            if hidden(&e.file_name()) {
                continue;
            }
            let Ok(ft) = e.file_type() else { continue };
            let path = e.path();
            if ft.is_dir() {
                sub.push(path);
            } else if ft.is_file() && is_audio(&path) {
                if let Ok(meta) = e.metadata() {
                    files.push(Found {
                        path,
                        size: meta.len() as i64,
                        mtime: mtime_ms(&meta),
                    });
                }
            }
        }
        sub.sort();
        stack.extend(sub.into_iter().rev());
    }
    (dirs, files)
}

fn path_str(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

fn file_name(p: &Path) -> String {
    p.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path_str(p))
}

/// Ce qu'un scan a changé (pour les tests et la trace).
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct ScanReport {
    pub added: u32,
    pub updated: u32,
    pub unchanged: u32,
    /// Disparus mais référencés (favori, tag, collection, dossier virtuel) : marqués introuvables.
    pub missing: u32,
    /// Disparus et sans référence : retirés de l'index.
    pub removed: u32,
    /// Lisibles sur le disque mais pas comme de l'audio : ignorés.
    pub unreadable: u32,
    pub offline: bool,
}

/// Rescan incrémental d'une source. `status` reçoit la progression ; `batch_done` est appelé après chaque
/// lot écrit (l'arbre peut se recharger).
pub fn scan_source(
    conn: &mut Connection,
    source_id: u32,
    status: &mut dyn FnMut(ScanStatus),
    batch_done: &mut dyn FnMut(),
) -> rusqlite::Result<ScanReport> {
    let mut report = ScanReport::default();
    let Some((root, name)): Option<(String, String)> = conn
        .query_row(
            "SELECT path, name FROM folders WHERE id = ? AND parent_id IS NULL",
            [source_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?
    else {
        return Ok(report);
    };
    let st = |folder: &str, done: usize, total: usize, finished: bool| ScanStatus {
        source_id,
        folder: folder.to_string(),
        done: done as u32,
        total: total as u32,
        finished,
    };
    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        // Disque débranché ou dossier déplacé : hors ligne, rien n'est supprimé.
        conn.execute("UPDATE folders SET offline = 1 WHERE id = ?", [source_id])?;
        report.offline = true;
        status(st(&name, 0, 0, true));
        batch_done();
        return Ok(report);
    }
    status(st(&name, 0, 0, false));
    conn.execute("UPDATE folders SET offline = 0 WHERE id = ?", [source_id])?;

    let (dirs, found) = walk(&root_path);

    // État connu de cette source.
    let sub = "WITH RECURSIVE sub(id) AS (SELECT ?1 UNION ALL SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id)";
    let known_folders: HashMap<String, u32> = conn
        .prepare(&format!("{sub} SELECT path, id FROM folders WHERE id IN sub"))?
        .query_map([source_id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    struct Known {
        id: u32,
        size: i64,
        mtime: i64,
        missing: bool,
    }
    let known_files: HashMap<String, Known> = conn
        .prepare(&format!(
            "{sub} SELECT path, id, size, mtime, missing FROM files WHERE folder_id IN sub"
        ))?
        .query_map([source_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                Known {
                    id: r.get(1)?,
                    size: r.get(2)?,
                    mtime: r.get(3)?,
                    missing: r.get(4)?,
                },
            ))
        })?
        .collect::<rusqlite::Result<_>>()?;

    // Dossiers gardés : ceux qui contiennent de l'audio, à n'importe quelle profondeur (+ la racine).
    let mut keep: HashSet<PathBuf> = HashSet::from([root_path.clone()]);
    for f in &found {
        let mut p = f.path.parent();
        while let Some(d) = p {
            if !keep.insert(d.to_path_buf()) || d == root_path {
                break;
            }
            p = d.parent();
        }
    }
    let mut folder_ids: HashMap<PathBuf, u32> = HashMap::from([(root_path.clone(), source_id)]);
    {
        let tx = conn.transaction()?;
        for d in dirs.iter().filter(|d| keep.contains(*d) && **d != root_path) {
            let id = match known_folders.get(&path_str(d)) {
                Some(&id) => id,
                None => {
                    let parent = d.parent().and_then(|p| folder_ids.get(p)).copied();
                    tx.execute(
                        "INSERT INTO folders (parent_id, path, name) VALUES (?1, ?2, ?3)",
                        params![parent, path_str(d), file_name(d)],
                    )?;
                    tx.last_insert_rowid() as u32
                }
            };
            folder_ids.insert(d.clone(), id);
        }
        tx.commit()?;
    }

    // Fichiers : inchangés (taille + date), à (re)lire, disparus.
    let mut todo: Vec<(&Found, Option<u32>)> = vec![];
    let mut seen: HashSet<String> = HashSet::with_capacity(found.len());
    {
        let tx = conn.transaction()?;
        for f in &found {
            let p = path_str(&f.path);
            match known_files.get(&p) {
                Some(k) if k.size == f.size && k.mtime == f.mtime => {
                    report.unchanged += 1;
                    if k.missing {
                        tx.execute("UPDATE files SET missing = 0 WHERE id = ?", [k.id])?;
                    }
                }
                Some(k) => todo.push((f, Some(k.id))),
                None => todo.push((f, None)),
            }
            seen.insert(p);
        }
        tx.commit()?;
    }

    let total = todo.len();
    let mut done = 0;
    let mut last = Instant::now();
    status(st(&name, 0, total, false));
    for chunk in todo.chunks(BATCH) {
        let metas: Vec<Option<Meta>> = chunk.par_iter().map(|(f, _)| probe(&f.path)).collect();
        let tx = conn.transaction()?;
        {
            let mut insert = tx.prepare_cached(
                "INSERT INTO files (folder_id, path, name, ext, size, mtime, duration_ms, sample_rate, bit_depth, channels, kind)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            )?;
            let mut update = tx.prepare_cached(
                "UPDATE files SET size = ?2, mtime = ?3, duration_ms = ?4, sample_rate = ?5, bit_depth = ?6, channels = ?7,
                 missing = 0, peaks = NULL, analyzed_at = NULL WHERE id = ?1",
            )?;
            for ((f, id), meta) in chunk.iter().zip(metas) {
                let Some(m) = meta else {
                    report.unreadable += 1;
                    if id.is_some() {
                        // Devenu illisible : traité comme disparu plus bas.
                        seen.remove(&path_str(&f.path));
                    }
                    continue;
                };
                match id {
                    Some(id) => {
                        update.execute(params![id, f.size, f.mtime, m.duration_ms, m.sample_rate, m.bit_depth, m.channels])?;
                        report.updated += 1;
                    }
                    None => {
                        let folder = f.path.parent().and_then(|p| folder_ids.get(p)).copied().unwrap_or(source_id);
                        let stem = f.path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
                        let ext = f.path.extension().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
                        // Provisoire (phase 6 : analyse) : « loop » dans le nom → boucle.
                        let kind = if stem.to_lowercase().contains("loop") { "loop" } else { "oneshot" };
                        insert.execute(params![
                            folder,
                            path_str(&f.path),
                            stem,
                            ext,
                            f.size,
                            f.mtime,
                            m.duration_ms,
                            m.sample_rate,
                            m.bit_depth,
                            m.channels,
                            kind
                        ])?;
                        report.added += 1;
                    }
                }
            }
        }
        tx.commit()?;
        done += chunk.len();
        let folder = chunk
            .last()
            .and_then(|(f, _)| f.path.parent())
            .map(file_name)
            .unwrap_or_else(|| name.clone());
        if last.elapsed().as_millis() >= 200 || done == total {
            status(st(&folder, done, total, false));
            last = Instant::now();
        }
        batch_done();
    }

    // Disparus : introuvables s'ils sont référencés, retirés sinon.
    {
        let tx = conn.transaction()?;
        for (p, k) in &known_files {
            if seen.contains(p) {
                continue;
            }
            let referenced: bool = tx.query_row(
                "SELECT fav = 1
                   OR EXISTS (SELECT 1 FROM file_tags WHERE file_id = ?1)
                   OR EXISTS (SELECT 1 FROM collection_items WHERE file_id = ?1)
                   OR EXISTS (SELECT 1 FROM virtual_items WHERE file_id = ?1)
                 FROM files WHERE id = ?1",
                [k.id],
                |r| r.get(0),
            )?;
            if referenced {
                if !k.missing {
                    tx.execute("UPDATE files SET missing = 1 WHERE id = ?", [k.id])?;
                }
                report.missing += 1;
            } else {
                tx.execute("DELETE FROM files WHERE id = ?", [k.id])?;
                report.removed += 1;
            }
        }
        // Dossiers disparus ou sans audio : supprimés s'ils sont vides (du plus profond au moins profond).
        let mut gone: Vec<(&String, &u32)> = known_folders
            .iter()
            .filter(|(p, &id)| id != source_id && !folder_ids.contains_key(Path::new(p.as_str())))
            .collect();
        gone.sort_by_key(|(p, _)| std::cmp::Reverse(p.len()));
        for (_, &id) in gone {
            tx.execute(
                "DELETE FROM folders WHERE id = ?1
                   AND NOT EXISTS (SELECT 1 FROM files WHERE folder_id = ?1)
                   AND NOT EXISTS (SELECT 1 FROM folders WHERE parent_id = ?1)",
                [id],
            )?;
        }
        tx.commit()?;
    }

    status(st(&name, total, total, true));
    batch_done();
    Ok(report)
}
