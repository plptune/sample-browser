//! Fenêtre en panneau qui n'active pas Crate (Réglages › From the DAW › Keep the DAW in front).
//!
//! Bitwig masque les fenêtres de plugins (Serum…) dès qu'il n'est plus l'app active : un clic dans Crate les faisait
//! disparaître avant même le glisser. La fenêtre principale devient donc un `NSPanel` non activant, comme Spotlight :
//! elle reçoit clics et clavier, mais le DAW reste l'app active. Réglage coupé, le panneau se comporte comme une
//! fenêtre ordinaire (Crate passe devant au clic).
//!
//! Le panneau a le clavier sans que Crate soit actif : pour le rendre au DAW (glisser terminé, Échap), on le lui retire
//! (`give_back_keyboard`).

use tauri::{AppHandle, Manager, Runtime};

/// Démarrage : la fenêtre principale devient un panneau, non activant (réglage par défaut).
pub fn setup<R: Runtime>(app: &tauri::App<R>) {
    // Une exception ObjC levée sous tao finit en « Rust cannot catch foreign exceptions », sans sa raison : avec
    // CRATE_TRACE, on la journalise avant qu'elle parte (un plantage vu une fois après le changement de classe).
    #[cfg(target_os = "macos")]
    if std::env::var_os("CRATE_TRACE").is_some() {
        // SAFETY : fonction `extern "C"` de la bonne signature, qui rend l'exception telle quelle.
        unsafe { objc2::ffi::objc_setExceptionPreprocessor(macos::log_exception) };
    }
    #[cfg(target_os = "macos")]
    with_window(app.handle(), |ns| {
        macos::convert(ns);
        macos::set_non_activating(ns, true);
    });
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

/// Panneau non activant (vrai) ou fenêtre ordinaire (faux).
pub fn set_non_activating<R: Runtime>(app: &AppHandle<R>, on: bool) {
    #[cfg(target_os = "macos")]
    on_main(app, move |ns| macos::set_non_activating(ns, on));
    #[cfg(not(target_os = "macos"))]
    let _ = (app, on);
}

/// Met le panneau devant avec le clavier, sans activer Crate (⌘F depuis le DAW).
pub fn focus<R: Runtime>(app: &AppHandle<R>) {
    #[cfg(target_os = "macos")]
    on_main(app, macos::focus);
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

/// Rend le clavier à l'app `pid` (le DAW, resté actif) ; le panneau reste affiché.
pub fn give_back_keyboard<R: Runtime>(app: &AppHandle<R>, pid: i32) {
    #[cfg(target_os = "macos")]
    on_main(app, move |ns| macos::give_back_keyboard(ns, pid));
    #[cfg(not(target_os = "macos"))]
    let _ = (app, pid);
}

/// Active vraiment Crate : un sélecteur de fichiers ouvert depuis le panneau non activant n'aurait pas le focus.
pub fn activate_app<R: Runtime>(app: &AppHandle<R>) {
    #[cfg(target_os = "macos")]
    let _ = app.run_on_main_thread(macos::activate_app);
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

#[cfg(target_os = "macos")]
fn with_window<R: Runtime>(app: &AppHandle<R>, f: impl FnOnce(&objc2_app_kit::NSWindow)) {
    let Some(w) = app.get_webview_window("main") else { return };
    let Ok(ptr) = w.ns_window() else { return };
    // SAFETY : pointeur NSWindow valide fourni par Tauri ; les appelants sont sur le fil principal.
    f(unsafe { &*(ptr as *const objc2_app_kit::NSWindow) });
}

/// AppKit veut le fil principal ; commandes et raccourcis n'y sont pas forcément.
#[cfg(target_os = "macos")]
fn on_main<R: Runtime>(app: &AppHandle<R>, f: impl FnOnce(&objc2_app_kit::NSWindow) + Send + 'static) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || with_window(&handle, f));
}

#[cfg(target_os = "macos")]
mod macos {
    use objc2::runtime::AnyObject;
    use objc2::{define_class, ClassType, MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::{
        NSApplication, NSApplicationActivationOptions, NSPanel, NSResponder, NSRunningApplication, NSWindow,
        NSWindowStyleMask,
    };
    use objc2_foundation::{NSObject, NSObjectProtocol};

    use crate::trace;

    define_class!(
        // Sous-classe de NSPanel posée à la place de la classe de tao (`TaoWindow`) : elle reprend ce que tao
        // surcharge (fenêtre clé et principale possibles). Ne jamais appeler `set_focusable` de tao ensuite : il écrit
        // un ivar que cette classe n'a pas.
        #[unsafe(super(NSPanel, NSWindow, NSResponder, NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "CratePanel"]
        struct CratePanel;

        impl CratePanel {
            #[unsafe(method(canBecomeKeyWindow))]
            fn can_become_key_window(&self) -> bool {
                true
            }

            #[unsafe(method(canBecomeMainWindow))]
            fn can_become_main_window(&self) -> bool {
                true
            }

            /// Un NSPanel se ferme sur Échap si la page ne l'a pas pris : Échap sert partout dans Crate.
            #[unsafe(method(cancelOperation:))]
            fn cancel_operation(&self, _sender: Option<&AnyObject>) {}
        }
    );

    pub fn convert(ns: &NSWindow) {
        let from = ns.class();
        let to = CratePanel::class();
        // La nouvelle classe doit tenir dans l'objet déjà alloué (tao ajoute un ivar, NSPanel aucun).
        if to.instance_size() > from.instance_size() {
            eprintln!("[crate] fenêtre {from:?} trop petite pour un panneau : fenêtre ordinaire gardée");
            return;
        }
        // SAFETY : CratePanel descend de NSWindow, comme la classe de tao, et n'ajoute aucun ivar ; taille vérifiée.
        // `AnyObject::set_class` exige des tailles égales : l'ivar de tao reste là, inutilisé.
        unsafe { objc2::ffi::object_setClass(ns as *const NSWindow as *mut AnyObject, to) };
        // Un panneau se cache par défaut quand Crate se désactive ; son niveau reste celui de « Toujours devant ».
        ns.setHidesOnDeactivate(false);
        // SAFETY : la classe de l'objet est maintenant CratePanel, sous-classe de NSPanel.
        let panel: &NSPanel = unsafe { &*(ns as *const NSWindow as *const NSPanel) };
        panel.setFloatingPanel(false);
        trace(|| format!("panneau : {from:?} → CratePanel"));
    }

    fn is_panel(ns: &NSWindow) -> bool {
        // KVO peut glisser une sous-classe dynamique (NSKVONotifying_CratePanel) : pas d'égalité stricte.
        ns.isKindOfClass(CratePanel::class())
    }

    pub fn set_non_activating(ns: &NSWindow, on: bool) {
        if !is_panel(ns) {
            return;
        }
        let mask = ns.styleMask();
        let next = if on { mask | NSWindowStyleMask::NonactivatingPanel } else { mask & !NSWindowStyleMask::NonactivatingPanel };
        if next != mask {
            trace(|| format!("panneau : non activant {on} ({mask:?} → {next:?})"));
            // NSPanel prévient le window server : plus (ou de nouveau) d'activation de Crate au clic.
            ns.setStyleMask(next);
        }
    }

    pub fn focus(ns: &NSWindow) {
        if ns.isMiniaturized() {
            ns.deminiaturize(None);
        }
        // `orderFront:` ne passe pas devant les fenêtres d'une autre app quand Crate n'est pas actif.
        ns.orderFrontRegardless();
        ns.makeKeyWindow();
    }

    pub fn give_back_keyboard(ns: &NSWindow, pid: i32) {
        if ns.isKeyWindow() {
            // Retiré puis remis devant sans redevenir clé : le window server rend le clavier à l'app active.
            ns.orderOut(None);
            ns.orderFrontRegardless();
        }
        #[allow(deprecated)] // ActivateIgnoringOtherApps : sans effet depuis macOS 14, utile avant.
        let ok = NSRunningApplication::runningApplicationWithProcessIdentifier(pid)
            .map(|a| a.activateWithOptions(NSApplicationActivationOptions::ActivateIgnoringOtherApps))
            .unwrap_or(false);
        trace(|| format!("panneau : clavier rendu au pid {pid} ({ok})"));
    }

    /// Nom, raison et pile de chaque exception ObjC, avant qu'elle soit levée (CRATE_TRACE).
    pub unsafe extern "C" fn log_exception(e: *mut AnyObject) -> *mut AnyObject {
        use objc2_foundation::{NSException, NSThread};
        // SAFETY : les exceptions levées par AppKit sont des NSException.
        if let Some(ex) = unsafe { (e as *const NSException).as_ref() } {
            eprintln!("[crate] EXCEPTION ObjC {} : {:?}", ex.name(), ex.reason());
            for s in NSThread::callStackSymbols().iter().take(25) {
                eprintln!("[crate]   {s}");
            }
        }
        e
    }

    pub fn activate_app() {
        let Some(mtm) = MainThreadMarker::new() else { return };
        #[allow(deprecated)] // `activate` n'existe qu'à partir de macOS 14.
        NSApplication::sharedApplication(mtm).activateIgnoringOtherApps(true);
    }
}
