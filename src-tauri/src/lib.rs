//! Couche Tauri : une commande fine par méthode du contrat `Backend` (src/api/types.ts).
//! Phase 1 : la bibliothèque factice de crate-core (mêmes données que le prototype).
//! Les types TypeScript sont générés dans src/api/bindings.ts par `cargo test -p crate-app`.

use std::sync::Mutex;

use crate_core::{
    Backend, Collection, CommitOptions, CommitPlan, CommitResult, Library, MockLibrary, SampleId, Source, TreePage, TreeRequest,
    VirtualFolder,
};
use tauri::State;

type Lib = Mutex<MockLibrary>;

#[tauri::command]
#[specta::specta]
fn library(lib: State<'_, Lib>) -> Library {
    lib.lock().unwrap().library()
}

#[tauri::command]
#[specta::specta]
fn sources(lib: State<'_, Lib>) -> Vec<Source> {
    lib.lock().unwrap().sources()
}

#[tauri::command]
#[specta::specta]
fn tree(lib: State<'_, Lib>, req: TreeRequest) -> TreePage {
    let page = lib.lock().unwrap().tree(&req);
    trace(|| {
        format!(
            "tree {:?} query={:?} expanded={} → {} lignes",
            req.root,
            req.query,
            req.expanded.len(),
            page.total_rows
        )
    });
    page
}

/// Trace des commandes sur stderr si CRATE_TRACE=1 (diagnostic ; l'overlay de mesures arrive en phase 3).
fn trace(msg: impl FnOnce() -> String) {
    if std::env::var_os("CRATE_TRACE").is_some() {
        eprintln!("[crate] {}", msg());
    }
}

#[tauri::command]
#[specta::specta]
fn set_favorite(lib: State<'_, Lib>, ids: Vec<SampleId>, fav: bool) {
    lib.lock().unwrap().set_favorite(&ids, fav)
}

#[tauri::command]
#[specta::specta]
fn add_tag(lib: State<'_, Lib>, ids: Vec<SampleId>, tag: String) {
    trace(|| format!("add_tag {tag:?} → {} samples", ids.len()));
    lib.lock().unwrap().add_tag(&ids, &tag)
}

#[tauri::command]
#[specta::specta]
fn remove_tag(lib: State<'_, Lib>, ids: Vec<SampleId>, tag: String) {
    lib.lock().unwrap().remove_tag(&ids, &tag)
}

#[tauri::command]
#[specta::specta]
fn create_collection(lib: State<'_, Lib>, name: String, query: Option<String>) -> Collection {
    lib.lock().unwrap().create_collection(&name, query.as_deref())
}

#[tauri::command]
#[specta::specta]
fn rename_collection(lib: State<'_, Lib>, id: u32, name: String) {
    lib.lock().unwrap().rename_collection(id, &name)
}

#[tauri::command]
#[specta::specta]
fn delete_collection(lib: State<'_, Lib>, id: u32) {
    lib.lock().unwrap().delete_collection(id)
}

#[tauri::command]
#[specta::specta]
fn add_to_collection(lib: State<'_, Lib>, id: u32, ids: Vec<SampleId>) {
    lib.lock().unwrap().add_to_collection(id, &ids)
}

#[tauri::command]
#[specta::specta]
fn remove_from_collection(lib: State<'_, Lib>, id: u32, ids: Vec<SampleId>) {
    lib.lock().unwrap().remove_from_collection(id, &ids)
}

#[tauri::command]
#[specta::specta]
fn create_virtual_folder(lib: State<'_, Lib>, name: String, parent_id: Option<u32>) -> VirtualFolder {
    lib.lock().unwrap().create_virtual_folder(&name, parent_id)
}

#[tauri::command]
#[specta::specta]
fn rename_virtual_folder(lib: State<'_, Lib>, id: u32, name: String) {
    lib.lock().unwrap().rename_virtual_folder(id, &name)
}

