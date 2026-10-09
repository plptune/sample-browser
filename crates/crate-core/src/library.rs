//! La vraie bibliothèque : SQLite pour le stockage, le catalogue en mémoire pour l'arbre et la recherche.
//! Chaque modification est appliquée au catalogue puis écrite tout de suite en base ; les scans écrivent en
//! base depuis le thread de l'indexeur et le catalogue est rechargé (`sync`) quand ils ont avancé.

use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};

use rusqlite::{params, Connection};

use crate::catalog::{node_id, Catalog};
use crate::db;
use crate::indexer::{Changes, Indexer, StatusSink};
use crate::model::*;
use crate::scan;

enum Mode {
    /// Application : scans sur le thread de l'indexeur, dossiers surveillés.
    Background(Indexer),
    /// Tests et outils : scans exécutés tout de suite, sans surveillance.
    Inline,
}

pub struct SqliteLibrary {
    conn: Connection,
    cat: Catalog,
    mode: Mode,
    changes: Arc<Changes>,
    last_reload: Instant,
}

/// Rechargement du catalogue pendant un scan : au plus une fois par seconde.
const RELOAD_EVERY: Duration = Duration::from_secs(1);

fn expand_home(p: &str) -> PathBuf {
    match (p.strip_prefix("~/"), std::env::var_os("HOME")) {
        (Some(rest), Some(home)) => PathBuf::from(home).join(rest),
        _ if p == "~" => std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(p)),
        _ => PathBuf::from(p),
    }
}

fn log(r: rusqlite::Result<impl Sized>) {
    if let Err(e) = r {
        eprintln!("[crate] base : {e}");
    }
}

impl SqliteLibrary {
    /// Bibliothèque de l'application : charge la base, surveille les sources et lance un scan incrémental de
    /// chacune (pour rattraper ce qui a changé pendant que l'app était fermée).
    pub fn open(db_path: &Path, sink: StatusSink) -> Result<Self, String> {
        // La base est créée et migrée ici, avant que l'indexeur n'ouvre sa propre connexion.
        let mut lib = Self::with_mode(db_path, Mode::Inline, Arc::new(Changes::default()))?;
        let indexer = Indexer::start(db_path.to_path_buf(), sink, lib.changes.clone());
        for s in lib.cat.sources() {
            indexer.watch(s.id, Path::new(&s.path));
            indexer.scan(s.id);
        }
        lib.mode = Mode::Background(indexer);
        Ok(lib)
    }

    /// Sans thread ni surveillance : `add_source` et `refresh_source` scannent avant de rendre la main.
    pub fn open_inline(db_path: &Path) -> Result<Self, String> {
        Self::with_mode(db_path, Mode::Inline, Arc::new(Changes::default()))
    }

    fn with_mode(db_path: &Path, mode: Mode, changes: Arc<Changes>) -> Result<Self, String> {
        if let Some(dir) = db_path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let conn = db::open(db_path).map_err(|e| e.to_string())?;
        let cat = db::load_catalog(&conn).map_err(|e| e.to_string())?;
        Ok(SqliteLibrary {
            conn,
            cat,
            mode,
            changes,
            last_reload: Instant::now(),
        })
    }

    /// Recharge le catalogue si un scan a avancé. À appeler avant de lire (`tree`, `library`…).
    pub fn sync(&mut self) {
        let urgent = self.changes.urgent.swap(false, Ordering::AcqRel);
        if urgent || (self.changes.dirty.load(Ordering::Acquire) && self.last_reload.elapsed() >= RELOAD_EVERY) {
            self.changes.dirty.store(false, Ordering::Release);
            self.reload();
        }
    }

    fn reload(&mut self) {
        match db::load_catalog(&self.conn) {
            Ok(c) => self.cat = c,
            Err(e) => eprintln!("[crate] rechargement : {e}"),
        }
        self.last_reload = Instant::now();
    }

    pub fn catalog(&self) -> &Catalog {
        &self.cat
    }

    /// Fichier d'un sample, pour la lecture (`None` s'il est introuvable).
    pub fn sample_file(&self, id: SampleId) -> Option<(PathBuf, u32)> {
        self.cat.sample_file(id)
    }

