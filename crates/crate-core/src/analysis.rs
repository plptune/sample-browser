//! Analyse d'un sample : tempo, tonalité, boucle ou one-shot.
//!
//! Trois sources, de la plus sûre à la moins sûre :
//! 1. le **nom** du fichier (`Bass_Loop_Dark_115_Bm`, `Pad 120bpm F#min`) : c'est ainsi que les packs sont annotés ;
//! 2. le chunk **acid** des WAV (tempo, note de base, drapeau one-shot), écrit par les éditeurs de boucles ;
//! 3. l'**audio** : les 30 premières secondes, en mono à ~11 kHz.
//!    - tempo : flux spectral → autocorrélation → peigne sur 4 périodes, préférence douce autour de 120 ;
//!      pour une boucle, la durée exacte (un nombre entier de mesures) affine l'estimation ;
//!    - tonalité : chromagramme (FFT 4096) corrélé aux profils de Temperley (24 tonalités),
//!      seulement si le son est assez tonal (sinon : pas de tonalité, comme pour une batterie) ;
//!    - boucle : assez longue, plusieurs attaques, régulière et soutenue jusqu'au bout.
//!
//! Un fichier MIDI se lit directement : tempo du fichier, tonalité des notes jouées (`decide_midi`).
//!
//! Le nom l'emporte sur le chunk, qui l'emporte sur l'audio. Le BPM n'est gardé que pour les boucles
//! (ou s'il est écrit dans le nom) : le tempo d'un one-shot n'a pas de sens.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use crate::audio::Decoder;
use crate::model::SampleKind;

/// Version de l'analyse : la changer fait tout réanalyser au lancement suivant.
pub const VERSION: u32 = 1;

/// Résultat de l'analyse, prêt à écrire en base.
#[derive(Debug, Clone, PartialEq)]
pub struct Analysis {
    pub bpm: Option<f64>,
    pub key: Option<String>,
    pub kind: SampleKind,
}

/// Indices lus dans le nom du fichier.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct NameHints {
    /// BPM explicite (`120bpm`, `bpm 120`).
    pub bpm: Option<f64>,
    /// Nombre nu entre 60 et 200 (`Drum_Loop_92`) : un tempo seulement si le sample est une boucle.
    pub bare_bpm: Option<f64>,
    /// Tonalité sûre (`Bm`, `F#`, `Ebmin`, `C major`).
    pub key: Option<(u8, bool)>,
    /// Lettre seule (`Bass_G_17`) : gardée seulement si l'audio est tonal.
    pub bare_key: Option<(u8, bool)>,
    pub kind: Option<SampleKind>,
}

const MAJOR: [&str; 12] = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const MINOR: [&str; 12] = ["Cm", "C#m", "Dm", "Ebm", "Em", "Fm", "F#m", "Gm", "G#m", "Am", "Bbm", "Bm"];

/// Nom d'une tonalité (classe de hauteur 0 = do, mineur ou non), orthographe la plus courante dans les packs.
pub fn key_name(pc: u8, minor: bool) -> String {
    (if minor { MINOR } else { MAJOR })[pc as usize % 12].to_string()
}

/// Lit une tonalité écrite (`Am`, `C#`, `Bbmin`, `F#m`, `Eb major`, `A♭`) → (classe de hauteur, mineur).
/// Sert aussi à la recherche `key:`, pour que `key:A#` trouve `Bb`.
pub fn parse_key(s: &str) -> Option<(u8, bool)> {
    let mut chars = s.trim().chars();
    let letter = chars.next()?.to_ascii_uppercase();
    let base: i32 = match letter {
        'C' => 0,
        'D' => 2,
        'E' => 4,
        'F' => 5,
        'G' => 7,
        'A' => 9,
        'B' => 11,
        _ => return None,
    };
    let rest: String = chars.collect();
    let (shift, rest) = if let Some(r) = rest.strip_prefix('#').or_else(|| rest.strip_prefix('♯')) {
        (1, r)
    } else if let Some(r) = rest.strip_prefix('♭') {
        (-1, r)
    } else if rest.starts_with('b') && !rest.starts_with("bpm") {
        (-1, &rest[1..])
    } else {
        (0, rest.as_str())
    };
    let mode = rest.trim().to_lowercase();
    let minor = match mode.as_str() {
        "" | "maj" | "major" | "dur" => false,
        "m" | "min" | "minor" | "moll" | "mi" => true,
        _ => return None,
    };
    Some(((base + shift).rem_euclid(12) as u8, minor))
}

