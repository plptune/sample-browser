//! Traitement du signal partagé : FFT, rééchantillonnage, spectrogramme mel du modèle de tags (`ml`).
//!
//! Le mel reproduit exactement le prétraitement d'EfficientAT (`models/preprocess.py`, mode évaluation) :
//! préaccentuation [−0,97, 1] sans padding, STFT n_fft 1024 / fenêtre de Hann symétrique de 800 / saut 320,
//! `center=True` (padding réfléchi), puissance, 128 bandes mel de Kaldi (matrice exportée par
//! `scripts/model/export_efficientat.py`), `log(x + 1e-5)`, puis `(x + 4,5) / 5`.

/// FFT complexe en place (radix 2, taille puissance de deux).
pub(crate) fn fft(re: &mut [f32], im: &mut [f32]) {
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

/// Fréquence d'échantillonnage du modèle de tags.
pub const ML_RATE: u32 = 32_000;
const N_FFT: usize = 1024;
const WIN: usize = 800;
const HOP: usize = 320;
pub const N_MELS: usize = 128;

/// Rééchantillonne `x` de `from` Hz vers `to` Hz : sinc fenêtré (Blackman), coupure juste sous la plus petite des
/// deux fréquences de Nyquist, 16 passages par zéro de chaque côté.
pub fn resample(x: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to || x.is_empty() {
        return x.to_vec();
    }
    const ZEROS: f64 = 16.0;
    /// Pas de la table du noyau : 1/256 d'échantillon d'entrée (interpolation linéaire entre deux pas).
    const STEPS: usize = 256;
    let ratio = from as f64 / to as f64;
    // Coupure relative à la fréquence d'entrée (1 = Nyquist d'entrée).
    let cutoff = (to as f64 / from as f64).min(1.0) * 0.95;
    let half = (ZEROS / cutoff).ceil() as i64; // demi-largeur du noyau, en échantillons d'entrée
                                               // Noyau (sinc fenêtré par Blackman), symétrique : tabulé une fois de 0 à `half`.
    let kernel = |d: f64| -> f64 {
        let w = d / half as f64; // 0..1
        if w >= 1.0 {
            return 0.0;
        }
        let u = d * cutoff;
        let sinc = if u.abs() < 1e-9 {
            1.0
        } else {
            (std::f64::consts::PI * u).sin() / (std::f64::consts::PI * u)
        };
        let a = std::f64::consts::PI * (w + 1.0);
        cutoff * sinc * (0.42 - 0.5 * a.cos() + 0.08 * (2.0 * a).cos())
    };
    let table: Vec<f32> = (0..=half as usize * STEPS + 1)
        .map(|i| kernel(i as f64 / STEPS as f64) as f32)
        .collect();
    let n_out = ((x.len() as f64) / ratio).floor() as usize;
    let mut out = Vec::with_capacity(n_out);
    for n in 0..n_out {
        let t = n as f64 * ratio;
        let c = t.floor() as i64;
        let mut acc = 0f32;
        for k in (c - half + 1).max(0)..=(c + half).min(x.len() as i64 - 1) {
            let pos = (t - k as f64).abs() * STEPS as f64;
            let (i, frac) = (pos as usize, pos.fract() as f32);
            if i + 1 < table.len() {
                acc += x[k as usize] * (table[i] + (table[i + 1] - table[i]) * frac);
            }
        }
        out.push(acc);
    }
    out
}

/// Bandes mel creuses : (premier bin, poids).
struct MelBanks(Vec<(usize, Vec<f32>)>);

fn mel_banks() -> &'static MelBanks {
    static BANKS: std::sync::OnceLock<MelBanks> = std::sync::OnceLock::new();
    BANKS.get_or_init(|| {
        let b: &[u8] = include_bytes!("../models/mel_banks.bin");
        let u16_at = |i: usize| u16::from_le_bytes([b[i], b[i + 1]]) as usize;
        let (rows, cols) = (u16_at(0), u16_at(2));
        assert_eq!((rows, cols), (N_MELS, N_FFT / 2 + 1), "mel_banks.bin");
        let mut pos = 4;
        let mut out = Vec::with_capacity(rows);
        for _ in 0..rows {
            let (start, len) = (u16_at(pos), u16_at(pos + 2));
            pos += 4;
            let w = (0..len)
                .map(|k| f32::from_le_bytes(b[pos + 4 * k..pos + 4 * k + 4].try_into().unwrap()))
                .collect();
            pos += 4 * len;
            out.push((start, w));
        }
        MelBanks(out)
    })
}

/// Valeur d'une trame de silence (après log et normalisation) : sert à compléter une entrée trop courte.
pub const MEL_SILENCE: f32 = (-11.512_925 + 4.5) / 5.0; // (ln(1e-5) + 4,5) / 5

/// Spectrogramme mel d'un signal mono à 32 kHz : `N_MELS` lignes de `frames` valeurs (rangées bande par bande),
/// et le nombre de trames.
pub fn mel(x: &[f32]) -> (Vec<f32>, usize) {
    // Préaccentuation (convolution sans padding : un échantillon de moins).
    let y: Vec<f32> = x.windows(2).map(|w| w[1] - 0.97 * w[0]).collect();
    if y.is_empty() {
        return (vec![], 0);
    }
    let pad = N_FFT / 2;
    // Padding réfléchi (comme torch.stft, center=True) ; un signal plus court que le padding se replie sur lui-même.
    let len = y.len() as i64;
    let at = |i: i64| -> f32 {
        if len == 1 {
            return y[0];
        }
        let period = 2 * (len - 1);
        let mut j = i.rem_euclid(period);
        if j >= len {
            j = period - j;
        }
        y[j as usize]
    };
    let frames = 1 + y.len() / HOP;
    // Fenêtre de Hann symétrique de 800, centrée dans les 1024 points de la FFT.
    let off = (N_FFT - WIN) / 2;
    let win: Vec<f32> = (0..WIN)
        .map(|i| 0.5 - 0.5 * (std::f64::consts::TAU * i as f64 / (WIN - 1) as f64).cos() as f32)
        .collect();
    let banks = mel_banks();
    let mut out = vec![0f32; N_MELS * frames];
    let (mut re, mut im) = (vec![0f32; N_FFT], vec![0f32; N_FFT]);
    let mut power = vec![0f32; N_FFT / 2 + 1];
    for f in 0..frames {
        let start = (f * HOP) as i64 - pad as i64;
        re.iter_mut().for_each(|v| *v = 0.0);
        im.iter_mut().for_each(|v| *v = 0.0);
        for (i, w) in win.iter().enumerate() {
            re[off + i] = at(start + (off + i) as i64) * w;
        }
        fft(&mut re, &mut im);
        for (k, p) in power.iter_mut().enumerate() {
            *p = re[k] * re[k] + im[k] * im[k];
        }
        for (m, (first, w)) in banks.0.iter().enumerate() {
            let e: f32 = w.iter().zip(&power[*first..]).map(|(a, b)| a * b).sum();
            out[m * frames + f] = ((e + 1e-5).ln() + 4.5) / 5.0;
        }
    }
    (out, frames)
}
