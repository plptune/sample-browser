//! Crate — cœur du navigateur de samples. Indépendant de Tauri : peut servir une autre UI.
//!
//! `catalog` : arbre, recherche et commit en mémoire. `mock` : les données du prototype (mode démo).
//! `db`, `scan`, `indexer`, `library` : la vraie bibliothèque (SQLite, scan des dossiers, notify).

pub mod analysis;
pub mod audio;
pub mod catalog;
pub mod db;
pub mod indexer;
pub mod library;
pub mod midi;
pub mod mock;
pub mod model;
pub mod natural;
pub mod query;
pub mod scan;
pub mod synonyms;

pub use catalog::Catalog;
pub use library::{CommitJob, SqliteLibrary};
pub use mock::MockLibrary;
pub use model::*;
