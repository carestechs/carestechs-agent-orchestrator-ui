# Implementation Plan: T-037 — Multi-stage Dockerfile + `.dockerignore` + `nginx.conf`

## Task Reference
- **Task ID:** T-037
- **Type:** DevOps
- **Workflow:** standard
- **Complexity:** M
- **Dependencies:** T-036 (CORS verified)
- **Rationale:** This is the deliverable that turns the SPA into something operators can pull and run.

## Overview
Author a multi-stage Dockerfile (`node:20-alpine` builder → `nginx:alpine` runtime), an `nginx.conf` with split cache-control + gzip + brotli + baseline security headers + a starter CSP, and a `.dockerignore` that prevents the gitignored env files from sneaking into the build context.

## Implementation Steps

### Step 1: `.dockerignore`
**File:** `.dockerignore`
**Action:** Create

```
node_modules
dist
coverage
.lighthouseci
e2e/test-results
playwright-report
.angular
.git
.github
.vscode
.claude
src/environments/environment.ts
src/environments/environment.prod.ts
*.log
```

- The two env-file excludes are intentional. Real env files are gitignored AND dockerignored; the only path into the image is via build args.

### Step 2: `nginx.conf`
**File:** `nginx.conf`
**Action:** Create

```nginx
worker_processes auto;
events { worker_connections 1024; }

http {
  include       /etc/nginx/mime.types;
  default_type  application/octet-stream;
  sendfile        on;
  tcp_nopush      on;
  tcp_nodelay     on;
  keepalive_timeout  65;

  gzip on;
  gzip_min_length 1024;
  gzip_types text/css application/javascript application/json image/svg+xml text/plain;
  gzip_vary on;

  # brotli requires the nginx-brotli module; nginx:alpine doesn't ship it.
  # If we ever switch base image to one that includes it, uncomment:
  # brotli on;
  # brotli_types text/css application/javascript application/json image/svg+xml text/plain;

  server {
    listen 80 default_server;
    server_name _;
    root /usr/share/nginx/html;

    # Baseline security headers (apply to every response).
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Starter CSP — intentionally permissive on 'unsafe-inline' for Angular's
    # runtime (zone.js synthesizes inline event handlers). Tighten in a
    # follow-up once we've observed live behavior with report-only first.
    # ORCHESTRATOR_BASE_URL is substituted at image build time (see Dockerfile).
    add_header Content-Security-Policy "default-src 'self'; connect-src 'self' __ORCHESTRATOR_BASE_URL__; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data:;" always;

    # index.html must never cache — deploys take effect immediately.
    location = /index.html {
      add_header Cache-Control "no-store" always;
      add_header X-Content-Type-Options "nosniff" always;
      try_files /index.html =404;
    }

    # Hashed assets cache forever — content-addressed by Angular's outputHashing.
    location ~* \.(js|css|woff2?|ttf|otf|svg|png|jpg|jpeg|gif|ico|map)$ {
      add_header Cache-Control "public, max-age=31536000, immutable" always;
      try_files $uri =404;
    }

    # SPA fallback for everything else.
    location / {
      try_files $uri $uri/ /index.html;
    }
  }
}
```

- The `__ORCHESTRATOR_BASE_URL__` placeholder is substituted at image build time by the Dockerfile (Step 3). Doing this at build time rather than runtime keeps nginx config static and avoids an entrypoint script.

### Step 3: `Dockerfile`
**File:** `Dockerfile`
**Action:** Create

```dockerfile
# syntax=docker/dockerfile:1.7

# -----------------------------------------------------------------------------
# Builder stage: node:20-alpine, npm ci, materialize env.prod.ts, ng build.
# -----------------------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Build-arg contract — these become baked into the bundle. See the
# "build-args-in-layer-history" caveat in CLAUDE.md before pushing images.
ARG ORCHESTRATOR_BASE_URL
ARG ORCHESTRATOR_API_KEY
ARG OPERATOR_PASSPHRASE

# Fail loud if any required build-arg is missing.
RUN test -n "$ORCHESTRATOR_BASE_URL" || (echo "ERROR: --build-arg ORCHESTRATOR_BASE_URL is required" >&2 && exit 1) && \
    test -n "$ORCHESTRATOR_API_KEY"  || (echo "ERROR: --build-arg ORCHESTRATOR_API_KEY is required" >&2 && exit 1) && \
    test -n "$OPERATOR_PASSPHRASE"   || (echo "ERROR: --build-arg OPERATOR_PASSPHRASE is required" >&2 && exit 1)

# Cache npm deps first.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Copy the rest of the build context.
COPY . .

# Materialize the Angular env files. Identical heredoc to the CI workflows.
RUN cat > src/environments/environment.ts <<EOF
import type { EnvironmentConfig } from './environment.example';
export const environment: EnvironmentConfig = {
  production: true,
  orchestratorBaseUrl: '${ORCHESTRATOR_BASE_URL}',
  orchestratorApiKey: '${ORCHESTRATOR_API_KEY}',
  operatorPassphrase: '${OPERATOR_PASSPHRASE}',
};
EOF
RUN cp src/environments/environment.ts src/environments/environment.prod.ts

# Build. Note: npm run build invokes the postbuild secret-scan; it should pass
# because nothing is registered as "forbidden" in the current script.
RUN npm run build

# -----------------------------------------------------------------------------
# Runtime stage: nginx:alpine + the built SPA + substituted nginx.conf.
# -----------------------------------------------------------------------------
FROM nginx:alpine AS runtime

# Substitute the orchestrator base URL into the CSP placeholder.
ARG ORCHESTRATOR_BASE_URL
COPY nginx.conf /etc/nginx/nginx.conf
RUN sed -i "s|__ORCHESTRATOR_BASE_URL__|${ORCHESTRATOR_BASE_URL}|g" /etc/nginx/nginx.conf

# Drop the bundle in place.
COPY --from=builder /app/dist/spa/browser/ /usr/share/nginx/html/

# nginx:alpine already exposes 80 and runs nginx in the foreground.
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost/ | grep -q '<app-root' || exit 1
```

