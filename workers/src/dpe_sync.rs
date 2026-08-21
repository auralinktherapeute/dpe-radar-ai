use std::sync::Arc;
use anyhow::Result;
use serde_json::Value;
use sqlx::PgPool;
use tracing::info;
use rayon::prelude::*;

/// Task: Sync DPE data from ADEME API for batch of properties
pub struct SyncDpeTask {
    pool: Arc<PgPool>,
}

impl SyncDpeTask {
    pub fn new(pool: Arc<PgPool>) -> Self {
        Self { pool }
    }

    pub async fn execute(&self, data: &Value) -> Result<()> {
        let batch_size = data["batch_size"].as_u64().unwrap_or(100) as usize;
        let offset = data["offset"].as_u64().unwrap_or(0) as i64;

        info!("🔄 Syncing {} DPE records (offset: {})", batch_size, offset);

        // Fetch properties from DB
        let properties: Vec<(String, String)> = sqlx::query_as::<_, (String, String)>(
            "SELECT id, address FROM therapeutes LIMIT $1 OFFSET $2"
        )
        .bind(batch_size as i64)
        .bind(offset)
        .fetch_all(self.pool.as_ref())
        .await?;

        let prop_count = properties.len();
        info!("📦 Fetched {} properties", prop_count);

        // Parallel DPE fetch (using rayon for CPU-bound work)
        let dpe_results: Vec<_> = properties
            .par_iter()
            .map(|(property_id, address)| {
                // Mock ADEME API call
                (property_id.clone(), address.clone(), "G".to_string(), 420)
            })
            .collect();

        // Batch insert DPE diagnostics
        for (property_id, _address, grade, score) in &dpe_results {
            sqlx::query(
                "INSERT INTO dpe_diagnostics (property_id, dpe_grade, dpe_score, diagnostic_date)
                 VALUES ($1, $2, $3, NOW())
                 ON CONFLICT (property_id) DO UPDATE SET dpe_score = $3, dpe_grade = $2"
            )
            .bind(&property_id)
            .bind(&grade)
            .bind(score)
            .execute(self.pool.as_ref())
            .await?;
        }

        info!("✅ DPE sync completed for {} records", dpe_results.len());
        Ok(())
    }
}
