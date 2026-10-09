//! Modèle partagé avec l'UI. Miroir de `src/api/types.ts` : mêmes noms de champs (camelCase en JSON).
//! Les types TypeScript générés à partir d'ici (tauri-specta) sont vérifiés contre `types.ts`.

use serde::{Deserialize, Serialize};

pub type SampleId = u32;

/// Clé de nœud de l'arbre : "f:<id>" dossier, "g:collections" groupe, "c:fav" favoris, "c:<id>" collection.
pub type NodeKey = String;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum SampleKind {
    Oneshot,
    Loop,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Sample {
    pub id: SampleId,
    /// Sans extension.
    pub name: String,
    pub ext: String,
    pub path: String,
    pub folder_id: u32,
    pub duration_ms: u32,
    pub sample_rate: u32,
    pub bit_depth: u32,
    pub channels: u32,
    pub bpm: Option<f64>,
    pub key: Option<String>,
    pub kind: SampleKind,
    pub tags: Vec<String>,
    pub missing: bool,
    pub fav: bool,
    /// 256 valeurs 0..1, toujours finies. Déclaré `number[]` côté TypeScript (specta y verrait `number | null`,
    /// à cause de NaN, qui n'arrive jamais ici).
    #[cfg_attr(feature = "specta", specta(type = Vec<u32>))]
    pub peaks: Vec<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Tag {
    pub name: String,
    pub count: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum CollectionKind {
    Manual,
    Smart,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Collection {
    pub id: u32,
    pub name: String,
    pub kind: CollectionKind,
    /// Ligne de recherche brute d'une collection smart.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub query: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum NodeKind {
    Folder,
    Group,
    Favorites,
    Collection,
    Smart,
}

/// Discriminant littéral `"node"` d'une ligne de dossier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum NodeTag {
    #[default]
    #[serde(rename = "node")]
    Node,
}

/// Discriminant littéral `"sample"` d'une ligne de sample.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum SampleTag {
    #[default]
    #[serde(rename = "sample")]
    Sample,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct FolderRow {
    #[serde(rename = "type")]
    pub tag: NodeTag,
    pub key: NodeKey,
    pub parent: Option<NodeKey>,
    pub depth: u32,
    pub name: String,
    pub kind: NodeKind,
    pub open: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub offline: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct SampleRow {
    #[serde(rename = "type")]
    pub tag: SampleTag,
    /// "s:<id>@<parent>" : un sample peut apparaître dans un dossier et une collection.
    pub key: String,
    pub parent: NodeKey,
    pub depth: u32,
    pub sample: Sample,
}

/// Une ligne de l'arbre, discriminée par le champ `type` ("node" ou "sample") porté par chaque struct.
/// (`#[serde(untagged)]` + discriminant littéral : specta décrit mal `#[serde(tag)]` sur des variantes newtype.)
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(untagged)]
pub enum TreeRow {
    Node(FolderRow),
    Sample(SampleRow),
}

impl TreeRow {
    pub fn key(&self) -> &str {
        match self {
            TreeRow::Node(r) => &r.key,
            TreeRow::Sample(r) => &r.key,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct TreeRequest {
    /// Ligne de recherche brute. Non vide : arbre élagué aux nœuds qui contiennent des résultats, tous ouverts.
    pub query: String,
    pub expanded: Vec<NodeKey>,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct TreePage {
    pub rows: Vec<TreeRow>,
    pub total_rows: u32,
    pub matches: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Library {
    pub total: u32,
    pub tags: Vec<Tag>,
    pub collections: Vec<Collection>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Source {
    pub id: u32,
    pub name: String,
    pub path: String,
    pub offline: bool,
}

/// Ce que l'UI peut demander au cœur. Phase 1 : `MockLibrary` ; phase 2 : implémentation SQLite.
pub trait Backend {
    fn library(&self) -> Library;
    fn sources(&self) -> Vec<Source>;
    fn tree(&self, req: &TreeRequest) -> TreePage;
    fn set_favorite(&mut self, ids: &[SampleId], fav: bool);
    fn add_tag(&mut self, ids: &[SampleId], tag: &str);
    fn remove_tag(&mut self, ids: &[SampleId], tag: &str);
    /// Collection manuelle si `query` est absent ou vide, smart sinon.
    fn create_collection(&mut self, name: &str, query: Option<&str>) -> Collection;
    fn rename_collection(&mut self, id: u32, name: &str);
    fn delete_collection(&mut self, id: u32);
    fn add_to_collection(&mut self, id: u32, ids: &[SampleId]);
    fn remove_source(&mut self, id: u32);
}
