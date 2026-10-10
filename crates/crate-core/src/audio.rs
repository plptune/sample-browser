//! Lecture des samples et pics de waveform.
//!
//! - `Decoder` : décodage progressif (symphonia), en f32 entrelacé ; un fichier MIDI passe par le synthé
//!   (`midi.rs`) et se lit comme un fichier audio.
//! - `compute_peaks` : 256 pics 0..255 (maximum absolu par tranche, normalisé sur le maximum du fichier).
//! - `Player` : une sortie audio ouverte une fois pour toutes (cpal), un fichier lu à la fois, décodé
//!   progressivement sur son propre thread et converti à la fréquence et aux canaux de la sortie ; volume,
//!   boucle, déplacement ; position envoyée ~30 fois par seconde. Sans périphérique audio (CI, conteneur),
//!   la lecture avance en silence au même rythme.

use std::fs::File;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use symphonia::core::codecs::audio::{AudioDecoder, AudioDecoderOptions};
use symphonia::core::codecs::CodecParameters;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, FormatReader, TrackType};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;

use crate::model::{PlaybackStatus, SampleId};

// ---------- décodage ----------

pub struct Decoder {
    inner: Inner,
    /// Fréquence d'échantillonnage du fichier (du synthé pour un MIDI).
    pub rate: u32,
}

enum Inner {
    Audio {
        reader: Box<dyn FormatReader>,
        decoder: Box<dyn AudioDecoder>,
        track: u32,
    },
    /// Fichier MIDI : rendu au piano par le synthé, comme un fichier audio mono.
    Midi(Box<crate::midi::Synth>),
}

impl Decoder {
    pub fn open(path: &Path) -> Option<Decoder> {
        if crate::midi::is_midi(path) {
            let m = crate::midi::Midi::open(path)?;
            return Some(Decoder {
                inner: Inner::Midi(Box::new(crate::midi::Synth::new(&m))),
                rate: crate::midi::RATE,
            });
        }
        let file = File::open(path).ok()?;
        let mss = MediaSourceStream::new(Box::new(file), Default::default());
        let mut hint = Hint::new();
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            hint.with_extension(ext);
        }
        let reader = symphonia::default::get_probe()
            .probe(&hint, mss, FormatOptions::default(), MetadataOptions::default())
            .ok()?;
        let track = reader.default_track(TrackType::Audio)?;
        let Some(CodecParameters::Audio(params)) = &track.codec_params else {
            return None;
        };
        let decoder = symphonia::default::get_codecs()
            .make_audio_decoder(params, &AudioDecoderOptions::default())
            .ok()?;
        let (id, rate) = (track.id, params.sample_rate.unwrap_or(44_100));
        Some(Decoder {
            inner: Inner::Audio {
                reader,
                decoder,
                track: id,
            },
            rate,
        })
    }

    /// Ajoute le prochain bloc décodé à `out` (entrelacé) et renvoie son nombre de canaux ; `None` à la fin.
    pub fn next_chunk(&mut self, out: &mut Vec<f32>) -> Option<usize> {
        let (reader, decoder, track) = match &mut self.inner {
            Inner::Midi(synth) => return synth.next_block(out).then_some(1),
            Inner::Audio { reader, decoder, track } => (reader, decoder, *track),
        };
        let mut tmp: Vec<f32> = Vec::new();
        loop {
            let packet = reader.next_packet().ok()??;
            if packet.track_id != track {
                continue;
            }
            match decoder.decode(&packet) {
                Ok(buf) => {
                    let ch = buf.spec().channels().count().max(1);
                    buf.copy_to_vec_interleaved(&mut tmp);
                    out.extend_from_slice(&tmp);
                    return Some(ch);
                }
                // Paquet abîmé : on passe au suivant.
                Err(symphonia::core::errors::Error::DecodeError(_)) => continue,
                Err(_) => return None,
            }
        }
    }
}

// ---------- pics ----------

pub const PEAKS: usize = 256;

