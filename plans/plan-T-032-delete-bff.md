# Implementation Plan: T-032 — Delete `bff/` and the BFF-only build/dev plumbing

## Task Reference
- **Task ID:** T-032
- **Type:** DevOps
- **Workflow:** standard
- **Complexity:** S
- **Dependencies:** T-030, T-031 (nothing must reference `/api/v1/*` or `/auth/*` before deletion)
- **Rationale:** This is the deletion the migration exists for.

## Overview
Remove the entire BFF surface from the repo: the `bff/` directory, `proxy.conf.json`, BFF-only npm scripts, BFF-only dependencies, and any references in lhci/dev tooling that assume the BFF is running. After this task, `npm run dev` starts the SPA only.

## Implementation Steps

### Step 1: Delete the BFF source tree
**File:** `bff/`
**Action:** Delete

Remove the entire directory: `rm -rf bff/`. This includes `bff/src/`, `bff/tsconfig.json`, and any other BFF-only files.

### Step 2: Delete the dev proxy config
**File:** `proxy.conf.json`
**Action:** Delete

`rm proxy.conf.json`. T-030 made `/api/v1/*` no-ops in the SPA, so the proxy has nothing to proxy.

### Step 3: Update `package.json` scripts
**File:** `package.json`
**Action:** Modify

- `dev`: drop the `concurrently` wrapper; it's just `ng serve` now. Or keep `concurrently` if the e2e mock is started alongside in dev (probably not — operators dev against a real orchestrator). Recommend: `"dev": "ng serve"`.
- `start`: drop `--proxy-config proxy.conf.json`. Becomes `"start": "ng serve"`.
- `build`: drop `&& tsc -p bff/tsconfig.json`. Becomes `"build": "ng build"`.
- `bff:dev`: delete entirely.
- `test`: stays — Vitest projects covers SPA only after the BFF tests are gone (Step 5).

### Step 4: Remove BFF-only dependencies
**File:** `package.json`
**Action:** Modify

Drop from `dependencies` / `devDependencies`:
- `fastify`
- `@fastify/cookie`
- `nodemon` (only used by `bff:dev`)
- `concurrently` — only if Step 3 dropped it from `dev`

Keep:
- `tsx` — still used by `scripts/start-upstream-mock.mjs`.
- `http-server` — still used by lhci. Actually verify; if unused, drop too.

After editing, run `npm install` to regenerate `package-lock.json`.

### Step 5: Update Vitest configuration
**File:** `vitest.config.ts` (or `vite.config.ts`)
**Action:** Modify

The current config uses `test.projects` with one project for SPA (jsdom) and one for BFF (node). Drop the BFF project. The remaining "spa" project becomes the only one.

If the file ends up trivial (single project), simplify to a flat `test:` config without `projects`.

### Step 6: Strip BFF references from the SPA static server
**File:** `scripts/serve-spa-with-proxy.mjs`
**Action:** Modify (or rename)

This script proxies `/api` and `/auth` to the BFF. With no BFF, the proxy logic is dead. Two options:

- **Rename and simplify** to `scripts/serve-spa.mjs`. Drop the proxy section entirely; keep the SPA-fallback static server. Update `lhci:serve` script in `package.json` accordingly.
- **Keep the filename and gut the proxy.** Less churn but more confusing.

Recommend rename. Update `package.json`'s `lhci:serve` to point at the new filename.

### Step 7: Strip BFF references from CI workflows
**File:** `.github/workflows/lighthouse.yml`, `.github/workflows/ci.yml`
**Action:** Modify

T-034 owns the full lhci workflow update. In this task, only remove explicit BFF references that prevent a green build:
- Drop `nohup node --import tsx bff/src/server.ts ...` from any boot block.
- Drop the `wait-on http-get://localhost:4000/auth/me` line.
- Drop BFF-only env vars (`SESSION_SECRET`, `ORCHESTRATOR_OPERATOR_PASSPHRASE` — the SPA-side passphrase lives in the env file now and is baked at build time).

If T-034 is being landed in the same window, defer the workflow surgery to T-034 entirely. Coordinate with the reviewer.

### Step 8: Sanity grep for stragglers
**Action:** Verify

Run:
```bash
git grep -nF 'bff/' -- :^plans/ :^docs/work-items/ :^docs/
git grep -nF 'proxy.conf.json' -- :^plans/ :^docs/
git grep -nF 'bff:dev' -- :^plans/
git grep -nE '/api/v1/' src/
git grep -nE '/auth/(login|logout|me)' src/
```

Each should return zero matches outside historical changelogs and plan files. Any positive hit is a missed migration step.

### Step 9: Smoke
**Action:** Verify

- `npm install` (lockfile regen).
- `npm run build` — clean.
- `npm test` — all SPA tests pass; no BFF test files exist.
- `npm run dev` — single process; SPA serves on 4200; manual login works against the configured orchestrator URL.

## Files Affected
| File | Action | Summary |
|------|--------|---------|
| `bff/` | Delete | Entire directory. |
| `proxy.conf.json` | Delete | Dev proxy unused. |
| `package.json` | Modify | Drop `bff:dev`, simplify `start`/`build`/`dev`; remove BFF deps. |
| `package-lock.json` | Regen | After `npm install`. |
| `vitest.config.ts` | Modify | Drop BFF project. |
| `scripts/serve-spa-with-proxy.mjs` | Rename / Modify | → `scripts/serve-spa.mjs`; gut the proxy. |
| `.github/workflows/lighthouse.yml` | Modify | Drop BFF boot block (or coordinate with T-034). |
| `.github/workflows/ci.yml` | Modify | Same. |

## Edge Cases & Risks
- **Test runner picks up stale BFF specs.** Make sure Vitest's `include` glob no longer matches `bff/**`. Confirm with `npm test -- --run --reporter=basic` and check the test count is right.
- **Concurrently still in `dev`?** If something else needs to run alongside (e.g., a local Tailwind watcher — there isn't one today), keep it. Otherwise drop.
- **Workflow file race with T-034.** The workflow file will be touched twice if T-032 and T-034 land separately. To avoid merge conflicts, recommend either: land them together; or have T-032 do only the minimal "BFF boot block removal" and let T-034 own everything else.
- **Stale Playwright config.** `playwright.config.ts` still has a `webServer` entry for the BFF; T-033 owns updating it. T-032 can leave it alone — the e2e suite will fail until T-033 lands. Document this in the PR description so the failing CI doesn't surprise anyone.
- **Documentation references.** All `bff/`, `BFF`, `/api/v1/`, `/auth/*` mentions in docs are intentionally left in this PR; T-035 owns the doc surgery.

## Acceptance Verification
- [ ] `bff/` and `proxy.conf.json` no longer exist.
- [ ] `npm run dev` starts only `ng serve`.
- [ ] `npm run build` produces a SPA bundle.
- [ ] `npm test` passes; the test count drops by the number of BFF specs (not zero, not the same).
- [ ] `package.json` does not list `fastify`, `@fastify/cookie`, or `nodemon`.
- [ ] All sanity greps from Step 8 return zero matches outside docs/plans.
