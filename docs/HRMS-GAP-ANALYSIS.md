# PeopleHub: HRMS gap analysis

_Written 2026-11-26. Compares PeopleHub (web `peoplehub/` + Expo `mobile/`) against industry HRMS products (Zoho People, Keka, Darwinbox, BambooHR)._
_The work plan and progress for these items is tracked in [`TODO.md`](./TODO.md)._

## What exists today
- **Core HR**: employee directory, profile, photo, org chart, departments / designations / locations, multi-tenant orgs (Clerk), employee codes.
- **Leave**: leave types, per-year balances, apply / approve / reject / cancel, half days, holiday calendar (per location).
- **Attendance**: check-in/out with multiple sessions per day, office geofence, remote-work approval, regularization, month calendar, team report + CSV.
- **Access control**: custom access roles with team- and org-scoped permissions (`src/lib/permissions.ts`).

## A. Bugs and gaps in existing features

### Leave
| ID | Issue | Where |
|---|---|---|
| A1 | **Loss of Pay can never be applied.** `LOP` is seeded with `annualQuota: 0`; `applyLeave` and `approveLeave` run `assertSufficientBalance` for every type, so it always fails with `INSUFFICIENT_BALANCE`. | `src/lib/provision.ts`, `src/lib/leave.ts` |
| A2 | **Admin-created employees get no leave balances.** Only `provisionEmployee`'s create branch calls `leaveBalance.createMany`; `POST /api/employees` and the "link existing directory record" branch don't. | `src/app/api/employees/route.ts`, `src/lib/provision.ts` |
| A3 | **No year-end rollover.** Nothing creates next year's `LeaveBalance` rows, so on 1 Jan everyone has `granted = 0`. `LeaveType.carryForward` is stored but never read. | `src/lib/leave.ts` |
| A4 | **New leave type / quota change doesn't reach existing employees.** Creating a type grants nobody a balance; editing `annualQuota` doesn't update existing rows. | `src/app/api/leave/types/route.ts` |
| A5 | **No proration / accrual.** A November joiner gets the full annual quota. No monthly/quarterly accrual. | `src/lib/provision.ts` |
| A6 | **Approval is single-level and the approver is fixed at apply time.** `approverId = reportingManagerId` when the request is made; a manager change leaves it with the old approver; no manager means only `approve_all` holders see it. No escalation, delegation, or multi-level chain. | `src/lib/leave.ts`, `src/lib/attendance.ts` |
| A7 | **Approved leave can't be cancelled once started.** No partial cancellation (returning early), no manager revoke. | `src/lib/leave.ts#cancelLeave` |
| A8 | **Missing policy rules**: sandwich rule, minimum notice, max consecutive days, blackout dates, document required (e.g. SL > N days), gender/tenure eligibility, comp-off, restricted/optional holidays, carry-forward cap, encashment. | — |

### Attendance
| ID | Issue | Where |
|---|---|---|
| A9 | **No shift model**: no shift timing, grace period, late-in / early-out, overtime, min hours for full/half day. `deriveDayStatus` only checks whether a log exists. | `src/lib/attendance.ts` |
| A10 | **Weekend hard-coded to Sat/Sun** for every location. No alternate-Saturday or 6-day week. | `src/lib/dates.ts#isWeekend` |
| A11 | **One time zone for all tenants**: `APP_TZ` env var (default `Asia/Kolkata`). | `src/lib/dates.ts` |
| A12 | **No direct admin attendance edit**, no bulk import (biometric / CSV), no monthly regularization limit. | — |
| A13 | **No auto-absent / missed-checkout handling**; an open session stays open forever. | — |

### Employees & platform
| ID | Issue |
|---|---|
| A14 | Lifecycle is only `ACTIVE`/`INACTIVE`: no termination reason, last working day, rehire. |
| A15 | Thin profile: no DOB, gender, address, emergency contact, bank, ID numbers (PAN/Iqama/etc.), employment type, probation end, notice period, job history. |
| A16 | **No notifications** (email / push / in-app) for any approval event, no reminders. |
| A17 | **No audit trail** of who changed which field / role / balance. |
| A18 | No bulk employee import / export. |
| A19 | No permission for sensitive fields (salary, bank, IDs) or "view team profile". |

## B. Missing modules

| Priority | Module | Scope |
|---|---|---|
| P0 | Notifications | Email + in-app + Expo push for every approval event; notification centre; pending-approval reminders |
| P0 | Leave policy engine | Accrual, proration, year-end rollover, carry-forward cap / encashment, comp-off, LOP fix, admin balance adjustment with a ledger |
| P0 | Shifts & rosters | Shift definitions, assignment, late/early/OT rules, per-location week-offs |
| P1 | Onboarding | Pre-joining tasks, document collection, checklist with owners |
| P1 | Offboarding / exit | Resignation, notice period, exit checklist (assets, IT, finance), exit interview, F&F trigger |
| P1 | Document management | Employee documents with expiry alerts; company policies with acknowledgement |
| P1 | Payroll / payroll export | Salary structures, components, LOP from attendance, payslips, statutory rules per region (PF/ESI/TDS for India, GOSI/WPS for KSA); at minimum a monthly attendance + LOP export |
| P1 | Reports & analytics | Headcount, attrition, leave utilisation, absenteeism, late-coming; scheduled exports |
| P1 | Audit log | Append-only log of every mutation |
| P2 | Performance | Goals/OKRs, review cycles, self + manager ratings, 360 feedback |
| P2 | Timesheets | Projects, tasks, billable hours, approvals |
| P2 | Expense claims | Claim, receipt upload, approval, reimbursement status |
| P2 | Asset management | Assign / return company assets |
| P2 | HR helpdesk | Employee cases routed to HR |
| P2 | Engagement | Announcements, birthdays / anniversaries, polls, kudos |
| P3 | Recruitment (ATS) | Requisitions, candidates, interview pipeline, offer letters |
| P3 | Learning (LMS) | Courses, assignments, completion tracking |
| P3 | Workflow builder | Configurable approval chains, custom fields |
| P3 | Integrations | Biometric devices, Slack/Teams, calendar sync, SCIM, public API + webhooks |

## C. Non-functional gaps
- Data residency, retention, GDPR/DPDP export & erasure, PII masking.
- Field-level security for salary / bank / ID fields.
- Localisation: languages incl. RTL (Arabic), currency and date formats per org.
- Mobile: offline punch queue, device binding / selfie at check-in (anti buddy-punching).
- Tests: only pure-function unit tests in `src/lib/__tests__`; no route-level or E2E coverage of approval flows; Postman collection never run.
