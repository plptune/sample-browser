//! Analyse de fond (phase 6) sur un jeu test annoté.
//!
//! Le jeu est synthétisé ici, de façon déterministe : boucles de batterie (6 motifs, 70 à 174 BPM, 1 à 4 mesures,
//! certaines avec un bout de silence en trop ou du swing), boucles tonales dans les 24 tonalités (basse + accords,
//! progressions courantes), one-shots de batterie et one-shots tonals (note, accord, nappe). Les fichiers portent
//! des noms neutres (`t017.wav`) : seul l'audio compte. Critère de sortie : les filtres `bpm:` et `key:`
//! renvoient les bons fichiers.
//!
//! `CRATE_ANALYSIS_DIR=/chemin cargo test --release -p crate-core --test analysis -- --ignored --nocapture`
//! compare l'audio aux noms d'un vrai dossier de samples (les noms des packs servent d'annotation).

use std::f32::consts::TAU;
use std::fs;
use std::path::{Path, PathBuf};

use crate_core::analysis::{analyze, parse_key, parse_name, read_acid};
use crate_core::SampleKind;

fn tmp(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("crate-analysis-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&d);
    fs::create_dir_all(&d).unwrap();
    d
}

/// Générateur pseudo-aléatoire (xorshift), pour un jeu identique à chaque fois.
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> f32 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0 >> 40) as f32 / (1u64 << 24) as f32
    }
    fn noise(&mut self) -> f32 {
        self.next() * 2.0 - 1.0
    }
}

/// WAV 16 bits ; `acid` = (drapeaux, note de base, tempo).
fn write_wav(path: &Path, rate: u32, channels: u16, x: &[f32], acid: Option<(u32, u16, f32)>) {
    let peak = x.iter().fold(0f32, |m, v| m.max(v.abs())).max(1e-6);
    let gain = 0.9 / peak;
    let block = channels as u32 * 2;
    let data_len = x.len() as u32 * block;
    let acid_len = if acid.is_some() { 8 + 24 } else { 0 };
    let mut b = Vec::with_capacity(44 + data_len as usize);
    b.extend_from_slice(b"RIFF");
    b.extend_from_slice(&(36 + acid_len + data_len).to_le_bytes());
    b.extend_from_slice(b"WAVEfmt ");
    b.extend_from_slice(&16u32.to_le_bytes());
    b.extend_from_slice(&1u16.to_le_bytes());
    b.extend_from_slice(&channels.to_le_bytes());
    b.extend_from_slice(&rate.to_le_bytes());
    b.extend_from_slice(&(rate * block).to_le_bytes());
    b.extend_from_slice(&(block as u16).to_le_bytes());
    b.extend_from_slice(&16u16.to_le_bytes());
    if let Some((flags, root, tempo)) = acid {
        b.extend_from_slice(b"acid");
        b.extend_from_slice(&24u32.to_le_bytes());
        b.extend_from_slice(&flags.to_le_bytes());
        b.extend_from_slice(&root.to_le_bytes());
        b.extend_from_slice(&0x8000u16.to_le_bytes());
        b.extend_from_slice(&0f32.to_le_bytes());
        b.extend_from_slice(&8u32.to_le_bytes());
        b.extend_from_slice(&4u16.to_le_bytes());
        b.extend_from_slice(&4u16.to_le_bytes());
        b.extend_from_slice(&tempo.to_le_bytes());
    }
    b.extend_from_slice(b"data");
    b.extend_from_slice(&data_len.to_le_bytes());
    for v in x {
        let s = ((v * gain).clamp(-1.0, 1.0) * 32767.0) as i16;
        for _ in 0..channels {
            b.extend_from_slice(&s.to_le_bytes());
        }
    }
    fs::write(path, b).unwrap();
}

// ---------- instruments ----------

fn add(buf: &mut [f32], at: usize, sound: &[f32], gain: f32) {
    for (i, v) in sound.iter().enumerate() {
        if let Some(b) = buf.get_mut(at + i) {
            *b += v * gain;
        }
    }
}

fn kick(rate: f32) -> Vec<f32> {
    (0..(rate * 0.4) as usize)
        .map(|i| {
            let t = i as f32 / rate;
            let phase = TAU * (50.0 * t + 100.0 / 30.0 * (1.0 - (-30.0 * t).exp()));
            phase.sin() * (-8.0 * t).exp()
        })
        .collect()
}

