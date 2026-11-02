---
appliesTo: "*.ts"
type: noul
minConfidence: 0.3
---
This change is meant to be inert on deployment: its new behavior should only run when a
feature flag is turned on (flags are read with `isEnabled("<name>")` from `src/flags.ts`,
and every flag defaults to off).

Compare what the code did before this change with what it does after, with every feature
flag off. Does anything differ that runs, or that a user, another service or the database
could observe?

Count as "yes": changed behavior outside the flag check; new code that runs when the flag
is off (for example under `if (!isEnabled(...))`, even when the flag is meant to switch it
off later); code that runs when the module is loaded or the server starts; routes or jobs
registered unconditionally; data written or reshaped regardless of the flag; an
always-true flag check; and a flag whose default is changed to on.

Count as "no": new code reachable only when a flag is on; code that ran before and still
runs the same way with flags off (for example existing code newly wrapped in a "disable"
flag); tests, comments, and type-only changes.
