//! Parité avec le prototype : la bibliothèque factice Rust doit produire exactement les mêmes données
//! que le mock TypeScript (empreinte dans tests/fixtures/prototype.json, générée par `pnpm parity:fixture`).

use crate_core::{Backend, CommitOptions, MockLibrary, TreePage, TreeRequest, TreeRoot, TreeRow};
use serde_json::Value;

fn fixture() -> Value {
    serde_json::from_str(include_str!("fixtures/prototype.json")).expect("fixture JSON")
}

fn rows_of(page: &TreePage) -> Vec<String> {
    page.rows
        .iter()
        .map(|r| match r {
            TreeRow::Node(n) => format!(
                "{}|{}|{}{}{}{}",
                n.depth,
                n.key,
                if n.open { "open" } else { "closed" },
                if n.offline == Some(true) { "|offline" } else { "" },
                if n.pinned == Some(true) { "|pinned" } else { "" },
                n.target.as_ref().map(|t| format!("|->{t}")).unwrap_or_default() + if n.hidden == Some(true) { "|hidden" } else { "" }
            ),
            TreeRow::Sample(s) => format!("{}|{}", s.depth, s.key),
        })
        .collect()
}

fn strings(v: &Value) -> Vec<String> {
    v.as_array().unwrap().iter().map(|x| x.as_str().unwrap().to_string()).collect()
}

fn req(root: TreeRoot, query: &str, expanded: Vec<String>) -> TreeRequest {
    TreeRequest {
        root,
        query: query.into(),
        expanded,
        offset: 0,
        limit: 100_000,
        ..Default::default()
    }
}

fn round(x: f64) -> f64 {
    (x * 1e9).round() / 1e9
}

#[test]
fn memes_samples() {
    let fx = fixture();
    let lib = MockLibrary::demo();
    let expected = fx["samples"].as_array().unwrap();
    assert_eq!(lib.samples().len(), expected.len());
    for (s, e) in lib.samples().iter().zip(expected) {
        let ctx = format!("sample {}", s.id);
        assert_eq!(s.id as u64, e["id"].as_u64().unwrap(), "{ctx}");
        assert_eq!(s.name, e["name"], "{ctx}");
        assert_eq!(s.ext, e["ext"], "{ctx}");
        assert_eq!(s.path, e["path"], "{ctx}");
        assert_eq!(s.folder_id as u64, e["folderId"].as_u64().unwrap(), "{ctx}");
        assert_eq!(s.duration_ms as u64, e["durationMs"].as_u64().unwrap(), "{ctx}");
        assert_eq!(s.sample_rate as u64, e["sampleRate"].as_u64().unwrap(), "{ctx}");
        assert_eq!(s.bit_depth as u64, e["bitDepth"].as_u64().unwrap(), "{ctx}");
        assert_eq!(s.channels as u64, e["channels"].as_u64().unwrap(), "{ctx}");
        assert_eq!(s.bpm, e["bpm"].as_f64(), "{ctx}");
        assert_eq!(s.key.as_deref(), e["key"].as_str(), "{ctx}");
        assert_eq!(serde_json::to_value(s.kind).unwrap(), e["kind"], "{ctx}");
        assert_eq!(serde_json::to_value(&s.tags).unwrap(), e["tags"], "{ctx}");
        assert_eq!(s.fav, e["fav"].as_bool().unwrap(), "{ctx}");
        // Les fonctions exp / pow / sin peuvent différer au dernier bit entre moteurs : tolérance de 1e-9.
        let sum: f64 = s.peaks.iter().sum();
        assert!((round(sum) - e["peaksSum"].as_f64().unwrap()).abs() < 1e-6, "{ctx} peaks");
        assert!(
            (round(s.peaks[0]) - e["peaksFirst"].as_f64().unwrap()).abs() < 1e-9,
            "{ctx} peaks[0]"
        );
        assert!(
            (round(s.peaks[255]) - e["peaksLast"].as_f64().unwrap()).abs() < 1e-9,
            "{ctx} peaks[255]"
        );
    }
}

