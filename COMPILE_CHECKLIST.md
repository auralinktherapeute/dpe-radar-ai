# 🔧 Compilation Checklist — Step by Step

## Prerequisites Check ✅

```bash
# 1. Verify Rust installed
rustc --version  # >= 1.75
cargo --version

# 2. Verify Docker installed
docker --version
docker-compose --version

# 3. Verify Node.js (for Next.js)
node --version  # >= 18
npm --version
```

## Phase 1: Local Rust Build

```bash
cd /Users/geraldhenry/Downloads/dpe-radar-ai

# Step 1: Check dependencies
cargo check --all
# Expected: ✅ Checking dpe-radar-workers v0.1.0...
# Expected: ✅ Checking obscura-dpe v0.1.0...
# Expected: ✅ Checking obscura-client v0.1.0...

# Step 2: Run tests
cargo test --release --all
# Expected: test result: ok. X passed...

# Step 3: Build release binaries
cargo build --release --workspace
# Expected: ✅ Finished release [optimized] target(s)
# Expected: Binary sizes:
#   - target/release/dpe-radar-workers (~40MB)
```

## Phase 2: Docker Build

```bash
# Step 4: Build worker image
docker build -t dpe-worker:latest -f Dockerfile.rust-worker .
# Expected: ✅ Successfully built dpe-worker:latest
# Expected: Size: ~40-50MB (stripped binary)

# Step 5: Build Obscura image
docker build -t obscura-cdp:latest -f Dockerfile.obscura-cdp .
# Expected: ✅ Successfully built obscura-cdp:latest
# Expected: Size: ~30-40MB

# Verify images
docker images | grep -E "dpe-worker|obscura-cdp"
```

## Phase 3: Service Launch

```bash
# Step 6: Start services
docker-compose up --build -d

# Step 7: Verify services are healthy
docker-compose ps
# Expected output:
# NAME                  STATUS
# dpe-postgres          Up (healthy)
# dpe-redis             Up (healthy)
# dpe-obscura-cdp       Up (healthy)
# dpe-worker            Up
# dpe-app               Up

# Step 8: Test PostgreSQL
docker exec dpe-postgres psql -U dpe_user -d dpe_radar -c "SELECT 1"
# Expected: ✅ (1 row)

# Step 9: Test Redis
docker exec dpe-redis redis-cli ping
# Expected: PONG

# Step 10: Test Obscura CDP
curl -s http://localhost:9222/json/version | jq .
# Expected: JSON with version info

# Step 11: Check worker logs
docker logs dpe-worker
# Expected: ✅ DPE Radar Workers starting...
# Expected: ✅ PostgreSQL connected
# Expected: ✅ Redis connected
# Expected: 🔄 Starting Bull MQ consumer loop...
```

## Phase 4: Functional Tests

```bash
# Step 12: Test Bull MQ task consumption
# Add a test task to queue
docker exec dpe-redis redis-cli RPUSH bullmq:queue:dpe-radar:waiting \
  '{"name":"sync-dpe-ademe","data":{"batch_size":10},"id":"test-1"}'

# Check worker processed it
docker logs dpe-worker | grep "Processing task"
# Expected: ✅ Processing task test-1 (sync-dpe-ademe)

# Step 13: Test Obscura CDP scraping
curl -X POST http://localhost:9222/json/new \
  -H "Content-Type: application/json" \
  -d '{}'
# Expected: JSON with page ID and WebSocket URL

# Step 14: Monitor performance
# Watch worker throughput
watch -n 1 'docker stats dpe-worker'
# Expected: CPU usage increases during tasks
# Expected: Memory < 100MB
```

## Phase 5: Production Build

```bash
# Step 15: Push to registry (optional)
docker tag dpe-worker:latest yourregistry/dpe-worker:latest
docker tag obscura-cdp:latest yourregistry/obscura-cdp:latest
docker push yourregistry/dpe-worker:latest
docker push yourregistry/obscura-cdp:latest

# Step 16: Deploy to production
# For Railway
railway up

# For Render
render deploy --name dpe-radar

# For Kubernetes
kubectl apply -f .
```

## Troubleshooting

### Build Fails: Cargo dependency resolution

```bash
# Clear cache and retry
cargo clean
rm Cargo.lock
cargo build --release --workspace
```

### Build Fails: Rust version mismatch

```bash
# Update Rust
rustup update stable
rustup component add rustfmt clippy
```

### Docker build fails: Layer caching

```bash
# Force rebuild without cache
docker build -t dpe-worker:latest -f Dockerfile.rust-worker . --no-cache
```

### Services won't start: Port conflicts

```bash
# Check which process uses ports
lsof -i :5432  # PostgreSQL
lsof -i :6379  # Redis
lsof -i :9222  # Obscura CDP
lsof -i :3000  # Next.js

# Kill and retry
docker-compose down -v
docker-compose up -d
```

### Worker doesn't consume tasks

```bash
# Check Redis connection
docker exec dpe-redis redis-cli KEYS "bullmq:*"
# Should show queue keys

# Check worker logs for errors
docker logs dpe-worker -f
```

---

## ✅ Success Criteria

- [ ] All Rust crates compile without warnings
- [ ] All unit tests pass (cargo test)
- [ ] Docker images build successfully
- [ ] All 4 services (postgres, redis, obscura, worker) report healthy
- [ ] Worker can consume at least 1 task from Bull MQ
- [ ] Obscura CDP responds to health check
- [ ] Memory usage < 100MB per service
- [ ] Logs show no errors at INFO level

---

## 🎯 Next Steps After Success

1. **Verify database schema** :
   ```bash
   docker exec dpe-postgres psql -U dpe_user -d dpe_radar -c "\dt"
   ```

2. **Monitor real-time logs** :
   ```bash
   docker-compose logs -f --tail=50
   ```

3. **Load test** :
   ```bash
   for i in {1..100}; do
     docker exec dpe-redis redis-cli RPUSH bullmq:queue:dpe-radar:waiting \
       "{\"name\":\"calculate-scores\",\"data\":{\"batch_size\":50,\"offset\":$((i*50))}}"
   done
   ```

4. **Monitor throughput** :
   ```bash
   watch -n 1 'docker exec dpe-postgres psql -U dpe_user -d dpe_radar -c "SELECT COUNT(*) FROM opportunity_scores"'
   ```

---

**Last Updated**: 2026-08-21
**Estimated Build Time**: 15-30 minutes (depending on system)
**Expected Success Rate**: 99% (with prerequisites)
