# syntax=docker/dockerfile:1.7

# -----------------------------------------------------------------------------
# Builder stage: node:20-alpine, npm ci, materialize env.prod.ts, ng build.
# -----------------------------------------------------------------------------
FROM node:20-alpine AS builder

# bash is needed by scripts/check-no-secrets-in-bundle.sh (invoked via the
# postbuild npm hook). Alpine ships busybox-sh by default.
RUN apk add --no-cache bash

WORKDIR /app

# Build-arg contract — these become baked into the bundle and into the image's
# layer history (`docker history` reveals them). Acceptable under FEAT-003's
# interim network-gated posture; do NOT push these images to a shared registry
# without a separate threat-model review. See docs/ARCHITECTURE.md
# § "Interim security posture" and CLAUDE.md § "Container build & run".
ARG ORCHESTRATOR_BASE_URL
ARG ORCHESTRATOR_API_KEY
ARG OPERATOR_PASSPHRASE

# Fail loud if any required build-arg is missing.
RUN test -n "$ORCHESTRATOR_BASE_URL" || (echo "ERROR: --build-arg ORCHESTRATOR_BASE_URL is required" >&2 && exit 1) && \
    test -n "$ORCHESTRATOR_API_KEY"  || (echo "ERROR: --build-arg ORCHESTRATOR_API_KEY is required" >&2 && exit 1) && \
    test -n "$OPERATOR_PASSPHRASE"   || (echo "ERROR: --build-arg OPERATOR_PASSPHRASE is required" >&2 && exit 1)

# Cache npm deps before copying the rest of the source tree.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Copy the rest of the build context (filtered by .dockerignore).
COPY . .

# Materialize the Angular env files. Mirrors the CI workflows' heredoc verbatim
# so they don't drift.
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

# Build. `npm run build` invokes the postbuild secret-scan; it should pass
# because nothing is registered as "forbidden" in the current script (T-034
# inverted it). If a future feat registers a forbidden value, the docker
# build will fail loudly in this stage.
RUN npm run build

# -----------------------------------------------------------------------------
# Runtime stage: nginx:alpine + the built SPA + substituted nginx.conf.
# -----------------------------------------------------------------------------
FROM nginx:alpine AS runtime

# Docker scopes ARGs per stage; re-declare to use ORCHESTRATOR_BASE_URL in
# the CSP substitution below.
ARG ORCHESTRATOR_BASE_URL

# Substitute the orchestrator base URL into the CSP placeholder at IMAGE
# BUILD time. Not at container startup — keeps the runtime stage immutable
# and avoids an entrypoint script.
COPY nginx.conf /etc/nginx/nginx.conf
RUN sed -i "s|__ORCHESTRATOR_BASE_URL__|${ORCHESTRATOR_BASE_URL}|g" /etc/nginx/nginx.conf

# Drop the bundle in place.
COPY --from=builder /app/dist/spa/browser/ /usr/share/nginx/html/

EXPOSE 80

# Liveness probe — confirms nginx is serving the index. Readiness (can the
# SPA actually reach the orchestrator with CORS) is scripts/smoke-prod.sh,
# operator-run after `docker compose up`. See T-039.
# Use 127.0.0.1 explicitly — busybox wget on alpine doesn't always resolve
# `localhost` via /etc/hosts depending on the musl NSS config.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ | grep -q '<app-root' || exit 1
