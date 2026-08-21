use anyhow::Result;
use serde::{Deserialize, Serialize};

/// Geographic enrichment using BAN (Base Adresse Nationale) + INSEE
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeoLocation {
    pub latitude: f64,
    pub longitude: f64,
    pub insee_code: String,
    pub municipality: String,
    pub department: String,
    pub region: String,
}

pub struct GeoEnricher;

impl GeoEnricher {
    /// Enrich address with geographic data from BAN API
    pub async fn enrich_address(address: &str) -> Result<GeoLocation> {
        // Call BAN API for reverse geocoding
        let url = format!("https://api-adresse.data.gouv.fr/search/?q={}",
            urlencoding::encode(address));

        let response = reqwest::get(&url).await?;
        let data = response.json::<serde_json::Value>().await?;

        let feature = &data["features"][0];
        let coords = &feature["geometry"]["coordinates"];

        Ok(GeoLocation {
            longitude: coords[0].as_f64().unwrap_or(0.0),
            latitude: coords[1].as_f64().unwrap_or(0.0),
            insee_code: feature["properties"]["context"]["insee"]
                .as_str()
                .unwrap_or("unknown")
                .to_string(),
            municipality: feature["properties"]["city"]
                .as_str()
                .unwrap_or("unknown")
                .to_string(),
            department: feature["properties"]["context"]["department"]
                .as_str()
                .unwrap_or("unknown")
                .to_string(),
            region: feature["properties"]["context"]["region"]
                .as_str()
                .unwrap_or("unknown")
                .to_string(),
        })
    }

    /// Calculate market momentum for a geographic area
    pub fn calculate_neighborhood_trend(
        property_count: usize,
        avg_price_change_percent: f64,
        market_days: f64,
    ) -> f64 {
        // Trend strength: property velocity × price momentum
        let velocity = (property_count as f64) / 365.0; // properties/day
        let momentum = 1.0 + (avg_price_change_percent / 100.0);
        let days_factor = if market_days < 30.0 {
            0.5
        } else if market_days > 180.0 {
            0.8
        } else {
            1.0
        };

        (velocity * momentum) * days_factor
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_neighborhood_trend() {
        let trend = GeoEnricher::calculate_neighborhood_trend(100, 5.0, 60.0);
        assert!(trend > 0.0);
        assert!(trend < 1.0);
    }
}
