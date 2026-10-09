//! Catalogue en mémoire : toute la logique de l'arbre, de la recherche et du « Créer un vrai dossier ».
//! Rempli par les données du prototype (`Catalog::demo()`, vérifié par tests/parity.rs) ou chargé depuis
//! SQLite (`db::load_catalog`), puis indexé pour rester rapide à 100 000 fichiers.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::time::Instant;

use rayon::prelude::*;

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
    /// Groupes de synonymes (minuscules) appliqués aux mots libres.
    pub(crate) synonyms: Vec<Vec<String>>,
    /// Taille réelle des fichiers (vide en démo : taille estimée d'après la durée).
    pub(crate) file_sizes: HashMap<SampleId, u64>,
    // --- index (reindex)
    by_id: HashMap<SampleId, usize>,
    by_folder: HashMap<u32, Vec<usize>>,
    /// Texte de recherche en minuscules : nom, chemin, tags.
    hay: Vec<String>,
    cache: RefCell<Option<TreeCache>>,
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
    /// Mot libre et ses synonymes : un seul suffit.
    AnyText(Vec<String>),
    Tag(String),
    Bpm(Box<dyn Fn(f64) -> bool + Send + Sync>),
    Dur(Box<dyn Fn(f64) -> bool + Send + Sync>),
    Key(String),
    Kind(SampleKind),
    Fav,
    Untagged,
    Never,
    /// Appartenance (`in:` collection ou dossier virtuel), par index de sample.
    In(Vec<bool>),
    InPath(String),
}

/// Ligne de recherche compilée (`in:` résolu, texte en minuscules).
pub(crate) struct Matcher(Vec<(Cond, bool)>);

impl Matcher {
    /// Sans `&Catalog` (qui n'est pas partageable entre threads) : pour la recherche en parallèle.
    fn matches_parts(&self, s: &Sample, hay: &str, i: usize) -> bool {
        self.0.iter().all(|(c, negated)| cond(c, s, hay, i) != *negated)
    }
}

/// Une ligne de l'arbre avant matérialisation : seule la page demandée devient des `TreeRow`.
enum RowRef {
    Node {
        /// En boîte : la ligne reste petite (les samples, bien plus nombreux, n'ont qu'un index).
        info: Box<NodeInfo>,
        parent: Option<u32>,
        depth: u32,
        open: bool,
    },
    Sample {
        idx: usize,
        parent: u32,
        depth: u32,
    },
}

/// Dernier arbre calculé : défiler (autre page, même requête) ne refait pas la marche.
pub(crate) struct TreeCache {
    root: TreeRoot,
    query: String,
    expanded: Vec<NodeKey>,
    /// Clés des nœuds ouverts ; les lignes y renvoient par index (parent).
    keys: Vec<NodeKey>,
    rows: Vec<RowRef>,
    matches: u32,
}

