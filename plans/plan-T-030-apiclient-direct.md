# Implementation Plan: T-030 — Rewire `ApiClient` and `TraceStreamService` to call the orchestrator directly

## Task Reference
- **Task ID:** T-030
- **Type:** Frontend
- **Workflow:** standard
- **Complexity:** M
- **Dependencies:** T-029 (env files)
- **Rationale:** Closes the load-bearing change in the migration. Once this lands the SPA talks to the orchestrator with no proxy in the middle.

## Overview
`ApiClient` and `TraceStreamService` currently issue requests against `/api/v1/*` with `withCredentials: true`. After this task they target `${environment.orchestratorBaseUrl}/v1/*`, attach `Authorization: Bearer ${environment.orchestratorApiKey}` on every request, and drop credentials. The 401 → auth-expiry channel stays — orchestrator can still 401 on a rotated key.

## Pre-step: confirm the orchestrator's CORS posture
Before writing code, run a 5-minute check against the deployed orchestrator URL:

```bash
curl -i -X OPTIONS \
  -H 'Origin: http://localhost:4200' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: authorization,content-type' \
  ${ORCHESTRATOR_BASE_URL}/v1/runs

curl -i --no-buffer \
  -H "Authorization: Bearer ${ORCHESTRATOR_API_KEY}" \
  ${ORCHESTRATOR_BASE_URL}/v1/runs/<known-run>/trace
```

The first should return `Access-Control-Allow-Origin: http://localhost:4200` (or `*`) and `Access-Control-Allow-Headers` including `authorization` and `content-type`. The second should not buffer (chunks arrive as the orchestrator emits them). If either fails, file with the orchestrator team and stop here — no code change can compensate.

## Implementation Steps

### Step 1: `ApiClient` — base URL + auth header + no credentials
**File:** `src/app/core/api-client.ts`
**Action:** Modify

- Import `environment` from `src/environments/environment`.
- Add a private `buildUrl(path: string): string` that prepends `environment.orchestratorBaseUrl` when `path` starts with `/v1/`. Keep callers compatible with their current call sites (still pass `/v1/runs` etc. — see Step 3 for the path-prefix migration).
- Replace `opts(params)` with a version that attaches `Authorization: Bearer ${environment.orchestratorApiKey}` via `HttpHeaders` and **does not** set `withCredentials`.
- Update `get`/`post`/`delete` to call `this.http.get(buildUrl(path), this.opts(params))` etc.
- Drop `isAuthProbe`. There are no `/auth/*` paths after T-031.
- Keep the 401 → `notifyAuthExpired()` behavior as-is (the orchestrator can still 401 on a rotated key).

```ts
private opts(params?: Params) {
  const headers = new HttpHeaders({
    'Authorization': `Bearer ${environment.orchestratorApiKey}`,
  });
  if (!params) return { headers };
  let httpParams = new HttpParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    httpParams = httpParams.set(key, String(value));
  }
  return { headers, params: httpParams };
}
```

### Step 2: Migrate path prefixes from `/api/v1/` to `/v1/`
**Files:** `src/app/core/runs.service.ts`, `src/app/core/agents.service.ts`, `src/app/core/signals.service.ts`
**Action:** Modify

Replace all `'/api/v1/'` literal paths with `'/v1/'`. The base URL is now absorbed by `ApiClient.buildUrl`. Same change in their `.spec.ts` files where the test asserts the path.

Greppable migration:
- `'/api/v1/runs'` → `'/v1/runs'`
- `\`/api/v1/runs/${id}\`` → `\`/v1/runs/${id}\``
- `'/api/v1/agents'` → `'/v1/agents'`
- `\`/api/v1/runs/${id}/cancel\`` → `\`/v1/runs/${id}/cancel\``
- `\`/api/v1/runs/${id}/signals\`` → `\`/v1/runs/${id}/signals\``

### Step 3: `TraceStreamService` — direct URL + Authorization header
**File:** `src/app/core/trace-stream.service.ts`
**Action:** Modify

- Import `environment`.
- `buildUrl()` now returns:
  ```ts
  return `${environment.orchestratorBaseUrl}/v1/runs/${encodeURIComponent(this.currentRunId ?? '')}/trace?${params.toString()}`;
  ```
