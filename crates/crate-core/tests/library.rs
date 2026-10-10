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
        ..Default::default()
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
    let mut page = lib.tree(&r);
    page.micros = 0; // temps mesuré, varie d'un appel à l'autre
    serde_json::to_string(&page).unwrap()
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
        lib.set_synonyms(&[vec!["Kick".into(), "boum".into()], vec!["seul".into()]]);
        lib.set_hidden(&[snare], true);
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
    assert_eq!(lib.synonyms(), [["kick", "boum"]], "synonymes normalisés et gardés");
    assert_eq!(lib.library().hidden, 1, "masquage gardé");
    assert!(lib.catalog().samples().iter().find(|s| s.name == "Snare").unwrap().hidden);
    assert_eq!(
        lib.tree(&TreeRequest {
            query: "boum".into(),
            ..req(&[])
        })
        .matches,
        2,
        "« boum » trouve les kicks"
    );
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
    assert_eq!(crate_core::db::schema_version(&conn).unwrap(), 2);
    drop(conn);
    let conn = crate_core::db::open(&path).unwrap();
    assert_eq!(crate_core::db::schema_version(&conn).unwrap(), 2);
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

#[test]
fn pics_a_la_demande_et_en_tache_de_fond() {
    let tmp = Tmp::new("peaks");
    let root = tmp.join("Samples");
    pack(&root);
    // L'app : l'indexeur calcule les pics une fois le scan fini.
    let mut lib = SqliteLibrary::open(&tmp.join("crate.db"), Arc::new(|_| {})).unwrap();
    lib.add_source(&root.to_string_lossy()).unwrap();
    wait_for(&mut lib, "scan", |l| l.library().total == 4);
    wait_for(&mut lib, "pics en tâche de fond", |l| {
        l.connection()
            .query_row("SELECT COUNT(*) FROM files WHERE peaks IS NULL", [], |r| r.get::<_, i64>(0))
            .unwrap()
            == 0
    });
    // Densité « waveform » : les lignes de la page portent leurs pics ; sinon, non.
    let kicks = lib.catalog().samples().iter().find(|s| s.name == "Kick 2").unwrap().folder_id;
    let drums = lib.catalog().ancestors(&format!("f:{kicks}"));
    let mut expanded = drums.clone();
    expanded.push(format!("f:{kicks}"));
    let with = lib.tree(&TreeRequest {
        peaks: true,
        ..req(&expanded)
    });
    let without = lib.tree(&req(&expanded));
    let sample_peaks = |p: &crate_core::TreePage| -> Vec<usize> {
        p.rows
            .iter()
            .filter_map(|r| match r {
                TreeRow::Sample(s) => Some(s.sample.peaks.len()),
                _ => None,
            })
            .collect()
    };
    assert!(sample_peaks(&with).iter().all(|&n| n == 256), "{:?}", sample_peaks(&with));
    assert!(sample_peaks(&without).iter().all(|&n| n == 0));
    drop(lib);

    // À la demande (tiroir) : calculés tout de suite s'ils manquent, puis gardés.
    let lib = library_at(&tmp.join("crate.db"));
    lib.connection().execute("UPDATE files SET peaks = NULL", []).unwrap();
    let id = sample_id(&lib, "Kick 10");
    assert_eq!(lib.peaks(id).len(), 256);
    let stored: i64 = lib
        .connection()
        .query_row("SELECT length(peaks) FROM files WHERE id = ?", [id], |r| r.get(0))
        .unwrap();
    assert_eq!(stored, 256);
    // Silence partout (fichiers de test) : pics à zéro, sans erreur.
    assert!(lib.peaks(id).iter().all(|&x| x == 0.0));
    assert!(lib.peaks(999_999).is_empty());
}

fn library_at(path: &Path) -> SqliteLibrary {
    SqliteLibrary::open_inline(path).unwrap()
}

#[test]
fn masquer_un_dossier_et_rescanner() {
    let tmp = Tmp::new("hide");
    let root = tmp.join("Samples");
    pack(&root);
    let mut lib = library(&tmp);
    let src = lib.add_source(&root.to_string_lossy()).unwrap();
    let kicks = lib.catalog().samples().iter().find(|s| s.name == "Kick 2").unwrap().folder_id;
    lib.set_folder_hidden(kicks, true);
    assert_eq!(
        outline(&lib),
        ["0|Samples/", "1|Drums/", "2|Snare", "1|Bass Loop 120"],
        "dossier masqué absent"
    );
    assert_eq!(lib.library().hidden, 2);
    let page = lib.tree(&TreeRequest {
        query: "is:hidden".into(),
        ..req(&[])
    });
    assert_eq!(page.matches, 2, "is:hidden les retrouve");
    // Un rescan ne ré-affiche rien ; le disque n'est pas touché.
    lib.scan_inline(src.id).unwrap();
    assert_eq!(lib.library().hidden, 2);
    assert!(root.join("Drums/Kicks/Kick 2.wav").is_file());
    lib.set_folder_hidden(kicks, false);
    assert_eq!(lib.library().hidden, 0);
}

