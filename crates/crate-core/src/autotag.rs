//! Tags automatiques : un vocabulaire fermé (instrument, `fx`, `wet` / `dry`), posé par l'analyse.
//!
//! Sources, de la plus sûre à la moins sûre (comme pour le tempo) : le **nom** du fichier, puis le dossier le plus
//! proche quand le nom ne dit rien, puis l'audio (`analysis`). Un tag retiré à la main ne revient jamais (base :
//! `file_auto_tags.rejected`).

/// Vocabulaire automatique, dans l'ordre de priorité des instruments (batterie d'abord : « 808 Kick » est un kick,
/// « Synth Bass » une basse, « Vocal FX » un effet).
pub const DRUMS: &[&str] = &[
    "kick", "snare", "clap", "rim", "snap", "hat", "openhat", "cymbal", "tom", "shaker", "perc",
];
pub const INSTRUMENTS: &[&str] = &[
    "kick", "snare", "clap", "rim", "snap", "hat", "openhat", "cymbal", "tom", "shaker", "perc", "fx", "808", "sub", "bass", "pad", "lead",
    "piano", "keys", "string", "brass", "vocal", "synth",
];
pub const SPACE: &[&str] = &["wet", "dry"];

/// Tags dérivés du type (boucle / one-shot) : affichés comme des tags, jamais stockés.
pub const KIND_TAGS: &[&str] = &["loop", "oneshot"];

/// Un tag du vocabulaire automatique (instrument ou espace).
pub fn is_vocabulary(tag: &str) -> bool {
    INSTRUMENTS.contains(&tag) || SPACE.contains(&tag)
}

/// Tag tapé par l'utilisateur : sans espaces autour, en minuscules (la recherche `#` l'est) ; `None` s'il est vide
/// ou réservé (`loop` / `oneshot` viennent du type du sample).
pub fn normalize(tag: &str) -> Option<String> {
    let t = tag.trim().to_lowercase();
    (!t.is_empty() && !KIND_TAGS.contains(&t.as_str())).then_some(t)
}

pub fn is_drum(tag: &str) -> bool {
    DRUMS.contains(&tag)
}

/// Mots (minuscules, après découpe) → tag. Les mots ambigus sont absents : `key` (tonalité), `ep`, `block`, `rs`, `sn`.
const WORDS: &[(&str, &[&str])] = &[
    ("kick", &["kick", "kik", "kck", "bd", "bassdrum", "kickdrum"]),
    ("snare", &["snare", "snr", "sd"]),
    ("clap", &["clap", "clp", "cp", "handclap"]),
    ("rim", &["rim", "rimshot"]),
    ("snap", &["snap", "snp", "fingersnap"]),
    ("hat", &["hat", "hh", "hihat", "ch", "chh", "closedhat"]),
    ("openhat", &["oh", "ohh", "openhat", "ophat"]),
    ("cymbal", &["cymbal", "cym", "crash", "ride", "splash", "china"]),
    ("tom", &["tom", "floortom"]),
    ("shaker", &["shaker", "shkr", "shk", "maraca", "cabasa"]),
    (
        "perc",
        &[
            "perc",
            "percussion",
            "conga",
            "bongo",
            "cowbell",
            "tamb",
            "tambourine",
            "clave",
            "woodblock",
            "triangle",
            "timbale",
            "guiro",
            "djembe",
            "tabla",
        ],
    ),
    (
        "fx",
        &[
            "fx",
            "sfx",
            "riser",
            "uplifter",
            "downlifter",
            "impact",
            "sweep",
            "whoosh",
            "noise",
            "foley",
            "transition",
            "swell",
            "glitch",
            "laser",
            "zap",
        ],
    ),
    ("808", &["808"]),
    ("sub", &["sub", "subbass"]),
    ("bass", &["bass", "bs", "reese", "bassline"]),
    ("pad", &["pad"]),
    ("lead", &["lead", "ld"]),
    ("piano", &["piano", "pno"]),
    (
        "keys",
        &["keys", "rhodes", "wurli", "wurlitzer", "organ", "epiano", "clav", "clavinet"],
    ),
    ("string", &["string", "violin", "viola", "cello", "pizz", "pizzicato"]),
    ("brass", &["brass", "trumpet", "trombone", "horn", "sax", "saxophone", "tuba"]),
    (
        "vocal",
        &["vocal", "vox", "voc", "acapella", "acappella", "choir", "chant", "adlib"],
    ),
    ("synth", &["synth", "syn"]),
    ("wet", &["wet", "reverb", "verb"]),
    ("dry", &["dry"]),
];

