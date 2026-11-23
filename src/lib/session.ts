export type Role = "ADMIN" | "MANAGER" | "EMPLOYEE";

/** The app-level identity: a Clerk user resolved to a local User/Employee row. */
export type Session = {
  userId: string;
  employeeId: string;
  role: Role;
  name: string;
};
