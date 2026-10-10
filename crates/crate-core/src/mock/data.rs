//! Données factices déterministes. Port exact de `src/mock/generate.ts` : même graine, mêmes tirages
//! dans le même ordre, donc les mêmes 407 samples (400 audio, 7 MIDI) (ids, noms, chemins, tags…) que le prototype.
//! Vérifié par `tests/parity.rs` contre une empreinte produite par le code TypeScript.

use crate::catalog::FolderNode;
use crate::model::{Collection, CollectionKind, Sample, SampleKind, VirtualFolder};

/// Générateur mulberry32 (identique à la version JS, arithmétique u32).
pub struct Rng(u32);

impl Rng {
    pub fn new(seed: u32) -> Self {
        Rng(seed)
    }

    pub fn next_f64(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x6d2b_79f5);
        let mut t = self.0;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        (t ^ (t >> 14)) as f64 / 4_294_967_296.0
    }

    fn pick<'a, T>(&mut self, xs: &'a [T]) -> &'a T {
        &xs[(self.next_f64() * xs.len() as f64).floor() as usize]
    }

    fn between(&mut self, lo: f64, hi: f64) -> f64 {
        lo + self.next_f64() * (hi - lo)
    }

    fn int(&mut self, lo: i64, hi: i64) -> i64 {
        self.between(lo as f64, (hi + 1) as f64).floor() as i64
    }
}

pub const SEED: u32 = 0xc4a7e;

pub const TAGS: [&str; 12] = [
    "warm", "dark", "bright", "punchy", "lofi", "vinyl", "airy", "gritty", "clean", "analog", "tape", "wide",
];

const KEYS: [&str; 15] = ["C", "Cm", "D", "Dm", "E", "Em", "F", "Fm", "F#m", "G", "Gm", "A", "Am", "Bb", "Bm"];
const ADJ: [&str; 15] = [
    "Dusty", "Warm", "Punchy", "Lofi", "Tape", "Deep", "Bright", "Crunchy", "Vinyl", "Soft", "Hard", "Analog", "Dark", "Airy", "Round",
];

fn node(id: u32, name: &str, children: Vec<FolderNode>) -> FolderNode {
    FolderNode {
        id,
        name: name.into(),
        offline: false,
        children,
    }
}

/// Les 3 sources, sur 3 niveaux (mêmes ids que le prototype).
pub fn sources() -> Vec<FolderNode> {
    let mut field = node(
        20,
        "Field Recordings",
        vec![node(21, "Paris", vec![node(22, "Metro", vec![])]), node(23, "Forest", vec![])],
    );
    field.offline = true;
    vec![
        node(
            1,
            "Splice",
            vec![node(
                2,
                "packs",
                vec![
                    node(3, "Dusty Tapes Vol.2", vec![]),
                    node(4, "Night Textures", vec![]),
                    node(5, "Lofi Keys", vec![node(6, "MIDI", vec![])]),
                ],
            )],
        ),
        node(
            10,
            "Samples",
            vec![
                node(
                    11,
                    "Drums",
                    vec![
                        node(12, "Kicks", vec![]),
                        node(13, "Snares", vec![]),
                        node(14, "Hats", vec![]),
                        node(15, "Perc", vec![]),
                    ],
                ),
                node(16, "Bass", vec![]),
                node(17, "Vocals", vec![node(18, "Chops", vec![])]),
            ],
        ),
        field,
    ]
}

pub fn root_path(id: u32) -> &'static str {
    match id {
        1 => "~/Splice/sounds",
        10 => "~/Music/Samples",
        20 => "/Volumes/Field SSD",
        _ => "",
    }
}

/// Chemin complet de chaque dossier (racine = chemin de la source).
fn folder_paths(nodes: &[FolderNode], base: Option<&str>, out: &mut Vec<(u32, String)>) {
    for n in nodes {
        let p = match base {
            None => root_path(n.id).to_string(),
            Some(b) => format!("{b}/{}", n.name),
        };
        folder_paths(&n.children, Some(&p), out);
        out.push((n.id, p));
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Shape {
    Hit,
    Loop,
    Swell,
    Noise,
}

struct Category {
    name: &'static str,
    kind: SampleKind,
    folders: &'static [u32],
    count: u32,
    dur: (f64, f64),
    bars: &'static [u32],
    bpm: (i64, i64),
    keyed: bool,
    tags: &'static [&'static str],
    shape: Shape,
}

const fn oneshot(
    name: &'static str,
    folders: &'static [u32],
    count: u32,
    dur: (f64, f64),
    keyed: bool,
    tags: &'static [&'static str],
    shape: Shape,
) -> Category {
    Category {
        name,
        kind: SampleKind::Oneshot,
        folders,
        count,
        dur,
        bars: &[],
        bpm: (0, 0),
        keyed,
        tags,
        shape,
    }
}