/// Indices tirés du nom (sans extension).
pub fn parse_name(stem: &str) -> NameHints {
    let mut h = NameHints::default();
    let toks: Vec<&str> = stem
        .split(['_', '-', ' ', '.', '(', ')', '[', ']', ','])
        .filter(|t| !t.is_empty())
        .collect();
    let low: Vec<String> = toks.iter().map(|t| t.to_lowercase()).collect();
    let num = |t: &str| -> Option<f64> {
        let ok = !t.is_empty() && t.chars().all(|c| c.is_ascii_digit() || c == '.') && t.chars().next()?.is_ascii_digit();
        ok.then(|| t.parse::<f64>().ok()).flatten().filter(|v| (40.0..=300.0).contains(v))
    };
    for (i, t) in low.iter().enumerate() {
        // 120bpm, 120 bpm, bpm120, bpm 120
        if let Some(n) = t.strip_suffix("bpm").and_then(num) {
            h.bpm = Some(n);
        } else if let Some(n) = t.strip_prefix("bpm").and_then(num) {
            h.bpm = Some(n);
        } else if t == "bpm" {
            if let Some(n) = i
                .checked_sub(1)
                .and_then(|j| num(&low[j]))
                .or_else(|| low.get(i + 1).and_then(|x| num(x)))
            {
                h.bpm = Some(n);
            }
        } else if h.bare_bpm.is_none() {
            if let Some(n) = num(t).filter(|v| (60.0..=200.0).contains(v)) {
                h.bare_bpm = Some(n);
            }
        }
        if t.contains("loop") {
            h.kind = Some(SampleKind::Loop);
        } else if h.kind.is_none()
            && (t == "oneshot" || t == "one" && low.get(i + 1).is_some_and(|x| x == "shot") || t == "shot" || t == "hit")
        {
            h.kind = Some(SampleKind::Oneshot);
        }
    }
    // Tonalité : un mot qui commence par une note (en majuscule, comme dans les packs), suivi d'une altération ou
    // d'un mode ; « C major », « A minor » en deux mots ; une lettre seule reste un indice faible.
    for (i, t) in toks.iter().enumerate() {
        if !t.starts_with(|c: char| ('A'..='G').contains(&c)) {
            continue;
        }
        let next = low.get(i + 1).map(String::as_str);
        let two = match next {
            Some(m @ ("major" | "minor" | "maj" | "min")) => parse_key(&format!("{t}{m}")),
            _ => None,
        };
        if let Some(k) = two {
            h.key = Some(k);
            continue;
        }
        if let Some(k) = parse_key(t) {
            if t.chars().count() == 1 {
                h.bare_key.get_or_insert(k);
            } else {
                h.key = Some(k);
            }
        }
    }
    h
}

// ---------- chunk acid (WAV) ----------

/// Contenu utile d'un chunk `acid`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Acid {
    pub oneshot: bool,
    /// Classe de hauteur de la note de base, si le drapeau la déclare.
    pub root: Option<u8>,
    pub bpm: Option<f64>,
}

/// Cherche le chunk `acid` d'un WAV (sans lire l'audio : on saute de chunk en chunk).
pub fn read_acid(path: &Path) -> Option<Acid> {
    let mut f = File::open(path).ok()?;
    let mut head = [0u8; 12];
    f.read_exact(&mut head).ok()?;
    if &head[0..4] != b"RIFF" || &head[8..12] != b"WAVE" {
        return None;
    }
    for _ in 0..64 {
        let mut ch = [0u8; 8];
        f.read_exact(&mut ch).ok()?;
        let size = u32::from_le_bytes([ch[4], ch[5], ch[6], ch[7]]) as u64;
        if &ch[0..4] == b"acid" && size >= 24 {
            let mut b = [0u8; 24];
            f.read_exact(&mut b).ok()?;
            let flags = u32::from_le_bytes([b[0], b[1], b[2], b[3]]);
            let root = u16::from_le_bytes([b[4], b[5]]);
            let tempo = f32::from_le_bytes([b[20], b[21], b[22], b[23]]) as f64;
            return Some(Acid {
                oneshot: flags & 1 != 0,
                root: (flags & 2 != 0).then_some((root % 12) as u8),
                bpm: (30.0..=300.0).contains(&tempo).then_some(tempo),
            });
        }
        f.seek(SeekFrom::Current((size + (size & 1)) as i64)).ok()?;
    }
    None
}

// ---------- signal ----------

/// Fréquence de travail visée (le fichier est moyenné par blocs jusqu'à s'en approcher).
const TARGET_RATE: u32 = 11_025;
/// Durée analysée au plus.
const MAX_SECONDS: f64 = 30.0;

/// Mono, sous-échantillonné, et la durée réelle du fichier (jusqu'à `MAX_SECONDS`).
struct Signal {
    x: Vec<f32>,
    rate: f32,
    /// Durée en secondes du fichier décodé (tronquée à `MAX_SECONDS`).
    seconds: f64,
    /// Le fichier dure plus que ce qui a été analysé.
    truncated: bool,
}