#[test]
fn copie_avec_progression() {
    let tmp = Tmp::new("progress");
    let root = tmp.join("Samples");
    pack(&root);
    let mut lib = library(&tmp);
    lib.add_source(&root.to_string_lossy()).unwrap();
    let ids: Vec<u32> = lib.catalog().samples().iter().map(|s| s.id).collect();
    let c = lib.create_collection("Tout", None);
    lib.add_to_collection(c.id, &ids);
    let opts = CommitOptions {
        keep_hierarchy: false,
        add_as_source: false,
    };
    let job = lib
        .prepare_commit(&format!("c:{}", c.id), &tmp.join("Out").to_string_lossy(), opts)
        .unwrap();
    assert_eq!(job.total(), 4);
    let mut seen = vec![];
    let res = job.run(&mut |done, total| seen.push((done, total))).unwrap();
    assert_eq!(seen, [(1, 4), (2, 4), (3, 4), (4, 4)]);
    assert_eq!((res.copied, res.skipped), (4, 0));
    // Destination maintenant non vide : refusée dès la préparation, rien n'est copié.
    assert!(lib
        .prepare_commit(&format!("c:{}", c.id), &tmp.join("Out").to_string_lossy(), opts)
        .is_err());
}

/// Empreinte d'un dossier : chemins, tailles, dates et contenus (rien ne doit changer).
fn snapshot(root: &Path) -> Vec<(String, u64, std::time::SystemTime, Vec<u8>)> {
    let mut out = vec![];
    let mut stack = vec![root.to_path_buf()];
    while let Some(d) = stack.pop() {
        for e in fs::read_dir(&d).unwrap().flatten() {
            let p = e.path();
            let m = fs::symlink_metadata(&p).unwrap();
            if m.is_dir() {
                stack.push(p.clone());
                out.push((p.to_string_lossy().into_owned(), 0, m.modified().unwrap(), vec![]));
            } else {
                out.push((
                    p.to_string_lossy().into_owned(),
                    m.len(),
                    m.modified().unwrap(),
                    fs::read(&p).unwrap(),
                ));
            }
        }
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}

/// Critère de sortie de la phase 5 : toutes les modifications vivent dans la base, rien n'est écrit dans les
/// dossiers de l'utilisateur (seul « Créer un vrai dossier » écrit, dans un nouveau dossier choisi).
#[test]
fn rien_n_est_ecrit_dans_les_dossiers_de_l_utilisateur() {
    let tmp = Tmp::new("readonly");
    let root = tmp.join("Samples");
    pack(&root);
    let before = snapshot(&root);
    let mut lib = SqliteLibrary::open(&tmp.join("db/crate.db"), Arc::new(|_| {})).unwrap();
    let src = lib.add_source(&root.to_string_lossy()).unwrap();
    wait_for(&mut lib, "scan", |l| l.library().total == 4);
    let ids: Vec<u32> = lib.catalog().samples().iter().map(|s| s.id).collect();
    let kicks = lib.catalog().samples().iter().find(|s| s.name == "Kick 2").unwrap().folder_id;
    lib.set_favorite(&ids, true);
    lib.add_tag(&ids, "dark");
    lib.remove_tag(&ids[..1], "dark");
    let c = lib.create_collection("C", None);
    lib.add_to_collection(c.id, &ids);
    lib.rename_collection(c.id, "C2");
    lib.create_collection("S", Some("#dark"));
    let v = lib.create_virtual_folder("V", None);
    lib.add_to_virtual_folder(v.id, &ids);
    lib.set_pinned(&format!("v:{}", v.id), true);
    lib.set_pinned(&format!("f:{kicks}"), true);
    lib.set_hidden(&ids[..2], true);
    lib.set_folder_hidden(kicks, true);
    lib.set_synonyms(&[vec!["kick".into(), "boum".into()]]);
    lib.refresh_source(src.id);
    for id in &ids {
        lib.peaks(*id);
    }
    lib.plan_commit(
        &format!("v:{}", v.id),
        CommitOptions {
            keep_hierarchy: true,
            add_as_source: false,
        },
    );
    lib.commit_to_folder(
        &format!("c:{}", c.id),
        &tmp.join("Export").to_string_lossy(),
        CommitOptions {
            keep_hierarchy: false,
            add_as_source: false,
        },
    )
    .unwrap();
    lib.remove_from_collection(c.id, &ids);
    lib.delete_virtual_folder(v.id);
    // L'analyse de fond lit les fichiers, elle aussi, sans rien y écrire.
    wait_for(&mut lib, "analyse", |l| {
        l.connection()
            .query_row("SELECT COUNT(*) FROM files WHERE analyzed_at IS NULL", [], |r| r.get::<_, i64>(0))
            .unwrap()
            == 0
    });
    lib.remove_source(src.id);
    drop(lib);
    std::thread::sleep(Duration::from_millis(200));
    assert!(snapshot(&root) == before, "le dossier de l'utilisateur a changé");
}

/// WAV mono 16 bits à partir d'échantillons (-1..1).
fn wav_from(path: &Path, rate: u32, x: &[f32]) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let data = x.len() as u32 * 2;
    let mut b = Vec::with_capacity(44 + data as usize);
    b.extend_from_slice(b"RIFF");
    b.extend_from_slice(&(36 + data).to_le_bytes());
    b.extend_from_slice(b"WAVEfmt ");
    b.extend_from_slice(&16u32.to_le_bytes());
    b.extend_from_slice(&1u16.to_le_bytes());
    b.extend_from_slice(&1u16.to_le_bytes());
    b.extend_from_slice(&rate.to_le_bytes());
    b.extend_from_slice(&(rate * 2).to_le_bytes());
    b.extend_from_slice(&2u16.to_le_bytes());
    b.extend_from_slice(&16u16.to_le_bytes());
    b.extend_from_slice(b"data");
    b.extend_from_slice(&data.to_le_bytes());
    for v in x {
        b.extend_from_slice(&((v.clamp(-1.0, 1.0) * 30000.0) as i16).to_le_bytes());
    }
    fs::write(path, b).unwrap();
}

