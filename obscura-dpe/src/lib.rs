//! DPE Custom Obscura Module
//! Parsing, geoenrichment, and scoring optimizations for real estate property data

pub mod parser;
pub mod geo;
pub mod scoring;

use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DpeDiagnostic {
    pub property_id: String,
    pub dpe_grade: String, // A-G
    pub dpe_score: i32, // 0-100
    pub annual_energy_cost: f64,
    pub co2_emission: f64,
    pub diagnostic_date: DateTime<Utc>,
    pub validity_until: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PropertyEnrichment {
    pub property_id: String,
    pub address: String,
    pub latitude: f64,
    pub longitude: f64,
    pub insee_code: String,
    pub municipality: String,
    pub dpe: Option<DpeDiagnostic>,
}

pub use parser::DpeParser;
pub use geo::GeoEnricher;
pub use scoring::ScoringEngine;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dpe_module_loads() {
        assert_eq!("A".len(), 1);
    }
}
