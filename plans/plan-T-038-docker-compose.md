# Implementation Plan: T-038 — `docker-compose.prod.yml` with healthcheck + `devtools-infra` integration

## Task Reference
- **Task ID:** T-038
- **Type:** DevOps
- **Workflow:** standard
- **Complexity:** S
- **Dependencies:** T-037 (Dockerfile + nginx.conf)
- **Rationale:** Integrates the container with the umbrella stack and lets the umbrella's health gate observe it.

## Overview
Single-service compose file. Joins the external `devtools-infra` network. Binds **loopback only** on `127.0.0.1:4200:80` (load-bearing for the network-gated posture). Declares a `HEALTHCHECK` that proves nginx serves the index — liveness, not readiness; readiness is T-039's separate smoke script.

## Implementation Steps

### Step 1: `docker-compose.prod.yml`
**File:** `docker-compose.prod.yml`
**Action:** Create

```yaml
# Production compose for the operator-local topology. Joins the umbrella
# devtools-infra network so the SPA container is visible alongside the
# orchestrator. Loopback bind is intentional — see ARCHITECTURE.md
# § "Interim security posture".

services:
  ui:
    image: carestechs-ao-ui:latest
    build:
      context: .
      args:
        ORCHESTRATOR_BASE_URL: ${ORCHESTRATOR_BASE_URL:?ORCHESTRATOR_BASE_URL is required}
        ORCHESTRATOR_API_KEY: ${ORCHESTRATOR_API_KEY:?ORCHESTRATOR_API_KEY is required}
        OPERATOR_PASSPHRASE: ${OPERATOR_PASSPHRASE:?OPERATOR_PASSPHRASE is required}
    container_name: carestechs-ao-ui
    restart: unless-stopped
    ports:
      - "127.0.0.1:4200:80"
    networks:
      - devtools-infra
    healthcheck:
      # Liveness only — proves nginx serves the index. Readiness (can the
      # SPA actually reach the orchestrator with CORS) is scripts/smoke-prod.sh.
      test: ["CMD", "wget", "-qO-", "http://localhost/", "|", "grep", "-q", "<app-root"]
      interval: 30s
      timeout: 3s
      retries: 3
      start_period: 5s

networks:
  devtools-infra:
    external: true
    name: devtools-infra
```

Note: docker compose's `test` array form doesn't honor shell pipes; the `wget ... | grep ...` above would actually run `wget` with literal `|` and `grep` as args. **Real form needs `["CMD-SHELL", "..."]`**:

```yaml
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost/ | grep -q '<app-root'"]
      interval: 30s
      timeout: 3s
      retries: 3
      start_period: 5s
```

- Use `CMD-SHELL`, not `CMD`, so the pipe works.
- The `${VAR:?msg}` syntax means compose fails loud at parse time if any required env var is unset. Operators see a clear error, not a confusing build failure later.
- `restart: unless-stopped` keeps the container alive across reboots without restarting after an operator-initiated stop.

### Step 2: `.env.example` for compose
**File:** `.env.example` (repo root)
**Action:** Create

```
# Copy to .env (gitignored) and fill in for `docker compose -f docker-compose.prod.yml up`.
# These are passed to the Dockerfile as build args; they end up in the bundle
# (interim posture — see docs/ARCHITECTURE.md § "Interim security posture").
ORCHESTRATOR_BASE_URL=http://127.0.0.1:8000
ORCHESTRATOR_API_KEY=replace-me
OPERATOR_PASSPHRASE=replace-me
```

- `.env` itself is already gitignored (root `.env` pattern in `.gitignore`).
- Compose auto-loads `.env` from the working directory.

### Step 3: Local smoke
**Action:** Verify

- `cp .env.example .env`, edit values to point at a running orchestrator (the e2e mock works: `ORCHESTRATOR_BASE_URL=http://127.0.0.1:4100`).
- If `devtools-infra` network doesn't exist locally: `docker network create devtools-infra`.
- `docker compose -f docker-compose.prod.yml up -d --build`.
- `docker compose -f docker-compose.prod.yml ps` → expect `Up (healthy)` within ~15s.
- `curl http://127.0.0.1:4200/` returns the index.
- `curl http://<your-LAN-ip>:4200/` should **fail** (connection refused or timeout — loopback bind working as intended).
- `docker compose -f docker-compose.prod.yml down` cleans up.

## Files Affected
| File | Action | Summary |
|------|--------|---------|
| `docker-compose.prod.yml` | Create | One service, loopback bind, devtools-infra external network, liveness healthcheck. |
| `.env.example` | Create | Documents the three required build/compose env vars. |

## Edge Cases & Risks
- **`devtools-infra` network missing.** Compose errors with "network devtools-infra declared as external, but could not be found." T-040's docs section instructs operators to `docker network create devtools-infra` if missing.
- **`127.0.0.1:4200:80` vs `0.0.0.0:4200:80`.** Loopback bind is load-bearing. If anyone changes it to `0.0.0.0` (or omits the IP, which defaults to all interfaces), the network-gated assumption from FEAT-003 breaks. Worth a comment in the compose file. Already included above.
- **Healthcheck false negatives.** If nginx ever serves a transient error during startup (rare but possible), `start_period: 5s` absorbs it. If it persistently fails, retries × interval = 90s before the container is marked unhealthy — acceptable.
- **`HEALTHCHECK` requires `wget` in the image.** `nginx:alpine` ships busybox `wget` by default; verified during T-037.
- **Image rebuild vs pull.** `image: carestechs-ao-ui:latest` plus a `build:` section means compose will rebuild on first `up` if no image exists. Subsequent `up` calls use the existing image. To force a rebuild: `docker compose up --build`. Document in T-040.
- **Env-var `:?` syntax.** Requires compose >= 1.27. Modern docker installs have this; older RHEL boxes might not. If we ever target older compose, drop the `:?` and add a runtime check inside the Dockerfile (already there — see T-037 Step 3).

## Acceptance Verification
- [ ] `docker compose -f docker-compose.prod.yml config` parses without errors when `.env` is populated.
- [ ] `docker compose -f docker-compose.prod.yml config` errors loud when any required env var is missing.
- [ ] `docker compose up -d` brings the container to `healthy` within 15s.
- [ ] Container is reachable on `127.0.0.1:4200` from the host, unreachable from other LAN addresses.
- [ ] `docker compose down` cleans up; the external `devtools-infra` network is not destroyed.
- [ ] Compose file declares the network as `external: true` so it doesn't try to create one.
