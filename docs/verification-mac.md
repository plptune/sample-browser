# Ce qui reste à vérifier sur Mac

Tout ce qui suit a été construit et testé dans un conteneur Linux (tests Rust, tests navigateur, fenêtre Tauri sous
WebKitGTK et écran virtuel, sans carte son ni GPU). Ces points-là ne peuvent l'être que sur un vrai Mac.

**Préparer :** télécharger l'artefact `Crate-macos` du dernier push (workflow « Tauri (macOS) »), clic droit → Ouvrir
au premier lancement (app non signée). Ou `pnpm tauri dev` depuis le dépôt. Prévoir un dossier de samples réel
(idéalement plusieurs milliers de fichiers, sur le disque interne et sur un disque externe), Ableton Live 12 et Logic.
**⌥⌘D** affiche les mesures en direct (arbre, échange, rendu, total, son) : c'est l'outil de la plupart des cases.

Cocher au fur et à mesure ; noter à côté ce qui ne va pas (mesure, capture).

Un agent local peut faire la partie automatisable (contrôles, mesures, analyse sur de vrais samples, rapport) :
lui donner [`agent-mac.md`](agent-mac.md).

## 1. Fenêtre (phases 0 et 1)

- [ ] La fenêtre s'ouvre en 320 × 760, se rétrécit jusqu'à 260 px de large, pas moins.
- [ ] Barre titre overlay : les feux macOS tombent dans les 72 px réservés, à gauche des onglets, sans les chevaucher.
- [ ] La fenêtre se déplace en tirant la barre titre (pas en tirant un onglet).
- [ ] Réglages › Apparence › Système : le thème suit macOS (y compris le basculement automatique du soir) ;
      Sombre / Clair le forcent.
- [ ] `CRATE_DEMO=1` : panneau identique au prototype en ligne, touches de scénario actives.

## 2. Bibliothèque réelle (phase 2)

- [ ] Premier lancement : panneau vide « Glissez un dossier ».
- [ ] ⌘O ouvre le sélecteur natif de dossier ; le dossier choisi apparaît aussitôt, « Indexation de … n / total » et
      la ligne ambre de 1 px pendant le scan. (Le sélecteur GTK du conteneur ne liste rien : jamais vérifié.)
- [ ] Glisser un dossier depuis le Finder sur la fenêtre : la zone s'éclaire au survol, le dossier est ajouté.
      Glisser un fichier seul : refus en une phrase.
- [ ] Un dossier déjà couvert par une source : refusé avec un message.
- [ ] Ajouter, renommer, supprimer un fichier dans le Finder : l'arbre suit tout seul en une ou deux secondes (FSEvents
      via `notify`). Un fichier supprimé qui était favori / tagué / dans une collection reste visible, barré.
- [ ] Disque externe : l'éjecter → la source passe « hors ligne », ses samples restent visibles ; le rebrancher puis
      « Actualiser » (clic droit sur la source) → tout revient, tags compris.
- [ ] « Actualiser » sur un partage réseau ou un disque où `notify` ne voit rien.
- [ ] Une grosse source (≥ 50 000 fichiers) : l'UI reste fluide pendant le scan (taper, défiler) ; noter la durée totale
      (budget 60 s pour 100 000 ; 1,1–1,8 s mesuré dans le conteneur sur de petits WAV, plus lent attendu sur de vrais
      fichiers). Pendant un scan, une frappe peut attendre ~0,3 s le rechargement du catalogue : gênant ou pas ?
- [ ] Quitter et relancer : sources, tags, favoris, collections, dossiers virtuels, raccourcis, éléments masqués,
      synonymes, tout est là.
- [ ] Clic droit (ou ⌥⌘R) : « Afficher dans le Finder » sélectionne le fichier dans le Finder ; « Ouvrir dans le
      Finder » sur un dossier l'ouvre.

## 3. Arbre et recherche (phase 3)

- [ ] ⌥⌘D, grosse bibliothèque : taper « kick » lettre par lettre → total < 16 ms à chaque frappe (conteneur sans GPU :
      12–13 ms ; jusqu'à ~27 ms quand ~70 lignes nouvelles apparaissent d'un coup — à mesurer sur Mac).
