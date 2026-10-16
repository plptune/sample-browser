//! « Space plays Bitwig » : Crate pilote le transport de Bitwig par son script de contrôleur (`bitwig/Crate.control.js`).
//!
//! OSC sur UDP, en local : Crate envoie `/crate/toggle` et `/crate/ping` au port 9070 du script ; le script renvoie
//! `/crate/state i` (1 = lecture) au port 9071, à chaque changement du transport et en réponse au ping. Un seul fil
//! écoute 9071, ping toutes les 2 s tant que le réglage est actif, et prévient l'interface (`BitwigStateEvent`) quand
//! l'état change : « connecté » = une réponse il y a moins de 5 s. Aucune autorisation macOS n'est demandée.
//!
//! Les ports 9000 / 9001 sont pris par un autre script de la machine (ChorusBench) : à ne pas réutiliser.

use std::net::{SocketAddr, UdpSocket};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime, State};
use tauri_specta::Event;

use crate::trace;

/// Port du script dans Bitwig (Crate → Bitwig).
pub const TO_BITWIG: u16 = 9070;
/// Port de Crate (Bitwig → Crate).
pub const FROM_BITWIG: u16 = 9071;
const PING_EVERY: Duration = Duration::from_secs(2);
const ALIVE: Duration = Duration::from_secs(5);

/// Le script, copié par « Install Bitwig script ».
const SCRIPT: &str = include_str!("../../bitwig/Crate.control.js");

/// État vu par les Réglages.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BitwigState {
    /// Le script a répondu il y a moins de 5 s.
    pub connected: bool,
    /// Transport de Bitwig en lecture (dernier état reçu).
    pub playing: bool,
    /// Problème à afficher tel quel (port 9071 déjà pris).
    pub error: Option<String>,
}

/// L'état a changé (connexion, transport).
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct BitwigStateEvent(BitwigState);

#[derive(Default)]
struct Inner {
    enabled: bool,
    last_seen: Option<Instant>,
    playing: bool,
    error: Option<String>,
    /// Dernier état envoyé à l'interface : on ne prévient que des changements.
    emitted: Option<BitwigState>,
}

impl Inner {
    fn state(&self, now: Instant) -> BitwigState {
        BitwigState {
            connected: connected(self.last_seen, now),
            playing: self.playing,
            error: self.error.clone(),
        }
    }
}

/// Réponse reçue il y a moins de 5 s.
fn connected(last_seen: Option<Instant>, now: Instant) -> bool {
    last_seen.is_some_and(|t| now.saturating_duration_since(t) < ALIVE)
}

#[derive(Default)]
pub struct Bitwig {
    inner: Arc<Mutex<Inner>>,
    sock: Option<UdpSocket>,
}

impl Bitwig {
    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn send(&self, address: &str) -> bool {
        let Some(sock) = &self.sock else { return false };
        sock.send_to(&encode(address, &[]), SocketAddr::from(([127, 0, 0, 1], TO_BITWIG))).is_ok()
    }
}

/// Démarrage : écoute du port 9071 et fil de réception / ping.
pub fn setup<R: Runtime>(app: &tauri::App<R>) {
    let mut state = Bitwig::default();
    match UdpSocket::bind(SocketAddr::from(([127, 0, 0, 1], FROM_BITWIG))) {
        Ok(sock) => {
            let _ = sock.set_read_timeout(Some(Duration::from_millis(250)));
            match sock.try_clone() {
                Ok(rx) => {
                    let inner = state.inner.clone();
                    let handle = app.handle().clone();
                    std::thread::Builder::new()
                        .name("crate-bitwig".into())
                        .spawn(move || {
                            run(rx, SocketAddr::from(([127, 0, 0, 1], TO_BITWIG)), inner, move |s| {
                                let _ = BitwigStateEvent(s).emit(&handle);
                            })
                        })
                        .ok();
                }
                Err(e) => state.lock().error = Some(format!("Can't listen to Bitwig: {e}")),
            }
            state.sock = Some(sock);
        }
        Err(e) => {
            trace(|| format!("bitwig : port {FROM_BITWIG} indisponible ({e})"));
            state.lock().error = Some(format!("Port {FROM_BITWIG} is used by another app: Crate can't hear Bitwig"));
        }
    }
    app.manage(state);
}