/// 256 pics 0..255, normalisés sur le maximum du fichier (un sample discret reste lisible).
pub fn compute_peaks(path: &Path) -> Option<Vec<u8>> {
    const BLOCK: usize = 512;
    let mut d = Decoder::open(path)?;
    // Maximum absolu par bloc de 512 trames : reste petit même pour un long fichier.
    let mut blocks: Vec<f32> = Vec::new();
    let (mut cur, mut in_block) = (0f32, 0usize);
    let mut tmp = Vec::new();
    while let Some(ch) = d.next_chunk(&mut tmp) {
        for frame in tmp.chunks(ch) {
            cur = frame.iter().fold(cur, |m, x| m.max(x.abs()));
            in_block += 1;
            if in_block == BLOCK {
                blocks.push(cur);
                (cur, in_block) = (0.0, 0);
            }
        }
        tmp.clear();
    }
    if in_block > 0 {
        blocks.push(cur);
    }
    Some(bucket_peaks(&blocks))
}

fn bucket_peaks(blocks: &[f32]) -> Vec<u8> {
    let n = blocks.len();
    if n == 0 {
        return vec![0; PEAKS];
    }
    let raw: Vec<f32> = (0..PEAKS)
        .map(|b| {
            let lo = b * n / PEAKS;
            let hi = ((b + 1) * n / PEAKS).max(lo + 1).min(n);
            blocks[lo.min(n - 1)..hi].iter().fold(0f32, |m, &x| m.max(x))
        })
        .collect();
    let max = raw.iter().fold(0f32, |m, &x| m.max(x));
    raw.iter()
        .map(|&x| if max > 0.0 { (x / max * 255.0).round() as u8 } else { 0 })
        .collect()
}

/// Colonnes au plus pour une forme d'onde détaillée (un écran 5K en largeur, densité 2).
pub const WAVEFORM_MAX_BUCKETS: usize = 4096;

/// Forme d'onde détaillée de tout le fichier, en `buckets` colonnes (min, max, RMS ; canaux mélangés).
/// Le décodage passe par des blocs de 64 trames : la mémoire reste petite même pour un long fichier.
pub fn waveform(path: &Path, buckets: usize) -> Option<crate::Waveform> {
    const BLOCK: usize = 64;
    let buckets = buckets.clamp(1, WAVEFORM_MAX_BUCKETS);
    let mut d = Decoder::open(path)?;
    // (min, max, somme des carrés, trames) par bloc.
    let mut blocks: Vec<(f32, f32, f32, u32)> = Vec::new();
    let mut cur = (f32::MAX, f32::MIN, 0f32, 0u32);
    let mut tmp = Vec::new();
    while let Some(ch) = d.next_chunk(&mut tmp) {
        for frame in tmp.chunks(ch) {
            let x = frame.iter().sum::<f32>() / ch as f32;
            cur = (cur.0.min(x), cur.1.max(x), cur.2 + x * x, cur.3 + 1);
            if cur.3 as usize == BLOCK {
                blocks.push(cur);
                cur = (f32::MAX, f32::MIN, 0.0, 0);
            }
        }
        tmp.clear();
    }
    if cur.3 > 0 {
        blocks.push(cur);
    }
    Some(bucket_waveform(&blocks, buckets))
}

fn bucket_waveform(blocks: &[(f32, f32, f32, u32)], buckets: usize) -> crate::Waveform {
    let n = blocks.len();
    let mut w = crate::Waveform::default();
    if n == 0 {
        return w;
    }
    for b in 0..buckets {
        // Moins de blocs que de colonnes : une colonne reprend le bloc qui la couvre.
        let lo = (b * n / buckets).min(n - 1);
        let hi = ((b + 1) * n / buckets).max(lo + 1).min(n);
        let (mut mn, mut mx, mut sq, mut k) = (f32::MAX, f32::MIN, 0f32, 0u32);
        for &(a, z, s, c) in &blocks[lo..hi] {
            (mn, mx, sq, k) = (mn.min(a), mx.max(z), sq + s, k + c);
        }
        w.min.push(mn);
        w.max.push(mx);
        w.rms.push((sq / k.max(1) as f32).sqrt());
    }
    let peak = w.min.iter().chain(&w.max).fold(0f32, |m, x| m.max(x.abs()));
    if peak > 0.0 {
        for x in w.min.iter_mut().chain(w.max.iter_mut()).chain(w.rms.iter_mut()) {
            *x /= peak;
        }
    }
    w
}

