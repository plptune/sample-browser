//! Recherche depuis le DAW : un raccourci (⌘F par défaut) pris **seulement quand un DAW est l'app active**.
//!
//! macOS prévient à chaque changement d'app active (`NSWorkspaceDidActivateApplicationNotification`) : si c'est une
//! des apps de la liste (Live, Bitwig…), on enregistre le raccourci global, sinon on le relâche. Ailleurs, ⌘F garde
//! son sens ; aucune autorisation d'accessibilité n'est demandée (pas d'interception du clavier).
//!
//! « Space plays Bitwig » (`space_to_daw`) passe par le script de contrôleur de Crate dans Bitwig : voir `bitwig`.
//!
//! À l'appui : Crate passe devant, l'interface focalise la recherche (`FocusSearchEvent`). On garde l'app d'où l'on
//! vient : Échap dans la recherche vide, ou un glisser terminé, lui rend la main (`return_to_daw`). Si une autre
//! app passe devant entre-temps, on l'oublie.
//!
//! Avec « Keep the DAW in front » (`keep_daw_active`, voir `panel`), Crate ne devient jamais l'app active : le
//! raccourci reste donc pris pendant qu'on tape dans Crate, où il refocalise la recherche comme son ⌘F. Le clavier
//! revient alors à l'app au premier plan après tout glisser déposé ailleurs, même sans être venu par le raccourci.

use std::str::FromStr;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_specta::Event;

use crate::{panel, tile, trace};

/// Réglages (Réglages › Lecture), mémorisés côté interface et transmis au démarrage puis à chaque changement.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DawShortcutConfig {
    pub enabled: bool,
    /// Raccourci au format du plugin : « Cmd+KeyF », « Ctrl+Alt+Space »…
    pub shortcut: String,
    /// Identifiants des apps (bundle id) où le raccourci est pris.
    pub apps: Vec<String>,
    /// Fenêtre en panneau non activant : le DAW reste actif, ses fenêtres de plugins restent ouvertes. Indépendant de
    /// `enabled`. Absent des réglages enregistrés avant lui : activé.
    #[serde(default = "yes")]
    pub keep_daw_active: bool,
    /// Tirer la frontière entre Crate et le DAW redimensionne les deux (voir `tile`). Demande l'autorisation
    /// Accessibilité : coupé par défaut.
    #[serde(default)]
    pub resize_together: bool,
    /// « Space plays Bitwig » : Espace dans Crate (hors champ de saisie) lance ou arrête le transport de Bitwig par son
    /// script de contrôleur (`bitwig`) ; la preview s'arrête si elle joue, sans jamais repartir. Coupé par défaut. Le nom vient de la première version,
    /// une frappe simulée vers le DAW : gardé pour les réglages déjà enregistrés.
    #[serde(default)]
    pub space_to_daw: bool,
}

fn yes() -> bool {
    true
}

impl Default for DawShortcutConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            shortcut: "Cmd+KeyF".into(),
            apps: vec!["com.ableton.live".into(), "com.bitwig.studio".into()],
            keep_daw_active: true,
            resize_together: false,
            space_to_daw: false,
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
    /// Dernier DAW de la liste passé au premier plan : celui dont les fenêtres suivent Crate (`tile`).
    last_daw: Option<i32>,
    /// Capture d'un nouveau raccourci en cours (Réglages) : le raccourci global est relâché, pour que les touches
    /// arrivent à la fenêtre (avec le panneau non activant, le DAW reste au premier plan pendant ce temps).
    paused: bool,
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

    /// Réglage « Keep the DAW in front » (panneau non activant, en colonne seulement).
    pub fn keep_daw_active(&self) -> bool {
        self.lock().cfg.keep_daw_active
    }
}

/// Aligne l'enregistrement système sur ce que veulent les réglages et l'app active. Le verrou n'est pas tenu pendant
/// les appels au système (qui peuvent passer par le fil principal).
fn sync<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<DawShortcut>();
    let (want, old) = {
        let mut g = state.lock();
        let want = if g.paused { None } else { desired(&g.cfg, g.frontmost.as_ref()) };
        if want == g.active {
            return;
        }
        (want, g.active.take())
    };
    let gs = app.global_shortcut();
    if let Some(old) = old {
        let r = gs.unregister(old);
        trace(|| format!("daw : raccourci relâché ({r:?})"));
    }
    if let Some(new) = want {
        match gs.register(new) {
            Ok(()) => {
                trace(|| format!("daw : raccourci {new} enregistré"));
                state.lock().active = Some(new);
            }
            Err(e) => eprintln!("[crate] raccourci {new} indisponible : {e}"),
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
        trace(|| format!("daw : app active {:?} (pid {})", front.bundle, front.pid));
        let is_daw = front.bundle.as_deref().is_some_and(|b| g.cfg.apps.iter().any(|a| a.eq_ignore_ascii_case(b)));
        let new_daw = is_daw && g.last_daw != Some(front.pid);
        if new_daw {
            g.last_daw = Some(front.pid);
        }
        g.frontmost = Some(front);
        if new_daw {
            tile::configure(app, g.cfg.resize_together, g.last_daw);
        }
    }
    sync(app);
}

