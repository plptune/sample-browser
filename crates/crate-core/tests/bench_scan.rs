//! Mesures de la phase 2 sur une bibliothèque synthétique (100 000 fichiers par défaut, CRATE_BENCH_N pour
//! changer). Ignoré par défaut : `cargo test --release -p crate-core --test bench_scan -- --ignored --nocapture`.
//! Critère de sortie : indexation complète en moins de 60 s.

use std::fs;
use std::path::Path;
use std::time::{Duration, Instant};

use crate_core::{Backend, SqliteLibrary, TreeRequest, TreeRoot};

const KINDS: [&str; 8] = ["Kick", "Snare", "Hat", "Clap", "Perc", "Bass Loop", "Vox Chop", "FX"];
const ADJ: [&str; 6] = ["Dusty", "Warm", "Dark", "Bright", "Tape", "Airy"];

fn wav_bytes(frames: u32) -> Vec<u8> {
    let data = frames * 2;
    let mut b = Vec::new();
    b.extend_from_slice(b"RIFF");
    b.extend_from_slice(&(36 + data).to_le_bytes());
    b.extend_from_slice(b"WAVEfmt ");
    for v in [
        16u32.to_le_bytes(),
        [1, 0, 1, 0],
        44_100u32.to_le_bytes(),
        88_200u32.to_le_bytes(),
        [2, 0, 16, 0],
    ] {
        b.extend_from_slice(&v);
    }
    b.extend_from_slice(b"data");
    b.extend_from_slice(&data.to_le_bytes());
    b.resize(44 + data as usize, 0);
    b
}

/// N fichiers : packs de 20 dossiers de 100 fichiers, plus un dossier de 5 000 fichiers.
fn generate(root: &Path, n: usize) {
    let big = 5_000.min(n / 4);
    let mut i = 0;
    while i < n {
        let rel = if i < big {
            "Big Folder".to_string()
        } else {
            let k = (i - big) / 100;
            format!("Pack {:03}/Folder {:02}", k / 20, k % 20)
        };
        let dir = root.join(rel);
        fs::create_dir_all(&dir).unwrap();
        let name = format!("{}_{}_{:05}.wav", KINDS[i % KINDS.len()], ADJ[(i / 8) % ADJ.len()], i);
        fs::write(dir.join(name), wav_bytes(64 + (i % 512) as u32)).unwrap();
        i += 1;
    }
}

fn ms(d: Duration) -> String {
    format!("{:.1} ms", d.as_secs_f64() * 1000.0)
}

#[test]
#[ignore]
fn indexation_de_100_000_fichiers() {
    let n: usize = std::env::var("CRATE_BENCH_N").ok().and_then(|v| v.parse().ok()).unwrap_or(100_000);
    let base = std::env::temp_dir().join(format!("crate-bench-{}", std::process::id()));
    let _ = fs::remove_dir_all(&base);
    let root = base.join("Library");
    let t = Instant::now();
    generate(&root, n);
    println!("génération de {n} fichiers : {:.1} s", t.elapsed().as_secs_f64());

    let mut lib = SqliteLibrary::open_inline(&base.join("crate.db")).unwrap();
    let t = Instant::now();
    let src = lib.add_source(&root.to_string_lossy()).unwrap();
    let scan = t.elapsed();
    let total = lib.library().total as usize;
    println!(
        "scan complet : {:.1} s ({:.0} fichiers/s), {total} indexés",
        scan.as_secs_f64(),
        total as f64 / scan.as_secs_f64()
    );
    assert_eq!(total, n);

    let t = Instant::now();
    let r = lib.scan_inline(src.id).unwrap();
    println!("rescan sans changement : {} ({} inchangés)", ms(t.elapsed()), r.unchanged);

    let t = Instant::now();
    let cat = crate_core::db::load_catalog(lib.connection()).unwrap();
    println!("chargement du catalogue : {}", ms(t.elapsed()));
    drop(cat);

    let big = lib.sources()[0].id;
    let big_folder = lib.catalog().samples()[0].folder_id;
    let tree = |q: &str, expanded: Vec<String>| {
        let t = Instant::now();
        let page = lib.tree(&TreeRequest {
            root: TreeRoot::Library,
            query: q.into(),
            expanded,
            offset: 0,
            limit: 2000,
        });
        (t.elapsed(), page.total_rows, page.matches)
    };
    let (d, rows, _) = tree("", vec![format!("f:{big}"), format!("f:{big_folder}")]);
    println!("ouverture d'un dossier de 5 000 samples : {} ({rows} lignes)", ms(d));
    for q in ["kick", "kick dusty", "#warm", "type:loop", "zzz"] {
        let (d, rows, m) = tree(q, vec![]);
        println!("recherche {q:?} : {} ({m} résultats, {rows} lignes)", ms(d));
    }
    let _ = fs::remove_dir_all(&base);
    assert!(scan < Duration::from_secs(60), "budget : 100 000 fichiers en moins de 60 s");
}
