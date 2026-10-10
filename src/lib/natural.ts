// Tri « naturel » des noms (Kick_2 avant Kick_10), sans dépendre d'une locale.
// Miroir exact de crates/crate-core/src/natural.rs : les deux doivent produire le même ordre.
// Règles : casse ignorée ; suites de chiffres comparées par valeur ; sinon rangs :
// ponctuation (ordre de PUNCT) < chiffres < lettres < reste ; égalité totale → ordre des octets.

const PUNCT = " _-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$";
const isDigit = (c: string) => c >= "0" && c <= "9";

function rank(c: string): number {
  const i = PUNCT.indexOf(c);
  if (i >= 0) return i;
  if (isDigit(c)) return 100;
  if (/[a-zA-Z]/.test(c)) return 200 + c.toLowerCase().charCodeAt(0);
  return 1000 + c.codePointAt(0)!;
}

function cmpDigits(a: string, b: string): number {
  const ta = a.replace(/^0+/, "");
  const tb = b.replace(/^0+/, "");
  if (ta.length !== tb.length) return ta.length - tb.length;
  return ta < tb ? -1 : ta > tb ? 1 : 0;
}

const bytes = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function naturalCompare(a: string, b: string): number {
  const ca = [...a];
  const cb = [...b];
  let i = 0;
  let j = 0;
  while (i < ca.length && j < cb.length) {
    if (isDigit(ca[i]) && isDigit(cb[j])) {
      const si = i;
      while (i < ca.length && isDigit(ca[i])) i++;
      const sj = j;
      while (j < cb.length && isDigit(cb[j])) j++;
      const d = cmpDigits(ca.slice(si, i).join(""), cb.slice(sj, j).join(""));
      if (d !== 0) return d;
      continue;
    }
    const d = rank(ca[i]) - rank(cb[j]);
    if (d !== 0) return d;
    i++;
    j++;
  }
  return ca.length - i - (cb.length - j) || bytes(a, b);
}
