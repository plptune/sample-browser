//! Fichiers MIDI : lecture du format SMF et petit synthé de préécoute.
//!
//! - `Midi::parse` : formats 0 et 1, statut courant, carte des tempos, pédale de sustain (CC 64) ;
//!   les notes en secondes, le tempo et la signature écrits dans le fichier, la longueur (fin de piste).
//! - `Synth` : un piano basique (partiels harmoniques légèrement inharmoniques, déclin plus rapide dans
//!   l'aigu et pour les harmoniques hautes, plus brillant quand on joue fort) ; le canal 10 (batterie General
//!   MIDI) joue des percussions synthétiques. Rendu par blocs, à la demande : le son part tout de suite.
//!
//! Rien de tout cela n'écrit quoi que ce soit : un `.mid` est lu comme un sample, et glissé tel quel vers le DAW.

use std::path::Path;

/// Extensions MIDI (en minuscules).
pub const EXTENSIONS: &[&str] = &["mid", "midi"];

pub fn is_midi(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
}

/// Une note jouée.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Note {
    /// Début et fin, en secondes.
    pub start: f64,
    pub end: f64,
    pub key: u8,
    /// 1..127.
    pub velocity: u8,
    /// 0..15 (9 = batterie).
    pub channel: u8,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Midi {
    /// Triées par début.
    pub notes: Vec<Note>,
    /// Longueur du morceau (fin de la piste la plus longue, au moins la fin de la dernière note).
    pub seconds: f64,
    /// Premier tempo écrit dans le fichier (`None` : aucun, le format suppose alors 120).
    pub bpm: Option<f64>,
    /// Signature (numérateur, dénominateur), 4/4 si absente.
    pub time_sig: (u8, u8),
}

/// Fichiers plus gros : ignorés (ce n'est plus un clip).
const MAX_BYTES: u64 = 16 << 20;
const MAX_NOTES: usize = 200_000;

struct Reader<'a> {
    b: &'a [u8],
    i: usize,
}

impl Reader<'_> {
    fn u8(&mut self) -> Option<u8> {
        let v = *self.b.get(self.i)?;
        self.i += 1;
        Some(v)
    }
    fn peek(&self) -> Option<u8> {
        self.b.get(self.i).copied()
    }
    fn take(&mut self, n: usize) -> Option<&[u8]> {
        let s = self.b.get(self.i..self.i.checked_add(n)?)?;
        self.i += n;
        Some(s)
    }
    fn vlq(&mut self) -> Option<u32> {
        let mut v = 0u32;
        for _ in 0..4 {
            let c = self.u8()?;
            v = (v << 7) | (c & 0x7f) as u32;
            if c & 0x80 == 0 {
                return Some(v);
            }
        }
        None
    }
}

fn be16(b: &[u8]) -> u16 {
    u16::from_be_bytes([b[0], b[1]])
}

fn be32(b: &[u8]) -> u32 {
    u32::from_be_bytes([b[0], b[1], b[2], b[3]])
}

/// Événement utile, en ticks absolus.
#[derive(Debug, Clone, Copy)]
enum Ev {
    On { ch: u8, key: u8, vel: u8 },
    Off { ch: u8, key: u8 },
    Pedal { ch: u8, down: bool },
    Tempo(u32),
    TimeSig(u8, u8),
}

impl Midi {
    pub fn open(path: &Path) -> Option<Midi> {
        if std::fs::metadata(path).ok()?.len() > MAX_BYTES {
            return None;
        }
        Midi::parse(&std::fs::read(path).ok()?)
    }

