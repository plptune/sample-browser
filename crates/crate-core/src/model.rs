//! Modèle partagé avec l'UI. Miroir de `src/api/types.ts` : mêmes noms de champs (camelCase en JSON).
//! Les types TypeScript générés à partir d'ici (tauri-specta) sont vérifiés contre `types.ts`.

use serde::{Deserialize, Serialize};

pub type SampleId = u32;

/// Clé de nœud de l'arbre : "f:<id>" dossier source, "p:<id>" raccourci vers un dossier source, "c:fav" favoris,
/// "g:collections" groupe, "c:<id>" collection, "v:<id>" dossier virtuel.
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
    /// Masqué par l'utilisateur (lui-même, pas via son dossier) : invisible sauf avec `is:hidden`.
    pub hidden: bool,
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

/// Collection : simple regroupement de samples, à plat. Smart = recherche enregistrée.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Collection {
    pub id: u32,
    pub name: String,
    pub kind: CollectionKind,
    /// Aussi affichée à la racine de l'onglet Bibliothèque.
    pub pinned: bool,
    /// Ligne de recherche brute d'une collection smart.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub query: Option<String>,
}

/// Dossier virtuel : arborescence de samples sans déplacer les fichiers.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct VirtualFolder {
    pub id: u32,
    pub name: String,
    /// `None` = racine de l'onglet Virtuels.
    pub parent_id: Option<u32>,
    pub pinned: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum NodeKind {
    Folder,
    Shortcut,
    Favorites,
    Group,
    Collection,
    Smart,
    Virtual,
}

/// Onglet : sources (+ éléments épinglés) ou favoris / collections / dossiers virtuels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum TreeRoot {
    #[default]
    Library,
    Virtual,
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
    /// Collection ou dossier virtuel épinglé (repère dans l'onglet Bibliothèque).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub pinned: Option<bool>,
    /// Dossier masqué (invisible sauf avec `is:hidden`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub hidden: Option<bool>,
    /// Raccourci : le dossier source visé ("f:<id>"). Un raccourci ne se déplie pas, il y saute.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub target: Option<NodeKey>,
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

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct TreeRequest {
    pub root: TreeRoot,
    /// Ligne de recherche brute. Non vide : arbre élagué aux nœuds qui contiennent des résultats, tous ouverts.
    pub query: String,
    pub expanded: Vec<NodeKey>,
    pub offset: u32,
    pub limit: u32,
    /// Pics de waveform dans les lignes (densité « waveform » seulement). Sinon `peaks` est vide.
    #[serde(default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub peaks: bool,
    /// Ligne dont on veut la position (`TreePage.focusIndex`) : pour y faire défiler l'arbre.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub focus: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct TreePage {
    pub rows: Vec<TreeRow>,
    pub total_rows: u32,
    pub matches: u32,
    /// Position de `TreeRequest.focus` dans l'arbre complet, s'il y est.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub focus_index: Option<u32>,
    /// Temps de calcul côté Rust (overlay de mesures).
    pub micros: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Library {
    pub total: u32,
    pub tags: Vec<Tag>,
    pub collections: Vec<Collection>,
    pub virtual_folders: Vec<VirtualFolder>,
    pub favorites_pinned: bool,
    /// Sous-dossiers sources épinglés comme raccourcis dans Bibliothèque.
    pub pinned_folders: Vec<u32>,
    /// Samples masqués (eux-mêmes ou par leur dossier).
    pub hidden: u32,
}

/// Ce que « Créer un vrai dossier » copierait.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct CommitPlan {
    pub files: u32,
    /// Sous-dossiers créés (0 si l'arborescence est aplatie).
    pub folders: u32,
    /// En octets (f64 : un u64 n'a pas d'équivalent sûr en JavaScript). Toujours fini : déclaré `number`
    /// côté TypeScript (specta y verrait `number | null`).
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub bytes: f64,
    /// Fichiers introuvables, ignorés.
    pub missing: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct CommitOptions {
    pub keep_hierarchy: bool,
    pub add_as_source: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct CommitResult {
    pub destination: String,
    pub copied: u32,
    pub skipped: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Source {
    pub id: u32,
    pub name: String,
    pub path: String,
    pub offline: bool,
}

/// Statut d'indexation, envoyé par événement pendant un scan.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ScanStatus {
    pub source_id: u32,
    /// Dossier en cours (nom affiché).
    pub folder: String,
    /// Fichiers lus / à lire (0 / 0 pendant le parcours des dossiers).
    pub done: u32,
    pub total: u32,
    pub finished: bool,
}

/// Analyse de fond (tempo, tonalité, boucle / one-shot) : fichiers analysés / à analyser depuis le dernier
/// départ. `done == total` : rien en attente.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct AnalysisStatus {
    pub done: u32,
    pub total: u32,
}

/// État de la lecture, envoyé par événement (~30 par seconde pendant la lecture, puis un dernier à l'arrêt).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct PlaybackStatus {
    pub id: SampleId,
    pub position_ms: u32,
    pub duration_ms: u32,
    pub playing: bool,
    pub looping: bool,
    /// Délai entre la demande et le premier son (une fois par lecture), en ms.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub latency_ms: Option<f32>,
    /// Fichier illisible.
    pub error: bool,
}