/// Deux mots qui n'en font qu'un (« Bass Drum », « Hi Hat », « Open Hat »).
const PAIRS: &[(&str, &str, &str)] = &[
    ("bass", "drum", "kick"),
    ("kick", "drum", "kick"),
    ("snare", "drum", "snare"),
    ("hi", "hat", "hat"),
    ("closed", "hat", "hat"),
    ("hat", "closed", "hat"),
    ("open", "hat", "openhat"),
    ("open", "hihat", "openhat"),
    ("hat", "open", "openhat"),
    ("hihat", "open", "openhat"),
    ("finger", "snap", "snap"),
    ("rim", "shot", "rim"),
    ("sub", "bass", "sub"),
    ("e", "piano", "keys"),
    ("electric", "piano", "keys"),
    ("hand", "clap", "clap"),
    ("wood", "block", "perc"),
];

/// Dossiers qui ne disent rien de l'instrument.
const GENERIC_DIRS: &[&str] = &[
    "loops",
    "loop",
    "one shots",
    "oneshots",
    "one-shots",
    "one_shots",
    "shots",
    "hits",
    "samples",
    "sounds",
    "audio",
    "wav",
    "wavs",
    "drums",
    "drum",
    "drum loops",
    "kits",
    "kit",
    "misc",
    "various",
    "stems",
    "midi",
];

/// Découpe : séparateurs, casse « camel » (`BassDrum`, `HHLoop`), lettres / chiffres (`Kick01`, `TR808`), minuscules.
fn words(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    for part in s.split(|c: char| !c.is_alphanumeric()).filter(|t| !t.is_empty()) {
        let chars: Vec<char> = part.chars().collect();
        let mut cur = String::new();
        for (i, &c) in chars.iter().enumerate() {
            if i > 0 {
                let p = chars[i - 1];
                // `BassDrum` → bass | drum ; `HHLoop` → hh | loop (la dernière majuscule commence le mot suivant).
                let camel = p.is_lowercase() && c.is_uppercase()
                    || p.is_uppercase() && c.is_uppercase() && chars.get(i + 1).is_some_and(|n| n.is_lowercase());
                let digit = p.is_ascii_digit() != c.is_ascii_digit();
                if camel || digit {
                    out.push(std::mem::take(&mut cur).to_lowercase());
                }
            }
            cur.push(c);
        }
        out.push(cur.to_lowercase());
    }
    out
}

/// Mot → tag, pluriels compris (`Kicks`, `Pads`, `Strings`, `Hats`). `keys` reste `keys`.
fn tag_of(w: &str) -> Option<&'static str> {
    let find = |w: &str| WORDS.iter().find(|(_, ws)| ws.contains(&w)).map(|(t, _)| *t);
    find(w).or_else(|| {
        let s = w
            .strip_suffix("es")
            .filter(|s| s.ends_with("sh") || s.ends_with("ch"))
            .or_else(|| w.strip_suffix('s'))?;
        (s.len() >= 2).then(|| find(s)).flatten()
    })
}

/// Tags lus dans un texte (nom ou dossier), sans doublon, dans l'ordre d'apparition.
fn scan(s: &str) -> Vec<&'static str> {
    let ws = words(s);
    let mut out: Vec<&'static str> = Vec::new();
    let mut i = 0;
    while i < ws.len() {
        // « No Kick », « without vocals » : le mot suivant ne compte pas.
        if ["no", "without", "sans", "minus"].contains(&ws[i].as_str()) {
            i += 2;
            continue;
        }
        // Chaque mot d'une paire : exact (au pluriel près), ou même tag (`HH Closed`, `Open HH`).
        let same = |a: &str, w: &str| a == w || w.strip_suffix('s') == Some(a) || tag_of(a).is_some() && tag_of(a) == tag_of(w);
        let pair = ws
            .get(i + 1)
            .and_then(|n| PAIRS.iter().find(|(a, b, _)| same(a, &ws[i]) && same(b, n)));
        let (tag, step) = match pair {
            Some((_, _, t)) => (Some(*t), 2),
            None => (tag_of(&ws[i]), 1),
        };
        if let Some(t) = tag {
            if !out.contains(&t) {
                out.push(t);
            }
        }
        i += step;
    }
    out
}

/// Tags du nom : instruments (par priorité) et espace (`wet` / `dry`), lus dans le nom du fichier, ou, pour
/// l'instrument seulement, dans le dossier parent quand le nom ne dit rien (les dossiers génériques sont sautés).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct NameTags {
    pub instruments: Vec<&'static str>,
    pub space: Option<&'static str>,
}

pub fn from_name(stem: &str, parents: &[&str]) -> NameTags {
    let mut found = scan(stem);
    // « Oh » dans une prise de voix (`Vox Oh Yeah`) n'est pas une charleston ouverte.
    if found.contains(&"vocal") && !words(stem).iter().any(|w| w.starts_with("open")) {
        found.retain(|t| *t != "openhat");
    }
    let mut instruments: Vec<&'static str> = found.iter().copied().filter(|t| INSTRUMENTS.contains(t)).collect();
    let space = found.iter().copied().find(|t| SPACE.contains(t));
    if instruments.is_empty() {
        if let Some(dir) = parents.iter().find(|d| !GENERIC_DIRS.contains(&d.trim().to_lowercase().as_str())) {
            instruments = scan(dir).into_iter().filter(|t| INSTRUMENTS.contains(t)).collect();
        }
    }
    instruments.sort_by_key(|t| INSTRUMENTS.iter().position(|x| x == t));
    NameTags { instruments, space }
}

