//! Tags de Splice. L'app Splice garde ses samples dans une base SQLite locale (`sounds.db`, table `samples` : chemin
//! du fichier téléchargé, tags séparés par des virgules). Elle est lue en lecture seule, jamais modifiée.
//!
//! Les tags sont ramenés au vocabulaire de Crate : pluriels du vocabulaire automatique au singulier (`vocals` →
//! `vocal`), espaces remplacés par `-` (`hip hop` → `hip-hop`, sinon `#hip hop` ne serait pas cherchable).

use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};

/// Un sample de la base Splice : chemin local et tags déjà normalisés (sans doublon).
#[derive(Debug, Clone, PartialEq)]
pub struct SpliceSample {
    pub path: String,
    pub tags: Vec<String>,
}

/// Pluriels de Splice qui recoupent le vocabulaire automatique (`autotag`).
const PLURALS: &[(&str, &str)] = &[
    ("vocals", "vocal"),
    ("kicks", "kick"),
    ("snares", "snare"),
    ("claps", "clap"),
    ("rims", "rim"),
    ("snaps", "snap"),
    ("hats", "hat"),
    ("cymbals", "cymbal"),
    ("toms", "tom"),
    ("shakers", "shaker"),
    ("percussion", "perc"),
    ("pads", "pad"),
    ("leads", "lead"),
    ("strings", "string"),
];

/// Un tag Splice dans le vocabulaire de Crate ; `None` s'il est vide ou réservé (`loop`, `oneshot`).
pub fn map_tag(raw: &str) -> Option<String> {
    let t = raw.trim().to_lowercase();
    let t = PLURALS.iter().find(|(p, _)| *p == t).map(|(_, s)| s.to_string()).unwrap_or(t);
    let t = t.split(|c: char| c.is_whitespace() || c == '&').filter(|w| !w.is_empty()).collect::<Vec<_>>().join("-");
    crate::autotag::normalize(&t)
}

/// Bases Splice de ce Mac : une par compte (`users/<…>/<compte>/sounds.db`).
pub fn find_dbs() -> Vec<PathBuf> {
    let Some(home) = std::env::var_os("HOME") else { return vec![] };
    let users = PathBuf::from(home).join("Library/Application Support/com.splice.Splice/users");
    let mut out = vec![];
    let mut dirs = vec![(users, 0)];
    while let Some((dir, depth)) = dirs.pop() {
        let db = dir.join("sounds.db");
        if db.is_file() {
            out.push(db);
        } else if depth < 2 {
            for e in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
                if e.file_type().is_ok_and(|t| t.is_dir()) {
                    dirs.push((e.path(), depth + 1));
                }
            }
        }
    }
    out.sort();
    out
}

/// Lit une base Splice. Ouverte en lecture seule (journal `-wal` compris) ; si c'est refusé (fichier `-shm` absent
/// quand Splice est fermé), lue depuis une copie temporaire.
pub fn read(db: &Path) -> Result<Vec<SpliceSample>, String> {
    read_at(db).or_else(|_| read_copy(db))
}

fn read_at(db: &Path) -> rusqlite::Result<Vec<SpliceSample>> {
    let conn = Connection::open_with_flags(db, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    let mut stmt = conn.prepare("SELECT local_path, tags FROM samples WHERE local_path IS NOT NULL AND local_path <> ''")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?)))?;
    let mut out = vec![];
    for r in rows {
        let (path, tags) = r?;
        let mut mapped: Vec<String> = vec![];
        for t in tags.as_deref().unwrap_or("").split(',').filter_map(map_tag) {
            if !mapped.contains(&t) {
                mapped.push(t);
            }
        }
        out.push(SpliceSample { path, tags: mapped });
    }
    Ok(out)
}

fn read_copy(db: &Path) -> Result<Vec<SpliceSample>, String> {
    let dir = std::env::temp_dir().join(format!("crate-splice-{}", std::process::id()));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let r = (|| {
        for suffix in ["", "-wal", "-shm"] {
            let from = PathBuf::from(format!("{}{suffix}", db.display()));
            if from.is_file() {
                std::fs::copy(&from, dir.join(format!("sounds.db{suffix}"))).map_err(|e| e.to_string())?;
            }
        }
        read_at(&dir.join("sounds.db")).map_err(|e| format!("Splice database unreadable: {e}"))
    })();
    let _ = std::fs::remove_dir_all(&dir);
    r
}

#[cfg(test)]
mod tests {
    use super::map_tag;

    #[test]
    fn vocabulaire() {
        assert_eq!(map_tag("Vocals").as_deref(), Some("vocal"));
        assert_eq!(map_tag(" kicks ").as_deref(), Some("kick"));
        assert_eq!(map_tag("percussion").as_deref(), Some("perc"));
        assert_eq!(map_tag("hip hop").as_deref(), Some("hip-hop"));
        assert_eq!(map_tag("brass & woodwinds").as_deref(), Some("brass-woodwinds"));
        assert_eq!(map_tag("drum and bass").as_deref(), Some("drum-and-bass"));
        assert_eq!(map_tag("808").as_deref(), Some("808"));
        assert_eq!(map_tag("impacts").as_deref(), Some("impacts"));
        assert_eq!(map_tag(""), None);
        assert_eq!(map_tag("Loop"), None);
    }
}
