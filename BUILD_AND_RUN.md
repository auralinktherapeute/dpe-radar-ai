# 🚀 DPE Radar AI × Obscura — Build & Deployment Guide

## 📋 Prérequis

- **Rust** >= 1.75 (`rustup install`)
- **Docker** & **Docker Compose**
- **Node.js** >= 18 (pour le frontend Next.js)
- **PostgreSQL** 16+ (si développement local)

## 🏗️ Phase 1 — Setup Local (Development)

### 1.1 Cloner et initialiser le workspace Rust

```bash
cd /Users/geraldhenry/Downloads/dpe-radar-ai

# Vérifier la structure
ls -la obscura-dpe/ workers/ obscura-client/ Cargo.toml

# Build en release pour dev
cargo build --release -p obscura-dpe
cargo build --release -p workers
cargo build --release -p obscura-client
```

### 1.2 Setup PostgreSQL local

```bash
# Via Docker (optionnel)
docker run --name dpe-postgres -e POSTGRES_PASSWORD=secure -d \
  -p 5432:5432 postgis/postgis:16-3.4

# Ou via Homebrew (macOS)
brew install postgresql@16 postgis
```

### 1.3 Setup Redis local

```bash
docker run --name dpe-redis -d -p 6379:6379 redis:7.2-alpine
```

### 1.4 Run Obscura CDP local

```bash
# Build Obscura CLI
cd /tmp/obscura
cargo build --release --bin obscura-cli --features render,stealth,pdf

# Lancer le serveur CDP
./target/release/obscura-cli --remote-debugging-port=9222
```

### 1.5 Run worker local

```bash
cd /Users/geraldhenry/Downloads/dpe-radar-ai

# En dev mode (logs détaillés)
RUST_LOG=debug \
DATABASE_URL="postgresql://dpe_user:secure_password@localhost:5432/dpe_radar" \
REDIS_URL="redis://localhost:6379" \
OBSCURA_CDP_URL="http://localhost:9222" \
cargo run --release -p workers
```

---

## 🐳 Phase 2 — Docker Build & Deployment

### 2.1 Build images

```bash
cd /Users/geraldhenry/Downloads/dpe-radar-ai

# Build Rust worker image
docker build -t dpe-worker:latest -f Dockerfile.rust-worker .

# Build Obscura CDP image
docker build -t obscura-cdp:latest -f Dockerfile.obscura-cdp .

# Build Next.js app image
docker build -t dpe-app:latest .
```

### 2.2 Configuration

```bash
# Créer .env depuis .env.example
cp .env.example .env

# Éditer .env pour production
# - Changer DB_PASSWORD
# - Changer NEXT_PUBLIC_API_URL vers ton domaine
```

### 2.3 Lancer les services

```bash
# Down any existing services
docker-compose down

# Build & start all services
docker-compose up --build -d

# Vérifier que tout est prêt
docker-compose ps
docker-compose logs -f dpe-worker

# PostgreSQL ready: "✅ PostgreSQL connected"
# Redis ready: "✅ Redis connected"
# Obscura CDP: "✅ CDP Server ready!"
```

### 2.4 Vérifier les services

```bash
# Health check Obscura CDP
curl -s http://localhost:9222/json/version | jq .

# Health check PostgreSQL
psql -h localhost -U dpe_user -d dpe_radar -c "SELECT 1"

# Health check Redis
redis-cli ping

# Check worker logs
docker logs dpe-worker

# Check app logs
docker logs dpe-app
```

---

## ⚡ Performance Tunning

### 3.1 Rust Worker Optimization

```toml
# Cargo.toml optimization flags
[profile.release]
opt-level = 3
lto = true
codegen-units = 1
strip = true
panic = "abort"
```

### 3.2 PostgreSQL Optimization

```sql
-- Créer indexes pour scoring
CREATE INDEX idx_properties_created ON therapeutes(created_at);
CREATE INDEX idx_dpe_grade ON dpe_diagnostics(dpe_grade);
CREATE INDEX idx_scores_property ON opportunity_scores(property_id);
```

### 3.3 Redis Optimization

```bash
# Memory limit (max 2GB)
docker exec dpe-redis redis-cli CONFIG SET maxmemory 2gb

# Persistence strategy
docker exec dpe-redis redis-cli CONFIG SET save "900 1 300 10 60 10000"
```

---

## 🚀 Production Deployment

### 4.1 Railway / Render / Vercel

```bash
# Push to GitHub
git add .
git commit -m "Add Rust workers and Obscura integration"
git push origin main

# Railway deployment (Dockerfile.rust-worker)
railway up

# Render deployment (docker-compose.yml)
render deploy --name dpe-radar
```

### 4.2 Kubernetes (Optional)

```bash
# Generate k8s manifests from docker-compose
kompose convert -f docker-compose.yml

# Deploy
kubectl apply -f .
```

---

## 🧪 Testing

### 5.1 Unit tests

```bash
cd obscura-dpe && cargo test --release
cd ../workers && cargo test --release
cd ../obscura-client && cargo test --release
```

### 5.2 Integration tests

```bash
# Start services
docker-compose up -d

# Run Bull MQ test queue
redis-cli RPUSH bullmq:queue:dpe-radar:waiting '{"name":"sync-dpe-ademe","data":{"batch_size":10}}'

# Check worker processed it
docker logs dpe-worker | grep "✅ Task"
```

### 5.3 Load testing

```bash
# Generate 100 scoring tasks
for i in {1..100}; do
  redis-cli RPUSH bullmq:queue:dpe-radar:waiting "{\"name\":\"calculate-scores\",\"data\":{\"batch_size\":50,\"offset\":$((i*50))}}"
done

# Monitor worker throughput
watch -n 1 'docker logs dpe-worker | tail -20'
```

---

## 🔍 Troubleshooting

### Worker not starting

```bash
# Check Rust compilation errors
docker build -f Dockerfile.rust-worker . --progress=plain

# Check environment variables
docker-compose config | grep -A 10 "dpe-worker:"
```

### Obscura CDP not connecting

```bash
# Verify CDP server is running
curl -v http://localhost:9222/json/version

# Check Obscura logs
docker logs dpe-obscura-cdp

# Rebuild Obscura image
docker build -t obscura-cdp:latest -f Dockerfile.obscura-cdp . --no-cache
```

### Database connection issues

```bash
# Test PostgreSQL connection
docker exec dpe-postgres psql -U dpe_user -d dpe_radar -c "SELECT 1"

# Check connection string
echo $DATABASE_URL

# Reset database
docker exec dpe-postgres psql -U dpe_user -d dpe_radar -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
```

---

## 📊 Monitoring

### 6.1 Prometheus metrics (future)

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'dpe-worker'
    static_configs:
      - targets: ['localhost:9090']
```

### 6.2 Logs aggregation

```bash
# View all service logs
docker-compose logs -f --tail=50

# Filter by service
docker-compose logs -f dpe-worker
docker-compose logs -f obscura-cdp
docker-compose logs -f postgres
```

---

## 🎯 Next Steps

1. ✅ Rust workspace compiles
2. ✅ Workers consume Bull MQ tasks
3. ✅ Obscura CDP scrapes annonces
4. ⏳ Integrate with Next.js frontend
5. ⏳ Deploy to production (Railway/Render)
6. ⏳ Setup CI/CD (GitHub Actions)
7. ⏳ Add monitoring (Prometheus/Grafana)
