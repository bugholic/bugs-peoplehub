# Web → mobile handoff

What changed in the web app and API since the mobile app (`../mobile`, Expo Router) was last
updated, written as a spec for bringing mobile to parity. **Kept up to date after every web
task** (same cadence as [`TODO.md`](./TODO.md)); the mobile catch-up itself is TODO item **F2**.

- The API contract is [`openapi/peoplehub.yaml`](../openapi/peoplehub.yaml). This file explains the behaviour
  and the UI to build; the spec has the exact schemas.
- Errors are always `{"error": {"code": "...", "message": "..."}}`. `message` is user-facing; branch on `code`.
- Mobile files referenced below are relative to `mobile/src/`.

Status legend: ⬜ not started on mobile · 🟨 partly · ✅ done on mobile

## Summary

| # | Feature | Web task | Mobile screens affected | Mobile |
|---|---|---|---|---|
| M0 | Permission-based UI (not Clerk role) | Roles (pre-T1) | everywhere | ⬜ |
| M1 | Leave balance fields: unpaid, carry-forward | T1–T4 | `(tabs)/leave.tsx`, `(tabs)/index.tsx` | ⬜ |
| M2 | Balance adjustments + history | T5 | `employee/[id].tsx` | ⬜ |
| M3 | Leave type admin: edit, carry-forward cap | T4 | leave admin (new) | ⬜ |
| M4 | Notifications centre + deep links | T7, T8, T11, T12 | header bell (new screen) | ⬜ |
| M5 | Approvals routed to the assigned approver | T12 | `(tabs)/leave.tsx`, regularizations | ⬜ |
| M6 | Shifts: HALF_DAY status, late/early/OT, overnight check-out | T13 | `(tabs)/attendance.tsx`, `punch-card.tsx`, `employee/[id].tsx`, `employee/new.tsx` | ⬜ |
| M7 | Shift admin | T13 | new screen under More | ⬜ |
| M8 | Combined leave (split across types) | X1 | `leave/apply.tsx`, `(tabs)/leave.tsx` | ⬜ |
| M9 | Time zone per organization / location | T15 | `lib/dates.ts`, every screen showing times, office locations, settings | ⬜ |
| M10 | Auto-closed sessions + missing-attendance alerts | T16 | `(tabs)/attendance.tsx`, notifications | ⬜ |
| M11 | Configurable weekly off (incl. alternate Saturdays) | T14 | leave apply, attendance calendar, office locations, settings | ⬜ |
| M12 | Admin attendance edit + CSV import, audit trail | T17 | `(tabs)/attendance.tsx`, notifications | ⬜ |
| M13 | Return early / revoke approved leave | T18 | leave screens, approvals, notifications | ⬜ |
| M14 | Extended employee profile + sensitive-field permissions | T20/T21 | employee detail / my profile | ⬜ |

---

## M0. Permission-based UI ⬜

**Web state.** Access is decided by a list of permission keys, not by the Clerk role. Org admins
hold every key; others get a custom access role's keys or their Clerk role's defaults
(`src/lib/permissions.ts`). Every API route checks a key.

**Mobile today.** `hooks/use-me.tsx` derives `isAdmin` / `isManager` from `session.role`, so
someone with a custom HR role sees nothing, and a manager whose role lacks a right sees buttons that 403.

**Build.**
- `GET /api/me` → `session.permissions: string[]` (and `session.accessRole: {id,name} | null`). Add both to `AuthSession` in `lib/types.ts`.
- Add `can(key)` to `useMe()` and gate UI by key. Keys in use on mobile:

| UI | Permission |
|---|---|
| Team leave approvals | `leave.approve_team` (team) / `leave.approve_all` (everyone) |
| Leave types admin | `leave.manage_types` |
| Adjust balances | `leave.adjust_balances` |
| Holidays admin | `holidays.manage` |
| Regularization approvals | `attendance.approve_team` / `attendance.approve_all` |
| Remote work decisions | `attendance.remote_approve` |
| Team attendance report | `attendance.report_team` / `attendance.report_all` |
| Office locations | `attendance.manage_locations` |
| Shifts admin | `attendance.manage_shifts` (new, T13) |
| Add / edit / deactivate employee | `employees.create` / `employees.edit` / `employees.deactivate` |
| Departments, designations | `org.structure` |
| Members | `org.members` |

