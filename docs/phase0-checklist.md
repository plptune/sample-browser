# Phase 0 — checklist de validation

À parcourir dans le prototype (`pnpm dev` ou https://plptune.github.io/sample-browser/) : touches 1–9, 0, -, =
pour les scénarios, barre de démo pour le thème, la largeur, la densité et la grille de 4 px. Même parcours possible
dans Storybook, rubrique **Écrans / Panneau**, et dans la vraie fenêtre (`pnpm tauri dev` ou l'artefact `Crate-macos`).

Cocher une ligne = « validé tel quel ». Tout écart se corrige en phase 0, pas plus tard.

## À vérifier sur tous les écrans

- [ ] Sombre **et** clair, à 260, 300, 380 et 520 px : rien ne déborde, rien ne se chevauche.
- [ ] Grille 4 px activée : hauteurs et marges tombent sur la grille.
- [ ] Deux colonnes d'alignement seulement : icônes (chevron, ▶, !, coche) à 8 px, libellés à 24 px, +16 px par niveau.
- [ ] Un seul accent (ambre), uniquement pour : lecture, progression, focus clavier, cible de dépôt, champ en édition.
- [ ] Aucun compteur, aucune extension de fichier, aucune icône de dossier ou de fichier.
- [ ] Sous 280 px, la colonne BPM disparaît ; la clé reste.

## Scénarios

| # | Scénario | Ce qu'il faut regarder | Décision prise seul |
| --- | --- | --- | --- |
| 1 | Premier lancement | Zone de dépôt en pointillés, une phrase, raccourci ⌘O. Rien d'autre (pas de recherche, pas d'arbre). | Pas de bouton « Ajouter » : le glisser-déposer et ⌘O suffisent. |
| 2 | Indexation en cours | Barre de progression de 1 px sous le statut ; l'arbre se remplit par paliers sans sauter. | Statut sous la recherche, pas dans la barre titre. |
| 3 | Navigation | Samples › Drums › Kicks ouverts, un kick sélectionné, tiroir à jour. → / ← ouvrent, ferment, remontent. | Dossiers puis samples au même niveau de retrait, triés par nom. |
| 4 | Recherche active | 3 chips, autocomplétion `#` ouverte, arbre élagué aux dossiers qui ont des résultats, tous ouverts. | Les collections disparaissent pendant une recherche (sinon doublons). |
| 5 | Aucun résultat | Message + exemples de syntaxe en mono. Tiroir conservé. | — |
| 6 | Lecture | ▶ ambre dans la ligne, ■ dans le tiroir, tête de lecture qui avance, temps qui défile. | Pas d'auto-play par défaut (activable dans les Réglages). |
| 7 | Tagging | 4 samples sélectionnés, popover sous la recherche : ✓ = tous ont le tag, – = certains, vide = aucun. Saisir un nom inconnu propose « Créer ». | Tags triés par fréquence, pas par état, pour que la liste ne saute pas quand on coche. |
| 8 | Collections (⌘S) | Barre « Nouvelle collection smart » sous la recherche, nom en édition (contour ambre), ⏎ / Échap. Après ⏎ : collection créée et sélectionnée, recherche vidée. | La collection ouverte n'est pas visible ici, puisqu'une recherche masque les collections. Collection manuelle ouverte : voir 6 et 9. |
| 9 | Drag en cours | Ligne glissée atténuée, collection cible encadrée en ambre. Le dépôt ajoute réellement à la collection (mock). | Seules les collections manuelles acceptent un dépôt. |
| 10 | Erreurs | Fichiers introuvables barrés avec « ! » rouge, tiroir « Fichier introuvable », lecture désactivée. Source « hors ligne » grisée. | Le rouge n'est jamais un aplat : texte et « ! » seulement. |
| 11 | Réglages | Vue qui remplace l'arbre (‹ pour revenir) : Sources (retirer au survol), Thème, Densité, Toujours au premier plan, Lecture auto. | Pas de fenêtre secondaire. Interrupteurs gris, pas ambre. |
| 13 | Dossiers virtuels | Onglet Virtuels : Favoris, « Collections » (à plat), Pack 2026 › Drums / Textures, Projets › Night Drive. Épingle à droite de ce qui est aussi affiché dans Bibliothèque. | Les dossiers virtuels sont triés par nom ; les collections dans leur ordre de création. |
| 14 | Créer un vrai dossier | Résumé (27 fichiers · 2 sous-dossiers · 49,1 Mo), destination, garder l'arborescence, ajouter aux sources, « Créer le dossier » (bouton inversé, sans accent). Puis « fichiers copiés » + Ouvrir dans le Finder / Terminé. | Copie simulée en phase 1 ; « Ajouter aux sources » crée bien une source qui reproduit l'arborescence. |
| 12 | Mode waveform | Toutes les lignes de samples en 36 px avec mini-waveform ; dossiers inchangés. | La mini-waveform ne dessine pas les silences (pas de ligne pointillée). |

## Interactions hors scénario

- [ ] Clic droit sur un sample, une source, un sous-dossier, « Collections », une collection : menus différents, ↑↓ ⏎ Échap.
- [ ] Renommer une collection (menu contextuel) : champ en place, ⏎ valide, Échap annule.
- [ ] « Nouvelle collection » (clic droit sur « Collections ») : créée et directement en renommage.
- [ ] ⇧-clic, ⌘-clic, ⇧↑↓ : multi-sélection ; T tague toute la sélection.
- [ ] Onglets : ⌘1 / ⌘2 ; dans Bibliothèque, les éléments épinglés sont après les sources, avec un repère à droite
      (dossier en pointillés, liste, étoile). Survoler « Virtuels » en glissant des samples ouvre l'onglet.
- [ ] Dossiers virtuels : ⌘N (ou +) crée un dossier en renommage ; glisser un dossier sur un autre le déplace ;
      « Retirer de « X » » sur un sample ; une collection n'accepte pas de sous-dossier.
- [ ] Favoris : aucune étoile dans l'arbre ; ⌘D, menu contextuel ou étoile grise du tiroir ; dossier « Favoris » en tête
      des collections ; glisser sur « Favoris » ajoute ; `is:fav` filtre.
- [ ] Finder : clic droit › « Afficher dans le Finder » (sample : son dossier s'ouvre, le fichier sélectionné) ou
      « Ouvrir dans le Finder » (source, sous-dossier, raccourci) ; ⌥⌘R fait pareil sur la sélection. Grisé pour un
      fichier introuvable ou une source hors ligne. Dans le prototype en ligne : une ligne explique que c'est dans l'app.
- [ ] Raccourcis : « Dusty Tapes Vol.2 » à la racine de Bibliothèque, flèche d'alias à droite, sans chevron ; un clic
      saute dans Splice › packs › Dusty Tapes Vol.2 (ouvert, sélectionné). « Épingler dans Bibliothèque » sur un
      sous-dossier, « Retirer de Bibliothèque » sur le raccourci ; rien pour une source.
- [ ] Historique : ⌥← / ⌥→ (ou ⌘[ / ⌘], boutons de la souris) après un raccourci, un changement d'onglet ou une chip
      ramènent l'arbre tel qu'on l'a quitté ; ⌥← dans le champ de recherche déplace le curseur, rien d'autre.
- [ ] Échap ferme d'abord la surcouche ouverte (menu, tags, ⌘S), puis quitte les Réglages, puis arrête la lecture.

## Fenêtre Tauri

La liste complète de ce qui reste à vérifier sur Mac, phases 0 à 6, est dans
[`verification-mac.md`](verification-mac.md) ; les cases ci-dessous en sont le résumé.

- [ ] `pnpm tauri dev` ouvre une fenêtre 320 × 760, largeur minimale 260, barre titre overlay : les feux macOS
      tombent dans les 72 px réservés à gauche de « Crate ».
- [ ] La fenêtre se déplace en tirant la barre titre.
- [ ] Avec `CRATE_DEMO=1`, le panneau est identique au navigateur, sans la barre de démo (touches de scénario actives).
- [ ] Phase 6 : sur un vrai dossier de packs, le test `vrai_dossier_compare_aux_noms` (voir `verification-mac.md`) ;
      BPM et tonalité apparaissent au fil de l'analyse ; elle reprend après relance.
- [ ] Phase 5 : tout au clavier (⇧F10, ⌘⌫, ⌘⇧N, ⇧← / ⇧→) ; masquer / `is:hidden` / afficher ; réglages retrouvés
      après relance ; « Toujours au premier plan » au-dessus du DAW ; vraie progression d'une grosse copie.
- [ ] Phase 4 (sur Mac) : Espace joue avec le son, ⌥⌘D affiche « son … ms » sous 30 ms ; clic dans la waveform ;
      ⌘L ; volume ; ⌘⇧Espace ; glisser un sample dans Ableton Live 12 et dans Logic (piste audio créée) ; glisser
      sur une collection ou « Favoris » dans la fenêtre ; passer au DAW coupe la lecture.
- [ ] Phase 3 : ⌥⌘D affiche les mesures ; sur une grosse bibliothèque, taper « kick » reste sous 16 ms au total ; défiler
      jusqu'en bas d'un dossier de 5 000 samples ne montre pas de ligne vide plus d'un instant ; Réglages › Synonymes.
- [ ] Sans `CRATE_DEMO` (phase 2) : premier lancement vide ; un dossier glissé sur la fenêtre (ou ⌘O) apparaît tout de
      suite, avec « Indexation de … n / total » et une ligne ambre de 1 px sous la recherche pendant le scan ; un fichier
      ajouté dans le Finder apparaît seul ; l'app relancée retrouve tout (tags, collections, dossiers virtuels).

Vérifié dans le conteneur Linux (compilation + rendu sous écran virtuel) ; le rendu macOS est construit par le
workflow « Tauri (macOS) » et reste à valider à la main.

## Composants ajoutés en phase 0 (fiches dans Storybook)

TreeRow / Browser (arbre unique), TagPopover, SaveSearch, ContextMenu, SettingsView, Toggle, Segmented.
Retirés en cours de route : SidebarItem, SampleList / SampleRow, favoris.