fn snare(rate: f32, rng: &mut Rng) -> Vec<f32> {
    (0..(rate * 0.25) as usize)
        .map(|i| {
            let t = i as f32 / rate;
            0.6 * rng.noise() * (-18.0 * t).exp() + 0.5 * (TAU * 185.0 * t).sin() * (-25.0 * t).exp()
        })
        .collect()
}

fn hat(rate: f32, rng: &mut Rng) -> Vec<f32> {
    let mut prev = 0.0;
    (0..(rate * 0.08) as usize)
        .map(|i| {
            let t = i as f32 / rate;
            let n = rng.noise();
            let v = (n - prev) * 0.35 * (-55.0 * t).exp();
            prev = n;
            v
        })
        .collect()
}

fn clap(rate: f32, rng: &mut Rng) -> Vec<f32> {
    (0..(rate * 0.3) as usize)
        .map(|i| {
            let t = i as f32 / rate;
            let bursts: f32 = [0.0, 0.011, 0.022]
                .iter()
                .map(|&b| if t >= b { (-60.0 * (t - b)).exp() } else { 0.0 })
                .sum();
            rng.noise() * (bursts + 0.4 * (-12.0 * t).exp())
        })
        .collect()
}

fn midi_hz(m: f32) -> f32 {
    440.0 * 2f32.powf((m - 69.0) / 12.0)
}

/// Note harmonique (6 harmoniques en 1/h), attaque 5 ms, déclin `decay` (par seconde), longueur `len` s.
fn note(rate: f32, midi: f32, len: f32, decay: f32, bright: f32) -> Vec<f32> {
    let f = midi_hz(midi);
    let n = (rate * len) as usize;
    (0..n)
        .map(|i| {
            let t = i as f32 / rate;
            let env = (t / 0.005).min(1.0) * (-decay * t).exp() * ((len - t) / 0.01).clamp(0.0, 1.0);
            let s: f32 = (1..=6)
                .filter(|h| f * *h as f32 * 2.0 < rate)
                .map(|h| (TAU * f * h as f32 * t).sin() / (h as f32).powf(bright))
                .sum();
            s * env
        })
        .collect()
}

// ---------- jeu test ----------

#[derive(Debug, Clone)]
struct Case {
    file: PathBuf,
    what: String,
    bpm: Option<f64>,
    /// (classe de hauteur, mineur), `None` = pas de tonalité attendue (batterie).
    key: Option<(u8, bool)>,
    kind: SampleKind,
}

/// Motifs sur une grille de 16 doubles-croches : (pas, instrument, vélocité). 0 kick, 1 snare, 2 hat, 3 clap.
fn pattern(name: &str) -> Vec<(u32, u8, f32)> {
    let mut p = Vec::new();
    match name {
        "four" => {
            for s in [0, 4, 8, 12] {
                p.push((s, 0, 1.0));
            }
            for s in [4, 12] {
                p.push((s, 3, 0.8));
            }
            for s in [2, 6, 10, 14] {
                p.push((s, 2, 0.9));
            }
        }
        "hiphop" => {
            for s in [0, 7, 10] {
                p.push((s, 0, 1.0));
            }
            for s in [4, 12] {
                p.push((s, 1, 1.0));
            }
            for s in (0..16).step_by(2) {
                p.push((s, 2, if s % 4 == 0 { 0.9 } else { 0.6 }));
            }
        }
        "break" => {
            for s in [0, 10] {
                p.push((s, 0, 1.0));
            }
            for s in [4, 12] {
                p.push((s, 1, 1.0));
            }
            p.push((15, 1, 0.5));
            for s in 0..16 {
                p.push((s, 2, if s % 2 == 0 { 0.8 } else { 0.4 }));
            }
        }
        "dnb" => {
            for s in [0, 10] {
                p.push((s, 0, 1.0));
            }
            for s in [4, 12] {
                p.push((s, 1, 1.0));
            }
            for s in (0..16).step_by(2) {
                p.push((s, 2, 0.6));
            }
        }
        "rock" => {
            for s in [0, 8, 10] {
                p.push((s, 0, 1.0));
            }
            for s in [4, 12] {
                p.push((s, 1, 1.0));
            }
            for s in (0..16).step_by(2) {
                p.push((s, 2, 0.7));
            }
        }
        _ => {
            // « shaker » : kick discret, hats en doubles-croches accentuées sur les temps.
            for s in [0, 8] {
                p.push((s, 0, 0.7));
            }
            for s in 0..16 {
                p.push((s, 2, if s % 4 == 0 { 1.0 } else { 0.45 }));
            }
        }
    }
    p
}