#[test]
fn memes_arbres() {
    let fx = fixture();
    let lib = MockLibrary::demo();
    for t in fx["trees"].as_array().unwrap() {
        let root: TreeRoot = serde_json::from_value(t["root"].clone()).unwrap();
        let r = req(root, t["query"].as_str().unwrap(), strings(&t["expanded"]));
        let page = lib.tree(&r);
        let ctx = format!("root={root:?} query={:?} expanded={:?}", r.query, r.expanded);
        assert_eq!(rows_of(&page), strings(&t["rows"]), "{ctx}");
        assert_eq!(page.total_rows as u64, t["totalRows"].as_u64().unwrap(), "{ctx}");
        assert_eq!(page.matches as u64, t["matches"].as_u64().unwrap(), "{ctx}");
    }
}

#[test]
fn memes_plans_de_commit() {
    let fx = fixture();
    let lib = MockLibrary::demo();
    for p in fx["plans"].as_array().unwrap() {
        let key = p["key"].as_str().unwrap();
        let opts = CommitOptions {
            keep_hierarchy: p["keepHierarchy"].as_bool().unwrap(),
            add_as_source: false,
        };
        let plan = lib.plan_commit(key, opts);
        let e = &p["plan"];
        let ctx = format!("plan {key} {opts:?}");
        assert_eq!(plan.files as u64, e["files"].as_u64().unwrap(), "{ctx}");
        assert_eq!(plan.folders as u64, e["folders"].as_u64().unwrap(), "{ctx}");
        assert_eq!(plan.missing as u64, e["missing"].as_u64().unwrap(), "{ctx}");
        assert_eq!(plan.bytes, e["bytes"].as_f64().unwrap(), "{ctx}");
    }
}

#[test]
fn meme_commit_ajoute_aux_sources() {
    let fx = fixture();
    let after = &fx["after"];
    let mut lib = MockLibrary::demo();
    let res = lib
        .commit_to_folder(
            "v:3",
            "~/Desktop/Pack 2026/",
            CommitOptions {
                keep_hierarchy: true,
                add_as_source: true,
            },
        )
        .unwrap();
    assert_eq!(serde_json::to_value(&res).unwrap(), after["commit"]);
    assert_eq!(serde_json::to_value(lib.sources()).unwrap(), after["sources"]);
    let tree = lib.tree(&req(TreeRoot::Library, "", vec!["f:1000".into(), "f:1001".into(), "f:1002".into()]));
    assert_eq!(rows_of(&tree), strings(&after["tree"]["rows"]));
    assert_eq!(tree.matches as u64, after["tree"]["matches"].as_u64().unwrap());
    let paths: Vec<String> = tree
        .rows
        .iter()
        .filter_map(|r| {
            if let TreeRow::Sample(s) = r {
                Some(s.sample.path.clone())
            } else {
                None
            }
        })
        .collect();
    assert_eq!(paths, strings(&after["paths"]));
    let search = lib.tree(&req(TreeRoot::Library, "riser", vec![]));
    assert_eq!(rows_of(&search), strings(&after["search"]["rows"]));
}

#[test]
fn meme_bibliotheque() {
    let fx = fixture();
    let lib = MockLibrary::demo();
    assert_eq!(serde_json::to_value(lib.library()).unwrap(), fx["library"]);
    assert_eq!(serde_json::to_value(lib.sources()).unwrap(), fx["sources"]);
}

#[test]
fn memes_parents() {
    let fx = fixture();
    let lib = MockLibrary::demo();
    for (key, want) in fx["ancestors"].as_object().unwrap() {
        assert_eq!(lib.ancestors(key), strings(want), "ancestors({key})");
    }
}

