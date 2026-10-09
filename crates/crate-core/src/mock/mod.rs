//! Bibliothèque factice en mémoire (phase 1) : les données du prototype, servies par Rust.
//! Port fidèle de `src/api/mock.ts` ; remplacée en phase 2 par l'index SQLite.

pub mod data;

use std::collections::HashMap;

use crate::model::*;
use crate::natural;
use crate::query::{self, FilterKey, Token, TokenKind};
use data::FolderNode;

pub struct MockLibrary {
    samples: Vec<Sample>,
    sources: Vec<FolderNode>,
    /// Index de tous les dossiers (même ceux d'une source retirée, comme dans le prototype).
    folders: HashMap<u32, FolderNode>,
    collections: Vec<Collection>,
    items: HashMap<u32, Vec<SampleId>>,
}

struct NodeInfo {
    key: NodeKey,
    name: String,
    kind: NodeKind,
    offline: bool,
}

impl Default for MockLibrary {
    fn default() -> Self {
        Self::new()
    }
}

impl MockLibrary {
    pub fn new() -> Self {
        let samples = data::samples();
        let sources = data::sources();
        let mut folders = HashMap::new();
        fn index(nodes: &[FolderNode], out: &mut HashMap<u32, FolderNode>) {
            for n in nodes {
                out.insert(n.id, n.clone());
                index(&n.children, out);
            }
        }
        index(&sources, &mut folders);
        let items = data::collection_items(&samples).into_iter().collect();
        MockLibrary {
            samples,
            sources,
            folders,
            collections: data::collections(),
            items,
        }
    }

    pub fn samples(&self) -> &[Sample] {
        &self.samples
    }

    /// Réservé aux scénarios de démo : marque des fichiers comme introuvables.
    pub fn set_missing(&mut self, ids: &[SampleId]) {
        for s in &mut self.samples {
            s.missing = ids.contains(&s.id);
        }
    }

    // ---------- recherche ----------

    fn collection_samples(&self, id: u32) -> Vec<&Sample> {
        let Some(c) = self.collections.iter().find(|c| c.id == id) else {
            return vec![];
        };
        match c.kind {
            CollectionKind::Smart => {
                let q = c.query.clone().unwrap_or_default();
                self.samples.iter().filter(|s| self.match_line(s, &q)).collect()
            }
            CollectionKind::Manual => {
                let ids = self.items.get(&c.id).cloned().unwrap_or_default();
                self.samples.iter().filter(|s| ids.contains(&s.id)).collect()
            }
        }
    }

    fn match_token(&self, s: &Sample, t: &Token) -> bool {
        match &t.kind {
            TokenKind::Text | TokenKind::Phrase => {
                let hay = format!("{} {} {}", s.name, s.path, s.tags.join(" ")).to_lowercase();
                hay.contains(&t.value.to_lowercase())
            }
            TokenKind::Tag => s.tags.contains(&t.value),
            TokenKind::Filter(key) => match key {
                FilterKey::Bpm => s.bpm.is_some_and(|b| query::parse_range(&t.value, "")(b)),
                FilterKey::Dur => query::parse_range(&t.value, "s")(s.duration_ms as f64 / 1000.0),
                FilterKey::Key => {
                    let Some(have) = s.key.as_ref().map(|k| k.to_lowercase()) else {
                        return false;
                    };
                    let want = t.value.to_lowercase();
                    have == want || (!want.ends_with('m') && have.strip_suffix('m').unwrap_or(&have) == want)
                }
                FilterKey::Type => {
                    let want = if t.value == "one-shot" { "oneshot" } else { t.value.as_str() };
                    match s.kind {
                        SampleKind::Oneshot => want == "oneshot",
                        SampleKind::Loop => want == "loop",
                    }
                }
                FilterKey::Is => match t.value.as_str() {
                    "fav" => s.fav,
                    "untagged" => s.tags.is_empty(),
                    _ => false,
                },
                FilterKey::In => {
                    let v = t.value.to_lowercase();
                    match self.collections.iter().find(|c| c.name.to_lowercase().starts_with(&v)) {
                        Some(c) => self.collection_samples(c.id).iter().any(|x| x.id == s.id),
                        None => s.path.to_lowercase().contains(&v),
                    }
                }
            },
        }
    }

    fn match_line(&self, s: &Sample, line: &str) -> bool {
        query::parse_line(line).iter().all(|t| self.match_token(s, t) != t.negated)
    }

    // ---------- arbre ----------

    fn child_nodes(&self, key: Option<&str>) -> Vec<NodeInfo> {
        let folder_info = |f: &FolderNode| NodeInfo {
            key: format!("f:{}", f.id),
            name: f.name.clone(),
            kind: NodeKind::Folder,
            offline: f.offline,
        };
        match key {
            None => {
                let mut v: Vec<NodeInfo> = self.sources.iter().map(folder_info).collect();
                v.push(NodeInfo {
                    key: "g:collections".into(),
                    name: "Collections".into(),
                    kind: NodeKind::Group,
                    offline: false,
                });
                v
            }
            Some("g:collections") => {
                let mut v = vec![NodeInfo {
                    key: "c:fav".into(),
                    name: "Favoris".into(),
                    kind: NodeKind::Favorites,
                    offline: false,
                }];
                v.extend(self.collections.iter().map(|c| NodeInfo {
                    key: format!("c:{}", c.id),
                    name: c.name.clone(),
                    kind: if c.kind == CollectionKind::Smart {
                        NodeKind::Smart
                    } else {
                        NodeKind::Collection
                    },
                    offline: false,
                }));
                v
            }
            Some(k) if k.starts_with("f:") => {
                let id: u32 = k[2..].parse().unwrap_or(0);
                self.folders
                    .get(&id)
                    .map(|f| f.children.iter().map(folder_info).collect())
                    .unwrap_or_default()
            }
            _ => vec![],
        }
    }

