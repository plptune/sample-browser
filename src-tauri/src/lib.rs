//! Couche Tauri : une commande fine par méthode du contrat `Backend` (src/api/types.ts).
//! La fenêtre utilise la vraie bibliothèque (SQLite dans le dossier de données de l'app) ; `CRATE_DEMO=1` la
//! remet sur les données du prototype. Les types TypeScript sont générés dans src/api/bindings.ts par
//! `cargo test -p crate-app`.

use std::ops::{Deref, DerefMut};
use std::sync::{Arc, Mutex, MutexGuard};

use crate_core::audio::Player;
use crate_core::{
    AnalysisStatus, Backend, Catalog, Collection, CommitOptions, CommitPlan, CommitProgress, CommitResult, Library, PlaybackOptions,
    PlaybackStatus, SampleId, ScanStatus, Source, SqliteLibrary, TreePage, TreeRequest, VirtualFolder, Waveform,
};
use serde::{Deserialize, Serialize};
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_specta::Event;

mod daw;

enum Inner {
    /// Données du prototype (CRATE_DEMO=1) : scénarios de démo.
    Demo(Catalog),
    Real(SqliteLibrary),
}

struct Lib(Mutex<Inner>);

/// Accès à la bibliothèque ; la vraie est d'abord resynchronisée avec ce que l'indexeur a écrit.
struct LibGuard<'a>(MutexGuard<'a, Inner>);

impl Lib {
    fn lock(&self) -> LibGuard<'_> {
        let mut g = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if let Inner::Real(l) = &mut *g {
            l.sync();
        }
        LibGuard(g)
    }
}

impl Deref for LibGuard<'_> {
    type Target = dyn Backend + Send;
    fn deref(&self) -> &Self::Target {
        match &*self.0 {
            Inner::Demo(c) => c,
            Inner::Real(l) => l,
        }
    }
}

impl DerefMut for LibGuard<'_> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        match &mut *self.0 {
            Inner::Demo(c) => c,
            Inner::Real(l) => l,
        }
    }
}

/// Position de lecture (~30 par seconde pendant la lecture, puis un dernier statut à l'arrêt).
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct PlaybackEvent(PlaybackStatus);

/// Lit un sample à partir de `start_ms`. En démo, un silence de la durée du sample (fichiers factices).
#[tauri::command]
#[specta::specta]
fn play(lib: State<'_, Lib>, player: State<'_, Player>, id: SampleId, start_ms: u32) {
    let file = match &*lib.0.lock().unwrap_or_else(|e| e.into_inner()) {
        Inner::Real(l) => l.sample_file(id).map(|(p, d)| (Some(p), d)),
        Inner::Demo(c) => c.samples().iter().find(|s| s.id == id).map(|s| (None, s.duration_ms)),
    };
    trace(|| format!("play {id} @ {start_ms} ms"));
    match file {
        Some((Some(path), dur)) => player.play(id, path, start_ms, dur),
        Some((None, dur)) => player.play_virtual(id, start_ms, dur),
        None => {}
    }
}

#[tauri::command]
#[specta::specta]
fn stop(player: State<'_, Player>) {
    player.stop()
}

#[tauri::command]
#[specta::specta]
fn seek(player: State<'_, Player>, ms: u32) {
    player.seek(ms)
}

#[tauri::command]
#[specta::specta]
fn set_playback(player: State<'_, Player>, options: PlaybackOptions) {
    player.set_volume(options.volume);
    player.set_loop(options.looping);
}

/// Dernier statut d'indexation (None hors scan) : l'UI le lit au démarrage, les scans lancés avant qu'elle
/// n'écoute les événements restent visibles.
#[derive(Default)]
struct CurrentScan(Mutex<Option<ScanStatus>>);