#[allow(clippy::too_many_arguments)]
const fn looped(
    name: &'static str,
    folders: &'static [u32],
    count: u32,
    bars: &'static [u32],
    bpm: (i64, i64),
    keyed: bool,
    tags: &'static [&'static str],
    shape: Shape,
) -> Category {
    Category {
        name,
        kind: SampleKind::Loop,
        folders,
        count,
        dur: (0.0, 0.0),
        bars,
        bpm,
        keyed,
        tags,
        shape,
    }
}

const CATEGORIES: [Category; 16] = [
    oneshot(
        "Kick",
        &[12, 12, 3],
        46,
        (180.0, 720.0),
        false,
        &["punchy", "dark", "warm", "tape", "analog", "clean"],
        Shape::Hit,
    ),
    oneshot(
        "Snare",
        &[13, 13, 3],
        38,
        (140.0, 520.0),
        false,
        &["punchy", "bright", "gritty", "vinyl", "tape"],
        Shape::Hit,
    ),
    oneshot(
        "Clap",
        &[13, 3],
        20,
        (150.0, 450.0),
        false,
        &["bright", "wide", "clean", "lofi"],
        Shape::Hit,
    ),
    oneshot(
        "HiHat",
        &[14, 14, 3],
        34,
        (50.0, 260.0),
        false,
        &["bright", "airy", "clean", "gritty"],
        Shape::Hit,
    ),
    oneshot(
        "OpenHat",
        &[14],
        14,
        (300.0, 900.0),
        false,
        &["bright", "airy", "vinyl"],
        Shape::Hit,
    ),
    oneshot(
        "Perc",
        &[15, 15, 3],
        30,
        (80.0, 600.0),
        false,
        &["warm", "lofi", "analog", "dark"],
        Shape::Hit,
    ),
    looped(
        "Drum_Loop",
        &[3, 3, 11],
        36,
        &[1, 2, 4],
        (84, 140),
        false,
        &["lofi", "tape", "vinyl", "punchy", "gritty"],
        Shape::Loop,
    ),
    looped(
        "Top_Loop",
        &[3, 14],
        18,
        &[1, 2],
        (90, 130),
        false,
        &["airy", "bright", "lofi"],
        Shape::Loop,
    ),
    oneshot(
        "Bass",
        &[16],
        26,
        (400.0, 2200.0),
        true,
        &["dark", "warm", "analog", "gritty"],
        Shape::Hit,
    ),
    looped(
        "Bass_Loop",
        &[16],
        18,
        &[2, 4],
        (80, 128),
        true,
        &["dark", "warm", "analog"],
        Shape::Loop,
    ),
    looped(
        "Keys_Loop",
        &[5, 5],
        28,
        &[4, 8],
        (70, 96),
        true,
        &["lofi", "warm", "vinyl", "tape"],
        Shape::Swell,
    ),
    oneshot(
        "Pad",
        &[4, 4, 5],
        22,
        (3000.0, 9000.0),
        true,
        &["airy", "wide", "dark", "warm"],
        Shape::Swell,
    ),
    oneshot(
        "Texture",
        &[4, 4, 23],
        20,
        (4000.0, 14000.0),
        false,
        &["dark", "wide", "airy", "gritty"],
        Shape::Noise,
    ),
    oneshot(
        "Vox_Chop",
        &[18],
        24,
        (200.0, 1400.0),
        true,
        &["airy", "bright", "lofi", "wide"],
        Shape::Hit,
    ),
    oneshot("Riser", &[4], 10, (2000.0, 6000.0), false, &["bright", "wide"], Shape::Swell),
    oneshot(
        "Ambience",
        &[22, 23],
        16,
        (12000.0, 40000.0),
        false,
        &["wide", "dark", "airy"],
        Shape::Noise,
    ),
];

fn peaks_for(rng: &mut Rng, shape: Shape, beats: f64) -> Vec<f64> {
    let n = 256usize;
    let attack = rng.between(2.0, 8.0);
    let decay = rng.between(3.0, 14.0);
    let swell_at = rng.between(0.35, 0.7);
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        let fi = i as f64;
        let t = fi / n as f64;
        let env = match shape {
            Shape::Hit => {
                if fi < attack {
                    fi / attack
                } else {
                    (-(fi - attack) / (decay * 4.0)).exp()
                }
            }
            Shape::Loop => {
                let pos = (t * beats * 2.0) % 1.0; // croches
                let strong = ((t * beats * 2.0).floor() as i64) % 2 == 0;
                (-pos * 7.0).exp() * if strong { 1.0 } else { 0.55 } + 0.08
            }
            Shape::Swell => {
                if t < swell_at {
                    (t / swell_at).powf(1.6)
                } else {
                    1.0 - ((t - swell_at) / (1.0 - swell_at)).powf(2.0) * 0.85
                }
            }
            Shape::Noise => 0.45 + 0.25 * (t * 9.0 + beats).sin() + 0.15 * (t * 23.0).sin(),
        };
        out.push((env * (0.7 + 0.3 * rng.next_f64())).clamp(0.02, 1.0));
    }
    out
}

