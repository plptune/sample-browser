// Phase 0 : la fenêtre affiche le prototype, sans aucune commande Rust.
// Phase 1 : le cœur `crate-core` et les commandes typées (tauri-specta) se branchent ici.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("erreur au lancement de Crate");
}