fn decode_mono(path: &Path) -> Option<Signal> {
    let mut d = Decoder::open(path)?;
    let factor = ((d.rate as f32 / TARGET_RATE as f32).round() as usize).max(1);
    let max_frames = (MAX_SECONDS * d.rate as f64) as usize;
    let (mut x, mut acc, mut n_acc, mut frames) = (Vec::new(), 0f32, 0usize, 0usize);
    let mut tmp = Vec::new();
    let mut truncated = false;
    'outer: while let Some(ch) = d.next_chunk(&mut tmp) {
        for fr in tmp.chunks(ch) {
            if frames >= max_frames {
                truncated = true;
                break 'outer;
            }
            acc += fr.iter().sum::<f32>() / ch as f32;
            n_acc += 1;
            frames += 1;
            if n_acc == factor {
                x.push(acc / factor as f32);
                (acc, n_acc) = (0.0, 0);
            }
        }
        tmp.clear();
    }
    Some(Signal {
        x,
        rate: d.rate as f32 / factor as f32,
        seconds: frames as f64 / d.rate as f64,
        truncated,
    })
}

/// FFT complexe en place (radix 2, taille puissance de deux).
fn fft(re: &mut [f32], im: &mut [f32]) {
    let n = re.len();
    let mut j = 0;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j |= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }
    let mut len = 2;
    while len <= n {
        let ang = -2.0 * std::f32::consts::PI / len as f32;
        let (wr, wi) = (ang.cos(), ang.sin());
        for start in (0..n).step_by(len) {
            let (mut cr, mut ci) = (1f32, 0f32);
            for k in 0..len / 2 {
                let (a, b) = (start + k, start + k + len / 2);
                let (tr, ti) = (re[b] * cr - im[b] * ci, re[b] * ci + im[b] * cr);
                re[b] = re[a] - tr;
                im[b] = im[a] - ti;
                re[a] += tr;
                im[a] += ti;
                (cr, ci) = (cr * wr - ci * wi, cr * wi + ci * wr);
            }
        }
        len <<= 1;
    }
}

/// Spectre d'amplitude de chaque trame (fenêtre de Hann), `n/2` valeurs par trame.
/// `wrap` : le son est une boucle ; les trames couvrent exactement sa durée et la dernière reprend le début.
fn stft(x: &[f32], n: usize, hop: usize, wrap: bool) -> Vec<Vec<f32>> {
    let win: Vec<f32> = (0..n)
        .map(|i| 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / n as f32).cos())
        .collect();
    let len = x.len();
    let at = |i: usize| -> f32 {
        if wrap && len > 0 {
            x[i % len]
        } else {
            x.get(i).copied().unwrap_or(0.0)
        }
    };
    let frames = if wrap {
        len.div_ceil(hop).max(1)
    } else {
        (len.saturating_sub(n / 2)).div_ceil(hop).max(1)
    };
    let (mut re, mut im) = (vec![0f32; n], vec![0f32; n]);
    (0..frames)
        .map(|f| {
            let start = f * hop;
            for i in 0..n {
                re[i] = at(start + i) * win[i];
                im[i] = 0.0;
            }
            fft(&mut re, &mut im);
            (0..n / 2).map(|k| (re[k] * re[k] + im[k] * im[k]).sqrt()).collect()
        })
        .collect()
}

// ---------- tempo ----------

struct Rhythm {
    /// Force d'attaque par trame (flux spectral, moyenne locale retirée).
    onset: Vec<f32>,
    /// Même chose sous 300 Hz : kick, corps de la caisse claire, basse. C'est là que se lit le temps
    /// (le charleston, lui, marque les subdivisions).
    low: Vec<f32>,
    /// Trames par seconde.
    fps: f32,
}

fn rhythm(sig: &Signal, wrap: bool) -> Rhythm {
    const N: usize = 1024;
    const HOP: usize = 128;
    let spec = stft(&sig.x, N, HOP, wrap);
    let fps = sig.rate / HOP as f32;
    let logs: Vec<Vec<f32>> = spec.iter().map(|f| f.iter().map(|m| (1.0 + 10.0 * m).ln()).collect()).collect();
    let n = logs.len();
    let low_bins = ((300.0 / (sig.rate / N as f32)) as usize).max(2);
    let flux = |bins: std::ops::Range<usize>| -> Vec<f32> {
        (0..n)
            .map(|t| {
                // En boucle, la première trame suit la dernière.
                let prev = match (t, wrap) {
                    (0, true) => n - 1,
                    (0, false) => return 0.0,
                    _ => t - 1,
                };
                bins.clone().map(|k| (logs[t][k] - logs[prev][k]).max(0.0)).sum()
            })
            .collect()
    };
    // Retirer la moyenne locale (±8 trames) : ne garder que les attaques.
    let peaks_only = |f: Vec<f32>| -> Vec<f32> {
        let w = 8usize;
        (0..n)
            .map(|t| {
                let (lo, hi) = (t.saturating_sub(w), (t + w + 1).min(n));
                let mean = f[lo..hi].iter().sum::<f32>() / (hi - lo) as f32;
                (f[t] - mean).max(0.0)
            })
            .collect()
    };
    Rhythm {
        onset: peaks_only(flux(0..N / 2)),
        low: peaks_only(flux(1..low_bins)),
        fps,
    }
}

