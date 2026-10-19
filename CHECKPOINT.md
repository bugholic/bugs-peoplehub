# PeopleHub: Checkpoint (2026-10-18)

An HR app modeled on Zoho People's **public** features. All code is original, with no Zoho branding or assets. V1 covers the **Employee directory** and **Leave & attendance**.
Full plan: `C:\Users\ayush\.claude\plans\piped-hatching-peacock.md` (original Windows machine; not available on this one).

This session continued the build on a **new machine (macOS)** — the repo was cloned fresh, so environment setup (Docker, `.env`, `npm install`) was redone from scratch, then the full backend, seed data, tests, OpenAPI contract and UI were built out.

## Environment
- Next.js **16.4.2** (App Router, `src/`, Tailwind 4) and React 19.3. `middleware` is `proxy.ts` (`src/proxy.ts`); `params`, `cookies()` and `headers()` are async.
- Prisma **7.10.1**: generator `prisma-client` outputs to `src/generated/prisma`. Driver adapter `@prisma/adapter-pg`; config in `prisma.config.ts` (seed = `tsx prisma/seed.ts`, also `npm run db:seed`).
- Postgres 16 runs in Docker as `peoplehub-db` on **port 5433**. `.env` holds `DATABASE_URL` and `SESSION_SECRET` (gitignored — recreated this session; not committed, so a fresh clone needs it regenerated, e.g. from this file's values or anew).
- **Removed `cacheComponents`/`partialPrefetching`** from `next.config.ts`: this app is entirely behind auth (every page reads `cookies()`), so Next 16's Cache Components/PPR model — which requires a static shell — had nothing to prerender and failed the build. Plain dynamic rendering is the right fit here.
- Postman CLI reinstalled (v1.75.0, was 1.71.0 on the old machine). **Not logged in** — `postman collection run` in this version requires `postman login`/a Postman account even for fully local collections, which wasn't done since it's an account action that needs the user's go-ahead. The OpenAPI spec was validated with `postman spec lint --issueType syntax` (no login needed) and a collection was generated locally; actual request execution was done via `curl` and a Playwright-driven browser instead.

## Changes from the plan
- **Auth**: a custom JWT session (`jose`, HS256, httpOnly cookie `ph_session`) plus bcryptjs, instead of Auth.js, to avoid Next 16 peer-dependency friction.
- **UI**: hand-rolled Tailwind components instead of the shadcn CLI (`src/components/ui.tsx`).
- **`employeeUpdateSchema`** (`src/lib/validators.ts`): redeclared `role` without `.default(...)` after `.partial()` — Zod keeps a field's default through `.partial()`, which was silently resurrecting `role: "EMPLOYEE"` on every partial employee edit.
- API responses that carry a `@db.Date` field (`Employee.joinDate`, `Holiday.date`, `AttendanceLog.date`) now go through `toIsoDate()` before `NextResponse.json`. Found via the Playwright pass: Prisma/JSON serializes a `Date` as a full ISO datetime, but `src/lib/dates.ts#parseIsoDate` (used by the UI's `formatDate`) strictly expects `YYYY-MM-DD` and threw on `"2026-12-25T00:00:00.000Z"`, crashing the dashboard's holidays widget.

## Done
- [x] Researched Zoho People's public docs (leave, attendance) — from the prior session.
- [x] Scaffold, dependencies, `docker-compose.yml`, `.env`, `prisma.config.ts`, `prisma/schema.prisma` + migration — from the prior session.
- [x] `src/lib/*.ts` (db, dates, errors, session, authz, leave, attendance, validators) — from the prior session.
- [x] **`openapi/peoplehub.yaml`**: full OpenAPI 3.0 contract for every endpoint below. Linted clean (`postman spec lint openapi/peoplehub.yaml --issueType syntax`).
- [x] **`postman/collections/PeopleHub/`** + `postman/environments/local.environment.yaml`: local v3 collection generated from the spec (`postman spec generate collection`), one folder per tag. Login request body pre-filled with a demo credential for convenience.
- [x] **All route handlers** in `src/app/api/**/route.ts`, each wrapped in `route()`:
  `auth/login`, `auth/logout`, `me`, `employees` (list/create), `employees/[id]` (get/patch/delete — admin edits everything, self edits only `phone`, role changes write to `User` not `Employee`), `org-chart`, `lookups`, `leave/types`, `leave/balances`, `leave/requests` (list/apply), `leave/requests/[id]/{approve,reject,cancel}`, `holidays` (list/create), `holidays/[id]` (delete), `attendance/check-in`, `attendance/check-out`, `attendance` (month calendar), `attendance/report` (team summary, JSON or CSV), `attendance/regularizations` (list/create), `attendance/regularizations/[id]/{approve,reject}`.
- [x] **`src/proxy.ts`**: redirects signed-out page requests to `/login` (API routes, `_next`, static files excluded).
- [x] **`prisma/seed.ts`**: 5 departments, 2 locations, 10 designations, 4 leave types (CL 12, SL 10, EL 15, LOP unpaid), 4 national holidays, 30 employees (admin/manager/IC hierarchy), leave balances for the year, and ~20 working days of attendance history with some absences baked in. Demo logins (password `Password@123`): `admin@peoplehub.test`, `manager@peoplehub.test`, `employee@peoplehub.test`.
- [x] **UI**, all under `src/app/(app)/` (shared sidebar shell in `src/app/(app)/layout.tsx` + `src/components/nav-sidebar.tsx`) plus `src/app/login/page.tsx`:
  - `/dashboard` — check-in/out widget, leave balances, upcoming holidays, pending-approvals widget (manager/admin only).
  - `/employees` — searchable directory table, `/employees/new` (admin create form), `/employees/[id]` (profile; self/admin can edit phone; admin can deactivate).
  - `/org-chart` — manager-hierarchy tree.
  - `/leave` — tabs: Apply, My requests (cancel), Approvals (manager: team / admin: team or everyone), Admin (leave types + holidays CRUD, admin only).
  - `/attendance` — tabs: My attendance (month calendar, check-in/out, regularization request form), Regularizations (mine / team approvals), Team report (manager/admin, CSV download).
- [x] **Tests**: Vitest (`npm test`) for `countLeaveDays`, `availableBalance`/`assertSufficientBalance`, `deriveDayStatus`, `validateRegularization`, `workedMinutes`, `zonedTimeToUtc`, `isWeekend`, `monthRange` — 30 tests, all passing. `vitest.config.ts` adds the `@/*` alias (vitest doesn't read `tsconfig.json` paths on its own).
- [x] **Verified end-to-end twice**: once via `curl` (login → apply leave → manager approves → balance deducts → RBAC 401/403 → CSV report), once via a Playwright-driven headless Chromium covering the full UI flow (login, check-in, employee search/profile, apply leave, approvals, attendance calendar, regularization form, org chart) with screenshots and a console-error check. The only console message was a `caret-color` hydration warning that traces to the automation tooling, not app code.
- [x] `npx next build`, `npx tsc --noEmit`, and `npx eslint .` all pass clean.

## Known gaps / next steps
1. **Postman collection run** was never executed end-to-end (needs `postman login`, which wasn't done — see Environment above). If the user wants this, run `postman login` interactively, then something like:
   `postman collection run postman/collections/PeopleHub -e postman/environments/local.environment.yaml`
   (the login request body already has a demo credential; other requests have placeholder bodies/path params from the spec and would need real IDs filled in, or request-level scripts added to chain them).
2. **No photo upload** — `photoUrl` exists in the schema/API but there's no UI to set it.
3. **No pagination UI** on `/employees` — the API supports `page`/`pageSize`, the page just requests up to 50 and doesn't paginate further (fine for the 30-employee seed, would need a "load more" / pager for a bigger org).
4. **Employee editing (admin)** — `/employees/[id]` only lets admins edit `phone` today, even though `PATCH /api/employees/{id}` supports every field for admins. A fuller "edit employee" form (department/designation/manager/status/role) would be the natural next addition.
5. **No attendance edit UI for admin** beyond regularization approval — correcting a log directly isn't exposed.
6. Nothing has been committed — the working tree has all of the above as uncommitted changes.

## Resume
```
cd /Users/aayush/Desktop/bugs-peoplehub
docker compose up -d        # Postgres already has data from the seed; this just restarts the container if needed
npm install                 # if node_modules is missing
npx prisma generate
npm run dev                 # http://localhost:3000 (or add -p <port>)
```
If `.env` is missing (it's gitignored), recreate it with:
```
DATABASE_URL="postgresql://peoplehub:peoplehub@localhost:5433/peoplehub"
SESSION_SECRET="<32+ character secret>"
```
Then `npm run db:seed` to (re)populate demo data.