    pub fn connection(&self) -> &Connection {
        &self.conn
    }

    fn scan_now(&mut self, id: u32) -> Option<scan::ScanReport> {
        match &self.mode {
            Mode::Background(ix) => {
                ix.scan(id);
                None
            }
            Mode::Inline => {
                let r = scan::scan_source(&mut self.conn, id, &mut |_| {}, &mut || {});
                self.reload();
                match r {
                    Ok(r) => Some(r),
                    Err(e) => {
                        eprintln!("[crate] scan {id} : {e}");
                        None
                    }
                }
            }
        }
    }

    /// Rescan immédiat d'une source (mode inline) avec son rapport.
    pub fn scan_inline(&mut self, id: u32) -> Option<scan::ScanReport> {
        self.scan_now(id)
    }

    // ---------- écriture en base de l'état du catalogue ----------

    fn write_collection_items(&self, id: u32) {
        let items = self.cat.collection_items.get(&id).cloned().unwrap_or_default();
        let r = (|| {
            let tx = self.conn.unchecked_transaction()?;
            tx.execute("DELETE FROM collection_items WHERE collection_id = ?", [id])?;
            for (pos, f) in items.iter().enumerate() {
                tx.execute(
                    "INSERT OR IGNORE INTO collection_items (collection_id, file_id, position) VALUES (?1, ?2, ?3)",
                    params![id, f, pos as i64],
                )?;
            }
            tx.commit()
        })();
        log(r);
    }

    fn write_virtual_items(&self, id: u32) {
        let items = self.cat.virtual_items.get(&id).cloned().unwrap_or_default();
        let r = (|| {
            let tx = self.conn.unchecked_transaction()?;
            tx.execute("DELETE FROM virtual_items WHERE folder_id = ?", [id])?;
            for (pos, f) in items.iter().enumerate() {
                tx.execute(
                    "INSERT OR IGNORE INTO virtual_items (folder_id, file_id, position) VALUES (?1, ?2, ?3)",
                    params![id, f, pos as i64],
                )?;
            }
            tx.commit()
        })();
        log(r);
    }

    fn write_pinned_folders(&self) {
        let r = (|| {
            let tx = self.conn.unchecked_transaction()?;
            tx.execute("DELETE FROM pinned_folders", [])?;
            for (pos, f) in self.cat.pinned_folders.iter().enumerate() {
                tx.execute(
                    "INSERT INTO pinned_folders (folder_id, position) VALUES (?1, ?2)",
                    params![f, pos as i64],
                )?;
            }
            tx.commit()
        })();
        log(r);
    }
}

/// « Créer un vrai dossier », préparé sous le verrou de la bibliothèque puis exécuté sans lui (l'app reste
/// utilisable pendant une longue copie, avec sa progression).
pub struct CommitJob {
    dest: PathBuf,
    dirs: Vec<PathBuf>,
    /// (fichier source, dossier de destination, nom sans extension, extension)
    files: Vec<(PathBuf, PathBuf, String, String)>,
    missing: u32,
}

impl CommitJob {
    pub fn total(&self) -> u32 {
        self.files.len() as u32
    }

    /// Copie ; `progress(fait, total)` après chaque fichier. Jamais d'écrasement : « nom 2 », « nom 3 »…
    pub fn run(&self, progress: &mut dyn FnMut(u32, u32)) -> Result<CommitResult, String> {
        std::fs::create_dir_all(&self.dest).map_err(|e| format!("Impossible de créer « {} » : {e}", self.dest.display()))?;
        for d in &self.dirs {
            let _ = std::fs::create_dir_all(d);
        }
        let (mut copied, mut skipped) = (0, self.missing);
        let total = self.total();
        for (i, (src, dir, name, ext)) in self.files.iter().enumerate() {
            let mut target = dir.join(format!("{name}.{ext}"));
            let mut n = 2;
            while target.exists() {
                target = dir.join(format!("{name} {n}.{ext}"));
                n += 1;
            }
            match std::fs::copy(src, &target) {
                Ok(_) => copied += 1,
                Err(_) => skipped += 1,
            }
            progress(i as u32 + 1, total);
        }
        Ok(CommitResult {
            destination: self.dest.to_string_lossy().into_owned(),
            copied,
            skipped,
        })
    }
}