---

## M1. Leave balances ⬜ (T1–T4)

`GET /api/leave/balances?year=YYYY[&employeeId=]` items now have:

| Field | Meaning |
|---|---|
| `paid` | false for unpaid types (Loss of Pay) |
| `unlimited` | `!paid`: no balance limit; show "Unpaid" / "used N" instead of "N left" |
| `annualGrant` | this year's grant (prorated in the join year: months left, join on/before the 15th counts, rounded to 0.5) |
| `carriedForward` | unused days carried from earlier years (only `carryForward` types, capped by `maxCarryForward`) |
| `granted` | `annualGrant + carriedForward` |
| `used`, `pending`, `available` | `available = granted − used − pending` (pending requests reserve days) |

Rules: balances are created lazily for any year up to next year, so there's no "no balance" state
for a new joiner or a newly added type. Unpaid leave never fails with `INSUFFICIENT_BALANCE`.

**Build.** Balance cards: show `available` of `granted`, a "+N carried" line when `carriedForward > 0`,
and "Unpaid" for `unlimited`. Update `LeaveBalance` in `lib/types.ts`.

## M2. Balance adjustments ⬜ (T5)

- `GET /api/leave/adjustments?employeeId=&year=` → `{ items: [{ id, employeeId, leaveType{id,name,code}, year, days (signed), kind: "MANUAL"|"QUOTA_CHANGE", reason, createdBy{id,name}|null, createdAt }] }`. Own history always; others need `leave.adjust_balances` or approve rights over them.
- `POST /api/leave/adjustments` `{ employeeId, leaveTypeId, year, days, reason }` (`leave.adjust_balances`). `days` is signed, multiples of 0.5. Errors: `NEGATIVE_GRANT` (debit below zero), 403 for your own balance.
- The employee gets a `BALANCE_ADJUSTED` notification.

**Build.** On `employee/[id].tsx`: a "Leave balances" section (year switcher, per type: granted / carried / used / available), an Adjust sheet (type, credit/debit, days, reason) when `can("leave.adjust_balances")` and not self, and the history list.

## M3. Leave type admin ⬜ (T4)

- `POST /api/leave/types` and new `PATCH /api/leave/types/{id}` take `name, code, annualQuota, paid, carryForward, maxCarryForward (number|null, multiples of 0.5), allowHalfDay`. PATCH is partial.
- Changing `annualQuota` moves this year's and later balances by the prorated difference and writes `QUOTA_CHANGE` adjustments; the PATCH response includes `balancesUpdated`.

**Build.** A leave types screen (More → Leave types) behind `leave.manage_types`: list, add, edit.

## M4. Notifications ⬜ (T7, T8, T11, T12)

- `GET /api/notifications?unread=true|false&limit=1..100` → `{ items: [{ id, type, title, body, link, read, createdAt, actor{id,name,photoUrl}|null }], unreadCount }`.
- `POST /api/notifications/read` `{ ids?: string[] }` (omit `ids` = mark all) → `{ updated, unreadCount }`.
- `type` values: `LEAVE_SUBMITTED`, `LEAVE_APPROVED`, `LEAVE_REJECTED`, `LEAVE_CANCELLED`, `REGULARIZATION_SUBMITTED`, `REGULARIZATION_APPROVED`, `REGULARIZATION_REJECTED`, `REMOTE_SUBMITTED`, `REMOTE_APPROVED`, `REMOTE_REJECTED`, `BALANCE_ADJUSTED`, `APPROVALS_PENDING` (daily digest), `APPROVAL_ASSIGNED` (request routed/escalated to you), `ATTENDANCE_AUTO_CLOSED`, `ATTENDANCE_MISSING` (see M10).
- `title`/`body` are ready to display; don't rebuild text from `type`.

**Deep links.** `link` is a web path. Map it to mobile routes:

| Web `link` | Mobile route |
|---|---|
| `/leave?tab=Approvals` | `(tabs)/leave` → approvals section |
| `/leave?tab=My+requests` | `(tabs)/leave` → my requests |
| `/attendance?tab=Regularizations` | `(tabs)/attendance` → regularizations |
| `/attendance?tab=Remote+work` | `(tabs)/attendance` → remote work |
| `/employees/{id}` | `employee/[id]` |

