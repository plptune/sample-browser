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
- [ ] Glisser un dossier virtuel (au pointeur, ni HTML ni natif) sur un autre : il s'y déplace ; sur le fond de
      l'onglet : il remonte à la racine ; survoler l'onglet l'ouvre après 500 ms ; près du bord bas ou haut de
      l'arbre, il défile. Pareil avec « Keep the DAW in front » activé (panneau non activant).
- [x] **Panneau non activant** (« Keep the DAW in front », activé), Bitwig avec Serum ouvert : glisser un sample sur
      Serum le charge, Serum reste affiché ; taper dans la recherche aussi ; juste après le dépôt, Espace lance le
      transport de Bitwig. (Vérifié le 11 oct. 2026.)
- [ ] **Redimensionner ensemble** (« Resize the DAW with Crate », autorisation Accessibilité accordée) : Crate calé à
      gauche (⌘⌥←), Bitwig collé à droite ; tirer le bord droit de Crate fait suivre Bitwig en direct ; tirer le bord
      gauche de Bitwig fait suivre Crate. Même chose Crate à droite (⌘⌥→). Traces `tile : …` avec `CRATE_TRACE=1`.
- [ ] Fenêtres écartées de plus de quelques points, ou Bitwig en plein écran : rien ne bouge. Déplacer Bitwig par sa
      barre titre ne bouge pas Crate ; ⌘⌥← / ⌘⌥→ / ⌘⇧F ne touchent pas Bitwig. Autorisation absente : le bouton « Open
      settings » ouvre Réglages Système › Accessibilité.
- [ ] Même réglage : la barre des menus reste celle de Bitwig ; pas de clignotement gênant de Crate quand le clavier
      revient au DAW. Si Crate plante au lancement, relancer avec `CRATE_TRACE=1` : l'exception ObjC est journalisée.
- [ ] Même réglage : ⌘F dans Bitwig met le curseur dans la recherche, Serum reste là ; Échap dans la recherche vide rend
      le clavier à Bitwig. Échap ne ferme jamais la fenêtre de Crate.
- [ ] Dans la recherche, panneau actif : ⌘C / ⌘V / ⌘A / ⌘Z, accents (é, ê par touche morte). ⌘O ouvre le sélecteur
      avec le focus (Crate s'active alors, normal).
- [ ] Feux macOS, déplacement par la barre titre, ⌘⇧F, ⌘⌥← / →, « Toujours au premier plan », Bitwig en plein écran.
- [ ] Réglage décoché : comportement d'avant (Crate s'active au clic, Serum disparaît). Même parcours rapide dans Live 12.

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

## 6 ter. Deux modes séparés : colonne et fenêtre bibliothèque

- [ ] Expanded : cliquer un dossier de l'explorer pose une chip `path:"…/"` dans la recherche (liste limitée à ce dossier
      et ses sous-dossiers) ; ↑ / ↓ la remplacent ; Échap la retire. Onglet Virtuals : un dossier virtuel ne pose pas de
      chip. ⌘S depuis un dossier : la collection smart garde le `path:`. Taper `path:` propose les dossiers.
- [ ] Onglet Virtuals : bouton « New folder » visible (libellé en Expanded, icône en colonne).
- [ ] Glisser un son de la bibliothèque depuis le Finder, puis depuis Sononym, sur un dossier virtuel (colonne et
      Expanded) : le bloc du dossier s'éclaire (descendants ouverts compris, pas les parents), le son y est ajouté. Un
      dossier de source déposé : tous ses sons. Un son hors source : message, rien d'ajouté. Sans cible, un dossier
      déposé devient une source.
- [ ] Preview : badge loop / one-shot, « A minor », BPM, extension ; plus de temps, de kHz ni de bits ; chemin jusqu'au
      dossier.
- [ ] Expanded : colonne Type (badges, tri) ; clic droit sur l'en-tête pour masquer une colonne, en-tête tiré pour
      changer l'ordre (dans la fenêtre Tauri) ; quitter et relancer : colonnes gardées. Un dossier virtuel choisi → chip
      de portée (× / ⌫). Tiroir : « Type: » puis « Tags: ».
- [ ] Réglages › Playback › Shortcut : la fenêtre de capture montre le raccourci tapé (⌘F compris, même avec Bitwig
      devant) ; Accept l'enregistre, Cancel / Échap non ; le nouveau raccourci marche ensuite dans Bitwig.
- [ ] Bouton de mode (ou ⌘⇧F) : la fenêtre remplit la zone utile de l'écran (sans nouveau Space, sous la barre des
      menus, au-dessus du Dock) ; explorer à gauche, preview, recherche et liste à droite. « Side panel » (ou ⌘⇧F) la
      remet en colonne, à sa taille et sa place d'avant.