- [ ] Ouvrir un dossier de 5 000 samples : < 16 ms au total.
- [ ] Défiler vite jusqu'en bas de ce dossier (trackpad, puis ↓ maintenu) : pas de ligne vide plus d'un instant,
      défilement à 120 fps sur un écran ProMotion.
- [ ] Densité « Waveform » : les mini-waveforms apparaissent au fil du calcul de fond, sans saccade.
- [ ] Réglages › Synonymes : ajouter un groupe, la recherche le prend tout de suite ; relancer, il est toujours là.

## 4. Son et glisser vers le DAW (phase 4)

- [ ] Espace joue avec le son ; ⌥⌘D affiche « son … ms » **sous 30 ms** (premier son), sur la sortie intégrée puis sur
      une interface audio USB.
- [ ] Changer de sortie audio dans macOS pendant que Crate tourne : la lecture continue sur la nouvelle sortie ? (Non
      géré explicitement : la sortie est ouverte au lancement. Noter le comportement.)
- [ ] Fichiers à 44,1 / 48 / 96 kHz, mono et stéréo, wav / aif / flac / mp3 / ogg : hauteur juste, pas de craquement.
- [ ] Clic dans la waveform du tiroir : lit depuis ce point ; ⇧← / ⇧→ recule / avance d'un dixième.
- [ ] ⌘L boucle sans trou audible ; volume (Réglages) ; ⌘⇧Espace joue un sample au hasard.
- [ ] Passer sur le DAW (⌘Tab) coupe la lecture ; commencer un glisser aussi (deux réglages, activés par défaut).
- [ ] Glisser un sample dans **Ableton Live 12** : sur une piste audio, dans une cellule de Session, dans un Simpler /
      Drum Rack. Glisser trois samples d'un coup. L'icône « nombre de fichiers » suit le pointeur.
- [ ] Même chose dans **Logic** (piste audio créée, région au bon endroit) et dans le **Finder** (copie du fichier).
- [ ] Dans la fenêtre, avec ce même glisser natif : déposer sur une collection manuelle, un dossier virtuel,
      « Favoris » ; survoler l'onglet « Virtuels » l'ouvre après 500 ms ; aucun dépôt n'est pris pour un dossier venu
      du Finder (pas de source ajoutée par erreur).
- [ ] Glisser un dossier virtuel sur un autre (glisser HTML, pas natif) : il s'y déplace. À vérifier parce que Tauri
      intercepte les dépôts de fichiers sur la fenêtre.

## 5. Tags, collections, masquer, clavier (phase 5)

Les mutations, leur persistance et l'absence d'écriture dans les dossiers de l'utilisateur sont prouvées par les tests
Rust (`crates/crate-core/tests/library.rs`). Reste l'usage réel :

- [ ] **Sans souris**, de bout en bout : ⌘O, ⌘F, ↑↓, ⏎, T (taguer), ⌘D, ⌘S, ⌘N, ⌘⇧N, ⌘⌫, ⇧F10 (menu de la ligne),
      ⌘1 / ⌘2, ⌥← / ⌥→, ⌘, puis Tab dans les Réglages. **Point à surveiller :** sur macOS, Tab ne passe sur les
      boutons d'une page web que si « Navigation au clavier » est activée (Réglages Système › Clavier) ou avec ⌥Tab.
      Noter si les Réglages et la vue « Créer un vrai dossier » restent utilisables sans.
