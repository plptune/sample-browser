# Crate — design system (v0.1)

Inspiré du browser d'Ableton Live : dense, plat, gris, lisible à 11 px. Une colonne de 260–520 px.

## Principes

1. **Gris d'abord, un seul accent.** L'ambre (`--cr-accent`) n'apparaît que pour : la lecture en cours,
   une progression, le focus clavier, une cible de dépôt. Jamais en aplat décoratif.
2. **Pas d'icône sans fonction.** 9 icônes au total (`Icon.tsx`), trait 1,2 px sur 12 × 12.
   Les items de navigation n'ont pas d'icône ; seules les collections ont un repère (carré = manuelle, rond = smart).
3. **La hiérarchie vient du texte**, pas des couleurs : `--cr-text` → `-2` → `-3` → `-disabled`.
4. **Grille de 4 px**, hauteurs fixes (ligne 24 px, 36 px avec waveform, item 22 px, en-tête 20 px).
5. **États par attributs** `data-*` (`data-selected`, `data-playing`, `data-open`…), jamais par classes ad hoc.
6. **Aucune valeur en dur** dans `bundle.css` : tout passe par `tokens.css`.

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `src/styles/tokens.css` | Tokens : couleurs (sombre + clair), typo, espacements, dimensions |
| `src/styles/bundle.css` | Classes `cr-*` de tous les composants |
| `src/components/*.tsx` | Un composant Solid par composant documenté |
| `#/gallery` | Chaque composant dans chacun de ses états, sombre / clair, 260 / 380 px |

## Tokens

| Groupe | Tokens |
| --- | --- |
| Surfaces | `--cr-bg` (liste) · `--cr-surface` (barre titre, sidebar, tiroir) · `--cr-surface-raised` (champs, popovers) · `--cr-hover` · `--cr-selected` · `--cr-selected-focus` |
| Lignes | `--cr-line` (entre zones) · `--cr-line-soft` (internes) |
| Texte | `--cr-text-strong` · `--cr-text` · `--cr-text-2` · `--cr-text-3` · `--cr-text-disabled` |
| Accent | `--cr-accent` · `--cr-accent-soft` · `--cr-on-accent` |
| Système | `--cr-danger` (fichier introuvable, source déconnectée — texte seulement) |
| Waveform | `--cr-wave` · `--cr-wave-played` · `--cr-wave-mini` |
| Typo | `--cr-font`, `--cr-font-mono`, tailles `xs 10` · `sm 11` · `md 12` · `lg 13` |
| Espace | `--cr-space-0..6` = 2 · 4 · 8 · 12 · 16 · 24 px |
| Hauteurs | `--cr-titlebar-h 28` · `--cr-field-h 24` · `--cr-row-h 24` · `--cr-row-h-wave 36` · `--cr-item-h 22` · `--cr-header-h 20` |

## Composants

| Composant | Classe | États | Notes |
| --- | --- | --- | --- |
| PanelShell | `cr-panel`, `cr-titlebar` | `data-density` | Barre titre overlay : 72 px réservés aux feux macOS. Container query `panel`. |
| SearchField | `cr-search` | `data-focused` | Chips + champ. ⌫ au début supprime la dernière chip, Échap efface, ↓ / ⏎ va dans la liste. |
| QueryChip | `cr-chip` | `data-kind=tag/filter/exclude`, `data-pending` | Clé en `text-2`, valeur en `text-strong`. Clic = repasser en édition. |
| Autocomplete | `cr-ac` | `data-active` sur l'item | Après `#`, `key:`, `in:`. ↑↓ ⏎/Tab, Échap ferme. |
| ScanStatus | `cr-scan` | — | Barre de progression de 1 px en accent sous le libellé. |
| SidebarItem | `cr-item` | `data-selected`, `data-drop-target`, `data-offline`, `--depth`, renommage | Repère `cr-item__mark` : manuelle / smart / fav. |
| Section (sidebar) | `cr-section__header` | `aria-expanded` | Capitales 10 px, action `+` visible au survol. |
| SampleList | `cr-list` | `data-focused` | En-têtes cliquables (tri). BPM et Clé masqués sous 300 px. |
| SampleRow | `cr-row` | `data-selected`, `data-playing`, `data-missing`, `data-dragging`, `data-wave` | Extension et ★ en `text-3`. ▶ accent quand lu. |
| Waveform | `cr-wave` (canvas) | progression | Barres 2 px, partie lue en accent + tête de lecture 1 px. |
| PreviewDrawer | `cr-drawer` | lecture / arrêt / multi / introuvable | Titre, temps, waveform, méta, tags. |
| TagPill | `cr-tag` | `data-active`, `data-variant=add` | Contour 1 px, pas de couleur par tag (choix volontaire). |
| IconButton | `cr-icon-btn` | survol, pressé, `data-active`, `data-accent`, désactivé | 20 × 20, icône 12. |
| EmptyState | `cr-empty` | `data-variant=drop/noresults`, `data-over` | Exemples de syntaxe en mono. |

## Décisions prises seul (à valider)

- **Ligne de 24 px** au lieu des 28 px du plan : plus proche de la densité d'Ableton. Un seul token à changer.
- **Tags sans couleur.** Le schéma prévoit `color_index` ; je l'ignore visuellement pour rester gris.
- **Favoris** : simple ★ grise dans la ligne, pas d'accent (l'accent est réservé à la lecture).
- **Sidebar au-dessus de la liste** (une colonne), limitée à 42 % de la hauteur, masquable depuis la barre titre.
- **Les tokens spéciaux en cours de frappe ne filtrent pas** (`#ta` ne vide pas la liste) ; seuls les mots libres filtrent en direct.
