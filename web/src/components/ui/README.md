# ui/ — nikala-ui components (owned copies)

Copied from nikala-ui (`packages/core/src/registry/components/ui`, hooks from
`packages/hooks/src`) at upstream commit `de14630` (github.com/nikala-ui/ui, MIT).
Copy-paste ownership: only what the app uses is kept (button, badge, card,
table, toggle-group, sheet, scroll-area, command + input-group/list/kbd,
tooltip, toast, callout, empty, skeleton, spinner). Edit freely here, and
re-diff against upstream when upgrading. Kit rules still apply: `splitProps` (never destructure props),
semantic tokens only, `rounded-lg` maximum radius.

Local modifications (keep when re-syncing):
- `command.tsx`: `CommandDialog` focuses the search input on open; typing highlights the first match.
