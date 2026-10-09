//! Bibliothèque réelle : scan de vrais fichiers, rescan incrémental, introuvables, hors ligne, persistance,
//! copie réelle, surveillance des dossiers. Chaque test travaille dans son propre dossier temporaire.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate_core::{Backend, CommitOptions, ScanStatus, SqliteLibrary, TreeRequest, TreeRoot, TreeRow};

static NEXT: AtomicU32 = AtomicU32::new(0);

/// Dossier temporaire supprimé à la fin du test.
struct Tmp(PathBuf);

impl Tmp {
    fn new(name: &str) -> Self {
        let p = std::env::temp_dir().join(format!(
            "crate-test-{name}-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        Tmp(p.canonicalize().unwrap())
    }
    fn join(&self, rel: &str) -> PathBuf {
        self.0.join(rel)
    }
}

impl Drop for Tmp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// WAV PCM minimal : en-tête de 44 octets + silence.
fn wav(path: &Path, sample_rate: u32, channels: u16, bits: u16, frames: u32) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let block = channels as u32 * bits as u32 / 8;
    let data = frames * block;
    let mut b = Vec::with_capacity(44 + data as usize);
    b.extend_from_slice(b"RIFF");
    b.extend_from_slice(&(36 + data).to_le_bytes());
    b.extend_from_slice(b"WAVEfmt ");
    b.extend_from_slice(&16u32.to_le_bytes());
    b.extend_from_slice(&1u16.to_le_bytes());
    b.extend_from_slice(&channels.to_le_bytes());
    b.extend_from_slice(&sample_rate.to_le_bytes());
    b.extend_from_slice(&(sample_rate * block).to_le_bytes());
    b.extend_from_slice(&(block as u16).to_le_bytes());
    b.extend_from_slice(&bits.to_le_bytes());
    b.extend_from_slice(b"data");
    b.extend_from_slice(&data.to_le_bytes());
    b.resize(44 + data as usize, 0);
    fs::write(path, b).unwrap();
}

/// 0,5 s, 44,1 kHz, stéréo, 16 bits.
fn half_second(path: &Path) {
    wav(path, 44_100, 2, 16, 22_050);
}

fn req(expanded: &[String]) -> TreeRequest {
    TreeRequest {
        root: TreeRoot::Library,
        query: String::new(),
        expanded: expanded.to_vec(),
        offset: 0,
        limit: 100_000,
    }
}

/// Arbre entièrement déplié, en lignes « profondeur|nom » (dossiers suffixés de « / », introuvables de « ! »).
fn outline(lib: &SqliteLibrary) -> Vec<String> {
    let mut expanded: Vec<String> = vec![];
    loop {
        let page = lib.tree(&req(&expanded));
        let more: Vec<String> = page
            .rows
            .iter()
            .filter_map(|r| match r {
                TreeRow::Node(n) if n.key.starts_with("f:") && !n.open => Some(n.key.clone()),
                _ => None,
            })
            .collect();
        if more.is_empty() {
            // Sources seulement (pas les éléments épinglés comme Favoris).
            return page
                .rows
                .iter()
                .filter_map(|r| match r {
                    TreeRow::Node(n) if n.key.starts_with("f:") => Some(format!("{}|{}/", n.depth, n.name)),
                    TreeRow::Node(_) => None,
                    TreeRow::Sample(s) => Some(format!("{}|{}{}", s.depth, s.sample.name, if s.sample.missing { "!" } else { "" })),
                })
                .collect();
        }
        expanded.extend(more);
    }
}

fn sample_id(lib: &SqliteLibrary, name: &str) -> u32 {
    lib.catalog()
        .samples()
        .iter()
        .find(|s| s.name == name)
        .unwrap_or_else(|| panic!("{name} absent"))
        .id
}

fn library(tmp: &Tmp) -> SqliteLibrary {
    SqliteLibrary::open_inline(&tmp.join("db/crate.db")).unwrap()
}

/// Bibliothèque type : Drums › Kicks (2), Drums › Snare, une boucle à la racine, un dossier sans audio,
/// un dossier caché, un fichier illisible.
fn pack(root: &Path) {
    half_second(&root.join("Drums/Kicks/Kick 10.wav"));
    half_second(&root.join("Drums/Kicks/Kick 2.wav"));
    wav(&root.join("Drums/Snare.wav"), 48_000, 1, 24, 12_000);
    half_second(&root.join("Bass Loop 120.wav"));
    fs::create_dir_all(root.join("Docs")).unwrap();
    fs::write(root.join("Docs/readme.txt"), "hello").unwrap();
    half_second(&root.join(".hidden/Ghost.wav"));
    fs::write(root.join("broken.wav"), b"not audio at all").unwrap();
}

#[test]
fn scan_indexe_les_fichiers_audio() {
    let tmp = Tmp::new("scan");
    let root = tmp.join("Samples");
    pack(&root);
    let mut lib = library(&tmp);
    let src = lib.add_source(&root.to_string_lossy()).unwrap();
    assert_eq!(src.name, "Samples");
    assert_eq!(lib.node_path(&format!("f:{}", src.id)).as_deref(), Some(root.to_str().unwrap()));
    let kicks = lib.catalog().samples().iter().find(|s| s.name == "Kick 2").unwrap().folder_id;
    assert_eq!(
        lib.node_path(&format!("p:{kicks}")),
        Some(root.join("Drums/Kicks").to_string_lossy().into_owned())
    );
    assert_eq!(lib.node_path("v:1"), None);
    assert_eq!(lib.library().total, 4, "caché, illisible et non-audio ignorés");
    assert_eq!(
        outline(&lib),
        [
            "0|Samples/",
            "1|Drums/",
            "2|Kicks/",
            "3|Kick 2",
            "3|Kick 10",
            "2|Snare",
            "1|Bass Loop 120"
        ],
        "dossier sans audio masqué, tri naturel, dossiers avant samples"
    );
    let s = lib.catalog().samples().iter().find(|s| s.name == "Snare").unwrap();
    assert_eq!((s.sample_rate, s.channels, s.bit_depth, s.duration_ms), (48_000, 1, 24, 250));
    assert_eq!(s.ext, "wav");
    assert!(s.peaks.is_empty());
    let loop_ = lib.catalog().samples().iter().find(|s| s.name == "Bass Loop 120").unwrap();
    assert_eq!(loop_.kind, crate_core::SampleKind::Loop);
    assert_eq!(loop_.duration_ms, 500);
    // Recherche dans la vraie bibliothèque.
    let page = lib.tree(&TreeRequest {
        query: "kick".into(),
        ..req(&[])
    });
    assert_eq!(page.matches, 2);
    let page = lib.tree(&TreeRequest {
        query: "type:loop".into(),
        ..req(&[])
    });
    assert_eq!(page.matches, 1);
}

#[test]
fn rescan_incremental() {
    let tmp = Tmp::new("rescan");
    let root = tmp.join("Samples");
    pack(&root);
    let mut lib = library(&tmp);
    let src = lib.add_source(&root.to_string_lossy()).unwrap();

    // Rien n'a changé : aucun fichier relu.
    let r = lib.scan_inline(src.id).unwrap();
    assert_eq!((r.added, r.updated, r.unchanged, r.removed, r.missing), (0, 0, 4, 0, 0));

    // Kick 2 est tagué (référencé), Snare ne l'est pas ; les deux disparaissent. Kick 10 change. Un fichier arrive.
    let kick2 = sample_id(&lib, "Kick 2");
    lib.add_tag(&[kick2], "punchy");
    fs::remove_file(root.join("Drums/Kicks/Kick 2.wav")).unwrap();
    fs::remove_file(root.join("Drums/Snare.wav")).unwrap();
    wav(&root.join("Drums/Kicks/Kick 10.wav"), 44_100, 2, 16, 44_100);
    half_second(&root.join("Drums/Hat.wav"));
    let r = lib.scan_inline(src.id).unwrap();
    assert_eq!((r.added, r.updated, r.unchanged, r.removed, r.missing), (1, 1, 1, 1, 1));
    assert_eq!(
        outline(&lib),
        [
            "0|Samples/",
            "1|Drums/",
            "2|Kicks/",
            "3|Kick 2!",
            "3|Kick 10",
            "2|Hat",
            "1|Bass Loop 120"
        ]
    );
    assert_eq!(
        lib.catalog().samples().iter().find(|s| s.name == "Kick 10").unwrap().duration_ms,
        1000
    );
    assert_eq!(sample_id(&lib, "Kick 2"), kick2, "l'introuvable garde son id et ses tags");

    // Le fichier revient : plus introuvable, même id.
    half_second(&root.join("Drums/Kicks/Kick 2.wav"));
    lib.scan_inline(src.id).unwrap();
    let s = lib.catalog().samples().iter().find(|s| s.name == "Kick 2").unwrap();
    assert!(!s.missing);
    assert_eq!(s.id, kick2);
    assert_eq!(s.tags, ["punchy"]);
}

#[test]
fn dossiers_vides_retires() {
    let tmp = Tmp::new("vides");
    let root = tmp.join("Samples");
    pack(&root);
    let mut lib = library(&tmp);
    let src = lib.add_source(&root.to_string_lossy()).unwrap();
    fs::remove_dir_all(root.join("Drums")).unwrap();
    let r = lib.scan_inline(src.id).unwrap();
    assert_eq!(r.removed, 3);
    assert_eq!(outline(&lib), ["0|Samples/", "1|Bass Loop 120"]);
    let n: i64 = lib
        .connection()
        .query_row("SELECT COUNT(*) FROM folders", [], |r| r.get(0))
        .unwrap();
    assert_eq!(n, 1);
}

#[test]
fn source_hors_ligne() {
    let tmp = Tmp::new("offline");
    let root = tmp.join("Disque");
    pack(&root);
    let mut lib = library(&tmp);
    let src = lib.add_source(&root.to_string_lossy()).unwrap();
    let moved = tmp.join("Ailleurs");
    fs::rename(&root, &moved).unwrap();
    let r = lib.scan_inline(src.id).unwrap();
    assert!(r.offline);
    assert!(lib.sources()[0].offline);
    assert_eq!(lib.library().total, 4, "rien n'est supprimé quand le disque est absent");
    fs::rename(&moved, &root).unwrap();
    lib.scan_inline(src.id).unwrap();
    assert!(!lib.sources()[0].offline);
}

fn page(lib: &SqliteLibrary, root: TreeRoot, expanded: &[String]) -> String {
    let r = TreeRequest {
        root,
        expanded: expanded.to_vec(),
        ..req(&[])
    };
    serde_json::to_string(&lib.tree(&r)).unwrap()
}

#[test]
fn tout_est_persistant() {
    let tmp = Tmp::new("persist");
    let root = tmp.join("Samples");
    pack(&root);
    let before = {
        let mut lib = library(&tmp);
        lib.add_source(&root.to_string_lossy()).unwrap();
        let (k2, k10, snare) = (sample_id(&lib, "Kick 2"), sample_id(&lib, "Kick 10"), sample_id(&lib, "Snare"));
        lib.set_favorite(&[k2], true);
        lib.add_tag(&[k2, k10], "punchy");
        lib.add_tag(&[snare], "dark");
        lib.remove_tag(&[k10], "punchy");
        let c = lib.create_collection("Kicks choisis", None);
        lib.add_to_collection(c.id, &[k10, k2]);
        let smart = lib.create_collection("Sombres", Some("#dark"));
        lib.rename_collection(smart.id, "Sombres !");
        let pack = lib.create_virtual_folder("Pack", None);
        let sub = lib.create_virtual_folder("Drums", Some(pack.id));
        let other = lib.create_virtual_folder("Divers", None);
        lib.move_virtual_folder(other.id, Some(pack.id));
        lib.add_to_virtual_folder(sub.id, &[snare, k2]);
        lib.set_pinned(&format!("v:{}", pack.id), true);
        lib.set_pinned(&format!("c:{}", c.id), true);
        lib.set_pinned("c:fav", false);
        let kick_folder = lib.catalog().samples().iter().find(|s| s.name == "Kick 2").unwrap().folder_id;
        lib.set_pinned(&format!("f:{kick_folder}"), true);
        let expanded = vec![
            format!("v:{}", pack.id),
            format!("v:{}", sub.id),
            format!("c:{}", c.id),
            format!("c:{}", smart.id),
            "g:collections".into(),
            "c:fav".into(),
        ];
        (
            serde_json::to_string(&lib.library()).unwrap(),
            page(&lib, TreeRoot::Library, &expanded),
            page(&lib, TreeRoot::Virtual, &expanded),
            expanded,
        )
    };
    let lib = library(&tmp);
    assert_eq!(serde_json::to_string(&lib.library()).unwrap(), before.0);
    assert_eq!(page(&lib, TreeRoot::Library, &before.3), before.1);
    assert_eq!(page(&lib, TreeRoot::Virtual, &before.3), before.2);
    let lib_json = lib.library();
    assert!(!lib_json.favorites_pinned);
    assert_eq!(lib_json.pinned_folders.len(), 1);
    assert_eq!(lib_json.virtual_folders.iter().filter(|f| f.parent_id.is_some()).count(), 2);
}

#[test]
fn suppression_virtuelle_et_source() {
    let tmp = Tmp::new("delete");
    let root = tmp.join("Samples");
    pack(&root);
    let mut lib = library(&tmp);
    let src = lib.add_source(&root.to_string_lossy()).unwrap();
    let k2 = sample_id(&lib, "Kick 2");
    let a = lib.create_virtual_folder("A", None);
    let b = lib.create_virtual_folder("B", Some(a.id));
    lib.add_to_virtual_folder(b.id, &[k2]);
    lib.delete_virtual_folder(a.id);
    let n: i64 = lib
        .connection()
        .query_row("SELECT COUNT(*) FROM virtual_items", [], |r| r.get(0))
        .unwrap();
    assert_eq!(n, 0, "sous-dossiers et contenus supprimés en cascade");
    let c = lib.create_collection("C", None);
    lib.add_to_collection(c.id, &[k2]);
    lib.remove_source(src.id);
    assert!(lib.sources().is_empty());
    assert_eq!(lib.library().total, 0);
    assert!(root.join("Drums/Kicks/Kick 2.wav").exists(), "rien n'est touché sur le disque");
    let n: i64 = lib
        .connection()
        .query_row("SELECT COUNT(*) FROM collection_items", [], |r| r.get(0))
        .unwrap();
    assert_eq!(n, 0);
}

#[test]
fn ajout_de_source_refuse() {
    let tmp = Tmp::new("refus");
    let root = tmp.join("Samples");
    pack(&root);
    let mut lib = library(&tmp);
    lib.add_source(&root.to_string_lossy()).unwrap();
    assert!(lib.add_source(&root.to_string_lossy()).is_err(), "déjà une source");
    assert!(lib.add_source(&root.join("Drums").to_string_lossy()).is_err(), "dans une source");
    assert!(lib.add_source(&tmp.0.to_string_lossy()).is_err(), "contient une source");
    assert!(
        lib.add_source(&root.join("Bass Loop 120.wav").to_string_lossy()).is_err(),
        "pas un dossier"
    );
    assert!(lib.add_source(&tmp.join("nulle-part").to_string_lossy()).is_err(), "introuvable");
    assert_eq!(lib.sources().len(), 1);
}

#[test]
fn creer_un_vrai_dossier_copie_les_fichiers() {
    let tmp = Tmp::new("commit");
    let root = tmp.join("Samples");
    pack(&root);
    let mut lib = library(&tmp);
    lib.add_source(&root.to_string_lossy()).unwrap();
    let (k2, k10, snare) = (sample_id(&lib, "Kick 2"), sample_id(&lib, "Kick 10"), sample_id(&lib, "Snare"));
    let pack_vf = lib.create_virtual_folder("Pack", None);
    let drums = lib.create_virtual_folder("Drums", Some(pack_vf.id));
    lib.create_virtual_folder("Vide", Some(pack_vf.id));
    lib.add_to_virtual_folder(pack_vf.id, &[snare]);
    lib.add_to_virtual_folder(drums.id, &[k2, k10]);
    let keep = CommitOptions {
        keep_hierarchy: true,
        add_as_source: true,
    };
    let plan = lib.plan_commit(&format!("v:{}", pack_vf.id), keep);
    assert_eq!((plan.files, plan.folders), (3, 2));
    assert_eq!(plan.bytes, (2 * (44 + 88_200) + 44 + 36_000) as f64, "tailles réelles des fichiers");

    let dest = tmp.join("Export/Pack 2026");
    let res = lib
        .commit_to_folder(&format!("v:{}", pack_vf.id), &dest.to_string_lossy(), keep)
        .unwrap();
    assert_eq!((res.copied, res.skipped), (3, 0));
    assert!(dest.join("Snare.wav").is_file());
    assert!(dest.join("Drums/Kick 2.wav").is_file());
    assert!(dest.join("Vide").is_dir());
    assert!(root.join("Drums/Kicks/Kick 2.wav").is_file(), "copie, jamais de déplacement");
    assert_eq!(lib.sources().len(), 2, "ajoutée aux sources");
    assert_eq!(lib.library().total, 7, "et indexée");

    // Destination existante non vide : refusé, rien n'est écrasé.
    assert!(lib
        .commit_to_folder(&format!("v:{}", pack_vf.id), &dest.to_string_lossy(), keep)
        .is_err());

    // À plat, deux fichiers de même nom : le second devient « Kick 2 2 ».
    let c = lib.create_collection("Doublons", None);
    let copy = lib
        .catalog()
        .samples()
        .iter()
        .find(|s| s.name == "Kick 2" && s.id != k2)
        .unwrap()
        .id;
    lib.add_to_collection(c.id, &[k2, copy]);
    let flat = tmp.join("Flat");
    let res = lib
        .commit_to_folder(
            &format!("c:{}", c.id),
            &flat.to_string_lossy(),
            CommitOptions {
                keep_hierarchy: false,
                add_as_source: false,
            },
        )
        .unwrap();
    assert_eq!(res.copied, 2);
    assert!(flat.join("Kick 2.wav").is_file() && flat.join("Kick 2 2.wav").is_file());
}

#[test]
fn migrations_idempotentes() {
    let tmp = Tmp::new("migr");
    let path = tmp.join("crate.db");
    let conn = crate_core::db::open(&path).unwrap();
    assert_eq!(crate_core::db::schema_version(&conn).unwrap(), 1);
    drop(conn);
    let conn = crate_core::db::open(&path).unwrap();
    assert_eq!(crate_core::db::schema_version(&conn).unwrap(), 1);
}

/// Attend qu'une condition devienne vraie (les scans tournent sur le thread de l'indexeur).
fn wait_for(lib: &mut SqliteLibrary, what: &str, ok: impl Fn(&SqliteLibrary) -> bool) {
    let t0 = Instant::now();
    loop {
        lib.sync();
        if ok(lib) {
            return;
        }
        assert!(t0.elapsed() < Duration::from_secs(20), "délai dépassé : {what}");
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[test]
fn indexeur_en_tache_de_fond_et_surveillance() {
    let tmp = Tmp::new("watch");
    let root = tmp.join("Samples");
    pack(&root);
    let statuses: Arc<Mutex<Vec<ScanStatus>>> = Arc::default();
    let sink = statuses.clone();
    let mut lib = SqliteLibrary::open(&tmp.join("crate.db"), Arc::new(move |s| sink.lock().unwrap().push(s))).unwrap();
    lib.add_source(&root.to_string_lossy()).unwrap();
    wait_for(&mut lib, "scan initial", |l| l.library().total == 4);
    {
        let st = statuses.lock().unwrap();
        assert!(st.last().unwrap().finished);
        assert!(st.iter().any(|s| !s.finished));
    }
    // Un fichier ajouté dans la source est vu sans rien demander.
    half_second(&root.join("Drums/Kicks/Kick 3.wav"));
    wait_for(&mut lib, "notify", |l| l.library().total == 5);
    // Au redémarrage, ce qui a changé pendant que l'app était fermée est rattrapé.
    drop(lib);
    half_second(&root.join("Drums/Clap.wav"));
    let mut lib = SqliteLibrary::open(&tmp.join("crate.db"), Arc::new(|_| {})).unwrap();
    assert_eq!(lib.library().total, 5, "la base est lue tout de suite");
    wait_for(&mut lib, "rescan au lancement", |l| l.library().total == 6);
}
