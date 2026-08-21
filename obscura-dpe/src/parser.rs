use anyhow::Result;
use serde_json::Value;
use crate::DpeDiagnostic;
use chrono::Utc;

/// Parse DPE diagnostic data from ADEME API responses or HTML
pub struct DpeParser;

impl DpeParser {
    /// Parse DPE from ADEME API JSON response
    pub fn parse_ademe_response(data: &Value) -> Result<DpeDiagnostic> {
        Ok(DpeDiagnostic {
            property_id: data["id"].as_str().unwrap_or("unknown").to_string(),
            dpe_grade: data["dpe_grade"].as_str().unwrap_or("N/A").to_string(),
            dpe_score: data["dpe_score"].as_i64().unwrap_or(0) as i32,
            annual_energy_cost: data["annual_energy_cost"].as_f64().unwrap_or(0.0),
            co2_emission: data["co2_emission"].as_f64().unwrap_or(0.0),
            diagnostic_date: Utc::now(),
            validity_until: Utc::now() + chrono::Duration::days(365 * 10),
        })
    }

    /// Extract DPE grade letter (A-G) from numeric score
    pub fn grade_from_score(score: i32) -> &'static str {
        match score {
            0..=50 => "A",
            51..=90 => "B",
            91..=150 => "C",
            151..=230 => "D",
            231..=330 => "E",
            331..=420 => "F",
            _ => "G",
        }
    }

    /// Calculate severity ratio (0.0-1.0) for opportunity scoring
    pub fn severity_ratio(grade: &str) -> f64 {
        match grade {
            "G" => 1.0,
            "F" => 0.85,
            "E" => 0.70,
            "D" => 0.55,
            "C" => 0.40,
            "B" => 0.15,
            "A" => 0.0,
            _ => 0.5,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_grade_from_score() {
        assert_eq!(DpeParser::grade_from_score(40), "A");
        assert_eq!(DpeParser::grade_from_score(100), "B");
        assert_eq!(DpeParser::grade_from_score(250), "E");
        assert_eq!(DpeParser::grade_from_score(400), "F");
    }

    #[test]
    fn test_severity_ratio() {
        assert_eq!(DpeParser::severity_ratio("G"), 1.0);
        assert_eq!(DpeParser::severity_ratio("A"), 0.0);
        assert!(DpeParser::severity_ratio("E") > 0.5);
    }
}
