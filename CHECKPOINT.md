# PeopleHub: Checkpoint (2026-10-17)

An HR app modeled on Zoho People's **public** features. All code is original, with no Zoho branding or assets. V1 covers the **Employee directory** and **Leave & attendance**.
Full plan: `C:\Users\ayush\.claude\plans\piped-hatching-peacock.md`

## Environment
- Next.js **16.4.2** (App Router, `src/`, Tailwind 4) and React 19.3. **Read `node_modules/next/dist/docs/` before writing code.** `middleware` is now `proxy.ts`, and `params`, `cookies()` and `headers()` are async.
- Prisma **7.10.1**: generator `prisma-client` outputs to `src/generated/prisma`. It needs the driver adapter `@prisma/adapter-pg`, and config lives in `prisma.config.ts` (seed = `tsx prisma/seed.ts`). Pin `prisma@7.10.1`, because `prisma@*` resolves to 8.0.0-rc.
- Postgres 16 runs in Docker as `peoplehub-db` on **port 5433**, because 5432 is taken by `foodox-db`. `.env` holds `DATABASE_URL` and `SESSION_SECRET` (gitignored).
- Postman CLI 1.71.0 is available. `postman/skills/api-engineer/SKILL.md` has been read: contract first, validate by running a collection, no workspace push without consent.
- Python is not installed. Use Edit/Node for scripted edits.

## Changes from the plan
- **Auth**: a custom JWT session (`jose`, HS256, httpOnly cookie `ph_session`) plus bcryptjs, instead of Auth.js, to avoid Next 16 peer-dependency friction.
- **UI**: hand-rolled Tailwind components instead of the shadcn CLI.

## Done
- [x] Researched Zoho People's public docs: leave (apply, half-day, balance summary, cancel, team calendar, holidays) and attendance (check-in/out, list/tabular/calendar views, regularization with approval, permissions, shifts).
- [x] Scaffold, dependencies, `docker-compose.yml`, `.env`, `prisma.config.ts`
- [x] `prisma/schema.prisma`: User, Employee (self-relation for the reporting manager), Department, Designation, Location, LeaveType, LeaveBalance, LeaveRequest, Holiday, AttendanceLog, RegularizationRequest. **Migration `init` applied, client generated.**
- [x] `src/lib/db.ts`: Prisma client with the pg adapter, as a singleton
- [x] `src/lib/dates.ts`: UTC date-only helpers, `APP_TZ` (default Asia/Kolkata), `zonedTimeToUtc`, `todayIso`, `monthRange`
- [x] `src/lib/errors.ts`: `ApiError` plus badRequest, conflict, forbidden, notFound and unauthorized
- [x] `src/lib/session.ts`: signSession, verifySession, cookie options
- [x] `src/lib/authz.ts`: getSession, requirePageSession, requireSession(...roles), assertCanViewEmployee, assertCanApprove (direct manager or admin, never self), the `route()` wrapper (ApiError → status, ZodError → 422), readJson
- [x] `src/lib/leave.ts`: `countLeaveDays` (excludes weekends and holidays; a half day must be one date and counts 0.5), `availableBalance` (granted − used − pending), `getBalances`, `applyLeave` (overlap, cross-year and balance checks), `approveLeave` (transaction that deducts balance), `rejectLeave`, `cancelLeave` (restores balance; approved leave only before its start date), serializer
- [x] `src/lib/attendance.ts`: `checkIn` (once per day), `checkOut` (last one wins), `getMonth` (status per day: PRESENT, ABSENT, LEAVE, HALF_DAY_LEAVE, HOLIDAY, WEEKEND, UPCOMING), `summarize`, `requestRegularization` (handles overnight shifts), `decideRegularization`
- [x] `src/lib/validators.ts`: Zod 4 schemas for every endpoint, plus `parseQuery`

## Next steps
1. **Write the OpenAPI contract** at `openapi/peoplehub.yaml`, then run `postman init --spec openapi/peoplehub.yaml --yes` (local only, no `--visibility`). Endpoints:
   - `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/me`
   - `GET|POST /api/employees`, `GET|PATCH|DELETE /api/employees/{id}` (DELETE deactivates), `GET /api/org-chart`, `GET /api/lookups`
   - `GET|POST /api/leave/types`, `GET /api/leave/balances?employeeId&year`
   - `GET|POST /api/leave/requests?scope=mine|team|all&status&year`, `POST /api/leave/requests/{id}/approve|reject|cancel`
   - `GET|POST /api/holidays?year`, `DELETE /api/holidays/{id}`
   - `POST /api/attendance/check-in|check-out`, `GET /api/attendance?month=YYYY-MM&employeeId`, `GET /api/attendance/report?month&format=csv`
   - `GET|POST /api/attendance/regularizations`, `POST /api/attendance/regularizations/{id}/approve|reject`
   - Error shape: `{ error: { code, message, details? } }`
2. Route handlers in `src/app/api/**/route.ts`, each wrapped in `route()`.
3. `src/proxy.ts`: redirect signed-out page requests to `/login` (exclude `/api`, `/_next`, static files).
4. `prisma/seed.ts`: about 30 employees, 5 departments, designations, 2 locations, leave types (CL 12, SL 10, EL 15, LOP unpaid), holidays, and the past month's attendance. Demo logins: admin, manager and employee (password `Password@123`).
5. UI: login, app shell and sidebar, dashboard (check-in widget, balances, approvals, holidays, who's on leave today), `/employees` with profile pages and the org chart, `/leave` (apply, my requests, team calendar, approvals, admin types/holidays), `/attendance` (calendar, tabular view, regularization, team report with CSV).
6. Tests: Vitest for `countLeaveDays`, `availableBalance`/`assertSufficientBalance`, `deriveDayStatus`, `validateRegularization`, `zonedTimeToUtc`. Add `"test": "vitest run"` to package.json.
7. Postman collection and `postman collection run` against `npm run dev`. Then a manual end-to-end pass: an employee applies, the manager approves, the balance goes down.

## Resume
```
cd C:\Users\ayush\Desktop\Aayush\peoplehub
docker compose up -d
npx prisma generate
```
Then continue from Next steps, item 1.