/// Autocorrélation, normalisée par l'énergie (1 au retard nul). Circulaire pour une boucle (elle se répète) :
/// tous les retards gardent autant de termes, même sur une boucle d'une mesure.
fn autocorr(o: &[f32], max_lag: usize, circular: bool) -> Vec<f32> {
    let n = o.len();
    let e: f32 = o.iter().map(|v| v * v).sum();
    if n == 0 || e <= 0.0 {
        return Vec::new();
    }
    let max_lag = if circular {
        max_lag.min(n - 1)
    } else {
        max_lag.min(n.saturating_sub(1))
    };
    (0..=max_lag)
        .map(|l| {
            if circular {
                (0..n).map(|t| o[t] * o[(t + l) % n]).sum::<f32>() / e
            } else {
                // Sans boucle : moyenne sur les termes qui se recouvrent, et pas au-delà des deux tiers du son
                // (trop peu de termes).
                if l * 3 > n * 2 {
                    return f32::NAN;
                }
                o[..n - l].iter().zip(&o[l..]).map(|(a, b)| a * b).sum::<f32>() / e * n as f32 / (n - l) as f32
            }
        })
        .collect()
}

fn interp(ac: &[f32], lag: f32) -> Option<f32> {
    let i = lag.floor() as usize;
    let f = lag - i as f32;
    let v = ac.get(i)? * (1.0 - f) + ac.get(i + 1)? * f;
    (!v.is_nan()).then_some(v)
}

/// Peigne : autocorrélation sur 1 à 4 périodes (celles qui tiennent dans le son).
fn comb(ac: &[f32], fps: f32, bpm: f64) -> f32 {
    let period = fps * 60.0 / bpm as f32;
    let (mut s, mut w) = (0f32, 0f32);
    for k in 1..=4 {
        if let Some(v) = interp(ac, period * k as f32) {
            s += v;
            w += 1.0;
        }
    }
    if w == 0.0 {
        0.0
    } else {
        s / w
    }
}

/// Préférence douce pour les tempos courants (centre 120 BPM, écart d'une octave).
fn prior(bpm: f64) -> f32 {
    let octaves = (bpm / 120.0).log2() as f32;
    (-0.5 * octaves.powi(2)).exp()
}

/// Attaques par temps : deux (croches) est le cas le plus courant ; une ou quatre restent plausibles.
/// Départage les octaves (un même motif lu à 80 ou à 160 BPM).
fn density_weight(onsets_per_s: f32, bpm: f64) -> f32 {
    let per_beat = onsets_per_s / (bpm as f32 / 60.0);
    if per_beat <= 0.0 {
        return 1.0;
    }
    let octaves = (per_beat / 2.0).log2();
    (-0.5 * (octaves / 1.2).powi(2)).exp()
}

/// Tempo estimé, sa force (autocorrélation à une période, 0..1) et s'il a été calé sur la durée de la boucle.
#[derive(Debug)]
struct Tempo {
    bpm: f64,
    periodicity: f32,
    fits_bars: bool,
}

fn tempo(r: &Rhythm, sig: &Signal, onsets: usize, circular: bool) -> Option<Tempo> {
    let max_lag = (r.fps * 60.0 / 50.0 * 4.0) as usize + 2;
    let ac = autocorr(&r.onset, max_lag, circular);
    if ac.len() < 4 {
        return None;
    }
    let ac_low = autocorr(&r.low, max_lag, circular);
    let ops = onsets as f32 / sig.seconds.max(0.1) as f32;
    let score = |b: f64| {
        let low = if ac_low.is_empty() { 0.0 } else { comb(&ac_low, r.fps, b) };
        (comb(&ac, r.fps, b) + LOW_WEIGHT * low) / (1.0 + LOW_WEIGHT) * prior(b) * density_weight(ops, b)
    };
    // Estimation libre, par pas de 0,25 BPM.
    let (mut best, mut best_s) = (0f64, f32::MIN);
    let mut b = 50.0;
    while b <= 220.0 {
        let s = score(b);
        if s > best_s {
            (best, best_s) = (b, s);
        }
        b += 0.25;
    }
    if best_s <= 0.0 {
        return None;
    }
    let periodicity = interp(&ac, r.fps * 60.0 / best as f32).unwrap_or(0.0);
    // Une boucle coupée à la mesure dure un nombre entier de temps (1, 2, 4… mesures) : parmi ces tempos, le
    // mieux noté l'emporte s'il score au moins 60 % de l'estimation libre (il est alors exact).
    let mut fit: Option<(f64, f32)> = None;
    if circular && sig.seconds > 0.5 {
        for beats in [1u32, 2, 4, 8, 16, 32, 64, 128] {
            let c = 60.0 * beats as f64 / sig.seconds;
            if !(50.0..=220.0).contains(&c) {
                continue;
            }
            let s = score(c);
            if s >= 0.6 * best_s && fit.is_none_or(|(_, fs)| s > fs) {
                fit = Some((c, s));
            }
        }
    }
    let (bpm, fits_bars) = match fit {
        Some((c, _)) => (c, true),
        None => (best, false),
    };
    Some(Tempo {
        bpm: bpm.round(),
        periodicity,
        fits_bars,
    })
}