/// Boucle de deux mesures : kick sur les temps, charleston (bruit) sur les contretemps.
fn beat_loop(path: &Path, bpm: f32) {
    let rate = 44_100.0;
    let beat = 60.0 / bpm;
    let n = (8.0 * beat * rate) as usize;
    let mut seed = 12345u32;
    let x: Vec<f32> = (0..n)
        .map(|i| {
            let t = i as f32 / rate;
            let tb = t % beat;
            let kick = (std::f32::consts::TAU * (50.0 * tb + 3.3 * (1.0 - (-30.0 * tb).exp()))).sin() * (-8.0 * tb).exp();
            seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            let noise = (seed >> 9) as f32 / (1u32 << 23) as f32 * 2.0 - 1.0;
            let th = (t + beat / 2.0) % beat;
            0.7 * kick + 0.25 * noise * (-60.0 * th).exp()
        })
        .collect();
    wav_from(path, 44_100, &x);
}

/// Accord plaqué (fondamentale, tierce, quinte ; 4 harmoniques) d'une seconde.
fn chord(path: &Path, root_midi: f32, minor: bool) {
    let rate = 44_100.0;
    let third = if minor { 3.0 } else { 4.0 };
    let x: Vec<f32> = (0..44_100)
        .map(|i| {
            let t = i as f32 / rate;
            let env = (t / 0.005).min(1.0) * (-2.0 * t).exp();
            [0.0, third, 7.0]
                .iter()
                .map(|iv| {
                    let f = 440.0 * 2f32.powf((root_midi + iv - 69.0) / 12.0);
                    (1..=4)
                        .map(|h| (std::f32::consts::TAU * f * h as f32 * t).sin() / h as f32)
                        .sum::<f32>()
                })
                .sum::<f32>()
                * env
                * 0.2
        })
        .collect();
    wav_from(path, 44_100, &x);
}

fn sample<'a>(lib: &'a SqliteLibrary, name: &str) -> &'a crate_core::Sample {
    lib.catalog().samples().iter().find(|s| s.name == name).unwrap()
}

