//! Parité avec le prototype : la bibliothèque factice Rust doit produire exactement les mêmes données
//! que le mock TypeScript (empreinte dans tests/fixtures/prototype.json, générée par `pnpm parity:fixture`).

use crate_core::{Backend, MockLibrary, TreeRequest, TreeRow};
use serde_json::Value;

fn fixture() -> Value {
    serde_json::from_str(include_str!("fixtures/prototype.json")).expect("fixture JSON")
}

fn round(x: f64) -> f64 {
    (x * 1e9).round() / 1e9
}

#[test]
fn memes_samples() {
    let fx = fixture();
    let lib = MockLibrary::new();
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
    let lib = MockLibrary::new();
    for t in fx["trees"].as_array().unwrap() {
        let req = TreeRequest {
            query: t["query"].as_str().unwrap().into(),
            expanded: t["expanded"]
                .as_array()
                .unwrap()
                .iter()
                .map(|k| k.as_str().unwrap().to_string())
                .collect(),
            offset: 0,
            limit: 100_000,
        };
        let page = lib.tree(&req);
        let rows: Vec<String> = page
            .rows
            .iter()
            .map(|r| match r {
                TreeRow::Node(n) => format!(
                    "{}|{}|{}{}",
                    n.depth,
                    n.key,
                    if n.open { "open" } else { "closed" },
                    if n.offline == Some(true) { "|offline" } else { "" }
                ),
                TreeRow::Sample(s) => format!("{}|{}", s.depth, s.key),
            })
            .collect();
        let expected: Vec<&str> = t["rows"].as_array().unwrap().iter().map(|v| v.as_str().unwrap()).collect();
        let ctx = format!("query={:?} expanded={:?}", req.query, req.expanded);
        assert_eq!(rows, expected, "{ctx}");
        assert_eq!(page.total_rows as u64, t["totalRows"].as_u64().unwrap(), "{ctx}");
        assert_eq!(page.matches as u64, t["matches"].as_u64().unwrap(), "{ctx}");
    }
}

#[test]
fn meme_bibliotheque() {
    let fx = fixture();
    let lib = MockLibrary::new();
    assert_eq!(serde_json::to_value(lib.library()).unwrap(), fx["library"]);
    assert_eq!(serde_json::to_value(lib.sources()).unwrap(), fx["sources"]);
}

#[test]
fn pagination() {
    let lib = MockLibrary::new();
    let all = lib.tree(&TreeRequest {
        query: "kick".into(),
        expanded: vec![],
        offset: 0,
        limit: 10_000,
    });
    let page = lib.tree(&TreeRequest {
        query: "kick".into(),
        expanded: vec![],
        offset: 5,
        limit: 7,
    });
    assert_eq!(page.total_rows, all.total_rows);
    let keys = |p: &crate_core::TreePage| p.rows.iter().map(|r| r.key().to_string()).collect::<Vec<_>>();
    assert_eq!(keys(&page), keys(&all)[5..12].to_vec());
}

#[test]
fn mutations() {
    let mut lib = MockLibrary::new();
    let fav_before = lib
        .tree(&TreeRequest {
            query: "is:fav".into(),
            expanded: vec![],
            offset: 0,
            limit: 10_000,
        })
        .matches;
    lib.set_favorite(&[1], true);
    assert_eq!(
        lib.tree(&TreeRequest {
            query: "is:fav".into(),
            expanded: vec![],
            offset: 0,
            limit: 10_000
        })
        .matches,
        fav_before + 1
    );

    lib.add_tag(&[1, 2], "crispy");
    assert_eq!(lib.library().tags.iter().find(|t| t.name == "crispy").map(|t| t.count), Some(2));
    lib.remove_tag(&[1], "crispy");
    assert_eq!(lib.library().tags.iter().find(|t| t.name == "crispy").map(|t| t.count), Some(1));

    let c = lib.create_collection("Croustillants", Some("#crispy"));
    assert_eq!(c.id, 7);
    let open = TreeRequest {
        query: String::new(),
        expanded: vec!["g:collections".into(), "c:7".into()],
        offset: 0,
        limit: 10_000,
    };
    assert!(lib.tree(&open).rows.iter().any(|r| r.key() == "s:2@c:7"));
    lib.rename_collection(7, "Crispy");
    assert_eq!(lib.library().collections.last().unwrap().name, "Crispy");

    let m = lib.create_collection("Nouvelle", None);
    lib.add_to_collection(m.id, &[3, 3, 4]);
    let open = TreeRequest {
        query: String::new(),
        expanded: vec!["g:collections".into(), format!("c:{}", m.id)],
        offset: 0,
        limit: 10_000,
    };
    assert_eq!(
        lib.tree(&open)
            .rows
            .iter()
            .filter(|r| r.key().ends_with(&format!("@c:{}", m.id)))
            .count(),
        2
    );
    lib.delete_collection(m.id);
    assert!(!lib.library().collections.iter().any(|c| c.id == m.id));

    lib.remove_source(20);
    assert_eq!(lib.sources().len(), 2);
}