/// Pics stockés (octets) → valeurs 0..1 du contrat.
pub fn peaks_to_f64(p: &[u8]) -> Vec<f64> {
    p.iter().map(|&x| x as f64 / 255.0).collect()
}

// ---------- conversion vers la sortie ----------

/// Rééchantillonnage linéaire progressif et répartition des canaux (mono → deux côtés).
struct Resampler {
    step: f64,
    /// Position de lecture, en trames source, depuis le début du fichier.
    t: f64,
    /// Trames source déjà reçues avant le bloc courant.
    base: usize,
    in_ch: usize,
    out_ch: usize,
    prev: Vec<f32>,
}

impl Resampler {
    fn new(in_rate: u32, out_rate: u32, in_ch: usize, out_ch: usize) -> Self {
        Resampler {
            step: in_rate as f64 / out_rate as f64,
            t: 0.0,
            base: 0,
            in_ch,
            out_ch,
            prev: vec![0.0; in_ch],
        }
    }

    fn process(&mut self, input: &[f32], out: &mut Vec<f32>) {
        let n = input.len() / self.in_ch;
        if n == 0 {
            return;
        }
        let (in_ch, out_ch) = (self.in_ch, self.out_ch);
        let get = |prev: &[f32], i: isize, c: usize| if i < 0 { prev[c] } else { input[i as usize * in_ch + c] };
        if (self.step - 1.0).abs() < 1e-9 {
            for f in input.chunks(in_ch) {
                out.extend((0..out_ch).map(|c| f[c % in_ch]));
            }
        } else {
            loop {
                let i = self.t.floor();
                let frac = (self.t - i) as f32;
                let i0 = i as isize - self.base as isize;
                if i0 + 1 >= n as isize {
                    break;
                }
                for c in 0..out_ch {
                    let sc = c % in_ch;
                    let (a, b) = (get(&self.prev, i0, sc), get(&self.prev, i0 + 1, sc));
                    out.push(a + (b - a) * frac);
                }
                self.t += self.step;
            }
        }
        self.prev.copy_from_slice(&input[(n - 1) * in_ch..n * in_ch]);
        self.base += n;
        if (self.step - 1.0).abs() < 1e-9 {
            self.t = self.base as f64;
        }
    }
}

// ---------- mixage ----------

struct Voice {
    id: SampleId,
    gen: u64,
    /// Trames à la fréquence et aux canaux de la sortie.
    buf: Vec<f32>,
    complete: bool,
    failed: bool,
    pos: usize,
    duration_ms: u32,
    requested: Instant,
    first_out: Option<Instant>,
    latency_sent: bool,
    ended: bool,
    /// Gain du fondu (0..1) : chaque départ, arrêt ou déplacement passe par un fondu court, sans clic.
    gain: f32,
    /// Variation du gain par trame ; 0 = gain stable.
    step: f32,
    /// Durée d'un fondu, en trames de sortie.
    fade: usize,
    /// Déplacement en attente : appliqué quand le fondu de sortie touche zéro, puis fondu d'entrée.
    pending_seek: Option<usize>,
    /// Arrêt demandé : la voix finit quand le fondu de sortie touche zéro.
    stopping: bool,
}

/// Durée des fondus : assez courte pour ne pas s'entendre, assez longue pour effacer le saut d'onde.
const FADE_MS: u64 = 4;