- [ ] Bouton vert grisé dans les deux modes ; double-clic sur la barre titre sans effet ; la colonne ne s'élargit pas
      au-delà de 600 pt ; la fenêtre bibliothèque (« Expanded ») se réduit à la main jusqu'à 640 × 480 pt (une autre
      app sur une moitié d'écran), l'explorer et la liste restent lisibles.
- [ ] Quitter en bibliothèque, relancer : elle se rouvre en bibliothèque. Quitter en colonne après l'avoir déplacée :
      elle se rouvre à sa place.
- [ ] ⌘⌥← depuis la bibliothèque : colonne calée à gauche, d'une touche.
- [ ] Avec « Resize the DAW with Crate » : en bibliothèque, Bitwig ne bouge pas ; de retour en colonne, il suit de
      nouveau.
- [ ] En bibliothèque, Crate est une fenêtre ordinaire (barre des menus de Crate, ⌘Q quitte Crate) ; « Toujours au
      premier plan » ne s'y applique pas ; de retour en colonne, le panneau non activant et le premier plan reviennent
      (Serum reste ouvert pendant un glisser).
- [ ] Explorer : clic sur un dossier → la liste montre toute sa sous-arborescence ; ↑ / ↓ changent la portée ; Échap
      → « All samples ». Tri par BPM / Key dans les deux sens ; ⌥⌘D reste sous 16 ms à la frappe, portée « All
      samples » comprise, sur une grosse bibliothèque.
- [ ] Preview : waveform cliquable, lecture, × sur un tag, champ « Add… », clic sur « In: », « Show in Finder ».

## 6 quater. Retours du premier essai

- [ ] Premier lancement (ou réglages jamais touchés) : ↓ joue le sample tout de suite ; le bouton ≡▶ du tiroir coupe la
      lecture auto, et ↓ ne joue plus.
- [ ] En colonne : pas de colonne de tonalité ; onglets en icônes (infobulle « Bibliothèque (⌘1) ») ; icône de type
      devant chaque nom (dossier, onde, note pour un `.mid`).
- [ ] ⌘← et ⌘→ replient tout et le curseur reste sur le dossier de premier niveau ; dans le champ de recherche, ils vont en début / fin de ligne.
- [ ] Pendant une recherche : un dossier se referme et se rouvre (chevron, double clic, ← / →) ; ⌘→ depuis l'arbre replie tout.
- [ ] La ligne en lecture n'a plus de ▶.
- [ ] ⌘⌥→ cale la fenêtre à droite de l'écran, sur toute la hauteur (sous la barre des menus, au-dessus du Dock) ; ⌘⌥← à gauche ; depuis la fenêtre bibliothèque, elle revient d'abord en colonne.
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
      `com.bitwig.studio`), idem Live (`com.ableton.live`). Traces : lancer avec `CRATE_TRACE=1` (app active, raccourci
      enregistré ou refusé, appui, retour au DAW).

## 6 sexies. Retours n° 2

- [ ] Toute l'interface est en anglais (menus, Réglages, notices, sélecteur de dossier ⌘O).
- [ ] Cliquer très vite plusieurs fois dans la waveform pendant la lecture : plus aucun clic ; pareil en passant d'un
      sample à l'autre avec ↓ (lecture auto).
- [ ] Waveform du tiroir et de l'inspecteur : forme pleine et nette (plus de barres) ; la tête de lecture avance
      sans à-coups ; redimensionner la fenêtre redessine à la bonne finesse.
- [ ] Glisser un sample vers Bitwig ou Live : plus de « 1 » transparent sous le curseur.
- [ ] Tiroir : tags, puis dossier relatif (« Drums/Kicks/ »), puis nom.ext ; pas de durée.
- [ ] Explorer en colonne : icône + nom.ext ; lignes de parenté discrètes ; ← ferme, → ouvre.
- [ ] Recherche : ↓ ne s'arrête que sur des samples ; « Flatten » sous le champ : liste à plat,
      retrouvée après relance.

## 6 septies. Dossiers aplatis, waveform

- [ ] ↓ rapide en lecture auto : la waveform apparaît directement nette (un court vide, jamais de bâtons ni de flou).
- [ ] Clic droit sur un gros dossier › Flatten : tous ses samples, sans sous-dossiers ; icône à astérisque ;
      l'entonnoir passe en bleu ; son menu le liste et le retire ; une recherche le retire aussi.
- [ ] En recherche, une bande sous le champ : « Flatten » met à plat et passe en ambre ; l'icône aléatoire à côté
      remélange à chaque clic ; modifier la recherche revient à l'ordre normal ; Flatten reste actif après relance.

## 6 nonies. Filtres rapides

- [ ] Entonnoir : cocher Favorites puis Minor sans que le menu se ferme ; deux chips apparaissent ; seuls des favoris
      en tonalité mineure restent. Loops puis One-shots : une seule chip. Une collection de la liste : ses samples.

## 6 octies. Tags automatiques

