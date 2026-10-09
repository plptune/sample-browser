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

/// Compare deux suites de chiffres par valeur (sans limite de taille).
fn cmp_digits(a: &[char], b: &[char]) -> Ordering {
    let trim = |s: &[char]| -> Vec<char> {
        let start = s.iter().position(|&c| c != '0').unwrap_or(s.len());
        s[start..].to_vec()
    };
    let (ta, tb) = (trim(a), trim(b));
    ta.len().cmp(&tb.len()).then_with(|| ta.cmp(&tb))
}

pub fn compare(a: &str, b: &str) -> Ordering {
    let (ca, cb): (Vec<char>, Vec<char>) = (a.chars().collect(), b.chars().collect());
    let (mut i, mut j) = (0, 0);
    while i < ca.len() && j < cb.len() {
        if ca[i].is_ascii_digit() && cb[j].is_ascii_digit() {
            let si = i;
            while i < ca.len() && ca[i].is_ascii_digit() {
                i += 1;
            }
            let sj = j;
            while j < cb.len() && cb[j].is_ascii_digit() {
                j += 1;
            }
            match cmp_digits(&ca[si..i], &cb[sj..j]) {
                Ordering::Equal => continue,
                o => return o,
            }
        }
        match rank(ca[i]).cmp(&rank(cb[j])) {
            Ordering::Equal => {
                i += 1;
                j += 1;
            }
            o => return o,
        }
    }
    (ca.len() - i).cmp(&(cb.len() - j)).then_with(|| a.cmp(b))
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
}
