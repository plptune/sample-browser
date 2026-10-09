//! Catalogue en mémoire : toute la logique de l'arbre, de la recherche et du « Créer un vrai dossier ».
//! Rempli par les données du prototype (`Catalog::demo()`, vérifié par tests/parity.rs) ou chargé depuis
//! SQLite (`db::load_catalog`), puis indexé pour rester rapide à 100 000 fichiers.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use crate::model::*;
use crate::natural;
use crate::query::{self, js_round, FilterKey, TokenKind};

/// Nœud de l'arborescence des sources.
#[derive(Debug, Clone)]
pub struct FolderNode {
    pub id: u32,
    pub name: String,
    pub offline: bool,
    pub children: Vec<FolderNode>,
}

#[derive(Default)]
pub struct Catalog {
    /// Triés par id.
    pub(crate) samples: Vec<Sample>,
    pub(crate) sources: Vec<FolderNode>,
    /// Index de tous les dossiers (même ceux d'une source retirée, comme dans le prototype).
    pub(crate) folders: HashMap<u32, FolderNode>,
    pub(crate) folder_parent: HashMap<u32, Option<u32>>,
    pub(crate) root_paths: HashMap<u32, String>,
    pub(crate) collections: Vec<Collection>,
    pub(crate) collection_items: HashMap<u32, Vec<SampleId>>,
    pub(crate) virtual_folders: Vec<VirtualFolder>,
    pub(crate) virtual_items: HashMap<u32, Vec<SampleId>>,
    pub(crate) favorites_pinned: bool,
    pub(crate) pinned_folders: Vec<u32>,
    /// Tags proposés même sans fichier (ordre d'apparition).
    pub(crate) known_tags: Vec<String>,
    /// Taille réelle des fichiers (vide en démo : taille estimée d'après la durée).
    pub(crate) file_sizes: HashMap<SampleId, u64>,
    // --- index (reindex)
    by_id: HashMap<SampleId, usize>,
    by_folder: HashMap<u32, Vec<usize>>,
    /// Texte de recherche en minuscules : nom, chemin, tags.
    hay: Vec<String>,
}

pub(crate) struct NodeInfo {
    pub key: NodeKey,
    pub name: String,
    pub kind: NodeKind,
    pub offline: bool,
    pub pinned: bool,
    pub target: Option<NodeKey>,
}

/// Fichier à copier : sous-dossier relatif dans le nouveau dossier, et le sample.
pub(crate) type Entry = (Vec<String>, Sample);

fn index_folders(nodes: &[FolderNode], parent: Option<u32>, out: &mut HashMap<u32, FolderNode>, parents: &mut HashMap<u32, Option<u32>>) {
    for n in nodes {
        out.insert(n.id, n.clone());
        parents.insert(n.id, parent);
        index_folders(&n.children, Some(n.id), out, parents);
    }
}

fn by_name<T, F: Fn(&T) -> &str>(v: &mut [T], name: F) {
    v.sort_by(|a, b| natural::compare(name(a), name(b)));
}

/// Taille estimée d'un fichier PCM (en-tête de 44 octets compris).
fn estimated_size(s: &Sample) -> f64 {
    js_round((s.duration_ms as f64 / 1000.0) * s.sample_rate as f64 * s.channels as f64 * (s.bit_depth as f64 / 8.0)) + 44.0
}

pub(crate) fn node_id(key: &str) -> u32 {
    key.get(2..).and_then(|k| k.parse().ok()).unwrap_or(0)
}

fn haystack(s: &Sample) -> String {
    format!("{} {} {}", s.name, s.path, s.tags.join(" ")).to_lowercase()
}

/// Une condition de recherche, résolue une fois par requête.
enum Cond {
    Text(String),
    Tag(String),
    Bpm(Box<dyn Fn(f64) -> bool>),
    Dur(Box<dyn Fn(f64) -> bool>),
    Key(String),
    Kind(SampleKind),
    Fav,
    Untagged,
    Never,
    In(HashSet<SampleId>),
    InPath(String),
}

/// Ligne de recherche compilée (`in:` résolu, texte en minuscules).
pub(crate) struct Matcher(Vec<(Cond, bool)>);

