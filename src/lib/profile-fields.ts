/**
 * Extended employee profile fields (docs/TODO.md T20/T21). Pure and client-safe: the single
 * catalog the form, the API's per-section permission check and the validators all build on.
 * Values live in the EmployeeProfile table (src/lib/employee-profile.ts).
 */

export const PROFILE_SECTIONS = ["personal", "emergency", "employment", "sensitive"] as const;
export type ProfileSection = (typeof PROFILE_SECTIONS)[number];

export const SECTION_LABELS: Record<ProfileSection, { title: string; description: string }> = {
  personal: { title: "Personal", description: "Visible to the employee, their manager and HR." },
  emergency: { title: "Emergency contact", description: "Visible to the employee, their manager and HR." },
  employment: { title: "Employment", description: "Visible to the employee, their manager and HR; edited by HR." },
  sensitive: { title: "Identity & bank", description: "Visible only to the employee and people with access to sensitive details; edited by HR." },
};

export const GENDERS = ["MALE", "FEMALE", "OTHER", "UNDISCLOSED"] as const;
export const MARITAL_STATUSES = ["SINGLE", "MARRIED", "DIVORCED", "WIDOWED", "UNDISCLOSED"] as const;
export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;
export const EMPLOYMENT_TYPES = ["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN", "CONSULTANT"] as const;

export type FieldKind = "text" | "textarea" | "email" | "phone" | "date" | "number" | "select";

export type ProfileField = {
  key: ProfileFieldKey;
  section: ProfileSection;
  label: string;
  kind: FieldKind;
  options?: readonly string[];
  placeholder?: string;
  /** Shown masked (last 4) until revealed. */
  masked?: boolean;
};

export type ProfileFieldKey =
  | "dateOfBirth"
  | "gender"
  | "maritalStatus"
  | "bloodGroup"
  | "nationality"
  | "personalEmail"
  | "currentAddress"
  | "permanentAddress"
  | "emergencyName"
  | "emergencyRelation"
  | "emergencyPhone"
  | "employmentType"
  | "probationEndDate"
  | "noticePeriodDays"
  | "panNumber"
  | "aadhaarNumber"
  | "passportNumber"
  | "bankAccountName"
  | "bankName"
  | "bankAccountNumber"
  | "bankIfsc";

export const PROFILE_FIELDS: readonly ProfileField[] = [
  { key: "dateOfBirth", section: "personal", label: "Date of birth", kind: "date" },
  { key: "gender", section: "personal", label: "Gender", kind: "select", options: GENDERS },
  { key: "maritalStatus", section: "personal", label: "Marital status", kind: "select", options: MARITAL_STATUSES },
  { key: "bloodGroup", section: "personal", label: "Blood group", kind: "select", options: BLOOD_GROUPS },
  { key: "nationality", section: "personal", label: "Nationality", kind: "text" },
  { key: "personalEmail", section: "personal", label: "Personal email", kind: "email" },
  { key: "currentAddress", section: "personal", label: "Current address", kind: "textarea" },
  { key: "permanentAddress", section: "personal", label: "Permanent address", kind: "textarea" },

  { key: "emergencyName", section: "emergency", label: "Contact name", kind: "text" },
  { key: "emergencyRelation", section: "emergency", label: "Relationship", kind: "text", placeholder: "e.g. Spouse" },
  { key: "emergencyPhone", section: "emergency", label: "Contact phone", kind: "phone" },

  { key: "employmentType", section: "employment", label: "Employment type", kind: "select", options: EMPLOYMENT_TYPES },
  { key: "probationEndDate", section: "employment", label: "Probation ends", kind: "date" },
  { key: "noticePeriodDays", section: "employment", label: "Notice period (days)", kind: "number" },

  { key: "panNumber", section: "sensitive", label: "PAN", kind: "text", placeholder: "ABCDE1234F", masked: true },
  { key: "aadhaarNumber", section: "sensitive", label: "Aadhaar", kind: "text", placeholder: "12 digits", masked: true },
  { key: "passportNumber", section: "sensitive", label: "Passport", kind: "text", masked: true },
  { key: "bankAccountName", section: "sensitive", label: "Account holder", kind: "text" },
  { key: "bankName", section: "sensitive", label: "Bank", kind: "text" },
  { key: "bankAccountNumber", section: "sensitive", label: "Account number", kind: "text", masked: true },
  { key: "bankIfsc", section: "sensitive", label: "IFSC", kind: "text", placeholder: "HDFC0001234" },
];

export const sectionOf = (key: string): ProfileSection | undefined => PROFILE_FIELDS.find((f) => f.key === key)?.section;

export type SectionAccess = { view: Record<ProfileSection, boolean>; edit: Record<ProfileSection, boolean> };

/**
 * Who may see and change each group of fields (T21), from three facts about the viewer:
 *  - self: it's their own profile;
 *  - manager: they're the employee's direct manager;
 *  - perms: their permission keys.
 * personal / emergency: self, manager, `employees.edit` see them; self and `employees.edit` change them.
 * employment: same viewers; only `employees.edit` changes it.
 * sensitive (identity + bank): self and `employees.view_sensitive` see it; only `employees.edit_sensitive` changes it
 * (so an employee can't redirect their own salary). Editing needs viewing.
 */
export function sectionAccess({ self, manager, perms }: { self: boolean; manager: boolean; perms: readonly string[] }): SectionAccess {
  const has = (p: string) => perms.includes(p);
  const hr = has("employees.edit");
  const general = self || manager || hr;
  const view: SectionAccess["view"] = {
    personal: general,
    emergency: general,
    employment: general,
    sensitive: self || has("employees.view_sensitive") || has("employees.edit_sensitive"),
  };
  const edit: SectionAccess["edit"] = {
    personal: self || hr,
    emergency: self || hr,
    employment: hr,
    sensitive: has("employees.edit_sensitive"),
  };
  for (const s of PROFILE_SECTIONS) edit[s] = edit[s] && view[s];
  return { view, edit };
}

/** "XXXXXXXX1234": all but the last 4 characters hidden. */
export function maskTail(value: string, keep = 4): string {
  return value.length <= keep ? value : "X".repeat(value.length - keep) + value.slice(-keep);
}
