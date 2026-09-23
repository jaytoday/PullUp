/** PullUp mark: a "P" stroke rising into a merge dot. */
export function Logo(props: { class?: string }) {
  return (
    <span class={`inline-flex items-center gap-2 ${props.class ?? ""}`}>
      <svg viewBox="0 0 32 32" class="size-7" aria-hidden="true">
        <rect width="32" height="32" rx="6" fill="var(--secondary)" stroke="var(--border)" />
        <path d="M10 22V10h6.5a4 4 0 0 1 0 8H14" fill="none" stroke="var(--primary)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" />
        <circle cx="22.5" cy="22" r="2.4" fill="var(--clay)" />
      </svg>
      <span class="text-[15px] font-semibold tracking-tight">
        Pull<span class="text-primary">Up</span>
      </span>
    </span>
  );
}