/// Avancement de « Créer un vrai dossier » (fichiers copiés / à copier).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct CommitProgress {
    pub done: u32,
    pub total: u32,
}

/// Réglages de lecture.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct PlaybackOptions {
    /// 0..1
    pub volume: f32,
    pub looping: bool,
}

/// Ce que l'UI peut demander au cœur : `Catalog` (données du prototype) ou `SqliteLibrary` (vraie bibliothèque).
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
    fn remove_from_collection(&mut self, id: u32, ids: &[SampleId]);
    fn create_virtual_folder(&mut self, name: &str, parent_id: Option<u32>) -> VirtualFolder;
    fn rename_virtual_folder(&mut self, id: u32, name: &str);
    /// Supprime aussi les sous-dossiers ; les fichiers ne sont jamais touchés.
    fn delete_virtual_folder(&mut self, id: u32);
    /// Refusé vers soi-même ou un descendant.
    fn move_virtual_folder(&mut self, id: u32, parent_id: Option<u32>);
    fn add_to_virtual_folder(&mut self, id: u32, ids: &[SampleId]);
    fn remove_from_virtual_folder(&mut self, id: u32, ids: &[SampleId]);
    /// "c:fav", "c:<id>", "v:<id>" ou un sous-dossier source "f:<id>" (raccourci).
    fn set_pinned(&mut self, key: &str, pinned: bool);
    /// Clés des parents d'un nœud, de la racine au parent direct (pour y sauter en ouvrant l'arbre).
    fn ancestors(&self, key: &str) -> Vec<NodeKey>;
    /// Masque (ou ré-affiche) des samples. Rien n'est touché sur le disque.
    fn set_hidden(&mut self, ids: &[SampleId], hidden: bool);
    /// Masque (ou ré-affiche) un dossier source et tout ce qu'il contient.
    fn set_folder_hidden(&mut self, id: u32, hidden: bool);
    /// Pics de waveform d'un sample (256 valeurs 0..1, vide tant qu'ils ne sont pas calculés).
    fn peaks(&self, id: SampleId) -> Vec<f64>;
    /// Avancement de l'analyse de fond (rien en attente par défaut : données factices).
    fn analysis_status(&self) -> AnalysisStatus {
        AnalysisStatus::default()
    }
    /// Groupes de synonymes appliqués aux mots libres de la recherche.
    fn synonyms(&self) -> Vec<Vec<String>>;
    fn set_synonyms(&mut self, groups: &[Vec<String>]);
    /// Chemin sur le disque d'un dossier source ("f:<id>") ou d'un raccourci ("p:<id>") ; `None` sinon.
    fn node_path(&self, key: &str) -> Option<String>;
    fn plan_commit(&self, key: &str, options: CommitOptions) -> CommitPlan;
    /// Copie vers un nouveau dossier réel ; ne modifie ni ne déplace jamais les sources.
    fn commit_to_folder(&mut self, key: &str, destination: &str, options: CommitOptions) -> Result<CommitResult, String>;
    /// Ajoute un dossier comme source et lance son indexation (refusé s'il est déjà couvert par une source).
    fn add_source(&mut self, path: &str) -> Result<Source, String>;
    /// Relance l'indexation d'une source (rescan incrémental).
    fn refresh_source(&mut self, id: u32);
    fn remove_source(&mut self, id: u32);
}
