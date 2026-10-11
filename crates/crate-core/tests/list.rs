//! Liste à plat du mode grand (portée, recherche, tri) et explorer de dossiers seuls, sur la bibliothèque factice.

use std::collections::HashSet;

use crate_core::{Backend, ListRequest, ListSort, MockLibrary, SampleId, SortColumn, TreePage, TreeRequest, TreeRoot, TreeRow};

fn list(lib: &MockLibrary, scope: Option<&str>, query: &str, column: SortColumn, desc: bool) -> TreePage {
    lib.list(&ListRequest {
        scope: scope.map(String::from),
        query: query.into(),
        sort: ListSort { column, desc },
        offset: 0,
        limit: 100_000,
        focus: None,
    })
}

fn samples(page: &TreePage) -> Vec<(SampleId, String)> {
    page.rows
        .iter()
        .map(|r| match r {
            TreeRow::Sample(s) => (s.sample.id, s.parent.clone()),
            TreeRow::Node(n) => panic!("dossier dans la liste : {}", n.key),
        })
        .collect()
}

/// Ids des samples d'un nœud, ouvert avec toute sa sous-arborescence dans l'arbre (dossiers aplatis).
fn subtree_ids(lib: &MockLibrary, root: TreeRoot, key: &str) -> HashSet<SampleId> {
    let page = lib.tree(&TreeRequest {
        root,
        query: String::new(),
        expanded: vec![],
        offset: 0,
        limit: 100_000,
        flattened: vec![key.into()],
        ..Default::default()
    });
    page.rows
        .iter()
        .filter_map(|r| match r {
            TreeRow::Sample(s) if s.parent == key => Some(s.sample.id),
            _ => None,
        })
        .collect()
}

#[test]
fn portee_dossier_toute_la_sous_arborescence() {
    let lib = MockLibrary::demo();
    let page = list(&lib, Some("f:10"), "", SortColumn::Name, false);
    let rows = samples(&page);
    let ids: HashSet<SampleId> = rows.iter().map(|r| r.0).collect();
    assert_eq!(ids.len(), rows.len(), "chaque sample une fois");
    assert_eq!(ids, subtree_ids(&lib, TreeRoot::Library, "f:10"));
    assert!(rows.iter().all(|(_, p)| p.starts_with("f:")));
    // Un sous-dossier est inclus avec son vrai parent.
    assert!(rows.iter().any(|(_, p)| p == "f:12"));
    // Un raccourci vaut son dossier.
    let p3 = samples(&list(&lib, Some("p:3"), "", SortColumn::Name, false));
    assert_eq!(p3, samples(&list(&lib, Some("f:3"), "", SortColumn::Name, false)));
}

#[test]
fn portee_virtuelle_garde_le_dossier_d_origine() {
    let lib = MockLibrary::demo();
    let rows = samples(&list(&lib, Some("v:3"), "", SortColumn::Name, false));
    let ids: HashSet<SampleId> = rows.iter().map(|r| r.0).collect();
    assert_eq!(ids, subtree_ids(&lib, TreeRoot::Virtual, "v:3"));
    // Des samples rangés dans un sous-dossier virtuel gardent ce sous-dossier comme parent (⌘⌫ les en retire).
    assert!(rows.iter().any(|(_, p)| p != "v:3" && p.starts_with("v:")));
}

#[test]
fn portees_favoris_collections_et_tout() {
    let lib = MockLibrary::demo();
    let fav = samples(&list(&lib, Some("c:fav"), "", SortColumn::Name, false));
    assert!(!fav.is_empty() && fav.iter().all(|(_, p)| p == "c:fav"));
    let all = list(&lib, None, "", SortColumn::Name, false);
    assert_eq!(all.total_rows as usize, lib.samples().len());
    let group = samples(&list(&lib, Some("g:collections"), "", SortColumn::Name, false));
    assert!(group.iter().all(|(_, p)| p.starts_with("c:") && p != "c:fav"));
    assert_eq!(list(&lib, Some("f:999"), "", SortColumn::Name, false).total_rows, 0);
}

#[test]
fn recherche_dans_la_portee() {
    let lib = MockLibrary::demo();
    let scoped = samples(&list(&lib, Some("f:10"), "kick", SortColumn::Name, false));
    let everywhere: HashSet<SampleId> = samples(&list(&lib, None, "kick", SortColumn::Name, false))
        .into_iter()
        .map(|r| r.0)
        .collect();
    let folder: HashSet<SampleId> = subtree_ids(&lib, TreeRoot::Library, "f:10");
    assert!(!scoped.is_empty());
    for (id, _) in &scoped {
        assert!(everywhere.contains(id) && folder.contains(id));
    }
}