- The `fetch` call: replace `credentials: 'include'` with `headers: { 'Authorization': \`Bearer ${environment.orchestratorApiKey}\` }`. Remove `credentials` entirely; the default `same-origin` is correct for cross-origin (no cookies sent, which is what we want).
- 401 handling unchanged (`notifyAuthExpired()`).

### Step 4: `ApiClient` unit tests — assert the new contract
**File:** `src/app/core/api-client.spec.ts`
**Action:** Modify

For each existing test that uses `HttpTestingController.expectOne(...)`:
- Update the URL matcher: it now starts with the env-configured base URL.
- Add an `expect(req.request.headers.get('Authorization')).toBe(\`Bearer ${environment.orchestratorApiKey}\`)` assertion at least once per HTTP verb (GET / POST / DELETE).
- Add an explicit `expect(req.request.withCredentials).toBe(false)` assertion at least once.

Add a new test:
```ts
it('attaches Authorization: Bearer <api-key> on every request', () => { ... });
it('never sends withCredentials', () => { ... });
```

### Step 5: `TraceStreamService` unit tests — header assertions
**File:** `src/app/core/trace-stream.service.spec.ts`
**Action:** Modify

The test stubs `globalThis.fetch`. Update the stub to capture the `init.headers` and assert:
- `Authorization` header equals `Bearer <env api-key>`.
- No `credentials: 'include'` passed.

The URL assertions need updating to match the new env-based base URL.

### Step 6: Run unit tests + production build smoke
**Action:** Verify

- `npm test -- --run`
- `npm run build`
- Confirm both succeed.

## Files Affected
| File | Action | Summary |
|------|--------|---------|
| `src/app/core/api-client.ts` | Modify | Env-based URL, Authorization header, no credentials. Drop `isAuthProbe`. |
| `src/app/core/api-client.spec.ts` | Modify | Update URL/header assertions; new tests for Auth header presence + no credentials. |
| `src/app/core/trace-stream.service.ts` | Modify | Direct orchestrator URL + Authorization header. Drop `credentials: 'include'`. |
| `src/app/core/trace-stream.service.spec.ts` | Modify | Header + URL assertions. |
| `src/app/core/runs.service.ts` | Modify | Path migration `/api/v1/*` → `/v1/*`. |
| `src/app/core/runs.service.spec.ts` | Modify | Update path assertions. |
| `src/app/core/agents.service.ts` | Modify | Path migration. |
| `src/app/core/agents.service.spec.ts` | Modify | Update path assertions. |
| `src/app/core/signals.service.ts` | Modify | Path migration. |
| `src/app/core/signals.service.spec.ts` | Modify | Update path assertions. |

## Edge Cases & Risks
- **CORS preflight failure mid-task.** Caught by the pre-step curl checks. If they fail, halt the task and resolve upstream first.
- **`HttpClient` setting headers from the framework.** Angular may inject `Accept: application/json, text/plain, */*` automatically; this is fine and shouldn't conflict with our explicit `Authorization`.
- **Long-lived NDJSON stream + auth-expiry mid-stream.** When the orchestrator returns 401 on a re-validated token, the stream errors. The existing `if (res.status === 401) { notifyAuthExpired(); return; }` branch covers the initial response. Mid-stream rotation isn't covered today either — flag for FEAT-004 (real auth) rather than blocking this task.
- **Test fixtures that mocked `withCredentials: true`.** Update them; otherwise the assertion in Step 4 will pass too easily because nothing was checked.

## Acceptance Verification
- [ ] All HTTP calls go to `${environment.orchestratorBaseUrl}/v1/*`. `grep -rn '/api/v1/' src/` returns zero matches.
- [ ] Every request carries `Authorization: Bearer <api-key>` (verified by `api-client.spec.ts` and `trace-stream.service.spec.ts`).
- [ ] No request carries `withCredentials: true` or `credentials: 'include'`.
- [ ] A 401 from the orchestrator still triggers `notifyAuthExpired()` and the existing redirect.
- [ ] All unit tests pass.
- [ ] Production build produces a SPA bundle that contains the API key value (T-034 will invert the bundle-leak gate; until then, run `npm run build` with `ORCHESTRATOR_API_KEY` unset locally to skip the value-scan, or accept that the postbuild check fails on this PR — call this out in the PR description).
