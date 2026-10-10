//! Fichiers MIDI : index, préécoute au piano, waveform, analyse (tempo et tonalité lus dans les notes).

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate_core::analysis::analyze;
use crate_core::audio::{compute_peaks, Player};
use crate_core::midi::Midi;
use crate_core::{Backend, PlaybackStatus, SampleKind, SqliteLibrary};

fn tmp(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("crate-midi-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&d);
    fs::create_dir_all(&d).unwrap();
    d
}

fn vlq(mut v: u32) -> Vec<u8> {
    let mut out = vec![(v & 0x7f) as u8];
    v >>= 7;
    while v > 0 {
        out.insert(0, (v & 0x7f) as u8 | 0x80);
        v >>= 7;
    }
    out
}

/// Note en temps (début, durée), en noires.
struct N {
    at: f64,
    len: f64,
    key: u8,
    ch: u8,
}

/// SMF format 1 : piste de tempo (+ signature), puis une piste de notes ; 480 ticks par noire.
fn smf(path: &Path, bpm: f64, beats: f64, notes: &[N]) {
    const TPQ: f64 = 480.0;
    let mut b = Vec::new();
    b.extend_from_slice(b"MThd");
    b.extend_from_slice(&6u32.to_be_bytes());
    b.extend_from_slice(&[0, 1, 0, 2]);
    b.extend_from_slice(&(TPQ as u16).to_be_bytes());
    let mut track = |body: Vec<u8>| {
        b.extend_from_slice(b"MTrk");
        b.extend_from_slice(&(body.len() as u32).to_be_bytes());
        b.extend_from_slice(&body);
    };
    let us = (60e6 / bpm).round() as u32;
    let mut t0 = vec![0, 0xff, 0x51, 3];
    t0.extend_from_slice(&us.to_be_bytes()[1..]);
    t0.extend_from_slice(&[0, 0xff, 0x58, 4, 4, 2, 24, 8, 0, 0xff, 0x2f, 0]);
    track(t0);
    let mut ev: Vec<(u32, bool, u8, u8)> = notes
        .iter()
        .flat_map(|n| {
            [
                ((n.at * TPQ) as u32, true, n.key, n.ch),
                (((n.at + n.len) * TPQ) as u32, false, n.key, n.ch),
            ]
        })
        .collect();
    ev.sort_by_key(|&(t, on, _, _)| (t, on));
    let (mut body, mut last) = (Vec::new(), 0u32);
    for (t, on, key, ch) in ev {
        body.extend(vlq(t - last));
        body.extend_from_slice(&[if on { 0x90 } else { 0x80 } | ch, key, if on { 96 } else { 64 }]);
        last = t;
    }
    body.extend(vlq(((beats * TPQ) as u32).saturating_sub(last)));
    body.extend_from_slice(&[0xff, 0x2f, 0]);
    track(body);
    fs::write(path, b).unwrap();
}

/// Progression d'accords (degré depuis la tonique, mineur ?), une mesure chacun, basse sur la fondamentale.
fn progression(tonic: u8, chords: &[(u8, bool)]) -> Vec<N> {
    let mut notes = Vec::new();
    for (i, &(deg, minor)) in chords.iter().enumerate() {
        let root = tonic + deg;
        let at = i as f64 * 4.0;
        notes.push(N {
            at,
            len: 4.0,
            key: root - 12,
            ch: 0,
        });
        for b in 0..4 {
            for iv in [0, if minor { 3 } else { 4 }, 7] {
                notes.push(N {
                    at: at + b as f64,
                    len: 0.9,
                    key: root + 12 + iv,
                    ch: 0,
                });
            }
        }
    }
    notes
}

#[test]
fn analyse_des_notes() {
    let d = tmp("analyse");
    // La mineur : Am – F – C – G, 95 BPM, 4 mesures, nom muet.
    let p = d.join("clip.mid");
    smf(&p, 95.0, 16.0, &progression(45, &[(0, true), (8, false), (3, false), (10, false)]));
    let a = analyze(&p).unwrap();
    assert_eq!((a.bpm, a.key.as_deref(), a.kind), (Some(95.0), Some("Am"), SampleKind::Loop));
    // Ré majeur : D – A – Bm – G.
    let p = d.join("pop.mid");
    smf(&p, 128.0, 16.0, &progression(50, &[(0, false), (7, false), (9, true), (5, false)]));
    assert_eq!(analyze(&p).unwrap().key.as_deref(), Some("D"));
    // Un accord seul : one-shot, pas de tempo.
    let p = d.join("chord.mid");
    smf(
        &p,
        120.0,
        4.0,
        &[
            N {
                at: 0.0,
                len: 4.0,
                key: 60,
                ch: 0,
            },
            N {
                at: 0.0,
                len: 4.0,
                key: 64,
                ch: 0,
            },
            N {
                at: 0.0,
                len: 4.0,
                key: 67,
                ch: 0,
            },
        ],
    );
    let a = analyze(&p).unwrap();
    assert_eq!((a.bpm, a.key.as_deref(), a.kind), (None, Some("C"), SampleKind::Oneshot));
    // Batterie (canal 10) : boucle, tempo, pas de tonalité.
    let p = d.join("beat.mid");
    let mut drums = Vec::new();
    for b in 0..8 {
        drums.push(N {
            at: b as f64,
            len: 0.25,
            key: 36,
            ch: 9,
        });
        drums.push(N {
            at: b as f64 + 0.5,
            len: 0.25,
            key: 42,
            ch: 9,
        });
        if b % 2 == 1 {
            drums.push(N {
                at: b as f64,
                len: 0.25,
                key: 38,
                ch: 9,
            });
        }
    }
    smf(&p, 172.0, 8.0, &drums);
    let a = analyze(&p).unwrap();
    assert_eq!((a.bpm, a.key, a.kind), (Some(172.0), None, SampleKind::Loop));
    // Le nom l'emporte.
    let p = d.join("Chords_Loop_100_F#m.mid");
    smf(&p, 95.0, 16.0, &progression(45, &[(0, true), (8, false), (3, false), (10, false)]));
    let a = analyze(&p).unwrap();
    assert_eq!((a.bpm, a.key.as_deref()), (Some(100.0), Some("F#m")));
    let _ = fs::remove_dir_all(d);
}

#[test]
fn index_waveform_et_lecture() {
    let d = tmp("index");
    let root = d.join("Samples");
    fs::create_dir_all(root.join("MIDI")).unwrap();
    smf(&root.join("MIDI/clip.mid"), 120.0, 8.0, &progression(48, &[(0, false), (5, false)]));
    fs::write(root.join("MIDI/broken.mid"), b"MThd garbage").unwrap();
    // Index : le .mid est un sample comme un autre, d'une durée de 2 mesures à 120 (4 s).
    let mut lib = SqliteLibrary::open_inline(&d.join("crate.db")).unwrap();
    lib.add_source(&root.to_string_lossy()).unwrap();
    let s = lib
        .catalog()
        .samples()
        .iter()
        .find(|s| s.name == "clip")
        .expect("clip.mid indexé")
        .clone();
    assert_eq!((s.ext.as_str(), s.duration_ms, s.sample_rate), ("mid", 4000, 0));
    assert!(
        lib.catalog().samples().iter().all(|s| s.name != "broken"),
        "un .mid illisible est ignoré"
    );
    // Analyse et waveform (le rendu au piano).
    assert_eq!(lib.analyze_pending(), 1);
    let s = lib.catalog().samples().iter().find(|s| s.name == "clip").unwrap();
    assert_eq!((s.bpm, s.key.as_deref(), s.kind), (Some(120.0), Some("C"), SampleKind::Loop));
    let peaks = compute_peaks(&root.join("MIDI/clip.mid")).unwrap();
    assert!(
        peaks.iter().filter(|&&p| p > 100).count() > 128,
        "le piano s'entend sur toute la durée"
    );
    assert_eq!(lib.peaks(s.id).len(), 256);
    // Lecture : premier son vite, position jusqu'à la fin, arrêt annoncé.
    let log: Arc<Mutex<Vec<PlaybackStatus>>> = Arc::default();
    let l = log.clone();
    let player = Player::start_with(Arc::new(move |st| l.lock().unwrap().push(st)), true);
    player.play(s.id, root.join("MIDI/clip.mid"), 3_000, 4_000);
    let t0 = Instant::now();
    loop {
        let done = log.lock().unwrap().last().is_some_and(|st| !st.playing);
        if done {
            break;
        }
        assert!(t0.elapsed() < Duration::from_secs(5), "la lecture doit finir");
        std::thread::sleep(Duration::from_millis(10));
    }
    let log = log.lock().unwrap();
    let lat = log.iter().find_map(|st| st.latency_ms).expect("latence mesurée");
    assert!(lat < 30.0 + 33.0, "latence {lat} ms");
    assert!(log.iter().any(|st| st.playing && st.position_ms >= 3_000), "départ à 3 s");
    assert!(!log.last().unwrap().error);
    // Rien n'a été écrit à côté des fichiers.
    let mut names: Vec<String> = fs::read_dir(root.join("MIDI"))
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    assert_eq!(names, ["broken.mid", "clip.mid"]);
    let _ = Midi::open(&root.join("MIDI/clip.mid")).unwrap();
    let _ = fs::remove_dir_all(d);
}

/// Tonalité lue dans les notes : 8 progressions courantes (dont les ambiguës vi–IV–I–V lues depuis la relative),
/// dans les 12 tonalités, noms muets.
#[test]
fn tonalites_des_progressions_courantes() {
    let d = tmp("keys");
    let major: [&[(u8, bool)]; 4] = [
        &[(0, false), (7, false), (9, true), (5, false)],
        &[(0, false), (5, false), (7, false), (0, false)],
        &[(0, false), (9, true), (5, false), (7, false)],
        // Ne commence pas sur la tonique : IV – V – I – I (le premier accord ne colle pas à la gamme).
        &[(5, false), (7, false), (0, false), (0, false)],
    ];
    let minor: [&[(u8, bool)]; 4] = [
        &[(0, true), (8, false), (3, false), (10, false)],
        &[(0, true), (5, true), (7, true), (0, true)],
        &[(0, true), (10, false), (8, false), (10, false)],
        &[(0, true), (5, true), (10, false), (3, false)],
    ];
    let (mut ok, mut n, mut bad) = (0, 0, Vec::new());
    for tonic in 0..12u8 {
        for (is_minor, progs) in [(false, &major), (true, &minor)] {
            for (j, prog) in progs.iter().enumerate() {
                let p = d.join(format!("k{tonic}_{is_minor}_{j}.mid"));
                smf(&p, 110.0, 16.0, &progression(45 + tonic, prog));
                let want = crate_core::analysis::key_name((9 + tonic) % 12, is_minor);
                let got = analyze(&p).unwrap().key;
                n += 1;
                if got.as_deref() == Some(want.as_str()) {
                    ok += 1;
                } else {
                    bad.push(format!("{want} (progression {j}) lu {got:?}"));
                }
            }
        }
    }
    println!("tonalité MIDI : {ok}/{n} ; erreurs : {bad:?}");
    assert!(ok * 100 >= n * 95, "{ok}/{n} : {bad:?}");
    let _ = fs::remove_dir_all(d);
}

/// Vitesse du synthé sur un clip chargé (accords de 4 notes en doubles-croches, 8 mesures, pédale tenue).
#[test]
fn vitesse_du_synthe() {
    let d = tmp("speed");
    let p = d.join("dense.mid");
    let mut notes = Vec::new();
    for i in 0..128 {
        let at = i as f64 * 0.25;
        for k in [48, 55, 60, 64, 67] {
            notes.push(N {
                at,
                len: 1.0,
                key: k + (i % 4) as u8,
                ch: 0,
            });
        }
    }
    smf(&p, 120.0, 32.0, &notes);
    let m = Midi::open(&p).unwrap();
    let t0 = Instant::now();
    let out = crate_core::midi::Synth::render_all(&m, 60.0);
    let secs = t0.elapsed().as_secs_f64();
    let audio = out.len() as f64 / crate_core::midi::RATE as f64;
    println!(
        "rendu : {audio:.1} s de son en {:.0} ms ({:.0}× le temps réel)",
        secs * 1000.0,
        audio / secs
    );
    assert!(audio / secs > 5.0, "le synthé doit tenir le temps réel avec de la marge");
    let _ = fs::remove_dir_all(d);
}
