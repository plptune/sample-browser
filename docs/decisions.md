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

### Risques ouverts

- Chaque ligne de sample transporte ses 256 pics : à sortir du contrat (densité « waveform » seulement, ou commande `peaks(ids)`) avant la phase 3 et les 100 000 fichiers.
- tauri-specta est en RC : surveiller la sortie de la 2.0 stable et lever l'épinglage.
- La parité porte sur les données factices ; elle disparaît en phase 2 (données réelles), où les tests de `tree()` prendront le relais.
