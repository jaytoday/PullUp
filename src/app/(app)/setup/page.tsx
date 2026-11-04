import { DashboardPanel, PageBody } from "@/components/app-shell/dashboard-panel";
import { SetupWizard } from "@/components/setup/setup-wizard";

export const metadata = { title: "Set up a repo" };

export default function SetupPage() {
  const slug = process.env.GITHUB_APP_SLUG?.trim();
  return (
    <DashboardPanel title="Set up a repository">
      <PageBody className="max-w-2xl">
        <SetupWizard appInstallUrl={slug ? `https://github.com/apps/${slug}/installations/new` : null} />
      </PageBody>
    </DashboardPanel>
  );
}
