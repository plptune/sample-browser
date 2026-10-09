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
| « Créer un vrai dossier » copie réellement en mode réel (refus d'un dossier existant non vide, jamais d'écrasement), puis « Ajouter aux sources » indexe la copie. « Afficher / Ouvrir dans le Finder » : `open -R` pour un fichier, `open` pour un dossier. Avancés depuis la phase 5. | Quelques lignes ; la version simulée n'avait pas de sens sur de vrais fichiers. |
| Nouvelles dépendances : rusqlite (bundled), symphonia, rayon, notify (citées dans le plan) ; **tauri-plugin-dialog** pour ⌘O (choisir un dossier). | Sélecteur de dossier natif, sans code Objective-C. |

Mesures (conteneur Linux, 4 cœurs, build release, `tests/bench_scan.rs`, 100 000 petits WAV) : scan complet 1,1 s
(90 000 fichiers/s, cache disque chaud), rescan sans changement 0,6 s, chargement du catalogue 0,19 s, dossier de 5 000
samples 40 ms, recherche 0,3–0,7 s. Fenêtre vérifiée sous écran virtuel : premier lancement, scan au lancement,
`notify` (fichier ajouté visible en ~1 s), statut d'indexation en direct pendant un scan de 40 000 fichiers.

| Décision (suite) | Raison |
| --- | --- |
| Finder au clic droit : « Afficher dans le Finder » sur un sample (dossier ouvert, fichier sélectionné), « Ouvrir dans le Finder » sur une source, un sous-dossier ou un raccourci ; ⌥⌘R sur la sélection. Le chemin d'un dossier vient du cœur (`nodePath`), même replié ou derrière un raccourci. Pas d'entrée sur les collections et dossiers virtuels (rien sur le disque) : « Créer un vrai dossier » sert à ça. | Demande utilisateur ; libellés de macOS. |
| Le dernier statut de scan est gardé côté Rust (`scan_status`) et lu par l'UI au démarrage. | Le scan lancé à l'ouverture commence avant que la page n'écoute les événements. |
| Un refus (source déjà couverte, pas un dossier, copie vers un dossier non vide) remonte comme une erreur lisible, affichée en une ligne sous la recherche (ou dans la vue de copie). | Pas de boîte de dialogue ; le message disparaît seul. |

## Phase 3 — Arbre + recherche (9 oct. 2026)