#[test]
fn meme_masquage() {
    let fx = fixture();
    let h = &fx["hidden"];
    let mut lib = MockLibrary::demo();
    lib.set_hidden(&[1, 2, 3, 5, 11], true);
    lib.set_folder_hidden(12, true);
    assert_eq!(lib.library().hidden as u64, h["library"].as_u64().unwrap());
    let expanded: Vec<String> = ["f:10", "f:11", "f:12", "f:13", "c:fav", "c:1"].map(String::from).to_vec();
    for t in h["trees"].as_array().unwrap() {
        let q = t["query"].as_str().unwrap();
        let page = lib.tree(&req(TreeRoot::Library, q, expanded.clone()));
        assert_eq!(rows_of(&page), strings(&t["rows"]), "masquage, {q:?}");
        assert_eq!(page.matches as u64, t["matches"].as_u64().unwrap(), "masquage, {q:?}");
    }
    lib.set_hidden(&[1, 2, 3, 5, 11], false);
    lib.set_folder_hidden(12, false);
    assert_eq!(lib.library().hidden, 0);
}

#[test]
fn memes_positions_focus() {
    let fx = fixture();
    let lib = MockLibrary::demo();
    for f in fx["focus"].as_array().unwrap() {
        let page = lib.tree(&TreeRequest {
            focus: Some(f["focus"].as_str().unwrap().into()),
            limit: 0,
            ..req(TreeRoot::Library, f["query"].as_str().unwrap(), strings(&f["expanded"]))
        });
        assert!(page.rows.is_empty());
        assert_eq!(serde_json::to_value(page.focus_index).unwrap(), f["focusIndex"], "{f}");
    }
}

#[test]
fn memes_appartenances() {
    let fx = fixture();
    let lib = MockLibrary::demo();
    let want = fx["memberships"].as_object().unwrap();
    assert!(!want.is_empty());
    for s in lib.samples() {
        let got = lib.memberships(s.id);
        match want.get(&s.id.to_string()) {
            Some(w) => assert_eq!(got, strings(w), "memberships({})", s.id),
            None => assert!(got.is_empty(), "memberships({}) : {got:?}", s.id),
        }
    }
}

#[test]
fn memes_chemins_de_dossiers() {
    let fx = fixture();
    let lib = MockLibrary::demo();
    for (key, want) in fx["nodePaths"].as_object().unwrap() {
        assert_eq!(serde_json::to_value(lib.node_path(key)).unwrap(), *want, "node_path({key})");
    }
}

#[test]
fn memes_raccourcis() {
    let fx = fixture();
    let mut lib = MockLibrary::demo();
    let check = |lib: &MockLibrary, want: &Value| {
        assert_eq!(serde_json::to_value(lib.library().pinned_folders).unwrap(), want["pinned"]);
        assert_eq!(rows_of(&lib.tree(&req(TreeRoot::Library, "", vec![]))), strings(&want["rows"]));
    };
    let pins = fx["pins"].as_array().unwrap();
    lib.set_pinned("f:18", true);
    lib.set_pinned("f:10", true); // une source : refusé
    check(&lib, &pins[0]);
    lib.set_pinned("f:3", false);
    check(&lib, &pins[1]);
    lib.set_pinned("f:18", false);
    lib.set_pinned("f:3", true);
    check(&lib, &pins[2]);
}

#[test]
fn pagination() {
    let lib = MockLibrary::demo();
    let all = lib.tree(&req(TreeRoot::Library, "kick", vec![]));
    let page = lib.tree(&TreeRequest {
        offset: 5,
        limit: 7,
        ..req(TreeRoot::Library, "kick", vec![])
    });
    assert_eq!(page.total_rows, all.total_rows);
    let keys = |p: &TreePage| p.rows.iter().map(|r| r.key().to_string()).collect::<Vec<_>>();
    assert_eq!(keys(&page), keys(&all)[5..12].to_vec());
}