fn drum_loop(rate: f32, bpm: f32, bars: u32, pat: &str, swing: f32, tail: f32, rng: &mut Rng) -> Vec<f32> {
    let step = 60.0 / bpm / 4.0;
    let len = (bars as f32 * 16.0 * step + tail) * rate;
    let mut buf = vec![0f32; len.round() as usize];
    let k = kick(rate);
    for bar in 0..bars {
        for &(s, inst, vel) in &pattern(pat) {
            let mut t = (bar * 16 + s) as f32 * step;
            if s % 2 == 1 {
                t += swing * step;
            }
            let v = vel * (0.85 + 0.15 * rng.next());
            let at = (t * rate) as usize;
            match inst {
                0 => add(&mut buf, at, &k, v),
                1 => add(&mut buf, at, &snare(rate, rng), v * 0.8),
                2 => add(&mut buf, at, &hat(rate, rng), v),
                _ => add(&mut buf, at, &clap(rate, rng), v * 0.7),
            }
        }
    }
    buf
}

/// Boucle tonale : basse sur la tonique de chaque accord, accords en croches, une mesure par accord.
fn tonal_loop(rate: f32, bpm: f32, pc: u8, minor: bool, variant: usize, rng: &mut Rng) -> Vec<f32> {
    // Degrés (demi-tons depuis la tonique, accord mineur ?).
    let progs: [&[(i32, bool)]; 3] = if minor {
        [
            &[(0, true), (8, false), (3, false), (10, false)],
            &[(0, true), (5, true), (7, false), (0, true)],
            &[(0, true), (10, false), (8, false), (7, false)],
        ]
    } else {
        [
            &[(0, false), (7, false), (9, true), (5, false)],
            &[(0, false), (5, false), (7, false), (0, false)],
            &[(0, false), (9, true), (5, false), (7, false)],
        ]
    };
    let prog = progs[variant % 3];
    let beat = 60.0 / bpm;
    let bars = prog.len() as f32;
    let mut buf = vec![0f32; (bars * 4.0 * beat * rate).round() as usize];
    let tonic = 48.0 + pc as f32;
    let bright = 0.8 + 0.6 * rng.next();
    for (i, &(deg, m)) in prog.iter().enumerate() {
        let root = tonic + deg as f32;
        let root = if root > tonic + 6.0 { root - 12.0 } else { root };
        let third = if m { 3.0 } else { 4.0 };
        let bar_t = i as f32 * 4.0 * beat;
        // Basse : noires sur la fondamentale.
        for b in 0..4 {
            let at = ((bar_t + b as f32 * beat) * rate) as usize;
            add(&mut buf, at, &note(rate, root - 12.0, beat * 0.9, 3.0, 1.2), 0.9);
        }
        // Accords : croches.
        for e in 0..8 {
            let at = ((bar_t + e as f32 * beat / 2.0) * rate) as usize;
            let v = if e % 2 == 0 { 0.5 } else { 0.3 };
            for iv in [0.0, third, 7.0] {
                add(&mut buf, at, &note(rate, root + 12.0 + iv, beat * 0.45, 6.0, bright), v);
            }
        }
        // Mélodie simple sur les notes de la gamme, une note par temps (tierce, quinte, tonique).
        for (b, iv) in [third, 7.0, 12.0, 7.0].iter().enumerate() {
            let at = ((bar_t + b as f32 * beat) * rate) as usize;
            add(&mut buf, at, &note(rate, root + 12.0 + iv, beat * 0.8, 4.0, 1.5), 0.25);
        }
    }
    buf
}

