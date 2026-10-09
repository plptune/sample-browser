// Empreinte des données factices du prototype (TypeScript), comparée par crates/crate-core/tests/parity.rs
// à la bibliothèque factice Rust. Régénérer après toute modification de src/mock ou src/api/mock.ts :
//   pnpm parity:fixture
import { writeFileSync } from "node:fs";
import { mockBackend } from "../src/api/mock";
import { SAMPLES } from "../src/mock/generate";

const QUERIES = [
  "", "kick", "#warm", "bpm:120-128", "key:Am", "key:F", "dur:<1s", "type:loop #lofi bpm:80-110", "-#bright kick",
  '"tape 1"', "in:night", "in:drums", "in:pack", "in:go", "is:fav", "is:untagged", "vox", "bpm:>170 #airy", "-loop",
  "dur:1-4s", "type:one-shot", "bd", "hh", "vocal -kick", "-sd", '"bd"',
  // Enharmonies et modes écrits.
  "key:A#", "key:a#m", "key:Gb", "key:F#maj", "key:bbm", "key:Hm",
];
const EXPANDED = {
  library: [[], ["f:10", "f:11", "f:12"], ["f:1", "f:2", "f:3", "f:20", "f:21", "f:22"], ["c:fav", "c:1", "v:3", "v:4", "v:5", "p:3"]],
  virtual: [[], ["g:collections", "c:1", "c:2", "c:3", "c:4"], ["c:fav", "v:1", "v:2", "v:3", "v:4", "v:5"]],
} as const;
const PLAN_KEYS = ["v:1", "v:3", "v:4", "c:1", "c:3", "c:4", "c:fav"];
const ANCESTOR_KEYS = ["f:1", "f:3", "f:12", "f:18", "f:22", "v:1", "v:2", "v:4", "c:1", "p:3", "f:999"];

const round = (x: number) => Math.round(x * 1e9) / 1e9;

const samples = SAMPLES.map((s) => ({
  id: s.id, name: s.name, ext: s.ext, path: s.path, folderId: s.folderId, durationMs: s.durationMs,
  sampleRate: s.sampleRate, bitDepth: s.bitDepth, channels: s.channels, bpm: s.bpm, key: s.key, kind: s.kind,
  tags: s.tags, fav: s.fav,
  peaksSum: round(s.peaks.reduce((a, b) => a + b, 0)), peaksFirst: round(s.peaks[0]), peaksLast: round(s.peaks[255]),
}));

type Page = Awaited<ReturnType<typeof mockBackend.tree>>;
const rowsOf = (page: Page) =>
  page.rows.map(
    (r) => `${r.depth}|${r.key}${r.type === "node" ? (r.open ? "|open" : "|closed") + (r.offline ? "|offline" : "") + (r.pinned ? "|pinned" : "") + (r.target ? `|->${r.target}` : "") + (r.hidden ? "|hidden" : "") : ""}`,
  );

const trees = [];
for (const root of ["library", "virtual"] as const) {
  for (const query of QUERIES) {
    for (const expanded of EXPANDED[root]) {
      const page = await mockBackend.tree({ root, query, expanded: [...expanded], offset: 0, limit: 100000 });
      trees.push({ root, query, expanded, totalRows: page.totalRows, matches: page.matches, rows: rowsOf(page) });
    }
  }
}

const plans = [];
for (const key of PLAN_KEYS) {
  for (const keepHierarchy of [true, false]) {
    plans.push({ key, keepHierarchy, plan: await mockBackend.planCommit(key, { keepHierarchy, addAsSource: false }) });
  }
}

// Position d'une ligne (focus) dans l'arbre complet.
const FOCUS = [
  { query: "", expanded: ["f:10", "f:11", "f:12"], focus: "f:12" },
  { query: "kick", expanded: [], focus: "s:5@f:12" },
  { query: "", expanded: [], focus: "f:999" },
];
const focus = [];
for (const f of FOCUS) {
  const page = await mockBackend.tree({ root: "library", query: f.query, expanded: f.expanded, offset: 0, limit: 0, focus: f.focus });
  focus.push({ ...f, focusIndex: page.focusIndex ?? null });
}

// Masquage : samples et dossier masqués, retrouvés avec is:hidden, puis ré-affichés.
const HIDE_QUERIES = ["", "is:hidden", "kick", "kick is:hidden", "-is:hidden", "in:go"];
const HIDE_EXPANDED = ["f:10", "f:11", "f:12", "f:13", "c:fav", "c:1"];
await mockBackend.setHidden([1, 2, 3, 5, 11], true);
await mockBackend.setFolderHidden(12, true);
const hidden = { library: (await mockBackend.library()).hidden, trees: [] as unknown[] };
for (const query of HIDE_QUERIES) {
  const page = await mockBackend.tree({ root: "library", query, expanded: HIDE_EXPANDED, offset: 0, limit: 100000 });
  hidden.trees.push({ query, totalRows: page.totalRows, matches: page.matches, rows: rowsOf(page) });
}
await mockBackend.setHidden([1, 2, 3, 5, 11], false);
await mockBackend.setFolderHidden(12, false);

const library = await mockBackend.library();
const sources = await mockBackend.sources();

const nodePaths = Object.fromEntries(await Promise.all(ANCESTOR_KEYS.map(async (k) => [k, await mockBackend.nodePath(k)])));
const ancestors = Object.fromEntries(await Promise.all(ANCESTOR_KEYS.map(async (k) => [k, await mockBackend.ancestors(k)])));

// Raccourcis : épingler un sous-dossier, refuser une source, retirer, puis revenir à l'état initial.
const pinTree = async () => rowsOf(await mockBackend.tree({ root: "library", query: "", expanded: [], offset: 0, limit: 100000 }));
const pins = [];
await mockBackend.setPinned("f:18", true);
await mockBackend.setPinned("f:10", true);
pins.push({ pinned: (await mockBackend.library()).pinnedFolders, rows: await pinTree() });
await mockBackend.setPinned("f:3", false);
pins.push({ pinned: (await mockBackend.library()).pinnedFolders, rows: await pinTree() });
await mockBackend.setPinned("f:18", false);
await mockBackend.setPinned("f:3", true);
pins.push({ pinned: (await mockBackend.library()).pinnedFolders, rows: await pinTree() });

// En dernier (modifie l'état) : commit de « Pack 2026 » ajouté aux sources, puis l'arbre qui en résulte.
const commit = await mockBackend.commitToFolder("v:3", "~/Desktop/Pack 2026/", { keepHierarchy: true, addAsSource: true });
const afterTree = await mockBackend.tree({ root: "library", query: "", expanded: ["f:1000", "f:1001", "f:1002"], offset: 0, limit: 100000 });
const afterSearch = await mockBackend.tree({ root: "library", query: "riser", expanded: [], offset: 0, limit: 100000 });
const after = {
  commit,
  sources: await mockBackend.sources(),
  tree: { totalRows: afterTree.totalRows, matches: afterTree.matches, rows: rowsOf(afterTree) },
  search: { totalRows: afterSearch.totalRows, matches: afterSearch.matches, rows: rowsOf(afterSearch) },
  paths: afterTree.rows.flatMap((r) => (r.type === "sample" ? [r.sample.path] : [])),
};

const out = { samples, trees, plans, focus, hidden, library, sources, ancestors, nodePaths, pins, after };
writeFileSync(new URL("../crates/crate-core/tests/fixtures/prototype.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
console.log(`${samples.length} samples, ${trees.length} arbres, ${plans.length} plans, ${pins.length} épinglages, 1 commit → crates/crate-core/tests/fixtures/prototype.json`);