impl Voice {
    fn new(id: SampleId, gen: u64, buf: Vec<f32>, complete: bool, pos: usize, duration_ms: u32, rate: u32) -> Voice {
        let fade = ((rate as u64 * FADE_MS / 1000) as usize).max(1);
        Voice {
            id,
            gen,
            buf,
            complete,
            failed: false,
            pos,
            duration_ms,
            requested: Instant::now(),
            first_out: None,
            latency_sent: false,
            ended: false,
            gain: 0.0,
            step: 1.0 / fade as f32,
            fade,
            pending_seek: None,
            stopping: false,
        }
    }

    /// Lance un fondu de sortie (gain → 0).
    fn fade_out(&mut self) {
        self.step = -1.0 / self.fade as f32;
    }
}

#[derive(Default)]
struct Mix {
    voice: Option<Voice>,
    /// Voix remplacée par un nouveau départ : elle s'éteint en fondu pendant que la nouvelle monte.
    fading: Option<Voice>,
    volume: f32,
    looping: bool,
    gen: u64,
    /// Dernier sample lu, pour annoncer son arrêt.
    last: Option<(SampleId, u32)>,
}

/// Remplit `out` (entrelacé, `ch` canaux) depuis la voix courante et celle qui s'éteint. Pur : testable sans
/// périphérique.
fn render(mix: &mut Mix, out: &mut [f32], ch: usize) {
    out.fill(0.0);
    let (volume, looping) = (mix.volume, mix.looping);
    if let Some(v) = mix.voice.as_mut() {
        render_voice(v, out, ch, volume, looping);
    }
    if let Some(v) = mix.fading.as_mut() {
        render_voice(v, out, ch, volume, false);
        if v.ended {
            mix.fading = None;
        }
    }
}

/// Ajoute une voix dans `out`, avec son fondu. La boucle (fin → début) n'est pas fondue : elle doit rester juste.
fn render_voice(v: &mut Voice, out: &mut [f32], ch: usize, volume: f32, looping: bool) {
    if v.ended {
        return;
    }
    let frames = out.len() / ch;
    let mut written = 0;
    while written < frames {
        let have = v.buf.len() / ch;
        if v.pos >= have {
            if v.complete || v.failed {
                if looping && have > 0 && !v.failed && !v.stopping {
                    v.pos = 0;
                    continue;
                }
                v.ended = true;
            }
            break; // sinon : décodage en retard, silence pour ce bloc
        }
        let src = &v.buf[v.pos * ch..(v.pos + 1) * ch];
        for (o, s) in out[written * ch..(written + 1) * ch].iter_mut().zip(src) {
            *o += s * volume * v.gain;
        }
        if v.first_out.is_none() {
            v.first_out = Some(Instant::now());
        }
        v.pos += 1;
        written += 1;
        if v.step != 0.0 {
            v.gain += v.step;
            if v.gain >= 1.0 {
                (v.gain, v.step) = (1.0, 0.0);
            } else if v.gain <= 0.0 {
                (v.gain, v.step) = (0.0, 0.0);
                if let Some(p) = v.pending_seek.take() {
                    // Fondu de sortie fini : on saute, puis on remonte.
                    v.pos = p;
                    v.step = 1.0 / v.fade as f32;
                } else if v.stopping {
                    v.ended = true;
                    break;
                }
            }
        }
    }
}

pub type PlaybackSink = Arc<dyn Fn(PlaybackStatus) + Send + Sync>;

struct Shared {
    mix: Mutex<Mix>,
    rate: Mutex<u32>,
    channels: Mutex<usize>,
}

impl Shared {
    fn mix(&self) -> MutexGuard<'_, Mix> {
        self.mix.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// Lecteur : sortie ouverte au démarrage et gardée (le son part sans délai d'ouverture du périphérique).
pub struct Player {
    shared: Arc<Shared>,
    _keep: Sender<()>,
    /// Vrai si la lecture est muette faute de périphérique audio.
    pub silent: bool,
}

const TICK: Duration = Duration::from_millis(33);

impl Player {
    pub fn start(sink: PlaybackSink) -> Player {
        Self::start_with(sink, false)
    }

