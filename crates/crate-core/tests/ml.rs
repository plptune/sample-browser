//! Modèle de tags (EfficientAT mn04_as) : le prétraitement Rust et le réseau donnent les mêmes valeurs que
//! PyTorch (références écrites par `scripts/model/export_efficientat.py` pour 3 sons synthétiques).

use std::f64::consts::TAU;

use serde_json::Value;

fn refs() -> Vec<Value> {
    serde_json::from_str::<Value>(include_str!("fixtures/efficientat_ref.json"))
        .unwrap()
        .as_array()
        .unwrap()
        .clone()
}

/// Mêmes formules que le script Python, en double précision, à 32 kHz.
fn sound(name: &str) -> Vec<f32> {
    let sr = 32_000.0;
    match name {
        "sine" => (0..32_000).map(|i| (0.5 * (TAU * 440.0 * i as f64 / sr).sin()) as f32).collect(),
        "kick" => (0..16_000)
            .map(|i| {
                let t = i as f64 / sr;
                let phase = TAU * (50.0 * t + 100.0 / 30.0 * (1.0 - (-30.0 * t).exp()));
                (phase.sin() * (-8.0 * t).exp()) as f32
            })
            .collect(),
        "chord" => (0..64_000)
            .map(|i| {
                let t = i as f64 / sr;
                let s: f64 = [220.0, 277.18, 329.63, 440.0]
                    .iter()
                    .enumerate()
                    .map(|(h, f)| (TAU * f * t).sin() / (h + 1) as f64)
                    .sum();
                (0.25 * s * (0.6 + 0.4 * (TAU * 3.0 * t).sin())) as f32
            })
            .collect(),
        _ => unreachable!(),
    }
}

fn close(got: &[f32], want: &Value, tol: f32, what: &str) {
    let want: Vec<f32> = want.as_array().unwrap().iter().map(|v| v.as_f64().unwrap() as f32).collect();
    assert_eq!(got.len(), want.len(), "{what} : longueur");
    let worst = got.iter().zip(&want).map(|(a, b)| (a - b).abs()).fold(0f32, f32::max);
    assert!(worst <= tol, "{what} : écart max {worst} > {tol}");
}

#[test]
fn mel_identique_a_pytorch() {
    for r in refs() {
        let name = r["name"].as_str().unwrap();
        let (m, frames) = crate_core::dsp::mel(&sound(name));
        assert_eq!(frames as u64, r["frames"].as_u64().unwrap(), "{name} : trames");
        let n = crate_core::dsp::N_MELS;
        let means: Vec<f32> = (0..n)
            .map(|b| m[b * frames..(b + 1) * frames].iter().sum::<f32>() / frames as f32)
            .collect();
        let col = |t: usize| (0..n).map(|b| m[b * frames + t]).collect::<Vec<f32>>();
        close(&means, &r["bandMeans"], 2e-3, &format!("{name} moyennes"));
        close(&col(0), &r["frame0"], 2e-3, &format!("{name} trame 0"));
        close(&col(frames / 2), &r["frameMid"], 2e-3, &format!("{name} trame du milieu"));
    }
}

#[test]
fn reechantillonnage() {
    // Une sinusoïde de 1 kHz à 44,1 kHz reste une sinusoïde de 1 kHz à 32 kHz (même amplitude, même phase).
    let x: Vec<f32> = (0..44_100).map(|i| (TAU * 1000.0 * i as f64 / 44_100.0).sin() as f32).collect();
    let y = crate_core::dsp::resample(&x, 44_100, 32_000);
    assert_eq!(y.len(), 32_000);
    let worst = y[200..31_800]
        .iter()
        .enumerate()
        .map(|(i, v)| (v - (TAU * 1000.0 * (i + 200) as f64 / 32_000.0).sin() as f32).abs())
        .fold(0f32, f32::max);
    assert!(worst < 2e-3, "écart {worst}");
    // Au-dessus de la nouvelle Nyquist (18 kHz > 16 kHz) : coupé.
    let hi: Vec<f32> = (0..44_100).map(|i| (TAU * 18_000.0 * i as f64 / 44_100.0).sin() as f32).collect();
    let y = crate_core::dsp::resample(&hi, 44_100, 32_000);
    let rms = (y[200..31_800].iter().map(|v| v * v).sum::<f32>() / 31_600.0).sqrt();
    assert!(rms < 0.01, "repliement {rms}");
}

#[test]
fn reseau_identique_a_pytorch() {
    for r in refs() {
        let name = r["name"].as_str().unwrap();
        let frames = r["frames"].as_u64().unwrap();
        // Comparable seulement sans silence ajouté : durée pile sur une taille fixe (1 s, 2 s).
        if ![100, 200].contains(&frames) {
            continue;
        }
        let probs = crate_core::ml::classify(&sound(name)).expect("modèle chargé");
        assert_eq!(probs.len(), crate_core::ml::N_CLASSES);
        let want: Vec<f32> = r["logits"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| 1.0 / (1.0 + (-v.as_f64().unwrap() as f32).exp()))
            .collect();
        let worst = probs.iter().zip(&want).map(|(a, b)| (a - b).abs()).fold(0f32, f32::max);
        assert!(worst < 2e-3, "{name} : écart de probabilité {worst}");
    }
}

