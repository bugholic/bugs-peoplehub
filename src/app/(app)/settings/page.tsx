import { requirePagePermission } from "@/lib/authz";
import { PageHeader } from "@/components/ui";
import { NameList } from "./name-list";
import { BannerUpload } from "./banner-upload";
import { TimeZoneSetting } from "./time-zone-setting";
import { WeekOffSetting } from "./week-off-setting";

export default async function SettingsPage() {
  await requirePagePermission("org.structure");
  return (
    <>
      <PageHeader title="Organization structure" description="Company branding, time zone, weekly off, and the departments and designations your employees are assigned to." />
      <BannerUpload />
      <TimeZoneSetting />
      <WeekOffSetting />
      <div className="grid gap-6 lg:grid-cols-2">
        <NameList title="Departments" endpoint="/api/departments" />
        <NameList title="Designations" endpoint="/api/designations" />
      </div>
    </>
  );
}
