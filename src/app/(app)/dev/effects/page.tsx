import { notFound } from "next/navigation";
import { DashboardPanel, PageBody } from "@/components/app-shell/dashboard-panel";
import { EffectsGallery } from "@/components/effects/effects-gallery";

/** Every animated effect in `src/components/effects`. Development builds only; used by `e2e/effects.mjs`. */
export default function EffectsGalleryPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <DashboardPanel title="Effects">
      <PageBody>
        <EffectsGallery />
      </PageBody>
    </DashboardPanel>
  );
}
