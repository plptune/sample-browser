//! Base SQLite : ouverture (WAL, clés étrangères), migrations, chargement du catalogue en mémoire.

use std::collections::HashMap;
use std::path::Path;

use rusqlite::{params, Connection};

use crate::catalog::{Catalog, FolderNode};
use crate::model::*;
use crate::natural;

const MIGRATIONS: &[&str] = &[include_str!("schema.sql"), include_str!("schema2.sql")];

pub type DbResult<T> = Result<T, rusqlite::Error>;

/// Ouvre (ou crée) la base et applique les migrations manquantes.
pub fn open(path: &Path) -> DbResult<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.busy_timeout(std::time::Duration::from_secs(10))?;
    migrate(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> DbResult<()> {
    let version: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(version as usize) {
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", i as i64 + 1)?;
        tx.commit()?;
    }
    Ok(())
}

pub fn schema_version(conn: &Connection) -> DbResult<i64> {
    conn.pragma_query_value(None, "user_version", |r| r.get(0))
}

fn kind_of(s: Option<String>) -> SampleKind {
    match s.as_deref() {
        Some("loop") => SampleKind::Loop,
        _ => SampleKind::Oneshot,
    }
}

/// Charge toute la bibliothèque dans un catalogue (sans les pics de waveform).
pub fn load_catalog(conn: &Connection) -> DbResult<Catalog> {
    let mut c = Catalog::empty();

    // Dossiers → arborescence (sources dans l'ordre d'ajout, sous-dossiers triés par nom).
    struct Row {
        id: u32,
        parent: Option<u32>,
        name: String,
        path: String,
        offline: bool,
    }
    let mut stmt = conn.prepare("SELECT id, parent_id, name, path, offline FROM folders ORDER BY id")?;
    let rows: Vec<Row> = stmt
        .query_map([], |r| {
            Ok(Row {
                id: r.get(0)?,
                parent: r.get(1)?,
                name: r.get(2)?,
                path: r.get(3)?,
                offline: r.get(4)?,
            })
        })?
        .collect::<DbResult<_>>()?;
    let mut children: HashMap<Option<u32>, Vec<&Row>> = HashMap::new();
    for r in &rows {
        children.entry(r.parent).or_default().push(r);
    }
    fn build(r: &Row, children: &HashMap<Option<u32>, Vec<&Row>>) -> FolderNode {
        let mut kids: Vec<&&Row> = children.get(&Some(r.id)).map(|v| v.iter().collect()).unwrap_or_default();
        kids.sort_by(|a, b| natural::compare(&a.name, &b.name));
        FolderNode {
            id: r.id,
            name: r.name.clone(),
            offline: r.offline,
            children: kids.into_iter().map(|k| build(k, children)).collect(),
        }
    }
    let roots: Vec<&Row> = children.get(&None).cloned().unwrap_or_default();
    let sources: Vec<FolderNode> = roots.iter().map(|r| build(r, &children)).collect();
    c.root_paths = roots.iter().map(|r| (r.id, r.path.clone())).collect();

    // Tags
    let mut tags_of: HashMap<u32, Vec<String>> = HashMap::new();
    let mut stmt = conn.prepare("SELECT ft.file_id, t.name FROM file_tags ft JOIN tags t ON t.id = ft.tag_id")?;
    for r in stmt.query_map([], |r| Ok((r.get::<_, u32>(0)?, r.get::<_, String>(1)?)))? {
        let (id, name) = r?;
        tags_of.entry(id).or_default().push(name);
    }
    c.known_tags = conn
        .prepare("SELECT name FROM tags ORDER BY id")?
        .query_map([], |r| r.get(0))?
        .collect::<DbResult<_>>()?;

    // Fichiers
    let mut stmt = conn.prepare(
        "SELECT id, folder_id, path, name, ext, duration_ms, sample_rate, bit_depth, channels, bpm, musical_key, kind, fav, missing, size, hidden
         FROM files ORDER BY id",
    )?;
    let mut sizes = HashMap::new();
    let samples = stmt
        .query_map([], |r| {
            let id: u32 = r.get(0)?;
            sizes.insert(id, r.get::<_, i64>(14)? as u64);
            Ok(Sample {
                id,
                folder_id: r.get(1)?,
                path: r.get(2)?,
                name: r.get(3)?,
                ext: r.get(4)?,
                duration_ms: r.get(5)?,
                sample_rate: r.get(6)?,
                bit_depth: r.get(7)?,
                channels: r.get(8)?,
                bpm: r.get(9)?,
                key: r.get(10)?,
                kind: kind_of(r.get(11)?),
                tags: vec![],
                missing: r.get(13)?,
                fav: r.get(12)?,
                hidden: r.get(15)?,
                peaks: vec![],
            })
        })?
        .collect::<DbResult<Vec<Sample>>>()?;
    c.file_sizes = sizes;
    c.samples = samples
        .into_iter()
        .map(|mut s| {
            if let Some(mut t) = tags_of.remove(&s.id) {
                t.sort();
                s.tags = t;
            }
            s
        })
        .collect();

    // Collections, dossiers virtuels, épinglage
    c.collections = conn
        .prepare("SELECT id, name, kind, query, pinned FROM collections ORDER BY id")?
        .query_map([], |r| {
            Ok(Collection {
                id: r.get(0)?,
                name: r.get(1)?,
                kind: if r.get::<_, String>(2)? == "smart" {
                    CollectionKind::Smart
                } else {
                    CollectionKind::Manual
                },
                query: r.get(3)?,
                pinned: r.get(4)?,
            })
        })?
        .collect::<DbResult<_>>()?;
    for c2 in &c.collections {
        if c2.kind == CollectionKind::Manual {
            c.collection_items.insert(c2.id, vec![]);
        }
    }
    let mut stmt = conn.prepare("SELECT collection_id, file_id FROM collection_items ORDER BY collection_id, position")?;
    for r in stmt.query_map([], |r| Ok((r.get::<_, u32>(0)?, r.get::<_, u32>(1)?)))? {
        let (cid, fid) = r?;
        c.collection_items.entry(cid).or_default().push(fid);
    }
    c.virtual_folders = conn
        .prepare("SELECT id, name, parent_id, pinned FROM virtual_folders ORDER BY id")?
        .query_map([], |r| {
            Ok(VirtualFolder {
                id: r.get(0)?,
                name: r.get(1)?,
                parent_id: r.get(2)?,
                pinned: r.get(3)?,
            })
        })?
        .collect::<DbResult<_>>()?;
    for f in &c.virtual_folders {
        c.virtual_items.insert(f.id, vec![]);
    }
    let mut stmt = conn.prepare("SELECT folder_id, file_id FROM virtual_items ORDER BY folder_id, position")?;
    for r in stmt.query_map([], |r| Ok((r.get::<_, u32>(0)?, r.get::<_, u32>(1)?)))? {
        let (vid, fid) = r?;
        c.virtual_items.entry(vid).or_default().push(fid);
    }
    c.pinned_folders = conn
        .prepare("SELECT folder_id FROM pinned_folders ORDER BY position")?
        .query_map([], |r| r.get(0))?
        .collect::<DbResult<_>>()?;
    c.favorites_pinned = setting(conn, "favorites_pinned")?.as_deref() != Some("0");
    c.hidden_folders = conn
        .prepare("SELECT id FROM folders WHERE hidden = 1")?
        .query_map([], |r| r.get(0))?
        .collect::<DbResult<_>>()?;
    c.synonyms = match setting(conn, "synonyms")? {
        Some(text) => crate::synonyms::from_text(&text),
        None => crate::synonyms::defaults(),
    };

    c.set_sources(sources);
    Ok(c)
}

pub fn setting(conn: &Connection, key: &str) -> DbResult<Option<String>> {
    match conn.query_row("SELECT value FROM settings WHERE key = ?", [key], |r| r.get(0)) {
        Ok(v) => Ok(Some(v)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> DbResult<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}
