//! Bibliothèque factice : les données du prototype dans un `Catalog`.
//! Port fidèle de `src/api/mock.ts` (vérifié par tests/parity.rs). Sert aussi au mode démo de la fenêtre.

pub mod data;

use crate::catalog::Catalog;

/// Nom historique (phase 1) : un catalogue rempli avec les données du prototype.
pub type MockLibrary = Catalog;

impl Catalog {
    /// Les 400 samples, 3 sources, collections et dossiers virtuels du prototype.
    pub fn demo() -> Self {
        let samples = data::samples();
        let sources = data::sources();
        let mut c = Catalog::empty();
        c.collection_items = data::collection_items(&samples).into_iter().collect();
        c.virtual_items = data::virtual_items(&samples).into_iter().collect();
        c.root_paths = sources.iter().map(|f| (f.id, data::root_path(f.id).to_string())).collect();
        c.samples = samples;
        c.collections = data::collections();
        c.virtual_folders = data::virtual_folders();
        c.favorites_pinned = data::FAVORITES_PINNED;
        c.pinned_folders = data::PINNED_FOLDERS.to_vec();
        c.known_tags = data::TAGS.iter().map(|t| t.to_string()).collect();
        c.set_sources(sources);
        c
    }
}
