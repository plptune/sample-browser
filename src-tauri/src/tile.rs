//! Redimensionner Crate et le DAW d'un seul glisser (Réglages › From the DAW › Resize the DAW with Crate).
//!
//! Quand une fenêtre du DAW touche Crate (à quelques points près), tirer la frontière entre les deux agrandit l'une et
//! rétrécit l'autre, comme un séparateur. Dans les deux sens :
//! - Crate tiré à la main (redimensionnement en direct, `NSWindow…LiveResizeNotification`) : la fenêtre du DAW suit,
//!   par l'API d'accessibilité ;
//! - fenêtre du DAW tirée par son bord intérieur (`AXObserver`) : Crate suit.
//!
//! Il faut l'autorisation Accessibilité de macOS (réglage coupé par défaut). Les redimensionnements par programme
//! (⌘⌥← / ⌘⌥→, ⌘⇧F) n'entraînent pas le DAW : seul un glisser de l'utilisateur compte. Rien non plus en fenêtre
//! bibliothèque (mode grand) : elle remplit l'écran.

use tauri::{AppHandle, Runtime};

/// Cadre en points, origine en haut à gauche de l'écran principal (repère de l'API d'accessibilité).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Rect {
    fn right(&self) -> f64 {
        self.x + self.w
    }
    fn bottom(&self) -> f64 {
        self.y + self.h
    }
}

/// Position du DAW par rapport à Crate.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Side {
    DawLeft,
    DawRight,
}

/// Distance maximale entre les deux bords pour que les fenêtres « se touchent ».
const TOUCH: f64 = 12.0;
/// Largeur minimale laissée à la fenêtre du DAW.
pub const DAW_MIN_W: f64 = 200.0;

/// Le DAW touche-t-il Crate ? Côté du DAW et écart entre les deux bords (gardé pendant le glisser).
pub fn adjacent(crate_: Rect, daw: Rect) -> Option<(Side, f64)> {
    let overlap = crate_.bottom().min(daw.bottom()) - crate_.y.max(daw.y);
    if overlap < 0.5 * crate_.h.min(daw.h) {
        return None;
    }
    let right_gap = daw.x - crate_.right();
    let left_gap = crate_.x - daw.right();
    if right_gap.abs() <= TOUCH {
        Some((Side::DawRight, right_gap))
    } else if left_gap.abs() <= TOUCH {
        Some((Side::DawLeft, left_gap))
    } else {
        None
    }
}

/// Cadre de la fenêtre qui suit (`other`) quand on tire `moved` : son bord intérieur reste à `gap` du bord de `moved`,
/// son bord extérieur, son `y` et sa hauteur ne bougent pas. `moved_is_left` : `moved` est à gauche de `other`.
pub fn follow(moved: Rect, other: Rect, moved_is_left: bool, gap: f64, min_w: f64) -> Rect {
    if moved_is_left {
        let right = other.right();
        let x = (moved.right() + gap).min(right - min_w);
        Rect { x, w: right - x, ..other }
    } else {
        let right = (moved.x - gap).max(other.x + min_w);
        Rect { w: right - other.x, ..other }
    }
}

/// Seul le bord intérieur de la fenêtre a bougé (un redimensionnement, pas un déplacement par la barre titre).
pub fn is_inner_resize(before: Rect, after: Rect, moved_is_left: bool) -> bool {
    let (fixed, inner) = if moved_is_left {
        ((after.x - before.x).abs(), (after.right() - before.right()).abs())
    } else {
        ((after.right() - before.right()).abs(), (after.x - before.x).abs())
    };
    fixed < 1.0 && inner >= 1.0
}

/// Réglage et DAW à suivre (app au premier plan de la liste des DAW, la dernière vue).
pub fn configure<R: Runtime>(app: &AppHandle<R>, on: bool, daw: Option<i32>) {
    #[cfg(target_os = "macos")]
    {
        let _ = app.run_on_main_thread(move || macos::configure(on, daw));
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, on, daw);
}