    /// `force_silent` : sans périphérique (tests).
    pub fn start_with(sink: PlaybackSink, force_silent: bool) -> Player {
        let shared = Arc::new(Shared {
            mix: Mutex::new(Mix {
                volume: 1.0,
                ..Default::default()
            }),
            rate: Mutex::new(44_100),
            channels: Mutex::new(2),
        });
        let (keep, alive) = channel::<()>();
        let (ready_tx, ready_rx) = channel::<bool>();
        let sh = shared.clone();
        std::thread::Builder::new()
            .name("crate-audio".into())
            .spawn(move || {
                // Le flux cpal doit rester sur le thread qui l'a créé.
                let stream = if force_silent { None } else { open_output(&sh) };
                let _ = ready_tx.send(stream.is_none());
                let mut silent_clock = Instant::now();
                let mut scratch = Vec::new();
                // Jusqu'à l'abandon du Player : un tour toutes les 33 ms.
                while let Err(RecvTimeoutError::Timeout) = alive.recv_timeout(TICK) {
                    if stream.is_none() {
                        // Pas de sortie : on « joue » en silence au rythme réel.
                        let rate = *sh.rate.lock().unwrap_or_else(|e| e.into_inner());
                        let ch = *sh.channels.lock().unwrap_or_else(|e| e.into_inner());
                        let frames = (silent_clock.elapsed().as_secs_f64() * rate as f64) as usize;
                        silent_clock = Instant::now();
                        scratch.resize(frames * ch, 0.0);
                        render(&mut sh.mix(), &mut scratch, ch);
                    }
                    if let Some(s) = status(&sh) {
                        sink(s);
                    }
                }
                drop(stream);
            })
            .expect("thread audio");
        let silent = ready_rx.recv().unwrap_or(true);
        Player {
            shared,
            _keep: keep,
            silent,
        }
    }

    /// Lit `path` à partir de `start_ms`. `duration_ms` : durée connue (index), pour la position annoncée.
    pub fn play(&self, id: SampleId, path: PathBuf, start_ms: u32, duration_ms: u32) {
        let rate = *self.shared.rate.lock().unwrap_or_else(|e| e.into_inner());
        let ch = *self.shared.channels.lock().unwrap_or_else(|e| e.into_inner());
        let gen = {
            let mut m = self.shared.mix();
            m.gen += 1;
            let pos = (start_ms as u64 * rate as u64 / 1000) as usize;
            let v = Voice::new(id, m.gen, Vec::new(), false, pos, duration_ms, rate);
            replace_voice(&mut m, v);
            m.last = Some((id, duration_ms));
            m.gen
        };
        let shared = self.shared.clone();
        std::thread::Builder::new()
            .name("crate-decode".into())
            .spawn(move || decode_into(&shared, gen, &path, rate, ch))
            .expect("thread de décodage");
    }

    /// Mode démo : un silence de la durée du sample (les fichiers du prototype n'existent pas).
    pub fn play_virtual(&self, id: SampleId, start_ms: u32, duration_ms: u32) {
        let rate = *self.shared.rate.lock().unwrap_or_else(|e| e.into_inner());
        let ch = *self.shared.channels.lock().unwrap_or_else(|e| e.into_inner());
        let mut m = self.shared.mix();
        m.gen += 1;
        let buf = vec![0.0; (duration_ms as u64 * rate as u64 / 1000) as usize * ch];
        let pos = (start_ms as u64 * rate as u64 / 1000) as usize;
        let v = Voice::new(id, m.gen, buf, true, pos, duration_ms, rate);
        replace_voice(&mut m, v);
        m.last = Some((id, duration_ms));
    }

    /// Arrêt en fondu de sortie (quelques millisecondes).
    pub fn stop(&self) {
        let mut m = self.shared.mix();
        m.gen += 1;
        if let Some(v) = m.voice.as_mut() {
            v.stopping = true;
            v.pending_seek = None;
            v.fade_out();
        }
    }

