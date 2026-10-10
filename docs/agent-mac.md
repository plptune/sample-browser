# Mission : installer et vérifier Crate sur ce Mac

Tu es un agent qui travaille dans le dépôt `sample-browser`, sur le Mac de l'utilisateur.

Le projet, Crate, est un navigateur de samples pour Mac :
- Tauri 2, cœur Rust dans `crates/crate-core`, interface SolidJS ;
- tout a été développé et testé sous Linux, sans carte son ni GPU ;
- ton rôle est de faire sur ce Mac ce qui ne pouvait pas l'être là-bas, puis d'écrire un rapport.

Lis d'abord `README.md`, `docs/plan.md` (sections « Phase 4 » à « Fichiers MIDI ») et **`docs/verification-mac.md`**. Ce dernier fichier est la liste de référence.

## Règles

- **Ne jamais écrire dans les dossiers de samples de l'utilisateur.** Crate ne fait que les lire. Tes commandes aussi.
- **Ne rien installer sur le système sans demander** (Homebrew, Rust, Node…). Propose la commande, attends l'accord.
- **Ne rien committer ni pousser.** Si un correctif semble nécessaire, décris-le dans le rapport : l'utilisateur décidera.
- Tu ne peux ni entendre le son ni juger ce qu'affiche l'écran. Tout ce qui demande une oreille ou un œil va dans la
  liste « à vérifier par l'utilisateur », avec les étapes exactes. Ne coche jamais ces points toi-même.
- Une commande échoue : copie la sortie utile (les 30 dernières lignes) dans le rapport, essaie de comprendre, puis
  passe à la suite.

## 1. Environnement

Vérifie et note les versions :

```bash
sw_vers                  # version de macOS
uname -m                 # arm64 (Apple Silicon) ou x86_64
xcode-select -p          # outils de compilation Apple
rustc --version && cargo --version
node -v                  # attendu : v22.x
pnpm -v                  # attendu : 10.x
```

S'il manque quelque chose, propose à l'utilisateur :
- `xcode-select --install`
- Rust : `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- `brew install node@22 pnpm`

## 2. Code à jour et dépendances

```bash
git status               # doit être propre ; sinon, demander avant de toucher à quoi que ce soit
git checkout main && git pull
pnpm install
```

## 3. Contrôles automatiques (ce que fait la CI)

Lance-les et note pour chacun : vert ou rouge, et la durée.

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace                 # régénère aussi src/api/bindings.ts
git status --short                     # bindings.ts ne doit pas avoir changé
pnpm build                             # typecheck + build de l'interface
```

Ici, les tests audio utilisent la **vraie carte son** : sous Linux ils tournaient en mode muet. Signale toute
différence.

## 4. Mesures de performance (budgets du plan)

```bash
cargo test --release -p crate-core --test bench_scan -- --ignored --nocapture
cargo test --release -p crate-core --test analysis -- --nocapture
cargo test --release -p crate-core --test midi -- --nocapture
```

Reporte dans un tableau, à côté des budgets de `docs/plan.md` (« Budgets de performance ») :
- scan de 100 000 fichiers ;
- chargement du catalogue ;
- pire frappe ;
- ouverture d'un dossier de 5 000 samples ;
- précision de l'analyse sur le jeu test ;
- vitesse du synthé MIDI.

## 5. Analyse sur les vrais samples de l'utilisateur

Demande à l'utilisateur le chemin d'un dossier de packs dont les noms portent tempo et tonalité
(`Bass_Loop_120_Am.wav`). Lance ensuite, en remplaçant le chemin :

```bash
CRATE_ANALYSIS_DIR="/chemin/donné" cargo test --release -p crate-core --test analysis -- --ignored --nocapture
```

Le test copie chaque fichier dans un fichier temporaire au nom neutre, l'analyse, puis compare au nom. Il n'écrit rien
dans le dossier. Dans le rapport :
- les deux scores finaux (BPM x/y, tonalité x/y) et la durée ;
- les erreurs regroupées par type : octave (80 ↔ 160), tiers (×2/3, ×4/3), relative majeure / mineure (C ↔ Am),
  autres ;
- dix exemples d'erreurs typiques, avec le nom du fichier.

## 6. App construite

```bash
pnpm tauri build --bundles app                  # comme la CI (pas de .dmg)
du -sh target/release/bundle/macos/Crate.app      # budget : < 15 Mo
```

Lance l'app une fois (`open target/release/bundle/macos/Crate.app`). Après une minute au repos, mesure sa mémoire :

```bash
ps -o rss=,comm= -p $(pgrep -f "Crate.app/Contents/MacOS" | head -1)    # en Ko ; budget : < 150 Mo
```

## 7. Ce que l'utilisateur doit vérifier lui-même

Prépare-lui une liste courte et numérotée, tirée de `docs/verification-mac.md`, avec pour chaque point la manip exacte
et ce qu'il doit observer. Mets en tête, dans cet ordre :

1. **Son** : `pnpm tauri dev`, ajouter un dossier (⌘O), Espace sur un sample, ⌥⌘D. La ligne « son … ms » doit
   rester sous 30 ms.
2. **Glisser vers le DAW** : un sample `.wav`, puis un `.mid`, dans Ableton Live 12 et dans Logic.
3. **MIDI** : le piano sonne propre (pas de saturation, pas de clic en fin de boucle) ; un `.mid` de batterie sonne
   comme une batterie.
4. **Fluidité** : avec ⌥⌘D, taper « kick » sur une grosse bibliothèque doit rester sous 16 ms au total.
5. **Fenêtre** : feux macOS dans la zone réservée, « Toujours au premier plan » au-dessus du DAW, réglages retrouvés
   après relance.
6. **Clavier** : ⇧F10, ⌘⌫, Tab dans les Réglages, avec et sans « Navigation au clavier » (Réglages Système ›
   Clavier).
7. **Grande fenêtre** (⌘⇧F ou bouton ⤢) : la fenêtre s'agrandit, l'inspecteur apparaît ; retour en colonne à la
   taille d'avant ; bouton vert cohérent ; relance en grand (`docs/verification-mac.md`, section 6 ter).

## 8. Rapport

Écris `rapport-verification-mac.md` à la racine du dépôt (ignoré par git), **sans le committer** :

```markdown
# Rapport de vérification — <date>

## Environnement
macOS …, puce …, Rust …, Node …, pnpm …

## Contrôles automatiques
| Contrôle | Résultat | Durée | Remarque |

## Performances (mesuré / budget)
| Mesure | Mesuré | Budget | OK ? |

## Analyse sur de vrais samples
Dossier : … (n fichiers) — BPM x/y — tonalité x/y — durée …
Erreurs par type : …
Exemples : …

## App construite
Taille …, mémoire au repos …

## Problèmes rencontrés
(commande, sortie utile, hypothèse, correctif proposé)

## À vérifier par l'utilisateur
1. …
```

Termine en donnant à l'utilisateur :
- le résumé en cinq lignes ;
- le chemin du rapport ;
- la liste de la section 7.