    pub fn parse(bytes: &[u8]) -> Option<Midi> {
        let mut r = Reader { b: bytes, i: 0 };
        if r.take(4)? != b"MThd" {
            return None;
        }
        let hlen = be32(r.take(4)?) as usize;
        let head = r.take(hlen)?;
        if head.len() < 6 {
            return None;
        }
        let (format, ntrks, division) = (be16(&head[0..2]), be16(&head[2..4]), be16(&head[4..6]));
        // Division : ticks par noire, ou (SMPTE) images par seconde × ticks par image.
        let smpte_tps = (division & 0x8000 != 0).then(|| {
            let fps = -((division >> 8) as i8) as f64;
            fps.max(1.0) * (division & 0xff).max(1) as f64
        });
        let tpq = (division & 0x7fff).max(1) as f64;

        let mut events: Vec<(u64, u32, Ev)> = Vec::new(); // (tick, ordre, événement)
        let mut order = 0u32;
        let mut end_tick = 0u64;
        // Format 2 (pistes indépendantes, rare) : la première seulement.
        let tracks = if format == 2 { 1 } else { ntrks };
        for _ in 0..tracks {
            // Saute les blocs inconnus jusqu'à la prochaine piste.
            let len = loop {
                let is_track = r.take(4)? == b"MTrk";
                let len = be32(r.take(4)?) as usize;
                if is_track {
                    break len;
                }
                r.take(len)?;
            };
            let data = r.take(len.min(bytes.len().saturating_sub(r.i)))?;
            let mut t = Reader { b: data, i: 0 };
            let (mut tick, mut status) = (0u64, 0u8);
            while t.i < data.len() {
                let Some(delta) = t.vlq() else { break };
                tick += delta as u64;
                let mut s = t.peek()?;
                if s & 0x80 != 0 {
                    t.i += 1;
                } else if status != 0 {
                    s = status; // statut courant
                } else {
                    break;
                }
                match s {
                    0xff => {
                        let kind = t.u8()?;
                        let len = t.vlq()? as usize;
                        let d = t.take(len)?;
                        match (kind, d.len()) {
                            (0x51, 3) => events.push((tick, order, Ev::Tempo(u32::from_be_bytes([0, d[0], d[1], d[2]])))),
                            (0x58, n) if n >= 2 => events.push((tick, order, Ev::TimeSig(d[0], 1u8.checked_shl(d[1] as u32).unwrap_or(4)))),
                            (0x2f, _) => break,
                            _ => {}
                        }
                    }
                    0xf0 | 0xf7 => {
                        let len = t.vlq()? as usize;
                        t.take(len)?;
                    }
                    0x80..=0xef => {
                        status = s;
                        let ch = s & 0x0f;
                        let a = t.u8()? & 0x7f;
                        let b = if matches!(s & 0xf0, 0xc0 | 0xd0) { 0 } else { t.u8()? & 0x7f };
                        let ev = match s & 0xf0 {
                            0x90 if b > 0 => Some(Ev::On { ch, key: a, vel: b }),
                            0x80 | 0x90 => Some(Ev::Off { ch, key: a }),
                            0xb0 if a == 64 => Some(Ev::Pedal { ch, down: b >= 64 }),
                            _ => None,
                        };
                        if let Some(ev) = ev {
                            events.push((tick, order, ev));
                        }
                    }
                    _ => break, // octet système inattendu : fin de la piste
                }
                order += 1;
            }
            end_tick = end_tick.max(tick);
        }
        // Les fins de note avant les débuts au même instant (une note répétée ne s'efface pas elle-même).
        events.sort_by_key(|&(tick, ord, ev)| (tick, !matches!(ev, Ev::Off { .. } | Ev::Pedal { down: false, .. }), ord));

        // Carte des tempos : ticks → secondes.
        let mut first_tempo: Option<u32> = None;
        let mut time_sig = (4u8, 4u8);
        let (mut last_tick, mut last_sec, mut us_per_q) = (0u64, 0f64, 500_000f64);
        let to_sec = |tick: u64, last_tick: u64, last_sec: f64, us_per_q: f64| match smpte_tps {
            Some(tps) => tick as f64 / tps,
            None => last_sec + (tick - last_tick) as f64 * us_per_q / 1e6 / tpq,
        };
        let mut open: std::collections::HashMap<(u8, u8), Vec<(f64, u8)>> = Default::default();
        let mut held_by_pedal: Vec<(u8, u8)> = Vec::new();
        let mut pedal = [false; 16];
        let mut notes: Vec<Note> = Vec::new();
        let close = |notes: &mut Vec<Note>, open: &mut std::collections::HashMap<(u8, u8), Vec<(f64, u8)>>, ch: u8, key: u8, at: f64| {
            if let Some(stack) = open.get_mut(&(ch, key)) {
                if !stack.is_empty() {
                    let (start, velocity) = stack.remove(0);
                    if notes.len() < MAX_NOTES {
                        notes.push(Note {
                            start,
                            end: at.max(start + 0.005),
                            key,
                            velocity,
                            channel: ch,
                        });
                    }
                }
            }
        };
        for &(tick, _, ev) in &events {
            let now = to_sec(tick, last_tick, last_sec, us_per_q);
            match ev {
                Ev::Tempo(us) if us > 0 => {
                    first_tempo.get_or_insert(us);
                    (last_tick, last_sec, us_per_q) = (tick, now, us as f64);
                }
                Ev::Tempo(_) => {}
                Ev::TimeSig(n, d) => {
                    if tick == 0 || time_sig == (4, 4) {
                        time_sig = (n.max(1), d.max(1));
                    }
                }
                Ev::On { ch, key, vel } => open.entry((ch, key)).or_default().push((now, vel)),
                Ev::Off { ch, key } => {
                    if pedal[ch as usize] && ch != 9 {
                        held_by_pedal.push((ch, key));
                    } else {
                        close(&mut notes, &mut open, ch, key, now);
                    }
                }
                Ev::Pedal { ch, down } => {
                    pedal[ch as usize] = down;
                    if !down {
                        for (c, k) in std::mem::take(&mut held_by_pedal)
                            .into_iter()
                            .filter(|(c, _)| *c == ch)
                            .collect::<Vec<_>>()
                        {
                            close(&mut notes, &mut open, c, k, now);
                        }
                        held_by_pedal.retain(|(c, _)| *c != ch);
                    }
                }
            }
        }
        let end = to_sec(end_tick.max(last_tick), last_tick, last_sec, us_per_q);
        // Notes jamais relâchées : jusqu'à la fin.
        for ((ch, key), stack) in open {
            for (start, velocity) in stack {
                if notes.len() < MAX_NOTES {
                    notes.push(Note {
                        start,
                        end: end.max(start + 0.25),
                        key,
                        velocity,
                        channel: ch,
                    });
                }
            }
        }
        notes.sort_by(|a, b| a.start.total_cmp(&b.start).then(a.key.cmp(&b.key)));
        let last_note = notes.iter().fold(0f64, |m, n| m.max(n.end));
        Some(Midi {
            seconds: end.max(last_note),
            bpm: first_tempo.map(|us| (60e6 / us as f64 * 100.0).round() / 100.0),
            time_sig,
            notes,
        })
    }