/// Fenêtre bibliothèque (mode grand) : le DAW ne suit plus, et ne mène plus.
pub fn set_full<R: Runtime>(app: &AppHandle<R>, full: bool) {
    #[cfg(target_os = "macos")]
    {
        let _ = app.run_on_main_thread(move || macos::set_full(full));
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, full);
}

/// Démarrage : suit les redimensionnements de la fenêtre de Crate.
pub fn setup<R: Runtime>(app: &tauri::App<R>) {
    #[cfg(target_os = "macos")]
    {
        use tauri::Manager;
        if let Some(w) = app.get_webview_window("main") {
            if let Ok(ptr) = w.ns_window() {
                // SAFETY : pointeur NSWindow valide fourni par Tauri, appelé sur le fil principal (setup).
                unsafe { macos::setup(ptr as *const objc2_app_kit::NSWindow) };
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

/// Crate a-t-il l'autorisation Accessibilité ? Avec `prompt`, macOS la demande s'il ne l'a pas.
#[tauri::command]
#[specta::specta]
pub fn accessibility_trusted(app: AppHandle, prompt: bool) -> bool {
    #[cfg(target_os = "macos")]
    {
        let ok = macos::trusted(prompt);
        // Lancé depuis un terminal, macOS rattache l'autorisation au terminal (iTerm, Terminal…), pas à Crate.
        crate::trace(|| format!("tile : autorisation Accessibilité {ok} (demande {prompt})"));
        // Autorisation donnée entre-temps : on se met à suivre le DAW.
        if ok {
            let _ = app.run_on_main_thread(macos::ensure_observer);
        }
        ok
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, prompt);
        false
    }
}

/// Ouvre Réglages Système › Confidentialité et sécurité › Accessibilité.
#[tauri::command]
#[specta::specta]
pub fn open_accessibility_settings() {
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
        .spawn();
}

#[cfg(target_os = "macos")]
mod macos {
    use std::cell::RefCell;
    use std::ffi::c_void;
    use std::ptr::{self, NonNull};

    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::MainThreadMarker;
    use objc2_app_kit::{
        NSScreen, NSWindow, NSWindowDidEndLiveResizeNotification, NSWindowDidResizeNotification,
        NSWindowWillStartLiveResizeNotification,
    };
    use objc2_application_services::{
        kAXTrustedCheckOptionPrompt, AXError, AXIsProcessTrusted, AXIsProcessTrustedWithOptions, AXObserver,
        AXUIElement, AXValue, AXValueType,
    };
    use objc2_core_foundation::{
        kCFBooleanTrue, kCFRunLoopCommonModes, CFArray, CFBoolean, CFDictionary, CFRetained, CFRunLoop, CFString,
        CFType, CGPoint, CGSize,
    };
    use objc2_foundation::{NSNotification, NSNotificationCenter, NSPoint, NSRect, NSSize};

    use super::{adjacent, follow, is_inner_resize, Rect, Side, DAW_MIN_W};
    use crate::trace;

    /// Glisser du bord de Crate en cours, avec la fenêtre du DAW qui suit.
    struct Drag {
        win: CFRetained<AXUIElement>,
        side: Side,
        gap: f64,
        /// Cadre du DAW au début : son bord extérieur reste là.
        start: Rect,
        last: Rect,
    }

    #[derive(Default)]
    struct State {
        window: Option<Retained<NSWindow>>,
        on: bool,
        /// Fenêtre bibliothèque : rien ne suit.
        full: bool,
        pid: Option<i32>,
        observer: Option<(i32, CFRetained<AXObserver>)>,
        drag: Option<Drag>,
        /// Derniers cadres connus des fenêtres du DAW : savoir quel bord a bougé quand l'une est redimensionnée.
        known: Vec<(CFRetained<AXUIElement>, Rect)>,
    }

    thread_local! {
        // Tout passe par le fil principal (notifications AppKit, rappels de l'AXObserver, `run_on_main_thread`).
        static STATE: RefCell<State> = RefCell::new(State::default());
    }

    pub fn trusted(prompt: bool) -> bool {
        if !prompt {
            // SAFETY : sans argument.
            return unsafe { AXIsProcessTrusted() };
        }
        // SAFETY : clé et valeur CF valides (statiques).
        unsafe {
            let (Some(t),) = (kCFBooleanTrue,) else { return AXIsProcessTrusted() };
            let opts = CFDictionary::<CFString, CFBoolean>::from_slices(&[kAXTrustedCheckOptionPrompt], &[t]);
            AXIsProcessTrustedWithOptions(Some(opts.as_opaque()))
        }
    }

    // --- Lecture et écriture des fenêtres du DAW (API d'accessibilité).

    fn attr(el: &AXUIElement, name: &'static str) -> Option<CFRetained<CFType>> {
        let mut v: *const CFType = ptr::null();
        // SAFETY : pointeur de sortie valide ; la valeur rendue est à nous (règle « Copy »).
        let err = unsafe { el.copy_attribute_value(&CFString::from_static_str(name), NonNull::from(&mut v)) };
        if err != AXError::Success {
            return None;
        }
        // SAFETY : valeur non nulle rendue avec un compte de références à nous.
        NonNull::new(v as *mut CFType).map(|p| unsafe { CFRetained::from_raw(p) })
    }

    fn ax_value<T: Default>(el: &AXUIElement, name: &'static str, ty: AXValueType) -> Option<T> {
        let v = attr(el, name)?.downcast::<AXValue>().ok()?;
        let mut out = T::default();
        // SAFETY : `out` a le type annoncé par `ty`.
        unsafe { v.value(ty, NonNull::from(&mut out).cast()) }.then_some(out)
    }

    fn frame_of(el: &AXUIElement) -> Option<Rect> {
        let p: CGPoint = ax_value(el, "AXPosition", AXValueType::CGPoint)?;
        let s: CGSize = ax_value(el, "AXSize", AXValueType::CGSize)?;
        Some(Rect { x: p.x, y: p.y, w: s.width, h: s.height })
    }

    fn set_value<T>(el: &AXUIElement, name: &'static str, ty: AXValueType, v: &T) -> bool {
        // SAFETY : `v` a le type annoncé par `ty`.
        let Some(val) = (unsafe { AXValue::new(ty, NonNull::new(v as *const T as *mut c_void).expect("référence non nulle")) }) else { return false };
        // SAFETY : attribut et valeur CF valides.
        unsafe { el.set_attribute_value(&CFString::from_static_str(name), &val) == AXError::Success }
    }

    /// Écrit le cadre du DAW : la taille d'abord s'il rétrécit, la position d'abord s'il grandit (pas de chevauchement
    /// passager avec Crate).
    fn set_frame(el: &AXUIElement, r: Rect, grows: bool) {
        let pos = CGPoint { x: r.x, y: r.y };
        let size = CGSize { width: r.w, height: r.h };
        if grows {
            set_value(el, "AXPosition", AXValueType::CGPoint, &pos);
            set_value(el, "AXSize", AXValueType::CGSize, &size);
        } else {
            set_value(el, "AXSize", AXValueType::CGSize, &size);
            set_value(el, "AXPosition", AXValueType::CGPoint, &pos);
        }
    }

    fn app_element(pid: i32) -> CFRetained<AXUIElement> {
        // SAFETY : un pid quelconque donne un élément (inerte si l'app n'existe plus).
        let el = unsafe { AXUIElement::new_application(pid) };
        // Un DAW qui ne répond pas ne doit pas figer Crate.
        // SAFETY : élément valide.
        unsafe { el.set_messaging_timeout(0.1) };
        el
    }

    /// Fenêtres ordinaires du DAW (pas ses fenêtres de plugins), hors plein écran, avec leur cadre.
    fn daw_windows(pid: i32) -> Vec<(CFRetained<AXUIElement>, Rect)> {
        let Some(list) = attr(&app_element(pid), "AXWindows").and_then(|v| v.downcast::<CFArray>().ok()) else {
            return Vec::new();
        };
        // SAFETY : `AXWindows` est un tableau d'éléments d'accessibilité.
        let list: CFRetained<CFArray<AXUIElement>> = unsafe { CFRetained::cast_unchecked(list) };
        list.iter()
            .filter(|w| {
                let standard = attr(w, "AXSubrole")
                    .and_then(|s| s.downcast::<CFString>().ok())
                    .is_some_and(|s| s.to_string() == "AXStandardWindow");
                let full = attr(w, "AXFullScreen")
                    .and_then(|b| b.downcast::<CFBoolean>().ok())
                    .is_some_and(|b| b.as_bool());
                standard && !full
            })
            .filter_map(|w| frame_of(&w).map(|f| (w, f)))
            .collect()
    }

    // --- Cadre de Crate, converti dans le repère de l'accessibilité.

    fn primary_height(mtm: MainThreadMarker) -> f64 {
        NSScreen::screens(mtm).firstObject().map(|s| s.frame().size.height).unwrap_or(0.0)
    }

    fn crate_frame(ns: &NSWindow, mtm: MainThreadMarker) -> Rect {
        let f = ns.frame();
        Rect { x: f.origin.x, y: primary_height(mtm) - (f.origin.y + f.size.height), w: f.size.width, h: f.size.height }
    }

    fn set_crate_frame(ns: &NSWindow, r: Rect, mtm: MainThreadMarker) {
        let y = primary_height(mtm) - (r.y + r.h);
        ns.setFrame_display(NSRect::new(NSPoint::new(r.x, y), NSSize::new(r.w, r.h)), true);
    }

    // --- Crate tiré à la main : le DAW suit.

    fn on_live_resize(phase: u8) {
        let Some(mtm) = MainThreadMarker::new() else { return };
        STATE.with_borrow_mut(|st| {
            let Some(ns) = st.window.clone() else { return };
            match phase {
                // Début : la fenêtre du DAW qui touche Crate, s'il y en a une.
                0 => {
                    st.drag = None;
                    let Some(pid) = st.pid.filter(|_| st.on && !st.full && !ns.isZoomed() && trusted(false)) else { return };
                    let c = crate_frame(&ns, mtm);
                    let wins = daw_windows(pid);
                    st.drag = wins.into_iter().find_map(|(win, f)| {
                        adjacent(c, f).map(|(side, gap)| Drag { win, side, gap, start: f, last: f })
                    });
                    if let Some(d) = &st.drag {
                        trace(|| format!("tile : glisser de Crate, DAW {:?} (écart {:.0}) {:?}", d.side, d.gap, d.start));
                    }
                }
                // Pendant (seulement en redimensionnement à la main) et fin : le DAW colle au bord de Crate.
                _ => {
                    if phase == 1 && !ns.inLiveResize() {
                        return;
                    }
                    let Some(d) = st.drag.as_mut() else { return };
                    let target = follow(crate_frame(&ns, mtm), d.start, d.side == Side::DawRight, d.gap, DAW_MIN_W);
                    if target != d.last {
                        set_frame(&d.win, target, target.w > d.last.w);
                        d.last = target;
                    }
                    if phase == 2 {
                        trace(|| format!("tile : fin du glisser, DAW {target:?}"));
                        st.drag = None;
                        // Cadres à jour : les notifications de nos propres écritures n'y verront aucun changement.
                        if let Some(pid) = st.pid {
                            st.known = daw_windows(pid);
                        }
                    }
                }
            }
        });
    }

    pub unsafe fn setup(ptr: *const NSWindow) {
        // SAFETY : pointeur valide (appelant) ; la fenêtre principale vit autant que l'app.
        let Some(ns) = (unsafe { Retained::retain(ptr as *mut NSWindow) }) else { return };
        let center = NSNotificationCenter::defaultCenter();
        let object: &AnyObject = &ns;
        for (name, phase) in [
            // SAFETY : noms de notifications système (statiques).
            (unsafe { NSWindowWillStartLiveResizeNotification }, 0u8),
            (unsafe { NSWindowDidResizeNotification }, 1),
            (unsafe { NSWindowDidEndLiveResizeNotification }, 2),
        ] {
            let block = RcBlock::new(move |_n: NonNull<NSNotification>| on_live_resize(phase));
            // SAFETY : notification de cette fenêtre, bloc 'static ; rappel sur le fil principal (file nulle).
            let observer = unsafe { center.addObserverForName_object_queue_usingBlock(Some(name), Some(object), None, &block) };
            // Les observateurs vivent autant que l'app.
            std::mem::forget(observer);
        }
        STATE.with_borrow_mut(|st| st.window = Some(ns));
    }

    // --- Fenêtre du DAW tirée par son bord : Crate suit.

    unsafe extern "C-unwind" fn on_ax(_obs: NonNull<AXObserver>, el: NonNull<AXUIElement>, _n: NonNull<CFString>, _c: *mut c_void) {
        let Some(mtm) = MainThreadMarker::new() else { return };
        // SAFETY : élément valide le temps du rappel.
        let el = unsafe { el.as_ref() };
        let Some(now) = frame_of(el) else { return };
        STATE.with_borrow_mut(|st| {
            let prev = st.known.iter_mut().find(|(w, _)| **w == *el);
            let before = match prev {
                Some((_, f)) => std::mem::replace(f, now),
                None => {
                    // SAFETY : on garde une référence de plus à l'élément.
                    st.known.push((unsafe { CFRetained::retain(NonNull::from(el)) }, now));
                    return;
                }
            };
            // Pendant un glisser de Crate, c'est Crate qui mène : ces notifications sont nos propres écritures.
            let Some(ns) = st.window.clone().filter(|_| st.on && !st.full && st.drag.is_none()) else { return };
            if ns.isZoomed() {
                return;
            }
            let c = crate_frame(&ns, mtm);
            let Some((side, gap)) = adjacent(c, before) else { return };
            let daw_is_left = side == Side::DawLeft;
            if !is_inner_resize(before, now, daw_is_left) {
                return;
            }
            let target = follow(now, c, daw_is_left, gap, ns.minSize().width);
            if target != c {
                trace(|| format!("tile : glisser du DAW {side:?}, Crate {target:?}"));
                set_crate_frame(&ns, target, mtm);
            }
        });
    }

    /// Observateur des fenêtres du DAW, si la fonction est active, autorisée, et qu'un DAW est connu.
    pub fn ensure_observer() {
        STATE.with_borrow_mut(|st| {
            let want = st.pid.filter(|_| st.on && trusted(false));
            if st.observer.as_ref().map(|(p, _)| *p) == want {
                return;
            }
            if let Some((_, old)) = st.observer.take() {
                // SAFETY : source de l'observateur, ajoutée à la boucle principale.
                if let Some(rl) = CFRunLoop::main() {
                    let source = unsafe { old.run_loop_source() };
                    rl.remove_source(Some(&source), unsafe { kCFRunLoopCommonModes });
                }
                trace(|| "tile : observateur du DAW retiré".into());
            }
            st.known.clear();
            let Some(pid) = want else { return };
            let mut raw: *mut AXObserver = ptr::null_mut();
            // SAFETY : rappel de la bonne signature, pointeur de sortie valide.
            let err = unsafe { AXObserver::create(pid, Some(on_ax), NonNull::from(&mut raw)) };
            // SAFETY : observateur créé, compte de références à nous.
            let Some(obs) = NonNull::new(raw).filter(|_| err == AXError::Success).map(|p| unsafe { CFRetained::from_raw(p) })
            else {
                trace(|| format!("tile : observateur du DAW impossible ({err:?})"));
                return;
            };
            let app = app_element(pid);
            for n in ["AXWindowResized", "AXWindowMoved"] {
                // SAFETY : élément et nom valides ; pas de contexte.
                unsafe { obs.add_notification(&app, &CFString::from_static_str(n), ptr::null_mut()) };
            }
            // Boucle principale, tous modes : aussi pendant qu'on suit la souris.
            if let Some(rl) = CFRunLoop::main() {
                // SAFETY : source valide, mode statique.
                let source = unsafe { obs.run_loop_source() };
                rl.add_source(Some(&source), unsafe { kCFRunLoopCommonModes });
            }
            st.known = daw_windows(pid);
            trace(|| format!("tile : observateur du DAW (pid {pid}, {} fenêtres)", st.known.len()));
            st.observer = Some((pid, obs));
        });
    }

    pub fn set_full(full: bool) {
        trace(|| format!("tile : fenêtre bibliothèque {full}"));
        STATE.with_borrow_mut(|st| {
            st.full = full;
            st.drag = None;
        });
    }

    pub fn configure(on: bool, pid: Option<i32>) {
        trace(|| format!("tile : réglage {on}, DAW {pid:?}, autorisation {}", trusted(false)));
        STATE.with_borrow_mut(|st| {
            st.on = on;
            st.pid = pid;
        });
        ensure_observer();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(x: f64, y: f64, w: f64, h: f64) -> Rect {
        Rect { x, y, w, h }
    }

    #[test]
    fn fenetres_qui_se_touchent() {
        let c = r(0.0, 25.0, 320.0, 875.0);
        assert_eq!(adjacent(c, r(320.0, 25.0, 1100.0, 875.0)), Some((Side::DawRight, 0.0)));
        assert_eq!(adjacent(c, r(326.0, 40.0, 1100.0, 800.0)), Some((Side::DawRight, 6.0)), "quelques points d'écart");
        assert_eq!(adjacent(r(1120.0, 25.0, 320.0, 875.0), r(0.0, 25.0, 1118.0, 875.0)), Some((Side::DawLeft, 2.0)));
        assert_eq!(adjacent(c, r(360.0, 25.0, 1100.0, 875.0)), None, "trop loin");
        assert_eq!(adjacent(c, r(320.0, 700.0, 1100.0, 800.0)), None, "décalées verticalement");
    }

    #[test]
    fn le_suiveur_colle_au_bord() {
        let daw = r(320.0, 25.0, 1120.0, 875.0);
        // Crate (à gauche) passe de 320 à 400 de large : le DAW perd 80, son bord droit ne bouge pas.
        assert_eq!(follow(r(0.0, 25.0, 400.0, 875.0), daw, true, 0.0, DAW_MIN_W), r(400.0, 25.0, 1040.0, 875.0));
        // L'écart du départ est gardé.
        assert_eq!(follow(r(0.0, 25.0, 300.0, 875.0), daw, true, 4.0, DAW_MIN_W).x, 304.0);
        // Largeur minimale.
        assert_eq!(follow(r(0.0, 25.0, 1400.0, 875.0), daw, true, 0.0, DAW_MIN_W), r(1240.0, 25.0, 200.0, 875.0));
        // Crate à droite : le bord droit du DAW suit le bord gauche de Crate, son bord gauche reste.
        let left_daw = r(0.0, 25.0, 1120.0, 875.0);
        assert_eq!(follow(r(1000.0, 25.0, 440.0, 875.0), left_daw, false, 0.0, DAW_MIN_W), r(0.0, 25.0, 1000.0, 875.0));
        assert_eq!(follow(r(100.0, 25.0, 1340.0, 875.0), left_daw, false, 0.0, DAW_MIN_W).w, 200.0);
    }

    #[test]
    fn redimensionner_ou_deplacer() {
        let before = r(320.0, 25.0, 1120.0, 875.0);
        // DAW à droite de Crate, tiré par son bord gauche (intérieur).
        assert!(is_inner_resize(before, r(400.0, 25.0, 1040.0, 875.0), false));
        // Déplacé par sa barre titre : les deux bords bougent.
        assert!(!is_inner_resize(before, r(400.0, 25.0, 1120.0, 875.0), false));
        // Tiré par son bord extérieur (droit) : pas pour nous.
        assert!(!is_inner_resize(before, r(320.0, 25.0, 1000.0, 875.0), false));
        // DAW à gauche, tiré par son bord droit (intérieur).
        assert!(is_inner_resize(r(0.0, 25.0, 1120.0, 875.0), r(0.0, 25.0, 1000.0, 875.0), true));
        assert!(!is_inner_resize(before, before, false), "rien n'a bougé");
    }
}