/// Nombre d'attaques nettes (pics de la force d'attaque au-dessus d'un seuil relatif).
fn onset_count(o: &[f32]) -> usize {
    let max = o.iter().fold(0f32, |m, &x| m.max(x));
    if max <= 0.0 {
        return 0;
    }
    let th = max * 0.12;
    let mut n = 0;
    let mut last = usize::MAX / 2;
    for t in 1..o.len().saturating_sub(1) {
        if o[t] > th && o[t] >= o[t - 1] && o[t] > o[t + 1] && t.wrapping_sub(last) > 3 {
            n += 1;
            last = t;
        }
    }
    n
}

/// Énergie de la fin (dernier dixième) rapportée à la trame la plus forte : ~0 pour un son qui s'éteint.
fn sustain(x: &[f32], rate: f32) -> f32 {
    let w = ((rate * 0.05) as usize).max(1);
    let rms: Vec<f32> = x
        .chunks(w)
        .map(|c| (c.iter().map(|v| v * v).sum::<f32>() / c.len() as f32).sqrt())
        .collect();
    let max = rms.iter().fold(0f32, |m, &v| m.max(v));
    if max <= 0.0 || rms.len() < 10 {
        return 0.0;
    }
    let tail = &rms[rms.len() - rms.len() / 10..];
    tail.iter().fold(0f32, |m, &v| m.max(v)) / max
}

/// Durée (s) du silence final : après le dernier échantillon au-dessus de −50 dB du maximum.
fn trailing_silence(x: &[f32], rate: f32) -> f32 {
    let max = x.iter().fold(0f32, |m, v| m.max(v.abs()));
    if max <= 0.0 {
        return 0.0;
    }
    let th = max * 0.003;
    let last = x.iter().rposition(|v| v.abs() > th).unwrap_or(0);
    (x.len() - 1 - last) as f32 / rate
}

// ---------- tonalité ----------

/// Profils de tonalité de Temperley (Kostka-Payne) : plus tranchés que ceux de Krumhansl sur la tierce,
/// donc meilleurs pour séparer majeur et mineur.
const MAJOR_PROFILE: [f32; 12] = [0.748, 0.060, 0.488, 0.082, 0.670, 0.460, 0.096, 0.715, 0.104, 0.366, 0.057, 0.400];
const MINOR_PROFILE: [f32; 12] = [0.712, 0.084, 0.474, 0.618, 0.049, 0.460, 0.105, 0.747, 0.404, 0.067, 0.133, 0.330];

/// Chromagrammes (12 classes de hauteur) : tout le spectre de 55 Hz à 2 kHz, et la basse seule (55 à 250 Hz).
/// Chaque trame est normalisée (une note compte autant qu'elle dure, pas selon son volume) et les amplitudes
/// sont compressées (racine) : la tierce pèse face à la tonique et la quinte.
/// `peakiness` : part de l'énergie de 100 Hz à 2 kHz concentrée dans des pics étroits (≈1 pour des notes,
/// bien moins pour le bruit d'une batterie).
struct Chroma {
    all: [f32; 12],
    bass: [f32; 12],
    /// Basse du premier quart du son (la première mesure d'une boucle de 4).
    bass_first: [f32; 12],
    peakiness: f32,
}

fn chroma(sig: &Signal) -> Chroma {
    const N: usize = 4096;
    let spec = stft(&sig.x, N, N / 4, false);
    let first = spec.len().div_ceil(4);
    let bin_hz = sig.rate / N as f32;
    let mut pc_of = vec![usize::MAX; N / 2];
    for (k, p) in pc_of.iter_mut().enumerate().skip(1) {
        let f = k as f32 * bin_hz;
        if (55.0..=2000.0).contains(&f) {
            let midi = 69.0 + 12.0 * (f / 440.0).log2();
            *p = (midi.round() as i32).rem_euclid(12) as usize;
        }
    }
    let (bass_max, band_lo, band_hi) = (
        (250.0 / bin_hz) as usize,
        (100.0 / bin_hz) as usize,
        ((2000.0 / bin_hz) as usize).min(N / 2 - 2),
    );
    let mut c = Chroma {
        all: [0.0; 12],
        bass: [0.0; 12],
        bass_first: [0.0; 12],
        peakiness: 0.0,
    };
    let (mut peak_e, mut band_e) = (0f32, 0f32);
    for (t, frame) in spec.iter().enumerate() {
        let max = frame.iter().fold(0f32, |m, &v| m.max(v));
        if max <= 0.0 {
            continue;
        }
        let is_peak =
            |k: usize| k > 0 && k + 1 < frame.len() && frame[k] > frame[k - 1] && frame[k] >= frame[k + 1] && frame[k] > max * 0.05;
        let (mut fa, mut fb) = ([0f32; 12], [0f32; 12]);
        for k in 1..frame.len() - 1 {
            let p = pc_of[k];
            if p == usize::MAX || !is_peak(k) {
                continue;
            }
            fa[p] += frame[k].sqrt();
            if k <= bass_max {
                fb[p] += frame[k].sqrt();
            }
        }
        // Chaque trame compte pour 1 (normalisée sur sa classe la plus forte).
        let add = |acc: &mut [f32; 12], f: &[f32; 12]| {
            let m = f.iter().fold(0f32, |m, &v| m.max(v));
            if m > 0.0 {
                for (a, v) in acc.iter_mut().zip(f) {
                    *a += v / m;
                }
            }
        };
        if t < first {
            add(&mut c.bass_first, &fb);
        }
        add(&mut c.all, &fa);
        add(&mut c.bass, &fb);
        for k in band_lo..=band_hi {
            let e = frame[k] * frame[k];
            band_e += e;
            if is_peak(k) {
                peak_e += e + frame[k - 1] * frame[k - 1] + frame[k + 1] * frame[k + 1];
            }
        }
    }
    c.peakiness = if band_e > 0.0 { peak_e / band_e } else { 0.0 };
    c
}