/// Calibrage des seuils du modèle sur un vrai dossier : les instruments écrits dans les noms servent d'annotation.
/// Pour chaque tag : précision et rappel de « tag le plus probable, au-dessus du seuil », par seuil.
///
/// `CRATE_ANALYSIS_DIR=/chemin [CRATE_CALIBRATION_MAX=3000] cargo test --release -p crate-core --test ml -- --ignored --nocapture`
#[test]
#[ignore]
fn calibrer_les_seuils() {
    use crate_core::autotag;
    let Ok(dir) = std::env::var("CRATE_ANALYSIS_DIR") else {
        eprintln!("CRATE_ANALYSIS_DIR non défini");
        return;
    };
    let max: usize = std::env::var("CRATE_CALIBRATION_MAX")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(3000);
    let mut files = vec![];
    let mut stack = vec![std::path::PathBuf::from(dir)];
    while let Some(d) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&d) else { continue };
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                stack.push(p);
            } else if p
                .extension()
                .and_then(|x| x.to_str())
                .is_some_and(|x| ["wav", "aif", "aiff", "flac", "mp3", "ogg"].contains(&x.to_lowercase().as_str()))
            {
                files.push(p);
            }
        }
    }
    files.sort();
    // Annotation : un seul instrument dans le nom (ou le dossier), ramené au vocabulaire du modèle.
    let model_tag = |t: &str| -> Option<&'static str> {
        let t = match t {
            "openhat" => "hat",
            "808" | "sub" => "bass",
            "pad" | "lead" => "synth",
            t => t,
        };
        crate_core::ml::CLASS_TAGS.iter().map(|(m, _)| *m).find(|m| *m == t)
    };
    let labeled: Vec<(std::path::PathBuf, &'static str)> = files
        .iter()
        .filter_map(|p| {
            let stem = p.file_stem()?.to_string_lossy().into_owned();
            let parents: Vec<String> = p
                .ancestors()
                .skip(1)
                .take(2)
                .filter_map(|a| a.file_name().map(|n| n.to_string_lossy().into_owned()))
                .collect();
            let parents: Vec<&str> = parents.iter().map(String::as_str).collect();
            let n = autotag::from_name(&stem, &parents);
            let tags: Vec<&'static str> = n.instruments.iter().filter_map(|t| model_tag(t)).collect();
            (tags.len() == 1).then(|| (p.clone(), tags[0]))
        })
        .collect();
    let step = (labeled.len() / max).max(1);
    let sample: Vec<_> = labeled.iter().step_by(step).take(max).collect();
    eprintln!(
        "{} fichiers audio, {} annotés par leur nom, {} évalués",
        files.len(),
        labeled.len(),
        sample.len()
    );
    let t0 = std::time::Instant::now();
    let scored: Vec<(&'static str, Vec<(&'static str, f32)>)> = sample
        .iter()
        .filter_map(|(p, want)| crate_core::analysis::model_scores(p).map(|s| (*want, s)))
        .collect();
    eprintln!(
        "{:.1} ms par fichier (décodage compris)",
        t0.elapsed().as_secs_f64() * 1000.0 / scored.len().max(1) as f64
    );
    let thresholds = [0.05f32, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5];
    for (tag, _) in crate_core::ml::CLASS_TAGS {
        let n = scored.iter().filter(|(w, _)| w == tag).count();
        let mut line = format!("{tag:>7} ({n:>4}) :");
        for th in thresholds {
            let (mut tp, mut fp) = (0usize, 0usize);
            for (want, s) in &scored {
                let best = s.iter().copied().fold(("", 0f32), |m, x| if x.1 > m.1 { x } else { m });
                if best.0 == *tag && best.1 >= th {
                    if want == tag {
                        tp += 1
                    } else {
                        fp += 1
                    }
                }
            }
            let p = (100 * tp).checked_div(tp + fp).unwrap_or(0);
            let r = (100 * tp).checked_div(n).unwrap_or(0);
            line += &format!("  {th:.2}: P{p:>3} R{r:>3}");
        }
        eprintln!("{line}");
    }
}

/// Le modèle n'est cru que pour son tag le plus probable, et seulement au-dessus du seuil de ce tag.
#[test]
fn decision_du_modele() {
    use crate_core::analysis::decide_model;
    let s = |xs: &[(&'static str, f32)]| xs.to_vec();
    assert_eq!(decide_model(&s(&[("vocal", 0.3), ("fx", 0.1)]), false, false), ["vocal"]);
    assert!(
        decide_model(&s(&[("kick", 0.9)]), false, false).is_empty(),
        "kick : jamais d'après le modèle"
    );
    assert!(
        decide_model(&s(&[("fx", 0.5), ("vocal", 0.2)]), false, false).is_empty(),
        "le plus probable ne passe pas"
    );
    assert!(decide_model(&s(&[("piano", 0.1)]), false, false).is_empty(), "sous le seuil");
    assert_eq!(decide_model(&s(&[("hat", 0.3)]), false, true), ["openhat"]);
    assert_eq!(decide_model(&s(&[("hat", 0.3)]), true, true), ["hat"]);
}
