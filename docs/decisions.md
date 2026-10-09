# Décisions techniques

Journal des choix pris en cours de route (format : phase · décision · raison). Les décisions de design
sont dans `docs/design-system.md` et l'historique produit dans `docs/plan.md`.

## Phase 1 — Branchement (9 oct. 2026)

| Décision | Raison |
| --- | --- |
| Workspace Cargo à la racine : `crates/crate-core` (aucune dépendance à Tauri) + `src-tauri` (commandes fines). `target/` à la racine. | Le cœur reste testable seul et réutilisable par une autre UI. |
| Trait `Backend` dans crate-core, implémenté par `MockLibrary` (phase 1) puis par l'index SQLite (phase 2). | Les commandes Tauri ne changent pas quand le stockage change. |
| Données factices **portées** en Rust (générateur mulberry32, mêmes tirages dans le même ordre) plutôt que chargées depuis un JSON. | Pas de fichier de 300 Ko embarqué ; la parité est prouvée par test. |
| Test de parité `crates/crate-core/tests/parity.rs` contre une empreinte produite par le mock TypeScript (`pnpm parity:fixture`) : 400 samples, 76 arbres (19 recherches × 4 états d'ouverture), bibliothèque, sources. | « Le prototype tourne à l'identique » devient vérifiable automatiquement. |
| Tri des noms : comparateur « naturel » explicite (`natural.rs` / `natural.ts`), qui remplace `localeCompare` dans le mock. | `localeCompare` dépend de la locale et d'ICU ; le tri doit être identique en Rust et en JS. |
| tauri-specta `=2.0.0-rc.25`, specta `=2.0.0-rc.25`, specta-typescript `0.0.12` (versions épinglées). | Seule voie typée pour Tauri 2 ; encore en release candidate, donc version figée. |
| `TreeRow` : `#[serde(untagged)]` + champ littéral `type` dans `FolderRow` / `SampleRow`, au lieu de `#[serde(tag = "type")]`. | specta rc.25 décrit mal `tag` sur des variantes newtype (forme imbriquée), alors que le JSON est à plat. |
| `peaks` déclaré `number[]` côté TypeScript (`#[specta(type = Vec<u32>)]`). | specta typait `(number \| null)[]` à cause de NaN, qui n'arrive jamais. |
| Contrat assoupli : `channels: number`, `Collection.query?: string \| null`, `FolderRow.offline?: boolean \| null`. | Formes réellement produites par serde / specta ; l'UI les gère déjà. |
| `src/api/bindings.ts` généré par `cargo test -p crate-app` et versionné ; `src/api/contract.ts` vérifie à la compilation que ces types restent compatibles avec `types.ts`. | Une divergence Rust / UI casse `pnpm build` (vérifié : un champ faussé → 5 erreurs tsc). |
| `src/api/index.ts` choisit le backend : `tauri.ts` dans la fenêtre Tauri, `mock.ts` ailleurs (prototype en ligne, Storybook). | Le design system et la démo restent utilisables sans Rust. |
| Commande `demo_set_missing` réservée au scénario « Erreurs ». | Les scénarios de démo doivent marcher à l'identique dans la fenêtre. |
| `CRATE_TRACE=1` : trace des commandes sur stderr. | Diagnostic en attendant l'overlay de mesures (phase 3). |
| `rustfmt.toml` : `max_width = 140`. | Cohérent avec la largeur de ligne du code TypeScript. |

## Collections, dossiers virtuels, « Créer un vrai dossier » (9 oct. 2026)

| Décision | Raison |
| --- | --- |
| Deux concepts distincts : **collections** (à plat, manuelles ou smart) et **dossiers virtuels** (arborescence, `parentId`). | Demande produit : une collection n'a pas de notion de sous-dossier ; un dossier virtuel, si. |
| Clés : `c:fav`, `g:collections`, `c:<id>`, `v:<id>`. `TreeRequest.root` = `library` ou `virtual`. | Un seul `tree()` pour les deux onglets ; l'UI reste sans logique d'arbre. |
| Épinglage (`setPinned`) : favoris, collections et dossiers virtuels peuvent apparaître à la racine de Bibliothèque ; masqués pendant une recherche dans Bibliothèque. | Éviter les doublons dans les résultats, comme pour les collections avant. |
| Un dossier virtuel n'affiche que son contenu propre ; `in:<nom>` couvre ses descendants. | Choix utilisateur (comme un vrai dossier) ; la recherche sert à tout voir. |
| Glisser un dossier virtuel sur un autre le déplace ; sur le fond de l'onglet, il remonte à la racine ; refusé vers soi-même ou un descendant. | Choix utilisateur (modèle du Finder). |
| `in:` cherche d'abord une collection, puis un dossier virtuel, puis un chemin. | Ordre stable et documenté ; les noms en double sont rares. |
| « Créer un vrai dossier » = **copie** vers un nouveau dossier (`planCommit` puis `commitToFolder`), options « garder l'arborescence » et « ajouter aux sources ». Simulé en phase 1 (aucun fichier écrit), progression simulée côté UI. | Seule écriture autorisée sur le disque, jamais destructive ; la copie réelle et les événements de progression arrivent en phase 5. |
| `CommitPlan.bytes` est un `f64` déclaré `number` (comme `peaks`). | specta y verrait `number \| null`. |
| Touches de scénario actives dans toutes les vues. | Bug trouvé en route : après le scénario Réglages, les touches suivantes étaient ignorées (le scénario 12 ne se lançait plus). |

## Idées reprises de Sononym (9 oct. 2026)

| Décision | Raison |
| --- | --- |
| Gardées, en version minimale : raccourcis vers des sous-dossiers, historique de navigation (maintenant) ; masquer des fichiers (phase 5), lecture aléatoire, boucle + volume, lecture depuis un point de la waveform, arrêt de la lecture au drag / à la perte de focus (phase 4), synonymes (phase 3), actualiser une source (phase 2). | Utiles au quotidien, coût faible, aucune nouvelle surface d'interface. |
| **Écartées** : correction manuelle du BPM ou de la clé, renommage à l'export, détection des doublons exacts. | Choix utilisateur : pas besoin. |
| Raccourci = nœud `p:<id>` (`kind: "shortcut"`, `target: "f:<id>"`) à la racine de Bibliothèque, après les sources ; seulement pour un sous-dossier (une source est déjà à la racine). Il ne se déplie pas : l'UI saute au vrai dossier (`ancestors(key)` puis ouverture). | Le dossier n'existe qu'une fois dans l'arbre : pas de doublons de lignes, sélection et lecture sans ambiguïté. |
| Historique : un instantané (onglet, chips, brouillon, dossiers ouverts des deux onglets, curseur) avant chaque **saut** (onglet, chip, raccourci, recherche enregistrée), 50 au plus ; ouvrir un dossier n'en est pas un. ⌥← / ⌥→ hors des champs, ⌘[ / ⌘] partout, boutons 4 / 5 de la souris. | Revenir en arrière ramène l'arbre tel qu'on l'a quitté, sans devoir défaire chaque dépliage. |
| **En attente** : taper pour sauter (taper le début d'un nom pour y aller). Codé puis retiré ; le tagging reste sur T. | Choix utilisateur : intérêt pas évident pour l'instant. À reprendre seulement si le besoin apparaît (il obligerait à déplacer le tagging sur ⌘T). |

## Phase 2 — Index + scan (9 oct. 2026)

Fichiers créés ou déplacés :

```
crates/crate-core/src/
  catalog.rs        catalogue en mémoire : arbre, recherche, commit (ex-MockLibrary, + index pour 100 000 fichiers)
  mock/             données du prototype → Catalog::demo()
  db/mod.rs         ouverture SQLite (WAL, clés étrangères, tri naturel), chargement du catalogue
  db/schema.sql     migration 1 (user_version)
  scan.rs           parcours d'un dossier, lecture rapide des en-têtes audio (symphonia), mise à jour incrémentale
  indexer.rs        thread dédié : file de scans, notify (dossiers surveillés), statut d'indexation
  library.rs        SqliteLibrary : Backend réel (catalogue en mémoire + écriture immédiate en base)
crates/crate-core/tests/
  library.rs        scan, rescan incrémental, introuvables, hors ligne, persistance, copie réelle
  bench_scan.rs     100 000 fichiers (ignoré par défaut : cargo test --release -- --ignored)
```

| Décision | Raison |
| --- | --- |
| **SQLite = stockage, mémoire = requêtes.** Au démarrage et après chaque palier de scan, la base est chargée dans le catalogue en mémoire (la logique de la phase 1, déjà prouvée identique au prototype) ; chaque modification est écrite tout de suite en base. Pas de FTS5 pour l'instant (écart au schéma « figé ») : la phase 3 mesurera la recherche en mémoire sur 100 000 fichiers et n'ajoutera FTS5 que si le budget de 16 ms n'est pas tenu. | Une seule implémentation de `tree()` et du langage de recherche au lieu de deux ; ~30 Mo pour 100 000 fichiers (sans pics). |
| Catalogue indexé : samples par dossier, par id, texte de recherche pré-calculé, `in:` résolu une fois par requête. | Sans index, l'arbre en recherche était en O(dossiers × fichiers). |
| Une source = un dossier sans parent (`folders.parent_id IS NULL`) ; ses ids sont ceux des dossiers. Seuls les dossiers qui contiennent de l'audio (à n'importe quelle profondeur) sont gardés. Fichiers et dossiers cachés ignorés, liens symboliques non suivis. | Pas de dossiers vides ou « Documentation » dans l'arbre ; pas de boucles. |
| Formats : wav, aif / aiff, flac, mp3, ogg. En-têtes lus avec symphonia (durée, fréquence, profondeur, canaux), en parallèle (rayon). Un fichier illisible n'est pas indexé. | Métadonnées rapides sans décoder l'audio. |
| Rescan incrémental : un fichier dont la taille et la date n'ont pas changé n'est pas relu. Un fichier disparu est **marqué introuvable** s'il est référencé (favori, tag, collection, dossier virtuel), **supprimé de l'index** sinon. Racine absente = source **hors ligne**, rien n'est supprimé. | Les collections gardent leurs références (scénario « Erreurs ») sans garder des fantômes inutiles. |
| `type:` provisoire d'après le nom (« loop » dedans → loop, sinon one-shot) ; BPM et tonalité vides jusqu'à la phase 6. | Le filtre reste utile dès maintenant ; l'analyse réelle arrive en phase 6. |
| `notify` sur chaque source ; un changement relance le scan incrémental de la source après 1 s de calme. « Actualiser » (menu de la source) force le même scan. | Simple et sûr ; un scan sans changement ne fait que des `stat`. |
| Statut d'indexation par événement typé (`scan-status`, tauri-specta), au plus 5 par seconde ; le catalogue est rechargé au plus une fois par seconde pendant un scan. | UI fluide, arbre qui se remplit par paliers. |
| La fenêtre utilise la vraie bibliothèque (`crate.db` dans le dossier de données de l'app). `CRATE_DEMO=1` la remet sur les données du prototype (scénarios de démo). Le navigateur et Storybook restent sur le mock TypeScript. | Les scénarios restent vérifiables dans la fenêtre. |
| « Créer un vrai dossier » copie réellement en mode réel (refus d'un dossier existant non vide, jamais d'écrasement), puis « Ajouter aux sources » indexe la copie. « Révéler dans le Finder » : `open -R`. Avancés depuis la phase 5. | Quelques lignes ; la version simulée n'avait pas de sens sur de vrais fichiers. |
| Nouvelles dépendances : rusqlite (bundled), symphonia, rayon, notify (citées dans le plan) ; **tauri-plugin-dialog** pour ⌘O (choisir un dossier). | Sélecteur de dossier natif, sans code Objective-C. |

Mesures (conteneur Linux, 4 cœurs, build release, `tests/bench_scan.rs`, 100 000 petits WAV) : scan complet 1,1 s
(90 000 fichiers/s, cache disque chaud), rescan sans changement 0,6 s, chargement du catalogue 0,19 s, dossier de 5 000
samples 40 ms, recherche 0,3–0,7 s. Fenêtre vérifiée sous écran virtuel : premier lancement, scan au lancement,
`notify` (fichier ajouté visible en ~1 s), statut d'indexation en direct pendant un scan de 40 000 fichiers.

| Décision (suite) | Raison |
| --- | --- |
| Le dernier statut de scan est gardé côté Rust (`scan_status`) et lu par l'UI au démarrage. | Le scan lancé à l'ouverture commence avant que la page n'écoute les événements. |
| Un refus (source déjà couverte, pas un dossier, copie vers un dossier non vide) remonte comme une erreur lisible, affichée en une ligne sous la recherche (ou dans la vue de copie). | Pas de boîte de dialogue ; le message disparaît seul. |

### Risques ouverts

- Chaque ligne de sample transporte ses 256 pics : à sortir du contrat (densité « waveform » seulement, ou commande `peaks(ids)`) avant la phase 3 et les 100 000 fichiers.
- tauri-specta est en RC : surveiller la sortie de la 2.0 stable et lever l'épinglage.
- Recherche à 100 000 fichiers : 0,3–0,7 s par frappe (budget 16 ms). Pistes phase 3 : résultat mémoïsé par dossier,
  pas de tri ni de clonage des samples non affichés, puis FTS5 si ça ne suffit pas.
- Le sélecteur de dossier GTK ne liste rien dans le conteneur de test (pas de gvfs) : ⌘O n'est vérifiable que sur Mac.
- Le rechargement complet du catalogue après un palier de scan coûte de l'ordre de 100 ms à 100 000 fichiers : à rendre incrémental si la phase 3 le mesure comme gênant.
- Tauri reçoit les fichiers déposés sur la fenêtre (dépôt de dossiers) : sur macOS le glisser-déposer interne (HTML5) continue de marcher, à vérifier sur Mac.
- La parité porte sur les données factices ; elle disparaît en phase 2 (données réelles), où les tests de `tree()` prendront le relais.