impl Matcher {
    pub fn matches(&self, cat: &Catalog, s: &Sample) -> bool {
        self.0.iter().all(|(c, negated)| cat.cond(c, s) != *negated)
    }
}

impl Catalog {
    pub fn empty() -> Self {
        Self::default()
    }

    pub fn samples(&self) -> &[Sample] {
        &self.samples
    }

    /// Remplace l'arborescence des sources et reconstruit les index.
    pub(crate) fn set_sources(&mut self, sources: Vec<FolderNode>) {
        self.folders.clear();
        self.folder_parent.clear();
        index_folders(&sources, None, &mut self.folders, &mut self.folder_parent);
        self.sources = sources;
        self.reindex();
    }

    /// Index des samples (à appeler après tout ajout ou retrait de samples).
    pub(crate) fn reindex(&mut self) {
        self.by_id = self.samples.iter().enumerate().map(|(i, s)| (s.id, i)).collect();
        self.by_folder.clear();
        for (i, s) in self.samples.iter().enumerate() {
            self.by_folder.entry(s.folder_id).or_default().push(i);
        }
        self.hay = self.samples.iter().map(haystack).collect();
    }

    /// Samples de ces ids, dans l'ordre des ids (comme un filtre sur la liste complète).
    fn samples_of(&self, ids: &[SampleId]) -> Vec<&Sample> {
        let mut idx: Vec<usize> = ids.iter().filter_map(|id| self.by_id.get(id).copied()).collect();
        idx.sort_unstable();
        idx.dedup();
        idx.into_iter().map(|i| &self.samples[i]).collect()
    }

    /// Réservé aux scénarios de démo : marque des fichiers comme introuvables.
    pub fn set_missing(&mut self, ids: &[SampleId]) {
        for s in &mut self.samples {
            s.missing = ids.contains(&s.id);
        }
    }

    pub(crate) fn file_size(&self, s: &Sample) -> f64 {
        self.file_sizes.get(&s.id).map(|&b| b as f64).unwrap_or_else(|| estimated_size(s))
    }

    // ---------- collections et dossiers virtuels ----------

    fn collection(&self, id: u32) -> Option<&Collection> {
        self.collections.iter().find(|c| c.id == id)
    }

    fn virtual_folder(&self, id: u32) -> Option<&VirtualFolder> {
        self.virtual_folders.iter().find(|f| f.id == id)
    }

    fn vf_children(&self, parent: Option<u32>) -> Vec<&VirtualFolder> {
        let mut v: Vec<&VirtualFolder> = self.virtual_folders.iter().filter(|f| f.parent_id == parent).collect();
        by_name(&mut v, |f| &f.name);
        v
    }

    fn collection_samples(&self, id: u32) -> Vec<&Sample> {
        let Some(c) = self.collection(id) else { return vec![] };
        match c.kind {
            CollectionKind::Smart => {
                let m = self.compile(c.query.as_deref().unwrap_or_default());
                self.samples.iter().filter(|s| m.matches(self, s)).collect()
            }
            CollectionKind::Manual => self.samples_of(self.collection_items.get(&c.id).map(Vec::as_slice).unwrap_or_default()),
        }
    }

    /// Samples propres à un dossier virtuel (pas ceux de ses sous-dossiers).
    fn own_samples(&self, id: u32) -> Vec<&Sample> {
        self.samples_of(self.virtual_items.get(&id).map(Vec::as_slice).unwrap_or_default())
    }

