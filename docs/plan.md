# Sample Browser Mac — Plan & Prompt (v2)

Oct 9, 2026 · @Quentin · remplace la v1 du 8 octobre

Ce qui change par rapport à la v1, en bref :

- **Phase 0 terminée** : prototype complet, design system dans Storybook, fenêtre Tauri vide, checklist de validation.
- **Une seule vue par onglet** : l'arborescence des sources s'ouvre directement sur les samples. Plus de sidebar à sections, plus de liste à plat.
- **Deux onglets** : « Bibliothèque » (sources + éléments épinglés) et « Virtuels » (favoris, collections, dossiers virtuels).
- **Collections** (regroupements à plat) **et dossiers virtuels** (arborescence) ; un dossier virtuel ou une collection peut devenir un vrai dossier (« Créer un vrai dossier », copie).
- **Le tiroir du bas ne montre que le sample courant** : ▶, nom, temps, étoile favori, waveform.
- **Favoris discrets** : jamais d'étoile dans l'arbre ; dossier « Favoris », ⌘D, étoile grise dans le tiroir.
- **La recherche élague l'arbre** au lieu d'ouvrir une liste de résultats.
- **Le contrat UI ↔ Rust existe déjà** (`src/api/types.ts`) : la phase 1 l'implémente, elle ne l'invente pas.

## Vision & principes

