//! Modèle de tags audio : EfficientAT `mn04_as` (Florian Schmid, licence MIT ; 0,98 M paramètres, entraîné sur
//! AudioSet, 527 classes), embarqué au format NNEF et exécuté par tract (pur Rust).
//!
//! Il ne sert qu'en dernier recours : l'instrument écrit dans le nom (ou le dossier) l'emporte toujours. Entrée :
//! le mel de `dsp::mel` (10 s au plus), complété par du silence jusqu'à la plus petite taille fixe qui le contient
//! (1, 2, 4 ou 10 s) : les plans optimisés sont construits une fois par taille, à la première demande, et partagés
//! par les threads d'analyse.

use std::sync::{Arc, OnceLock};

use tract_nnef::prelude::*;

use crate::dsp::{self, MEL_SILENCE, N_MELS};

static MODEL: &[u8] = include_bytes!("../models/mn04_as.nnef.tgz");

/// Tailles fixes, en trames de 10 ms.
const BUCKETS: [usize; 4] = [100, 200, 400, 1000];
/// Durée analysée au plus (s).
pub const MAX_SECONDS: f64 = 10.0;
pub const N_CLASSES: usize = 527;

static PLANS: [OnceLock<Option<Arc<TypedSimplePlan>>>; 4] = [OnceLock::new(), OnceLock::new(), OnceLock::new(), OnceLock::new()];

fn plan(bucket: usize) -> Option<&'static Arc<TypedSimplePlan>> {
    PLANS[bucket]
        .get_or_init(|| {
            let build = || -> TractResult<Arc<TypedSimplePlan>> {
                let model = tract_nnef::nnef().model_for_read(&mut &MODEL[..])?;
                let t = model.sym("T");
                let subs = std::collections::HashMap::from([(t, TDim::Val(BUCKETS[bucket] as i64))]);
                model.set_symbols(&subs)?.into_optimized()?.into_runnable()
            };
            build().map_err(|e| eprintln!("[crate] modèle de tags indisponible : {e}")).ok()
        })
        .as_ref()
}

/// Probabilités des 527 classes AudioSet pour un son mono à 32 kHz (10 premières secondes). `None` si le son est
/// vide ou si le modèle ne se charge pas.
pub fn classify(x: &[f32]) -> Option<Vec<f32>> {
    let x = &x[..x.len().min((MAX_SECONDS * dsp::ML_RATE as f64) as usize)];
    let (mel, frames) = dsp::mel(x);
    if frames == 0 {
        return None;
    }
    let b = BUCKETS.iter().position(|&n| n >= frames).unwrap_or(BUCKETS.len() - 1);
    let t = BUCKETS[b];
    let input = tract_ndarray::Array4::from_shape_fn(
        (1, 1, N_MELS, t),
        |(_, _, m, j)| {
            if j < frames {
                mel[m * frames + j]
            } else {
                MEL_SILENCE
            }
        },
    );
    let out = plan(b)?.run(tvec!(Tensor::from(input).into())).ok()?;
    let logits = out[0].clone().into_tensor();
    let logits = logits.to_plain_array_view::<f32>().ok()?;
    Some(logits.iter().map(|&l| 1.0 / (1.0 + (-l).exp())).collect())
}

/// Classes AudioSet (index de `class_labels_indices.csv`) → tag du vocabulaire. AudioSet n'a ni tom, ni shaker à
/// part (maracas, hochets), ni crash : ces tags-là ne viennent que du nom.
pub const CLASS_TAGS: &[(&str, &[usize])] = &[
    ("kick", &[168]),                             // Bass drum
    ("snare", &[165]),                            // Snare drum
    ("rim", &[166]),                              // Rimshot
    ("clap", &[63]),                              // Clapping
    ("snap", &[62]),                              // Finger snapping
    ("hat", &[172]),                              // Hi-hat
    ("cymbal", &[171]),                           // Cymbal
    ("shaker", &[175, 176]),                      // Rattle, Maraca
    ("perc", &[92, 170, 173, 174]),               // Cowbell, Tabla, Wood block, Tambourine
    ("bass", &[142, 194]),                        // Bass guitar, Double bass
    ("string", &[189, 190, 191, 192, 193]),       // Bowed string, String section, Violin, Pizzicato, Cello
    ("brass", &[185, 186, 187, 188, 197]),        // Brass, French horn, Trumpet, Trombone, Saxophone
    ("synth", &[158]),                            // Synthesizer
    ("piano", &[153]),                            // Piano
    ("keys", &[154, 155, 157, 160]),              // Electric piano, Organ, Hammond organ, Harpsichord
    ("vocal", &[0, 27, 28, 32, 33, 36, 254]),     // Speech, Singing, Choir, Male / Female singing, Rapping, Vocal music
    ("fx", &[426, 459, 504, 513, 515, 520, 521]), // Explosion, Whoosh, Sound effect, Noise, Static, White / Pink noise
];

/// Score de chaque tag : la plus forte probabilité de ses classes.
pub fn tag_scores(probs: &[f32]) -> Vec<(&'static str, f32)> {
    CLASS_TAGS
        .iter()
        .map(|(tag, classes)| {
            (
                *tag,
                classes.iter().map(|&c| probs.get(c).copied().unwrap_or(0.0)).fold(0.0, f32::max),
            )
        })
        .collect()
}