/// Instruments retenus : un seul pour un one-shot ; pour une boucle, les tags de batterie (au plus 3) s'il y en a,
/// sinon un seul.
pub fn pick(instruments: &[&'static str], is_loop: bool) -> Vec<&'static str> {
    let drums: Vec<&'static str> = instruments.iter().copied().filter(|t| is_drum(t)).collect();
    if is_loop && drums.len() > 1 {
        return drums.into_iter().take(3).collect();
    }
    instruments.first().copied().into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tags(stem: &str, parents: &[&str]) -> Vec<&'static str> {
        let n = from_name(stem, parents);
        let mut v = pick(&n.instruments, stem.to_lowercase().contains("loop"));
        v.extend(n.space);
        v
    }

    #[test]
    fn noms_de_packs() {
        let cases: &[(&str, &[&str], &[&str])] = &[
            ("BD_Dusty_02", &[], &["kick"]),
            ("Kick 01", &[], &["kick"]),
            ("Bass Drum Hard", &[], &["kick"]),
            ("BassDrum_909", &[], &["kick"]),
            ("Sub Kick", &[], &["kick"]),
            ("808 Kick Long", &[], &["kick"]),
            ("808_Boom_C", &[], &["808"]),
            ("TR808 Cowbell", &[], &["perc"]),
            ("SD_Crack", &[], &["snare"]),
            ("Clap_Wide", &[], &["clap"]),
            ("Rimshot 3", &[], &["rim"]),
            ("Finger Snap", &[], &["snap"]),
            ("Snapshot_Pad_Am", &[], &["pad"]),
            ("HH_Closed_01", &[], &["hat"]),
            ("Hi Hat Tight", &[], &["hat"]),
            ("Open Hat 2", &[], &["openhat"]),
            ("OH_Sizzle", &[], &["openhat"]),
            ("Crash_Long", &[], &["cymbal"]),
            ("Tom Low", &[], &["tom"]),
            ("Shaker Loop 120", &[], &["shaker"]),
            ("Conga Hit", &[], &["perc"]),
            ("Riser_8bars", &[], &["fx"]),
            ("Vocal FX Reverse", &[], &["fx"]),
            ("Synth_Bass_Gm", &[], &["bass"]),
            ("Reese 140 F", &[], &["bass"]),
            ("Sub Bass Clean", &[], &["sub"]),
            ("Warm Pads", &[], &["pad"]),
            ("Synth Lead Saw", &[], &["lead"]),
            ("LD_Pluck_120", &[], &["lead"]),
            ("Grand Piano C", &[], &["piano"]),
            ("Rhodes Chords Am", &[], &["keys"]),
            ("E Piano 3", &[], &["keys"]),
            ("Strings Ensemble", &[], &["string"]),
            ("Trumpet Stab", &[], &["brass"]),
            ("Vox Chop 3", &[], &["vocal"]),
            ("Choir Ahh", &[], &["vocal"]),
            ("Vox Oh Yeah", &[], &["vocal"]),
            ("Synth Stab F", &[], &["synth"]),
            ("Key_Am_Chord", &[], &[]),
            ("Clap Reverb", &[], &["clap", "wet"]),
            ("Snare Dry", &[], &["snare", "dry"]),
            // Dossier parent quand le nom ne dit rien ; les dossiers génériques sont sautés.
            ("Sample 017", &["Kicks", "Drums"], &["kick"]),
            ("Hit 3", &["One Shots", "Snares"], &["snare"]),
            ("Thing", &["Loops"], &[]),
            ("Tight 4", &["Drums", "Pack"], &[]),
            // Boucle de batterie : plusieurs tags de batterie.
            ("Kick Hat Loop 120", &[], &["kick", "hat"]),
            ("VEC4 Open HH 058", &[], &["openhat"]),
            ("Drum_Loop_A__No_Kick_", &[], &[]),
            ("Top Loop without hats", &[], &[]),
            ("HHLoop_Malt_95BPM", &[], &["hat"]),
            ("Drum Loop 92", &[], &[]),
        ];
        for (stem, parents, want) in cases {
            assert_eq!(tags(stem, parents), *want, "{stem} {parents:?}");
        }
    }

    #[test]
    fn decoupe() {
        assert_eq!(words("BassDrum_909"), ["bass", "drum", "909"]);
        assert_eq!(words("Kick01"), ["kick", "01"]);
        assert_eq!(words("TR808 Cowbell"), ["tr", "808", "cowbell"]);
        assert_eq!(words("HHLoop"), ["hh", "loop"]);
        assert!(is_vocabulary("kick") && is_vocabulary("wet") && !is_vocabulary("warm"));
    }
}