/// Le raccourci a été pressé : Crate passe devant, la recherche prend le focus.
fn on_pressed<R: Runtime>(app: &AppHandle<R>) {
    let keep = {
        let state = app.state::<DawShortcut>();
        let mut g = state.lock();
        g.origin = g.frontmost.as_ref().map(|f| f.pid);
        trace(|| format!("daw : raccourci pressé, origine {:?}", g.origin));
        // Fenêtre bibliothèque : une fenêtre ordinaire, Crate passe devant.
        g.cfg.keep_daw_active && !crate::mode::is_full()
    };
    if keep {
        // Devant avec le clavier, sans activer Crate : les plugins du DAW restent affichés.
        panel::focus(app);
    } else if let Some(w) = app.get_webview_window("main") {
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

/// App à qui rendre la main : celle d'origine, sinon (panneau non activant) l'app au premier plan si ce n'est pas Crate.
fn return_target(origin: Option<i32>, frontmost: Option<&Frontmost>, keep_daw_active: bool, own: i32) -> Option<i32> {
    origin.or_else(|| keep_daw_active.then(|| frontmost.map(|f| f.pid)).flatten().filter(|&pid| pid != own))
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
    trace(|| format!("daw : réglages {config:?}"));
    panel::set_non_activating(&app, config.keep_daw_active && !crate::mode::is_full());
    crate::bitwig::set_enabled(&app, config.space_to_daw);
    {
        let mut g = state.lock();
        tile::configure(&app, config.resize_together, g.last_daw);
        g.cfg = config;
    }
    sync(&app);
    Ok(())
}

/// Capture d'un raccourci dans les Réglages : relâche le raccourci global (vrai), puis le reprend (faux).
#[tauri::command]
#[specta::specta]
pub fn pause_daw_shortcut(app: AppHandle, state: State<'_, DawShortcut>, paused: bool) {
    trace(|| format!("daw : raccourci en pause {paused}"));
    state.lock().paused = paused;
    sync(&app);
}

/// Rend la main à l'app d'où l'on a sauté dans Crate (Échap, glisser terminé). Faux s'il n'y en a pas.
/// Avec `keep_daw_active`, à défaut d'app d'origine : l'app au premier plan, si ce n'est pas Crate.
#[tauri::command]
#[specta::specta]
pub fn return_to_daw(app: AppHandle, state: State<'_, DawShortcut>) -> bool {
    let (target, keep) = {
        let mut g = state.lock();
        let origin = g.origin.take();
        let keep = g.cfg.keep_daw_active;
        (return_target(origin, g.frontmost.as_ref(), keep, std::process::id() as i32), keep)
    };
    let Some(pid) = target else {
        trace(|| "daw : pas d'app d'origine, on reste".into());
        return false;
    };
    trace(|| format!("daw : retour au pid {pid}"));
    if keep {
        // Le DAW est resté actif : seul le clavier est à lui rendre.
        panel::give_back_keyboard(&app, pid);
        return true;
    }
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
        assert!(desired(&cfg, Some(&front("com.bitwig.studio"))).is_some());
        assert!(desired(&cfg, Some(&front("com.BITWIG.Studio"))).is_some(), "casse ignorée");
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
    fn panneau_par_defaut() {
        assert!(DawShortcutConfig::default().keep_daw_active);
        let old: DawShortcutConfig =
            serde_json::from_str(r#"{"enabled":true,"shortcut":"Cmd+KeyF","apps":[]}"#).expect("réglages d'avant");
        assert!(old.keep_daw_active, "absent des réglages enregistrés : activé");
        let off: DawShortcutConfig =
            serde_json::from_str(r#"{"enabled":true,"shortcut":"Cmd+KeyF","apps":[],"keepDawActive":false}"#).unwrap();
        assert!(!off.keep_daw_active);
        assert!(!DawShortcutConfig::default().resize_together, "autorisation Accessibilité : coupé par défaut");
        assert!(!old.resize_together);
        assert!(!DawShortcutConfig::default().space_to_daw, "script Bitwig à installer : coupé par défaut");
        assert!(!old.space_to_daw);
    }

    #[test]
    fn retour_apres_glisser() {
        let daw = front("com.bitwig.studio");
        assert_eq!(return_target(Some(7), Some(&daw), false, 1), Some(7), "app d'origine d'abord");
        assert_eq!(return_target(None, Some(&daw), false, 1), None, "fenêtre ordinaire : seulement après le raccourci");
        assert_eq!(return_target(None, Some(&daw), true, 1), Some(42), "panneau : l'app au premier plan");
        assert_eq!(return_target(None, Some(&daw), true, 42), None, "pas à Crate lui-même");
        assert_eq!(return_target(None, None, true, 1), None);
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