    /// Samples d'un dossier virtuel et de tous ses descendants (pour `in:` et le commit à plat).
    fn subtree_samples(&self, id: u32) -> Vec<&Sample> {
        let mut seen = HashSet::new();
        let mut out = Vec::new();
        fn visit<'a>(lib: &'a Catalog, fid: u32, seen: &mut HashSet<u32>, out: &mut Vec<&'a Sample>) {
            for s in lib.own_samples(fid) {
                if seen.insert(s.id) {
                    out.push(s);
                }
            }
            for c in lib.vf_children(Some(fid)) {
                visit(lib, c.id, seen, out);
            }
        }
        visit(self, id, &mut seen, &mut out);
        out
    }

    // ---------- recherche ----------

    pub(crate) fn compile(&self, line: &str) -> Matcher {
        let conds = query::parse_line(line)
            .into_iter()
            .map(|t| {
                let cond = match &t.kind {
                    TokenKind::Text | TokenKind::Phrase => Cond::Text(t.value.to_lowercase()),
                    TokenKind::Tag => Cond::Tag(t.value.clone()),
                    TokenKind::Filter(key) => match key {
                        FilterKey::Bpm => Cond::Bpm(Box::new(query::parse_range(&t.value, ""))),
                        FilterKey::Dur => Cond::Dur(Box::new(query::parse_range(&t.value, "s"))),
                        FilterKey::Key => Cond::Key(t.value.to_lowercase()),
                        FilterKey::Type => match if t.value == "one-shot" { "oneshot" } else { t.value.as_str() } {
                            "oneshot" => Cond::Kind(SampleKind::Oneshot),
                            "loop" => Cond::Kind(SampleKind::Loop),
                            _ => Cond::Never,
                        },
                        FilterKey::Is => match t.value.as_str() {
                            "fav" => Cond::Fav,
                            "untagged" => Cond::Untagged,
                            _ => Cond::Never,
                        },
                        FilterKey::In => {
                            // Collection, sinon dossier virtuel (avec ses sous-dossiers), sinon chemin.
                            let v = t.value.to_lowercase();
                            if let Some(c) = self.collections.iter().find(|c| c.name.to_lowercase().starts_with(&v)) {
                                Cond::In(self.collection_samples(c.id).iter().map(|s| s.id).collect())
                            } else if let Some(f) = self.virtual_folders.iter().find(|f| f.name.to_lowercase().starts_with(&v)) {
                                Cond::In(self.subtree_samples(f.id).iter().map(|s| s.id).collect())
                            } else {
                                Cond::InPath(v)
                            }
                        }
                    },
                };
                (cond, t.negated)
            })
            .collect();
        Matcher(conds)
    }

    fn cond(&self, c: &Cond, s: &Sample) -> bool {
        match c {
            Cond::Text(v) => match self.by_id.get(&s.id) {
                Some(&i) => self.hay[i].contains(v.as_str()),
                None => haystack(s).contains(v.as_str()),
            },
            Cond::Tag(v) => s.tags.contains(v),
            Cond::Bpm(f) => s.bpm.is_some_and(f),
            Cond::Dur(f) => f(s.duration_ms as f64 / 1000.0),
            Cond::Key(want) => {
                let Some(have) = s.key.as_ref().map(|k| k.to_lowercase()) else {
                    return false;
                };
                have == *want || (!want.ends_with('m') && have.strip_suffix('m').unwrap_or(&have) == want)
            }
            Cond::Kind(k) => s.kind == *k,
            Cond::Fav => s.fav,
            Cond::Untagged => s.tags.is_empty(),
            Cond::Never => false,
            Cond::In(ids) => ids.contains(&s.id),
            Cond::InPath(v) => s.path.to_lowercase().contains(v.as_str()),
        }
    }

    // ---------- arbre ----------

    fn folder_info(f: &FolderNode) -> NodeInfo {
        NodeInfo {
            key: format!("f:{}", f.id),
            name: f.name.clone(),
            kind: NodeKind::Folder,
            offline: f.offline,
            pinned: false,
            target: None,
        }
    }

    fn shortcut_info(f: &FolderNode) -> NodeInfo {
        NodeInfo {
            key: format!("p:{}", f.id),
            name: f.name.clone(),
            kind: NodeKind::Shortcut,
            offline: false,
            pinned: false,
            target: Some(format!("f:{}", f.id)),
        }
    }

    fn fav_info(&self) -> NodeInfo {
        NodeInfo {
            key: "c:fav".into(),
            name: "Favoris".into(),
            kind: NodeKind::Favorites,
            offline: false,
            pinned: self.favorites_pinned,
            target: None,
        }
    }

    fn coll_info(c: &Collection) -> NodeInfo {
        let kind = if c.kind == CollectionKind::Smart {
            NodeKind::Smart
        } else {
            NodeKind::Collection
        };
        NodeInfo {
            key: format!("c:{}", c.id),
            name: c.name.clone(),
            kind,
            offline: false,
            pinned: c.pinned,
            target: None,
        }
    }

    fn vf_info(f: &VirtualFolder) -> NodeInfo {
        NodeInfo {
            key: format!("v:{}", f.id),
            name: f.name.clone(),
            kind: NodeKind::Virtual,
            offline: false,
            pinned: f.pinned,
            target: None,
        }
    }

    /// Enfants d'un nœud ; `None` = racine de l'onglet.
    fn child_nodes(&self, root: TreeRoot, key: Option<&str>, searching: bool) -> Vec<NodeInfo> {
        match key {
            None if root == TreeRoot::Virtual => {
                // Virtuels : favoris, collections (groupe), dossiers virtuels.
                let mut v = vec![
                    self.fav_info(),
                    NodeInfo {
                        key: "g:collections".into(),
                        name: "Collections".into(),
                        kind: NodeKind::Group,
                        offline: false,
                        pinned: false,
                        target: None,
                    },
                ];
                v.extend(self.vf_children(None).into_iter().map(Self::vf_info));
                v
            }
            None => {
                // Bibliothèque : sources, puis (hors recherche, pour éviter les doublons) les éléments épinglés.
                let mut v: Vec<NodeInfo> = self.sources.iter().map(Self::folder_info).collect();
                if searching {
                    return v;
                }
                let mut shortcuts: Vec<&FolderNode> = self.pinned_folders.iter().filter_map(|id| self.folders.get(id)).collect();
                by_name(&mut shortcuts, |f| &f.name);
                v.extend(shortcuts.into_iter().map(Self::shortcut_info));
                if self.favorites_pinned {
                    v.push(self.fav_info());
                }
                let mut colls: Vec<&Collection> = self.collections.iter().filter(|c| c.pinned).collect();
                by_name(&mut colls, |c| &c.name);
                v.extend(colls.into_iter().map(Self::coll_info));
                let mut vfs: Vec<&VirtualFolder> = self.virtual_folders.iter().filter(|f| f.pinned).collect();
                by_name(&mut vfs, |f| &f.name);
                v.extend(vfs.into_iter().map(Self::vf_info));
                v
            }
            Some("g:collections") => self.collections.iter().map(Self::coll_info).collect(),
            Some(k) if k.starts_with("f:") => self
                .folders
                .get(&node_id(k))
                .map(|f| f.children.iter().map(Self::folder_info).collect())
                .unwrap_or_default(),
            Some(k) if k.starts_with("v:") => self.vf_children(Some(node_id(k))).into_iter().map(Self::vf_info).collect(),
            _ => vec![],
        }
    }

    pub(crate) fn child_samples(&self, key: &str) -> Vec<&Sample> {
        let mut v: Vec<&Sample> = if key.starts_with("f:") {
            self.by_folder
                .get(&node_id(key))
                .map(|idx| idx.iter().map(|&i| &self.samples[i]).collect())
                .unwrap_or_default()
        } else if key == "c:fav" {
            self.samples.iter().filter(|s| s.fav).collect()
        } else if key.starts_with("c:") {
            self.collection_samples(node_id(key))
        } else if key.starts_with("v:") {
            self.own_samples(node_id(key))
        } else {
            vec![]
        };
        by_name(&mut v, |s| &s.name);
        v
    }

    // ---------- commit ----------

    /// Fichiers à copier. Collections et favoris : à plat.
    pub(crate) fn commit_entries(&self, key: &str, options: CommitOptions) -> Vec<Entry> {
        if !key.starts_with("v:") {
            return self.child_samples(key).into_iter().map(|s| (vec![], s.clone())).collect();
        }
        let id = node_id(key);
        if !options.keep_hierarchy {
            let mut v = self.subtree_samples(id);
            by_name(&mut v, |s| &s.name);
            return v.into_iter().map(|s| (vec![], s.clone())).collect();
        }
        let mut out = Vec::new();
        fn visit(lib: &Catalog, fid: u32, rel: Vec<String>, out: &mut Vec<Entry>) {
            let mut own = lib.own_samples(fid);
            by_name(&mut own, |s| &s.name);
            for s in own {
                out.push((rel.clone(), s.clone()));
            }
            for c in lib.vf_children(Some(fid)) {
                let mut r = rel.clone();
                r.push(c.name.clone());
                visit(lib, c.id, r, out);
            }
        }
        visit(self, id, vec![], &mut out);
        out
    }

    /// Sous-dossiers à créer, en préordre.
    pub(crate) fn commit_folders(&self, key: &str, options: CommitOptions) -> Vec<Vec<String>> {
        if !key.starts_with("v:") || !options.keep_hierarchy {
            return vec![];
        }
        let mut out = Vec::new();
        fn visit(lib: &Catalog, fid: u32, rel: &[String], out: &mut Vec<Vec<String>>) {
            for c in lib.vf_children(Some(fid)) {
                let mut r = rel.to_vec();
                r.push(c.name.clone());
                out.push(r.clone());
                visit(lib, c.id, &r, out);
            }
        }
        visit(self, node_id(key), &[], &mut out);
        out
    }

    // ---------- requêtes utilisées par la bibliothèque réelle ----------

    pub(crate) fn has_sample(&self, id: SampleId) -> bool {
        self.by_id.contains_key(&id)
    }
}