fn pearson(a: &[f32; 12], b: &[f32; 12]) -> f32 {
    let (ma, mb) = (a.iter().sum::<f32>() / 12.0, b.iter().sum::<f32>() / 12.0);
    let (mut num, mut da, mut db) = (0f32, 0f32, 0f32);
    for i in 0..12 {
        num += (a[i] - ma) * (b[i] - mb);
        da += (a[i] - ma).powi(2);
        db += (b[i] - mb).powi(2);
    }
    if da <= 0.0 || db <= 0.0 {
        0.0
    } else {
        num / (da * db).sqrt()
    }
}

/// Corrélation de chaque tonalité (24 : 12 majeures puis 12 mineures) avec le chromagramme.
fn key_scores(c: &[f32; 12]) -> [f32; 24] {
    let mut out = [0f32; 24];
    for tonic in 0..12usize {
        for (m, prof) in [&MAJOR_PROFILE, &MINOR_PROFILE].iter().enumerate() {
            let mut rot = [0f32; 12];
            for i in 0..12 {
                rot[(i + tonic) % 12] = prof[i];
            }
            out[m * 12 + tonic] = pearson(c, &rot);
        }
    }
    out
}

/// Meilleure tonalité : profils de Temperley, départagés par la basse (la tonique y revient le plus, et ouvre
/// souvent la boucle).
/// Renvoie aussi la corrélation (−1..1).
fn best_key(c: &Chroma) -> Option<((u8, bool), f32)> {
    if c.all.iter().sum::<f32>() <= 0.0 {
        return None;
    }
    let scores = key_scores(&c.all);
    let norm = |v: &[f32; 12], t: usize| {
        let m = v.iter().fold(0f32, |m, &x| m.max(x));
        if m > 0.0 {
            v[t] / m
        } else {
            0.0
        }
    };
    let mut best = ((0u8, false), f32::MIN, f32::MIN);
    for (i, &r) in scores.iter().enumerate() {
        let tonic = i % 12;
        let bonus = BASS_WEIGHT * norm(&c.bass, tonic) + FIRST_BASS_WEIGHT * norm(&c.bass_first, tonic);
        if r + bonus > best.2 {
            best = (((tonic as u8), i >= 12), r, r + bonus);
        }
    }
    Some((best.0, best.1))
}

/// Le son est-il tonal ? Nombre de classes de hauteur qui portent au moins 15 % de la plus forte :
/// une batterie en a 0 à 2 (des partiels isolés), un accord ou une gamme 3 et plus.
fn tonal_classes(c: &[f32; 12]) -> usize {
    let max = c.iter().fold(0f32, |m, &v| m.max(v));
    if max <= 0.0 {
        return 0;
    }
    c.iter().filter(|&&v| v >= 0.15 * max).count()
}

// ---------- tout ensemble ----------

/// Seuils réglés sur le jeu test annoté (`tests/analysis.rs`).
const LOW_WEIGHT: f32 = 1.0;
const KEY_MIN_R: f32 = 0.6;
/// Sons de moins d'une demi-seconde : chromagramme sur peu de trames, on exige plus.
const KEY_MIN_R_SHORT: f32 = 0.75;
const KEY_MIN_CLASSES: usize = 3;
/// MIDI : les notes sont exactes, un seuil plus bas suffit.
const KEY_MIN_R_MIDI: f32 = 0.5;
const KEY_MIN_PEAKINESS: f32 = 0.6;
const BASS_WEIGHT: f32 = 0.1;
const FIRST_BASS_WEIGHT: f32 = 0.1;