impl SqliteLibrary {
    /// Vérifie la destination (refus d'un dossier existant non vide) et liste ce qu'il faut copier.
    pub fn prepare_commit(&self, key: &str, destination: &str, options: CommitOptions) -> Result<CommitJob, String> {
        let dest = expand_home(destination.trim().trim_end_matches('/'));
        if dest.exists() {
            let empty = dest.is_dir() && std::fs::read_dir(&dest).map(|mut d| d.next().is_none()).unwrap_or(false);
            if !empty {
                return Err(format!("« {} » existe déjà et n'est pas vide.", dest.display()));
            }
        }
        let join = |rel: &[String]| rel.iter().fold(dest.clone(), |p, part| p.join(part));
        let dirs = self.cat.commit_folders(key, options).iter().map(|r| join(r)).collect();
        let (mut files, mut missing) = (vec![], 0);
        for (rel, s) in self.cat.commit_entries(key, options) {
            if s.missing {
                missing += 1;
            } else {
                files.push((PathBuf::from(&s.path), join(&rel), s.name.clone(), s.ext.clone()));
            }
        }
        Ok(CommitJob {
            dest,
            dirs,
            files,
            missing,
        })
    }
}

impl Backend for SqliteLibrary {
    fn library(&self) -> Library {
        self.cat.library()
    }

    fn sources(&self) -> Vec<Source> {
        self.cat.sources()
    }

    fn tree(&self, req: &TreeRequest) -> TreePage {
        let mut page = self.cat.tree(req);
        if req.peaks {
            // Les pics restent en base (256 octets par fichier) : seulement ceux de la page affichée.
            let mut stmt = match self
                .conn
                .prepare_cached("SELECT peaks FROM files WHERE id = ? AND length(peaks) > 0")
            {
                Ok(s) => s,
                Err(_) => return page,
            };
            for row in &mut page.rows {
                if let TreeRow::Sample(r) = row {
                    if let Ok(p) = stmt.query_row([r.sample.id], |x| x.get::<_, Vec<u8>>(0)) {
                        r.sample.peaks = crate::audio::peaks_to_f64(&p);
                    }
                }
            }
        }
        page
    }

    fn set_favorite(&mut self, ids: &[SampleId], fav: bool) {
        self.cat.set_favorite(ids, fav);
        let r = (|| {
            let tx = self.conn.unchecked_transaction()?;
            for id in ids {
                tx.execute("UPDATE files SET fav = ?1 WHERE id = ?2", params![fav, id])?;
            }
            tx.commit()
        })();
        log(r);
    }

    fn add_tag(&mut self, ids: &[SampleId], tag: &str) {
        let tag = tag.trim();
        if tag.is_empty() {
            return;
        }
        self.cat.add_tag(ids, tag);
        if !self.cat.known_tags.iter().any(|t| t == tag) {
            self.cat.known_tags.push(tag.to_string());
        }
        let r = (|| {
            let tx = self.conn.unchecked_transaction()?;
            tx.execute("INSERT OR IGNORE INTO tags (name) VALUES (?)", [tag])?;
            let tag_id: i64 = tx.query_row("SELECT id FROM tags WHERE name = ?", [tag], |r| r.get(0))?;
            for id in ids {
                tx.execute(
                    "INSERT OR IGNORE INTO file_tags (file_id, tag_id) VALUES (?1, ?2)",
                    params![id, tag_id],
                )?;
            }
            tx.commit()
        })();
        log(r);
    }

    fn remove_tag(&mut self, ids: &[SampleId], tag: &str) {
        self.cat.remove_tag(ids, tag);
        let r = (|| {
            let tx = self.conn.unchecked_transaction()?;
            for id in ids {
                tx.execute(
                    "DELETE FROM file_tags WHERE file_id = ?1 AND tag_id = (SELECT id FROM tags WHERE name = ?2)",
                    params![id, tag],
                )?;
            }
            tx.commit()
        })();
        log(r);
    }

