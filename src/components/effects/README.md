# Effects

Animated components from three libraries, adjusted for this app. Each file starts with a credit line.

- **Magic UI** (MIT license, https://magicui.design): `number-ticker`, `animated-list`, `border-beam`,
  `animated-beam`, `blur-fade`, `dot-pattern`, `animated-circular-progress-bar` (through `gauge.tsx`),
  `terminal`, and `confetti.ts` (a wrapper around canvas-confetti, the way Magic UI's confetti works).
- **React Bits** (MIT plus Commons Clause, https://reactbits.dev): `dot-grid` (WebGL), `count-up`,
  `decrypted-text`, `status-mark`, `spotlight-card`, `stepper`. They may be used inside this app, but
  the components themselves must never be sold or redistributed (not even as a pack in a public
  repository). Unchanged copies carry a commented `// @ts-nocheck` for this app's strict TypeScript.
- **Aceternity UI** components are not here: they are installed through the `@aceternity` shadcn
  registry into `src/components/ui/` (`bento-grid`, `timeline`, `spotlight-new`) and
  `src/components/landing/features-section.tsx`.

Changes from the originals: colors use the app's theme tokens (`var(--primary)` and friends) so they
follow light and dark mode; canvas and WebGL effects read colors through `theme-color.ts`, which turns
an OKLCH theme variable into hex. Every effect has a still version with "reduce motion" set in the
operating system: numbers and text show their final value at once, content appears without movement,
and moving borders, beams, spotlights and the WebGL background are left out (a plain dot pattern
stands in for the background). `MotionConfig reducedMotion="user"` in `providers.tsx` covers the rest.

Rule of thumb: motion reports something real (a number changed, a run is being worked on, a question
resolved). At most one moving thing per area of the screen. Never animate the Pass / Fail buttons, the
evidence a person reads before answering, the check result, or cost figures.

All of them are on the development page `/dev/effects`, checked by `e2e/effects.mjs` with and without
reduced motion.