- [ ] Après l'analyse (version 2 : tout est refait, ~10 à 20 min pour 40 000 fichiers) : les samples bien nommés ont
      leur instrument (en italique) ; le type (`loop` / `oneshot`) est le premier tag, sans ×.
- [ ] Un sample au nom muet (`Sample 017.wav`) dans un dossier « Kicks » reçoit `kick` ; une voix sans nom parlant
      reçoit souvent `vocal`.
- [ ] × sur un tag automatique : il disparaît et ne revient pas après relance (ni après une réanalyse).
- [ ] Taper soi-même un tag automatique dans « Add… » : il n'est plus en italique.
- [ ] `#kick`, `#wet`, `#loop` dans la recherche ; `#lo` propose `#loop` avec son nombre.
- [ ] Mémoire au repos toujours < 150 Mo une fois le modèle chargé (après une analyse).

## 6 decies. Retours n° 4

- [ ] Clic droit bref sur un sample en bas de la colonne : le menu reste ouvert, rien ne se lance. Appuyer, glisser
  jusqu'à un item et relâcher le choisit encore.
- [ ] Espace vers Bitwig : remplacé par le script de contrôleur, voir §6 undecies.
- [ ] Colonne : un sample avec beaucoup de tags garde le tiroir sur une ligne ; les premiers tags entiers, la liste
  complète au survol.

## 6 undecies. Espace pilote Bitwig (script de contrôleur)

- [ ] Réglages › From the DAW › « Space plays Bitwig » activé : « Waiting for Bitwig — … » s'affiche, pas de
  demande d'Accessibilité.
- [ ] « Install Bitwig script » : le chemin s'affiche ; `~/Documents/Bitwig Studio/Controller Scripts/Crate/Crate.control.js`
  existe.
- [ ] Dans Bitwig : Settings › Controllers › Add controller manually › Crate › Crate. Les Réglages de Crate passent à
  « Bitwig connected » en moins de 2 s.
- [ ] Espace dans la liste de Crate lance puis arrête Bitwig ; ↑/↓ pilotent toujours Crate.
- [ ] Preview en lecture : Espace l'arrête et lance Bitwig ; un nouvel Espace arrête Bitwig, la preview ne repart pas.
- [ ] Réglage décoché : Espace revient à la preview de Crate.
- [ ] ChorusBench marche toujours à côté (ports 9000 / 9001).
- [ ] Bitwig fermé ou contrôleur retiré : « Waiting for Bitwig » revient en moins de 5 s.

## 6 duodecies. Retours n° 5 : glisser natif, panneaux Library et Virtual

- [ ] Glisser natif sur un écran Retina : le dossier éclairé est celui sous le pointeur, en haut comme en bas de
  l'arbre, en colonne et en Expanded ; nos samples comme des fichiers du Finder (ou de Sononym) déposés sur un
  dossier virtuel.
- [ ] Expanded : Library et Virtual empilés ; ⌘1 / ⌘2 et les deux boutons de la barre titre les masquent et les
  réaffichent ; les deux masqués, la liste prend toute la largeur ; ⌘N réaffiche Virtual, le nouveau dossier en
  renommage.
- [ ] Cliquer un dossier virtuel ne change pas la liste ; déplié, ses samples s'écoutent (preview, Espace) ; la
  sélection de la liste se vide.
- [ ] Glisser un sample depuis le panneau Virtual vers un autre dossier virtuel (et vers le DAW après ⌘⌥←).
- [ ] Glisser un sample de la liste au-dessus du bouton d'un panneau masqué : il revient après ½ s.
- [ ] Séparateur horizontal : tirer, ↑ / ↓ au clavier, double-clic ; aucun panneau sous ~5 lignes.
- [ ] Fenêtre réduite à 640 × 480 pt avec les deux panneaux : tout tient, rien ne déborde.
- [ ] Relance : panneaux affichés et répartition retrouvés.

## 7. Mémoire, taille, lancement (budgets du plan)

- [ ] Lancement à froid → arbre affiché < 400 ms avec 100 000 fichiers (chronomètre ou Instruments).
- [ ] Mémoire au repos < 150 Mo (Moniteur d'activité, après un scan de 100 000 fichiers).
- [ ] Taille de `Crate.app` < 21 Mo (20,5 Mo mesurés avec le modèle de tags).
- [ ] Mac Intel (si disponible) : l'app se lance et joue (le build CI est Apple Silicon).

## 8. Déjà noté comme limite (pas un bug à chercher)

- En `pnpm tauri dev`, recharger la page (F5) laisse d'anciens écouteurs actifs : dépôts reçus en double. L'app livrée
  ne recharge jamais sa page.
- Le prototype en ligne et Storybook restent sur des données factices : ni son, ni Finder, ni glisser natif, ni
  analyse.
- Tempo d'un sample au nom muet : une erreur d'octave reste possible (80 ↔ 160, 87 ↔ 174) ; une boucle suivie de
  silence a un tempo à ±2 %.
