//! Synonymes de recherche : un mot libre qui appartient à un groupe trouve aussi les autres mots du groupe
//! (`kick` trouve aussi `bd`). Miroir de `src/lib/synonyms.ts`.

/// Groupes proposés au premier lancement (modifiables dans les Réglages).
pub const DEFAULTS: &[&[&str]] = &[
    &["kick", "bd", "bassdrum"],
    &["snare", "sd"],
    &["hat", "hh", "hihat"],
    &["clap", "cp"],
    &["perc", "percussion"],
    &["vox", "vocal"],
    &["fx", "sfx"],
];

pub fn defaults() -> Vec<Vec<String>> {
    DEFAULTS.iter().map(|g| g.iter().map(|w| w.to_string()).collect()).collect()
}

/// Minuscules, sans espaces autour, sans doublons ; un groupe de moins de deux mots est ignoré.
pub fn normalize(groups: &[Vec<String>]) -> Vec<Vec<String>> {
    groups
        .iter()
        .map(|g| {
            let mut out: Vec<String> = vec![];
            for w in g {
                let w = w.trim().to_lowercase();
                if !w.is_empty() && !out.contains(&w) {
                    out.push(w);
                }
            }
            out
        })
        .filter(|g| g.len() >= 2)
        .collect()
}

/// Mots équivalents à `word` (lui compris), ou `None` s'il n'est dans aucun groupe.
pub fn expand(groups: &[Vec<String>], word: &str) -> Option<Vec<String>> {
    let w = word.to_lowercase();
    let mut out: Vec<String> = vec![];
    for g in groups.iter().filter(|g| g.contains(&w)) {
        for x in g {
            if !out.contains(x) {
                out.push(x.clone());
            }
        }
    }
    (!out.is_empty()).then_some(out)
}

/// Stockage dans `settings` : un groupe par ligne, mots séparés par des virgules.
pub fn to_text(groups: &[Vec<String>]) -> String {
    groups.iter().map(|g| g.join(",")).collect::<Vec<_>>().join("\n")
}

pub fn from_text(text: &str) -> Vec<Vec<String>> {
    normalize(&text.lines().map(|l| l.split(',').map(String::from).collect()).collect::<Vec<_>>())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expansion() {
        let g = defaults();
        assert_eq!(expand(&g, "Kick").unwrap(), ["kick", "bd", "bassdrum"]);
        assert_eq!(expand(&g, "kic"), None);
        assert_eq!(from_text(&to_text(&g)), g);
        assert_eq!(
            normalize(&[vec![" Kick ".into(), "kick".into()], vec!["a".into(), "B".into()]]),
            [["a", "b"]]
        );
    }
}
