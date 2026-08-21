use std::sync::Arc;
use anyhow::Result;
use serde_json::Value;
use sqlx::PgPool;
use tracing::info;
use rayon::prelude::*;
use chrono::Utc;
use obscura_dpe::scoring::ScoringEngine;

/// Task: Calculate opportunity scores for properties
pub struct ScoringTask {
    pool: Arc<PgPool>,
}

impl ScoringTask {
    pub fn new(pool: Arc<PgPool>) -> Self {
        Self { pool }
    }

    pub async fn execute(&self, data: &Value) -> Result<()> {
        let batch_size = data["batch_size"].as_u64().unwrap_or(100) as usize;
        let offset = data["offset"].as_u64().unwrap_or(0) as i64;

        info!("🧮 Calculating scores for {} properties (offset: {})", batch_size, offset);

        // Fetch properties with DPE data
        let properties: Vec<(String, i64, Option<String>, Option<i32>)> = sqlx::query_as(
            r#"SELECT p.id, EXTRACT(EPOCH FROM p.created_at)::bigint,
                      d.dpe_grade, d.dpe_score
               FROM therapeutes p
               LEFT JOIN dpe_diagnostics d ON p.id = d.property_id
               LIMIT $1 OFFSET $2"#
        )
        .bind(batch_size as i64)
        .bind(offset)
        .fetch_all(self.pool.as_ref())
        .await?;

        info!("📦 Fetched {} properties", properties.len());

        let engine = ScoringEngine::new();

        // Parallel scoring calculation
        let scoring_results: Vec<_> = properties
            .par_iter()
            .map(|(id, created_at_ts, dpe_grade, dpe_score)| {
                let grade = dpe_grade.as_deref().unwrap_or("N/A");
                let score_val = dpe_score.unwrap_or(300);
                let holding_days = ((Utc::now().timestamp() - created_at_ts) / 86400) as i32;

                let score = engine.calculate_score(
                    grade,
                    score_val,
                    holding_days,
                    1.2, // market_momentum
                    0.7, // neighborhood_trend
                    150000.0, // estimated_price
                    160000.0, // market_price
                    60, // dpe_age_days
                );

                (id.clone(), score.overall_score)
            })
            .collect();

        info!("✨ Calculated {} scores", scoring_results.len());

        let count = scoring_results.len();

        // Batch update opportunity_scores table
        for (property_id, score) in &scoring_results {
            sqlx::query(
                "INSERT INTO opportunity_scores (property_id, overall_score, updated_at)
                 VALUES ($1, $2, NOW())
                 ON CONFLICT (property_id) DO UPDATE SET overall_score = $2, updated_at = NOW()"
            )
            .bind(&property_id)
            .bind(score)
            .execute(self.pool.as_ref())
            .await?;
        }

        info!("✅ Scoring completed for {} properties", count);
        Ok(())
    }
}
