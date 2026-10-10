//! Formes d'onde détaillées déjà calculées (tiroir, inspecteur, préchargement des voisins).
//! Deux demandes identiques en même temps (le tiroir et le préchargement) ne décodent le fichier qu'une fois :
//! la seconde attend la première, puis lit le résultat.

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};

use crate_core::{SampleId, Waveform};

/// (sample, colonnes).
pub type WaveKey = (SampleId, u32);

/// Formes gardées : les dernières demandées.
const KEEP: usize = 32;

#[derive(Default)]
pub struct WaveCache {
    done: Mutex<VecDeque<(WaveKey, Waveform)>>,
    /// Calculs en cours, un verrou par clé.
    busy: Mutex<HashMap<WaveKey, Arc<Mutex<()>>>>,
}

impl WaveCache {
    pub fn get(&self, key: WaveKey) -> Option<Waveform> {
        let done = self.done.lock().unwrap_or_else(|e| e.into_inner());
        done.iter().find(|(k, _)| *k == key).map(|(_, w)| w.clone())
    }

    /// La forme en cache, sinon calculée par `compute` (une seule fois, même si plusieurs demandes arrivent ensemble).
    pub fn get_or_compute(&self, key: WaveKey, compute: impl FnOnce() -> Waveform) -> Waveform {
        if let Some(w) = self.get(key) {
            return w;
        }
        let gate = self.busy.lock().unwrap_or_else(|e| e.into_inner()).entry(key).or_default().clone();
        let _turn = gate.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(w) = self.get(key) {
            return w; // calculée par la demande qui nous précédait
        }
        let w = compute();
        {
            let mut done = self.done.lock().unwrap_or_else(|e| e.into_inner());
            done.push_front((key, w.clone()));
            done.truncate(KEEP);
        }
        self.busy.lock().unwrap_or_else(|e| e.into_inner()).remove(&key);
        w
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;

    #[test]
    fn deux_demandes_un_seul_calcul() {
        let cache = Arc::new(WaveCache::default());
        let calls = Arc::new(AtomicUsize::new(0));
        let threads: Vec<_> = (0..4)
            .map(|_| {
                let (cache, calls) = (cache.clone(), calls.clone());
                std::thread::spawn(move || {
                    cache.get_or_compute((7, 512), || {
                        calls.fetch_add(1, Ordering::SeqCst);
                        std::thread::sleep(Duration::from_millis(50));
                        Waveform {
                            min: vec![-1.0],
                            max: vec![1.0],
                            rms: vec![0.5],
                        }
                    })
                })
            })
            .collect();
        for t in threads {
            assert_eq!(t.join().unwrap().max, vec![1.0]);
        }
        assert_eq!(calls.load(Ordering::SeqCst), 1, "décodé une seule fois");
        // Autre largeur : nouveau calcul.
        cache.get_or_compute((7, 1024), || {
            calls.fetch_add(1, Ordering::SeqCst);
            Waveform::default()
        });
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn garde_les_32_dernieres() {
        let cache = WaveCache::default();
        for id in 0..40 {
            cache.get_or_compute((id, 128), Waveform::default);
        }
        assert!(cache.get((39, 128)).is_some());
        assert!(cache.get((8, 128)).is_some());
        assert!(cache.get((7, 128)).is_none(), "les plus anciennes sont oubliées");
    }
}