#[tauri::command]
#[specta::specta]
fn scan_status(cur: State<'_, CurrentScan>) -> Option<ScanStatus> {
    cur.0.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

/// Progression de l'indexation (au plus 5 par seconde, plus un dernier avec `finished`).
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct ScanEvent(ScanStatus);

#[tauri::command]
#[specta::specta]
fn library(lib: State<'_, Lib>) -> Library {
    lib.lock().library()
}

#[tauri::command]
#[specta::specta]
fn sources(lib: State<'_, Lib>) -> Vec<Source> {
    lib.lock().sources()
}

#[tauri::command]
#[specta::specta]
fn tree(lib: State<'_, Lib>, req: TreeRequest) -> TreePage {
    let page = lib.lock().tree(&req);
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
    lib.lock().set_favorite(&ids, fav)
}

#[tauri::command]
#[specta::specta]
fn add_tag(lib: State<'_, Lib>, ids: Vec<SampleId>, tag: String) {
    trace(|| format!("add_tag {tag:?} → {} samples", ids.len()));
    lib.lock().add_tag(&ids, &tag)
}

#[tauri::command]
#[specta::specta]
fn remove_tag(lib: State<'_, Lib>, ids: Vec<SampleId>, tag: String) {
    lib.lock().remove_tag(&ids, &tag)
}

#[tauri::command]
#[specta::specta]
fn create_collection(lib: State<'_, Lib>, name: String, query: Option<String>) -> Collection {
    lib.lock().create_collection(&name, query.as_deref())
}

#[tauri::command]
#[specta::specta]
fn rename_collection(lib: State<'_, Lib>, id: u32, name: String) {
    lib.lock().rename_collection(id, &name)
}

#[tauri::command]
#[specta::specta]
fn delete_collection(lib: State<'_, Lib>, id: u32) {
    lib.lock().delete_collection(id)
}

#[tauri::command]
#[specta::specta]
fn add_to_collection(lib: State<'_, Lib>, id: u32, ids: Vec<SampleId>) {
    lib.lock().add_to_collection(id, &ids)
}

#[tauri::command]
#[specta::specta]
fn remove_from_collection(lib: State<'_, Lib>, id: u32, ids: Vec<SampleId>) {
    lib.lock().remove_from_collection(id, &ids)
}

#[tauri::command]
#[specta::specta]
fn create_virtual_folder(lib: State<'_, Lib>, name: String, parent_id: Option<u32>) -> VirtualFolder {
    lib.lock().create_virtual_folder(&name, parent_id)
}

#[tauri::command]
#[specta::specta]
fn rename_virtual_folder(lib: State<'_, Lib>, id: u32, name: String) {
    lib.lock().rename_virtual_folder(id, &name)
}

#[tauri::command]
#[specta::specta]
fn delete_virtual_folder(lib: State<'_, Lib>, id: u32) {
    lib.lock().delete_virtual_folder(id)
}

#[tauri::command]
#[specta::specta]
fn move_virtual_folder(lib: State<'_, Lib>, id: u32, parent_id: Option<u32>) {
    lib.lock().move_virtual_folder(id, parent_id)
}

#[tauri::command]
#[specta::specta]
fn add_to_virtual_folder(lib: State<'_, Lib>, id: u32, ids: Vec<SampleId>) {
    lib.lock().add_to_virtual_folder(id, &ids)
}

#[tauri::command]
#[specta::specta]
fn remove_from_virtual_folder(lib: State<'_, Lib>, id: u32, ids: Vec<SampleId>) {
    lib.lock().remove_from_virtual_folder(id, &ids)
}

#[tauri::command]
#[specta::specta]
fn set_pinned(lib: State<'_, Lib>, key: String, pinned: bool) {
    lib.lock().set_pinned(&key, pinned)
}

#[tauri::command]
#[specta::specta]
fn ancestors(lib: State<'_, Lib>, key: String) -> Vec<String> {
    lib.lock().ancestors(&key)
}

/// Pics d'un sample (le tiroir) ; les lignes de l'arbre ne les transportent qu'en densité « waveform ».
#[tauri::command]
#[specta::specta]
fn peaks(lib: State<'_, Lib>, id: SampleId) -> Vec<f32> {
    lib.lock().peaks(id).into_iter().map(|x| x as f32).collect()
}

/// Formes d'onde détaillées déjà calculées (les dernières demandées) : (id, colonnes) → forme.
#[derive(Default)]
struct WaveCache(Mutex<std::collections::VecDeque<((SampleId, u32), Waveform)>>);

/// Forme d'onde détaillée à la largeur affichée (tiroir, inspecteur). Vraie bibliothèque : le fichier est décodé
/// hors du verrou de la bibliothèque, sur un fil à part ; prototype : dérivée des 256 pics.
#[tauri::command]
#[specta::specta]
async fn waveform(lib: State<'_, Lib>, cache: State<'_, WaveCache>, id: SampleId, buckets: u32) -> Result<Waveform, ()> {
    const KEEP: usize = 8;
    let buckets = buckets.clamp(1, crate_core::audio::WAVEFORM_MAX_BUCKETS as u32);
    if let Some((_, w)) = cache
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .find(|(k, _)| *k == (id, buckets))
    {
        return Ok(w.clone());
    }
    let file = match &*lib.0.lock().unwrap_or_else(|e| e.into_inner()) {
        Inner::Real(l) => l.sample_file(id).map(|(p, _)| p),
        Inner::Demo(c) => return Ok(c.waveform(id, buckets)),
    };
    let Some(path) = file else { return Ok(Waveform::default()) };
    let w = tauri::async_runtime::spawn_blocking(move || crate_core::audio::waveform(&path, buckets as usize))
        .await
        .ok()
        .flatten()
        .unwrap_or_default();
    let mut c = cache.0.lock().unwrap_or_else(|e| e.into_inner());
    c.push_front(((id, buckets), w.clone()));
    c.truncate(KEEP);
    Ok(w)
}

/// Avancement de l'analyse de fond (tempo, tonalité, boucle / one-shot).
#[tauri::command]
#[specta::specta]
fn analysis_status(lib: State<'_, Lib>) -> AnalysisStatus {
    lib.lock().analysis_status()
}

#[tauri::command]
#[specta::specta]
fn synonyms(lib: State<'_, Lib>) -> Vec<Vec<String>> {
    lib.lock().synonyms()
}

#[tauri::command]
#[specta::specta]
fn set_synonyms(lib: State<'_, Lib>, groups: Vec<Vec<String>>) {
    lib.lock().set_synonyms(&groups)
}

#[tauri::command]
#[specta::specta]
fn set_hidden(lib: State<'_, Lib>, ids: Vec<SampleId>, hidden: bool) {
    lib.lock().set_hidden(&ids, hidden)
}

#[tauri::command]
#[specta::specta]
fn set_folder_hidden(lib: State<'_, Lib>, id: u32, hidden: bool) {
    lib.lock().set_folder_hidden(id, hidden)
}

#[tauri::command]
#[specta::specta]
fn node_path(lib: State<'_, Lib>, key: String) -> Option<String> {
    lib.lock().node_path(&key)
}

/// Collections manuelles et dossiers virtuels qui contiennent un sample (inspecteur du mode grand).
#[tauri::command]
#[specta::specta]
fn memberships(lib: State<'_, Lib>, id: SampleId) -> Vec<String> {
    lib.lock().memberships(id)
}

#[tauri::command]
#[specta::specta]
fn plan_commit(lib: State<'_, Lib>, key: String, options: CommitOptions) -> CommitPlan {
    lib.lock().plan_commit(&key, options)
}

/// Avancement de la copie de « Créer un vrai dossier » (au plus 20 par seconde, plus le dernier).
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct CommitProgressEvent(CommitProgress);

/// Copie réelle, sur un thread et hors du verrou (la fenêtre reste utilisable), avec sa progression.
/// En démo : simulée par la bibliothèque factice.
#[tauri::command]
#[specta::specta]
async fn commit_to_folder(app: tauri::AppHandle, key: String, destination: String, options: CommitOptions) -> Result<CommitResult, String> {
    trace(|| format!("commit_to_folder {key} → {destination:?} {options:?}"));
    let job = {
        let lib = app.state::<Lib>();
        let mut g = lib.0.lock().unwrap_or_else(|e| e.into_inner());
        match &mut *g {
            Inner::Demo(c) => return c.commit_to_folder(&key, &destination, options),
            Inner::Real(l) => {
                l.sync();
                l.prepare_commit(&key, &destination, options)?
            }
        }
    };
    let h = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut last = std::time::Instant::now();
        job.run(&mut |done, total| {
            if done == total || last.elapsed() >= std::time::Duration::from_millis(50) {
                last = std::time::Instant::now();
                let _ = CommitProgressEvent(CommitProgress { done, total }).emit(&h);
            }
        })
    })
    .await
    .map_err(|e| e.to_string())??;
    if options.add_as_source {
        if let Inner::Real(l) = &mut *app.state::<Lib>().0.lock().unwrap_or_else(|e| e.into_inner()) {
            let _ = l.add_source(&result.destination);
        }
    }
    Ok(result)
}

