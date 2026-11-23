import { redirect } from "next/navigation";
import { requirePageSession } from "@/lib/authz";
import { PageHeader } from "@/components/ui";
import { NameList } from "./name-list";

export default async function SettingsPage() {
  const session = await requirePageSession();
  if (session.role !== "ADMIN") redirect("/dashboard");
  return (
    <>
      <PageHeader title="Organization structure" description="Departments and designations your employees are assigned to." />
      <div className="grid gap-6 lg:grid-cols-2">
        <NameList title="Departments" endpoint="/api/departments" />
        <NameList title="Designations" endpoint="/api/designations" />
      </div>
    </>
  );
}