    /// Durée d'une mesure, en secondes (au premier tempo).
    pub fn bar_seconds(&self) -> f64 {
        let beat = 60.0 / self.bpm.unwrap_or(120.0);
        beat * 4.0 / self.time_sig.1 as f64 * self.time_sig.0 as f64
    }
}

// ---------- synthé ----------

/// Fréquence de rendu (convertie ensuite vers celle de la sortie, comme un fichier audio).
pub const RATE: u32 = 44_100;
/// Bloc rendu à chaque appel.
const BLOCK: usize = 1024;

/// Voix en cours : un oscillateur par partiel (rotation complexe : pas de `sin` par échantillon).
struct VoiceState {
    note: Note,
    /// (cos, sin, cos du pas, sin du pas, amplitude, déclin par échantillon) par partiel.
    partials: Vec<[f32; 6]>,
    /// Échantillons depuis le début de la note.
    age: u64,
    /// Percussion : bruit (graine) et durée.
    drum: Option<Drum>,
}

#[derive(Clone, Copy)]
struct Drum {
    seed: u32,
    tone_hz: f32,
    sweep: f32,
    noise: f32,
    decay: f32,
    hp: f32,
}

fn drum_for(key: u8) -> Drum {
    // General MIDI : 35-36 grosse caisse, 37-40 caisse claire / clap, 42-46 charleston, 49-57 cymbales.
    match key {
        35 | 36 => Drum {
            seed: 1,
            tone_hz: 50.0,
            sweep: 90.0,
            noise: 0.05,
            decay: 9.0,
            hp: 0.0,
        },
        37..=40 => Drum {
            seed: 2,
            tone_hz: 185.0,
            sweep: 40.0,
            noise: 0.7,
            decay: 18.0,
            hp: 0.0,
        },
        42 | 44 => Drum {
            seed: 3,
            tone_hz: 0.0,
            sweep: 0.0,
            noise: 0.5,
            decay: 55.0,
            hp: 1.0,
        },
        46 => Drum {
            seed: 4,
            tone_hz: 0.0,
            sweep: 0.0,
            noise: 0.5,
            decay: 12.0,
            hp: 1.0,
        },
        49..=59 => Drum {
            seed: 5,
            tone_hz: 0.0,
            sweep: 0.0,
            noise: 0.45,
            decay: 4.0,
            hp: 1.0,
        },
        41 | 43 | 45 | 47 | 48 => Drum {
            seed: 6,
            tone_hz: 60.0 + (key as f32 - 41.0) * 12.0,
            sweep: 40.0,
            noise: 0.1,
            decay: 10.0,
            hp: 0.0,
        },
        _ => Drum {
            seed: 7,
            tone_hz: 400.0 + key as f32 * 5.0,
            sweep: 0.0,
            noise: 0.3,
            decay: 25.0,
            hp: 0.5,
        },
    }
}

