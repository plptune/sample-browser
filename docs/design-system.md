# Crate — design system (v0.1)

Inspiré du browser d'Ableton Live : dense, plat, gris, lisible à 11 px. Une colonne de 260–520 px.

## Principes

1. **Gris d'abord, un accent et un primaire.** L'ambre (`--cr-accent`) n'apparaît que pour : la lecture en cours,
   une progression, le focus clavier, une cible de dépôt. Le bleu (`--cr-primary`) ne sert qu'à la sélection : ligne
   sélectionnée de l'arbre, onglet actif. Jamais en aplat décoratif.
2. **Pas d'icône sans fonction.** 23 icônes au total (`Icon.tsx`), trait 1,2 px sur 12 × 12. Chaque ligne de l'arbre
   porte une icône de type (dossier, sample, MIDI, collection, dossier virtuel, favoris, collection smart) : on
   distingue un clip MIDI d'un son sans lire le nom.
3. **La hiérarchie vient du texte**, pas des couleurs : `--cr-text` → `-2` → `-3` → `-disabled`.
4. **Grille de 4 px**, hauteurs fixes (ligne 24 px, 36 px avec waveform, item 22 px, en-tête 20 px).
5. **Deux colonnes d'alignement**, partout dans le panneau :
   - icônes (chevron, ▶ de lecture, ! introuvable) à `--cr-gutter` = 8 px ;
   - libellés (sections, items, titre du tiroir) à 8 + 12 + 4 = 24 px ; dans l'arbre, l'icône de type s'intercale :
     libellés à `--cr-label-x` = 24 + 12 + 4 = 40 px (l'en-tête de colonnes du mode grand s'y aligne) ;
   - chaque niveau d'arbre décale de `--cr-indent` = 12 px, donc le chevron d'un enfant tombe sous l'icône de type
     de son parent. Chaque ligne a un emplacement fixe `cr-node__slot` de 12 px (chevron, ▶, ! ou vide).
6. **États par attributs** `data-*` (`data-selected`, `data-playing`, `data-open`…), jamais par classes ad hoc.
7. **Aucune valeur en dur** dans `bundle.css` : tout passe par `tokens.css`.
8. **Contraste ≥ 4,5:1** pour le texte des lignes, du tiroir et de l'inspecteur, sélection comprise, dans les deux
   thèmes et les deux modes : vérifié par `tests/e2e/contraste.spec.ts` (couleurs lues telles que rendues).
   `--cr-text-3` (≈ 3:1) est réservé à ce qui se lit sans s'y arrêter : en-têtes de section, icônes, indications.

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `src/styles/tokens.css` | Tokens : couleurs (sombre + clair), typo, espacements, dimensions |
| `src/styles/bundle.css` | Classes `cr-*` de tous les composants |
| `src/components/*.tsx` | Un composant Solid par composant documenté |
| Storybook (`pnpm storybook`) | Chaque composant dans chacun de ses états, thème et largeur depuis la barre d'outils. Les stories (`*.stories.tsx`) sont à côté des composants. |

## Tokens