#[tauri::command]
#[specta::specta]
fn remove_source(lib: State<'_, Lib>, id: u32) {
    lib.lock().remove_source(id)
}

#[tauri::command]
#[specta::specta]
fn add_source(lib: State<'_, Lib>, path: String) -> Result<Source, String> {
    trace(|| format!("add_source {path:?}"));
    lib.lock().add_source(&path)
}

#[tauri::command]
#[specta::specta]
fn refresh_source(lib: State<'_, Lib>, id: u32) {
    trace(|| format!("refresh_source {id}"));
    lib.lock().refresh_source(id)
}

/// Sélecteur de dossier natif (⌘O). `None` si annulé.
#[tauri::command]
#[specta::specta]
async fn pick_folder(app: tauri::AppHandle) -> Option<String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().set_title("Add a sample folder").pick_folder(move |p| {
        let _ = tx.send(p);
    });
    let picked = tauri::async_runtime::spawn_blocking(move || rx.recv().ok().flatten())
        .await
        .ok()
        .flatten()?;
    picked.into_path().ok().map(|p| p.to_string_lossy().into_owned())
}

/// Vrai si la fenêtre tourne sur les données du prototype (CRATE_DEMO=1).
#[tauri::command]
#[specta::specta]
fn is_demo(lib: State<'_, Lib>) -> bool {
    matches!(&*lib.0.lock().unwrap_or_else(|e| e.into_inner()), Inner::Demo(_))
}