    fn create_collection(&mut self, name: &str, query: Option<&str>) -> Collection {
        let c = self.cat.create_collection(name, query);
        log(self.conn.execute(
            "INSERT INTO collections (id, name, kind, query, pinned) VALUES (?1, ?2, ?3, ?4, 0)",
            params![
                c.id,
                c.name,
                if c.kind == CollectionKind::Smart { "smart" } else { "manual" },
                c.query
            ],
        ));
        c
    }

    fn rename_collection(&mut self, id: u32, name: &str) {
        self.cat.rename_collection(id, name);
        log(self
            .conn
            .execute("UPDATE collections SET name = ?1 WHERE id = ?2", params![name, id]));
    }

    fn delete_collection(&mut self, id: u32) {
        self.cat.delete_collection(id);
        log(self.conn.execute("DELETE FROM collections WHERE id = ?", [id]));
    }

    fn add_to_collection(&mut self, id: u32, ids: &[SampleId]) {
        let ids: Vec<SampleId> = ids.iter().copied().filter(|&s| self.cat.has_sample(s)).collect();
        self.cat.add_to_collection(id, &ids);
        self.write_collection_items(id);
    }

    fn remove_from_collection(&mut self, id: u32, ids: &[SampleId]) {
        self.cat.remove_from_collection(id, ids);
        self.write_collection_items(id);
    }

    fn create_virtual_folder(&mut self, name: &str, parent_id: Option<u32>) -> VirtualFolder {
        let f = self.cat.create_virtual_folder(name, parent_id);
        log(self.conn.execute(
            "INSERT INTO virtual_folders (id, name, parent_id, pinned) VALUES (?1, ?2, ?3, 0)",
            params![f.id, f.name, f.parent_id],
        ));
        f
    }

    fn rename_virtual_folder(&mut self, id: u32, name: &str) {
        self.cat.rename_virtual_folder(id, name);
        log(self
            .conn
            .execute("UPDATE virtual_folders SET name = ?1 WHERE id = ?2", params![name, id]));
    }

    fn delete_virtual_folder(&mut self, id: u32) {
        self.cat.delete_virtual_folder(id);
        // Les sous-dossiers suivent (ON DELETE CASCADE).
        log(self.conn.execute("DELETE FROM virtual_folders WHERE id = ?", [id]));
    }

    fn move_virtual_folder(&mut self, id: u32, parent_id: Option<u32>) {
        self.cat.move_virtual_folder(id, parent_id);
        if let Some(f) = self.cat.virtual_folders.iter().find(|f| f.id == id) {
            log(self
                .conn
                .execute("UPDATE virtual_folders SET parent_id = ?1 WHERE id = ?2", params![f.parent_id, id]));
        }
    }

    fn add_to_virtual_folder(&mut self, id: u32, ids: &[SampleId]) {
        let ids: Vec<SampleId> = ids.iter().copied().filter(|&s| self.cat.has_sample(s)).collect();
        self.cat.add_to_virtual_folder(id, &ids);
        self.write_virtual_items(id);
    }

    fn remove_from_virtual_folder(&mut self, id: u32, ids: &[SampleId]) {
        self.cat.remove_from_virtual_folder(id, ids);
        self.write_virtual_items(id);
    }

    fn set_pinned(&mut self, key: &str, pinned: bool) {
        self.cat.set_pinned(key, pinned);
        let id = node_id(key);
        if key.starts_with("f:") {
            self.write_pinned_folders();
        } else if key == "c:fav" {
            log(db::set_setting(&self.conn, "favorites_pinned", if pinned { "1" } else { "0" }));
        } else if key.starts_with("c:") {
            log(self
                .conn
                .execute("UPDATE collections SET pinned = ?1 WHERE id = ?2", params![pinned, id]));
        } else if key.starts_with("v:") {
            log(self
                .conn
                .execute("UPDATE virtual_folders SET pinned = ?1 WHERE id = ?2", params![pinned, id]));
        }
    }

    fn ancestors(&self, key: &str) -> Vec<NodeKey> {
        self.cat.ancestors(key)
    }

    /// Pics en base ; calculés tout de suite s'ils manquent encore (le tiroir n'attend pas la tâche de fond).
    fn set_hidden(&mut self, ids: &[SampleId], hidden: bool) {
        self.cat.set_hidden(ids, hidden);
        let r = (|| {
            let tx = self.conn.unchecked_transaction()?;
            for id in ids {
                tx.execute("UPDATE files SET hidden = ?1 WHERE id = ?2", params![hidden, id])?;
            }
            tx.commit()
        })();
        log(r);
    }

