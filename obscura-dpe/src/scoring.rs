use serde::{Deserialize, Serialize};
use crate::parser::DpeParser;

/// Opportunity score with confidence indices (0-100)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpportunityScore {
    pub property_id: String,
    pub overall_score: f64,
    pub dpe_severity_component: f64, // 25% weight
    pub holding_duration_component: f64, // 20% weight
    pub market_momentum_component: f64, // 20% weight
    pub neighborhood_trend_component: f64, // 15% weight
    pub price_gap_component: f64, // 15% weight
    pub recency_component: f64, // 5% weight
    pub confidence_level: f64, // Data quality metric
}

pub struct ScoringEngine {
    dpe_severity_weight: f64,
    holding_duration_weight: f64,
    market_momentum_weight: f64,
    neighborhood_trend_weight: f64,
    price_gap_weight: f64,
    recency_weight: f64,
}

impl Default for ScoringEngine {
    fn default() -> Self {
        Self {
            dpe_severity_weight: 0.25,
            holding_duration_weight: 0.20,
            market_momentum_weight: 0.20,
            neighborhood_trend_weight: 0.15,
            price_gap_weight: 0.15,
            recency_weight: 0.05,
        }
    }
}

impl ScoringEngine {
    pub fn new() -> Self {
        Self::default()
    }

    /// Calculate overall opportunity score (0-100)
    pub fn calculate_score(
        &self,
        dpe_grade: &str,
        _dpe_score: i32,
        holding_days: i32,
        market_momentum: f64,
        neighborhood_trend: f64,
        estimated_price: f64,
        market_price: f64,
        dpe_age_days: i32,
    ) -> OpportunityScore {
        // Component 1: DPE Severity (25%)
        let severity = DpeParser::severity_ratio(dpe_grade);
        let dpe_severity = severity * 100.0;

        // Component 2: Holding Duration (20%) - longer holding = higher score
        let holding_factor = (holding_days as f64).min(365.0) / 365.0;
        let holding_duration = holding_factor * 100.0;

        // Component 3: Market Momentum (20%) - strong growth = higher score
        let momentum_normalized = market_momentum.clamp(0.0, 2.0) * 50.0;
        let market_momentum_score = momentum_normalized;

        // Component 4: Neighborhood Trend (15%)
        let neighborhood_trend_score = neighborhood_trend.clamp(0.0, 1.0) * 100.0;

        // Component 5: Price Gap (15%) - underpriced = higher score
        let price_gap = if market_price > 0.0 {
            ((market_price - estimated_price) / market_price).clamp(-1.0, 1.0) * 100.0
        } else {
            50.0
        };

        // Component 6: Recency (5%) - recent DPE = higher confidence
        let recency = 100.0 - ((dpe_age_days as f64).min(3650.0) / 3650.0 * 100.0);

        // Weighted score
        let overall = (dpe_severity * self.dpe_severity_weight)
            + (holding_duration * self.holding_duration_weight)
            + (market_momentum_score * self.market_momentum_weight)
            + (neighborhood_trend_score * self.neighborhood_trend_weight)
            + (price_gap * self.price_gap_weight)
            + (recency * self.recency_weight);

        // Confidence based on data completeness
        let confidence = 100.0; // TODO: calculate based on data completeness

        OpportunityScore {
            property_id: "unknown".to_string(),
            overall_score: overall.clamp(0.0, 100.0),
            dpe_severity_component: dpe_severity,
            holding_duration_component: holding_duration,
            market_momentum_component: market_momentum_score,
            neighborhood_trend_component: neighborhood_trend_score,
            price_gap_component: price_gap,
            recency_component: recency,
            confidence_level: confidence,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_scoring_engine() {
        let engine = ScoringEngine::new();
        let score = engine.calculate_score(
            "G", // dpe_grade
            420, // dpe_score
            500, // holding_days
            1.5, // market_momentum
            0.8, // neighborhood_trend
            100000.0, // estimated_price
            120000.0, // market_price
            30, // dpe_age_days
        );

        assert!(score.overall_score > 0.0);
        assert!(score.overall_score <= 100.0);
        assert!(score.dpe_severity_component > 0.0);
    }
}
