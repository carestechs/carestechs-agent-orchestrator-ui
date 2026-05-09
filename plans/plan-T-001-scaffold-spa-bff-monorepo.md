# Implementation Plan: T-001 — Scaffold Angular SPA + BFF monorepo skeleton

## Task Reference
- **Task ID:** T-001
- **Type:** DevOps
- **Workflow:** standard
- **Complexity:** M
- **Rationale:** Every other task assumes the dual-process layout exists. Without scripts and proxy wiring, frontend tasks cannot exercise the BFF locally.

## Overview
Initialize a single-repo, two-process workspace: an Angular 17+ standalone-component SPA in `src/` and a Node BFF in `bff/`. Wire the npm scripts described in `CLAUDE.md > Quick Reference` (`dev`, `start`, `bff:dev`, `build`, `test`, `e2e`, `lint`, `format`), the dev proxy that forwards `/api` and `/auth` from `ng serve` (4200) to the BFF (4000), and TypeScript strict configuration on both sides. No NgModules and no Tailwind yet (Tailwind comes in T-002).

## Implementation Steps

### Step 1: Initialize root `package.json` with workspace scripts and dev dependencies
**File:** `package.json`
**Action:** Create
Define a single root `package.json` (not npm workspaces — the BFF is colocated, not a separate package) with:
- `"type": "module"` for ESM (per `CLAUDE.md > BFF (Node)`).
- Scripts: `dev` (uses `concurrently` to run `start` and `bff:dev`), `start` (`ng serve --proxy-config proxy.conf.json`), `bff:dev` (`nodemon --watch bff/src --ext ts --exec "node --import tsx bff/src/server.ts"`), `build` (`ng build && tsc -p bff/tsconfig.json`), `test` (`vitest run`), `e2e` (`playwright test`), `lint` (`eslint .`), `format` (`prettier --write .`), `postinstall` if Angular requires it.
- Dev deps: `concurrently`, `nodemon`, `tsx`, `vitest`, `@playwright/test`, `eslint`, `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin`, `@angular-eslint/eslint-plugin`, `@angular-eslint/eslint-plugin-template`, `prettier`, `typescript`, `@types/node`.
- Runtime deps for BFF: choose Fastify (or Express — pick one and stay consistent per `CLAUDE.md > BFF (Node)`); this plan assumes Fastify (`fastify`, `@fastify/cookie`, `@fastify/http-proxy` not used — we write our own proxy in T-005).
- Runtime deps for SPA: `@angular/core`, `@angular/common`, `@angular/router`, `@angular/platform-browser`, `rxjs`, `zone.js`.

### Step 2: Run Angular CLI to scaffold the SPA in standalone mode
**File:** `angular.json`, `src/main.ts`, `src/index.html`, `src/app/app.component.ts`, `src/app/app.config.ts`, `src/app/app.routes.ts`
**Action:** Create (via `ng new` and curation)
Run `ng new carestechs-agent-orchestrator-ui --standalone --routing --style=css --skip-tests=false --directory .` (or equivalent). Then:
- Delete any generated `app.module.ts` if present (per `CLAUDE.md > Anti-Patterns to Avoid > No NgModules`).
- Confirm `src/app/app.component.ts` is `standalone: true`, uses `templateUrl: './app.component.html'`, sets `styles: []` (per `CLAUDE.md > Code Style & Conventions > TypeScript & Angular`). No `.css`/`.scss` component file is generated.
- `src/app/app.routes.ts` exports `appRoutes: Routes = []` for now — feature routes are added by their respective tasks via `loadComponent`.
- `src/app/app.config.ts` provides router, `provideHttpClient(withFetch())`, and `withInterceptorsFromDi` placeholder.

### Step 3: Configure standalone-component schematics defaults in `angular.json`
**File:** `angular.json`
**Action:** Modify
Under `projects.<name>.schematics`, add:
```json
"@schematics/angular:component": { "standalone": true, "inlineTemplate": false, "inlineStyle": false, "style": "css", "skipTests": false },
"@schematics/angular:directive": { "standalone": true },
"@schematics/angular:pipe": { "standalone": true }
```
This guarantees future `ng generate` invocations cannot produce an `NgModule` or an inline template/style (per `CLAUDE.md > Code Style & Conventions > TypeScript & Angular > Separate template files` and `Standalone components only`).