fn build_set(dir: &Path) -> Vec<Case> {
    let mut rng = Rng(0x2545_F491_4F6C_DD1D);
    let mut cases = Vec::new();
    let mut n = 0;
    let mut push = |cases: &mut Vec<Case>, rate: u32, x: Vec<f32>, what: String, bpm, key, kind, acid| {
        let file = dir.join(format!("t{n:03}.wav"));
        n += 1;
        let channels = if cases.len().is_multiple_of(3) { 1 } else { 2 };
        write_wav(&file, rate, channels, &x, acid);
        cases.push(Case {
            file,
            what,
            bpm,
            key,
            kind,
        });
    };

    // Boucles de batterie : chaque tempo avec des motifs qu'on trouve vraiment à ce tempo (un four-on-the-floor
    // à 70 BPM serait noté 140 dans un pack).
    // (Pas de breakbeat en doubles-croches au-delà de 140 : 16 charleys par mesure à 170 ne se jouent pas.)
    let drums: [(f32, [&str; 2]); 19] = [
        (80.0, ["hiphop", "break"]),
        (85.0, ["hiphop", "rock"]),
        (90.0, ["hiphop", "break"]),
        (95.0, ["hiphop", "shaker"]),
        (100.0, ["break", "rock"]),
        (105.0, ["rock", "shaker"]),
        (110.0, ["four", "break"]),
        (118.0, ["four", "rock"]),
        (120.0, ["four", "shaker"]),
        (124.0, ["four", "rock"]),
        (126.0, ["four", "break"]),
        (128.0, ["four", "shaker"]),
        (130.0, ["four", "rock"]),
        (135.0, ["four", "break"]),
        (140.0, ["four", "rock"]),
        (150.0, ["rock", "four"]),
        (160.0, ["rock", "dnb"]),
        (170.0, ["dnb", "dnb"]),
        (174.0, ["dnb", "dnb"]),
    ];
    for (i, &(bpm, pats)) in drums.iter().enumerate() {
        for (j, pat) in pats.iter().enumerate() {
            let bars = [1, 2, 4][(i + j) % 3];
            let swing = if (i + j) % 5 == 4 && bpm < 130.0 { 0.33 } else { 0.0 };
            let tail = if (i + j) % 4 == 3 { 0.35 } else { 0.0 };
            let rate = [44_100, 48_000, 44_100, 96_000][(i + j) % 4];
            let x = drum_loop(rate as f32, bpm, bars, pat, swing, tail, &mut rng);
            let what = format!(
                "batterie {pat} {bpm} BPM {bars} mes.{}{}",
                if swing > 0.0 { " swing" } else { "" },
                if tail > 0.0 { " +silence" } else { "" }
            );
            push(&mut cases, rate, x, what, Some(bpm as f64), None, SampleKind::Loop, None);
        }
    }

    // Boucles tonales : les 24 tonalités.
    let ttempos = [90.0, 100.0, 110.0, 120.0, 128.0, 140.0];
    for pc in 0..12u8 {
        for minor in [false, true] {
            let i = pc as usize * 2 + minor as usize;
            let bpm = ttempos[i % ttempos.len()];
            let x = tonal_loop(44_100.0, bpm, pc, minor, i, &mut rng);
            let name = crate_core::analysis::key_name(pc, minor);
            push(
                &mut cases,
                44_100,
                x,
                format!("boucle tonale {name} {bpm} BPM"),
                Some(bpm as f64),
                Some((pc, minor)),
                SampleKind::Loop,
                None,
            );
        }
    }

    // One-shots de batterie.
    for i in 0..16 {
        let rate = 44_100.0;
        let x = match i % 4 {
            0 => kick(rate),
            1 => snare(rate, &mut rng),
            2 => hat(rate, &mut rng),
            _ => clap(rate, &mut rng),
        };
        let what = ["kick", "snare", "hat", "clap"][i % 4].to_string();
        push(
            &mut cases,
            44_100,
            x,
            format!("one-shot {what}"),
            None,
            None,
            SampleKind::Oneshot,
            None,
        );
    }

    // One-shots tonals : accords plaqués (majeur / mineur) et nappes.
    for i in 0..12u8 {
        let pc = (i * 5) % 12;
        let minor = i % 2 == 1;
        let rate = 44_100.0;
        let tonic = 48.0 + pc as f32;
        let third = if minor { 3.0 } else { 4.0 };
        let (len, decay) = if i % 3 == 0 { (3.0, 0.4) } else { (1.0, 3.0) };
        let mut x = vec![0f32; (rate * len) as usize];
        for iv in [-12.0, 0.0, third, 7.0, 12.0] {
            add(&mut x, 0, &note(rate, tonic + iv, len, decay, 1.0), 0.5);
        }
        let name = crate_core::analysis::key_name(pc, minor);
        let what = if i % 3 == 0 { "nappe" } else { "accord" };
        push(
            &mut cases,
            44_100,
            x,
            format!("one-shot {what} {name}"),
            None,
            Some((pc, minor)),
            SampleKind::Oneshot,
            None,
        );
    }
    cases
}