/// Analyse complète d'un fichier. `None` s'il ne se décode pas.
pub fn analyze(path: &Path) -> Option<Analysis> {
    let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let names = parse_name(&stem);
    if crate::midi::is_midi(path) {
        return Some(decide_midi(&names, &crate::midi::Midi::open(path)?));
    }
    let acid = read_acid(path);
    let sig = decode_mono(path)?;
    Some(decide(&names, acid, &sig, &stem))
}

/// Premier accord d'un MIDI : sa fondamentale (note la plus grave des premières attaques) et son mode (tierce
/// mineure ou majeure au-dessus). `None` si le mode ne se lit pas (note seule, quinte à vide).
fn first_chord(notes: &[&crate::midi::Note]) -> Option<(u8, bool)> {
    let t0 = notes.iter().map(|n| n.start).fold(f64::INFINITY, f64::min);
    let first: Vec<u8> = notes.iter().filter(|n| n.start < t0 + 0.05).map(|n| n.key).collect();
    let root = *first.iter().min()?;
    let has = |iv: u8| first.iter().any(|&k| k % 12 == (root + iv) % 12);
    match (has(3), has(4)) {
        (true, false) => Some((root % 12, true)),
        (false, true) => Some((root % 12, false)),
        _ => None,
    }
}

/// Part du poids des notes qui tient dans la gamme de `key` (majeure, ou mineure naturelle + sensible).
fn scale_fit(c: &[f32; 12], key: (u8, bool)) -> f32 {
    let steps: &[u8] = if key.1 {
        &[0, 2, 3, 5, 7, 8, 10, 11]
    } else {
        &[0, 2, 4, 5, 7, 9, 11]
    };
    let total: f32 = c.iter().sum();
    if total <= 0.0 {
        return 0.0;
    }
    steps.iter().map(|s| c[((key.0 + s) % 12) as usize]).sum::<f32>() / total
}

/// MIDI : tout est écrit dans le fichier. Tempo : celui du fichier ; tonalité : le premier accord si toutes les
/// notes tiennent dans sa gamme, sinon les profils (notes pondérées par leur durée, la basse départage), hors
/// batterie ; boucle : au moins deux attaques et une mesure.
fn decide_midi(names: &NameHints, m: &crate::midi::Midi) -> Analysis {
    let tonal: Vec<&crate::midi::Note> = m.notes.iter().filter(|n| n.channel != 9).collect();
    let mut onsets: Vec<i64> = m.notes.iter().map(|n| (n.start * 100.0).round() as i64).collect();
    onsets.dedup();
    let audio_loop = onsets.len() >= 2 && m.seconds >= 0.9 * m.bar_seconds();
    let kind = names
        .kind
        .unwrap_or(if audio_loop { SampleKind::Loop } else { SampleKind::Oneshot });
    let bpm = names.bpm.or(if kind == SampleKind::Loop { names.bare_bpm.or(m.bpm) } else { None });

    let mut c = Chroma {
        all: [0.0; 12],
        bass: [0.0; 12],
        bass_first: [0.0; 12],
        peakiness: 1.0,
    };
    let lowest = tonal.iter().map(|n| n.key).min().unwrap_or(0);
    let first = m.seconds / 4.0;
    for n in &tonal {
        let pc = (n.key % 12) as usize;
        let d = (n.end - n.start).clamp(0.05, 4.0) as f32;
        c.all[pc] += d;
        // Basse : l'octave la plus grave jouée.
        if n.key < lowest + 12 {
            c.bass[pc] += d;
            if n.start < first {
                c.bass_first[pc] += d;
            }
        }
    }
    let key = names.key.or_else(|| {
        let classes = c.all.iter().filter(|&&v| v > 0.0).count();
        if classes < KEY_MIN_CLASSES {
            return None;
        }
        if let Some(k) = names.bare_key {
            return Some(k);
        }
        // Les boucles MIDI commencent presque toujours sur l'accord de tonique : si toutes les notes tiennent dans
        // sa gamme, c'est lui (Am – G – F – G est en la mineur, même si sol majeur colle aussi aux profils).
        if let Some(k) = first_chord(&tonal).filter(|&k| scale_fit(&c.all, k) >= 0.97) {
            return Some(k);
        }
        // Sinon le premier accord n'est pas la tonique : profils, avec les poids habituels.
        let (k, r) = best_key(&c)?;
        (r >= KEY_MIN_R_MIDI).then_some(k)
    });
    Analysis {
        bpm,
        key: key.map(|(pc, minor)| key_name(pc, minor)),
        kind,
    }
}