impl Backend for Catalog {
    fn library(&self) -> Library {
        // Tags connus + tags créés à la volée, ordre d'apparition, puis par fréquence (tri stable).
        let mut names: Vec<String> = self.known_tags.clone();
        let mut seen: HashSet<String> = names.iter().cloned().collect();
        for s in &self.samples {
            for t in &s.tags {
                if seen.insert(t.clone()) {
                    names.push(t.clone());
                }
            }
        }
        let mut counts: HashMap<&str, u32> = HashMap::new();
        for s in &self.samples {
            for t in &s.tags {
                *counts.entry(t.as_str()).or_default() += 1;
            }
        }
        let mut tags: Vec<Tag> = names
            .iter()
            .map(|name| Tag {
                name: name.clone(),
                count: counts.get(name.as_str()).copied().unwrap_or(0),
            })
            .collect();
        tags.sort_by_key(|t| std::cmp::Reverse(t.count)); // tri stable : ex-aequo dans l'ordre d'apparition
        Library {
            total: self.samples.len() as u32,
            tags,
            collections: self.collections.clone(),
            virtual_folders: self.virtual_folders.clone(),
            favorites_pinned: self.favorites_pinned,
            pinned_folders: self.pinned_folders.clone(),
        }
    }

    fn sources(&self) -> Vec<Source> {
        self.sources
            .iter()
            .map(|f| Source {
                id: f.id,
                name: f.name.clone(),
                path: self.root_paths.get(&f.id).cloned().unwrap_or_default(),
                offline: f.offline,
            })
            .collect()
    }