- The runtime stage re-declares `ARG ORCHESTRATOR_BASE_URL` because Docker scopes args per stage. The build args declared in the builder stage are not automatically available in the runtime stage.
- The runtime `sed` substitution is a build-time operation, not runtime — the image's `nginx.conf` is final once the image is built.
- `wget` is part of `busybox-extras` in `nginx:alpine`; it ships in the base image. No extra `RUN apk add`.

### Step 4: Local smoke
**Action:** Verify

- Build: `docker build -t carestechs-ao-ui --build-arg ORCHESTRATOR_BASE_URL=http://127.0.0.1:4100 --build-arg ORCHESTRATOR_API_KEY=test-key-do-not-leak --build-arg OPERATOR_PASSPHRASE=e2e-passphrase .`
- Run: `docker run --rm -p 4200:80 carestechs-ao-ui`
- Visit `http://localhost:4200`. Should serve the login screen.
- Verify cache headers:
  - `curl -I http://localhost:4200/` → `Cache-Control: no-store`.
  - `curl -I http://localhost:4200/<chunk-XYZ>.js` → `Cache-Control: public, max-age=31536000, immutable`.
- Verify SPA fallback: `curl -i http://localhost:4200/runs/anything` → 200 OK, body contains `<app-root`.
- Verify CSP header is present and contains the orchestrator base URL.
- Image size: `docker image ls carestechs-ao-ui` → expect ~50 MB.
- Trying to build without a required `--build-arg` should fail loud.

## Files Affected
| File | Action | Summary |
|------|--------|---------|
| `.dockerignore` | Create | Excludes node_modules, dist, env files, CI/test outputs, etc. |
| `nginx.conf` | Create | Static + SPA fallback, split cache-control, gzip, security headers, starter CSP with substitution placeholder. |
| `Dockerfile` | Create | Multi-stage builder + runtime; build-arg validation; env-file materialization; CSP substitution. |

## Edge Cases & Risks
- **Build args leak into image layer history.** `docker history` will show the ARG values. Acceptable under the interim posture; documented in `CLAUDE.md` (T-040). Upgrade path: BuildKit `--secret` mounts — out of scope for v1.
- **CSP `'unsafe-inline'`.** Required for Angular runtime today. If we ever drop zone.js (Angular 19+ has zoneless options), revisit. Documented inline in `nginx.conf`.
- **`brotli` not on `nginx:alpine`.** Left commented in the config. If we ever swap base image, uncomment. gzip alone gets us ~70% reduction; brotli would push to ~80% — not worth a base-image change for v1.
- **`postbuild` secret-scan in the builder.** Currently allow-everything (per T-034). If a future feat registers a forbidden value, the docker build will fail in the builder stage — visible, loud, easy to debug.
- **Build context size.** A clean clone yields ~200 MB of `node_modules` and `dist/` artifacts. `.dockerignore` should keep the context small (< 50 MB); if `docker build` is slow on cold caches, recheck `.dockerignore`.
- **Multi-arch.** `node:20-alpine` is `amd64` and `arm64` by default; `nginx:alpine` same. Single-arch (`amd64`) is fine for v1 per the brief, but if an operator on M-series Mac builds locally they'll get an `arm64` image. Not a problem — just worth noting.

## Acceptance Verification
- [ ] `docker build` completes successfully with all three required build args.
- [ ] `docker build` fails loud when any required build arg is missing.
- [ ] Image is `nginx:alpine`-based and ~50 MB.
- [ ] `Cache-Control` headers split correctly between `index.html` and hashed assets.
- [ ] SPA fallback works (`curl /runs/anything` returns index).
- [ ] CSP header is present and includes the build-arg `orchestratorBaseUrl` in `connect-src`.
- [ ] gzip enabled for the expected mime types.
- [ ] `.dockerignore` excludes the real env files; verified by `docker build --progress=plain` not mentioning them.
