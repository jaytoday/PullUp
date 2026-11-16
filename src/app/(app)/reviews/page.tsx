import { ReviewsScreen } from "@/components/kit/kit-pages";
import { Heading } from "@/components/kit/server-safe";
import { connectionStatus } from "@/server/connection";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reviews" };

export default async function ReviewsPage() {
  const s = await connectionStatus();
  return (
    <>
      <Heading title="Reviews" description="Concerns the runtime sent to a person, and facts a decision is waiting for. Keyboard: 1 or 2 picks an answer, r for a reason, Enter settles. Reviewers can also press Pass or Fail on the GitHub check, or comment /pullup pass or /pullup fail." />
      <ReviewsScreen runtime={s.kitReady ? s.runtime : null} />
    </>
  );
}
