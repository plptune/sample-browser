//! Deux modes d'affichage séparés : la colonne à côté du DAW, et la fenêtre bibliothèque qui remplit l'écran.
//!
//! Le mode n'est pas l'état « agrandi » de la fenêtre : il ne change que par le bouton de la barre titre ou ⌘⇧F.
//! Chacun impose ses contraintes, pour qu'aucun geste système (bouton vert, double-clic sur la barre titre, bord tiré)
//! ne fasse passer de l'un à l'autre :
//! - colonne : 180 à 600 points de large, ni agrandissement ni plein écran macOS ;
//! - bibliothèque (« Expanded ») : s'ouvre sur la zone utile de l'écran (sans barre des menus ni Dock), puis se
//!   redimensionne à la main jusqu'à 640 × 480 points (une autre app sur une moitié d'écran), sans agrandissement.
//!   C'est une fenêtre ordinaire : le panneau non activant et « Resize the DAW with Crate » ne servent qu'en colonne.
//!
//! Le cadre de la colonne est gardé par l'interface (réglages) : il lui est rendu en revenant en colonne.

use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, LogicalPosition, LogicalSize, State, WebviewWindow};

use crate::daw::DawShortcut;
use crate::{panel, tile, trace};

/// Mode bibliothèque en cours (lu par le raccourci du DAW et les réglages).
static FULL: AtomicBool = AtomicBool::new(false);

const SIDE_MIN_W: f64 = 180.0;
const SIDE_MIN_H: f64 = 320.0;
/// Au-delà, c'est la fenêtre bibliothèque qu'il faut : la colonne ne s'élargit pas plus.
pub const SIDE_MAX_W: f64 = 600.0;
/// Largeur de la colonne sans cadre gardé (comme au premier lancement).
const SIDE_W: f64 = 320.0;
/// Bibliothèque réduite à la main : l'explorer (200 px au moins) et la liste (420 px) tiennent côte à côte.
const FULL_MIN_W: f64 = 640.0;
const FULL_MIN_H: f64 = 480.0;

/// Cadre d'une fenêtre, en points (repère de Tauri : origine en haut à gauche de l'écran principal).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct Frame {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Frame {
    fn intersects(&self, o: &Frame) -> bool {
        self.x < o.x + o.w && o.x < self.x + self.w && self.y < o.y + o.h && o.y < self.y + self.h
    }
}

pub fn is_full() -> bool {
    FULL.load(Ordering::Relaxed)
}

fn frame(w: &WebviewWindow) -> tauri::Result<Frame> {
    let k = w.scale_factor()?;
    let p = w.outer_position()?.to_logical::<f64>(k);
    let s = w.outer_size()?.to_logical::<f64>(k);
    Ok(Frame {
        x: p.x,
        y: p.y,
        w: s.width,
        h: s.height,
    })
}

fn work_area(m: &tauri::Monitor) -> Frame {
    let k = m.scale_factor();
    let a = m.work_area();
    let p = a.position.to_logical::<f64>(k);
    let s = a.size.to_logical::<f64>(k);
    Frame {
        x: p.x,
        y: p.y,
        w: s.width,
        h: s.height,
    }
}

fn place(w: &WebviewWindow, f: Frame) -> tauri::Result<()> {
    w.set_size(LogicalSize::new(f.w, f.h))?;
    w.set_position(LogicalPosition::new(f.x, f.y))
}

/// Passe en fenêtre bibliothèque (`full`) ou en colonne. En colonne, `side` est le cadre à retrouver (ignoré s'il
/// n'est plus sur un écran). Rend le cadre de la colonne quittée, à garder pour le retour.
#[tauri::command]
#[specta::specta]
pub fn set_window_mode(
    app: AppHandle,
    window: WebviewWindow,
    daw: State<'_, DawShortcut>,
    full: bool,
    side: Option<Frame>,
) -> Result<Option<Frame>, String> {
    let was_full = FULL.swap(full, Ordering::Relaxed);
    let r = (|| -> tauri::Result<Option<Frame>> {
        let area = window.current_monitor()?.map(|m| work_area(&m));
        if full {
            let left = (!was_full).then(|| frame(&window)).transpose()?;
            // Agrandie par une version précédente (ou par le pavage de macOS) : on repart d'une fenêtre normale.
            if window.is_maximized()? {
                window.unmaximize()?;
            }
            window.set_max_size(None::<LogicalSize<f64>>)?;
            window.set_min_size(Some(LogicalSize::new(FULL_MIN_W, FULL_MIN_H)))?;
            window.set_maximizable(false)?;
            window.set_resizable(true)?;
            if let Some(a) = area {
                place(&window, a)?;
            }
            return Ok(left);
        }
        window.set_resizable(true)?;
        window.set_maximizable(false)?;
        if window.is_maximized()? {
            window.unmaximize()?;
        }
        window.set_min_size(Some(LogicalSize::new(SIDE_MIN_W, SIDE_MIN_H)))?;
        window.set_max_size(Some(LogicalSize::new(SIDE_MAX_W, 100_000.0)))?;
        let screens: Vec<Frame> = window.available_monitors()?.iter().map(work_area).collect();
        let saved = side.filter(|f| screens.iter().any(|s| s.intersects(f)));
        // Sans cadre gardé : la colonne d'origine en revenant de la bibliothèque, sinon la fenêtre reste où elle est.
        let fallback = area.filter(|_| was_full).map(|a| Frame {
            x: a.x + a.w - SIDE_W,
            y: a.y,
            w: SIDE_W,
            h: a.h,
        });
        if let Some(f) = saved.or(fallback) {
            place(
                &window,
                Frame {
                    w: f.w.clamp(SIDE_MIN_W, SIDE_MAX_W),
                    h: f.h.max(SIDE_MIN_H),
                    ..f
                },
            )?;
        }
        Ok(None)
    })();
    trace(|| {
        format!(
            "mode : {} (avant : {})",
            if full { "bibliothèque" } else { "colonne" },
            if was_full { "bibliothèque" } else { "colonne" }
        )
    });
    tile::set_full(&app, full);
    panel::set_non_activating(&app, !full && daw.keep_daw_active());
    r.map_err(|e| e.to_string())
}