### Step 4: Enable TypeScript strict mode for the SPA
**File:** `tsconfig.json`, `tsconfig.app.json`
**Action:** Modify
In `tsconfig.json` `compilerOptions`: `"strict": true`, `"noImplicitAny": true`, `"noUncheckedIndexedAccess": true`, `"exactOptionalPropertyTypes": true`, `"target": "ES2022"`, `"module": "ES2022"`, `"moduleResolution": "bundler"`. Angular flags: `"strictTemplates": true`, `"strictInjectionParameters": true`. Per `CLAUDE.md > Code Style & Conventions > TypeScript & Angular > Use TypeScript strict mode`.

### Step 5: Create the BFF TypeScript configuration
**File:** `bff/tsconfig.json`
**Action:** Create
Strict ESM-targeting config:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "noImplicitAny": true,
    "esModuleInterop": true,
    "outDir": "../dist/bff",
    "rootDir": "src",
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
```
Per `CLAUDE.md > BFF (Node)`: ESM, TypeScript strict.

### Step 6: Create the BFF bootstrapping shell
**File:** `bff/src/server.ts`
**Action:** Create
Minimal Fastify (or Express) bootstrap that:
- Reads env vars: `PORT` (default 4000), `NODE_ENV`. (Other env vars — `SESSION_SECRET`, `ORCHESTRATOR_BASE_URL`, `ORCHESTRATOR_API_KEY`, `ORCHESTRATOR_OPERATOR_PASSPHRASE` — are introduced and validated by T-004 / T-005; T-001 only sets up the boot shell.)
- Registers a placeholder `GET /healthz` returning `{ ok: true }`.
- Listens on `PORT`.
- Logs the bind address but never logs env values (per `CLAUDE.md > BFF (Node) > Never log the orchestrator API key` — establish the discipline now).

### Step 7: Create the dev proxy configuration
**File:** `proxy.conf.json`
**Action:** Create
```json
{
  "/api": { "target": "http://localhost:4000", "secure": false, "changeOrigin": true, "logLevel": "warn" },
  "/auth": { "target": "http://localhost:4000", "secure": false, "changeOrigin": true, "logLevel": "warn" }
}
```
This satisfies AC-1 (the SPA proxies `/api/*` and `/auth/*` to the BFF). Streaming for `/api/v1/runs/:id/trace` works because `webpack-dev-server`'s proxy passes responses through; T-006 will verify against the dev proxy.

### Step 8: Create global `src/styles.css` placeholder
**File:** `src/styles.css`
**Action:** Create
Empty file with a comment noting Tailwind directives will be added in T-002. No `@apply` rules yet. Per `CLAUDE.md > Code Style & Conventions > TypeScript & Angular > Tailwind only`, this file is the only allowed location for global styles.

### Step 9: Configure ESLint to ban `any` and enforce Angular conventions
**File:** `eslint.config.js`
**Action:** Create
Flat config (ESLint 9+) with:
- `@typescript-eslint/no-explicit-any: 'error'` (per `CLAUDE.md > Code Style & Conventions > TypeScript & Angular > No 'any'`).
- `@angular-eslint/no-standalone-decorator-not-allowed` not relevant; instead use `@angular-eslint/prefer-standalone: 'error'`.
- `import/no-default-export: 'error'` with an exception for files matching `**/features/**/*.component.ts` if `loadComponent` requires a default re-export; otherwise default exports are banned (per `CLAUDE.md > Code Style & Conventions > TypeScript & Angular > Named exports only`).
- The `styleUrls` ban is added in T-002 — this task only sets up the file.

### Step 10: Configure Prettier
**File:** `.prettierrc`
**Action:** Create
Standard config: `{ "singleQuote": true, "semi": true, "trailingComma": "all", "printWidth": 100 }`.

### Step 11: Configure Vitest for both SPA and BFF
**File:** `vitest.config.ts`
**Action:** Create
Single Vitest config covering both `src/**/*.spec.ts` and `bff/src/**/*.spec.ts`. Use `environment: 'jsdom'` for SPA tests (via per-file directive or a project split), `environment: 'node'` for BFF tests. Per `CLAUDE.md > Testing Conventions`, tests are co-located and named `*.spec.ts`.

### Step 12: Configure Playwright for E2E
**File:** `playwright.config.ts`
**Action:** Create
Standard Playwright config pointing at `e2e/` and `webServer.command: 'npm run dev'`, `webServer.url: 'http://localhost:4200'`. The `e2e/` directory is created by T-020.

### Step 13: Add `.gitignore` and `.editorconfig`
**File:** `.gitignore`, `.editorconfig`
**Action:** Create
Standard ignores: `node_modules/`, `dist/`, `.angular/`, `coverage/`, `playwright-report/`, `test-results/`, `*.local`, `.env`, `.env.*` (never commit env files — they will hold `ORCHESTRATOR_API_KEY`).

## Files Affected
| File | Action | Summary |
|------|--------|---------|
| `package.json` | Create | Workspace scripts and dev deps for SPA + BFF. |
| `angular.json` | Modify | Standalone schematics defaults; ban inline templates/styles. |
| `tsconfig.json` | Modify | Strict mode for the SPA. |
| `tsconfig.app.json` | Modify | Strict-mode build config. |
| `bff/tsconfig.json` | Create | Strict ESM config for the BFF. |
| `bff/src/server.ts` | Create | Minimal Fastify/Express bootstrap with `/healthz`. |
| `proxy.conf.json` | Create | Dev proxy `/api` + `/auth` → `localhost:4000`. |
| `src/main.ts` | Create | Bootstraps `AppComponent` with `appConfig`. |
| `src/index.html` | Create | SPA root document. |
| `src/styles.css` | Create | Empty placeholder for T-002 to add Tailwind directives. |
| `src/app/app.component.ts` | Create | Standalone root component, `templateUrl`, `styles: []`. |
| `src/app/app.component.html` | Create | Empty router-outlet shell. |
| `src/app/app.config.ts` | Create | `provideRouter`, `provideHttpClient(withFetch())`. |
| `src/app/app.routes.ts` | Create | Empty `Routes` array. |
| `eslint.config.js` | Create | Bans `any`, default exports, enforces standalone. |
| `.prettierrc` | Create | Format config. |
| `vitest.config.ts` | Create | Vitest config covering SPA and BFF specs. |
| `playwright.config.ts` | Create | Playwright config for E2E. |
| `.gitignore` | Create | Ignore build, env, and tooling output. |
| `.editorconfig` | Create | Consistent indent/eol. |

## Edge Cases & Risks
- **Angular CLI generates an `app.module.ts` despite `--standalone`:** delete it explicitly; verify `app.config.ts` is the bootstrap surface. AC-5 fails if any `NgModule` survives.
- **`ng serve` proxy does not pass through chunked transfer encoding cleanly:** webpack-dev-server's proxy generally honors it, but verify with a quick streaming smoke once T-006 lands. If it buffers, document a `--disable-host-check` style workaround or run the BFF in front of `ng build --watch` for dev.
- **ESM vs CommonJS interop on the BFF:** keeping `"type": "module"` at the root means BFF source must use explicit `.js` extensions in import specifiers (or use `tsx` which handles this). Document in `bff/tsconfig.json`.
- **Pinning ESLint flat config to a specific version:** flat config is still a moving target; pin `eslint` and `@typescript-eslint/*` to known-compatible majors.
- **Concurrently kills children correctly:** use `concurrently --kill-others-on-fail` so a BFF crash doesn't leave a zombie `ng serve`.

## Acceptance Verification
- [ ] **AC-1** (`npm run dev` boots both processes; SPA proxies `/api/*` and `/auth/*` to BFF): Run `npm run dev`, hit `http://localhost:4200/api/healthz` and `http://localhost:4200/auth/healthz` — both return the BFF's `{ ok: true }` (or 404 for `/auth/healthz` since only `/healthz` is registered, but the proxy must connect).
- [ ] **AC-2** (`npm run build` produces SPA bundle and BFF tsc output): Run `npm run build`; assert `dist/<spa>/main-*.js` exists and `dist/bff/server.js` exists.
- [ ] **AC-3** (`npm test` runs Vitest both packages; `npm run e2e` runs Playwright; `npm run lint` runs ESLint over both): Run each script and confirm exit code 0 (no specs yet means a clean pass for vitest/playwright; lint passes on the scaffolded files).
- [ ] **AC-4** (TypeScript strict mode in both `tsconfig.json` files; `any` banned by ESLint): `grep -n '"strict": true' tsconfig.json bff/tsconfig.json` returns matches; introduce a temporary `let x: any;` in any `.ts` file and confirm `npm run lint` errors with `@typescript-eslint/no-explicit-any`.
- [ ] **AC-5** (No `NgModule` generated): `grep -rn "NgModule" src/` returns nothing; only `app.config.ts` exists for application providers.
