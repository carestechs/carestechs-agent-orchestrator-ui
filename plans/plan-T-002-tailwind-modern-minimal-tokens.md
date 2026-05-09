# Implementation Plan: T-002 — Configure Tailwind CSS and modern-minimal design tokens

## Task Reference
- **Task ID:** T-002
- **Type:** Frontend
- **Workflow:** standard
- **Complexity:** S
- **Rationale:** Per `CLAUDE.md`, Tailwind is the only styling layer; mockups generated downstream assume the modern-minimal tokens are available as utility classes.

## Overview
Install Tailwind, configure `tailwind.config.js` with the modern-minimal token map (sky/violet/slate palette, Poppins/Inter fonts, `rounded-lg` defaults), wire Tailwind directives into `src/styles.css`, and add an ESLint guard that fails any component declaring `styleUrls` or non-empty `styles`. This task locks in the "Tailwind only — no component CSS" rule from `CLAUDE.md > Code Style & Conventions > TypeScript & Angular`.

## Implementation Steps

### Step 1: Install Tailwind, PostCSS, and Autoprefixer
**File:** `package.json`
**Action:** Modify
Add dev dependencies: `tailwindcss`, `postcss`, `autoprefixer`. Run `npx tailwindcss init -p` (which writes `tailwind.config.js` + `postcss.config.js`); we then overwrite the config in Step 2.

### Step 2: Configure Tailwind with modern-minimal tokens
**File:** `tailwind.config.js`
**Action:** Create
```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,ts}', './mockups/**/*.html'],
  theme: {
    extend: {
      colors: {
        // Per CLAUDE.md > Design System (Modern Minimal)
        primary: { DEFAULT: '#0EA5E9' /* sky-500 */ },
        accent:  { DEFAULT: '#8B5CF6' /* violet-500 */ },
        success: '#10B981', // emerald-500
        warning: '#F59E0B', // amber-500
        danger:  '#EF4444', // red-500
        info:    '#0EA5E9', // sky-500
      },
      fontFamily: {
        // Per CLAUDE.md > Design System > Fonts
        heading: ['Poppins', 'sans-serif'],
        sans:    ['Inter', 'sans-serif'],
      },
      borderRadius: {
        // Per CLAUDE.md > Design System > Buttons (rounded-lg, not rounded-md)
        DEFAULT: '0.5rem',
      },
      maxWidth: {
        reading: '64rem',   // max-w-5xl reading width
        dashboard: '80rem', // max-w-7xl dashboard width
      },
    },
  },
  plugins: [],
};
```
Per `CLAUDE.md > Design System (Modern Minimal)` and the technical note "Reference design tokens come from `carestechs-ui-design/profiles/modern-minimal.md` — do not redefine them ad-hoc". Use Tailwind's built-in `sky-*`, `violet-500`, `slate-*`, `emerald-500`, `amber-500`, `red-500` palette directly in templates; the `extend.colors` aliases above are convenience tokens, not redefinitions.

### Step 3: Configure PostCSS
**File:** `postcss.config.js`
**Action:** Create
```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

### Step 4: Wire Tailwind directives into the global stylesheet
**File:** `src/styles.css`
**Action:** Modify
Replace the T-001 placeholder with:
```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Poppins:wght@500;600;700&display=swap');

@tailwind base;
@tailwind components;
@tailwind utilities;