/// Score de tonalité façon MIREX : exacte 1, quinte 0,5, relative 0,3, homonyme (do / do mineur) 0,2.
fn mirex(want: (u8, bool), got: Option<(u8, bool)>) -> f64 {
    let Some(g) = got else { return 0.0 };
    if g == want {
        1.0
    } else if g.1 == want.1 && (g.0 == (want.0 + 7) % 12 || g.0 == (want.0 + 5) % 12) {
        0.5
    } else if g
        == (if want.1 {
            ((want.0 + 3) % 12, false)
        } else {
            ((want.0 + 9) % 12, true)
        })
    {
        0.3
    } else if g.0 == want.0 {
        0.2
    } else {
        0.0
    }
}

#[test]
fn jeu_test_annote() {
    let dir = tmp("set");
    let cases = build_set(&dir);
    let t0 = std::time::Instant::now();
    let results: Vec<_> = cases.iter().map(|c| analyze(&c.file).expect("décodé")).collect();
    let per_file = t0.elapsed().as_secs_f64() * 1000.0 / cases.len() as f64;
    let pct = |a: usize, b: usize| if b == 0 { 100.0 } else { a as f64 * 100.0 / b as f64 };

    let (mut trimmed, mut trimmed_ok, mut tail, mut tail_ok, mut near, mut octave) = (0, 0, 0, 0, 0, 0);
    let (mut key_n, mut key_ok, mut key_score, mut drums, mut drums_keyed, mut kind_ok) = (0, 0, 0.0, 0, 0, 0);
    let mut bad = Vec::new();
    for (c, r) in cases.iter().zip(&results) {
        let mut errs = Vec::new();
        if r.kind == c.kind {
            kind_ok += 1;
        } else {
            errs.push(format!("type {:?}", r.kind));
        }
        if let Some(b) = c.bpm {
            let got = r.bpm.unwrap_or(0.0);
            let ok = (got - b).abs() < 0.5;
            if c.what.contains("+silence") {
                tail += 1;
                tail_ok += ok as usize;
            } else {
                trimmed += 1;
                trimmed_ok += ok as usize;
            }
            near += ((got - b).abs() <= b * 0.02) as usize;
            octave += [0.5, 1.0, 2.0].iter().any(|m| (got - b * m).abs() <= b * m * 0.02) as usize;
            if !ok {
                errs.push(format!("bpm {:?}", r.bpm));
            }
        }
        let got = r.key.as_deref().and_then(parse_key);
        match c.key {
            Some(k) => {
                key_n += 1;
                key_ok += (got == Some(k)) as usize;
                key_score += mirex(k, got);
                if got != Some(k) {
                    errs.push(format!("tonalité {:?}", r.key));
                }
            }
            None => {
                drums += 1;
                if got.is_some() {
                    drums_keyed += 1;
                    errs.push(format!("tonalité {:?} (batterie)", r.key));
                }
            }
        }
        if !errs.is_empty() {
            bad.push(format!(
                "  {} ({}) : {}",
                c.file.file_name().unwrap().to_string_lossy(),
                c.what,
                errs.join(", ")
            ));
        }
    }
    let loops = trimmed + tail;

    // Les filtres eux-mêmes, sur tout le jeu : précision (ce qui est renvoyé est juste) et rappel (rien ne manque).
    let filter = |want: &dyn Fn(&Case) -> bool, got: &dyn Fn(usize) -> bool| -> (usize, usize, usize) {
        let w: Vec<bool> = cases.iter().map(want).collect();
        let g: Vec<bool> = (0..cases.len()).map(got).collect();
        let tp = w.iter().zip(&g).filter(|(a, b)| **a && **b).count();
        (tp, g.iter().filter(|x| **x).count(), w.iter().filter(|x| **x).count())
    };
    let in_range = |b: Option<f64>| b.is_some_and(|b| (120.0..=130.0).contains(&b));
    let (btp, bgot, bwant) = filter(&|c| in_range(c.bpm), &|i| in_range(results[i].bpm));
    let (mut ktp, mut kgot, mut kwant) = (0, 0, 0);
    for pc in 0..12u8 {
        for minor in [false, true] {
            let k = Some((pc, minor));
            let (a, b, c) = filter(&|c| c.key == k, &|i| results[i].key.as_deref().and_then(parse_key) == k);
            (ktp, kgot, kwant) = (ktp + a, kgot + b, kwant + c);
        }
    }

    println!("jeu test : {} fichiers, {:.0} ms par fichier", cases.len(), per_file);
    println!(
        "  BPM exact, boucles coupées à la mesure : {trimmed_ok}/{trimmed} ({:.0} %)",
        pct(trimmed_ok, trimmed)
    );
    println!(
        "  BPM exact, boucles suivies de silence  : {tail_ok}/{tail} ({:.0} %)",
        pct(tail_ok, tail)
    );
    println!("  BPM à 2 % près : {near}/{loops} ; à l'octave près : {octave}/{loops}");
    println!(
        "  tonalité exacte : {key_ok}/{key_n} ({:.0} %), score MIREX {:.0} %",
        pct(key_ok, key_n),
        key_score * 100.0 / key_n as f64
    );
    println!("  batterie sans tonalité : {}/{drums}", drums - drums_keyed);
    println!(
        "  boucle / one-shot : {kind_ok}/{} ({:.0} %)",
        cases.len(),
        pct(kind_ok, cases.len())
    );
    println!("  filtre bpm:120-130 : {btp} justes sur {bgot} renvoyés, {bwant} attendus");
    println!("  filtres key: (24)  : {ktp} justes sur {kgot} renvoyés, {kwant} attendus");
    for b in &bad {
        println!("{b}");
    }

    // Critère de sortie de la phase 6.
    assert!(
        pct(trimmed_ok, trimmed) >= 95.0,
        "BPM des boucles coupées : {:.0} % < 95 %",
        pct(trimmed_ok, trimmed)
    );
    assert!(
        pct(trimmed_ok + tail_ok, loops) >= 85.0,
        "BPM de toutes les boucles : {:.0} % < 85 %",
        pct(trimmed_ok + tail_ok, loops)
    );
    assert!(
        pct(octave, loops) >= 95.0,
        "BPM à l'octave près : {:.0} % < 95 %",
        pct(octave, loops)
    );
    assert!(pct(key_ok, key_n) >= 85.0, "tonalité : {:.0} % < 85 %", pct(key_ok, key_n));
    assert!(drums_keyed * 20 <= drums, "trop de tonalités sur de la batterie : {drums_keyed}");
    assert!(
        pct(kind_ok, cases.len()) >= 95.0,
        "boucle / one-shot : {:.0} % < 95 %",
        pct(kind_ok, cases.len())
    );
    assert!(
        pct(btp, bgot) >= 90.0 && pct(btp, bwant) >= 95.0,
        "bpm:120-130 : précision ou rappel insuffisant"
    );
    assert!(
        pct(ktp, kgot) >= 85.0 && pct(ktp, kwant) >= 85.0,
        "key: : précision ou rappel insuffisant"
    );
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn le_nom_et_le_chunk_acid_l_emportent() {
    let dir = tmp("names");
    let mut rng = Rng(7);
    let rate = 44_100.0;
    // Une boucle de batterie à 120, nommée 96 : le nom gagne.
    let x = drum_loop(rate, 120.0, 2, "four", 0.0, 0.0, &mut rng);
    let p = dir.join("Drum_Loop_Tight_96.wav");
    write_wav(&p, 44_100, 2, &x, None);
    let a = analyze(&p).unwrap();
    assert_eq!((a.bpm, a.kind), (Some(96.0), SampleKind::Loop));
    // Un accord de la mineur nommé « F#m » : le nom gagne aussi pour la tonalité.
    let mut x = vec![0f32; rate as usize];
    for iv in [0.0, 3.0, 7.0] {
        add(&mut x, 0, &note(rate, 57.0 + iv, 1.0, 2.0, 1.0), 0.5);
    }
    let p = dir.join("Stab_F#m.wav");
    write_wav(&p, 44_100, 1, &x, None);
    assert_eq!(analyze(&p).unwrap().key.as_deref(), Some("F#m"));
    // Le même accord, nom neutre : l'audio trouve la mineur.
    let p = dir.join("stab.wav");
    write_wav(&p, 44_100, 1, &x, None);
    assert_eq!(analyze(&p).unwrap().key.as_deref(), Some("Am"));
    // Chunk acid : boucle à 100 BPM déclarée one-shot, note de base ré.
    let x = drum_loop(rate, 100.0, 2, "four", 0.0, 0.0, &mut rng);
    let p = dir.join("neutre.wav");
    write_wav(&p, 44_100, 2, &x, Some((0x01 | 0x02, 62, 100.0)));
    let acid = read_acid(&p).unwrap();
    assert_eq!((acid.oneshot, acid.root, acid.bpm), (true, Some(2), Some(100.0)));
    let a = analyze(&p).unwrap();
    assert_eq!((a.kind, a.bpm), (SampleKind::Oneshot, None), "acid : one-shot, donc pas de tempo");
    // Boucle acid à 97 BPM : le tempo du chunk sert si l'audio le confirme ou non (il est écrit par l'outil).
    let p = dir.join("neutre2.wav");
    write_wav(&p, 44_100, 2, &x, Some((0, 0, 97.0)));
    assert_eq!(analyze(&p).unwrap().bpm, Some(97.0));
    // Fichier illisible.
    fs::write(dir.join("faux.wav"), b"pas du son").unwrap();
    assert!(analyze(&dir.join("faux.wav")).is_none());
    let _ = fs::remove_dir_all(dir);
}

/// Sur un vrai dossier : compare l'analyse audio aux tempos et tonalités écrits dans les noms.
#[test]
#[ignore]
fn vrai_dossier_compare_aux_noms() {
    let Some(root) = std::env::var_os("CRATE_ANALYSIS_DIR") else {
        println!("CRATE_ANALYSIS_DIR non défini : rien à comparer");
        return;
    };
    let mut files = Vec::new();
    let mut stack = vec![PathBuf::from(root)];
    while let Some(d) = stack.pop() {
        for e in fs::read_dir(&d).into_iter().flatten().flatten() {
            let p = e.path();
            if p.is_dir() {
                stack.push(p);
            } else if crate_core::scan::is_audio(&p) {
                files.push(p);
            }
        }
    }
    files.sort();
    let (mut bpm_n, mut bpm_ok, mut key_n, mut key_ok) = (0, 0, 0, 0);
    let t0 = std::time::Instant::now();
    for p in &files {
        // L'audio seul : on analyse une copie au nom neutre.
        let stem = p.file_stem().unwrap().to_string_lossy().into_owned();
        let h = parse_name(&stem);
        let tmpf = std::env::temp_dir().join(format!(
            "crate-neutre-{}.{}",
            std::process::id(),
            p.extension().unwrap().to_string_lossy()
        ));
        if fs::copy(p, &tmpf).is_err() {
            continue;
        }
        let Some(a) = analyze(&tmpf) else { continue };
        let named_bpm = h.bpm.or(if h.kind == Some(SampleKind::Loop) { h.bare_bpm } else { None });
        if let (Some(want), true) = (named_bpm, a.kind == SampleKind::Loop) {
            bpm_n += 1;
            if a.bpm.is_some_and(|b| (b - want).abs() < 0.5) {
                bpm_ok += 1;
            } else {
                println!("bpm  {:>6} au lieu de {want:<5} {}", format!("{:?}", a.bpm), p.display());
            }
        }
        if let Some(want) = h.key {
            key_n += 1;
            if a.key.as_deref().and_then(parse_key) == Some(want) {
                key_ok += 1;
            } else {
                println!(
                    "clé  {:>6} au lieu de {:<4} {}",
                    format!("{:?}", a.key),
                    crate_core::analysis::key_name(want.0, want.1),
                    p.display()
                );
            }
        }
    }
    let _ = fs::remove_file(std::env::temp_dir().join(format!("crate-neutre-{}.wav", std::process::id())));
    println!(
        "{} fichiers en {:.1} s ; BPM {bpm_ok}/{bpm_n} ; tonalité {key_ok}/{key_n}",
        files.len(),
        t0.elapsed().as_secs_f64()
    );
}