impl VoiceState {
    fn new(note: Note) -> VoiceState {
        let rate = RATE as f32;
        let vel = note.velocity as f32 / 127.0;
        if note.channel == 9 {
            return VoiceState {
                note,
                partials: Vec::new(),
                age: 0,
                drum: Some(drum_for(note.key)),
            };
        }
        let f0 = 440.0 * 2f32.powf((note.key as f32 - 69.0) / 12.0);
        let base_decay = 0.6 + f0 / 500.0; // par seconde : l'aigu s'éteint plus vite
        let amp = 0.22 * vel.powf(1.4);
        let partials = (1..=8)
            .filter_map(|h| {
                let h = h as f32;
                let f = f0 * h * (1.0 + 0.0004 * h * h).sqrt();
                if f >= rate * 0.45 {
                    return None;
                }
                let a = amp / h.powf(1.3) * vel.powf((h - 1.0) * 0.18);
                let d = (-(base_decay * (1.0 + 0.45 * (h - 1.0))) / rate).exp();
                let w = std::f32::consts::TAU * f / rate;
                Some([1.0, 0.0, w.cos(), w.sin(), a, d])
            })
            .collect();
        VoiceState {
            note,
            partials,
            age: 0,
            drum: None,
        }
    }

    /// Avance de `samples` sans rendre (lecture depuis le milieu d'une note) : phases et amplitudes calculées
    /// directement.
    fn advance(&mut self, samples: u64) {
        self.age += samples;
        let k = samples as f64;
        for p in self.partials.iter_mut() {
            let w = (p[3] as f64).atan2(p[2] as f64) * k;
            p[0] = w.cos() as f32;
            p[1] = w.sin() as f32;
            p[4] = (p[4] as f64 * (p[5] as f64).powf(k)) as f32;
        }
    }

    /// Ajoute `n` échantillons à `out` ; faux quand la voix s'est tue.
    fn render(&mut self, out: &mut [f32], from: usize) -> bool {
        let rate = RATE as f64;
        let off = ((self.note.end - self.note.start) * rate) as u64;
        if let Some(d) = self.drum.as_mut() {
            let vel = self.note.velocity as f32 / 127.0 * 0.5;
            let mut prev = 0f32;
            for o in out[from..].iter_mut() {
                let t = self.age as f32 / RATE as f32;
                let env = (-d.decay * t).exp();
                if env < 1e-4 {
                    return false;
                }
                d.seed ^= d.seed << 13;
                d.seed ^= d.seed >> 17;
                d.seed ^= d.seed << 5;
                let n = (d.seed as f32 / u32::MAX as f32) * 2.0 - 1.0;
                let noise = if d.hp > 0.0 { n - prev * d.hp } else { n };
                prev = n;
                let tone = if d.tone_hz > 0.0 {
                    let ph = std::f32::consts::TAU * (d.tone_hz * t + d.sweep / 30.0 * (1.0 - (-30.0 * t).exp()));
                    ph.sin() * (1.0 - d.noise)
                } else {
                    0.0
                };
                *o += (tone + noise * d.noise) * env * vel;
                self.age += 1;
            }
            return true;
        }
        let mut alive = false;
        for o in out[from..].iter_mut() {
            // Attaque 3 ms ; après la fin de la note, relâchement rapide (étouffoir).
            let attack = (self.age as f32 / (RATE as f32 * 0.003)).min(1.0);
            let release = if self.age > off {
                (-((self.age - off) as f32) / (RATE as f32 * 0.06)).exp()
            } else {
                1.0
            };
            let g = attack * release;
            let mut s = 0f32;
            for p in self.partials.iter_mut() {
                // Rotation : (c, s) ← (c, s) × (cos w, sin w) ; amplitude × déclin.
                let (c, sn) = (p[0] * p[2] - p[1] * p[3], p[0] * p[3] + p[1] * p[2]);
                p[0] = c;
                p[1] = sn;
                p[4] *= p[5];
                s += sn * p[4];
            }
            *o += s * g;
            self.age += 1;
            alive = g > 1e-4;
        }
        // Renormaliser les oscillateurs (la rotation dérive lentement).
        for p in self.partials.iter_mut() {
            let m = (p[0] * p[0] + p[1] * p[1]).sqrt().max(1e-9);
            p[0] /= m;
            p[1] /= m;
        }
        alive && self.partials.iter().any(|p| p[4] > 1e-5)
    }
}