/// Fil de réception : `/crate/state`, ping régulier tant que le réglage est actif, changements vers l'interface.
fn run(sock: UdpSocket, to: SocketAddr, inner: Arc<Mutex<Inner>>, emit: impl Fn(BitwigState)) {
    let mut buf = [0u8; 1024];
    let mut last_ping: Option<Instant> = None;
    loop {
        match sock.recv_from(&mut buf) {
            Ok((n, _)) => {
                for (address, args) in decode(&buf[..n]) {
                    if address == "/crate/state" {
                        let mut g = inner.lock().unwrap_or_else(|e| e.into_inner());
                        g.last_seen = Some(Instant::now());
                        g.playing = args.first().is_some_and(|&v| v != 0);
                    }
                }
            }
            Err(e) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => {}
            // Autre erreur (rendue tout de suite) : on ne tourne pas à vide.
            Err(_) => std::thread::sleep(Duration::from_millis(250)),
        }
        let now = Instant::now();
        let changed = {
            let mut g = inner.lock().unwrap_or_else(|e| e.into_inner());
            if g.enabled && last_ping.is_none_or(|t| now.duration_since(t) >= PING_EVERY) {
                let _ = sock.send_to(&encode("/crate/ping", &[]), to);
                last_ping = Some(now);
            }
            if !g.enabled {
                last_ping = None; // réactivé : ping tout de suite
            }
            let s = g.state(now);
            (g.emitted.as_ref() != Some(&s)).then(|| {
                g.emitted = Some(s.clone());
                s
            })
        };
        if let Some(s) = changed {
            trace(|| format!("bitwig : {s:?}"));
            emit(s);
        }
    }
}

/// Réglage « Space plays Bitwig » (pris avec les autres réglages du DAW) : ping seulement s'il est actif.
pub fn set_enabled<R: Runtime>(app: &AppHandle<R>, on: bool) {
    if let Some(b) = app.try_state::<Bitwig>() {
        b.lock().enabled = on;
    }
}

/// Espace dans Crate : lecture / arrêt du transport de Bitwig. Faux si Bitwig ne répond pas.
#[tauri::command]
#[specta::specta]
pub fn bitwig_toggle_play(state: State<'_, Bitwig>) -> bool {
    let alive = connected(state.lock().last_seen, Instant::now());
    let sent = state.send("/crate/toggle");
    trace(|| format!("bitwig : toggle (envoyé {sent}, connecté {alive})"));
    sent && alive
}

/// État courant (Réglages ouverts avant le premier événement).
#[tauri::command]
#[specta::specta]
pub fn bitwig_status(state: State<'_, Bitwig>) -> BitwigState {
    state.lock().state(Instant::now())
}

/// Copie le script dans ~/Documents/Bitwig Studio/Controller Scripts/Crate/ ; renvoie son chemin.
#[tauri::command]
#[specta::specta]
pub fn install_bitwig_script(app: AppHandle) -> Result<String, String> {
    let docs = app.path().document_dir().map_err(|e| format!("Documents folder not found: {e}"))?;
    let path = install_to(&docs).map_err(|e| format!("Can't install the Bitwig script: {e}"))?;
    trace(|| format!("bitwig : script installé dans {}", path.display()));
    Ok(path.to_string_lossy().into_owned())
}

/// Emplacement du script sous le dossier Documents (là où Bitwig cherche les scripts de contrôleur).
fn script_path(documents: &Path) -> PathBuf {
    documents.join("Bitwig Studio").join("Controller Scripts").join("Crate").join("Crate.control.js")
}

fn install_to(documents: &Path) -> std::io::Result<PathBuf> {
    let path = script_path(documents);
    std::fs::create_dir_all(path.parent().expect("dossier du script"))?;
    std::fs::write(&path, SCRIPT)?;
    Ok(path)
}

// --- OSC minimal : adresse, étiquettes de type (« , » puis « i »…), arguments big-endian, alignés sur 4 octets.

fn push_padded(out: &mut Vec<u8>, s: &str) {
    out.extend_from_slice(s.as_bytes());
    out.push(0);
    while !out.len().is_multiple_of(4) {
        out.push(0);
    }
}

