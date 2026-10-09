# Crate — design system (v0.1)

Inspiré du browser d'Ableton Live : dense, plat, gris, lisible à 11 px. Une colonne de 260–520 px.

## Principes

1. **Gris d'abord, un seul accent.** L'ambre (`--cr-accent`) n'apparaît que pour : la lecture en cours,
   une progression, le focus clavier, une cible de dépôt. Jamais en aplat décoratif.
2. **Pas d'icône sans fonction.** 13 icônes au total (`Icon.tsx`), trait 1,2 px sur 12 × 12.
   Pas d'icône de dossier ni de fichier : le chevron suffit à distinguer un dossier d'un sample.
3. **La hiérarchie vient du texte**, pas des couleurs : `--cr-text` → `-2` → `-3` → `-disabled`.
4. **Grille de 4 px**, hauteurs fixes (ligne 24 px, 36 px avec waveform, item 22 px, en-tête 20 px).
5. **Deux colonnes d'alignement**, partout dans le panneau :
   - icônes (chevron, ▶ de lecture, ! introuvable) à `--cr-gutter` = 8 px ;
   - libellés (sections, items, noms de samples, titre du tiroir) à 8 + 12 + 4 = 24 px ;
   - chaque niveau d'arbre décale de `--cr-indent` = 16 px, donc le chevron d'un enfant tombe pile sous
     le libellé de son parent. Chaque ligne a un emplacement fixe `cr-node__slot` de 12 px (chevron, ▶, ! ou vide).
6. **États par attributs** `data-*` (`data-selected`, `data-playing`, `data-open`…), jamais par classes ad hoc.
7. **Aucune valeur en dur** dans `bundle.css` : tout passe par `tokens.css`.

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
| Surfaces | `--cr-bg` (arbre) · `--cr-surface` (barre titre, recherche, tiroir) · `--cr-surface-raised` (champs, popovers) · `--cr-hover` · `--cr-selected` · `--cr-selected-focus` |
| Lignes | `--cr-line` (entre zones) · `--cr-line-soft` (internes) |
| Texte | `--cr-text-strong` · `--cr-text` · `--cr-text-2` · `--cr-text-3` · `--cr-text-disabled` |
| Accent | `--cr-accent` · `--cr-accent-soft` · `--cr-on-accent` |
| Système | `--cr-danger` (fichier introuvable, source déconnectée — texte seulement) |
| Waveform | `--cr-wave` · `--cr-wave-played` · `--cr-wave-mini` |
| Typo | `--cr-font`, `--cr-font-mono`, tailles `xs 10` · `sm 11` · `md 12` · `lg 13` |
| Espace | `--cr-space-0..6` = 2 · 4 · 8 · 12 · 16 · 24 px |
| Grille | `--cr-gutter 8` · `--cr-slot 12` · `--cr-indent 16` (= slot + space-1) |
| Hauteurs | `--cr-titlebar-h 28` · `--cr-search-h 30` · `--cr-row-h 24` (toute ligne de l'arbre) · `--cr-row-h-wave 36` · `--cr-item-h 22` (autocomplétion) · `--cr-header-h 20` |

## Composants

| Composant | Classe | États | Notes |
| --- | --- | --- | --- |
| PanelShell | `cr-panel`, `cr-titlebar` | `data-density` | Barre titre overlay : 72 px réservés aux feux macOS. Container query `panel`. |
| SearchField | `cr-search` | `data-focused` | Champ plus haut que le reste (30 px), texte à 12 px. Chips + champ. ⌫ au début supprime la dernière chip, Échap efface, ↓ / ⏎ va dans l'arbre. Une recherche élague l'arbre au lieu d'ouvrir une autre vue. |
| QueryChip | `cr-chip` | `data-kind=tag/filter/exclude`, `data-pending` | Clé en `text-2`, valeur en `text-strong`. Clic = repasser en édition. |
| Autocomplete | `cr-ac` | `data-active` sur l'item | Après `#`, `key:`, `in:`. ↑↓ ⏎/Tab, Échap ferme. |
| ScanStatus | `cr-scan` | — | Barre de progression de 1 px en accent sous le libellé. |
| Browser (arbre) | `cr-tree` | `data-focused` | **La seule vue.** Sources à la racine, puis « Collections ». Chaque dossier liste ses sous-dossiers puis ses samples, au même retrait. |
| TreeRow | `cr-node` | `data-kind=folder/group/collection/smart/sample`, `data-selected`, `data-playing`, `data-missing`, `data-offline`, `data-drop-target`, `data-dragging`, `data-wave`, `--depth`, renommage en place (`cr-node__input`) | Une seule hauteur (24 px). `cr-node__slot` (12 px) : chevron (dossier), ▶ (lecture), ! (introuvable) ou vide. Samples : BPM et clé à droite, BPM masqué sous 280 px. |
| Waveform | `cr-wave` (canvas) | progression | Barres 2 px, partie lue en accent + tête de lecture 1 px. |
| PreviewDrawer | `cr-drawer` | vide / arrêt / lecture / favori / introuvable | ▶, nom du sample courant, temps / durée, étoile favori (grise, seul endroit où elle apparaît) et waveform. |
| TagPill | `cr-tag` | `data-active`, `data-variant=add` | Contour 1 px, pas de couleur par tag. Plus affiché dans le panneau (v0.4), gardé dans le DS. |
| TagPopover | `cr-popover` | item `data-state=all/some/none`, `data-active` | Touche T sur la sélection. ✓ = tous les samples ont le tag, – = certains. Saisie = filtre ; un nom inconnu propose « Créer ». Coche sur la colonne des icônes. |
| SaveSearch | `cr-save` | — | ⌘S sur une recherche : nom de la collection smart, ⏎ enregistre, Échap annule. Seul champ à contour accent avec le renommage. |
| ContextMenu | `cr-menu` | item `data-active`, `data-danger`, `data-disabled` ; séparateur, en-tête | Clic droit. Contenu selon la ligne : sample, source, sous-dossier, groupe Collections, collection. ↑↓ ⏎ Échap. Reste dans le panneau. |
| SettingsView | `cr-settings`, `cr-setting`, `cr-source` | — | Remplace l'arbre dans la même colonne (⌘, / Échap). Sources, Apparence, Fenêtre et lecture. Libellés sur la colonne des libellés de l'arbre. |
| Toggle | `cr-switch` | `data-on` | 24 × 14. Gris, pas d'accent (l'accent reste réservé à la lecture). |
| Segmented | `cr-seg` | item `data-active` | 2 à 3 options courtes. |
| IconButton | `cr-icon-btn` | survol, pressé, `data-active`, `data-accent`, désactivé | 20 × 20, icône 12. |
| EmptyState | `cr-empty` | `data-variant=drop/noresults`, `data-over` | Exemples de syntaxe en mono. |

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
- **Les tokens spéciaux en cours de frappe ne filtrent pas** (`#ta` ne vide pas la liste) ; seuls les mots libres filtrent en direct.
