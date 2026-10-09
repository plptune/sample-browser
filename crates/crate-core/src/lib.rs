//! Crate — cœur du navigateur de samples. Indépendant de Tauri : peut servir une autre UI.
//!
//! Phase 1 : modèle partagé avec l'UI, langage de recherche, tri, et une bibliothèque factice
//! (`mock::MockLibrary`) qui reproduit exactement les données du prototype.

pub mod mock;
pub mod model;
pub mod natural;
pub mod query;

pub use mock::MockLibrary;
pub use model::*;