**Build.** A bell with an unread badge in the tab header, a notifications screen (tap = mark read + navigate, "Mark all read"),
refresh on app foreground (`AppState`) plus polling while open. Push delivery comes later (TODO **F4**, Expo push); design the list so a push tap can open the same deep link.

## M5. Approvals routing ⬜ (T12)

- Requests are assigned to the first person up the applicant's reporting line who is active, has a login, and has approve rights; if nobody, to the HR queue (`approver: null`). Requests move when the manager changes or is deactivated, and escalate one level after `APPROVAL_ESCALATION_DAYS` (default 3) without a decision.
- `GET /api/leave/requests?scope=team` and `GET /api/attendance/regularizations?scope=team` now include requests **assigned to you** (escalated from below), not only direct reports'. No client change needed beyond not filtering by `reportingManagerId` on the device.
- Approve/reject is allowed for the assigned approver even if they aren't the direct manager.

## M6. Shifts on attendance ⬜ (T13)

**Day status.** `DayStatus` gains `HALF_DAY`. Under a shift, a finished past working day below
the full-day minimum is `HALF_DAY`, below the half-day minimum `ABSENT`. Today, leave days,
holidays and weekends are never downgraded. Add `HALF_DAY` to the type and give it an amber pill.

**New fields.**
- `AttendanceDay` (`GET /api/attendance?month=`): `lateMinutes`, `earlyExitMinutes`, `overtimeMinutes` (0 when no shift).
- Punch response (`POST /api/attendance/check-in|check-out`): the same three plus `credit: "FULL"|"HALF"|"SHORT"|null`.
- Month `summary`: `lateDays`, `earlyExitDays`, `overtimeMinutes` (`present`/`absent` count a `HALF_DAY` as 0.5 each).
- Team report rows (`GET /api/attendance/report`): the same three summary fields; the CSV gained "Late Days", "Early Exit Days", "Overtime" columns.

**Rules (to explain in UI copy).** Late counts once past the grace, measured from the shift start
(9:00 start, 15 min grace: 9:16 is "Late 16m"). Early exit likewise from the shift end. Overtime is
worked time beyond the shift length; on weekends/holidays all worked time is overtime. Late is
known at check-in; the rest once no session is open.

**Overnight check-out.** Check-out now also closes a session still open from **yesterday** if it
started ≤16 h ago (night shifts). Older open sessions still return `NOT_CHECKED_IN`. The punch
response's `date` is then yesterday; `punch-card.tsx` should not assume `date === today`.

**Build.**
- Monthly list: small "Late 40m · Left 4h 20m early · OT 1h" line under worked time.
- Summary: "N late arrivals · N early exits · Xh overtime" when non-zero.
- Punch card: after check-in, if `lateMinutes > 0` show "Checked in 40 min late".
- Employee profile: `GET /api/employees/{id}` has `shift: {id,name,startTime,endTime} | null` (null = org default). With `employees.edit`, a picker that PATCHes `{ shiftId: string|null }`.
- New employee form: optional `shiftId`. `GET /api/lookups` now returns `shifts: [{id,name,startTime,endTime,isDefault}]`.

## M7. Shift admin ⬜ (T13)

- `GET /api/shifts` → `{ items: Shift[] }` (any signed-in user). `Shift = { id, name, startTime, endTime ("HH:mm"), graceMinutes, halfDayMinutes, fullDayMinutes, isDefault, overnight, scheduledMinutes, employeeCount }`.
- `POST /api/shifts`, `PATCH /api/shifts/{id}`, `DELETE /api/shifts/{id}` (`attendance.manage_shifts`).
- Rules: the first shift becomes the default; exactly one default once any exist. Making one default clears the others. `isDefault: false` on the default → `DEFAULT_REQUIRED`; deleting the default while others exist → `DEFAULT_REQUIRED`; `halfDayMinutes > fullDayMinutes` → `INVALID_THRESHOLDS`; duplicate name → `DUPLICATE`. Deleting a shift moves its employees to the default. Edits aren't retroactive.

**Build.** More → Shifts: list (timing, "overnight", grace, half/full hours, employee count, Default badge), add/edit sheet (times, grace minutes, half/full day in hours → send minutes), "Make default", delete with confirm.

## M8. Combined leave ⬜ (X1)

One application split across leave types when one type isn't enough, e.g. 12 days Casual + 3 days Earned.