    fn child_samples(&self, key: &str) -> Vec<&Sample> {
        let mut v: Vec<&Sample> = if let Some(id) = key.strip_prefix("f:") {
            let id: u32 = id.parse().unwrap_or(0);
            self.samples.iter().filter(|s| s.folder_id == id).collect()
        } else if key == "c:fav" {
            self.samples.iter().filter(|s| s.fav).collect()
        } else if let Some(id) = key.strip_prefix("c:") {
            self.collection_samples(id.parse().unwrap_or(0))
        } else {
            vec![]
        };
        v.sort_by(|a, b| natural::compare(&a.name, &b.name));
        v
    }
}

impl Backend for MockLibrary {
    fn library(&self) -> Library {
        // Tags connus + tags créés à la volée, ordre d'apparition, puis par fréquence (tri stable).
        let mut names: Vec<String> = data::TAGS.iter().map(|t| t.to_string()).collect();
        for s in &self.samples {
            for t in &s.tags {
                if !names.contains(t) {
                    names.push(t.clone());
                }
            }
        }
        let mut tags: Vec<Tag> = names
            .into_iter()
            .map(|name| {
                let count = self.samples.iter().filter(|s| s.tags.contains(&name)).count() as u32;
                Tag { name, count }
            })
            .collect();
        tags.sort_by_key(|t| std::cmp::Reverse(t.count)); // tri stable : ex-aequo dans l'ordre d'apparition
        Library {
            total: self.samples.len() as u32,
            tags,
            collections: self.collections.clone(),
        }
    }

    fn sources(&self) -> Vec<Source> {
        self.sources
            .iter()
            .map(|f| Source {
                id: f.id,
                name: f.name.clone(),
                path: data::root_path(f.id).into(),
                offline: f.offline,
            })
            .collect()
    }

    fn tree(&self, req: &TreeRequest) -> TreePage {
        let q = req.query.trim();
        let searching = !q.is_empty();
        let matches = |s: &Sample| !searching || self.match_line(s, q);

        // Un nœud reste visible en recherche s'il contient au moins un résultat (mémoïsé).
        let mut memo: HashMap<String, bool> = HashMap::new();
        fn has_match(lib: &MockLibrary, key: &str, m: &dyn Fn(&Sample) -> bool, memo: &mut HashMap<String, bool>) -> bool {
            if let Some(&v) = memo.get(key) {
                return v;
            }
            let v = lib.child_samples(key).into_iter().any(m) || lib.child_nodes(Some(key)).iter().any(|n| has_match(lib, &n.key, m, memo));
            memo.insert(key.to_string(), v);
            v
        }

        let mut rows = Vec::new();
        #[allow(clippy::too_many_arguments)]
        fn walk(
            lib: &MockLibrary,
            key: Option<&str>,
            depth: u32,
            req: &TreeRequest,
            searching: bool,
            m: &dyn Fn(&Sample) -> bool,
            memo: &mut HashMap<String, bool>,
            rows: &mut Vec<TreeRow>,
        ) {
            for n in lib.child_nodes(key) {
                // En recherche : collections masquées (doublons) et dossiers sans résultat masqués.
                if searching && (n.kind == NodeKind::Group || !has_match(lib, &n.key, m, memo)) {
                    continue;
                }
                let open = searching || req.expanded.contains(&n.key);
                rows.push(TreeRow::Node(FolderRow {
                    tag: NodeTag::Node,
                    key: n.key.clone(),
                    parent: key.map(String::from),
                    depth,
                    name: n.name.clone(),
                    kind: n.kind,
                    open,
                    offline: n.offline.then_some(true),
                }));
                if open {
                    walk(lib, Some(&n.key), depth + 1, req, searching, m, memo, rows);
                }
            }
            let Some(k) = key else { return };
            for s in lib.child_samples(k) {
                if !m(s) {
                    continue;
                }
                rows.push(TreeRow::Sample(SampleRow {
                    tag: SampleTag::Sample,
                    key: format!("s:{}@{k}", s.id),
                    parent: k.to_string(),
                    depth,
                    sample: s.clone(),
                }));
            }
        }
        walk(self, None, 0, req, searching, &matches, &mut memo, &mut rows);

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
        for s in self.samples.iter_mut().filter(|s| ids.contains(&s.id)) {
            s.fav = fav;
        }
    }

    fn add_tag(&mut self, ids: &[SampleId], tag: &str) {
        for s in self.samples.iter_mut().filter(|s| ids.contains(&s.id)) {
            if !s.tags.iter().any(|t| t == tag) {
                s.tags.push(tag.to_string());
                s.tags.sort();
            }
        }
    }

    fn remove_tag(&mut self, ids: &[SampleId], tag: &str) {
        for s in self.samples.iter_mut().filter(|s| ids.contains(&s.id)) {
            s.tags.retain(|t| t != tag);
        }
    }

    fn create_collection(&mut self, name: &str, query: Option<&str>) -> Collection {
        let id = self.collections.iter().map(|c| c.id).max().unwrap_or(0) + 1;
        let query = query.filter(|q| !q.is_empty()).map(String::from);
        let c = Collection {
            id,
            name: name.into(),
            kind: if query.is_some() {
                CollectionKind::Smart
            } else {
                CollectionKind::Manual
            },
            query,
        };
        if c.kind == CollectionKind::Manual {
            self.items.insert(id, vec![]);
        }
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
        let items = self.items.entry(id).or_default();
        for s in ids {
            if !items.contains(s) {
                items.push(*s);
            }
        }
    }

    fn remove_source(&mut self, id: u32) {
        self.sources.retain(|f| f.id != id);
    }
}
