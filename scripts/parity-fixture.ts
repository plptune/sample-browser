// Empreinte des données factices du prototype (TypeScript), comparée par crates/crate-core/tests/parity.rs
// à la bibliothèque factice Rust. Régénérer après toute modification de src/mock ou src/api/mock.ts :
//   pnpm parity:fixture
import { writeFileSync } from "node:fs";
import { mockBackend } from "../src/api/mock";
import { SAMPLES } from "../src/mock/generate";

const QUERIES = [
  "", "kick", "#warm", "bpm:120-128", "key:Am", "key:F", "dur:<1s", "type:loop #lofi bpm:80-110", "-#bright kick",
  '"tape 1"', "in:night", "in:drums", "is:fav", "is:untagged", "vox", "bpm:>170 #airy", "-loop", "dur:1-4s", "type:one-shot",
];
const EXPANDED = [[], ["f:10", "f:11", "f:12"], ["g:collections", "c:1", "c:5", "c:6", "c:fav"], ["f:1", "f:2", "f:3", "f:20", "f:21", "f:22"]];

const round = (x: number) => Math.round(x * 1e9) / 1e9;

const samples = SAMPLES.map((s) => ({
  id: s.id, name: s.name, ext: s.ext, path: s.path, folderId: s.folderId, durationMs: s.durationMs,
  sampleRate: s.sampleRate, bitDepth: s.bitDepth, channels: s.channels, bpm: s.bpm, key: s.key, kind: s.kind,
  tags: s.tags, fav: s.fav,
  peaksSum: round(s.peaks.reduce((a, b) => a + b, 0)), peaksFirst: round(s.peaks[0]), peaksLast: round(s.peaks[255]),
}));

const trees = [];
for (const query of QUERIES) {
  for (const expanded of EXPANDED) {
    const page = await mockBackend.tree({ query, expanded, offset: 0, limit: 100000 });
    trees.push({
      query, expanded, totalRows: page.totalRows, matches: page.matches,
      rows: page.rows.map((r) => `${r.depth}|${r.key}${r.type === "node" ? (r.open ? "|open" : "|closed") + (r.offline ? "|offline" : "") : ""}`),
    });
  }
}

const library = await mockBackend.library();
const out = { samples, trees, library, sources: await mockBackend.sources() };
writeFileSync(new URL("../crates/crate-core/tests/fixtures/prototype.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
console.log(`${samples.length} samples, ${trees.length} arbres → crates/crate-core/tests/fixtures/prototype.json`);
