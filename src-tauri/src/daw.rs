//! Recherche depuis le DAW : un raccourci (⌘F par défaut) pris **seulement quand un DAW est l'app active**.
//!
//! macOS prévient à chaque changement d'app active (`NSWorkspaceDidActivateApplicationNotification`) : si c'est une
//! des apps de la liste (Live, Bitwig…), on enregistre le raccourci global, sinon on le relâche. Ailleurs, ⌘F garde
//! son sens ; aucune autorisation d'accessibilité n'est demandée (pas d'interception du clavier).
//!
//! À l'appui : Crate passe devant, l'interface focalise la recherche (`FocusSearchEvent`). On garde l'app d'où l'on
//! vient : Échap dans la recherche vide, ou un glisser terminé, lui rend la main (`return_to_daw`). Si une autre
//! app passe devant entre-temps, on l'oublie.

use std::str::FromStr;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_specta::Event;

/// Réglages (Réglages › Lecture), mémorisés côté interface et transmis au démarrage puis à chaque changement.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DawShortcutConfig {
    pub enabled: bool,
    /// Raccourci au format du plugin : « Cmd+KeyF », « Ctrl+Alt+Space »…
    pub shortcut: String,
    /// Identifiants des apps (bundle id) où le raccourci est pris.
    pub apps: Vec<String>,
}

impl Default for DawShortcutConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            shortcut: "Cmd+KeyF".into(),
            apps: vec!["com.ableton.live".into(), "com.bitwig.BitwigStudio".into()],
        }
    }
}

/// Le raccourci a été pressé dans le DAW : l'interface focalise le champ de recherche.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct FocusSearchEvent;

/// App au premier plan, vue par l'observateur.
#[derive(Debug, Clone, PartialEq)]
pub struct Frontmost {
    pub bundle: Option<String>,
    pub pid: i32,
}

#[derive(Default)]
struct Inner {
    cfg: DawShortcutConfig,
    frontmost: Option<Frontmost>,
    /// Raccourci actuellement enregistré auprès du système.
    active: Option<Shortcut>,
    /// App d'où l'on a sauté dans Crate, à qui rendre la main.
    origin: Option<i32>,
}

#[derive(Default)]
pub struct DawShortcut(Mutex<Inner>);

/// Lit un raccourci ; refuse un raccourci sans touche de modification (il volerait une lettre au DAW).
pub fn parse_shortcut(s: &str) -> Result<Shortcut, String> {
    let sc = Shortcut::from_str(s).map_err(|e| format!("Unreadable shortcut “{s}”: {e}"))?;
    if sc.mods.is_empty() {
        return Err(format!("Shortcut “{s}” needs ⌘, ⌃, ⌥ or ⇧"));
    }
    Ok(sc)
}

/// Le raccourci à tenir enregistré, selon les réglages et l'app au premier plan (`None` : aucun).
pub fn desired(cfg: &DawShortcutConfig, frontmost: Option<&Frontmost>) -> Option<Shortcut> {
    let bundle = frontmost?.bundle.as_deref()?;
    if !cfg.enabled || !cfg.apps.iter().any(|a| a.eq_ignore_ascii_case(bundle)) {
        return None;
    }
    parse_shortcut(&cfg.shortcut).ok()
}

impl DawShortcut {
    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// Aligne l'enregistrement système sur ce que veulent les réglages et l'app active. Le verrou n'est pas tenu pendant
/// les appels au système (qui peuvent passer par le fil principal).
fn sync<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<DawShortcut>();
    let (want, old) = {
        let mut g = state.lock();
        let want = desired(&g.cfg, g.frontmost.as_ref());
        if want == g.active {
            return;
        }
        (want, g.active.take())
    };
    let gs = app.global_shortcut();
    if let Some(old) = old {
        let _ = gs.unregister(old);
    }
    if let Some(new) = want {
        match gs.register(new) {
            Ok(()) => state.lock().active = Some(new),
            Err(e) => eprintln!("[crate] raccourci {new:?} indisponible : {e}"),
        }
    }
}

/// Une app vient de passer au premier plan (appelé par l'observateur macOS).
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn on_activate<R: Runtime>(app: &AppHandle<R>, front: Frontmost) {
    {
        let state = app.state::<DawShortcut>();
        let mut g = state.lock();
        // Une autre app que Crate et que celle d'origine : on ne lui rendra pas la main.
        if front.pid != std::process::id() as i32 && g.origin != Some(front.pid) {
            g.origin = None;
        }
        g.frontmost = Some(front);
    }
    sync(app);
}

/// Le raccourci a été pressé : Crate passe devant, la recherche prend le focus.
fn on_pressed<R: Runtime>(app: &AppHandle<R>) {
    {
        let state = app.state::<DawShortcut>();
        let mut g = state.lock();
        g.origin = g.frontmost.as_ref().map(|f| f.pid);
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
    let _ = FocusSearchEvent.emit(app);
}

/// Plugin du raccourci global : un seul gestionnaire, pour le raccourci du DAW.
pub fn plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                on_pressed(app);
            }
        })
        .build()
}

/// Démarrage : état, observateur de l'app active, fenêtre qui suit l'espace actif.
pub fn setup<R: Runtime>(app: &tauri::App<R>) {
    app.manage(DawShortcut::default());
    #[cfg(target_os = "macos")]
    macos::setup(app);
}