    /// Se place à `ms` dans le sample en cours (sans effet à l'arrêt) : fondu de sortie, saut, fondu d'entrée.
    pub fn seek(&self, ms: u32) {
        let rate = *self.shared.rate.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(v) = self.shared.mix().voice.as_mut() {
            if !v.ended && !v.stopping {
                v.pending_seek = Some((ms as u64 * rate as u64 / 1000) as usize);
                v.fade_out();
            }
        }
    }

    pub fn set_volume(&self, volume: f32) {
        self.shared.mix().volume = volume.clamp(0.0, 1.0);
    }

    pub fn set_loop(&self, looping: bool) {
        self.shared.mix().looping = looping;
    }
}

/// Nouvelle voix : celle qui jouait s'éteint en fondu (fondu croisé), une seule à la fois.
fn replace_voice(m: &mut Mix, mut v: Voice) {
    if let Some(mut old) = m.voice.take().filter(|o| !o.ended) {
        old.pending_seek = None;
        old.stopping = true;
        old.fade_out();
        m.fading = Some(old);
    }
    v.gain = 0.0;
    m.voice = Some(v);
}

/// Position du sample en cours ; un dernier statut `playing: false` quand il s'arrête.
fn status(sh: &Shared) -> Option<PlaybackStatus> {
    let rate = *sh.rate.lock().unwrap_or_else(|e| e.into_inner()) as u64;
    let ch = *sh.channels.lock().unwrap_or_else(|e| e.into_inner());
    let mut m = sh.mix();
    let looping = m.looping;
    let v = m.voice.as_mut()?;
    let latency_ms = match (v.first_out, v.latency_sent) {
        (Some(t), false) => {
            v.latency_sent = true;
            Some((t - v.requested).as_secs_f64() as f32 * 1000.0)
        }
        _ => None,
    };
    let decoded_ms = (v.buf.len() / ch) as u64 * 1000 / rate;
    let duration_ms = if v.complete { decoded_ms as u32 } else { v.duration_ms };
    let s = PlaybackStatus {
        id: v.id,
        position_ms: ((v.pending_seek.unwrap_or(v.pos) as u64 * 1000 / rate) as u32).min(duration_ms.max(1)),
        duration_ms,
        playing: !v.ended,
        looping,
        latency_ms,
        error: v.failed && v.buf.is_empty(),
    };
    if v.ended {
        m.voice = None;
    }
    Some(s)
}

fn decode_into(shared: &Shared, gen: u64, path: &Path, rate: u32, ch: usize) {
    let fail = || {
        if let Some(v) = shared.mix().voice.as_mut().filter(|v| v.gen == gen) {
            v.failed = true;
        }
    };
    let Some(mut d) = Decoder::open(path) else {
        return fail();
    };
    let mut rs: Option<Resampler> = None;
    let (mut raw, mut out) = (Vec::new(), Vec::new());
    while let Some(src_ch) = d.next_chunk(&mut raw) {
        let r = rs.get_or_insert_with(|| Resampler::new(d.rate, rate, src_ch, ch));
        if r.in_ch != src_ch {
            break; // changement de format en cours de fichier : on s'arrête là
        }
        r.process(&raw, &mut out);
        raw.clear();
        let mut m = shared.mix();
        if m.gen != gen {
            return; // un autre sample a pris la place
        }
        if let Some(v) = m.voice.as_mut() {
            v.buf.extend_from_slice(&out);
        }
        out.clear();
    }
    if let Some(v) = shared.mix().voice.as_mut().filter(|v| v.gen == gen) {
        v.complete = true;
    }
}

/// Ouvre la sortie par défaut ; `None` sans périphérique.
fn open_output(sh: &Arc<Shared>) -> Option<cpal::Stream> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    let device = cpal::default_host().default_output_device()?;
    let supported = device.default_output_config().ok()?;
    let config = supported.config();
    *sh.rate.lock().ok()? = config.sample_rate;
    *sh.channels.lock().ok()? = config.channels as usize;
    let ch = config.channels as usize;
    fn build<T: cpal::SizedSample + cpal::FromSample<f32>>(
        device: &cpal::Device,
        config: cpal::StreamConfig,
        sh: Arc<Shared>,
        ch: usize,
    ) -> Option<cpal::Stream> {
        let mut scratch: Vec<f32> = Vec::new();
        device
            .build_output_stream::<T, _, _>(
                config,
                move |out: &mut [T], _| {
                    scratch.resize(out.len(), 0.0);
                    render(&mut sh.mix(), &mut scratch, ch);
                    for (o, s) in out.iter_mut().zip(&scratch) {
                        *o = T::from_sample(*s);
                    }
                },
                |e| eprintln!("[crate] sortie audio : {e}"),
                None,
            )
            .ok()
    }
    let stream = match supported.sample_format() {
        cpal::SampleFormat::F32 => build::<f32>(&device, config, sh.clone(), ch),
        cpal::SampleFormat::I16 => build::<i16>(&device, config, sh.clone(), ch),
        cpal::SampleFormat::U16 => build::<u16>(&device, config, sh.clone(), ch),
        cpal::SampleFormat::I32 => build::<i32>(&device, config, sh.clone(), ch),
        _ => None,
    }?;
    stream.play().ok()?;
    Some(stream)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Voix sans fondu d'entrée (gain plein), pour tester le rendu brut.
    fn voice(buf: Vec<f32>) -> Voice {
        let mut v = Voice::new(1, 1, buf, true, 0, 0, 44_100);
        (v.gain, v.step) = (1.0, 0.0);
        v
    }

