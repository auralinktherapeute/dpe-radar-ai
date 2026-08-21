use std::sync::Arc;
use anyhow::Result;
use redis::aio::ConnectionManager;
use serde_json::Value;
use sqlx::PgPool;
use tracing::{info, warn, error};
use std::time::Duration;
use tokio::time::sleep;

use crate::dpe_sync::SyncDpeTask;
use crate::scoring::ScoringTask;
use crate::annonce_scrape::AnnonceScrapeTask;

pub struct BullMQConsumer {
    pool: Arc<PgPool>,
    redis: ConnectionManager,
}

impl BullMQConsumer {
    pub fn new(pool: Arc<PgPool>, redis: ConnectionManager) -> Self {
        Self { pool, redis }
    }

    pub async fn consume_tasks(&self) -> Result<()> {
        loop {
            // Get pending tasks from Redis Bull queue
            let tasks = self.fetch_pending_tasks().await?;

            if tasks.is_empty() {
                sleep(Duration::from_secs(5)).await;
                continue;
            }

            for task in tasks {
                if let Err(e) = self.process_task(&task).await {
                    error!("Failed to process task: {}", e);
                    self.mark_task_failed(&task, &e.to_string()).await.ok();
                }
            }

            sleep(Duration::from_secs(1)).await;
        }
    }

    async fn fetch_pending_tasks(&self) -> Result<Vec<Value>> {
        // Bull queue key pattern: "bullmq:queue:<queue_name>:<status>"
        let queue_key = "bullmq:queue:dpe-radar:waiting";

        let mut conn = self.redis.clone();
        let count: usize = redis::cmd("LLEN")
            .arg(&queue_key)
            .query_async(&mut conn)
            .await?;

        if count == 0 {
            return Ok(Vec::new());
        }

        let mut tasks = Vec::new();
        for _ in 0..count.min(10) {
            if let Ok(Some(task_json)) = redis::cmd("LPOP")
                .arg(&queue_key)
                .query_async::<_, Option<String>>(&mut conn)
                .await
            {
                if let Ok(task) = serde_json::from_str::<Value>(&task_json) {
                    tasks.push(task);
                }
            }
        }

        Ok(tasks)
    }

    async fn process_task(&self, task: &Value) -> Result<()> {
        let task_type = task["name"].as_str().unwrap_or("unknown");
        let task_id = task["id"].as_str().unwrap_or("unknown");
        let data = &task["data"];

        info!("Processing task {} ({})", task_id, task_type);

        match task_type {
            "sync-dpe-ademe" => {
                let sync_task = SyncDpeTask::new(Arc::clone(&self.pool));
                sync_task.execute(data).await?;
            }
            "calculate-scores" => {
                let scoring_task = ScoringTask::new(Arc::clone(&self.pool));
                scoring_task.execute(data).await?;
            }
            "sync-annonces-obscura" => {
                let scrape_task = AnnonceScrapeTask::new(Arc::clone(&self.pool));
                scrape_task.execute(data).await?;
            }
            _ => {
                warn!("Unknown task type: {}", task_type);
            }
        }

        self.mark_task_completed(task_id).await?;
        Ok(())
    }

    async fn mark_task_completed(&self, task_id: &str) -> Result<()> {
        info!("✅ Task {} completed", task_id);
        Ok(())
    }

    async fn mark_task_failed(&self, task: &Value, reason: &str) -> Result<()> {
        let task_id = task["id"].as_str().unwrap_or("unknown");
        error!("❌ Task {} failed: {}", task_id, reason);
        Ok(())
    }
}

pub struct Task {
    pub id: String,
    pub name: String,
    pub data: Value,
}
