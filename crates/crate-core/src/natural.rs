//! Tri « naturel » des noms (Kick_2 avant Kick_10), sans dépendre d'une locale.
//! Miroir exact de `src/lib/natural.ts` : les deux doivent produire le même ordre.
//!
//! Règles : la casse est ignorée ; une suite de chiffres se compare par valeur ; sinon on compare des rangs :
//! ponctuation (dans l'ordre de `PUNCT`) < chiffres < lettres < reste. En cas d'égalité totale, ordre des octets.

use std::cmp::Ordering;

const PUNCT: &str = " _-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$";

fn rank(c: char) -> u32 {
    if let Some(i) = PUNCT.find(c) {
        return i as u32;
    }
    if c.is_ascii_digit() {
        return 100;
    }
    if c.is_ascii_alphabetic() {
        return 200 + c.to_ascii_lowercase() as u32;
    }
    1000 + c as u32
}

/// Compare deux suites de chiffres ASCII par valeur (sans limite de taille).
fn cmp_digits(a: &[u8], b: &[u8]) -> Ordering {
    let trim = |s: &[u8]| -> usize { s.iter().position(|&c| c != b'0').unwrap_or(s.len()) };
    let (ta, tb) = (&a[trim(a)..], &b[trim(b)..]);
    ta.len().cmp(&tb.len()).then_with(|| ta.cmp(tb))
}

/// Sans allocation : les chiffres sont des octets ASCII, le reste est décodé caractère par caractère.
pub fn compare(a: &str, b: &str) -> Ordering {
    let (ba, bb) = (a.as_bytes(), b.as_bytes());
    let (mut i, mut j) = (0, 0);
    while i < ba.len() && j < bb.len() {
        if ba[i].is_ascii_digit() && bb[j].is_ascii_digit() {
            let si = i;
            while i < ba.len() && ba[i].is_ascii_digit() {
                i += 1;
            }
            let sj = j;
            while j < bb.len() && bb[j].is_ascii_digit() {
                j += 1;
            }
            match cmp_digits(&ba[si..i], &bb[sj..j]) {
                Ordering::Equal => continue,
                o => return o,
            }
        }
        let ca = a[i..].chars().next().unwrap_or_default();
        let cb = b[j..].chars().next().unwrap_or_default();
        match rank(ca).cmp(&rank(cb)) {
            Ordering::Equal => {
                i += ca.len_utf8();
                j += cb.len_utf8();
            }
            o => return o,
        }
    }
    a[i..].chars().count().cmp(&b[j..].chars().count()).then_with(|| a.cmp(b))
}

#[cfg(test)]
mod tests {
    use super::compare;
    use std::cmp::Ordering::*;

    #[test]
    fn numbers_by_value() {
        assert_eq!(compare("Kick_2", "Kick_10"), Less);
        assert_eq!(compare("Kick_10", "Kick_9"), Greater);
    }

    #[test]
    fn case_and_punctuation() {
        assert_eq!(compare("kick", "Kick"), Greater); // égalité de rang → ordre des octets ('K' < 'k')
        assert_eq!(compare("Bass_F_03", "Bass_F#m_01"), Less); // '_' avant '#'
        assert_eq!(compare("Pad_Airy", "Pad_airy_2"), Less);
    }

    #[test]
    fn unicode_and_leading_zeros() {
        assert_eq!(compare("Kick_007", "Kick_7"), Equal.then("Kick_007".cmp("Kick_7")));
        assert_eq!(compare("Été 2", "Été 10"), Less);
        assert_eq!(compare("é", "e"), Greater);
        assert_eq!(compare("Pack", "Pack 2"), Less);
    }
}