/// Clips MIDI : (nom, BPM, tonalité, mesures, type, tags) ; valeurs fixes, sans tirage.
#[allow(clippy::type_complexity)]
const MIDI_CLIPS: [(&str, Option<f64>, &str, u32, SampleKind, &[&str]); 7] = [
    ("Lofi_Chords_90_Am", Some(90.0), "Am", 4, SampleKind::Loop, &["lofi", "warm"]),
    ("Lofi_Chords_84_Dm", Some(84.0), "Dm", 4, SampleKind::Loop, &["lofi"]),
    ("Keys_Progression_100_C", Some(100.0), "C", 4, SampleKind::Loop, &["clean"]),
    ("Rhodes_Chords_76_F", Some(76.0), "F", 2, SampleKind::Loop, &["warm"]),
    ("Bass_Line_90_Am", Some(90.0), "Am", 2, SampleKind::Loop, &[]),
    ("Melody_Loop_120_Em", Some(120.0), "Em", 2, SampleKind::Loop, &["bright"]),
    ("Chord_Stab_Gm", None, "Gm", 1, SampleKind::Oneshot, &[]),
];

fn midi_peaks(beats: f64) -> Vec<f64> {
    (0..256)
        .map(|i| {
            let t = i as f64 / 256.0;
            let pos = (t * beats) % 1.0; // une attaque par temps
            ((-pos * 3.0).exp() * 0.7 + 0.15).clamp(0.02, 1.0)
        })
        .collect()
}

/// Les samples du prototype : 400 fichiers audio (ids 1..=400), puis 7 clips MIDI.
pub fn samples() -> Vec<Sample> {
    let mut out = audio_samples();
    let first = out.len() as u32 + 1;
    let mut paths = Vec::new();
    folder_paths(&sources(), None, &mut paths);
    let midi_dir = paths.iter().find(|(f, _)| *f == 6).map(|(_, p)| p.clone()).unwrap_or_default();
    for (i, &(name, bpm, key, bars, kind, tags)) in MIDI_CLIPS.iter().enumerate() {
        let beats = (bars * 4) as f64;
        out.push(Sample {
            id: first + i as u32,
            path: format!("{midi_dir}/{name}.mid"),
            name: name.into(),
            ext: "mid".into(),
            folder_id: 6,
            duration_ms: crate::query::js_round(beats * 60000.0 / bpm.unwrap_or(120.0)) as u32,
            sample_rate: 0,
            bit_depth: 0,
            channels: 0,
            bpm,
            key: Some(key.into()),
            kind,
            tags: tags.iter().map(|t| t.to_string()).collect(),
            missing: false,
            fav: false,
            hidden: false,
            peaks: midi_peaks(beats),
        });
        // Favoris : même règle que pour l'audio (id multiple de 11).
        let last = out.last_mut().unwrap();
        last.fav = last.id.is_multiple_of(11);
    }
    out
}