#[test]
fn collections_a_plat() {
    let mut lib = MockLibrary::demo();
    lib.add_tag(&[1, 2], "crispy");
    assert_eq!(lib.library().tags.iter().find(|t| t.name == "crispy").map(|t| t.count), Some(2));
    lib.remove_tag(&[1], "crispy");
    assert_eq!(lib.library().tags.iter().find(|t| t.name == "crispy").map(|t| t.count), Some(1));

    let smart = lib.create_collection("Croustillants", Some("#crispy"));
    assert_eq!(smart.id, 5);
    let open = req(TreeRoot::Virtual, "", vec!["g:collections".into(), "c:5".into()]);
    assert!(lib.tree(&open).rows.iter().any(|r| r.key() == "s:2@c:5"));
    lib.add_to_collection(5, &[3]); // smart : refusé
    assert!(!lib.tree(&open).rows.iter().any(|r| r.key() == "s:3@c:5"));

    let m = lib.create_collection("Nouvelle", None);
    lib.add_to_collection(m.id, &[3, 3, 4]);
    let open = req(TreeRoot::Virtual, "", vec!["g:collections".into(), format!("c:{}", m.id)]);
    assert_eq!(
        lib.tree(&open)
            .rows
            .iter()
            .filter(|r| r.key().ends_with(&format!("@c:{}", m.id)))
            .count(),
        2
    );
    lib.remove_from_collection(m.id, &[3]);
    assert_eq!(
        lib.tree(&open)
            .rows
            .iter()
            .filter(|r| r.key().ends_with(&format!("@c:{}", m.id)))
            .count(),
        1
    );
    lib.rename_collection(m.id, "Renommée");
    assert_eq!(lib.library().collections.last().unwrap().name, "Renommée");
    lib.delete_collection(m.id);
    assert!(!lib.library().collections.iter().any(|c| c.id == m.id));
}

#[test]
fn dossiers_virtuels() {
    let mut lib = MockLibrary::demo();
    let a = lib.create_virtual_folder("Cette année", None);
    let b = lib.create_virtual_folder("Mars", Some(a.id));
    assert_eq!(b.parent_id, Some(a.id));
    // Déplacer « Projets » (1) dans « Mars » ; puis refuser « Cette année » dans son descendant « Mars ».
    lib.move_virtual_folder(1, Some(b.id));
    lib.move_virtual_folder(a.id, Some(b.id));
    let vfs = lib.library().virtual_folders;
    assert_eq!(vfs.iter().find(|f| f.id == 1).unwrap().parent_id, Some(b.id));
    assert_eq!(vfs.iter().find(|f| f.id == a.id).unwrap().parent_id, None);

    lib.add_to_virtual_folder(b.id, &[10, 11]);
    lib.remove_from_virtual_folder(b.id, &[10]);
    let open = req(TreeRoot::Virtual, "", vec![format!("v:{}", a.id), format!("v:{}", b.id)]);
    let keys: Vec<String> = lib.tree(&open).rows.iter().map(|r| r.key().to_string()).collect();
    assert!(keys.contains(&format!("s:11@v:{}", b.id)) && !keys.contains(&format!("s:10@v:{}", b.id)));
    // `in:` couvre les sous-dossiers.
    assert!(lib.tree(&req(TreeRoot::Library, "in:cette", vec![])).matches >= 1);

    lib.set_pinned(&format!("v:{}", a.id), true);
    assert!(lib
        .tree(&req(TreeRoot::Library, "", vec![]))
        .rows
        .iter()
        .any(|r| r.key() == format!("v:{}", a.id)));
    lib.set_pinned("c:fav", false);
    assert!(!lib
        .tree(&req(TreeRoot::Library, "", vec![]))
        .rows
        .iter()
        .any(|r| r.key() == "c:fav"));

    // Supprimer « Cette année » emporte « Mars » et « Projets » (et « Night Drive »), jamais les fichiers.
    lib.delete_virtual_folder(a.id);
    let ids: Vec<u32> = lib.library().virtual_folders.iter().map(|f| f.id).collect();
    assert_eq!(ids, vec![3, 4, 5]);
    assert_eq!(lib.library().total, 407);

    lib.remove_source(20);
    assert_eq!(lib.sources().len(), 2);
}

#[test]
fn favoris() {
    let mut lib = MockLibrary::demo();
    let before = lib.tree(&req(TreeRoot::Library, "is:fav", vec![])).matches;
    lib.set_favorite(&[1], true);
    assert_eq!(lib.tree(&req(TreeRoot::Library, "is:fav", vec![])).matches, before + 1);
}
