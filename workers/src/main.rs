use std::sync::Arc;
use tokio::task;
use tracing::{info, error};
use redis::aio::ConnectionManager;
use sqlx::PgPool;

mod queue;
mod dpe_sync;
mod scoring;
mod annonce_scrape;

use queue::BullMQConsumer;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive(tracing::Level::INFO.into()),
        )
        .init();

    info!("🚀 DPE Radar Workers starting...");

    // Database connection
    let database_url = std::env::var("DATABASE_URL")
        .expect("DATABASE_URL not set");
    let pool = PgPool::connect(&database_url).await?;
    info!("✅ PostgreSQL connected");

    // Redis connection
    let redis_url = std::env::var("REDIS_URL")
        .unwrap_or_else(|_| "redis://localhost:6379".to_string());
    let client = redis::Client::open(redis_url)?;
    let manager = ConnectionManager::new(client).await?;
    info!("✅ Redis connected");

    // Create consumer
    let consumer = Arc::new(BullMQConsumer::new(
        Arc::new(pool),
        manager.clone(),
    ));

    info!("🔄 Starting Bull MQ consumer loop...");

    // Spawn consumer tasks
    let consumer_clone = Arc::clone(&consumer);
    let handle = task::spawn(async move {
        if let Err(e) = consumer_clone.consume_tasks().await {
            error!("Consumer error: {}", e);
        }
    });

    // Wait for graceful shutdown
    tokio::signal::ctrl_c().await?;
    info!("📵 Shutting down gracefully...");

    handle.abort();
    info!("✅ Worker stopped");

    Ok(())
}
