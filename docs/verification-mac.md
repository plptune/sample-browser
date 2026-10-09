# Ce qui reste à vérifier sur Mac

Tout ce qui suit a été construit et testé dans un conteneur Linux (tests Rust, tests navigateur, fenêtre Tauri sous
WebKitGTK et écran virtuel, sans carte son ni GPU). Ces points-là ne peuvent l'être que sur un vrai Mac.

**Préparer :** télécharger l'artefact `Crate-macos` du dernier push (workflow « Tauri (macOS) »), clic droit → Ouvrir
au premier lancement (app non signée). Ou `pnpm tauri dev` depuis le dépôt. Prévoir un dossier de samples réel
(idéalement plusieurs milliers de fichiers, sur le disque interne et sur un disque externe), Ableton Live 12 et Logic.
**⌥⌘D** affiche les mesures en direct (arbre, échange, rendu, total, son) : c'est l'outil de la plupart des cases.

Cocher au fur et à mesure ; noter à côté ce qui ne va pas (mesure, capture).

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

## 6. Mémoire, taille, lancement (budgets du plan)

- [ ] Lancement à froid → arbre affiché < 400 ms avec 100 000 fichiers (chronomètre ou Instruments).
- [ ] Mémoire au repos < 150 Mo (Moniteur d'activité, après un scan de 100 000 fichiers).
- [ ] Taille de `Crate.app` < 15 Mo.
- [ ] Mac Intel (si disponible) : l'app se lance et joue (le build CI est Apple Silicon).

## 7. Déjà noté comme limite (pas un bug à chercher)

- En `pnpm tauri dev`, recharger la page (F5) laisse d'anciens écouteurs actifs : dépôts reçus en double. L'app livrée
  ne recharge jamais sa page.
- Le prototype en ligne et Storybook restent sur des données factices : ni son, ni Finder, ni glisser natif.