/// Message OSC à arguments entiers.
fn encode(address: &str, args: &[i32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(32);
    push_padded(&mut out, address);
    push_padded(&mut out, &format!(",{}", "i".repeat(args.len())));
    for a in args {
        out.extend_from_slice(&a.to_be_bytes());
    }
    out
}

/// Chaîne OSC à `at` : son texte et la position qui suit son bourrage. `None` si elle déborde.
fn read_padded(buf: &[u8], at: usize) -> Option<(&str, usize)> {
    let rest = buf.get(at..)?;
    let len = rest.iter().position(|&b| b == 0)?;
    let s = std::str::from_utf8(&rest[..len]).ok()?;
    let next = at + (len + 4) / 4 * 4;
    (next <= buf.len()).then_some((s, next))
}

fn read_word<const N: usize>(buf: &[u8], at: usize) -> Option<[u8; N]> {
    buf.get(at..at + N)?.try_into().ok()
}

/// Un message : adresse et arguments numériques (i, f, d, T, F ramenés à des entiers). `None` si malformé ou si un
/// argument est d'un autre type.
fn decode_message(buf: &[u8]) -> Option<(String, Vec<i32>)> {
    let (address, mut at) = read_padded(buf, 0)?;
    if !address.starts_with('/') {
        return None;
    }
    if at >= buf.len() {
        return Some((address.to_owned(), Vec::new())); // sans étiquettes de type (ancien OSC)
    }
    let (tags, next) = read_padded(buf, at)?;
    let tags = tags.strip_prefix(',')?;
    at = next;
    let mut args = Vec::with_capacity(tags.len());
    for t in tags.chars() {
        match t {
            'i' => {
                args.push(i32::from_be_bytes(read_word(buf, at)?));
                at += 4;
            }
            'f' => {
                args.push(f32::from_be_bytes(read_word(buf, at)?).round() as i32);
                at += 4;
            }
            'd' => {
                args.push(f64::from_be_bytes(read_word(buf, at)?).round() as i32);
                at += 8;
            }
            'T' => args.push(1),
            'F' => args.push(0),
            _ => return None,
        }
    }
    Some((address.to_owned(), args))
}

/// Un paquet : un message, ou un bundle (« #bundle », horodatage, éléments préfixés de leur taille). Malformé : vide.
fn decode(buf: &[u8]) -> Vec<(String, Vec<i32>)> {
    const BUNDLE: &[u8] = b"#bundle\0";
    if !buf.starts_with(BUNDLE) {
        return decode_message(buf).into_iter().collect();
    }
    let mut out = Vec::new();
    let mut at = BUNDLE.len() + 8;
    while let Some(size) = read_word::<4>(buf, at) {
        let size = u32::from_be_bytes(size) as usize;
        let Some(element) = buf.get(at + 4..at + 4 + size) else { return Vec::new() };
        out.extend(decode(element));
        at += 4 + size;
    }
    if at != buf.len() {
        return Vec::new();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn osc_aller_retour() {
        let b = encode("/crate/state", &[1]);
        assert_eq!(b.len() % 4, 0);
        assert_eq!(&b[..16], b"/crate/state\0\0\0\0");
        assert_eq!(&b[16..20], b",i\0\0");
        assert_eq!(&b[20..], &[0, 0, 0, 1]);
        assert_eq!(decode(&b), vec![("/crate/state".to_owned(), vec![1])]);
        let ping = encode("/crate/ping", &[]);
        assert_eq!(ping, b"/crate/ping\0,\0\0\0");
        assert_eq!(decode(&ping), vec![("/crate/ping".to_owned(), vec![])]);
    }

    #[test]
    fn osc_autres_types_et_bundle() {
        // /crate/state d 1.0 (un double, si Bitwig convertit l'entier)
        let mut d = Vec::new();
        push_padded(&mut d, "/crate/state");
        push_padded(&mut d, ",d");
        d.extend_from_slice(&1.0f64.to_be_bytes());
        assert_eq!(decode(&d), vec![("/crate/state".to_owned(), vec![1])]);
        let mut f = Vec::new();
        push_padded(&mut f, "/crate/state");
        push_padded(&mut f, ",F");
        assert_eq!(decode(&f), vec![("/crate/state".to_owned(), vec![0])]);

        let msg = encode("/crate/state", &[0]);
        let mut bundle = b"#bundle\0".to_vec();
        bundle.extend_from_slice(&[0, 0, 0, 0, 0, 0, 0, 1]);
        bundle.extend_from_slice(&(msg.len() as u32).to_be_bytes());
        bundle.extend_from_slice(&msg);
        assert_eq!(decode(&bundle), vec![("/crate/state".to_owned(), vec![0])]);
    }

    #[test]
    fn osc_malforme_rejete() {
        let b = encode("/crate/state", &[1]);
        assert!(decode(&b[..b.len() - 2]).is_empty(), "argument tronqué");
        assert!(decode(b"/crate/state").is_empty(), "adresse sans fin");
        assert!(decode(b"crate\0\0\0,i\0\0\0\0\0\x01").is_empty(), "adresse sans /");
        assert!(decode(b"/a\0\0i\0\0\0\0\0\0\x01").is_empty(), "étiquettes sans virgule");
        let mut s = Vec::new();
        push_padded(&mut s, "/crate/state");
        push_padded(&mut s, ",s");
        push_padded(&mut s, "x");
        assert!(decode(&s).is_empty(), "type non lu");
        let mut bundle = b"#bundle\0\0\0\0\0\0\0\0\x01".to_vec();
        bundle.extend_from_slice(&[0, 0, 0, 99]);
        assert!(decode(&bundle).is_empty(), "élément de bundle trop long");
        assert!(decode(&[]).is_empty());
    }

    #[test]
    fn chemin_d_installation() {
        let docs = std::env::temp_dir().join(format!("crate-bitwig-{}", std::process::id()));
        assert_eq!(
            script_path(&docs),
            docs.join("Bitwig Studio/Controller Scripts/Crate/Crate.control.js")
        );
        let path = install_to(&docs).expect("installation");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), SCRIPT);
        assert!(SCRIPT.contains("/crate/toggle") && SCRIPT.contains(&TO_BITWIG.to_string()));
        install_to(&docs).expect("réinstallation : remplacé");
        let _ = std::fs::remove_dir_all(&docs);
    }

    /// Faux Bitwig sur de vrais sockets UDP (ports libres) : répond au ping, bascule son transport au toggle.
    #[test]
    fn ping_etat_et_toggle_avec_un_faux_bitwig() {
        use std::sync::mpsc;
        let local = |p| SocketAddr::from(([127, 0, 0, 1], p));
        let fake = UdpSocket::bind(local(0)).unwrap();
        let fake_addr = fake.local_addr().unwrap();
        let crate_sock = UdpSocket::bind(local(0)).unwrap();
        crate_sock.set_read_timeout(Some(Duration::from_millis(50))).unwrap();
        let crate_addr = crate_sock.local_addr().unwrap();
        let tx_sock = crate_sock.try_clone().unwrap();

        std::thread::spawn(move || {
            let mut playing = 0;
            let mut buf = [0u8; 256];
            while let Ok((n, _)) = fake.recv_from(&mut buf) {
                for (address, _) in decode(&buf[..n]) {
                    match address.as_str() {
                        "/crate/toggle" => playing = 1 - playing,
                        "/crate/ping" => {}
                        _ => continue,
                    }
                    let _ = fake.send_to(&encode("/crate/state", &[playing]), crate_addr);
                }
            }
        });

        let inner = Arc::new(Mutex::new(Inner { enabled: true, ..Default::default() }));
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || run(crate_sock, fake_addr, inner, move |s| drop(tx.send(s))));
        let wait_for = |want: &BitwigState| {
            let deadline = Instant::now() + Duration::from_secs(3);
            while Instant::now() < deadline {
                if rx.recv_timeout(Duration::from_millis(100)).is_ok_and(|s| &s == want) {
                    return true;
                }
            }
            false
        };
        let state = |connected, playing| BitwigState { connected, playing, error: None };
        assert!(wait_for(&state(true, false)), "le ping fait répondre Bitwig : connecté");
        tx_sock.send_to(&encode("/crate/toggle", &[]), fake_addr).unwrap();
        assert!(wait_for(&state(true, true)), "toggle : Bitwig en lecture");
        tx_sock.send_to(&encode("/crate/toggle", &[]), fake_addr).unwrap();
        assert!(wait_for(&state(true, false)), "second toggle : arrêt");
    }

    /// Contre un autre encodeur OSC, sur les vrais ports : lancer d'abord un répondeur qui écoute 9070 et renvoie
    /// `/crate/state i` sur 9071 (ou le script dans Bitwig), Crate fermé, puis `cargo test -- --ignored`.
    #[test]
    #[ignore = "demande un répondeur OSC sur 127.0.0.1:9070"]
    fn vrais_ports_avec_un_repondeur() {
        use std::sync::mpsc;
        let sock = UdpSocket::bind(SocketAddr::from(([127, 0, 0, 1], FROM_BITWIG))).expect("port 9071 libre");
        sock.set_read_timeout(Some(Duration::from_millis(50))).unwrap();
        let tx_sock = sock.try_clone().unwrap();
        let to = SocketAddr::from(([127, 0, 0, 1], TO_BITWIG));
        let inner = Arc::new(Mutex::new(Inner { enabled: true, ..Default::default() }));
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || run(sock, to, inner, move |s| drop(tx.send(s))));
        let wait_for = |connected, playing| {
            let deadline = Instant::now() + Duration::from_secs(5);
            while Instant::now() < deadline {
                if rx.recv_timeout(Duration::from_millis(100)).is_ok_and(|s| s.connected == connected && s.playing == playing) {
                    return true;
                }
            }
            false
        };
        assert!(wait_for(true, false), "répond au ping");
        tx_sock.send_to(&encode("/crate/toggle", &[]), to).unwrap();
        assert!(wait_for(true, true), "lecture");
        tx_sock.send_to(&encode("/crate/toggle", &[]), to).unwrap();
        assert!(wait_for(true, false), "arrêt");
    }

    #[test]
    fn connecte_selon_la_derniere_reponse() {
        let now = Instant::now() + Duration::from_secs(60);
        assert!(!connected(None, now), "jamais répondu");
        assert!(connected(Some(now - Duration::from_secs(1)), now));
        assert!(!connected(Some(now - ALIVE), now), "5 s sans réponse");
        let inner = Inner { last_seen: Some(now), playing: true, ..Default::default() };
        assert_eq!(inner.state(now), BitwigState { connected: true, playing: true, error: None });
    }
}
