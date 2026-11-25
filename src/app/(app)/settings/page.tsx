import { requirePagePermission } from "@/lib/authz";
import { PageHeader } from "@/components/ui";
import { NameList } from "./name-list";
import { BannerUpload } from "./banner-upload";

export default async function SettingsPage() {
  await requirePagePermission("org.structure");
  return (
    <>
      <PageHeader title="Organization structure" description="Company branding, and the departments and designations your employees are assigned to." />
      <BannerUpload />
      <div className="grid gap-6 lg:grid-cols-2">
        <NameList title="Departments" endpoint="/api/departments" />
        <NameList title="Designations" endpoint="/api/designations" />
      </div>
    </>
  );
}
