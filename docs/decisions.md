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
| Gardées, en version minimale : raccourcis vers des sous-dossiers, historique de navigation, taper pour sauter (maintenant) ; masquer des fichiers (phase 5), lecture aléatoire, boucle + volume, lecture depuis un point de la waveform, arrêt de la lecture au drag / à la perte de focus (phase 4), synonymes (phase 3), actualiser une source (phase 2). | Utiles au quotidien, coût faible, aucune nouvelle surface d'interface. |
| **Écartées** : correction manuelle du BPM ou de la clé, renommage à l'export, détection des doublons exacts. | Choix utilisateur : pas besoin. |
| Raccourci = nœud `p:<id>` (`kind: "shortcut"`, `target: "f:<id>"`) à la racine de Bibliothèque, après les sources ; seulement pour un sous-dossier (une source est déjà à la racine). Il ne se déplie pas : l'UI saute au vrai dossier (`ancestors(key)` puis ouverture). | Le dossier n'existe qu'une fois dans l'arbre : pas de doublons de lignes, sélection et lecture sans ambiguïté. |
| Historique : un instantané (onglet, chips, brouillon, dossiers ouverts des deux onglets, curseur) avant chaque **saut** (onglet, chip, raccourci, recherche enregistrée), 50 au plus ; ouvrir un dossier n'en est pas un. ⌥← / ⌥→ hors des champs, ⌘[ / ⌘] partout, boutons 4 / 5 de la souris. | Revenir en arrière ramène l'arbre tel qu'on l'a quitté, sans devoir défaire chaque dépliage. |
| Taper pour sauter : lettres, chiffres et ponctuation quand le focus n'est pas dans un champ ; saisie remise à zéro après 800 ms ; « kk » passe au k suivant ; Espace reste la lecture. Le tagging passe de T à **⌘T**. | T entrait en conflit avec la saisie. |
| Les touches de scénario de la démo restent actives, sauf au milieu d'une saisie (les chiffres complètent alors la saisie). | Démo et tests inchangés. |

### Risques ouverts

- Chaque ligne de sample transporte ses 256 pics : à sortir du contrat (densité « waveform » seulement, ou commande `peaks(ids)`) avant la phase 3 et les 100 000 fichiers.
- tauri-specta est en RC : surveiller la sortie de la 2.0 stable et lever l'épinglage.
- La parité porte sur les données factices ; elle disparaît en phase 2 (données réelles), où les tests de `tree()` prendront le relais.
