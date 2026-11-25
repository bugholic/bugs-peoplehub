# PeopleHub: TODO / progress log

Work plan for the gaps in [`HRMS-GAP-ANALYSIS.md`](./HRMS-GAP-ANALYSIS.md) (IDs like `A1` refer to that file).
**To resume:** pick the first unchecked item in the lowest phase. Update this file after every completed task: tick it, add the date and a one-line note of what changed, and log it under "Progress log".

Legend: `[ ]` todo · `[~]` in progress · `[x]` done

## Phase 1: Leave correctness (P0 bugs)
- [x] **T1 (A1)** Unpaid leave types (LOP) skip the balance check on apply and approve. _(2026-11-26: `applyLeave`/`approveLeave` gate `assertSufficientBalance` on `type.paid`; balances API returns `unlimited: true` for unpaid types.)_
- [x] **T2 (A2, A3, A4, A5)** Lazy balance provisioning: `ensureBalances(employeeId, year)` creates missing `LeaveBalance` rows for every active type (prorated in the join year), used by every balance read/apply/approve. Fixes admin-created employees, new leave types and new years without a cron. _(2026-11-26: `src/lib/leave.ts#ensureBalances` + `grantForYear`; called from `getBalances` and `approveLeave`; eager `createMany` removed from `provisionEmployee`. Each type starts at its own first row, so a newly added type is never granted retroactively. Max 1 year ahead.)_
- [x] **T3 (A3)** Carry-forward: available balance for year Y includes the unused balance of Y-1 for `carryForward` types (computed, so late approvals stay correct). _(2026-11-26: `carriedInto` + `entitlement`; `granted` = `annualGrant` + `carriedForward`; OpenAPI `LeaveBalance` updated.)_
- [x] **T4 (A8)** Carry-forward cap: `LeaveType.maxCarryForward` (migration + validator + admin UI). _(2026-11-26: migration `20261126180000_leave_carry_forward_cap` applied to Neon; `leaveTypeSchema` / new default-free `leaveTypeUpdateSchema`; new `PATCH /api/leave/types/[id]`; `/leave` Admin tab now has Paid / Half-day / Carry-forward / cap inputs on add, plus an inline Edit per type; OpenAPI updated.)_
- [ ] **T5 (A4)** Admin balance adjustment with a ledger (`LeaveBalanceAdjustment`: delta, reason, who, when); quota change applies to the current year.
- [~] **T6** Tests for T1–T5 rules; `tsc`, `eslint`, `vitest` green. _(T1–T4 covered: unit tests in `leave.test.ts` + DB integration test `leave-balances.test.ts` (throwaway org, self-cleaning). T5 tests pending.)_

## Phase 2: Notifications (P0)
- [ ] **T7** `Notification` model + in-app notification centre (bell, unread count, mark read) on web.
- [ ] **T8** Emit notifications on leave / regularization / remote-work submit + decide.
- [ ] **T9** Email delivery (provider abstraction; templates).
- [ ] **T10** Expo push on mobile (device token registration).
- [ ] **T11** Daily reminder for pending approvals.

## Phase 3: Approvals & attendance rules (P0)
- [ ] **T12 (A6)** Resolve approver at decision time (current manager), fallback to HR; escalation after N days.
- [ ] **T13 (A9)** Shift model: start/end, grace, half-day/full-day minimum hours; late-in / early-out / OT on the day log.
- [ ] **T14 (A10)** Per-location work week (week-off pattern incl. alternate Saturdays).
- [ ] **T15 (A11)** Time zone per organization / location.
- [ ] **T16 (A13)** Auto-close open sessions + auto-absent job.
- [ ] **T17 (A12)** Admin direct attendance edit (audited) + CSV import.
- [ ] **T18 (A7)** Partial cancellation of started leave; manager revoke.
- [ ] **T19 (A8)** Leave policy rules: sandwich, min notice, max consecutive, document required, eligibility, comp-off, optional holidays.

## Phase 4: Core HR depth (P1)
- [ ] **T20 (A15)** Extended profile fields (personal, emergency, bank, IDs, employment type, probation, notice) + T21 field-level permission.
- [ ] **T22 (A17)** Audit log (append-only, every mutation) + viewer.
- [ ] **T23 (A14)** Exit/offboarding workflow: resignation, LWD, checklist, exit interview.
- [ ] **T24** Onboarding checklists.
- [ ] **T25** Document management + policy acknowledgement.
- [ ] **T26 (A18)** Bulk employee import / export (CSV).
- [ ] **T27** Reports: headcount, attrition, leave utilisation, absenteeism, late-coming.
- [ ] **T28** Payroll export (monthly attendance + LOP days per employee).

## Phase 5: Extended modules (P2/P3)
- [ ] **T29** Performance (goals, review cycles)
- [ ] **T30** Timesheets
- [ ] **T31** Expense claims
- [ ] **T32** Asset management
- [ ] **T33** HR helpdesk
- [ ] **T34** Engagement (announcements, birthdays, kudos)
- [ ] **T35** Recruitment (ATS)
- [ ] **T36** Integrations (biometric, Slack/Teams, calendar, webhooks)

## Progress log
| Date | Task | Notes |
|---|---|---|
| 2026-11-26 | — | Gap analysis written; TODO created. |
| 2026-11-26 | T1, T2, T3 | LOP unblocked; lazy prorated balance provisioning; computed carry-forward. +10 unit tests (`grantForYear`, `carriedInto`). `tsc`, `eslint src/lib`, `vitest` (70 passed) green. Not yet exercised against the live DB / UI. Known limitation: changing `annualQuota` doesn't touch already-created rows (covered by T5). |
| 2026-11-26 | T4, T6 (partial) | Carry-forward cap end to end (schema → migration applied to Neon → validator → `PATCH /api/leave/types/[id]` → admin UI → OpenAPI, lint clean). Added `leave-balances.test.ts` integration test: proration, no retro rows, LOP apply+approve, capped/uncapped rollover, +1-year limit. Full suite with DB: 90/90 passed; `tsc`, `eslint src` clean. Not yet clicked through in the browser. Run DB tests with: `set -a; . ./.env; set +a; npx vitest run`. |