#[tauri::command]
#[specta::specta]
fn delete_virtual_folder(lib: State<'_, Lib>, id: u32) {
    lib.lock().unwrap().delete_virtual_folder(id)
}

#[tauri::command]
#[specta::specta]
fn move_virtual_folder(lib: State<'_, Lib>, id: u32, parent_id: Option<u32>) {
    lib.lock().unwrap().move_virtual_folder(id, parent_id)
}

#[tauri::command]
#[specta::specta]
fn add_to_virtual_folder(lib: State<'_, Lib>, id: u32, ids: Vec<SampleId>) {
    lib.lock().unwrap().add_to_virtual_folder(id, &ids)
}

#[tauri::command]
#[specta::specta]
fn remove_from_virtual_folder(lib: State<'_, Lib>, id: u32, ids: Vec<SampleId>) {
    lib.lock().unwrap().remove_from_virtual_folder(id, &ids)
}

#[tauri::command]
#[specta::specta]
fn set_pinned(lib: State<'_, Lib>, key: String, pinned: bool) {
    lib.lock().unwrap().set_pinned(&key, pinned)
}

#[tauri::command]
#[specta::specta]
fn ancestors(lib: State<'_, Lib>, key: String) -> Vec<String> {
    lib.lock().unwrap().ancestors(&key)
}

#[tauri::command]
#[specta::specta]
fn plan_commit(lib: State<'_, Lib>, key: String, options: CommitOptions) -> CommitPlan {
    lib.lock().unwrap().plan_commit(&key, options)
}

/// Phase 1 : copie simulée (aucun fichier écrit). Phase 5 : copie réelle, avec progression par événement.
#[tauri::command]
#[specta::specta]
fn commit_to_folder(lib: State<'_, Lib>, key: String, destination: String, options: CommitOptions) -> CommitResult {
    trace(|| format!("commit_to_folder {key} → {destination:?} {options:?}"));
    lib.lock().unwrap().commit_to_folder(&key, &destination, options)
}

#[tauri::command]
#[specta::specta]
fn remove_source(lib: State<'_, Lib>, id: u32) {
    lib.lock().unwrap().remove_source(id)
}

/// Phase 5 : ouverture réelle dans le Finder.
#[tauri::command]
#[specta::specta]
fn reveal_in_finder(path: String) {
    let _ = path;
}

/// Démo uniquement (scénario « Erreurs ») : marque des fichiers comme introuvables.
#[tauri::command]
#[specta::specta]
fn demo_set_missing(lib: State<'_, Lib>, ids: Vec<SampleId>) {
    trace(|| format!("demo_set_missing {ids:?}"));
    lib.lock().unwrap().set_missing(&ids)
}

fn specta_builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::<tauri::Wry>::new().commands(tauri_specta::collect_commands![
        library,
        sources,
        tree,
        set_favorite,
        add_tag,
        remove_tag,
        create_collection,
        rename_collection,
        delete_collection,
        add_to_collection,
        remove_from_collection,
        create_virtual_folder,
        rename_virtual_folder,
        delete_virtual_folder,
        move_virtual_folder,
        add_to_virtual_folder,
        remove_from_virtual_folder,
        set_pinned,
        ancestors,
        plan_commit,
        commit_to_folder,
        remove_source,
        reveal_in_finder,
        demo_set_missing,
    ])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = specta_builder();
    tauri::Builder::default()
        .manage(Mutex::new(MockLibrary::new()))
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("erreur au lancement de Crate");
}

#[cfg(test)]
mod tests {
    /// Génère src/api/bindings.ts. La CI échoue si le fichier versionné n'est pas à jour.
    #[test]
    fn export_bindings() {
        super::specta_builder()
            .export(
                specta_typescript::Typescript::default()
                    .header("// Généré par tauri-specta (cargo test -p crate-app). Ne pas modifier à la main.\n// @ts-nocheck"),
                "../src/api/bindings.ts",
            )
            .expect("export des types TypeScript");
    }
}
