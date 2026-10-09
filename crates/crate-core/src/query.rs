//! Découpage de la ligne de recherche en tokens. Miroir de `src/lib/query.ts`.
//! Phase 3 : ces tokens produiront une requête SQL paramétrée ; ici ils filtrent les données factices.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FilterKey {
    Bpm,
    Key,
    Dur,
    In,
    Type,
    Is,
}

impl FilterKey {
    fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "bpm" => Self::Bpm,
            "key" => Self::Key,
            "dur" => Self::Dur,
            "in" => Self::In,
            "type" => Self::Type,
            "is" => Self::Is,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum TokenKind {
    Text,
    Phrase,
    Tag,
    Filter(FilterKey),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Token {
    pub raw: String,
    pub kind: TokenKind,
    pub value: String,
    pub negated: bool,
}

/// Découpe sur les espaces en respectant les "phrases" (équivalent de `/-?"[^"]*"?|\S+/g`).
pub fn split_line(line: &str) -> Vec<String> {
    let chars: Vec<char> = line.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        if chars[i].is_whitespace() {
            i += 1;
            continue;
        }
        let start = i;
        let quoted = chars[i] == '"' || (chars[i] == '-' && chars.get(i + 1) == Some(&'"'));
        if quoted {
            i += if chars[i] == '-' { 2 } else { 1 };
            while i < chars.len() && chars[i] != '"' {
                i += 1;
            }
            if i < chars.len() {
                i += 1; // guillemet fermant
            }
        } else {
            while i < chars.len() && !chars[i].is_whitespace() {
                i += 1;
            }
        }
        out.push(chars[start..i].iter().collect());
    }
    out
}

pub fn parse_token(raw: &str) -> Token {
    let mut body = raw;
    let mut negated = false;
    if body.chars().count() > 1 && body.starts_with('-') {
        negated = true;
        body = &body[1..];
    }
    let token = |kind, value: String| Token {
        raw: raw.to_string(),
        kind,
        value,
        negated,
    };
    if body.starts_with('"') {
        return token(TokenKind::Phrase, body.replace('"', ""));
    }
    if body.starts_with('#') && body.len() > 1 {
        return token(TokenKind::Tag, body[1..].to_lowercase());
    }
    if let Some(colon) = body.find(':') {
        if colon > 0 {
            let value = &body[colon + 1..];
            if let Some(key) = FilterKey::parse(&body[..colon].to_lowercase()) {
                if !value.is_empty() {
                    return token(TokenKind::Filter(key), value.to_string());
                }
            }
        }
    }
    token(TokenKind::Text, body.to_lowercase())
}

pub fn parse_line(line: &str) -> Vec<Token> {
    split_line(line).iter().map(|t| parse_token(t)).collect()
}

/// Équivalent de `parseFloat` : lit le plus long préfixe numérique, `None` s'il n'y en a pas.
pub fn parse_float_prefix(s: &str) -> Option<f64> {
    let s = s.trim_start();
    let b = s.as_bytes();
    let mut i = 0;
    if i < b.len() && (b[i] == b'+' || b[i] == b'-') {
        i += 1;
    }
    let int_start = i;
    while i < b.len() && b[i].is_ascii_digit() {
        i += 1;
    }
    let mut digits = i - int_start;
    if i < b.len() && b[i] == b'.' {
        let frac_start = i + 1;
        let mut k = frac_start;
        while k < b.len() && b[k].is_ascii_digit() {
            k += 1;
        }
        digits += k - frac_start;
        if digits > 0 {
            i = k;
        }
    }
    if digits == 0 {
        return None;
    }
    if i < b.len() && (b[i] == b'e' || b[i] == b'E') {
        let mut k = i + 1;
        if k < b.len() && (b[k] == b'+' || b[k] == b'-') {
            k += 1;
        }
        let exp_start = k;
        while k < b.len() && b[k].is_ascii_digit() {
            k += 1;
        }
        if k > exp_start {
            i = k;
        }
    }
    s[..i].parse().ok()
}

/// `Math.round` de JavaScript (arrondi vers +∞ sur les .5).
pub fn js_round(x: f64) -> f64 {
    (x + 0.5).floor()
}

/// Comparaison numérique d'un filtre (`>120`, `<=2`, `120-128`, `120`), avec unité optionnelle (`s`).
/// Reproduit le comportement du mock TypeScript, y compris les cas dégénérés (NaN → faux).
pub fn parse_range(v: &str, unit: &str) -> impl Fn(f64) -> bool {
    let s = if unit.is_empty() { v.to_string() } else { v.replacen(unit, "", 1) };
    let num = |x: &str| -> f64 {
        let x = if unit.is_empty() { x.to_string() } else { x.replacen(unit, "", 1) };
        parse_float_prefix(&x).unwrap_or(f64::NAN)
    };
    enum Op {
        Ge(f64),
        Le(f64),
        Gt(f64),
        Lt(f64),
        Between(f64, f64),
        Eq(f64),
    }
    let op = if let Some(r) = s.strip_prefix(">=") {
        Op::Ge(num(r))
    } else if let Some(r) = s.strip_prefix("<=") {
        Op::Le(num(r))
    } else if let Some(r) = s.strip_prefix('>') {
        Op::Gt(num(r))
    } else if let Some(r) = s.strip_prefix('<') {
        Op::Lt(num(r))
    } else if s.contains('-') {
        let mut parts = s.split('-');
        let a = num(parts.next().unwrap_or(""));
        let b = num(parts.next().unwrap_or(""));
        Op::Between(a, b)
    } else {
        Op::Eq(num(&s))
    };
    move |n: f64| match op {
        Op::Ge(x) => n >= x,
        Op::Le(x) => n <= x,
        Op::Gt(x) => n > x,
        Op::Lt(x) => n < x,
        Op::Between(a, b) => n >= a && n <= b,
        Op::Eq(x) => js_round(n) == js_round(x),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_respects_phrases() {
        assert_eq!(
            split_line(r#"kick "vinyl crackle"  -"lo fi" #warm"#),
            vec!["kick", "\"vinyl crackle\"", "-\"lo fi\"", "#warm"]
        );
    }

    #[test]
    fn tokens() {
        let t = parse_token("-#Bright");
        assert_eq!((t.kind, t.value.as_str(), t.negated), (TokenKind::Tag, "bright", true));
        assert_eq!(parse_token("bpm:120-128").kind, TokenKind::Filter(FilterKey::Bpm));
        assert_eq!(parse_token("foo:bar").kind, TokenKind::Text);
        assert_eq!(parse_token("bpm:").kind, TokenKind::Text);
        assert_eq!(parse_token("-").kind, TokenKind::Text);
    }

    #[test]
    fn ranges() {
        assert!(parse_range("120-128", "")(124.0));
        assert!(!parse_range("120-128", "")(130.0));
        assert!(parse_range(">=140", "")(140.0));
        assert!(parse_range("<1s", "s")(0.4));
        assert!(parse_range("1-4s", "s")(2.0));
        assert!(parse_range("120", "")(119.6));
        assert!(!parse_range("abc", "")(1.0));
    }

    #[test]
    fn float_prefix() {
        assert_eq!(parse_float_prefix("2s"), Some(2.0));
        assert_eq!(parse_float_prefix(" .5x"), Some(0.5));
        assert_eq!(parse_float_prefix("x"), None);
        assert_eq!(parse_float_prefix("1e2"), Some(100.0));
    }
}