Un navigateur de samples pour Mac (cœur Rust, UI web via Tauri), pensé pour vivre dans une colonne étroite (~1/5 d'écran, 260–520 px) à côté du DAW, comme le browser d'Ableton. Trois promesses seulement : **indexer vite, trouver instantanément, ranger sans déplacer les fichiers**.

- **Une seule barre de recherche** qui fait tout (texte, tags, filtres). Pas de panneaux de filtres.
- **Une seule vue par onglet** : « Bibliothèque » = l'arbre des sources, qui s'ouvre sur les samples ; « Virtuels » = favoris, collections et dossiers virtuels. On choisit ce qui apparaît aussi à la racine de Bibliothèque (épingler), marqué d'une petite icône. Les réglages et « Créer un vrai dossier » remplacent l'arbre dans la même colonne. Aucune fenêtre secondaire.
- **Clavier d'abord** : ⌘F, flèches façon Finder (→ ouvre / entre / lit, ← ferme / remonte), espace, T pour taguer, ⌥← / ⌥→ historique, ⌘D favori, ⌘S enregistrer une recherche.
- **Zéro attente perçue** : chaque frappe met à jour l'arbre en moins de 16 ms ; aucune action ne bloque l'UI.
- **Non destructif** : rien n'est jamais modifié, déplacé ni supprimé dans les dossiers de l'utilisateur ; tout vit dans une base locale. Seule exception, explicite : « Créer un vrai dossier » **copie** des fichiers dans un **nouveau** dossier choisi par l'utilisateur.
- **Minimalisme** : gris + un seul accent (ambre, réservé à la lecture, à la progression, au focus et aux cibles de dépôt). Pas de compteurs, pas d'extension de fichier, pas d'icône de dossier ou de fichier.

## Scope MVP

| Feature | MVP | Notes |
| --- | --- | --- |
| Ajout de dossiers sources (drag & drop dans l'app, ⌘O) | Oui | Scan en arrière-plan, l'app reste utilisable |
| Arbre unique sources → dossiers → samples | Oui | Dossiers puis samples à chaque niveau, même retrait |
| Recherche unifiée (texte + `#tag` + filtres) | Oui | Élague l'arbre aux dossiers qui ont des résultats, tous ouverts |
| Tags (popover T sur la sélection, création à la volée) | Oui | Stockés en base, jamais dans les fichiers |
| Collections (à plat) manuelles et smart | Oui | Regroupements de samples, sans sous-dossier. Smart = recherche sauvegardée (⌘S). Ajout par drag & drop ou menu contextuel |
| Dossiers virtuels (arborescence) | Oui | Samples + sous-dossiers virtuels, sans limite de profondeur. Glisser un dossier sur un autre le déplace. Un dossier n'affiche que son contenu propre (`in:` couvre ses descendants) |
| Onglets Bibliothèque / Virtuels + épinglage | Oui | ⌘1 / ⌘2. Favoris, collections et dossiers virtuels épinglés apparaissent à la racine de Bibliothèque avec un repère (dossier en pointillés, liste, étoile) |
| Créer un vrai dossier | Oui | Copie (jamais de déplacement) vers un nouveau dossier ; arborescence gardée ou aplatie ; option « Ajouter aux sources ». Copie réelle en phase 5 |
| Favoris | Oui | Collection système « Favoris » (onglet Virtuels, épinglée par défaut) ; ⌘D ; étoile grise dans le tiroir uniquement ; `is:fav` |
| Preview audio instantanée + waveform | Oui | Espace / →, auto-play optionnel (réglage) |
| Drag & drop vers le DAW / Finder | Oui | Simple file URL, multi-fichiers |
| Analyse BPM / tonalité / durée | Oui | En tâche de fond, priorité basse |
| Fichiers MIDI (`.mid`) | Oui (ajout v1.3) | Indexés comme des samples, joués par un piano synthétique (batterie GM sur le canal 10), tempo et tonalité lus dans les notes, glissés tels quels vers le DAW ; `type:midi` |
| Menu contextuel | Oui | Lire, taguer, favori, ajouter à une collection / un dossier virtuel, retirer de, renommer, supprimer, épingler, créer un vrai dossier, nouveau dossier virtuel, retirer une source, révéler dans le Finder |
| Réglages dans la colonne | Oui | Sources, thème (sombre / clair / système), densité, toujours au premier plan, lecture auto |
| Similarity search (ML) | Non, v2 | Vecteur de features par fichier |
| Classification auto (kick, snare…) | Non, v2 | Commencer par des règles sur le nom |
| Sous-menu « Ajouter à » | Non, v2 | En MVP : listes à plat dans le menu (collections manuelles, dossiers virtuels avec leur chemin « Pack › Drums ») |
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
| Base / index | SQLite via `rusqlite` (`bundled`), mode WAL ; recherche en mémoire (catalogue indexé, en parallèle) | Stockage embarqué ; FTS5 inutile tant que la recherche tient le budget (phase 3 : < 6 ms à 100 000 fichiers) |
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

- **Panneau** : barre titre overlay (72 px réservés aux feux macOS, puis les onglets Bibliothèque / Virtuels) → recherche (30 px) → statut d'indexation (si scan) → arbre → tiroir.
- **Onglet Bibliothèque** : racine = sources, puis les éléments épinglés (raccourcis vers des sous-dossiers, Favoris, collections, dossiers virtuels) avec leur repère à droite. Un raccourci ne se déplie pas : un clic (ou ⏎) **saute** au vrai dossier en ouvrant ses parents. **Onglet Virtuels** : Favoris, groupe « Collections » (à plat), dossiers virtuels (arborescence), épingle à droite de ce qui est affiché dans Bibliothèque.
- **Arbre** : Un dossier ouvert liste ses sous-dossiers puis ses samples au même retrait. Samples : nom sans extension, BPM et clé à droite (BPM masqué sous 280 px), mini-waveform en densité « Waveform » (36 px).
- **Grille** : icônes (chevron, ▶, !, coche) à 8 px, libellés à 24 px, +16 px par niveau d'arbre.
- **Recherche** : chips pour les tokens reconnus ; les tokens en cours de frappe (`#ta`) ne filtrent pas ; une recherche masque les collections (sinon doublons) et ouvre tous les dossiers qui ont des résultats.
- **Tiroir** : ▶ / ■, nom, temps / durée, étoile favori grise, waveform. Rien d'autre (ni tags ni méta).
- **Deux modes d'affichage** (v1.4) : la **colonne** ci-dessus, à côté du DAW, et la **grande fenêtre** (bouton ⤢ de la
  barre titre ou ⌘⇧F, qui agrandit la fenêtre à l'écran sans plein écran macOS). En grand : le même arbre avec les
  colonnes Durée, Format et Tags (et leurs en-têtes), et à droite un **inspecteur** à la place du tiroir (grande
  waveform, lecture, métadonnées, tags modifiables, collections et dossiers virtuels qui contiennent le sample, chemin et
  « Afficher dans le Finder »). Le mode suit l'état agrandi de la fenêtre et est retrouvé au lancement.
- **Surcouches** (une seule à la fois, Échap ferme) : autocomplétion, popover de tags, enregistrement ⌘S, menu contextuel.
- **Réglages** (⌘,) et **Créer un vrai dossier** : remplacent l'arbre ; ‹ ou Échap pour revenir.
- **Historique** : chaque saut (onglet, chip ajoutée ou retirée, raccourci, recherche enregistrée) mémorise l'arbre tel qu'on le quitte ; ⌥← / ⌥→ (ou ⌘[ / ⌘], ou les boutons de la souris) y reviennent. Ouvrir un dossier n'est pas un saut.
- **Glisser-déposer** : samples → collection manuelle, dossier virtuel ou Favoris ; dossier virtuel → dossier virtuel (déplacement) ou fond de l'onglet (racine). Survoler l'onglet « Virtuels » pendant un glisser l'ouvre.

### Clavier

| Touche | Action |
| --- | --- |
| ⌘F, `/` | Recherche |
| ↑ ↓ (⇧ pour étendre) | Naviguer |
| → | Ouvrir un dossier, y entrer, lire un sample |
| ← | Fermer un dossier, sinon remonter au parent |
| Espace | Lecture / stop |
| ⏎ | Ouvrir / fermer un dossier, lire un sample, suivre un raccourci |
| ⌥← / ⌥→, ⌘[ / ⌘] | Historique de navigation |
| T | Taguer la sélection |
| ⌘D | Favori |
| ⌘S | Recherche → collection smart |
| ⌘1 / ⌘2 | Onglet Bibliothèque / Virtuels |
| ⌘N | Nouveau dossier virtuel |
| ⌘⇧N | Nouvelle collection |
| ⌘⌫ | Retirer de la collection / du dossier virtuel ; ailleurs, masquer |
| ⇧F10 | Menu de la ligne courante (clic droit au clavier) |
| ⇧← / ⇧→ | Reculer / avancer d'un dixième dans le sample |
| ⌘O | Ajouter un dossier |
| ⌥⌘R | Afficher la sélection dans le Finder |
| ⌥⌘D | Mesures (arbre, échange, rendu, son) |
| ⌘L | Boucle |
| ⌘⇧Espace | Lire un sample au hasard |
| ⌘, | Réglages |
| ⌘⇧F | Grande fenêtre / retour en colonne |
| Échap | Fermer la surcouche, sinon quitter les réglages, sinon stop |

## Langage de recherche

Une seule ligne, tokens séparés par des espaces, AND par défaut. Le parser Rust la compile une fois par requête (texte en minuscules, `in:` résolu) puis l'applique à tout le catalogue en parallèle.

| Syntaxe | Exemple | Effet |
| --- | --- | --- |
| mot libre | `kick dark` | Contenu dans nom + chemin + tags ; un mot d'un groupe de **synonymes** trouve aussi les autres (`kick` → `bd`, `bassdrum`) |
| `"…"` | `"vinyl crackle"` | Phrase exacte |
| `#tag` | `#warm` | A ce tag |
| `-` devant | `-loop`, `-#bright` | Exclusion |
| `bpm:` | `bpm:120-128`, `bpm:>140` | Plage ou comparaison |
| `key:` | `key:Am`, `key:C`, `key:A#` | Tonalité (note seule = majeur + mineur ; enharmonies équivalentes : `A#` = `Bb`) |
| `dur:` | `dur:<2s`, `dur:1-4s` | Durée |
| `in:` | `in:Drums` | Collection, sinon dossier virtuel (et ses sous-dossiers), sinon chemin |
| `type:` | `type:loop`, `type:oneshot`, `type:midi` | Loop / one-shot ; fichiers MIDI |
| `is:` | `is:fav`, `is:untagged`, `is:hidden` | Raccourcis ; `is:hidden` montre les éléments masqués (sinon jamais affichés) |

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

- Workspace Cargo : `crates/crate-core` (modèle, langage de recherche, tri, bibliothèque factice, trait `Backend`) + `src-tauri` (24 commandes typées).
- `src/api/tauri.ts` dans la fenêtre, `mock.ts` ailleurs ; types générés dans `src/api/bindings.ts`, vérifiés par `src/api/contract.ts`.
- Parité prouvée par test : mêmes 400 samples, mêmes 147 arbres, plans de commit, parents et raccourcis que le prototype. Fenêtre pilotée au clavier : scénarios identiques, données servies par Rust.
- CI : workflow « CI » (fmt, clippy, tests, fichiers générés à jour, builds). Décisions et risques : `docs/decisions.md`.

### Phase 2 — Index + scan ✅ terminée

- Vraie bibliothèque dans la fenêtre : SQLite (`crate.db`, WAL, migrations), catalogue en mémoire pour l'arbre et la
  recherche (la logique de la phase 1, prouvée identique au prototype), écriture immédiate en base.
- Scan sur un thread dédié : parcours, en-têtes audio lus en parallèle (symphonia, rayon), rescan incrémental
  (taille + date), introuvables / hors ligne, dossiers sans audio masqués ; `notify` sur chaque source ; « Actualiser ».
- UI : premier lancement réel, ⌘O (sélecteur natif), dépôt de dossiers depuis le Finder, statut d'indexation par
  événement, « Créer un vrai dossier » qui copie vraiment, « Afficher / Ouvrir dans le Finder » (clic droit, ⌥⌘R). `CRATE_DEMO=1` = données du prototype.
- Mesures (conteneur Linux, 4 cœurs, build release, petits WAV) : **100 000 fichiers indexés en 1,1 s** (budget 60 s),
  rescan sans changement 0,6 s, chargement du catalogue 0,19 s, ouverture d'un dossier de 5 000 samples 40 ms ;
  recherche 0,3 à 0,7 s → c'est le chantier de la phase 3 (budget 16 ms).

### Phase 3 — Arbre + recherche ✅ terminée

- Cœur : tri naturel sans allocation, samples de chaque dossier triés une fois, recherche calculée une fois par requête
  et en parallèle (rayon), lignes légères, dernier arbre gardé en cache (défiler ne refait pas la marche), seule la page
  demandée est construite. `focus` → `focusIndex` pour faire défiler l'arbre jusqu'à une ligne lointaine.
- Pics de waveform hors des lignes (`peaks` seulement en densité « Waveform », `peaks(id)` pour le tiroir).
- Synonymes : 7 groupes par défaut, éditables dans Réglages › Synonymes, appliqués aux mots libres (pas aux phrases).
- UI : arbre virtualisé (TanStack Virtual), lignes chargées par pages de 200, réutilisées d'une recherche à l'autre ;
  flèches, ⇧-sélection et sauts à travers les pages. Overlay de mesures ⌥⌘D.
- Mesures, 100 000 fichiers, build release : **pire frappe 6 ms côté Rust** (budget 10 ms), ouverture d'un dossier de
  5 000 samples 4 ms. Dans la fenêtre (conteneur Linux sans GPU) : **frappe 12–13 ms de bout en bout**, ouverture du
  dossier 10 ms ; une recherche qui fait apparaître ~70 nouvelles lignes d'un coup monte à ~27 ms (rendu logiciel) —
  à revérifier sur Mac avec ⌥⌘D. FTS5 n'est pas nécessaire (voir `docs/decisions.md`).

### Phase 4 — Preview + drag & drop ✅ terminée (à valider sur Mac)

- Son : moteur Rust (symphonia + cpal), sortie ouverte au lancement, décodage progressif sur son propre thread,
  conversion à la fréquence et aux canaux de la sortie, volume, boucle, déplacement ; position par événement ~30 Hz.
  Sans périphérique audio, la lecture avance en silence au rythme réel (conteneur, CI).
- Waveforms réelles : 256 pics par fichier, en base ; calculés à la demande pour le tiroir et en tâche de fond pour
  la densité « Waveform ».
- Clic dans la waveform = lire depuis ce point ; boucle (⌘L) et volume dans les Réglages ; lecture aléatoire ⌘⇧Espace ;
  arrêt au début d'un glisser et quand Crate passe en arrière-plan (deux réglages, activés par défaut).
- Glisser natif des samples sélectionnés vers le DAW ou le Finder (plugin drag de CrabNebula) ; dans la fenêtre, les
  dépôts sur collection / dossier virtuel / Favoris et l'ouverture d'onglet au survol marchent avec ce même glisser.
- Mesures (conteneur, sans carte son) : premier son prêt en < 30 ms (lecture muette, au tick près). **À valider sur
  Mac** : latence réelle (⌥⌘D affiche « son … ms ») et dépôt dans Ableton Live 12 et Logic.

### Phase 5 — Tags, collections, favoris ✅ terminée (à valider sur Mac)

- Toutes les mutations du contrat écrites en base dès la phase 2 ; la phase 5 ajoute **masquer** : « Masquer » dans le
  menu d'un sample ou d'un sous-dossier (⌘⌫ dans la Bibliothèque), `is:hidden` pour les retrouver (en italique gris),
  « Afficher » pour annuler. Un élément masqué disparaît de l'arbre, de la recherche, des collections et des
  dossiers virtuels ; rien n'est supprimé ni déplacé sur le disque, et le masquage survit aux rescans.
- Tout au clavier : ⇧F10 (ou la touche Menu) ouvre le menu de la ligne courante, ⌘⇧N crée une collection, ⌘⌫ retire
  de la collection ou du dossier virtuel (ailleurs : masque), « Déplacer dans » remplace le glisser d'un dossier
  virtuel, ⇧← / ⇧→ remplacent le clic dans la waveform.
- Réglages mémorisés (thème, densité, lecture, fenêtre) ; « Toujours au premier plan » agit vraiment sur la fenêtre ;
  « Créer un vrai dossier » affiche la vraie progression de la copie (événements), sans bloquer l'app.
- Preuve « rien n'est écrit » : un test photographie les dossiers de l'utilisateur (chemins, tailles, dates,
  contenus) avant et après toutes les mutations, un rescan, le calcul des pics, une copie et le retrait d'une source.
- **Ce qui reste à vérifier sur Mac, toutes phases confondues : [`docs/verification-mac.md`](verification-mac.md).**

### Phase 6 — Analyse de fond ✅ terminée (à valider sur un vrai dossier)

- Tempo, tonalité, boucle / one-shot pour chaque fichier, dans l'ordre : le **nom** (`Bass_Loop_Dark_115_Bm`,
  `Pad 120bpm F#min`), le chunk **acid** des WAV, puis l'**audio** (30 premières secondes, mono, ~11 kHz) :
  flux spectral et autocorrélation pour le tempo, calé sur la durée exacte pour une boucle coupée à la mesure ;
  chromagramme et profils de Temperley pour la tonalité, seulement si le son est tonal (jamais sur une batterie).
- Le nom sert dès le scan (les filtres marchent tout de suite) ; l'analyse audio suit en fond, après les waveforms,
  sur deux threads, par lots de 16. Reprise après redémarrage (ce qui reste est en base) ; une nouvelle version de
  l'analyse refait tout. Le catalogue est mis à jour sans rechargement ; Réglages › Sources affiche l'avancement.
- `key:` accepte les enharmonies (`key:A#` trouve `Bb`), en Rust comme dans le prototype.
- Jeu test annoté (90 fichiers synthétisés, noms neutres : l'audio seul) : **BPM exact 98 %** sur les boucles coupées
  à la mesure (98 % à l'octave près sur toutes), **tonalité exacte 89 %** (score MIREX 92 %), aucune tonalité sur la
  batterie, boucle / one-shot 100 %. ~15 ms par fichier (un cœur). Recherche `key:` / `bpm:` à 100 000 fichiers :
  3 à 5 ms.
- **À valider sur un vrai dossier** : `CRATE_ANALYSIS_DIR=… cargo test --release -p crate-core --test analysis --
  --ignored --nocapture` compare l'audio aux tempos et tonalités écrits dans les noms (voir
  `docs/verification-mac.md`).

### Ajout — Fichiers MIDI ✅ (à écouter sur Mac)

- Les `.mid` / `.midi` sont indexés comme des samples (durée lue dans le fichier) et marqués « MIDI » dans l'arbre ;
  `type:midi` les isole. Glissés vers le DAW, ils partent tels quels (clip MIDI dans Ableton ou Logic).
- Préécoute : un piano synthétique en Rust (partiels harmoniques, déclin selon la hauteur et la vélocité, pédale de
  sustain), la batterie General MIDI (canal 10) en percussions synthétiques. Rendu par blocs : même lecteur, même
  latence, boucle et déplacement ; la waveform est celle du rendu.
- Analyse : tempo écrit dans le fichier ; tonalité tirée des notes (le premier accord si toutes les notes tiennent
  dans sa gamme, sinon les profils) ; boucle si au moins deux attaques et une mesure. Jeu test : 96/96 progressions
  courantes (12 tonalités × 8 progressions, dont les modales et celles qui ne commencent pas sur la tonique).
- Prototype : 7 clips MIDI dans Splice › packs › Lofi Keys › MIDI.

### Phases 2 à 6 — Le moteur

Chaque phase finit sur une app utilisable et un critère de sortie mesurable.

1. ✅ **Branchement** — workspace Cargo (`crates/crate-core` + `src-tauri`), commandes Tauri pour **toutes** les méthodes de `Backend`, renvoyant encore les données factices (portées en Rust). `src/api/tauri.ts` + sélection automatique du backend (Tauri → `tauri.ts`, navigateur / Storybook → `mock.ts`). tauri-specta génère `src/api/bindings.ts`.
   - Sortie : le prototype tourne à l'identique dans la fenêtre Tauri, mais ses données passent par Rust ; un test vérifie que les types générés et `types.ts` sont compatibles.
2. ✅ **Index + scan** — schéma SQLite, indexeur sur un thread dédié, scan des dossiers (métadonnées rapides), `notify`, `sources()` / `removeSource()` / ajout de dossier (⌘O + dépôt), statut d'indexation par événement. **Actualiser une source** (menu contextuel) : rescan forcé, pour un disque où `notify` n'a rien vu.
   - Sortie : 100 000 fichiers indexés en < 60 s, UI fluide pendant le scan, arbre réel affiché.
3. ✅ **Arbre + recherche** — `tree()` en Rust (dossiers puis samples, ouverture, élagage en recherche), parser du langage, FTS5 + filtres, TanStack Virtual sur les lignes. **Synonymes** : une petite table éditable dans les Réglages (`kick` ↔ `bd`, `hat` ↔ `hh`…) développée par le parser.
   - Sortie : < 16 ms par frappe et par ouverture de dossier sur 100 000 fichiers.
4. ✅ **Preview + drag & drop** — lecture côté Rust (cpal + symphonia), commandes play / stop / seek et événement de position (~30 Hz) qui remplacent la fausse lecture, pics de waveform, drag vers Ableton / Logic / Finder. Avec : **clic dans la waveform** du tiroir = lire depuis ce point ; **boucle** et **volume** (Réglages, plus ⌘L pour la boucle) ; **lecture aléatoire** ⌘⇧Espace (un sample au hasard parmi les lignes visibles) ; **arrêter la lecture** au début d'un glisser et quand l'app perd le focus (deux réglages, activés par défaut).
   - Sortie : son en < 30 ms ; drop fonctionnel dans Ableton Live 12 et Logic.
5. ✅ **Tags, collections, favoris** — toutes les mutations du contrat en base (tags, favoris, collections manuelles et smart, renommage, suppression, ajout, raccourcis), révéler dans le Finder. **Masquer des fichiers** : « Masquer » dans le menu d'un sample ou d'un dossier, `is:hidden` pour les retrouver, « Afficher » pour annuler (jamais de suppression).
   - Sortie : tout est faisable sans souris ; rien n'est écrit dans les dossiers de l'utilisateur.
6. ✅ **Analyse de fond** — BPM, tonalité, type loop / one-shot ; file de priorité basse, reprise après redémarrage.
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
- L'interface : deux onglets (Bibliothèque = arbre des sources + éléments épinglés ; Virtuels = favoris, collections
  à plat, dossiers virtuels en arborescence) ; tiroir = ▶, nom, temps, étoile favori, waveform ; réglages et
  « Créer un vrai dossier » dans la colonne ; favoris discrets (jamais d'étoile dans l'arbre).
  Ne recrée ni sidebar, ni liste à plat, ni compteurs.
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
- SQLite via rusqlite (bundled), WAL. Migrations SQL versionnées. Arbre et recherche en mémoire (catalogue indexé) :
  FTS5 seulement si une mesure montre que le budget n'est plus tenu.
- Audio : symphonia + cpal côté Rust ; l'UI n'envoie que play / stop / seek et reçoit la position par événement.
- Waveform : 256 pics par fichier calculés en Rust, stockés en blob.
- Drag vers le DAW : plugin drag de CrabNebula. File watching : notify. Analyse : rayon, priorité basse.
- Jamais de modification, déplacement ou suppression dans les dossiers de l'utilisateur ; tout dans le dossier app
  data. Seule écriture autorisée : « Créer un vrai dossier » copie dans un nouveau dossier choisi par l'utilisateur
  (refuser un dossier existant non vide, ne jamais écraser).
- Dépendances autorisées sans justification : celles citées ici + serde, thiserror, anyhow, tracing, tokio,
  rayon, specta, tauri-specta, @tanstack/solid-virtual. Toute autre : justifie-la dans docs/decisions.md.

## Schéma (point de départ)
folders(id, parent_id NULL, source_id, path UNIQUE, name, offline INT)
files(id, folder_id, path UNIQUE, name, ext, size, mtime, duration_ms, sample_rate, bit_depth, channels,
      bpm REAL NULL, musical_key TEXT NULL, kind TEXT NULL, fav INT DEFAULT 0, missing INT DEFAULT 0,
      peaks BLOB NULL, analyzed_at NULL)
tags(id, name UNIQUE COLLATE NOCASE)
file_tags(file_id, tag_id, PRIMARY KEY(file_id, tag_id))
collections(id, name, kind TEXT CHECK(kind IN ('manual','smart')), query TEXT NULL, pinned INT, sort_order)
collection_items(collection_id, file_id, position)
virtual_folders(id, parent_id NULL REFERENCES virtual_folders ON DELETE CASCADE, name, pinned INT)
virtual_items(folder_id, file_id, position)
settings(key PRIMARY KEY, value)   -- dont favorites_pinned
pinned_folders(folder_id PRIMARY KEY REFERENCES folders ON DELETE CASCADE, position)   -- raccourcis
files_fts = FTS5 external content (name, path_tokens, tags_text), unicode61, prefix='2 3', triggers.
Index : files(folder_id), files(bpm), files(musical_key), files(duration_ms), files(kind), files(fav),
file_tags(tag_id).
Les « Favoris » sont files.fav exposé comme le nœud "c:fav" de l'arbre (pas une ligne de collections).

## Arbre (tree)
Clés de nœuds : "f:<id>" dossier source, "p:<id>" raccourci vers un sous-dossier source (ne se déplie pas :
l'UI y saute avec ancestors()), "c:fav" favoris, "g:collections" groupe, "c:<id>" collection,
"v:<id>" dossier virtuel. Deux racines (`root`) : "library" (sources + épinglés, épinglés masqués en recherche)
et "virtual" (favoris, groupe Collections, dossiers virtuels).
Lignes renvoyées dans l'ordre d'affichage : à chaque niveau, sous-dossiers triés par nom puis samples triés par
nom. Sans recherche : un nœud est ouvert s'il est dans `expanded`. Avec recherche : seuls les nœuds qui contiennent
au moins un résultat restent, tous ouverts, et le groupe Collections est masqué. Pagination offset / limit, total
séparé. Les pics de waveform ne voyagent que si la densité « waveform » est active (`TreeRequest.peaks`) ;
le tiroir les demande avec `peaks(id)`. `focus` renvoie la position d'une ligne (`focusIndex`).
« Créer un vrai dossier » : plan (fichiers, sous-dossiers, octets, introuvables) puis copie ; progression par événement
Tauri (phase 5) ; option « Ajouter aux sources » qui indexe le nouveau dossier.

## Langage de recherche
mots libres (+ synonymes) · "phrase" · #tag · -exclusion · bpm:120-128 / bpm:>140 · key:Am · dur:<2s ·
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
| v0.7 | Collections (à plat) **et** dossiers virtuels (arborescence) ; onglets Bibliothèque / Virtuels ; épinglage avec repère ; « Créer un vrai dossier » (copie) |
| v0.8 | Idées reprises de Sononym, en version simple : raccourcis vers des sous-dossiers, historique ⌥← / ⌥→ ; planifiés : masquer, lecture aléatoire, boucle + volume, lecture depuis un point, arrêt au drag / perte de focus, synonymes, actualiser une source ; en attente : taper pour sauter |
| v0.9 | Phase 3 : arbre virtualisé par pages, synonymes dans les Réglages, overlay de mesures ⌥⌘D |
| v1.0 | Phase 4 : son réel, waveforms réelles, glisser natif vers le DAW, boucle / volume / aléatoire |
| v1.1 | Phase 5 : masquer (`is:hidden`), tout au clavier (⇧F10, ⌘⌫, ⌘⇧N, ⇧← / ⇧→), réglages mémorisés, vraie progression de copie |
| v1.2 | Phase 6 : analyse de fond (nom, chunk acid, audio) ; `key:` avec enharmonies ; avancement dans les Réglages |
| v1.3 | Fichiers MIDI : index, préécoute au piano synthétique, tempo et tonalité lus dans les notes, `type:midi`, repère « MIDI » |
| v1.4 | Deux modes d'affichage : colonne et grande fenêtre (arbre large + inspecteur), ⌘⇧F |
| v1.7 | Retours n° 2 : interface en anglais, tiroir réorganisé, waveform HD et tête fluide, fondus (plus de clic), explorer épuré (nom.ext, lignes de parenté), ← / →, recherche à plat, glisser sans pastille |
| v1.6 | Recherche depuis le DAW : ⌘F dans Live / Bitwig ouvre la recherche de Crate, Échap ou un glisser y revient |
| v1.5 | Retours du premier essai sur Mac : lecture auto par défaut, sélection en bleu, fond plus clair, icônes de type, ⌘← tout replier, tags dans le tiroir, Réglages en onglets, taille du texte et couleurs modifiables, test de contraste |