/// Rendu progressif d'un fichier MIDI, à partir d'un instant donné. La durée rendue est exactement celle du
/// fichier (une boucle reste une boucle), avec un fondu de 10 ms à la fin.
pub struct Synth {
    notes: Vec<Note>,
    next: usize,
    voices: Vec<VoiceState>,
    /// Échantillon courant (depuis le début du fichier).
    pos: u64,
    end: u64,
}

impl Synth {
    pub fn new(midi: &Midi) -> Synth {
        Synth::from(midi, 0.0)
    }

    /// Commence à `start` secondes (les notes déjà commencées repartent là où elles en sont).
    pub fn from(midi: &Midi, start: f64) -> Synth {
        let rate = RATE as f64;
        let mut s = Synth {
            notes: midi.notes.clone(),
            next: 0,
            voices: Vec::new(),
            pos: (start.max(0.0) * rate) as u64,
            end: (midi.seconds * rate).ceil() as u64,
        };
        while s.next < s.notes.len() && ((s.notes[s.next].start * rate) as u64) < s.pos {
            let n = s.notes[s.next];
            if (n.end + 0.5) * rate > s.pos as f64 {
                let mut v = VoiceState::new(n);
                v.advance(s.pos - (n.start * rate) as u64);
                s.voices.push(v);
            }
            s.next += 1;
        }
        s
    }

    /// Le bloc suivant (mono, `RATE`), ajouté à `out` ; `false` à la fin.
    pub fn next_block(&mut self, out: &mut Vec<f32>) -> bool {
        if self.pos >= self.end {
            return false;
        }
        let rate = RATE as f64;
        let n = BLOCK.min((self.end - self.pos) as usize);
        let mut buf = vec![0f32; n];
        let block_end = self.pos + n as u64;
        // Les voix en cours, puis celles qui commencent dans ce bloc, à leur échantillon exact.
        self.voices.retain_mut(|v| v.render(&mut buf, 0));
        while self.next < self.notes.len() && ((self.notes[self.next].start * rate) as u64) < block_end {
            let note = self.notes[self.next];
            let at = ((note.start * rate) as u64).saturating_sub(self.pos) as usize;
            let mut v = VoiceState::new(note);
            if v.render(&mut buf, at.min(n)) {
                self.voices.push(v);
            }
            self.next += 1;
        }
        // Compression douce (beaucoup de notes ensemble ne saturent pas) et fondu de fin.
        let fade = (RATE as f64 * 0.01) as u64;
        out.extend(buf.iter().enumerate().map(|(i, x)| {
            let left = self.end - (self.pos + i as u64);
            let g = if left < fade { left as f32 / fade as f32 } else { 1.0 };
            (x * 1.2).tanh() * 0.85 * g
        }));
        self.pos = block_end;
        true
    }

