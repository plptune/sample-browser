// Notes des fichiers MIDI (piano roll) : demandées une fois par sample, gardées pour les lignes de l'arbre qui
// réapparaissent au défilement et pour le tiroir.
import { api, type MidiNotes, type SampleId } from "../api";

const MAX = 256;
const cache = new Map<SampleId, Promise<MidiNotes>>();

export function notesFor(id: SampleId): Promise<MidiNotes> {
  let p = cache.get(id);
  if (p) {
    // Plus récemment utilisé : remis en fin de file.
    cache.delete(id);
  } else {
    p = api.notes(id).catch(() => ({ notes: [], seconds: 0 }));
  }
  cache.set(id, p);
  if (cache.size > MAX) cache.delete(cache.keys().next().value!);
  return p;
}

/** Chargeur lié à un sample (l'identifiant est lu tout de suite : la ligne peut changer de sample avant l'appel). */
export const notesLoader = (id: SampleId) => () => notesFor(id);