/// Les 400 samples audio, dans l'ordre de génération (ids 1..=400).
fn audio_samples() -> Vec<Sample> {
    let mut rng = Rng::new(SEED);
    let mut paths = Vec::new();
    folder_paths(&sources(), None, &mut paths);
    let path_of = |id: u32| paths.iter().find(|(f, _)| *f == id).map(|(_, p)| p.clone()).unwrap_or_default();

    let mut out = Vec::new();
    let mut id = 1;
    for cat in &CATEGORIES {
        for i in 1..=cat.count {
            let folder_id = *rng.pick(cat.folders);
            let adj = *rng.pick(&ADJ);
            let key = if cat.keyed { Some(rng.pick(&KEYS).to_string()) } else { None };
            let mut bpm = None;
            let mut beats = 4.0;
            let (duration_ms, name) = if cat.kind == SampleKind::Loop {
                let b = rng.int(cat.bpm.0, cat.bpm.1);
                bpm = Some(b as f64);
                let bars = *rng.pick(cat.bars);
                beats = (bars * 4) as f64;
                let dur = crate::query::js_round((beats * 60000.0) / b as f64);
                let name = match &key {
                    Some(k) => format!("{}_{adj}_{b}_{k}", cat.name),
                    None => format!("{}_{adj}_{b}", cat.name),
                };
                (dur, name)
            } else {
                let dur = crate::query::js_round(rng.between(cat.dur.0, cat.dur.1));
                let name = match &key {
                    Some(k) => format!("{}_{adj}_{k}_{i:02}", cat.name),
                    None => format!("{}_{adj}_{i:02}", cat.name),
                };
                (dur, name)
            };
            let tag_count = if rng.next_f64() < 0.14 {
                0
            } else {
                (rng.int(1, 3) as usize).min(cat.tags.len())
            };
            // Ensemble ordonné comme un Set JS (ordre d'insertion), trié à la fin.
            let mut tags: Vec<String> = Vec::new();
            while tags.len() < tag_count {
                let t = rng.pick(cat.tags).to_string();
                if !tags.contains(&t) {
                    tags.push(t);
                }
            }
            let adj_tag = adj.to_lowercase();
            if adj_tag != "deep" && TAGS.contains(&adj_tag.as_str()) && tag_count > 0 && !tags.contains(&adj_tag) {
                tags.push(adj_tag);
            }
            tags.sort();
            let ext = if rng.next_f64() < 0.85 { "wav" } else { "aif" };
            let sample_rate = if rng.next_f64() < 0.75 { 44100 } else { 48000 };
            let bit_depth = if rng.next_f64() < 0.6 { 24 } else { 16 };
            let channels = if cat.shape == Shape::Hit && rng.next_f64() < 0.6 { 1 } else { 2 };
            let peaks = peaks_for(&mut rng, cat.shape, beats);
            out.push(Sample {
                id,
                path: format!("{}/{name}.{ext}", path_of(folder_id)),
                name,
                ext: ext.into(),
                folder_id,
                duration_ms: duration_ms as u32,
                sample_rate,
                bit_depth,
                channels,
                bpm,
                key,
                kind: cat.kind,
                tags,
                missing: false,
                // Favoris : sous-ensemble fixe (sans tirage, pour ne pas décaler la graine).
                fav: id % 11 == 0,
                hidden: false,
                peaks,
            });
            id += 1;
        }
    }
    out
}

fn by_prefix(samples: &[Sample], p: &str, n: usize, step: usize) -> Vec<u32> {
    samples
        .iter()
        .filter(|s| s.name.starts_with(p))
        .enumerate()
        .filter(|(i, _)| i % step == 0)
        .take(n)
        .map(|(_, s)| s.id)
        .collect()
}

/// Collections de départ : regroupements à plat (2 manuelles, 2 smart).
pub fn collections() -> Vec<Collection> {
    let manual = |id: u32, name: &str, pinned: bool| Collection {
        id,
        name: name.into(),
        kind: CollectionKind::Manual,
        pinned,
        query: None,
    };
    let smart = |id: u32, name: &str, q: &str| Collection {
        id,
        name: name.into(),
        kind: CollectionKind::Smart,
        pinned: false,
        query: Some(q.into()),
    };
    vec![
        manual(1, "Go-to kicks", true),
        manual(2, "Vocal chops", false),
        smart(3, "Loops en Am", "type:loop key:Am"),
        smart(4, "Courts & sombres", "#dark dur:<1s"),
    ]
}

pub fn collection_items(samples: &[Sample]) -> Vec<(u32, Vec<u32>)> {
    vec![(1, by_prefix(samples, "Kick", 12, 3)), (2, by_prefix(samples, "Vox_Chop", 14, 1))]
}

/// Dossiers virtuels de départ : Projets › Night Drive ; Pack 2026 › Drums, Textures.
pub fn virtual_folders() -> Vec<VirtualFolder> {
    let vf = |id: u32, name: &str, parent_id: Option<u32>, pinned: bool| VirtualFolder {
        id,
        name: name.into(),
        parent_id,
        pinned,
    };
    vec![
        vf(1, "Projets", None, false),
        vf(2, "Night Drive", Some(1), false),
        vf(3, "Pack 2026", None, true),
        vf(4, "Drums", Some(3), false),
        vf(5, "Textures", Some(3), false),
    ]
}

pub fn virtual_items(samples: &[Sample]) -> Vec<(u32, Vec<u32>)> {
    let p = |prefix: &str, n: usize, step: usize| by_prefix(samples, prefix, n, step);
    vec![
        (
            2,
            [p("Keys_Loop", 6, 3), p("Pad", 4, 4), p("Bass_Loop", 3, 5), p("Drum_Loop", 5, 6)].concat(),
        ),
        (3, p("Riser", 3, 2)),
        (4, [p("Kick", 4, 5), p("Snare", 4, 5), p("Clap", 2, 4)].concat()),
        (5, [p("Texture", 10, 2), p("Ambience", 4, 3)].concat()),
    ]
}

/// Favoris épinglés dans l'onglet Bibliothèque au départ.
pub const FAVORITES_PINNED: bool = true;

/// Sous-dossiers sources épinglés comme raccourcis dans Bibliothèque (Splice › packs › Dusty Tapes Vol.2).
pub const PINNED_FOLDERS: &[u32] = &[3];
