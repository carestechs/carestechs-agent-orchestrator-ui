# Implementation Plan: T-029 — Angular environment files for orchestrator base URL, API key, and operator passphrase

## Task Reference
- **Task ID:** T-029
- **Type:** Frontend + DevOps
- **Workflow:** standard
- **Complexity:** S
- **Dependencies:** None
- **Rationale:** Every other task in FEAT-003 consumes this config. Splitting it out first keeps the rest reviewable.

## Overview
Add typed Angular environment files (`environment.ts` for dev, `environment.prod.ts` for prod) exporting `{ orchestratorBaseUrl, orchestratorApiKey, operatorPassphrase, production }`. Wire them via `angular.json` `fileReplacements`. Real env files are gitignored; only `environment.example.ts` ships. Document local-dev recipe in `CLAUDE.md`.

## Implementation Steps

### Step 1: Define the typed environment shape
**File:** `src/environments/environment.example.ts`
**Action:** Create

```ts
// Copy this to environment.ts (dev) and environment.prod.ts (prod) and fill
// in real values. Both real files are gitignored.
//
// SECURITY NOTE: orchestratorApiKey ships in the browser bundle by design —
// the orchestrator deployment is gated by network position, not by secret
// confidentiality. See docs/ARCHITECTURE.md § "Interim security posture".
export interface EnvironmentConfig {
  readonly production: boolean;
  readonly orchestratorBaseUrl: string;
  readonly orchestratorApiKey: string;
  readonly operatorPassphrase: string;
}

export const environment: EnvironmentConfig = {
  production: false,
  orchestratorBaseUrl: 'http://127.0.0.1:4100',
  orchestratorApiKey: 'replace-me',
  operatorPassphrase: 'replace-me',
};
```

- Type all fields as `readonly` and required. Missing values must fail TypeScript strict mode; do not use `string | undefined`.
- The export name `environment` is the convention every consumer imports.

### Step 2: Gitignore the real env files
**File:** `.gitignore`
**Action:** Modify

Add:
```
src/environments/environment.ts
src/environments/environment.prod.ts
```

### Step 3: Wire `fileReplacements` in `angular.json`
**File:** `angular.json`
**Action:** Modify

Under `projects.<spa>.architect.build.configurations.production`, add:
```json
"fileReplacements": [
  {
    "replace": "src/environments/environment.ts",
    "with": "src/environments/environment.prod.ts"
  }
]
```

- Confirm `tsconfig.app.json`'s `files` / `include` doesn't pin one of these paths in a way that conflicts.

### Step 4: Local dev recipe
**File:** `CLAUDE.md`
**Action:** Modify

Under "Quick Reference > Common Commands", insert a "Local environment setup" subsection above `npm install`:

```markdown
### Local environment setup

Before `npm run dev` for the first time:

1. `cp src/environments/environment.example.ts src/environments/environment.ts`
2. Edit `environment.ts` and set:
   - `orchestratorBaseUrl` — local orchestrator URL (or `http://127.0.0.1:4100` for the in-process e2e mock).
   - `orchestratorApiKey` — your dev API key.
   - `operatorPassphrase` — any string; this gates the SPA login screen.
3. For production builds, also create `src/environments/environment.prod.ts` with the same shape.

**Security note:** `orchestratorApiKey` is bundled into the browser by design; the orchestrator deployment is gated by network position, not key confidentiality. See `docs/ARCHITECTURE.md` § "Interim security posture".
```

### Step 5: Smoke build with the example values renamed
**Action:** Verify

- Locally: `cp src/environments/environment.example.ts src/environments/environment.ts && cp src/environments/environment.example.ts src/environments/environment.prod.ts && npm run build`.
- Confirm build succeeds. (T-030 will be the first consumer; this task only proves the wiring.)

## Files Affected
| File | Action | Summary |
|------|--------|---------|
| `src/environments/environment.example.ts` | Create | Typed template; documents the shape and the security note. |
| `.gitignore` | Modify | Ignore real env files. |
| `angular.json` | Modify | `fileReplacements` for production. |
| `CLAUDE.md` | Modify | Local-environment-setup subsection. |

## Edge Cases & Risks
- **Existing developers' working trees.** Anyone with a cloned repo will hit a missing-import error on the first build after this task. The README/CLAUDE.md note above is the recovery path.
- **`environment.ts` shipped to the repo by accident.** The `.gitignore` entries handle the common case but a `git add -f` would still slip through. Worth a one-line note in CLAUDE.md ("never `git add -f` the env files").
- **Tests.** Unit tests import from `'../../environments/environment'` indirectly via `ApiClient` once T-030 lands. Vitest test environment already runs through `tsconfig.app.json`'s alias map; no extra config needed today.
- **Naming bikeshed.** `operatorPassphrase` is a passphrase the SPA compares against, not a secret — naming it `operatorPassphrase` (vs. `operatorGate`) is fine but worth reviewing.

## Acceptance Verification
- [ ] `environment.example.ts` is committed; `environment.ts` and `environment.prod.ts` are not.
- [ ] `npm run build` (with locally copied env files) produces a clean SPA bundle.
- [ ] `import { environment } from 'src/environments/environment'` is type-checked under strict mode.
- [ ] `CLAUDE.md` documents how to bootstrap the env files for a new clone.
- [ ] `angular.json` `production` configuration uses `fileReplacements`.