- [ ] ⇧F10 (ou la touche Menu d'un clavier PC) ouvre le menu sous la ligne courante, ↑↓ ⏎ Échap le pilotent.
      Les MacBook n'ont pas de F10 sans fn : ⇧fn F10 — trouver mieux si c'est pénible.
- [ ] Masquer un sample (⌘⌫ dans la Bibliothèque, ou menu) : il disparaît, un message rappelle `is:hidden`.
      `is:hidden` le montre en italique gris ; « Afficher » le fait revenir. Idem pour un sous-dossier
      (« Masquer le dossier »). Relancer : toujours masqué. Vérifier dans le Finder que le fichier n'a pas bougé.
- [ ] ⌘⌫ dans une collection manuelle, « Favoris » ou un dossier virtuel : retire de là, ne masque rien.
- [ ] Menu d'un dossier virtuel › « Déplacer dans » : même effet que le glisser.
- [ ] Réglages mémorisés d'un lancement à l'autre : thème, densité, lecture auto, toujours au premier plan, boucle,
      volume, arrêt au glisser, arrêt en arrière-plan.
- [ ] « Toujours au premier plan » : Crate reste au-dessus d'Ableton / Logic en plein écran et non plein écran ;
      désactivé, il repasse derrière. Comportement avec les Spaces (bureaux multiples) : à noter.
- [ ] « Créer un vrai dossier » sur une grosse collection (≥ 1 Go, disque externe en destination) : la barre de
      progression avance vraiment, l'UI reste utilisable pendant la copie, rien n'est écrasé (« nom 2 »), « Ouvrir dans
      le Finder » à la fin. Une destination non vide est refusée.

## 6. Analyse de fond (phase 6)

L'analyse est réglée sur un jeu synthétisé (`crates/crate-core/tests/analysis.rs`). Sur de vrais samples :

- [ ] Sur un dossier de packs dont les noms portent tempo et tonalité (`…_120_Am.wav`), lancer depuis le dépôt :
      `CRATE_ANALYSIS_DIR=~/Music/Samples cargo test --release -p crate-core --test analysis -- --ignored --nocapture`.
      Le test analyse chaque fichier **sous un nom neutre** et compare au nom. Noter les deux scores (BPM, tonalité)
      et les erreurs typiques (octave, relative majeure / mineure).
- [ ] Ajouter un gros dossier (≥ 10 000 fichiers) : Réglages › Sources affiche « Analyse du tempo et de la
      tonalité · n / total » ; noter la durée totale. Pendant ce temps, le DAW ne craque pas (deux threads seulement)
      et la frappe reste sous 16 ms (⌥⌘D).
- [ ] BPM et tonalité apparaissent dans les lignes au fil de l'analyse, sans rien faire ; `bpm:120-128`, `key:Am`,
      `key:A#` (trouve `Bb`), `type:loop` donnent des résultats crédibles sur des fichiers aux noms muets.
- [ ] Quitter pendant l'analyse, relancer : elle reprend où elle en était (le compteur repart du reste).
- [ ] Un fichier modifié dans le Finder (remplacé par un autre son) est réanalysé.

## 6 bis. Fichiers MIDI

- [ ] Un dossier de packs avec des `.mid` (accords, basses, mélodies, batterie) : ils apparaissent avec « MIDI » à
      droite ; `type:midi` les isole ; BPM et tonalité affichés.
- [ ] Espace : le piano part tout de suite (⌥⌘D « son … ms » sous 30 ms) ; le son est propre (pas de saturation sur
      un accord chargé, pas de clic en fin de boucle) ; ⌘L boucle juste ; clic dans la waveform et ⇧← / ⇧→.
- [ ] Un `.mid` de batterie (canal 10) sonne comme une batterie, pas comme un piano.
- [ ] Glisser un `.mid` dans Ableton Live 12 (piste MIDI : clip créé, notes correctes) et dans Logic (région MIDI).
- [ ] Tonalités lues sur des clips aux noms muets : crédibles ? (noter les erreurs.)

## 6 ter. Deux modes d'affichage

- [ ] Bouton ⤢ (ou ⌘⇧F) : la fenêtre s'agrandit à l'écran (sans nouveau Space), l'arbre gagne Durée / Format / Tags et
      l'inspecteur apparaît à droite ; re-cliquer (ou ⌘⇧F) la remet en colonne, à sa taille et sa place d'avant.
- [ ] Le bouton vert de la fenêtre et un double-clic sur la barre titre font la même chose (la disposition suit).
- [ ] Quitter en grand, relancer : la fenêtre se rouvre agrandie, en mode grand.
- [ ] Inspecteur : waveform cliquable, lecture, × sur un tag, « + tag », clic sur une collection, « Afficher dans le
      Finder ». Rien ne saute ni ne clignote en passant d'un mode à l'autre ; ⌥⌘D reste sous 16 ms en mode grand.

## 6 quater. Retours du premier essai

- [ ] Premier lancement (ou réglages jamais touchés) : ↓ joue le sample tout de suite ; le bouton ≡▶ du tiroir coupe la
      lecture auto, et ↓ ne joue plus.
- [ ] En colonne : pas de colonne de tonalité ; onglets en icônes (infobulle « Bibliothèque (⌘1) ») ; icône de type
      devant chaque nom (dossier, onde, note pour un `.mid`).
- [ ] ⌘← replie tout et le curseur reste sur le dossier de premier niveau ; dans la recherche, ⌘← va en début de ligne.
- [ ] Tiroir : « Tags : » montre les tags ; taper un nom + ⏎ l'ajoute (suggestions des tags existants), × le retire.
- [ ] Ligne sélectionnée bien visible (bleu), lisible en sombre et en clair, en colonne et en grand (tags compris).
- [ ] Réglages : 4 onglets ; Apparence › Taille du texte S / M / L change tout le panneau ; les couleurs accent,
      sélection et fond se règlent (et se rétablissent) ; tout est retrouvé après relance.

## 6 quinquies. Recherche depuis le DAW

Rien de tout ça ne se teste hors d'un Mac (la logique, si : `cargo test -p crate-app`).

- [ ] Crate lancé, Live devant : ⌘F met Crate devant, curseur dans la recherche, texte précédent sélectionné.
      Pareil avec Bitwig.
- [ ] ⌘Tab vers Live puis ⌘F tout de suite : ça marche aussi (le raccourci est pris à temps).
- [ ] Safari, Finder, Notes : ⌘F inchangé (leur propre recherche).
- [ ] Échap sur la recherche vide : retour à Live. Glisser un sample dans Live : retour à Live.
      Si l'on a cliqué une autre app entre-temps : pas de retour.
- [ ] Live en plein écran : ⌘F affiche Crate par-dessus, sans changer d'espace.
- [ ] Réglages › Lecture › Depuis le DAW : couper l'interrupteur rend ⌘F à Live ; changer le raccourci (ex. ⌃⌥Espace)
      prend effet tout de suite ; cocher Logic Pro fait marcher Logic.
- [ ] Identifiants à confirmer si un DAW ne réagit pas : `osascript -e 'id of app "Bitwig Studio"'` (attendu
      `com.bitwig.BitwigStudio`), idem Live (`com.ableton.live`).

## 6 sexies. Retours n° 2

- [ ] Toute l'interface est en anglais (menus, Réglages, notices, sélecteur de dossier ⌘O).
- [ ] Cliquer très vite plusieurs fois dans la waveform pendant la lecture : plus aucun clic ; pareil en passant d'un
      sample à l'autre avec ↓ (lecture auto).
- [ ] Waveform du tiroir et de l'inspecteur : forme pleine et nette (plus de barres) ; la tête de lecture avance
      sans à-coups ; redimensionner la fenêtre redessine à la bonne finesse.
- [ ] Glisser un sample vers Bitwig ou Live : plus de « 1 » transparent sous le curseur.
- [ ] Tiroir : tags, puis dossier relatif (« Drums/Kicks/ »), puis nom.ext ; pas de durée.
- [ ] Explorer en colonne : icône + nom.ext ; lignes de parenté discrètes ; ← ferme, → ouvre.
- [ ] Recherche : ↓ ne s'arrête que sur des samples ; menu à droite du champ → « Flat results » : liste à plat,
      retrouvée après relance.

## 7. Mémoire, taille, lancement (budgets du plan)

- [ ] Lancement à froid → arbre affiché < 400 ms avec 100 000 fichiers (chronomètre ou Instruments).
- [ ] Mémoire au repos < 150 Mo (Moniteur d'activité, après un scan de 100 000 fichiers).
- [ ] Taille de `Crate.app` < 15 Mo.
- [ ] Mac Intel (si disponible) : l'app se lance et joue (le build CI est Apple Silicon).

## 8. Déjà noté comme limite (pas un bug à chercher)

- En `pnpm tauri dev`, recharger la page (F5) laisse d'anciens écouteurs actifs : dépôts reçus en double. L'app livrée
  ne recharge jamais sa page.
- Le prototype en ligne et Storybook restent sur des données factices : ni son, ni Finder, ni glisser natif, ni
  analyse.
- Tempo d'un sample au nom muet : une erreur d'octave reste possible (80 ↔ 160, 87 ↔ 174) ; une boucle suivie de
  silence a un tempo à ±2 %.