| Groupe | Tokens |
| --- | --- |
| Base (modifiables) | `--cr-bg` (fond de l'arbre, #232323 en sombre) · `--cr-accent` · `--cr-primary` : les trois couleurs réglables dans Réglages › Apparence ; tout le reste en découle |
| Surfaces | `--cr-surface` (barre titre, recherche, tiroir) · `--cr-surface-raised` (champs, popovers) · `--cr-hover` · `--cr-selected` · `--cr-selected-focus` (état actif neutre : menus, boutons) — dérivées de `--cr-bg` par `color-mix` |
| Sélection | `--cr-row-selected` (liste sans focus, primaire à 30 %) · `--cr-row-selected-focus` (avec focus, 55 %) |
| Lignes | `--cr-line` (entre zones) · `--cr-line-soft` (internes) · `--cr-guide` (lignes de parenté de l'arbre, fond + 6 %) |
| Texte | `--cr-text-strong` · `--cr-text` · `--cr-text-2` · `--cr-text-3` · `--cr-text-disabled` |
| Accent | `--cr-accent` · `--cr-accent-soft` (dérivé) · `--cr-on-accent` (noir ou blanc selon la couleur choisie) |
| Système | `--cr-danger` (fichier introuvable, source déconnectée — texte seulement) |
| Waveform | `--cr-wave` · `--cr-wave-played` · `--cr-wave-mini` |
| Typo | `--cr-font`, `--cr-font-mono`, tailles `xs 10` · `sm 11` · `md 12` · `lg 13` (taille du texte M) ; S : 9 · 10 · 11 · 12 ; L : 11 · 12 · 13 · 14 avec lignes de 26 px (38 avec waveform) — `data-font-size` sur `.cr-root` |
| Espace | `--cr-space-0..6` = 2 · 4 · 8 · 12 · 16 · 24 px |
| Grille | `--cr-gutter 8` · `--cr-slot 12` · `--cr-indent 12` (= slot) · `--cr-label-x 40` (libellés de l'arbre) |
| Hauteurs | `--cr-titlebar-h 28` · `--cr-search-h 30` · `--cr-row-h 24` (toute ligne de l'arbre) · `--cr-row-h-wave 36` · `--cr-item-h 22` (autocomplétion) · `--cr-header-h 20` |

## Composants

| Composant | Classe | États | Notes |
| --- | --- | --- | --- |
| PanelShell | `cr-panel`, `cr-titlebar` | `data-density`, `data-layout=side/full` | Barre titre overlay : 72 px réservés aux feux macOS ; à droite, bouton ⤢ / ⤡ (grande fenêtre / colonne, ⌘⇧F) puis Réglages. Container query `panel`. En mode grand : arbre et inspecteur côte à côte (`cr-split`), Réglages et commit centrés (640 px). |
| SearchField | `cr-search` | — | Collé à l'explorer (pas de marge, la bordure basse les sépare), sans loupe ni contour au focus, texte aligné sur les noms de l'arbre. Chips + champ. ⌫ au début supprime la dernière chip, Échap efface, ↓ / ⏎ va dans l'arbre. À droite, bouton d'options (entonnoir) : menu « Search options » (`ContextMenu`) avec « Flat results » (coché = résultats à plat). Une recherche élague l'arbre au lieu d'ouvrir une autre vue. |
| QueryChip | `cr-chip` | `data-kind=tag/filter/exclude`, `data-pending` | Clé en `text-2`, valeur en `text-strong`. Clic = repasser en édition. |
| Autocomplete | `cr-ac` | `data-active` sur l'item | Après `#`, `key:`, `in:`. ↑↓ ⏎/Tab, Échap ferme. |
| ScanStatus | `cr-scan` | — | Barre de progression de 1 px en accent sous le libellé. Compteur masqué tant que le total est inconnu (parcours des dossiers). |
| DebugOverlay | `cr-scan cr-debug` | — | ⌥⌘D, au-dessus du tiroir, en mono : arbre (Rust), échange, rendu, total (+ attente de l'image suivante), lignes. Outil de mesure, pas un élément de l'interface. |
| Notice | `cr-scan cr-notice` | — | Même bande que ScanStatus, texte principal, sans icône : un refus en une phrase (source déjà couverte, pas un dossier). Disparaît après 6 s ou au clic. |
| Tabs | `cr-tabs`, `cr-tab` | `data-active` (fond primaire), `data-icon-only` | Dans la barre titre, après les feux : « Bibliothèque » / « Virtuels » (⌘1 / ⌘2). En colonne, icônes seules (`library` : étagère, `layers` : calques) ; le nom reste dans l'infobulle et `aria-label`. Survoler un onglet pendant un glisser l'ouvre après 500 ms. |
| Browser (arbre) | `cr-tree` | `data-focused`, `data-drop-target` (fond) | Un arbre par onglet. Bibliothèque : sources puis éléments épinglés. Virtuels : Favoris, « Collections », dossiers virtuels. Chaque dossier liste ses sous-dossiers puis ses samples, au même retrait. |
| TreeRow | `cr-node` | `data-kind=folder/shortcut/favorites/group/collection/smart/virtual/sample`, repère `cr-node__marker` (raccourci, dossier virtuel, collection, favoris, épingle), `data-selected`, `data-playing`, `data-missing`, `data-offline`, `data-drop-target`, `data-dragging`, `data-wave`, `data-hidden` (masqué, visible avec `is:hidden` : libellé en `text-3` italique), `--depth` ; icône de type `cr-node__icon` (`data-icon=folder/sample/midi/star/collection/virtual/search`) entre la case du chevron et le libellé ; en mode grand (`wide`), colonnes `cr-col-dur`, `cr-col-fmt`, `cr-col-tags` avant BPM / clé, sous une ligne d'en-têtes `cr-colhead`, renommage en place (`cr-node__input`) | Une seule hauteur (24 px). `cr-node__slot` (12 px) : chevron (dossier), ▶ (lecture), ! (introuvable) ou vide (raccourci : il ne se déplie pas). Samples : nom avec extension. En colonne, rien d'autre (icône + nom) ; en mode grand, colonnes Durée / Format / Tags / BPM / Clé. Lignes de parenté : un trait vertical `--cr-guide` par niveau d'ancêtre, au centre de la case du chevron (`::before`, décor). Sélection : fond primaire, tout le texte en clair. |
| Waveform | `cr-wave` (canvas + `cr-wave__overlay`) | progression | `mini` (arbre) : barres 2 px depuis les 256 pics. `full` (tiroir, inspecteur) : forme pleine continue, enveloppe min / max à 55 % et cœur RMS plein, calculée à la largeur affichée (une colonne par pixel physique, `waveform(id, colonnes)`) ; partie lue et tête de lecture sur un second canvas, à 60 images / s (position extrapolée entre deux événements de lecture). |
| Inspector | `cr-inspector` | vide / sample / lecture / sélection multiple / MIDI / introuvable | Mode grand, à droite de l'arbre (340 px), à la place du tiroir : nom + étoile, grande waveform (120 px, cliquable), ▶ et temps, métadonnées (BPM, clé, type, durée, format), tags avec × et « + tag », « Dans » (collections et dossiers virtuels, cliquables), chemin et « Afficher dans le Finder ». |
| PreviewDrawer | `cr-drawer` | vide / arrêt / lecture / favori / introuvable / lecture auto | De haut en bas : « Tags: » (tags du sample avec ×, champ « Add… » sans contour au focus, suggestions des tags existants au-dessus) ; un trait ; le dossier relatif à la source (`relativeFolder` : dossiers coupés à 10 caractères + « … », une ligne) ; ▶, nom.ext, lecture auto, étoile favori ; waveform (clic : lire depuis ce point). Pas de temps ni de durée. |
| TagPill | `cr-tag` | `data-active`, `data-variant=add` | Contour 1 px, pas de couleur par tag. Plus affiché dans le panneau (v0.4), gardé dans le DS. |
| TagPopover | `cr-popover` | item `data-state=all/some/none`, `data-active` | Touche T sur la sélection. ✓ = tous les samples ont le tag, – = certains. Saisie = filtre ; un nom inconnu propose « Créer ». Coche sur la colonne des icônes. |
| SaveSearch | `cr-save` | — | ⌘S sur une recherche : nom de la collection smart, ⏎ enregistre, Échap annule. Seul champ à contour accent avec le renommage. |
| ContextMenu | `cr-menu` | item `data-active`, `data-danger`, `data-disabled` ; séparateur, en-tête | Clic droit, ou ⇧F10 / touche Menu (ouvert sous la ligne courante). Contenu selon la ligne : sample, source, sous-dossier, groupe Collections, collection, dossier virtuel (« Déplacer dans »). ↑↓ ⏎ Échap. Reste dans le panneau. |
| ShortcutField | `cr-shortcut` | `data-capturing` | Réglages › Lecture › Depuis le DAW : montre le raccourci (⌘F) ; clic puis la combinaison voulue (au moins un modificateur), Échap annule. |
| SettingsView | `cr-settings`, `cr-setting`, `cr-source` | analyse en cours | Remplace l'arbre dans la même colonne (⌘, / Échap). Quatre onglets (`Segmented` sous le titre, le dernier ouvert est retenu le temps de la session) : **Sources** (et, sous elles, « Analyse du tempo et de la tonalité · n / total » tant qu'elle avance), **Apparence** (thème, densité, taille du texte S / M / L, couleurs accent / sélection / fond du thème affiché, chacune rétablissable), **Lecture** (premier plan, lecture auto, boucle, volume, arrêts ; « Depuis le DAW » : interrupteur, raccourci, DAW concernés), **Recherche** (synonymes : un champ par groupe, une ligne vide pour en ajouter). Libellés sur la colonne des libellés de l'arbre. |
| Toggle | `cr-switch` | `data-on` | 24 × 14. Gris, pas d'accent (l'accent reste réservé à la lecture). |
| Segmented | `cr-seg` | item `data-active` | 2 à 3 options courtes. |
| CommitView | `cr-commit` (dans `cr-settings`) | prêt / copie en cours / terminé | « Créer un vrai dossier » : résumé (fichiers, sous-dossiers, taille, introuvables), destination, garder l'arborescence, ajouter aux sources. Rappel « copie : les originaux ne bougent pas ». |
| Button | `cr-button` | `data-variant=primary/secondary`, désactivé | Principal = inversé (texte clair sur fond clair → fond `text-strong`), sans accent. |
| Champ texte | `cr-field` | focus | Destination du commit. |
| IconButton | `cr-icon-btn` | survol, pressé, `data-active`, `data-accent`, désactivé | 20 × 20, icône 12. |
| EmptyState | `cr-empty` | `data-variant=drop/noresults`, `data-over` | Exemples de syntaxe en mono. `data-over` : un dossier du Finder survole la fenêtre. Un clic ouvre le sélecteur (comme ⌘O). |

## Décisions prises seul (à valider)

- **Ligne de 24 px** au lieu des 28 px du plan : plus proche de la densité d'Ableton. Un seul token à changer.
- **Tags sans couleur.** Le schéma prévoit `color_index` ; je l'ignore visuellement pour rester gris.
- **Favoris discrets** (v0.6, après un retrait en v0.3) : jamais d'étoile dans l'arbre. Un dossier système « Favoris » en tête des collections,
  ⌘D et le menu contextuel pour basculer, une étoile grise (pleine si favori) dans le tiroir, `is:fav` dans la recherche.
- **Une seule vue (v0.4)** : plus de sidebar ni de liste à plat. L'arbre des sources s'ouvre directement sur les samples ;
  les collections sont un dossier virtuel en bas. En recherche, seuls les dossiers contenant des résultats restent, tous ouverts,
  et les collections sont masquées (elles dupliqueraient les résultats). Plus de « Tous les samples / Récents / Non tagués »
  (la recherche et `is:untagged` les remplacent). Le bouton d'auto-play a disparu avec la méta du tiroir.
- **Épuré (v0.2)** : pas de compteurs dans la sidebar ni dans l'en-tête de liste, pas de colonne Durée
  (la durée reste dans le tiroir), pas d'extension de fichier, méta du tiroir réduite.
- **Réglages dans la colonne (v0.5)** : pas de fenêtre de préférences ; la vue Réglages remplace l'arbre. L'auto-play y revient.
- **Une recherche masque les collections** : le scénario 8 (⌘S) montre donc la recherche à enregistrer, pas une collection ouverte.
- **Ajouter à une collection** se fait par glisser-déposer ou par le menu contextuel (pas de sous-menu : en-tête « Ajouter à » + collections manuelles).
- **Collections ≠ dossiers virtuels (v0.7)** : une collection est un regroupement à plat (pas de sous-dossier, ni de
  dossier virtuel dedans) ; un dossier virtuel est une arborescence. Les deux peuvent devenir un vrai dossier ; une
  collection, toujours à plat.
- **Repère des éléments épinglés** : à droite de la ligne (colonne des méta), en `text-3`, pour ne pas casser
  l'alignement des icônes à gauche : flèche d'alias (raccourci vers un sous-dossier), dossier en pointillés (virtuel),
  liste (collection), étoile (favoris). Dans
  l'onglet Virtuels, une épingle signale ce qui est aussi affiché dans Bibliothèque.
- **Bouton principal sans accent** : l'ambre reste réservé à la lecture ; le bouton principal est inversé.
- **Les tokens spéciaux en cours de frappe ne filtrent pas** (`#ta` ne vide pas la liste) ; seuls les mots libres filtrent en direct.
