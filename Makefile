.PHONY: help build test clean docker-build docker-up docker-down deploy

help:
	@echo "🚀 DPE Radar AI × Obscura — Development Commands"
	@echo ""
	@echo "Rust Commands:"
	@echo "  make build              Build all crates in release mode"
	@echo "  make test               Run all unit tests"
	@echo "  make check              Run cargo check (fast)"
	@echo "  make clippy             Run clippy linter"
	@echo "  make fmt                Format code with rustfmt"
	@echo "  make fmt-check          Check formatting (CI)"
	@echo ""
	@echo "Docker Commands:"
	@echo "  make docker-build       Build worker + CDP images"
	@echo "  make docker-up          Start all services (docker-compose)"
	@echo "  make docker-down        Stop all services"
	@echo "  make docker-logs        View service logs (-f)"
	@echo ""
	@echo "Development:"
	@echo "  make run-worker         Run worker locally (requires Docker for DB/Redis)"
	@echo "  make run-obscura        Run Obscura CDP locally"
	@echo "  make clean              Clean Rust build artifacts"
	@echo ""

# Rust commands
build:
	@echo "🏗️  Building all crates..."
	cargo build --release --workspace --locked
	@echo "✅ Build complete!"

test:
	@echo "🧪 Running tests..."
	cargo test --release --workspace
	@echo "✅ Tests complete!"

check:
	@echo "🔍 Checking code..."
	cargo check --all --all-targets

clippy:
	@echo "📌 Running clippy..."
	cargo clippy --all --all-targets -- -D warnings

fmt:
	@echo "🎨 Formatting code..."
	cargo fmt --all

fmt-check:
	@echo "🔍 Checking format..."
	cargo fmt --all -- --check

# Docker commands
docker-build:
	@echo "🐳 Building Docker images..."
	docker build -t dpe-worker:latest -f Dockerfile.rust-worker .
	docker build -t obscura-cdp:latest -f Dockerfile.obscura-cdp .
	@echo "✅ Docker images built!"

docker-up: docker-build
	@echo "🚀 Starting services..."
	docker-compose up -d
	@echo "✅ Services started!"
	@echo "   PostgreSQL: localhost:5432"
	@echo "   Redis: localhost:6379"
	@echo "   Obscura CDP: localhost:9222"
	@echo "   App: localhost:3000"

docker-down:
	@echo "🛑 Stopping services..."
	docker-compose down
	@echo "✅ Services stopped!"

docker-logs:
	docker-compose logs -f --tail=100

docker-ps:
	docker-compose ps

# Development commands
run-worker:
	@echo "🏃 Running worker locally..."
	RUST_LOG=debug \
	DATABASE_URL="postgresql://dpe_user:secure_password@localhost:5432/dpe_radar" \
	REDIS_URL="redis://localhost:6379" \
	OBSCURA_CDP_URL="http://localhost:9222" \
	cargo run --release -p dpe-radar-workers

run-obscura:
	@echo "🕷️  Running Obscura CDP..."
	cd /tmp/obscura && \
	cargo run --release --bin obscura-cli -- \
		--headless \
		--disable-blink-features=AutomationControlled \
		--remote-debugging-port=9222

# Cleanup
clean:
	@echo "🧹 Cleaning build artifacts..."
	cargo clean
	@echo "✅ Clean complete!"

# Full CI-like check
ci: fmt-check check clippy test
	@echo "✅ All CI checks passed!"

# Development workflow
dev: check docker-up
	@echo "✅ Development environment ready!"
	@echo "   Worker logs: make docker-logs"
	@echo "   Stop services: make docker-down"

# Deploy to production
deploy: ci docker-build
	@echo "🚀 Ready to deploy!"
	@echo "   Run: docker-compose -f docker-compose.yml push"
	@echo "   Then: docker-compose -f docker-compose.yml up -d"