**Preview** (call as the user picks type and dates, debounced):
`GET /api/leave/requests/preview?leaveTypeId=&fromDate=&toDate=&dayPart=FULL` →
`{ days, available (null = unpaid), covered, suggestion: { parts: [{leaveTypeId, days}], shortfall } | null, balances: [{leaveTypeId, name, paid, available|null}] }`.
`suggestion` is set when `covered` is false and `dayPart` is FULL: the chosen type first, then other paid types (largest balance first), then an unpaid type. `shortfall > 0` means even that can't cover it.

**Apply combined:** `POST /api/leave/requests` with `parts` instead of `leaveTypeId`:
```json
{ "fromDate": "2026-12-01", "toDate": "2026-12-17", "reason": "Trip", "parts": [
  { "leaveTypeId": "cl_id", "days": 12 }, { "leaveTypeId": "el_id", "days": 1 } ] }
```
→ `201 { groupId, items: LeaveRequest[] }`. Rules: 2–5 parts, each type once, whole days, full days only,
days must add up to the range's working days (`PARTS_MISMATCH`), each part within its balance
(`INSUFFICIENT_BALANCE` names the type). Parts are laid over working days in order (first part
takes the first N working days). A single-type request is unchanged.

**One request everywhere.** Every `LeaveRequest` now has `groupId: string | null`. Parts with the same
`groupId` are one application:
- Lists (`GET /api/leave/requests`): group by `groupId`, show one card: "Casual leave 12 days + Earned leave 1 day", date range first part start → last part end, total days.
- Approve / reject / cancel **any** part's id acts on the whole group (label "Approve all"). Cancelling approved combined leave is blocked once its first day has started.
- Notifications already describe the group ("requested Casual + Earned").

**Build.** In `leave/apply.tsx`: show "N days · X available" from preview; when not covered, a
"Combine leave types" action that fills an editable breakdown (type picker + days per row, add/remove,
running "N of M days" total; submit disabled until it matches). In `(tabs)/leave.tsx`: group cards by `groupId`.


## M9. Time zones ⬜ (T15)