    /// Tout le rendu d'un coup (pics de waveform), limité à `max_seconds`.
    pub fn render_all(midi: &Midi, max_seconds: f64) -> Vec<f32> {
        let mut s = Synth::new(midi);
        s.end = s.end.min((max_seconds * RATE as f64) as u64);
        let mut out = Vec::with_capacity(s.end as usize);
        while s.next_block(&mut out) {}
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Fichier SMF minimal : format 1, piste de tempo + piste de notes (avec statut courant et note-on à 0).
    pub(crate) fn smf(bpm: f64, notes: &[(u32, u32, u8)], tpq: u16, end_tick: u32) -> Vec<u8> {
        let mut b = Vec::new();
        b.extend_from_slice(b"MThd");
        b.extend_from_slice(&6u32.to_be_bytes());
        b.extend_from_slice(&1u16.to_be_bytes());
        b.extend_from_slice(&2u16.to_be_bytes());
        b.extend_from_slice(&tpq.to_be_bytes());
        let vlq = |mut v: u32| {
            let mut out = vec![(v & 0x7f) as u8];
            v >>= 7;
            while v > 0 {
                out.insert(0, (v & 0x7f) as u8 | 0x80);
                v >>= 7;
            }
            out
        };
        let track = |body: Vec<u8>, b: &mut Vec<u8>| {
            b.extend_from_slice(b"MTrk");
            b.extend_from_slice(&(body.len() as u32).to_be_bytes());
            b.extend_from_slice(&body);
        };
        let us = (60e6 / bpm) as u32;
        let mut t0 = vec![0, 0xff, 0x51, 3];
        t0.extend_from_slice(&us.to_be_bytes()[1..]);
        t0.extend_from_slice(&[0, 0xff, 0x58, 4, 4, 2, 24, 8]);
        t0.extend_from_slice(&[0, 0xff, 0x2f, 0]);
        track(t0, &mut b);
        // (début, fin, note) en ticks → événements triés.
        let mut ev: Vec<(u32, bool, u8)> = notes.iter().flat_map(|&(s, e, k)| [(s, true, k), (e, false, k)]).collect();
        ev.sort_by_key(|&(t, on, _)| (t, on));
        let (mut body, mut last, mut first) = (Vec::new(), 0u32, true);
        for (t, on, k) in ev {
            body.extend(vlq(t - last));
            if first {
                body.push(0x90);
                first = false;
            }
            body.extend_from_slice(&[k, if on { 100 } else { 0 }]);
            last = t;
        }
        body.extend(vlq(end_tick.saturating_sub(last)));
        body.extend_from_slice(&[0xff, 0x2f, 0]);
        track(body, &mut b);
        b
    }

    #[test]
    fn lecture_d_un_fichier_smf() {
        // 120 BPM, 480 ticks par noire : do-mi-sol en noires, puis un accord d'une blanche ; 2 mesures.
        let bytes = smf(
            120.0,
            &[
                (0, 480, 60),
                (480, 960, 64),
                (960, 1440, 67),
                (1920, 2880, 60),
                (1920, 2880, 64),
                (1920, 2880, 67),
            ],
            480,
            3840,
        );
        let m = Midi::parse(&bytes).unwrap();
        assert_eq!(m.bpm, Some(120.0));
        assert_eq!(m.time_sig, (4, 4));
        assert!((m.seconds - 4.0).abs() < 1e-9, "{}", m.seconds);
        assert_eq!(m.notes.len(), 6);
        assert!((m.notes[1].start - 0.5).abs() < 1e-9 && (m.notes[1].end - 1.0).abs() < 1e-9);
        assert!((m.bar_seconds() - 2.0).abs() < 1e-9);
        assert!(Midi::parse(b"RIFF....").is_none());
        assert!(Midi::parse(&bytes[..20]).is_some_and(|m| m.notes.is_empty()) || Midi::parse(&bytes[..20]).is_none());
    }

    #[test]
    fn rendu_progressif_et_depuis_un_point() {
        let bytes = smf(120.0, &[(0, 960, 57), (0, 960, 60), (0, 960, 64)], 480, 1920);
        let m = Midi::parse(&bytes).unwrap();
        let all = Synth::render_all(&m, 60.0);
        assert_eq!(all.len(), (2.0 * RATE as f64).ceil() as usize, "durée exacte du fichier");
        let peak = all.iter().fold(0f32, |a, x| a.max(x.abs()));
        assert!(peak > 0.1 && peak <= 1.0, "son audible, sans saturer : {peak}");
        assert!(all[all.len() - 1].abs() < 1e-3, "fondu de fin");
        // Depuis 0,5 s : même signal (à l'arrondi près) que le rendu complet à partir de 0,5 s.
        let mut s = Synth::from(&m, 0.5);
        let mut part = Vec::new();
        s.next_block(&mut part);
        let off = (0.5 * RATE as f64) as usize;
        let diff = part.iter().zip(&all[off..]).map(|(a, b)| (a - b).abs()).fold(0f32, f32::max);
        assert!(diff < 1e-3, "écart {diff}");
    }
}
