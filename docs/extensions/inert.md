# `inert`: is this change switched off behind a flag?

([Back to extensions](README.md))

An author can claim a change is **inert**: its new behavior only runs once a feature flag is turned
on. They add the label `pullup:inert`, or a line in the description:

```
PullUp-Inert: flag=newCheckout
```

"Inert" argues a change is safer, and PullUp never lets a model make a run easier on its own, so
PullUp tries to **disprove** the claim:

1. **Code first.** Any of these disproves it:
   - a migration, dependency, CI or infrastructure change;
   - a flag added, or changed, to on in a flag file;
   - an added line matching a startup pattern from the settings;
   - new code under a negated flag check (`if (!isEnabled(...))`): it runs while the flag is off.
     Existing code newly wrapped in one (a kill switch) is fine, and so is an early `return`;
   - new code in a file with no flag check at all.
2. **Then one [screen](screens.md) per changed code file:** "with every flag off, does anything
   differ?" Leaning "yes" more than `maxP` (default 0.3) disproves it.
3. **The result** is `verified`, `disproved` or `unclear` (something was not checked), shown as a note
   and shared with other extensions as a fact.

By default the result changes nothing else. With `relaxSensitiveWhenInert` on (a loosening), a verified
change lets the AskWithAI runtime pass the core sensitive-path question alone. With `askWhenDisproved` on, a
disproved claim asks a person.

**Turning a flag on** (an "on" line added in a flag file, or any change to a rollout file) is always a
question only a person may answer, claim or not.

## Settings

`label`, `flagFiles`, `rolloutFiles`, `gatePatterns` (how flag checks look in code), `startupPatterns`,
`maxP`, `askWhenDisproved`, `relaxSensitiveWhenInert`.

## Tested on

The eight labeled cases from the earlier inert-check test are fixtures (`fixtures/inert-*.json`). Code
alone disproves four of them whatever a model says, including new code under a negated check (the
case a model answering without reasoning had missed), and does not disprove the kill switch. The other
four depend on the screens and have not yet been measured live.