#[test]
fn masques_absents_sauf_is_hidden() {
    let mut lib = MockLibrary::demo();
    lib.set_hidden(&[1, 2], true);
    let ids = |p: &TreePage| samples(p).into_iter().map(|r| r.0).collect::<HashSet<_>>();
    assert!(!ids(&list(&lib, None, "", SortColumn::Name, false)).contains(&1));
    let shown = ids(&list(&lib, None, "is:hidden", SortColumn::Name, false));
    assert!(shown.contains(&1) && shown.contains(&2));
}

#[test]
fn tri_bpm_valeurs_absentes_a_la_fin() {
    let lib = MockLibrary::demo();
    let bpm = |id: SampleId| lib.samples().iter().find(|s| s.id == id).unwrap().bpm;
    for desc in [false, true] {
        let rows = samples(&list(&lib, None, "", SortColumn::Bpm, desc));
        let v: Vec<Option<f64>> = rows.iter().map(|r| bpm(r.0)).collect();
        let first_none = v.iter().position(Option::is_none).expect("des samples sans BPM");
        assert!(v[first_none..].iter().all(Option::is_none), "absents à la fin ({desc})");
        let some: Vec<f64> = v[..first_none].iter().map(|x| x.unwrap()).collect();
        assert!(
            some.windows(2).all(|w| if desc { w[0] >= w[1] } else { w[0] <= w[1] }),
            "ordre ({desc})"
        );
    }
}

#[test]
fn tri_par_nom_inverse() {
    let lib = MockLibrary::demo();
    let asc = samples(&list(&lib, Some("f:1"), "", SortColumn::Name, false));
    let mut desc = samples(&list(&lib, Some("f:1"), "", SortColumn::Name, true));
    desc.reverse();
    assert_eq!(asc, desc);
}

#[test]
fn position_d_un_sample_par_id() {
    let lib = MockLibrary::demo();
    let all = samples(&list(&lib, None, "", SortColumn::Duration, false));
    let (id, parent) = all[123].clone();
    for focus in [format!("s:{id}"), format!("s:{id}@{parent}")] {
        let page = lib.list(&ListRequest {
            sort: ListSort {
                column: SortColumn::Duration,
                desc: false,
            },
            limit: 0,
            focus: Some(focus),
            ..Default::default()
        });
        assert_eq!(page.focus_index, Some(123));
    }
}

#[test]
fn pages_et_caches_independants() {
    let lib = MockLibrary::demo();
    let whole = samples(&list(&lib, Some("f:1"), "", SortColumn::Key, false));
    let tree_req = TreeRequest {
        root: TreeRoot::Library,
        expanded: vec!["f:1".into()],
        limit: 50,
        ..Default::default()
    };
    let tree_before = lib.tree(&tree_req);
    // Liste et arbre demandés en alternance, page par page : mêmes résultats.
    let mut paged = vec![];
    for offset in (0..whole.len()).step_by(37) {
        let page = lib.list(&ListRequest {
            scope: Some("f:1".into()),
            sort: ListSort {
                column: SortColumn::Key,
                desc: false,
            },
            offset: offset as u32,
            limit: 37,
            ..Default::default()
        });
        paged.extend(samples(&page));
        assert_eq!(lib.tree(&tree_req).rows, tree_before.rows);
    }
    assert_eq!(paged, whole);
}

#[test]
fn explorer_dossiers_seuls() {
    let lib = MockLibrary::demo();
    let page = lib.tree(&TreeRequest {
        root: TreeRoot::Library,
        expanded: vec!["f:10".into(), "f:11".into()],
        limit: 100_000,
        folders_only: true,
        ..Default::default()
    });
    let nodes: Vec<_> = page
        .rows
        .iter()
        .map(|r| match r {
            TreeRow::Node(n) => n,
            TreeRow::Sample(s) => panic!("sample dans l'explorer : {}", s.key),
        })
        .collect();
    let f10 = nodes.iter().find(|n| n.key == "f:10").unwrap();
    assert!(f10.open && f10.leaf.is_none());
    // Une feuille n'est jamais ouverte, même demandée.
    let leaf = nodes.iter().find(|n| n.leaf == Some(true)).expect("au moins une feuille");
    assert!(!leaf.open);
}
