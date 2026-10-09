//! Lecture et pics sur de vrais fichiers WAV. Le lecteur tourne ici sans périphérique audio (lecture muette
//! au rythme réel) : on vérifie la latence de démarrage, la position, le déplacement, la boucle et l'arrêt.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate_core::audio::{compute_peaks, Player, PEAKS};
use crate_core::PlaybackStatus;

fn tmp(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("crate-audio-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&d);
    fs::create_dir_all(&d).unwrap();
    d
}

/// WAV 16 bits ; `f(t)` donne l'échantillon (-1..1) à la seconde t.
fn wav(path: &Path, rate: u32, channels: u16, secs: f32, f: impl Fn(f32) -> f32) {
    let frames = (rate as f32 * secs) as u32;
    let block = channels as u32 * 2;
    let mut b = Vec::new();
    b.extend_from_slice(b"RIFF");
    b.extend_from_slice(&(36 + frames * block).to_le_bytes());
    b.extend_from_slice(b"WAVEfmt ");
    b.extend_from_slice(&16u32.to_le_bytes());
    b.extend_from_slice(&1u16.to_le_bytes());
    b.extend_from_slice(&channels.to_le_bytes());
    b.extend_from_slice(&rate.to_le_bytes());
    b.extend_from_slice(&(rate * block).to_le_bytes());
    b.extend_from_slice(&(block as u16).to_le_bytes());
    b.extend_from_slice(&16u16.to_le_bytes());
    b.extend_from_slice(b"data");
    b.extend_from_slice(&(frames * block).to_le_bytes());
    for i in 0..frames {
        let v = (f(i as f32 / rate as f32).clamp(-1.0, 1.0) * 32767.0) as i16;
        for _ in 0..channels {
            b.extend_from_slice(&v.to_le_bytes());
        }
    }
    fs::write(path, b).unwrap();
}

fn sine(t: f32) -> f32 {
    (t * 440.0 * std::f32::consts::TAU).sin()
}

#[test]
fn pics_d_un_fichier() {
    let d = tmp("peaks");
    let p = d.join("half.wav");
    // Silence puis sinus à 0,5 : la seconde moitié des pics est au maximum (normalisé).
    wav(&p, 44_100, 2, 1.0, |t| if t < 0.5 { 0.0 } else { 0.5 * sine(t) });
    let peaks = compute_peaks(&p).unwrap();
    assert_eq!(peaks.len(), PEAKS);
    assert!(peaks[..120].iter().all(|&x| x == 0), "silence");
    assert!(peaks[136..].iter().all(|&x| x > 240), "sinus normalisé");
    assert!(compute_peaks(&d.join("absent.wav")).is_none());
    let _ = fs::remove_dir_all(d);
}

struct Rec(Arc<Mutex<Vec<PlaybackStatus>>>);

impl Rec {
    fn player() -> (Player, Rec) {
        let log: Arc<Mutex<Vec<PlaybackStatus>>> = Arc::default();
        let l = log.clone();
        (Player::start_with(Arc::new(move |s| l.lock().unwrap().push(s)), true), Rec(log))
    }
    fn wait(&self, what: &str, ok: impl Fn(&[PlaybackStatus]) -> bool) {
        let t0 = Instant::now();
        while !ok(&self.0.lock().unwrap()) {
            assert!(t0.elapsed() < Duration::from_secs(5), "délai dépassé : {what}");
            std::thread::sleep(Duration::from_millis(10));
        }
    }
    fn last(&self) -> PlaybackStatus {
        self.0.lock().unwrap().last().cloned().unwrap()
    }
}

#[test]
fn lecture_latence_position_arret() {
    let d = tmp("play");
    let p = d.join("kick.wav");
    wav(&p, 48_000, 1, 0.3, sine);
    let (player, rec) = Rec::player();
    assert!(player.silent);
    player.play(7, p.clone(), 0, 300);
    rec.wait("premier son", |l| l.iter().any(|s| s.latency_ms.is_some()));
    let lat = rec.0.lock().unwrap().iter().find_map(|s| s.latency_ms).unwrap();
    assert!(lat < 30.0 + 33.0, "latence {lat} ms (budget 30 ms, + un tick de la lecture muette)");
    rec.wait("fin", |l| l.last().is_some_and(|s| !s.playing));
    let last = rec.last();
    assert_eq!((last.id, last.duration_ms, last.error), (7, 300, false));
    let positions: Vec<u32> = rec.0.lock().unwrap().iter().map(|s| s.position_ms).collect();
    assert!(positions.windows(2).all(|w| w[0] <= w[1]), "la position avance : {positions:?}");
    let _ = fs::remove_dir_all(d);
}

#[test]
fn deplacement_boucle_et_stop() {
    let d = tmp("seek");
    let p = d.join("loop.wav");
    wav(&p, 44_100, 2, 0.2, sine);
    let (player, rec) = Rec::player();
    player.set_loop(true);
    player.play(1, p.clone(), 150, 200);
    rec.wait("lecture", |l| l.iter().any(|s| s.playing));
    assert!(rec.0.lock().unwrap()[0].position_ms >= 150, "départ à 150 ms");
    std::thread::sleep(Duration::from_millis(500));
    assert!(rec.last().playing, "en boucle, un sample de 0,2 s joue encore après 0,5 s");
    assert!(rec.last().looping);
    player.stop();
    rec.wait("arrêt", |l| l.last().is_some_and(|s| !s.playing));
    let n = rec.0.lock().unwrap().len();
    std::thread::sleep(Duration::from_millis(120));
    assert_eq!(rec.0.lock().unwrap().len(), n, "plus rien après l'arrêt");
    // Fichier illisible : un seul statut, en erreur.
    player.play(2, d.join("absent.wav"), 0, 100);
    rec.wait("erreur", |l| l.last().is_some_and(|s| s.id == 2 && !s.playing));
    assert!(rec.last().error);
    let _ = fs::remove_dir_all(d);
}