/// Dossier : l'ouvre dans le Finder. Fichier : ouvre son dossier et le sélectionne.
#[tauri::command]
#[specta::specta]
fn reveal_in_finder(path: String) {
    #[cfg(target_os = "macos")]
    {
        let mut cmd = std::process::Command::new("open");
        if !std::path::Path::new(&path).is_dir() {
            cmd.arg("-R");
        }
        let _ = cmd.arg(&path).spawn();
    }
    #[cfg(not(target_os = "macos"))]
    {
        let p = std::path::Path::new(&path);
        let dir = if p.is_dir() { p } else { p.parent().unwrap_or(p) };
        let _ = std::process::Command::new("xdg-open").arg(dir).spawn();
    }
}

/// Démo uniquement (scénario « Erreurs ») : marque des fichiers comme introuvables.
#[tauri::command]
#[specta::specta]
fn demo_set_missing(lib: State<'_, Lib>, ids: Vec<SampleId>) {
    trace(|| format!("demo_set_missing {ids:?}"));
    if let Inner::Demo(c) = &mut *lib.0.lock().unwrap_or_else(|e| e.into_inner()) {
        c.set_missing(&ids)
    }
}

fn specta_builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::<tauri::Wry>::new()
        .events(tauri_specta::collect_events![
            ScanEvent,
            PlaybackEvent,
            CommitProgressEvent,
            daw::FocusSearchEvent
        ])
        .commands(tauri_specta::collect_commands![
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
            node_path,
            memberships,
            set_hidden,
            set_folder_hidden,
            peaks,
            waveform,
            analysis_status,
            synonyms,
            set_synonyms,
            plan_commit,
            commit_to_folder,
            add_source,
            refresh_source,
            remove_source,
            pick_folder,
            is_demo,
            scan_status,
            play,
            stop,
            seek,
            set_playback,
            reveal_in_finder,
            demo_set_missing,
            daw::set_daw_shortcut,
            daw::return_to_daw,
        ])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = specta_builder();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_drag::init())
        .plugin(daw::plugin())
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);
            daw::setup(app);
            let inner = if std::env::var_os("CRATE_DEMO").is_some() {
                Inner::Demo(Catalog::demo())
            } else {
                let db = app.path().app_data_dir()?.join("crate.db");
                let handle = app.handle().clone();
                app.manage(CurrentScan::default());
                let sink = Arc::new(move |s: ScanStatus| {
                    *handle.state::<CurrentScan>().0.lock().unwrap_or_else(|e| e.into_inner()) = (!s.finished).then(|| s.clone());
                    let _ = ScanEvent(s).emit(&handle);
                });
                trace(|| format!("base : {}", db.display()));
                match SqliteLibrary::open(&db, sink) {
                    Ok(l) => Inner::Real(l),
                    Err(e) => {
                        eprintln!("[crate] base inaccessible ({e}) : bibliothèque vide");
                        Inner::Demo(Catalog::empty())
                    }
                }
            };
            if app.try_state::<CurrentScan>().is_none() {
                app.manage(CurrentScan::default());
            }
            app.manage(Lib(Mutex::new(inner)));
            app.manage(WaveCache::default());
            // Sortie audio ouverte dès le lancement : le premier son part sans attendre le périphérique.
            let handle = app.handle().clone();
            let player = Player::start(Arc::new(move |s: PlaybackStatus| {
                let _ = PlaybackEvent(s).emit(&handle);
            }));
            trace(|| format!("sortie audio : {}", if player.silent { "aucune (lecture muette)" } else { "ok" }));
            app.manage(player);
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
