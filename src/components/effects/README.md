# Effects

Small animated components copied from Magic UI (MIT license, https://magicui.design) and adjusted for
this app. React Bits (https://reactbits.dev) is deliberately not used here: its license forbids
redistributing its components, and this repository's code may be shared.

Each file starts with a credit line naming its source. Changes from the originals:

- Colors use the app's theme tokens (`var(--primary)` and friends), so they follow light and dark mode.
- Every effect has a still version for people who set "reduce motion" in their operating system
  (`useReducedMotion` in `src/hooks/use-reduced-motion.ts`): numbers show their final value at once,
  content appears without movement, and moving borders and beams are left out.

Rule of thumb: motion should report something real (a number changed, a run started, a step finished).
At most one moving thing per area of the screen. Never animate money, approval buttons or text a person
must read carefully before acting. All of them are shown on the development page `/dev/effects`.
