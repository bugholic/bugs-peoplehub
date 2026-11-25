/**
 * Permission catalog for custom access roles.
 *
 * Modeled on the access-control split common to HRMS products (Zoho People, BambooHR,
 * Keka, Darwinbox): employee self-service is always on for every member, and roles
 * layer on top of it with "team" scope (people who report to you) and "organization"
 * scope (everyone) per module, plus admin-only configuration rights.
 *
 * Every key here is enforced by an API route; there are no decorative checkboxes.
 * Shared by server and client code, so keep it free of server-only imports.
 */

export type PermissionDef = { key: string; label: string; description: string };
export type PermissionGroup = { id: string; label: string; permissions: readonly PermissionDef[] };

export const PERMISSION_GROUPS = [
  {
    id: "employees",
    label: "Employees",
    permissions: [
      { key: "employees.view_inactive", label: "View deactivated employees", description: "Include inactive people when browsing the directory." },
      { key: "employees.create", label: "Add employees", description: "Create new employee records." },
      { key: "employees.edit", label: "Edit employee profiles", description: "Change anyone's details, department, manager, location and photo." },
      { key: "employees.deactivate", label: "Deactivate employees", description: "Mark an employee as inactive (offboarding)." },
    ],
  },
  {
    id: "leave",
    label: "Leave",
    permissions: [
      { key: "leave.approve_team", label: "Approve team leave", description: "See balances and approve or reject leave for direct reports." },
      { key: "leave.approve_all", label: "Approve leave for everyone", description: "See balances and decide leave requests across the organization." },
      { key: "leave.manage_types", label: "Manage leave types", description: "Create leave types and set their annual quotas." },
      { key: "holidays.manage", label: "Manage holiday calendar", description: "Add and remove company holidays." },
    ],
  },
  {
    id: "attendance",
    label: "Attendance",
    permissions: [
      { key: "attendance.approve_team", label: "Manage team attendance", description: "View direct reports' attendance and decide their regularizations." },
      { key: "attendance.approve_all", label: "Manage everyone's attendance", description: "View anyone's attendance and decide any regularization." },
      { key: "attendance.remote_approve", label: "Approve remote work", description: "Review and decide remote work requests." },
      { key: "attendance.report_team", label: "Team attendance report", description: "Monthly report and CSV export for direct reports." },
      { key: "attendance.report_all", label: "Organization attendance report", description: "Monthly report and CSV export for all employees." },
      { key: "attendance.manage_locations", label: "Manage office locations", description: "Add or edit offices and their check-in geofence." },
    ],
  },
  {
    id: "organization",
    label: "Organization",
    permissions: [
      { key: "org.structure", label: "Manage departments, designations & branding", description: "Add and remove departments and job titles, and set the company banner." },
      { key: "org.members", label: "Manage members", description: "Add existing users to the organization and manage memberships." },
    ],
  },
] as const satisfies readonly PermissionGroup[];

export type Permission = (typeof PERMISSION_GROUPS)[number]["permissions"][number]["key"];

export const ALL_PERMISSIONS: Permission[] = PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.key));

const KNOWN = new Set<string>(ALL_PERMISSIONS);
export const isPermission = (k: string): k is Permission => KNOWN.has(k);

/** Drops keys that aren't in the catalog (e.g. a permission removed in a later release) and de-dupes. */
export const sanitizePermissions = (keys: readonly string[]): Permission[] => [...new Set(keys.filter(isPermission))];

/** Things every member can do regardless of role (employee self-service). Shown in the role editor for clarity. */
export const SELF_SERVICE = [
  "View the employee directory and org chart",
  "Edit their own phone number and photo",
  "Apply for and cancel their own leave",
  "Check in / out and request attendance regularization",
];

export type RolePreset = { id: string; label: string; description: string; permissions: Permission[] };

/** Starting points in the role editor; the admin can tick/untick from there. */
export const ROLE_PRESETS: RolePreset[] = [
  { id: "employee", label: "Employee", description: "Self-service only", permissions: [] },
  {
    id: "manager",
    label: "Manager",
    description: "Approves and reports on their direct reports",
    permissions: ["leave.approve_team", "attendance.approve_team", "attendance.report_team"],
  },
  {
    id: "hr",
    label: "HR",
    description: "Runs people operations across the organization",
    permissions: [
      "employees.view_inactive",
      "employees.create",
      "employees.edit",
      "employees.deactivate",
      "leave.approve_team",
      "leave.approve_all",
      "leave.manage_types",
      "holidays.manage",
      "attendance.approve_team",
      "attendance.approve_all",
      "attendance.remote_approve",
      "attendance.report_team",
      "attendance.report_all",
      "org.structure",
    ],
  },
  { id: "all", label: "All permissions", description: "Everything except role management", permissions: ALL_PERMISSIONS },
];

const preset = (id: string) => ROLE_PRESETS.find((p) => p.id === id)!.permissions;

/**
 * Permissions for someone with no custom role assigned, from their Clerk org role.
 * Mirrors what each Clerk role could do before custom roles existed.
 */
export function defaultPermissions(clerkRole: "ADMIN" | "MANAGER" | "EMPLOYEE"): Permission[] {
  if (clerkRole === "ADMIN") return ALL_PERMISSIONS;
  if (clerkRole === "MANAGER") return preset("manager");
  return preset("employee");
}
