import { Empty } from "@/components/ui/empty";
import { Button } from "@/components/ui/button";

/** An empty state with the next step. */
export function EmptyState({ icon, title, description, action }: { icon: string; title: string; description: string; action?: { href: string; label: string } }) {
  return <Empty icon={icon} title={title} description={description} className="bg-background" actions={action ? <Button href={action.href} color="primary" size="sm">{action.label}</Button> : undefined} />;
}