/* Reusable base patterns only — per CLAUDE.md > Code Style & Conventions > TypeScript & Angular > Tailwind only */
@layer base {
  body { @apply font-sans text-slate-700 bg-slate-50 leading-relaxed; }
  h1, h2, h3, h4 { @apply font-heading text-slate-900; }
}
```
Per `CLAUDE.md > Design System > Neutrals` and `Fonts`. `@apply` is allowed only in this file (`CLAUDE.md > Code Style & Conventions > TypeScript & Angular`).

### Step 5: Confirm root component ships with `styles: []`
**File:** `src/app/app.component.ts`
**Action:** Modify
Ensure the `@Component` decorator contains `styles: []` and `templateUrl: './app.component.html'`. No `styleUrls`, no inline `template`, no `.css` file beside it. Per `CLAUDE.md > Code Style & Conventions > TypeScript & Angular > Tailwind only — no component CSS` and `Separate template files`.

### Step 6: Add an ESLint rule banning `styleUrls` and non-empty `styles` on `@Component`
**File:** `eslint.config.js`
**Action:** Modify
Add `@angular-eslint/use-component-selector` and a custom AST rule (or a `no-restricted-syntax` selector) that flags:
- `Property[key.name='styleUrls']` on a `@Component` decorator object — error.
- `Property[key.name='styles'][value.elements.length>0]` — error.
Example:
```js
{
  selector: "CallExpression[callee.name='Component'] ObjectExpression > Property[key.name='styleUrls']",
  message: "Component CSS is forbidden — use Tailwind classes in the .html (CLAUDE.md > Tailwind only — no component CSS)."
}
```
This satisfies AC-4 ("ESLint or test guard fails the build if a component declares `styleUrls` or non-empty `styles`").

### Step 7: Sweep the repo for any `.css` or `.scss` files beside components
**File:** (no specific file — repo-wide check)
**Action:** Delete
Run `find src -name '*.component.css' -o -name '*.component.scss'`; delete any matches. Per `CLAUDE.md > Anti-Patterns to Avoid > No inline templates / no component CSS files`.

### Step 8: Smoke-test that Tailwind classes resolve
**File:** `src/app/app.component.html`
**Action:** Modify
Add a minimal smoke template using sky-500 + Poppins to confirm the build picks up tokens:
```html
<main class="font-heading text-slate-900 bg-slate-50 min-h-screen">
  <router-outlet />
</main>
```
This is replaced by real layout in later screen tasks.

## Files Affected
| File | Action | Summary |
|------|--------|---------|
| `package.json` | Modify | Add `tailwindcss`, `postcss`, `autoprefixer` dev deps. |
| `tailwind.config.js` | Create | Modern-minimal theme extension (sky, violet, slate, fonts, radii). |
| `postcss.config.js` | Create | Standard Tailwind + Autoprefixer pipeline. |
| `src/styles.css` | Modify | Tailwind directives + Poppins/Inter import + base `@apply` patterns. |
| `src/app/app.component.ts` | Modify | Confirm `styles: []` and `templateUrl`. |
| `src/app/app.component.html` | Modify | Smoke layout using sky/slate/Poppins tokens. |
| `eslint.config.js` | Modify | Custom rules banning `styleUrls` and non-empty `styles`. |

## Edge Cases & Risks
- **Loading Poppins/Inter via Google Fonts blocks first paint:** acceptable for v1; if the a11y/perf budget in T-021 demands it, switch to self-hosting via `@fontsource/poppins` and `@fontsource/inter` (a future polish, not required by this task).
- **Tailwind purge missing classes referenced only in mockups:** `content` glob includes `./mockups/**/*.html` so mockup-only utilities still get emitted; recheck the glob if mockups land elsewhere.
- **ESLint custom selector false positives:** the AST selector for `styleUrls` matches any object literal property with that key — may flag unrelated code. Restrict to decorator argument objects via a more specific selector (`Decorator[expression.callee.name='Component']`).
- **Modern-minimal profile drift:** if `carestechs-ui-design/profiles/modern-minimal.md` updates tokens (e.g., new status palette), this config must be re-derived rather than patched ad hoc, per the technical note in the task.

## Acceptance Verification
- [ ] **AC-1** (`tailwind.config.js` extends theme with primary `sky-500`, accent `violet-500`, status colors, Poppins/Inter): Inspect `tailwind.config.js` — `theme.extend.colors.primary` is `#0EA5E9`; `accent` is `#8B5CF6`; emerald/amber/red status entries present; `fontFamily.heading = ['Poppins',…]` and `fontFamily.sans = ['Inter',…]`.
- [ ] **AC-2** (`src/styles.css` has Tailwind directives + minimal `@apply`): `grep -n '@tailwind' src/styles.css` shows base/components/utilities; `grep -c '@apply' src/styles.css` is small (≤ 5) and limited to `@layer base`.
- [ ] **AC-3** (No `.scss` or per-component `.css` file in repo): `find . -path ./node_modules -prune -o \( -name '*.scss' -o -name '*.component.css' \) -print` returns nothing.
- [ ] **AC-4** (ESLint guard fails the build if a component declares `styleUrls` or non-empty `styles`): Temporarily add `styleUrls: ['./x.css']` to `app.component.ts` and run `npm run lint` — expect a non-zero exit and the custom error message; revert.