| Décision | Raison |
| --- | --- |
| **Pas de FTS5.** La recherche reste en mémoire : texte pré-calculé en minuscules, requête compilée une fois (`in:` résolu en tableau d'appartenance), appliquée à tous les samples en parallèle (rayon). | Pire frappe mesurée : 6 ms à 100 000 fichiers (budget 10 ms côté Rust). FTS5 ajouterait un second chemin de recherche à garder identique au premier. À revoir au-delà de ~300 000 fichiers. |
| Tri naturel sans allocation ; samples de chaque dossier triés une fois au chargement. | Le tri allouait deux vecteurs par comparaison : c'était l'essentiel des 300 ms de la phase 2. |
| Marche de l'arbre en lignes légères (index), **dernier arbre en cache** (même onglet, même recherche, mêmes dossiers ouverts), seule la page demandée est construite ; le cache est vidé à chaque modification. | Défiler ou charger la page suivante ne refait pas la marche. |
| Contrat : `TreeRequest.peaks` (pics seulement en densité « Waveform »), `focus` → `TreePage.focusIndex`, `TreePage.micros` ; `peaks(id)` pour le tiroir ; `synonyms()` / `setSynonyms()`. | Les pics sortent des lignes (risque noté en phase 1) ; l'UI peut aller à une ligne qu'elle n'a pas chargée. |
| UI : pages de 200 lignes dans un tableau creux, virtualiseur TanStack ; curseur, ⇧-sélection et sauts par index (pages chargées à la demande) ; les samples sélectionnés sont gardés à part. Les cases de l'arbre sont **réutilisées** d'une recherche à l'autre (seules leurs valeurs changent). | Rendu de 15 ms → 2–4 ms par frappe dans le conteneur (sans GPU). |
| Synonymes : 7 groupes par défaut (kick/bd/bassdrum, snare/sd, hat/hh/hihat, clap/cp, perc/percussion, vox/vocal, fx/sfx), dans `settings`. S'appliquent aux mots libres, pas aux phrases ; `-kick` exclut tout le groupe. | Simple à expliquer ; une phrase reste exacte. |
| Overlay ⌥⌘D : arbre (Rust) · échange (IPC + JSON) · rendu (mise à jour synchrone du DOM) · total, et à part l'attente de l'image suivante. | L'attente de l'image (jusqu'à 16,7 ms) dépend de l'écran, pas de l'app : la compter faussait la mesure. |
| `?overscan=1000` dans l'URL du prototype monte toutes les lignes. | Les tests navigateur écrits avant la virtualisation cherchent des lignes hors de l'écran ; le nouveau test garde le réglage réel. |

Mesures (100 000 fichiers, build release, conteneur Linux 4 cœurs) : ouverture d'un dossier de 5 000 samples 4 ms ;
« kick » 4–5 ms, « kick dusty » 3–4 ms, `-kick` (88 500 lignes) 4–5 ms, pire frappe 6 ms. Fenêtre Tauri (WebKitGTK,
rendu logiciel) : frappe 12–13 ms de bout en bout, ouverture du dossier 10 ms, ~27 ms quand ~70 lignes nouvelles
apparaissent d'un coup.

## Phase 4 — Preview + drag & drop (9 oct. 2026)

| Décision | Raison |
| --- | --- |
| Moteur audio dans crate-core (`audio.rs`) : sortie cpal **ouverte au lancement** et gardée ; un sample à la fois, décodé **progressivement** sur son propre thread et converti (interpolation linéaire, mono → deux côtés) à la fréquence et aux canaux de la sortie ; rendu sous verrou bref (volume, boucle, déplacement). | Le premier son ne paie ni l'ouverture du périphérique ni le décodage complet du fichier. Interpolation linéaire suffisante pour une préécoute. |
| Sans périphérique audio, la lecture avance en silence au rythme réel. | Le conteneur et la CI n'ont pas de carte son ; l'UI et les tests gardent le même comportement. |
| Statut de lecture par événement (~30 Hz) : position, durée, boucle, latence (une fois par lecture), erreur. Mode démo (`CRATE_DEMO=1`) : silence de la durée du sample ; navigateur : lecteur factice au même contrat. | La progression vient du moteur, plus de minuterie côté UI. |
| Pics : 256 octets par fichier dans `files.peaks`, **normalisés** sur le maximum du fichier ; jamais dans le catalogue en mémoire. Tiroir : `peaks(id)` les calcule tout de suite s'ils manquent ; densité « Waveform » : lus en base pour la seule page ; l'indexeur calcule les autres par lots de 64, en parallèle, quand il n'a rien d'autre à faire. Un fichier illisible reçoit des pics vides (pas de nouvel essai avant qu'il change). | 25 Mo pour 100 000 fichiers en base, rien en mémoire ; un sample discret reste lisible. |
| Glisser natif avec **tauri-plugin-drag** (CrabNebula), icône « nombre de fichiers » dessinée à la volée ; seulement dans la fenêtre sur de vrais fichiers (le navigateur et la démo gardent le glisser HTML). | Seul moyen fiable de déposer des fichiers dans Ableton, Logic ou le Finder depuis une webview. |
| Dans la fenêtre, le même glisser natif sert aux dépôts internes : la cible est retrouvée sous le pointeur à partir des événements de dépôt de Tauri ; le dernier glisser est gardé 1,5 s, car la fin du glisser arrive avant l'événement de dépôt, qui peut en plus être livré deux fois. | Un seul geste pour le DAW et pour les collections ; aucun dépôt pris pour un dossier venu du Finder. |
| Boucle, volume et arrêts automatiques réglés en mémoire (pas encore persistés, comme le thème). | La persistance des réglages d'UI viendra avec la phase 5 (faite). |
| Nouvelles dépendances : cpal (citée dans le plan), tauri-plugin-drag + @crabnebula/tauri-plugin-drag (« plugin drag de CrabNebula » du plan). CI Linux : `libasound2-dev`. | — |

Vérifié dans le conteneur : décodage, rééchantillonnage, boucle, déplacement, arrêt, fichier illisible (tests),
latence de démarrage < 30 ms en lecture muette (au pas de 33 ms près), waveforms calculées et affichées, clic dans la
waveform, glisser natif sur « Favoris » dans la fenêtre (GTK, Xvfb). **Pas vérifiable ici** : le son réel, la latence
réelle et le dépôt dans Ableton / Logic (sur Mac, avec ⌥⌘D qui affiche « son … ms »).

## Phase 5 — Tags, collections, favoris (9 oct. 2026)

| Décision | Raison |
| --- | --- |
| Tags, favoris, collections, dossiers virtuels, raccourcis et synonymes étaient déjà écrits en base dès la phase 2 ; la phase 5 ajoute **masquer**. | — |
| Masquer = une colonne `hidden` sur `files` et `folders` (migration 2). Masquage effectif : le sample ou un de ses dossiers parents ; calculé une fois par modification (`hidden_eff`), appliqué à toute la marche de l'arbre (dossiers, collections, dossiers virtuels, recherche). Seul un `is:hidden` non nié dans la recherche les fait réapparaître, en italique gris. Une source ne se masque pas (on la retire). | Un seul filtre au même endroit que la recherche : rien à garder cohérent ailleurs. Le masquage tient au fichier, il survit aux rescans et aux déplacements dans les collections. |
| ⌘⌫ : dans une collection manuelle, « Favoris » ou un dossier virtuel → retirer de là ; ailleurs → masquer (sample ou sous-dossier). Jamais de suppression de fichier. | Le geste « supprimer » du Finder, sans danger : tout se défait avec « Afficher ». |
| Tout au clavier : ⇧F10 et la touche Menu ouvrent le menu de la ligne courante (positionné sous la ligne) ; ⌘⇧N nouvelle collection ; « Déplacer dans » (menu d'un dossier virtuel) remplace le glisser ; ⇧← / ⇧→ remplacent le clic dans la waveform. | Conventions connues (⇧F10 vient de Windows / Linux, ⌘⇧N du Finder). Glisser vers le DAW reste à la souris par nature. |
| Réglages d'UI (thème, densité, lecture auto, premier plan, boucle, volume, arrêts automatiques) dans le `localStorage` de la webview (`crate.prefs`), seulement dans la fenêtre sur une vraie bibliothèque. Le prototype, la démo et Storybook partent toujours des valeurs par défaut. | Lus au démarrage sans passer par la base ; propres à la machine. Les scénarios et tests du prototype restent déterministes. |
| « Toujours au premier plan » appelle `setAlwaysOnTop` de Tauri (permission `core:window:allow-set-always-on-top`). | Le réglage existait depuis la phase 0 sans effet. |
| Copie (« Créer un vrai dossier ») en deux temps : plan préparé sous le verrou de la bibliothèque (`prepare_commit`, refuse une destination non vide), puis copie hors verrou sur un thread bloquant (`CommitJob::run`), avec un événement `CommitProgressEvent` au plus toutes les 50 ms. Jamais d'écrasement (« nom 2 »). | L'app reste utilisable pendant une grosse copie ; la barre suit la vraie progression. |
| Preuve « rien n'est écrit dans les dossiers de l'utilisateur » : un test photographie chemins, tailles, dates et contenus d'une source avant et après toutes les mutations, un rescan, le calcul des pics, une copie vers un autre dossier et le retrait de la source. | Le critère de sortie, vérifié à chaque push plutôt qu'affirmé. |

Ce qui reste à vérifier sur Mac (toutes phases) : `docs/verification-mac.md`.

## Phase 6 — Analyse de fond (9 oct. 2026)

| Décision | Raison |
| --- | --- |
| Trois sources, dans cet ordre : **nom** du fichier, chunk **acid** (WAV), **audio**. Un BPM nu dans le nom (`Drum_Loop_92`) ne compte que pour une boucle ; une lettre seule (`Bass_G_17`) ne donne la tonique que si l'audio est tonal. | Les packs sont annotés dans les noms par ceux qui les ont faits : c'est plus sûr que n'importe quelle analyse. |
| Le nom est lu **dès le scan** ; l'analyse audio vient ensuite, en fond. | `bpm:` et `key:` marchent tout de suite sur une bibliothèque de packs. |
| Analyse maison, sans dépendance (FFT radix 2 de 40 lignes) : 30 premières secondes, mono, ~11 kHz. Tempo : flux spectral (tout le spectre + sous 300 Hz, où se lit le temps), autocorrélation **circulaire** pour une boucle, peigne sur 4 périodes, préférence douce autour de 120 BPM et pour deux attaques par temps ; une boucle coupée à la mesure prend le tempo qui donne un nombre entier de temps (exact). Tonalité : chromagramme (trames normalisées, amplitudes compressées), profils de Temperley, la basse (surtout au début) départage ; seulement si le son est tonal (énergie concentrée dans des pics étroits, au moins 3 classes de hauteur). Boucle : ≥ 1,2 s, ≥ 4 attaques, régulière ou calée sur la mesure. | Assez juste sur le jeu test (ci-dessous), rapide (~15 ms par fichier), aucun code tiers à surveiller. Les profils de Krumhansl confondaient majeur et mineur ; sans la mesure de « pics », les kicks donnaient une tonalité à la batterie. |
| BPM gardé seulement pour les boucles (ou écrit dans le nom) ; arrondi à l'entier. Tonalités écrites comme dans les packs : `C#m`, `Eb`, `F#`, `Bb`… | Le tempo d'un one-shot n'a pas de sens ; les packs n'utilisent presque jamais de BPM décimal. |
| `key:` lit la tonalité (note, altération, mode) des deux côtés : `key:A#` trouve `Bb`, `key:A` couvre la et la mineur. Même règle en TypeScript (`src/lib/keys.ts`), vérifiée par la parité. | La même tonalité s'écrit de deux façons selon les packs. |
| File de fond dans l'indexeur, après les scans et les waveforms, par lots de 16, sur **deux threads** (pool rayon dédié). Reprise : `analyzed_at IS NULL` en base ; `settings.analysis_version` refait tout quand l'algorithme change. Un fichier illisible est marqué analysé (pas de nouvel essai avant qu'il change). | Le DAW garde la machine ; quitter l'app ne perd rien. |
| Résultats appliqués au catalogue **sans rechargement** (liste partagée avec l'indexeur, vidée à chaque `sync`). L'UI interroge l'avancement toutes les 3 s : ligne dans Réglages › Sources, page visible rechargée tant que l'analyse avance. | Recharger 100 000 fichiers toutes les secondes pendant 15 minutes aurait bloqué les frappes (0,3 s chacune). Pas d'événement de plus : l'avancement est lent et discret. |
| Jeu test **synthétisé** dans le test (déterministe, noms neutres) : 38 boucles de batterie (6 motifs, 80 à 174 BPM, chacun à des tempos où on le trouve vraiment, 1 à 4 mesures, swing, silence final), 24 boucles tonales (les 24 tonalités), 16 one-shots de batterie, 12 accords et nappes. Critère : BPM exact ≥ 95 % sur les boucles coupées, ≥ 85 % sur toutes, ≥ 95 % à l'octave près ; tonalité exacte ≥ 85 % ; ≤ 5 % de batteries avec tonalité ; boucle / one-shot ≥ 95 % ; précision et rappel des filtres `bpm:` et `key:`. | Pas de jeu annoté libre de droits à télécharger ici. Les noms neutres obligent l'audio à faire ses preuves ; un test ignoré compare l'audio aux noms d'un vrai dossier. |
| Profil `dev` : symphonia et crate-core compilés optimisés. | Sans cela, le test d'analyse prend plusieurs minutes en debug (CI). |

Résultats (jeu test, build release) : BPM exact 52/53 sur les boucles coupées à la mesure, 5/9 sur celles suivies de
silence (tempo libre, à ±2 % ou à l'octave), 61/62 à l'octave près ; tonalité 32/36 (les 4 erreurs : la progression
i–VI–III–VII, qui est aussi vi–IV–I–V de la relative majeure, lue en majeur), score MIREX 92 % ; 54/54 batteries sans
tonalité ; boucle / one-shot 90/90. Ambiguïtés réelles : un breakbeat à 80 BPM en doubles-croches et une dnb à 160
sont le même signal (lu 160).

### Risques ouverts

- tauri-specta est en RC : surveiller la sortie de la 2.0 stable et lever l'épinglage.
- Phases 4 et 5 à valider sur Mac (`docs/verification-mac.md`) : latence du son (< 30 ms), dépôt dans Ableton Live 12
  et Logic, glisser HTML des dossiers virtuels toujours actif à côté du glisser natif, « Toujours au premier plan »
  au-dessus d'un DAW en plein écran.
- macOS ne fait passer Tab sur les boutons d'une page web que si « Navigation au clavier » est activée : les Réglages
  et « Créer un vrai dossier » peuvent être inaccessibles au clavier sans elle. À mesurer avant d'ajouter une
  navigation au clavier propre à ces vues.
- Les MacBook n'ont pas de F10 sans fn : ⇧F10 peut être pénible ; à revoir après usage.
- Réglages dans le `localStorage` de WKWebView : à vérifier qu'ils survivent à une mise à jour de l'app.
- Analyse : réglée sur un jeu synthétisé ; à confronter à de vrais packs (test ignoré `vrai_dossier_compare_aux_noms`).
  Erreurs d'octave possibles sur les tempos lents ou très rapides quand le nom ne dit rien (80 ↔ 160, 87 ↔ 174) ;
  tempo libre à ±2 % pour une boucle suivie de silence.
- Pas de réglage pour suspendre l'analyse (deux threads, priorité normale) : à ajouter si elle gêne pendant une
  session sur batterie.
- En développement, recharger la page (F5) laisse d'anciens écouteurs d'événements Tauri actifs (dépôts reçus en
  double ou triple) ; sans effet dans l'app livrée, qui ne recharge pas sa page.
- Rendu : ~27 ms dans le conteneur sans GPU quand ~70 lignes nouvelles apparaissent ; à mesurer sur Mac (⌥⌘D).
- Pendant un scan, le catalogue est rechargé (0,25–0,3 s à 100 000 fichiers) au plus une fois par seconde, verrou tenu :
  une frappe peut attendre d'autant. À rendre incrémental si c'est gênant sur Mac.
- Le sélecteur de dossier GTK ne liste rien dans le conteneur de test (pas de gvfs) : ⌘O n'est vérifiable que sur Mac.
- Tauri reçoit les fichiers déposés sur la fenêtre (dépôt de dossiers) : sur macOS le glisser-déposer interne (HTML5) continue de marcher, à vérifier sur Mac.
- La parité porte sur les données factices ; elle disparaît en phase 2 (données réelles), où les tests de `tree()` prendront le relais.