    fn tree(&self, req: &TreeRequest) -> TreePage {
        let q = req.query.trim();
        let searching = !q.is_empty();
        let matcher = self.compile(q);
        let matches = |s: &Sample| !searching || matcher.matches(self, s);

        struct Walk<'a> {
            lib: &'a Catalog,
            req: &'a TreeRequest,
            searching: bool,
            m: &'a dyn Fn(&Sample) -> bool,
            memo: HashMap<String, bool>,
            rows: Vec<TreeRow>,
        }
        impl Walk<'_> {
            /// Un nœud reste visible en recherche s'il contient au moins un résultat (mémoïsé).
            fn has_match(&mut self, key: &str) -> bool {
                if let Some(&v) = self.memo.get(key) {
                    return v;
                }
                let v = self.lib.child_samples(key).into_iter().any(self.m)
                    || self
                        .lib
                        .child_nodes(self.req.root, Some(key), self.searching)
                        .iter()
                        .any(|n| self.has_match(&n.key));
                self.memo.insert(key.to_string(), v);
                v
            }

            fn walk(&mut self, key: Option<&str>, depth: u32) {
                for n in self.lib.child_nodes(self.req.root, key, self.searching) {
                    if self.searching && !self.has_match(&n.key) {
                        continue;
                    }
                    // Un raccourci ne se déplie jamais : il saute au dossier visé.
                    let open = n.kind != NodeKind::Shortcut && (self.searching || self.req.expanded.contains(&n.key));
                    self.rows.push(TreeRow::Node(FolderRow {
                        tag: NodeTag::Node,
                        key: n.key.clone(),
                        parent: key.map(String::from),
                        depth,
                        name: n.name.clone(),
                        kind: n.kind,
                        open,
                        offline: n.offline.then_some(true),
                        pinned: n.pinned.then_some(true),
                        target: n.target.clone(),
                    }));
                    if open {
                        self.walk(Some(&n.key), depth + 1);
                    }
                }
                let Some(k) = key else { return };
                for s in self.lib.child_samples(k) {
                    if !(self.m)(s) {
                        continue;
                    }
                    self.rows.push(TreeRow::Sample(SampleRow {
                        tag: SampleTag::Sample,
                        key: format!("s:{}@{k}", s.id),
                        parent: k.to_string(),
                        depth,
                        sample: s.clone(),
                    }));
                }
            }
        }

        let mut w = Walk {
            lib: self,
            req,
            searching,
            m: &matches,
            memo: HashMap::new(),
            rows: Vec::new(),
        };
        w.walk(None, 0);
        let rows = w.rows;
        let total_rows = rows.len() as u32;
        let rows = rows.into_iter().skip(req.offset as usize).take(req.limit as usize).collect();
        let matched = if searching {
            self.samples.iter().filter(|s| matches(s)).count()
        } else {
            self.samples.len()
        };
        TreePage {
            rows,
            total_rows,
            matches: matched as u32,
        }
    }

    fn set_favorite(&mut self, ids: &[SampleId], fav: bool) {
        for id in ids {
            if let Some(&i) = self.by_id.get(id) {
                self.samples[i].fav = fav;
            }
        }
    }

    fn add_tag(&mut self, ids: &[SampleId], tag: &str) {
        for id in ids {
            let Some(&i) = self.by_id.get(id) else { continue };
            let s = &mut self.samples[i];
            if !s.tags.iter().any(|t| t == tag) {
                s.tags.push(tag.to_string());
                s.tags.sort();
                self.hay[i] = haystack(&self.samples[i]);
            }
        }
    }

    fn remove_tag(&mut self, ids: &[SampleId], tag: &str) {
        for id in ids {
            let Some(&i) = self.by_id.get(id) else { continue };
            self.samples[i].tags.retain(|t| t != tag);
            self.hay[i] = haystack(&self.samples[i]);
        }
    }

    // ----- collections (à plat)

    fn create_collection(&mut self, name: &str, query: Option<&str>) -> Collection {
        let id = self.collections.iter().map(|c| c.id).max().unwrap_or(0) + 1;
        let query = query.filter(|q| !q.is_empty()).map(String::from);
        let kind = if query.is_some() {
            CollectionKind::Smart
        } else {
            CollectionKind::Manual
        };
        if kind == CollectionKind::Manual {
            self.collection_items.insert(id, vec![]);
        }
        let c = Collection {
            id,
            name: name.into(),
            kind,
            pinned: false,
            query,
        };
        self.collections.push(c.clone());
        c
    }

    fn rename_collection(&mut self, id: u32, name: &str) {
        if let Some(c) = self.collections.iter_mut().find(|c| c.id == id) {
            c.name = name.into();
        }
    }

    fn delete_collection(&mut self, id: u32) {
        self.collections.retain(|c| c.id != id);
    }

    fn add_to_collection(&mut self, id: u32, ids: &[SampleId]) {
        if self.collection(id).map(|c| c.kind) != Some(CollectionKind::Manual) {
            return;
        }
        let items = self.collection_items.entry(id).or_default();
        for s in ids {
            if !items.contains(s) {
                items.push(*s);
            }
        }
    }

    fn remove_from_collection(&mut self, id: u32, ids: &[SampleId]) {
        if let Some(items) = self.collection_items.get_mut(&id) {
            items.retain(|s| !ids.contains(s));
        }
    }

    // ----- dossiers virtuels (arborescence)

    fn create_virtual_folder(&mut self, name: &str, parent_id: Option<u32>) -> VirtualFolder {
        let id = self.virtual_folders.iter().map(|f| f.id).max().unwrap_or(0) + 1;
        let parent_id = parent_id.filter(|p| self.virtual_folder(*p).is_some());
        let f = VirtualFolder {
            id,
            name: name.into(),
            parent_id,
            pinned: false,
        };
        self.virtual_folders.push(f.clone());
        self.virtual_items.insert(id, vec![]);
        f
    }

    fn rename_virtual_folder(&mut self, id: u32, name: &str) {
        if let Some(f) = self.virtual_folders.iter_mut().find(|f| f.id == id) {
            f.name = name.into();
        }
    }

    fn delete_virtual_folder(&mut self, id: u32) {
        let mut doomed = HashSet::from([id]);
        loop {
            let more: Vec<u32> = self
                .virtual_folders
                .iter()
                .filter(|f| f.parent_id.is_some_and(|p| doomed.contains(&p)) && !doomed.contains(&f.id))
                .map(|f| f.id)
                .collect();
            if more.is_empty() {
                break;
            }
            doomed.extend(more);
        }
        self.virtual_folders.retain(|f| !doomed.contains(&f.id));
    }

    fn move_virtual_folder(&mut self, id: u32, parent_id: Option<u32>) {
        if self.virtual_folder(id).is_none() {
            return;
        }
        if let Some(p) = parent_id {
            if self.virtual_folder(p).is_none() {
                return;
            }
            // Refusé vers soi-même ou un descendant.
            let mut cur = Some(p);
            while let Some(x) = cur {
                if x == id {
                    return;
                }
                cur = self.virtual_folder(x).and_then(|f| f.parent_id);
            }
        }
        if let Some(f) = self.virtual_folders.iter_mut().find(|f| f.id == id) {
            f.parent_id = parent_id;
        }
    }

    fn add_to_virtual_folder(&mut self, id: u32, ids: &[SampleId]) {
        if self.virtual_folder(id).is_none() {
            return;
        }
        let items = self.virtual_items.entry(id).or_default();
        for s in ids {
            if !items.contains(s) {
                items.push(*s);
            }
        }
    }

    fn remove_from_virtual_folder(&mut self, id: u32, ids: &[SampleId]) {
        if let Some(items) = self.virtual_items.get_mut(&id) {
            items.retain(|s| !ids.contains(s));
        }
    }

    fn set_pinned(&mut self, key: &str, pinned: bool) {
        if key.starts_with("f:") {
            // Raccourci : seulement pour un sous-dossier (une source est déjà à la racine).
            let id = node_id(key);
            let i = self.pinned_folders.iter().position(|&x| x == id);
            if pinned && i.is_none() && self.folder_parent.get(&id).copied().flatten().is_some() {
                self.pinned_folders.push(id);
            }
            if let (false, Some(i)) = (pinned, i) {
                self.pinned_folders.remove(i);
            }
        } else if key == "c:fav" {
            self.favorites_pinned = pinned;
        } else if key.starts_with("c:") {
            if let Some(c) = self.collections.iter_mut().find(|c| c.id == node_id(key)) {
                c.pinned = pinned;
            }
        } else if key.starts_with("v:") {
            if let Some(f) = self.virtual_folders.iter_mut().find(|f| f.id == node_id(key)) {
                f.pinned = pinned;
            }
        }
    }

    fn ancestors(&self, key: &str) -> Vec<NodeKey> {
        let mut chain = Vec::new();
        if key.starts_with("f:") {
            let mut p = self.folder_parent.get(&node_id(key)).copied().flatten();
            while let Some(id) = p {
                chain.push(format!("f:{id}"));
                p = self.folder_parent.get(&id).copied().flatten();
            }
        } else if key.starts_with("v:") {
            let mut p = self.virtual_folder(node_id(key)).and_then(|f| f.parent_id);
            while let Some(id) = p {
                chain.push(format!("v:{id}"));
                p = self.virtual_folder(id).and_then(|f| f.parent_id);
            }
        }
        chain.reverse();
        chain
    }

    // ----- « Créer un vrai dossier »

    fn plan_commit(&self, key: &str, options: CommitOptions) -> CommitPlan {
        let entries = self.commit_entries(key, options);
        let ok: Vec<&Entry> = entries.iter().filter(|(_, s)| !s.missing).collect();
        CommitPlan {
            files: ok.len() as u32,
            folders: self.commit_folders(key, options).len() as u32,
            bytes: ok.iter().map(|(_, s)| self.file_size(s)).sum(),
            missing: (entries.len() - ok.len()) as u32,
        }
    }

    fn commit_to_folder(&mut self, key: &str, destination: &str, options: CommitOptions) -> Result<CommitResult, String> {
        // Démo : aucun fichier n'est écrit. On simule le résultat et, si demandé, une nouvelle source qui
        // reflète l'arborescence copiée (la bibliothèque réelle copie vraiment, voir library.rs).
        let all = self.commit_entries(key, options);
        let entries: Vec<Entry> = all.iter().filter(|(_, s)| !s.missing).cloned().collect();
        let dest = destination.trim_end_matches('/').to_string();
        if options.add_as_source {
            let mut next_folder = self.folders.keys().copied().max().unwrap_or(0).max(999) + 1;
            let first_sample = self.samples.iter().map(|s| s.id).max().unwrap_or(0) + 1;
            let basename = dest.rsplit('/').next().unwrap_or(&dest).to_string();
            let root_id = next_folder;
            next_folder += 1;
            // Sous-dossiers en préordre : (chemin relatif, id).
            let rels: Vec<(Vec<String>, u32)> = self
                .commit_folders(key, options)
                .into_iter()
                .map(|r| {
                    let id = next_folder;
                    next_folder += 1;
                    (r, id)
                })
                .collect();
            fn build(id: u32, name: String, prefix: &[String], rels: &[(Vec<String>, u32)]) -> FolderNode {
                let children = rels
                    .iter()
                    .filter(|(r, _)| r.len() == prefix.len() + 1 && r.starts_with(prefix))
                    .map(|(r, cid)| build(*cid, r.last().cloned().unwrap_or_default(), r, rels))
                    .collect();
                FolderNode {
                    id,
                    name,
                    offline: false,
                    children,
                }
            }
            let root = build(root_id, basename, &[], &rels);
            let id_of = |rel: &[String]| {
                if rel.is_empty() {
                    root_id
                } else {
                    rels.iter().find(|(r, _)| r == rel).map(|(_, id)| *id).unwrap_or(root_id)
                }
            };
            for ((rel, s), id) in entries.iter().zip(first_sample..) {
                let mut copy = s.clone();
                copy.id = id;
                copy.folder_id = id_of(rel);
                let mut parts = vec![dest.clone()];
                parts.extend(rel.iter().cloned());
                parts.push(format!("{}.{}", s.name, s.ext));
                copy.path = parts.join("/");
                self.samples.push(copy);
            }
            self.root_paths.insert(root_id, dest.clone());
            index_folders(std::slice::from_ref(&root), None, &mut self.folders, &mut self.folder_parent);
            self.sources.push(root);
            self.reindex();
        }
        Ok(CommitResult {
            destination: dest,
            copied: entries.len() as u32,
            skipped: (all.len() - entries.len()) as u32,
        })
    }

    fn add_source(&mut self, path: &str) -> Result<Source, String> {
        // Démo : une source vide (aucun disque n'est lu).
        let id = self.folders.keys().copied().max().unwrap_or(0).max(999) + 1;
        let path = path.trim_end_matches('/').to_string();
        let name = Path::new(&path)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.clone());
        let root = FolderNode {
            id,
            name: name.clone(),
            offline: false,
            children: vec![],
        };
        self.folders.insert(id, root.clone());
        self.folder_parent.insert(id, None);
        self.sources.push(root);
        self.root_paths.insert(id, path.clone());
        Ok(Source {
            id,
            name,
            path,
            offline: false,
        })
    }

    fn refresh_source(&mut self, _id: u32) {}

    fn remove_source(&mut self, id: u32) {
        self.sources.retain(|f| f.id != id);
    }
}