    /// Sinusoïde stéréo de `n` trames à 440 Hz / 44,1 kHz.
    fn sine(n: usize) -> Vec<f32> {
        (0..n)
            .flat_map(|i| {
                let x = (i as f32 * 440.0 * std::f32::consts::TAU / 44_100.0).sin() * 0.9;
                [x, x]
            })
            .collect()
    }

    /// Plus grand écart entre deux trames consécutives (un clic = un saut d'onde).
    fn max_jump(out: &[f32]) -> f32 {
        out.chunks(2)
            .collect::<Vec<_>>()
            .windows(2)
            .map(|w| (w[1][0] - w[0][0]).abs())
            .fold(0.0, f32::max)
    }

    #[test]
    fn fondus_sans_clic() {
        // Une sinusoïde à 440 Hz varie d'au plus ~0,06 par trame : tout saut au-delà serait un clic.
        let smooth = 0.07;
        let mut m = Mix {
            volume: 1.0,
            ..Default::default()
        };
        let mut out = vec![0.0; 2 * 2048];
        // Départ au milieu d'une crête : fondu d'entrée.
        replace_voice(&mut m, Voice::new(1, 1, sine(44_100), true, 1000, 1000, 44_100));
        render(&mut m, &mut out, 2);
        assert!(out[0].abs() < 0.01, "départ à zéro : {}", out[0]);
        assert!(max_jump(&out) < smooth, "départ : saut {}", max_jump(&out));
        // Déplacement : fondu de sortie, saut, fondu d'entrée.
        let last = out[out.len() - 2];
        m.voice.as_mut().unwrap().pending_seek = Some(30_000);
        m.voice.as_mut().unwrap().fade_out();
        render(&mut m, &mut out, 2);
        assert!(
            (out[0] - last).abs() < smooth && max_jump(&out) < smooth,
            "déplacement : saut {}",
            max_jump(&out)
        );
        // Nouveau départ pendant la lecture : fondu croisé (l'ancienne voix s'éteint).
        let last = out[out.len() - 2];
        replace_voice(&mut m, Voice::new(2, 2, sine(44_100), true, 7_000, 1000, 44_100));
        assert!(m.fading.is_some());
        render(&mut m, &mut out, 2);
        assert!(
            (out[0] - last).abs() < smooth && max_jump(&out) < smooth,
            "remplacement : saut {}",
            max_jump(&out)
        );
        assert!(m.fading.is_none(), "ancienne voix libérée après son fondu");
        // Arrêt : fondu de sortie, puis fin.
        let last = out[out.len() - 2];
        m.voice.as_mut().unwrap().stopping = true;
        m.voice.as_mut().unwrap().fade_out();
        render(&mut m, &mut out, 2);
        assert!(
            (out[0] - last).abs() < smooth && max_jump(&out) < smooth,
            "arrêt : saut {}",
            max_jump(&out)
        );
        assert!(m.voice.as_ref().unwrap().ended);
        assert!(out[out.len() - 2].abs() < 1e-6, "silence après l'arrêt");
    }

