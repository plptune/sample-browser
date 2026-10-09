# Sample Browser Mac — Plan & Prompt (v2)

Oct 9, 2026 · @Quentin · remplace la v1 du 8 octobre

Ce qui change par rapport à la v1, en bref :

- **Phase 0 terminée** : prototype complet, design system dans Storybook, fenêtre Tauri vide, checklist de validation.
- **Une seule vue** : l'arborescence des sources s'ouvre directement sur les samples. Plus de sidebar à sections, plus de liste à plat.
- **Le tiroir du bas ne montre que le sample courant** : ▶, nom, temps, étoile favori, waveform.
- **Favoris discrets** : jamais d'étoile dans l'arbre ; dossier « Favoris », ⌘D, étoile grise dans le tiroir.
- **La recherche élague l'arbre** au lieu d'ouvrir une liste de résultats.
- **Le contrat UI ↔ Rust existe déjà** (`src/api/types.ts`) : la phase 1 l'implémente, elle ne l'invente pas.

## Vision & principes

Un navigateur de samples pour Mac (cœur Rust, UI web via Tauri), pensé pour vivre dans une colonne étroite (~1/5 d'écran, 260–520 px) à côté du DAW, comme le browser d'Ableton. Trois promesses seulement : **indexer vite, trouver instantanément, ranger sans déplacer les fichiers**.

- **Une seule barre de recherche** qui fait tout (texte, tags, filtres). Pas de panneaux de filtres.
- **Une seule vue** : l'arbre des dossiers sources, qui s'ouvre sur les samples. Les collections sont un dossier virtuel en bas de l'arbre. Les réglages remplacent l'arbre dans la même colonne. Aucune fenêtre secondaire.
- **Clavier d'abord** : ⌘F, flèches façon Finder (→ ouvre / entre / lit, ← ferme / remonte), espace, T pour taguer, ⌘D favori, ⌘S enregistrer une recherche.
- **Zéro attente perçue** : chaque frappe met à jour l'arbre en moins de 16 ms ; aucune action ne bloque l'UI.
- **Non destructif** : rien n'est jamais écrit dans les dossiers de l'utilisateur ; tout vit dans une base locale.
- **Minimalisme** : gris + un seul accent (ambre, réservé à la lecture, à la progression, au focus et aux cibles de dépôt). Pas de compteurs, pas d'extension de fichier, pas d'icône de dossier ou de fichier.

## Scope MVP

| Feature | MVP | Notes |
| --- | --- | --- |
| Ajout de dossiers sources (drag & drop dans l'app, ⌘O) | Oui | Scan en arrière-plan, l'app reste utilisable |
| Arbre unique sources → dossiers → samples | Oui | Dossiers puis samples à chaque niveau, même retrait |
| Recherche unifiée (texte + `#tag` + filtres) | Oui | Élague l'arbre aux dossiers qui ont des résultats, tous ouverts |
| Tags (popover T sur la sélection, création à la volée) | Oui | Stockés en base, jamais dans les fichiers |
| Collections manuelles et smart | Oui | Smart = recherche sauvegardée (⌘S). Ajout par drag & drop ou menu contextuel |
| Favoris | Oui | Collection système « Favoris » ; ⌘D ; étoile grise dans le tiroir uniquement ; `is:fav` |
| Preview audio instantanée + waveform | Oui | Espace / →, auto-play optionnel (réglage) |
| Drag & drop vers le DAW / Finder | Oui | Simple file URL, multi-fichiers |
| Analyse BPM / tonalité / durée | Oui | En tâche de fond, priorité basse |
| Menu contextuel | Oui | Lire, taguer, favori, ajouter à une collection, renommer / supprimer une collection, retirer une source, révéler dans le Finder |
| Réglages dans la colonne | Oui | Sources, thème (sombre / clair / système), densité, toujours au premier plan, lecture auto |
| Similarity search (ML) | Non, v2 | Vecteur de features par fichier |
| Classification auto (kick, snare…) | Non, v2 | Commencer par des règles sur le nom |
| Sous-menu « Ajouter à » | Non, v2 | En MVP : liste à plat des collections manuelles dans le menu |
| Édition audio, slicing, enregistrement live | Non | Hors scope |
| Windows / Linux | Non | Mac uniquement (le prototype compile sous Linux pour les tests) |

## Stack

| Couche | Choix | Pourquoi |
| --- | --- | --- |
| Coquille d'app | Tauri 2 (WKWebView sur Mac) | App de quelques Mo |
| UI | SolidJS + TypeScript + Vite, CSS pur avec les tokens `--cr-*` | Runtime minuscule, pas de virtual DOM coûteux |
| Design system | `src/styles/tokens.css` + `bundle.css`, documenté dans **Storybook 10** (`storybook-solidjs-vite`) | Une story par composant et par état, publiée sur GitHub Pages |
| Arbre | Lignes à plat calculées par Rust (`tree()`), hauteur fixe ; **TanStack Virtual** dès la phase 3 | Seules les lignes visibles existent dans le DOM |
| Waveform | `<canvas>` 2D, pics précalculés envoyés par Rust | Rendu instantané |
| Base / index | SQLite via `rusqlite` (`bundled`, FTS5), mode WAL | Recherche texte embarquée |
| Décodage audio | `symphonia` | WAV, AIFF, FLAC, MP3 en Rust pur |
| Lecture audio | `cpal` (CoreAudio), côté Rust | L'UI envoie play / stop / seek |
| Pics, BPM, tonalité | `rustfft` + DSP maison | Pas de dépendance lourde |
| Watch fichiers | `notify` (FSEvents) | Mises à jour incrémentales |
| Drag vers le DAW | plugin `drag` de CrabNebula | Le drag de fichiers natif n'existe pas dans une webview |
| Concurrence | `tokio` + `rayon` pour l'analyse | Scan et analyse hors du thread UI |
| Contrat UI ↔ Rust | Commandes Tauri typées via `tauri-specta` | Types TS générés, comparés au contrat existant |
| CI | GitHub Actions : Pages (prototype + Storybook) et build macOS de `Crate.app` | Chaque push est vérifiable sur Mac |

## Architecture

```
UI SolidJS ──► src/api/index.ts (interface Backend)
                 ├─ mock.ts   : données factices (navigateur, Storybook)
                 └─ tauri.ts  : invoke() + événements  ──► src-tauri (commandes fines)
                                                             └─► crates/crate-core (index, recherche, arbre, audio, analyse)
                                                                    └─► SQLite (app data)
```

L'UI n'affiche que ce que le backend lui renvoie : **aucun tri, aucun filtre, aucun calcul d'arbre côté JavaScript**. La base est le centre : arbre, recherche, tags, collections et favoris ne sont que des requêtes dessus.

## Interface (validée en phase 0)

- **Panneau** : barre titre overlay (72 px réservés aux feux macOS) → recherche (30 px) → statut d'indexation (si scan) → arbre → tiroir.
- **Arbre** : racine = sources, puis « Collections » (Favoris en premier, puis collections manuelles et smart). Un dossier ouvert liste ses sous-dossiers puis ses samples au même retrait. Samples : nom sans extension, BPM et clé à droite (BPM masqué sous 280 px), mini-waveform en densité « Waveform » (36 px).
- **Grille** : icônes (chevron, ▶, !, coche) à 8 px, libellés à 24 px, +16 px par niveau d'arbre.
- **Recherche** : chips pour les tokens reconnus ; les tokens en cours de frappe (`#ta`) ne filtrent pas ; une recherche masque les collections (sinon doublons) et ouvre tous les dossiers qui ont des résultats.
- **Tiroir** : ▶ / ■, nom, temps / durée, étoile favori grise, waveform. Rien d'autre (ni tags ni méta).
- **Surcouches** (une seule à la fois, Échap ferme) : autocomplétion, popover de tags, enregistrement ⌘S, menu contextuel.
- **Réglages** (⌘,) : remplacent l'arbre ; ‹ ou Échap pour revenir.

### Clavier

| Touche | Action |
| --- | --- |
| ⌘F, `/` | Recherche |
| ↑ ↓ (⇧ pour étendre) | Naviguer |
| → | Ouvrir un dossier, y entrer, lire un sample |
| ← | Fermer un dossier, sinon remonter au parent |
| Espace | Lecture / stop |
| ⏎ | Ouvrir / fermer un dossier, lire un sample |
| T | Taguer la sélection |
| ⌘D | Favori |
| ⌘S | Recherche → collection smart |
| ⌘, | Réglages |
| Échap | Fermer la surcouche, sinon quitter les réglages, sinon stop |

## Langage de recherche

Une seule ligne, tokens séparés par des espaces, AND par défaut. Le parser Rust produit une requête SQL paramétrée (jamais de concaténation) et renvoie les tokens reconnus pour les chips.

| Syntaxe | Exemple | Effet |
| --- | --- | --- |
| mot libre | `kick dark` | FTS5 préfixe sur nom + chemin + tags |
| `"…"` | `"vinyl crackle"` | Phrase exacte |
| `#tag` | `#warm` | A ce tag |
| `-` devant | `-loop`, `-#bright` | Exclusion |
| `bpm:` | `bpm:120-128`, `bpm:>140` | Plage ou comparaison |
| `key:` | `key:Am`, `key:C` | Tonalité (note seule = majeur + mineur) |
| `dur:` | `dur:<2s`, `dur:1-4s` | Durée |
| `in:` | `in:Drums` | Collection ou dossier source |
| `type:` | `type:loop`, `type:oneshot` | Loop / one-shot |
| `is:` | `is:fav`, `is:untagged` | Raccourcis |

Autocomplétion après `#`, `key:` et `in:`. ⌘S enregistre la ligne brute comme collection smart.

## Budgets de performance

Mesurés en build Release sur 100 000 fichiers, Mac Apple Silicon de base.

| Mesure | Cible |
| --- | --- |
| Lancement à froid → arbre affiché | < 400 ms |
| Frappe → arbre élagué affiché | < 16 ms (requête + calcul des lignes < 10 ms) |
| Ouverture d'un dossier de 5 000 samples | < 16 ms |
| Scroll de l'arbre | 120 fps constants, lignes de hauteur fixe |
| Sélection → début du son | < 30 ms |
| Indexation rapide (métadonnées) | > 2 000 fichiers / s |
| Analyse complète (BPM, tonalité, waveform) | En fond, sans toucher l'UI |
| Mémoire au repos | < 150 Mo |
| Taille de l'app | < 15 Mo |

Règles : `tree()` paginé (offset / limit) avec le total séparé ; pas de pics de waveform dans les lignes en densité compacte ; debounce 30 ms + annulation de la requête précédente ; waveforms précalculées (256 pics) ; scan incrémental (mtime + taille) puis FSEvents.

## Plan par phases

### Phase 0 — Prototype d'interface ✅ terminée

Tout est dans le dépôt `plptune/sample-browser` :

- Prototype : `pnpm dev`, ou en ligne sur https://plptune.github.io/sample-browser/ (barre de démo : 12 scénarios, thème, largeur, densité, grille 4 px).
- Design system : `pnpm storybook`, ou https://plptune.github.io/sample-browser/storybook/ (fondations, 16 composants, 12 écrans, 65 stories).
- Fenêtre : `pnpm tauri dev` (aucune commande Rust) ; `Crate.app` construit sur macOS à chaque push (artefact `Crate-macos`).
- Contrat : `src/api/types.ts` (interface `Backend`) + implémentation factice `src/api/mock.ts`.
- Validation : `docs/phase0-checklist.md`. Décisions : `docs/design-system.md`.

### Phase 1 — Branchement ✅ terminée

- Workspace Cargo : `crates/crate-core` (modèle, langage de recherche, tri, bibliothèque factice, trait `Backend`) + `src-tauri` (13 commandes typées).
- `src/api/tauri.ts` dans la fenêtre, `mock.ts` ailleurs ; types générés dans `src/api/bindings.ts`, vérifiés par `src/api/contract.ts`.
- Parité prouvée par test : mêmes 400 samples, mêmes 76 arbres que le prototype. Fenêtre pilotée au clavier : scénarios identiques, données servies par Rust.
- CI : workflow « CI » (fmt, clippy, tests, fichiers générés à jour, builds). Décisions et risques : `docs/decisions.md`.

### Phases 2 à 6 — Le moteur

Chaque phase finit sur une app utilisable et un critère de sortie mesurable.

1. ✅ **Branchement** — workspace Cargo (`crates/crate-core` + `src-tauri`), commandes Tauri pour **toutes** les méthodes de `Backend`, renvoyant encore les données factices (portées en Rust). `src/api/tauri.ts` + sélection automatique du backend (Tauri → `tauri.ts`, navigateur / Storybook → `mock.ts`). tauri-specta génère `src/api/bindings.ts`.
   - Sortie : le prototype tourne à l'identique dans la fenêtre Tauri, mais ses données passent par Rust ; un test vérifie que les types générés et `types.ts` sont compatibles.
2. **Index + scan** — schéma SQLite, indexeur sur un thread dédié, scan des dossiers (métadonnées rapides), `notify`, `sources()` / `removeSource()` / ajout de dossier (⌘O + dépôt), statut d'indexation par événement.
   - Sortie : 100 000 fichiers indexés en < 60 s, UI fluide pendant le scan, arbre réel affiché.
3. **Arbre + recherche** — `tree()` en Rust (dossiers puis samples, ouverture, élagage en recherche), parser du langage, FTS5 + filtres, TanStack Virtual sur les lignes.
   - Sortie : < 16 ms par frappe et par ouverture de dossier sur 100 000 fichiers.
4. **Preview + drag & drop** — lecture côté Rust (cpal + symphonia), commandes play / stop / seek et événement de position (~30 Hz) qui remplacent la fausse lecture, pics de waveform, drag vers Ableton / Logic / Finder.
   - Sortie : son en < 30 ms ; drop fonctionnel dans Ableton Live 12 et Logic.
5. **Tags, collections, favoris** — toutes les mutations du contrat en base (tags, favoris, collections manuelles et smart, renommage, suppression, ajout), révéler dans le Finder.
   - Sortie : tout est faisable sans souris ; rien n'est écrit dans les dossiers de l'utilisateur.
6. **Analyse de fond** — BPM, tonalité, type loop / one-shot ; file de priorité basse, reprise après redémarrage.
   - Sortie : filtres `bpm:` et `key:` fiables sur un jeu test annoté.

## Prompt phases 1 à 6 — le moteur

À donner à un agent (même totalement isolé), une phase à la fois : remplacer `{PHASE}` par le numéro de la phase en cours.

```markdown
Tu es un ingénieur senior Rust + front-end. Tu travailles seul, sans pouvoir poser de question : quand un choix
n'est pas tranché ici, tu prends la décision la plus simple qui respecte ces règles et tu l'écris dans
docs/decisions.md (date, phase, décision, raison).

## Le projet
« Crate », navigateur de samples audio pour Mac, dans une colonne étroite (260–520 px) à côté d'un DAW, comme
le browser d'Ableton Live. Priorités, dans l'ordre : rapidité perçue, simplicité, fiabilité.
Le dépôt contient déjà la phase 0 validée : lis d'abord README.md, docs/plan.md, docs/design-system.md,
docs/phase0-checklist.md, src/api/types.ts et src/api/mock.ts.

## Ce qui est figé (ne pas changer sans l'écrire dans docs/decisions.md)
- L'interface : une seule vue, l'arbre des sources qui s'ouvre sur les samples ; collections (Favoris en tête)
  dans un dossier virtuel en bas ; tiroir = ▶, nom, temps, étoile favori, waveform ; réglages dans la colonne ;
  favoris discrets (jamais d'étoile dans l'arbre). Ne recrée ni sidebar, ni liste à plat, ni compteurs.
- Les composants Solid de src/components et leur CSS (src/styles/tokens.css, bundle.css) : tu branches des
  données, tu ne redessines rien. Aucune couleur, taille ou marge hors des tokens --cr-*.
- Le contrat src/api/types.ts (interface Backend) : c'est la spécification des commandes Tauri. Si un type doit
  évoluer (ex. : pics de waveform hors des lignes, événements audio), change types.ts, mock.ts et le Rust
  ensemble, et note-le dans docs/decisions.md.
- L'UI ne trie, ne filtre et ne calcule jamais l'arbre : elle affiche ce que tree() renvoie.

## Contraintes techniques
- Tauri 2, macOS 13+ (Apple Silicon prioritaire). Pas de Swift.
- Workspace Cargo à la racine : crates/crate-core (aucune dépendance à Tauri, testable seul) + src-tauri (couche
  fine de commandes). Le cœur doit pouvoir servir une autre UI plus tard.
- UI : SolidJS + TypeScript + Vite, CSS pur. Pas de Tailwind, pas de lib de composants.
- src/api/index.ts choisit le backend : tauri.ts dans la fenêtre Tauri (window.__TAURI_INTERNALS__), mock.ts
  ailleurs. Storybook et le prototype en ligne doivent continuer à marcher avec le mock.
- Contrat typé avec tauri-specta : types générés dans src/api/bindings.ts, jamais écrits à la main ; un test
  TypeScript (tsc) échoue si bindings.ts et types.ts divergent.
- SQLite via rusqlite (bundled), WAL, FTS5. Migrations SQL versionnées.
- Audio : symphonia + cpal côté Rust ; l'UI n'envoie que play / stop / seek et reçoit la position par événement.
- Waveform : 256 pics par fichier calculés en Rust, stockés en blob.
- Drag vers le DAW : plugin drag de CrabNebula. File watching : notify. Analyse : rayon, priorité basse.
- Jamais d'écriture dans les dossiers de l'utilisateur ; tout dans le dossier app data.
- Dépendances autorisées sans justification : celles citées ici + serde, thiserror, anyhow, tracing, tokio,
  rayon, specta, tauri-specta, @tanstack/solid-virtual. Toute autre : justifie-la dans docs/decisions.md.

## Schéma (point de départ)
folders(id, parent_id NULL, source_id, path UNIQUE, name, offline INT)
files(id, folder_id, path UNIQUE, name, ext, size, mtime, duration_ms, sample_rate, bit_depth, channels,
      bpm REAL NULL, musical_key TEXT NULL, kind TEXT NULL, fav INT DEFAULT 0, missing INT DEFAULT 0,
      peaks BLOB NULL, analyzed_at NULL)
tags(id, name UNIQUE COLLATE NOCASE)
file_tags(file_id, tag_id, PRIMARY KEY(file_id, tag_id))
collections(id, name, kind TEXT CHECK(kind IN ('manual','smart')), query TEXT NULL, sort_order)
collection_items(collection_id, file_id, position)
files_fts = FTS5 external content (name, path_tokens, tags_text), unicode61, prefix='2 3', triggers.
Index : files(folder_id), files(bpm), files(musical_key), files(duration_ms), files(kind), files(fav),
file_tags(tag_id).
Les « Favoris » sont files.fav exposé comme le nœud "c:fav" de l'arbre (pas une ligne de collections).

## Arbre (tree)
Clés de nœuds : "f:<id>" dossier, "g:collections" groupe, "c:fav" favoris, "c:<id>" collection.
Lignes renvoyées dans l'ordre d'affichage : à chaque niveau, sous-dossiers triés par nom puis samples triés par
nom. Sans recherche : un nœud est ouvert s'il est dans `expanded`. Avec recherche : seuls les nœuds qui contiennent
au moins un résultat restent, tous ouverts, et le groupe Collections est masqué. Pagination offset / limit, total
séparé. Les pics de waveform ne voyagent que si la densité « waveform » est active (à ajouter au contrat).

## Langage de recherche
mots libres → FTS5 préfixe · "phrase" · #tag · -exclusion · bpm:120-128 / bpm:>140 · key:Am · dur:<2s ·
in:<collection|dossier> · type:loop|oneshot · is:fav|untagged. Parser pur en Rust, testé, qui produit une requête
paramétrée et la liste des tokens reconnus.

## Budgets (build release, 100 000 fichiers)
frappe → arbre élagué affiché < 16 ms (requête + lignes < 10 ms) · ouverture d'un dossier de 5 000 samples < 16 ms ·
scroll 120 fps · sélection → son < 30 ms · indexation > 2 000 fichiers/s · RAM au repos < 150 Mo · app < 15 Mo.
Ajoute un overlay de debug (⌥⌘D) qui affiche ces mesures en direct.

## Méthode
- Phase actuelle : {PHASE} (voir docs/plan.md, section « Plan par phases », pour le critère de sortie).
- Commence par écrire dans docs/decisions.md l'arborescence des fichiers que tu vas créer et les risques, puis
  implémente sans attendre de réponse.
- Avant chaque commit : cargo fmt, cargo clippy -- -D warnings, cargo test, pnpm build, pnpm build-storybook.
  Rien ne part si l'un échoue.
- Tests Rust pour le parser, les migrations, l'indexeur et tree() (ordre, ouverture, élagage, pagination).
- Vérifie l'UI dans un navigateur (Playwright est installé) et, si possible, dans la fenêtre Tauri sous Xvfb :
  les 12 scénarios de docs/phase0-checklist.md doivent rester identiques.
- Le workflow « Tauri (macOS) » doit rester vert : c'est la seule vérification sur Mac.
- À la fin de la phase : ce qui est fait, ce qui ne l'est pas, les mesures obtenues, les décisions prises.
```

## Décisions de design (historique)

| Version | Décision |
| --- | --- |
| v0.1 | Gris + un accent ambre ; lignes de 24 px ; tags sans couleur ; pas de Tailwind |
| v0.2 | Épuré : pas de compteurs, pas de colonne Durée, pas d'extension ; recherche plus haute (30 px), texte à 12 px |
| v0.3 | Favoris retirés (étoiles trop présentes) ; grille d'alignement 8 / 12 / 16 px |
| v0.4 | Une seule vue : l'arbre remplace sidebar + liste ; le tiroir ne garde que le sample courant |
| v0.5 | Phase 0 complète : tags (T), ⌘S, menu contextuel, réglages dans la colonne, fenêtre Tauri, Storybook |
| v0.6 | Favoris de retour, discrets : dossier « Favoris », ⌘D, étoile grise dans le tiroir uniquement, `is:fav` |