**Web state.** Each organization has a zone (`Organization.timeZone`, default `Asia/Kolkata`) and a
location can override it (`Location.timeZone`, null = org's). A person's zone = their location's, else
the org's. The server uses it for: which calendar day a punch belongs to, shift late/early windows,
the wall-clock times in a regularization request, "today" in the month view, and the cut-off for
cancelling approved leave.

**API.**
- `GET /api/me` → new top-level `timeZone` (the signed-in person's zone) and `organization.timeZone`.
- `GET /api/organization` → `{ name, timeZone, bannerUrl }`; `PATCH /api/organization` `{ timeZone }` (`org.structure`). Invalid zone → 422.
- Locations (`GET/POST/PATCH /api/locations`): `timeZone: string | null`.

**Mobile today.** `lib/dates.ts` formats times in a fixed zone, so anyone outside India sees wrong
times and the wrong "today".

**Build.**
- Read `timeZone` from `/api/me` once (in `useMe`) and use it as the default zone in `lib/dates.ts` (`todayIso`, time formatting). Don't use the device zone: someone travelling should still see their office's day.
- Regularization form times are wall-clock in that zone; send them as `HH:mm` (unchanged).
- Office locations screen: a time zone picker ("Organization default" + IANA zones).
- Settings/structure screen (`org.structure`): organization time zone picker.


## M10. Auto-close and missing attendance ⬜ (T16)

**Web state.** The daily job (weekdays 09:00 IST) now also:
- closes sessions nobody checked out of (still open 16 h+ into a later day): office sessions at the shift end, remote sessions or days without a shift at the check-in time with no time counted. The day gets `autoClosed: true` and the employee an `ATTENDANCE_AUTO_CLOSED` notification;
- notifies anyone with nothing on their last working day (no check-in, no pending/approved leave, no pending correction) with `ATTENDANCE_MISSING`, once.
An approved regularization for the day clears `autoClosed`.

**API.** `autoClosed: boolean` on `AttendanceDay` (month) and on the punch response. New notification
types `ATTENDANCE_AUTO_CLOSED` (link `/attendance?tab=My+attendance`) and `ATTENDANCE_MISSING`
(link `/attendance?tab=My+attendance&missing=YYYY-MM-DD`).

**Build.**
- Monthly list: an amber "Auto-closed" tag under the last-out time when `autoClosed`, with a shortcut to the regularize screen for that date.
- Deep link: `/attendance?...&missing=DATE` → open `attendance/regularize` prefilled with that date (and offer "Apply leave").
- Punch card: if the user opens the app and yesterday was auto-closed, nothing special is needed; the check-in button works as normal.


## M11. Configurable weekly off ⬜ (T14)

**Web state.** Weekends are no longer hard-coded Sat + Sun. HR/admins (`org.structure`) set the
organization's weekly off in Settings; an office location can override it (`attendance.manage_locations`).
A pattern can be "2nd and 4th Saturday". Week-offs aren't counted as leave, show as `WEEKEND` in the
month view, aren't flagged missing, and any time worked on them is overtime.

**Pattern format** (`lib/week-off.ts` on web, pure TS, copy it as-is): comma-separated tokens,
`D` = weekday D off every week (0 = Sunday ... 6 = Saturday), `D#n` = only the n-th D of the month.
`"0,6"` = Sat + Sun (default), `"0,6#2,6#4"` = Sundays + 2nd/4th Saturday, `"5,6"` = Fri + Sat.
`describeWeekOff()` gives "2nd & 4th Sat, Sun".

**API.**
- `GET/PATCH /api/organization`: `weekOff: string` (PATCH accepts `timeZone` and/or `weekOff`).
- Locations (`GET/POST/PATCH /api/locations`): `weekOff: string | null` (null = org's).
- Leave day counts (`/api/leave/requests/preview`, apply) and attendance statuses already use it server-side.

**Build.**
- Nothing to compute on the phone: day statuses and leave day counts come from the server. **Don't**
  hard-code Sat/Sun anywhere (e.g. greying weekend cells in a date picker); if a picker needs it, read
  the pattern from the employee's location / org and use `isWeekOff`.
- Admin (optional): weekly-off editor on the office location screen and settings, per weekday
  Working / Off every week / Off some weeks (1st–5th checkboxes).


## M12. Admin attendance edit and import ⬜ (T17)

**Web state.** People with `attendance.edit` (HR preset) can set or clear any day of someone else's
attendance, and import a CSV. Each change is stored in `AttendanceEdit` (before / after, reason, who,
MANUAL or IMPORT). The employee gets an `ATTENDANCE_EDITED` notification and the day is flagged `edited`.

**API.**
- `edited: boolean` on `AttendanceDay` (month) and the punch response.
- `GET /api/attendance/edits?employeeId=&month=` → `{ items: AttendanceEdit[] }` (employee or anyone who can view their attendance).
- `POST /api/attendance/edits` { employeeId, date, checkIn, checkOut, reason } (both times null = clear).
- `POST /api/attendance/import` { csv, dryRun, reason } → preview or result rows.
- New permission `attendance.edit`; new notification type `ATTENDANCE_EDITED` (link `/attendance?tab=My+attendance`).

**Build.**
- Monthly list: a sky "Edited by admin" tag under the out time when `edited`; tapping could show the
  reason from `/api/attendance/edits?employeeId=me&month=`.
- Admin tools (optional on mobile, CSV import is better on web): hide behind `attendance.edit`.


## M13. Return early and revoke leave ⬜ (T18)

**Web state.** Approved leave can now be cut short, including after it started:
- the employee taps "Return early" on ongoing leave and picks the first day back;
- a manager/HR (anyone who could approve it) can revoke approved leave from a date, with a note.
Days from that date on are given back to the balance; days already taken stay. A combined leave is
trimmed across its parts. If the date is on/before the first day, the whole leave is cancelled.
The date can't be in the past.

**API.** `POST /api/leave/requests/{id}/shorten` { returnOn: "YYYY-MM-DD", note? } →
`{ freedDays, cancelled, lastDay, revoked, request }`. Errors: 400 `PAST_DATE` / `NOTHING_TO_RELEASE`,
409 `NOT_APPROVED`, 403 if not the owner and not an approver for them. New notification type
`LEAVE_REVOKED` (to the employee, link `/leave?tab=My+requests`); an employee's early return reuses
`LEAVE_CANCELLED` to the approver.

**Build.**
- My requests: for an APPROVED application with `fromDate <= today <= toDate`, a "Return early" action
  with a date picker (min today, max toDate, default tomorrow). Not-yet-started leave keeps the old "Cancel".
- Approvals (manager): a Pending / Approved switch; the approved list is `GET /api/leave/requests?scope=team|all&status=APPROVED`
  filtered client-side to `toDate >= today`, each with "Revoke" (date picker min = max(today, fromDate), optional note).
- After success, refetch requests and balances.


## M14. Extended profile and field-level permissions ⬜ (T20/T21)

**Web state.** An employee's profile now has four sections, shown as cards on `/employees/[id]`:
personal (DOB, gender, marital status, blood group, nationality, personal email, addresses),
emergency contact, employment (type, probation end, notice period) and identity & bank (PAN, Aadhaar,
passport, bank account holder / name / number / IFSC). Which sections you see, and which you can edit,
depends on who you are.

**Rules** (server-enforced; mirror them in the UI from `access`, don't re-derive):
| Section | Can view | Can edit |
|---|---|---|
| personal, emergency | the employee, their direct manager, `employees.edit` | the employee, `employees.edit` |
| employment | same | `employees.edit` |
| sensitive | the employee, `employees.view_sensitive`, `employees.edit_sensitive` | `employees.edit_sensitive` only (not the employee) |

**API.**
- `GET /api/employees/{id}/profile` → `{ access: { view, edit }, data: { personal?, emergency?, employment?, sensitive? } }`.
  A section you can't see is absent. 403 if you can see none. Every field is `null` until set.
- `PATCH /api/employees/{id}/profile` { any subset of fields; null or "" clears }. A field in a section you
  can't edit → 403 and nothing is written. PAN / Aadhaar / IFSC are normalized server-side; send raw input.
- New permission keys `employees.view_sensitive`, `employees.edit_sensitive` (HR preset).
- `lib/profile-fields.ts` is pure TS (field catalog, `sectionAccess`, `maskTail`): copy it as-is.

**Build.**
- "My profile": the same cards for the signed-in user (`GET /api/employees/{me.employeeId}/profile`); edit personal and emergency.
- Employee detail (manager / HR): render only the sections present in `data`; show Edit only where `access.edit[section]`.
- Mask account / PAN / Aadhaar / passport (last 4 visible) with a tap-to-reveal; never log or cache these values.
- Emergency phone uses the existing phone input (E.164).

---

## `lib/types.ts` checklist

- [ ] `AuthSession`: `permissions: string[]`, `accessRole: Ref | null`
- [ ] `DayStatus`: add `'HALF_DAY'`
- [ ] `AttendanceDay`: `lateMinutes`, `earlyExitMinutes`, `overtimeMinutes`, `autoClosed`, `edited`
- [ ] Punch log: those three + `credit`, `autoClosed`
- [ ] `AttendanceMonth.summary`: `lateDays`, `earlyExitDays`, `overtimeMinutes`
- [ ] `Lookups`: `shifts`
- [ ] `EmployeeDetail`: `shift`
- [ ] `LeaveBalance`: `paid`, `unlimited`, `annualGrant`, `carriedForward`
- [ ] `LeaveRequest`: `groupId`
- [ ] `Me`: `timeZone`, `organization.timeZone`
- [ ] New: `EmployeeProfile` (`access` + per-section `data`), `ProfileSection`
- [ ] `Location`: `timeZone: string | null`, `weekOff: string | null`
- [ ] New: `Notification`, `Shift`, `LeaveBalanceAdjustment`, `LeavePreview`, `OrganizationSettings`

## Changelog

| Date | Web task | Added here |
|---|---|---|
| 2026-11-26 | Initial write-up | M0–M8 covering T1–T5, T7, T8, T11, T12, T13, X1 |
| 2026-11-26 | T15 | M9 time zones |
| 2026-11-26 | T16 | M10 auto-close + missing attendance; M4 notification types +2 |
| 2026-11-26 | T14 | M11 configurable weekly off; `OrganizationSettings.weekOff`, `Location.weekOff` |
| 2026-11-26 | T17 | M12 admin attendance edit + import; `attendance.edit`, `ATTENDANCE_EDITED`, `edited` |
| 2026-11-26 | T18 | M13 return early / revoke leave; `/shorten`, `LEAVE_REVOKED` |
| 2026-11-26 | T20+T21 | M14 extended profile + `employees.view_sensitive` / `edit_sensitive` |