    #[test]
    fn rendu_volume_boucle_fin() {
        let mut m = Mix {
            volume: 0.5,
            voice: Some(voice(vec![1.0, 1.0, 0.5, 0.5])), // 2 trames stéréo
            ..Default::default()
        };
        let mut out = vec![9.0; 8];
        render(&mut m, &mut out, 2);
        assert_eq!(out, [0.5, 0.5, 0.25, 0.25, 0.0, 0.0, 0.0, 0.0]);
        assert!(m.voice.as_ref().unwrap().ended, "fin du sample sans boucle");

        m.looping = true;
        m.voice = Some(voice(vec![1.0, 1.0, 0.5, 0.5]));
        render(&mut m, &mut out, 2);
        assert_eq!(out, [0.5, 0.5, 0.25, 0.25, 0.5, 0.5, 0.25, 0.25], "boucle");
    }

    #[test]
    fn decodage_en_retard_donne_du_silence() {
        let mut v = voice(vec![1.0, 1.0]);
        v.complete = false;
        let mut m = Mix {
            volume: 1.0,
            voice: Some(v),
            ..Default::default()
        };
        let mut out = vec![0.0; 6];
        render(&mut m, &mut out, 2);
        assert_eq!(out, [1.0, 1.0, 0.0, 0.0, 0.0, 0.0]);
        assert!(!m.voice.as_ref().unwrap().ended, "pas fini : on attend la suite");
    }

    #[test]
    fn reechantillonnage_et_canaux() {
        // Mono 2 Hz → stéréo 4 Hz : chaque trame est doublée et interpolée.
        let mut r = Resampler::new(2, 4, 1, 2);
        let mut out = vec![];
        r.process(&[0.0, 1.0], &mut out);
        r.process(&[1.0], &mut out);
        assert_eq!(out, [0.0, 0.0, 0.5, 0.5, 1.0, 1.0, 1.0, 1.0]);
        // Même fréquence : copie, mono → deux côtés.
        let mut r = Resampler::new(48_000, 48_000, 1, 2);
        let mut out = vec![];
        r.process(&[0.25, -0.5], &mut out);
        assert_eq!(out, [0.25, 0.25, -0.5, -0.5]);
    }

    #[test]
    fn forme_d_onde_detaillee() {
        // 3 blocs : silence, crête positive, crête négative plus forte.
        let blocks = [(0.0, 0.0, 0.0, 64), (-0.1, 0.5, 4.0, 64), (-0.8, 0.2, 16.0, 64)];
        let w = bucket_waveform(&blocks, 3);
        assert_eq!((w.min.len(), w.max.len(), w.rms.len()), (3, 3, 3));
        assert_eq!(w.min[2], -1.0, "normalisée sur le maximum absolu");
        assert!((w.max[1] - 0.625).abs() < 1e-6);
        assert!(w.rms.iter().all(|&r| (0.0..=1.0).contains(&r)));
        // Plus de colonnes que de blocs : chaque colonne reprend son bloc.
        let w = bucket_waveform(&blocks, 6);
        assert_eq!(w.max.len(), 6);
        assert_eq!(w.max[0], w.max[1]);
        assert!(bucket_waveform(&[], 10).max.is_empty());
    }

    #[test]
    fn pics_normalises() {
        let p = bucket_peaks(&[0.1, 0.5, 0.25]);
        assert_eq!(p.len(), PEAKS);
        assert_eq!(*p.iter().max().unwrap(), 255);
        assert_eq!(bucket_peaks(&[]), vec![0; PEAKS]);
    }
}