    fn set_folder_hidden(&mut self, id: u32, hidden: bool) {
        self.cat.set_folder_hidden(id, hidden);
        log(self
            .conn
            .execute("UPDATE folders SET hidden = ?1 WHERE id = ?2", params![hidden, id]));
    }

    fn peaks(&self, id: SampleId) -> Vec<f64> {
        let row: Option<(String, Option<Vec<u8>>)> = self
            .conn
            .query_row("SELECT path, peaks FROM files WHERE id = ?", [id], |r| Ok((r.get(0)?, r.get(1)?)))
            .ok();
        match row {
            Some((_, Some(p))) => crate::audio::peaks_to_f64(&p),
            Some((path, None)) => {
                let p = crate::audio::compute_peaks(Path::new(&path)).unwrap_or_default();
                log(self.conn.execute("UPDATE files SET peaks = ?1 WHERE id = ?2", params![p, id]));
                crate::audio::peaks_to_f64(&p)
            }
            None => vec![],
        }
    }

    fn synonyms(&self) -> Vec<Vec<String>> {
        self.cat.synonyms()
    }

    fn set_synonyms(&mut self, groups: &[Vec<String>]) {
        self.cat.set_synonyms(groups);
        log(db::set_setting(
            &self.conn,
            "synonyms",
            &crate::synonyms::to_text(&self.cat.synonyms),
        ));
    }

    fn node_path(&self, key: &str) -> Option<String> {
        if !(key.starts_with("f:") || key.starts_with("p:")) {
            return None;
        }
        self.conn
            .query_row("SELECT path FROM folders WHERE id = ?", [node_id(key)], |r| r.get(0))
            .ok()
    }

    fn plan_commit(&self, key: &str, options: CommitOptions) -> CommitPlan {
        self.cat.plan_commit(key, options)
    }

    fn commit_to_folder(&mut self, key: &str, destination: &str, options: CommitOptions) -> Result<CommitResult, String> {
        let job = self.prepare_commit(key, destination, options)?;
        let result = job.run(&mut |_, _| {})?;
        if options.add_as_source {
            // Refusé si la copie est déjà dans une source : notify l'indexera de toute façon.
            let _ = self.add_source(&result.destination);
        }
        Ok(result)
    }

    fn add_source(&mut self, path: &str) -> Result<Source, String> {
        let p = expand_home(path.trim());
        let p = p.canonicalize().map_err(|_| format!("« {path} » est introuvable."))?;
        if !p.is_dir() {
            return Err(format!("« {} » n'est pas un dossier.", p.display()));
        }
        for s in self.cat.sources() {
            let r = Path::new(&s.path);
            if p.starts_with(r) {
                return Err(format!("Ce dossier est déjà dans la source « {} ».", s.name));
            }
            if r.starts_with(&p) {
                return Err(format!("Ce dossier contient déjà la source « {} » : retirez-la d'abord.", s.name));
            }
        }
        let name = p
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| p.to_string_lossy().into_owned());
        let path_s = p.to_string_lossy().into_owned();
        self.conn
            .execute(
                "INSERT INTO folders (parent_id, path, name) VALUES (NULL, ?1, ?2)",
                params![path_s, name],
            )
            .map_err(|e| e.to_string())?;
        let id = self.conn.last_insert_rowid() as u32;
        self.reload();
        if let Mode::Background(ix) = &self.mode {
            ix.watch(id, &p);
        }
        self.scan_now(id);
        Ok(Source {
            id,
            name,
            path: path_s,
            offline: false,
        })
    }

    fn refresh_source(&mut self, id: u32) {
        self.scan_now(id);
    }

    fn remove_source(&mut self, id: u32) {
        if let Mode::Background(ix) = &self.mode {
            ix.unwatch(id);
        }
        // Dossiers, fichiers, tags et appartenances suivent (ON DELETE CASCADE). Rien n'est touché sur le disque.
        log(self.conn.execute("DELETE FROM folders WHERE id = ? AND parent_id IS NULL", [id]));
        self.reload();
    }
}