/// Réglages venus de l'interface. Erreur (en clair) si le raccourci est illisible ; rien n'est changé alors.
#[tauri::command]
#[specta::specta]
pub fn set_daw_shortcut(app: AppHandle, state: State<'_, DawShortcut>, config: DawShortcutConfig) -> Result<(), String> {
    if config.enabled {
        parse_shortcut(&config.shortcut)?;
    }
    state.lock().cfg = config;
    sync(&app);
    Ok(())
}

/// Rend la main à l'app d'où l'on a sauté dans Crate (Échap, glisser terminé). Faux s'il n'y en a pas.
#[tauri::command]
#[specta::specta]
pub fn return_to_daw(state: State<'_, DawShortcut>) -> bool {
    let Some(pid) = state.lock().origin.take() else {
        return false;
    };
    #[cfg(target_os = "macos")]
    return macos::activate(pid);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = pid;
        false
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use std::ptr::NonNull;

    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2_app_kit::{
        NSApplicationActivationOptions, NSRunningApplication, NSWindow, NSWindowCollectionBehavior, NSWorkspace,
        NSWorkspaceDidActivateApplicationNotification,
    };
    use objc2_foundation::NSNotification;
    use tauri::{Manager, Runtime};

    use super::{on_activate, Frontmost};

    fn frontmost() -> Option<Frontmost> {
        let app: Retained<NSRunningApplication> = NSWorkspace::sharedWorkspace().frontmostApplication()?;
        Some(Frontmost {
            bundle: app.bundleIdentifier().map(|b| b.to_string()),
            pid: app.processIdentifier(),
        })
    }

    pub fn setup<R: Runtime>(app: &tauri::App<R>) {
        // La fenêtre rejoint l'espace actif quand Crate passe devant, et peut s'afficher par-dessus un DAW en plein
        // écran : pas de changement d'espace au ⌘F.
        if let Some(w) = app.get_webview_window("main") {
            if let Ok(ptr) = w.ns_window() {
                // SAFETY : pointeur NSWindow valide fourni par Tauri, appelé sur le fil principal (setup).
                let ns: &NSWindow = unsafe { &*(ptr as *const NSWindow) };
                ns.setCollectionBehavior(
                    ns.collectionBehavior()
                        | NSWindowCollectionBehavior::MoveToActiveSpace
                        | NSWindowCollectionBehavior::FullScreenAuxiliary,
                );
            }
        }
        // App active au lancement, puis à chaque changement. Les notifications de NSWorkspace arrivent sur le fil
        // principal, où le raccourci doit être (dés)enregistré.
        let handle = app.handle().clone();
        if let Some(f) = frontmost() {
            on_activate(&handle, f);
        }
        let block = RcBlock::new(move |_n: NonNull<NSNotification>| {
            if let Some(f) = frontmost() {
                on_activate(&handle, f);
            }
        });
        // SAFETY : nom de notification système valide ; le bloc ne capture que des valeurs 'static.
        let observer = unsafe {
            NSWorkspace::sharedWorkspace()
                .notificationCenter()
                .addObserverForName_object_queue_usingBlock(Some(NSWorkspaceDidActivateApplicationNotification), None, None, &block)
        };
        // L'observateur vit autant que l'app.
        std::mem::forget(observer);
    }

    pub fn activate(pid: i32) -> bool {
        NSRunningApplication::runningApplicationWithProcessIdentifier(pid)
            .map(|a| a.activateWithOptions(NSApplicationActivationOptions::empty()))
            .unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn front(bundle: &str) -> Frontmost {
        Frontmost {
            bundle: Some(bundle.into()),
            pid: 42,
        }
    }

    #[test]
    fn pris_seulement_dans_un_daw() {
        let cfg = DawShortcutConfig::default();
        assert!(desired(&cfg, Some(&front("com.ableton.live"))).is_some());
        assert!(desired(&cfg, Some(&front("com.bitwig.BitwigStudio"))).is_some());
        assert!(desired(&cfg, Some(&front("com.BITWIG.bitwigstudio"))).is_some(), "casse ignorée");
        assert!(desired(&cfg, Some(&front("com.apple.Safari"))).is_none());
        assert!(desired(&cfg, Some(&Frontmost { bundle: None, pid: 1 })).is_none());
        assert!(desired(&cfg, None).is_none());
        let off = DawShortcutConfig {
            enabled: false,
            ..cfg.clone()
        };
        assert!(desired(&off, Some(&front("com.ableton.live"))).is_none(), "désactivé");
        let logic = DawShortcutConfig {
            apps: vec!["com.apple.logic10".into()],
            ..cfg
        };
        assert!(desired(&logic, Some(&front("com.apple.logic10"))).is_some(), "liste modifiable");
        assert!(desired(&logic, Some(&front("com.ableton.live"))).is_none());
    }

    #[test]
    fn raccourcis_lus() {
        assert_eq!(parse_shortcut("Cmd+KeyF").unwrap(), parse_shortcut("super+F").unwrap());
        assert!(parse_shortcut("Ctrl+Alt+Space").is_ok());
        assert!(parse_shortcut("Cmd+Shift+Digit1").is_ok());
        assert!(parse_shortcut("KeyF").is_err(), "sans modificateur : refusé");
        assert!(parse_shortcut("Cmd+").is_err());
        assert!(parse_shortcut("n'importe quoi").is_err());
        let bad = DawShortcutConfig {
            shortcut: "F".into(),
            ..Default::default()
        };
        assert!(
            desired(&bad, Some(&front("com.ableton.live"))).is_none(),
            "raccourci illisible : rien"
        );
    }
}