fn cond(c: &Cond, s: &Sample, hay: &str, i: usize) -> bool {
    match c {
        Cond::Text(v) => hay.contains(v.as_str()),
        Cond::AnyText(words) => words.iter().any(|w| hay.contains(w.as_str())),
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
        Cond::In(member) => member[i],
        Cond::InPath(v) => s.path.to_lowercase().contains(v.as_str()),
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
        self.touch();
        self.by_id = self.samples.iter().enumerate().map(|(i, s)| (s.id, i)).collect();
        let mut by_folder: HashMap<u32, Vec<usize>> = HashMap::new();
        for (i, s) in self.samples.iter().enumerate() {
            by_folder.entry(s.folder_id).or_default().push(i);
        }
        // Triés une fois pour toutes : ouvrir un dossier ne trie plus rien.
        for v in by_folder.values_mut() {
            self.sort_idx(v);
        }
        self.by_folder = by_folder;
        self.hay = self.samples.iter().map(haystack).collect();
    }

    /// Oublie l'arbre en cache (à appeler à chaque modification).
    pub(crate) fn touch(&mut self) {
        *self.cache.get_mut() = None;
    }

    /// Tri naturel stable par nom (à égalité : ordre des ids, comme un filtre sur la liste complète).
    fn sort_idx(&self, v: &mut [usize]) {
        v.sort_by(|&a, &b| natural::compare(&self.samples[a].name, &self.samples[b].name));
    }

    /// Index de ces ids, dans l'ordre des ids (comme un filtre sur la liste complète).
    fn idx_of(&self, ids: &[SampleId]) -> Vec<usize> {
        let mut idx: Vec<usize> = ids.iter().filter_map(|id| self.by_id.get(id).copied()).collect();
        idx.sort_unstable();
        idx.dedup();
        idx
    }

    fn refs(&self, idx: Vec<usize>) -> Vec<&Sample> {
        idx.into_iter().map(|i| &self.samples[i]).collect()
    }

    /// Réservé aux scénarios de démo : marque des fichiers comme introuvables.
    pub fn set_missing(&mut self, ids: &[SampleId]) {
        self.touch();
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

    fn collection_idx(&self, id: u32) -> Vec<usize> {
        let Some(c) = self.collection(id) else { return vec![] };
        match c.kind {
            CollectionKind::Smart => {
                let m = self.compile(c.query.as_deref().unwrap_or_default());
                self.hits(&m).into_iter().enumerate().filter_map(|(i, h)| h.then_some(i)).collect()
            }
            CollectionKind::Manual => self.idx_of(self.collection_items.get(&c.id).map(Vec::as_slice).unwrap_or_default()),
        }
    }

    /// Samples propres à un dossier virtuel (pas ceux de ses sous-dossiers).
    fn own_idx(&self, id: u32) -> Vec<usize> {
        self.idx_of(self.virtual_items.get(&id).map(Vec::as_slice).unwrap_or_default())
    }

    fn own_samples(&self, id: u32) -> Vec<&Sample> {
        self.refs(self.own_idx(id))
    }

    /// Samples d'un dossier virtuel et de tous ses descendants (pour `in:` et le commit à plat).
    fn subtree_idx(&self, id: u32) -> Vec<usize> {
        let mut seen = HashSet::new();
        let mut out = Vec::new();
        fn visit(lib: &Catalog, fid: u32, seen: &mut HashSet<usize>, out: &mut Vec<usize>) {
            for i in lib.own_idx(fid) {
                if seen.insert(i) {
                    out.push(i);
                }
            }
            for c in lib.vf_children(Some(fid)) {
                visit(lib, c.id, seen, out);
            }
        }
        visit(self, id, &mut seen, &mut out);
        out
    }

    fn subtree_samples(&self, id: u32) -> Vec<&Sample> {
        self.refs(self.subtree_idx(id))
    }

    fn membership(&self, idx: Vec<usize>) -> Vec<bool> {
        let mut v = vec![false; self.samples.len()];
        for i in idx {
            v[i] = true;
        }
        v
    }

    // ---------- recherche ----------

    pub(crate) fn compile(&self, line: &str) -> Matcher {
        let conds = query::parse_line(line)
            .into_iter()
            .map(|t| {
                let cond = match &t.kind {
                    TokenKind::Text => match crate::synonyms::expand(&self.synonyms, &t.value) {
                        Some(words) => Cond::AnyText(words),
                        None => Cond::Text(t.value.to_lowercase()),
                    },
                    TokenKind::Phrase => Cond::Text(t.value.to_lowercase()),
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
                                Cond::In(self.membership(self.collection_idx(c.id)))
                            } else if let Some(f) = self.virtual_folders.iter().find(|f| f.name.to_lowercase().starts_with(&v)) {
                                Cond::In(self.membership(self.subtree_idx(f.id)))
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

    /// Résultat de la recherche pour chaque sample, calculé en parallèle (100 000 fichiers : quelques ms).
    fn hits(&self, m: &Matcher) -> Vec<bool> {
        let (samples, hay) = (&self.samples, &self.hay);
        (0..samples.len())
            .into_par_iter()
            .with_min_len(4096)
            .map(|i| m.matches_parts(&samples[i], &hay[i], i))
            .collect()
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

    /// Samples directement sous un nœud (index), triés par nom si demandé.
    fn child_idx(&self, key: &str, sorted: bool) -> Vec<usize> {
        if key.starts_with("f:") {
            // Déjà triés (reindex).
            return self.by_folder.get(&node_id(key)).cloned().unwrap_or_default();
        }
        let mut v: Vec<usize> = if key == "c:fav" {
            (0..self.samples.len()).filter(|&i| self.samples[i].fav).collect()
        } else if key.starts_with("c:") {
            self.collection_idx(node_id(key))
        } else if key.starts_with("v:") {
            self.own_idx(node_id(key))
        } else {
            vec![]
        };
        if sorted {
            self.sort_idx(&mut v);
        }
        v
    }

    pub(crate) fn child_samples(&self, key: &str) -> Vec<&Sample> {
        self.refs(self.child_idx(key, true))
    }

    /// Au moins un sample directement sous ce nœud est un résultat.
    fn any_hit(&self, key: &str, hits: &[bool]) -> bool {
        if key.starts_with("f:") {
            return self.by_folder.get(&node_id(key)).is_some_and(|v| v.iter().any(|&i| hits[i]));
        }
        self.child_idx(key, false).into_iter().any(|i| hits[i])
    }

    /// Marche complète de l'arbre (lignes légères) : sans recherche, les nœuds ouverts ; avec, les nœuds qui
    /// contiennent au moins un résultat, tous ouverts.
    fn build_tree(&self, root: TreeRoot, q: &str, expanded: &[NodeKey]) -> TreeCache {
        let searching = !q.is_empty();
        let hits: Option<Vec<bool>> = searching.then(|| {
            let m = self.compile(q);
            self.hits(&m)
        });
        let matches = hits.as_ref().map_or(self.samples.len(), |h| h.iter().filter(|&&b| b).count());

        struct Walk<'a> {
            lib: &'a Catalog,
            root: TreeRoot,
            hits: Option<&'a [bool]>,
            expanded: HashSet<&'a str>,
            memo: HashMap<String, bool>,
            keys: Vec<NodeKey>,
            rows: Vec<RowRef>,
        }
        impl Walk<'_> {
            /// Un nœud reste visible en recherche s'il contient au moins un résultat (mémoïsé).
            fn has_match(&mut self, key: &str, hits: &[bool]) -> bool {
                if let Some(&v) = self.memo.get(key) {
                    return v;
                }
                let v = self.lib.any_hit(key, hits)
                    || self
                        .lib
                        .child_nodes(self.root, Some(key), true)
                        .iter()
                        .any(|n| self.has_match(&n.key, hits));
                self.memo.insert(key.to_string(), v);
                v
            }

            fn walk(&mut self, key: Option<&str>, slot: Option<u32>, depth: u32) {
                let searching = self.hits.is_some();
                for n in self.lib.child_nodes(self.root, key, searching) {
                    if let Some(h) = self.hits {
                        if !self.has_match(&n.key, h) {
                            continue;
                        }
                    }
                    // Un raccourci ne se déplie jamais : il saute au dossier visé.
                    let open = n.kind != NodeKind::Shortcut && (searching || self.expanded.contains(n.key.as_str()));
                    let child_key = n.key.clone();
                    self.rows.push(RowRef::Node {
                        info: Box::new(n),
                        parent: slot,
                        depth,
                        open,
                    });
                    if open {
                        self.keys.push(child_key.clone());
                        let s = (self.keys.len() - 1) as u32;
                        self.walk(Some(&child_key), Some(s), depth + 1);
                    }
                }
                let (Some(k), Some(slot)) = (key, slot) else { return };
                let owned;
                let idx: &[usize] = match k.strip_prefix("f:") {
                    // Dossier : liste déjà triée, sans copie.
                    Some(id) => self
                        .lib
                        .by_folder
                        .get(&id.parse().unwrap_or(0))
                        .map(Vec::as_slice)
                        .unwrap_or_default(),
                    None => {
                        owned = self.lib.child_idx(k, true);
                        &owned
                    }
                };
                let hits = self.hits;
                self.rows
                    .extend(idx.iter().filter(|&&i| hits.is_none_or(|h| h[i])).map(|&i| RowRef::Sample {
                        idx: i,
                        parent: slot,
                        depth,
                    }));
            }
        }

        let mut w = Walk {
            lib: self,
            root,
            hits: hits.as_deref(),
            expanded: expanded.iter().map(String::as_str).collect(),
            memo: HashMap::new(),
            keys: Vec::new(),
            rows: Vec::with_capacity(if searching { matches + 64 } else { 256 }),
        };
        w.walk(None, None, 0);
        TreeCache {
            root,
            query: q.to_string(),
            expanded: expanded.to_vec(),
            keys: w.keys,
            rows: w.rows,
            matches: matches as u32,
        }
    }

    /// Copie d'un sample pour l'UI ; les pics ne voyagent que si on les demande (densité « waveform »).
    fn sample_out(s: &Sample, peaks: bool) -> Sample {
        Sample {
            id: s.id,
            name: s.name.clone(),
            ext: s.ext.clone(),
            path: s.path.clone(),
            folder_id: s.folder_id,
            duration_ms: s.duration_ms,
            sample_rate: s.sample_rate,
            bit_depth: s.bit_depth,
            channels: s.channels,
            bpm: s.bpm,
            key: s.key.clone(),
            kind: s.kind,
            tags: s.tags.clone(),
            missing: s.missing,
            fav: s.fav,
            peaks: if peaks { s.peaks.clone() } else { vec![] },
        }
    }

    fn materialize(&self, c: &TreeCache, r: &RowRef, peaks: bool) -> TreeRow {
        match r {
            RowRef::Node { info, parent, depth, open } => TreeRow::Node(FolderRow {
                tag: NodeTag::Node,
                key: info.key.clone(),
                parent: parent.map(|p| c.keys[p as usize].clone()),
                depth: *depth,
                name: info.name.clone(),
                kind: info.kind,
                open: *open,
                offline: info.offline.then_some(true),
                pinned: info.pinned.then_some(true),
                target: info.target.clone(),
            }),
            RowRef::Sample { idx, parent, depth } => {
                let s = &self.samples[*idx];
                let parent = &c.keys[*parent as usize];
                TreeRow::Sample(SampleRow {
                    tag: SampleTag::Sample,
                    key: format!("s:{}@{parent}", s.id),
                    parent: parent.clone(),
                    depth: *depth,
                    sample: Self::sample_out(s, peaks),
                })
            }
        }
    }

    /// Position d'une ligne (nœud ou "s:<id>@<parent>") dans l'arbre complet.
    fn find_row(&self, c: &TreeCache, key: &str) -> Option<usize> {
        if let Some(rest) = key.strip_prefix("s:") {
            let (id, parent) = rest.split_once('@')?;
            let id: SampleId = id.parse().ok()?;
            return c.rows.iter().position(|r| match r {
                RowRef::Sample { idx, parent: p, .. } => self.samples[*idx].id == id && c.keys[*p as usize] == parent,
                _ => false,
            });
        }
        c.rows
            .iter()
            .position(|r| matches!(r, RowRef::Node { info, .. } if info.key == key))
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

    /// Chemin et durée d'un sample présent sur le disque (lecture).
    pub fn sample_file(&self, id: SampleId) -> Option<(std::path::PathBuf, u32)> {
        let s = &self.samples[*self.by_id.get(&id)?];
        (!s.missing).then(|| (s.path.clone().into(), s.duration_ms))
    }

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
        let t0 = Instant::now();
        let q = req.query.trim();
        let fresh = matches!(&*self.cache.borrow(), Some(c) if c.root == req.root && c.query == q && c.expanded == req.expanded);
        if !fresh {
            let built = self.build_tree(req.root, q, &req.expanded);
            *self.cache.borrow_mut() = Some(built);
        }
        let cache = self.cache.borrow();
        let c = cache.as_ref().expect("arbre calculé");
        let total = c.rows.len();
        let start = (req.offset as usize).min(total);
        let end = start.saturating_add(req.limit as usize).min(total);
        let rows = c.rows[start..end].iter().map(|r| self.materialize(c, r, req.peaks)).collect();
        let focus_index = req.focus.as_deref().and_then(|k| self.find_row(c, k)).map(|i| i as u32);
        TreePage {
            rows,
            total_rows: total as u32,
            matches: c.matches,
            focus_index,
            micros: t0.elapsed().as_micros().min(u32::MAX as u128) as u32,
        }
    }

    fn set_favorite(&mut self, ids: &[SampleId], fav: bool) {
        self.touch();
        for id in ids {
            if let Some(&i) = self.by_id.get(id) {
                self.samples[i].fav = fav;
            }
        }
    }

    fn add_tag(&mut self, ids: &[SampleId], tag: &str) {
        self.touch();
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
        self.touch();
        for id in ids {
            let Some(&i) = self.by_id.get(id) else { continue };
            self.samples[i].tags.retain(|t| t != tag);
            self.hay[i] = haystack(&self.samples[i]);
        }
    }

    // ----- collections (à plat)

    fn create_collection(&mut self, name: &str, query: Option<&str>) -> Collection {
        self.touch();
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
        self.touch();
        if let Some(c) = self.collections.iter_mut().find(|c| c.id == id) {
            c.name = name.into();
        }
    }

    fn delete_collection(&mut self, id: u32) {
        self.touch();
        self.collections.retain(|c| c.id != id);
    }

    fn add_to_collection(&mut self, id: u32, ids: &[SampleId]) {
        self.touch();
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
        self.touch();
        if let Some(items) = self.collection_items.get_mut(&id) {
            items.retain(|s| !ids.contains(s));
        }
    }

    // ----- dossiers virtuels (arborescence)

    fn create_virtual_folder(&mut self, name: &str, parent_id: Option<u32>) -> VirtualFolder {
        self.touch();
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
        self.touch();
        if let Some(f) = self.virtual_folders.iter_mut().find(|f| f.id == id) {
            f.name = name.into();
        }
    }

    fn delete_virtual_folder(&mut self, id: u32) {
        self.touch();
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
        self.touch();
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
        self.touch();
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
        self.touch();
        if let Some(items) = self.virtual_items.get_mut(&id) {
            items.retain(|s| !ids.contains(s));
        }
    }

    fn set_pinned(&mut self, key: &str, pinned: bool) {
        self.touch();
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

    fn peaks(&self, id: SampleId) -> Vec<f64> {
        self.by_id.get(&id).map(|&i| self.samples[i].peaks.clone()).unwrap_or_default()
    }

    fn synonyms(&self) -> Vec<Vec<String>> {
        self.synonyms.clone()
    }

    fn set_synonyms(&mut self, groups: &[Vec<String>]) {
        self.touch();
        self.synonyms = crate::synonyms::normalize(groups);
    }

    fn node_path(&self, key: &str) -> Option<String> {
        if !(key.starts_with("f:") || key.starts_with("p:")) {
            return None;
        }
        let mut id = node_id(key);
        let mut parts = vec![];
        loop {
            match self.folder_parent.get(&id)? {
                Some(parent) => {
                    parts.push(self.folders.get(&id)?.name.clone());
                    id = *parent;
                }
                None => {
                    parts.push(self.root_paths.get(&id)?.clone());
                    break;
                }
            }
        }
        parts.reverse();
        Some(parts.join("/"))
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
        self.touch();
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
        self.touch();
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
        self.touch();
        self.sources.retain(|f| f.id != id);
    }
}