fn decide(names: &NameHints, acid: Option<Acid>, sig: &Signal, label: &str) -> Analysis {
    let sus = sustain(&sig.x, sig.rate);
    // Traité comme une boucle (qui se répète) s'il n'est pas tronqué et ne finit pas sur un silence.
    let circular = !sig.truncated && trailing_silence(&sig.x, sig.rate) < 0.2;
    let r = rhythm(sig, circular);
    let onsets = onset_count(&r.onset);
    let t = tempo(&r, sig, onsets, circular);

    // Boucle ou one-shot.
    let audio_loop = sig.seconds >= 1.2 && onsets >= 4 && t.as_ref().is_some_and(|t| t.fits_bars || t.periodicity >= 0.3 || sus >= 0.05);
    let kind = names
        .kind
        .or(acid.map(|a| if a.oneshot { SampleKind::Oneshot } else { SampleKind::Loop }))
        .unwrap_or(if audio_loop { SampleKind::Loop } else { SampleKind::Oneshot });

    // Tempo : écrit dans le nom, sinon (boucles seulement) nombre nu du nom, chunk acid, audio.
    let bpm = names.bpm.or(if kind == SampleKind::Loop {
        names.bare_bpm.or(acid.and_then(|a| a.bpm)).or(t.as_ref().map(|t| t.bpm))
    } else {
        None
    });

    // Tonalité : écrite dans le nom, sinon l'audio s'il est tonal (une lettre seule du nom ou la note de base
    // du chunk acid donnent alors la tonique).
    let c = chroma(sig);
    let found = best_key(&c);
    let classes = tonal_classes(&c.all);
    let peaky = c.peakiness;
    if std::env::var_os("CRATE_ANALYSIS_DEBUG").is_some() {
        let norm = |v: &[f32; 12]| {
            let m = v.iter().fold(0f32, |m, &x| m.max(x)).max(1e-9);
            v.iter().map(|x| format!("{:.0}", x / m * 9.0)).collect::<String>()
        };
        eprintln!(
            "{label}: {:.2}s on={onsets} sus={sus:.3} tempo={t:?} chroma={} bass={} classes={classes} peaky={peaky:.2} key={found:?}",
            sig.seconds,
            norm(&c.all),
            norm(&c.bass)
        );
    }
    let key = names.key.or_else(|| {
        let (k, r) = found?;
        let min_r = if sig.seconds < 0.5 { KEY_MIN_R_SHORT } else { KEY_MIN_R };
        if r < min_r || classes < KEY_MIN_CLASSES || peaky < KEY_MIN_PEAKINESS {
            return None;
        }
        Some(match (names.bare_key, acid.and_then(|a| a.root)) {
            (Some(b), _) => b,
            (None, Some(root)) => (root, k.1),
            _ => k,
        })
    });

    Analysis {
        bpm,
        key: key.map(|(pc, minor)| key_name(pc, minor)),
        kind,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tonalites_ecrites() {
        assert_eq!(parse_key("Am"), Some((9, true)));
        assert_eq!(parse_key("A#"), Some((10, false)));
        assert_eq!(parse_key("Bb"), Some((10, false)));
        assert_eq!(parse_key("Ebmin"), Some((3, true)));
        assert_eq!(parse_key("F#m"), Some((6, true)));
        assert_eq!(parse_key("cb"), Some((11, false)));
        assert_eq!(parse_key("Cmaj"), Some((0, false)));
        assert_eq!(parse_key("Dark"), None);
        assert_eq!(parse_key("Bass"), None);
        assert_eq!(parse_key("H"), None);
        assert_eq!(key_name(1, true), "C#m");
        assert_eq!(key_name(10, false), "Bb");
    }

    #[test]
    fn indices_du_nom() {
        let h = parse_name("Bass_Loop_Dark_115_Bm");
        assert_eq!((h.bare_bpm, h.key, h.kind), (Some(115.0), Some((11, true)), Some(SampleKind::Loop)));
        let h = parse_name("Pad 120bpm F#min");
        assert_eq!((h.bpm, h.key), (Some(120.0), Some((6, true))));
        let h = parse_name("KSHMR - Melody Loop - 128 BPM - C major");
        assert_eq!((h.bpm, h.key), (Some(128.0), Some((0, false))));
        let h = parse_name("Bass_Tape_G_17");
        assert_eq!((h.bare_bpm, h.key, h.bare_key), (None, None, Some((7, false))));
        let h = parse_name("Kick_Airy_10");
        assert_eq!(h, NameHints::default());
        let h = parse_name("Snare_Dusty_808");
        assert_eq!(h.bare_bpm, None);
        let h = parse_name("Vocal_One_Shot_Ebm");
        assert_eq!((h.kind, h.key), (Some(SampleKind::Oneshot), Some((3, true))));
        let h = parse_name("Drum_Loop_Bright_92");
        assert_eq!((h.bare_bpm, h.key, h.bare_key), (Some(92.0), None, None));
    }

    #[test]
    fn fft_d_un_sinus() {
        let n = 64;
        let mut re: Vec<f32> = (0..n)
            .map(|i| (2.0 * std::f32::consts::PI * 5.0 * i as f32 / n as f32).cos())
            .collect();
        let mut im = vec![0f32; n];
        fft(&mut re, &mut im);
        let mag: Vec<f32> = re.iter().zip(&im).map(|(a, b)| (a * a + b * b).sqrt()).collect();
        let k = (0..n / 2).max_by(|&a, &b| mag[a].total_cmp(&mag[b])).unwrap();
        assert_eq!(k, 5);
    }
}