/// Phase 6 : le nom sert tout de suite, l'analyse audio complète ensuite ; tout est gardé et repris.
#[test]
fn analyse_de_fond_et_reprise() {
    let tmp = Tmp::new("analysis");
    let root = tmp.join("Samples");
    beat_loop(&root.join("groove.wav"), 120.0);
    chord(&root.join("stab.wav"), 57.0, true);
    beat_loop(&root.join("Drum_Loop_Tight_95_Am.wav"), 120.0);
    half_second(&root.join("silence.wav"));
    let db = tmp.join("crate.db");

    // Juste après le scan : ce que disent les noms.
    let mut lib = library_at(&db);
    lib.add_source(&root.to_string_lossy()).unwrap();
    let named = sample(&lib, "Drum_Loop_Tight_95_Am");
    assert_eq!(
        (named.bpm, named.key.as_deref(), named.kind),
        (Some(95.0), Some("Am"), crate_core::SampleKind::Loop)
    );
    assert_eq!(sample(&lib, "groove").bpm, None);
    assert_eq!(
        lib.analysis_status(),
        crate_core::AnalysisStatus::default(),
        "pas d'indexeur en mode direct"
    );
    drop(lib);

    // L'app : l'indexeur analyse en fond, le catalogue suit sans rechargement complet.
    let mut lib = SqliteLibrary::open(&db, Arc::new(|_| {})).unwrap();
    wait_for(&mut lib, "analyse de fond", |l| {
        let st = l.analysis_status();
        st.total == 4 && st.done == 4 && sample(l, "groove").bpm.is_some()
    });
    let g = sample(&lib, "groove");
    assert_eq!((g.bpm, g.kind, g.key.as_deref()), (Some(120.0), crate_core::SampleKind::Loop, None));
    assert_eq!(sample(&lib, "stab").key.as_deref(), Some("Am"));
    assert_eq!(sample(&lib, "stab").kind, crate_core::SampleKind::Oneshot);
    // Le nom l'emporte sur l'audio (95 écrit, 120 joué).
    assert_eq!(sample(&lib, "Drum_Loop_Tight_95_Am").bpm, Some(95.0));
    let s = sample(&lib, "silence");
    assert_eq!((s.bpm, s.key.as_deref(), s.kind), (None, None, crate_core::SampleKind::Oneshot));
    // Les filtres voient le résultat.
    let found = |lib: &SqliteLibrary, q: &str| {
        let page = lib.tree(&TreeRequest {
            query: q.into(),
            ..req(&[])
        });
        page.matches
    };
    assert_eq!(found(&lib, "bpm:118-122"), 1);
    assert_eq!(found(&lib, "key:Am"), 2);
    assert_eq!(found(&lib, "key:A"), 2, "une note seule couvre majeur et mineur");
    assert_eq!(found(&lib, "type:loop"), 2);
    drop(lib);

    // Reprise : un fichier resté à analyser (app quittée en cours) est repris, et lui seul.
    let lib = library_at(&db);
    let analyzed_at = |lib: &SqliteLibrary, name: &str| -> Option<i64> {
        lib.connection()
            .query_row("SELECT analyzed_at FROM files WHERE name = ?", [name], |r| r.get(0))
            .unwrap()
    };
    let before = analyzed_at(&lib, "groove");
    assert!(before.is_some());
    lib.connection()
        .execute("UPDATE files SET analyzed_at = NULL, bpm = NULL WHERE name = 'stab'", [])
        .unwrap();
    drop(lib);
    let mut lib = SqliteLibrary::open(&db, Arc::new(|_| {})).unwrap();
    assert_eq!(sample(&lib, "groove").bpm, Some(120.0), "relu depuis la base, sans réanalyse");
    wait_for(&mut lib, "reprise", |l| {
        let st = l.analysis_status();
        st.total == 1 && st.done == 1
    });
    assert_eq!(analyzed_at(&lib, "groove"), before, "déjà analysé : pas refait");
    assert!(analyzed_at(&lib, "stab").is_some());
    drop(lib);

    // Nouvelle version de l'analyse : tout est refait au lancement.
    let lib = library_at(&db);
    lib.connection()
        .execute("UPDATE settings SET value = '0' WHERE key = 'analysis_version'", [])
        .unwrap();
    drop(lib);
    let mut lib = SqliteLibrary::open(&db, Arc::new(|_| {})).unwrap();
    wait_for(&mut lib, "nouvelle version", |l| {
        let st = l.analysis_status();
        st.total == 4 && st.done == 4
    });

    // Mode direct (outils) : analyze_pending fait le même travail sur place.
    drop(lib);
    let mut lib = library_at(&db);
    lib.connection().execute("UPDATE files SET analyzed_at = NULL", []).unwrap();
    assert_eq!(lib.analyze_pending(), 4);
    assert_eq!(sample(&lib, "groove").bpm, Some(120.0));
}
