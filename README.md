# PullUp

A pull-request decision system built on the AskWithAI Decision Runtime platform.

After your CI finishes, PullUp posts one GitHub check called **PullUp**:

1. **Something really broke → fail.** No AI is called.
2. **Nothing tricky → pass.** No AI is called.
3. **Something needs judgment → ask.** A configured AskWithAI runtime answers a typed question with
   supporting citations. PullUp verifies the evidence, applies its fixed rules, and asks a person when
   the result is unclear.

Every repository starts in **Shadow mode** (the check never blocks a merge and says what PullUp would
decide) until the owner makes it Active. What PullUp looks for comes from **extensions** you switch
Off, to Shadow or Active.

**Start here: [docs/README.md](docs/README.md)**, a one-page overview that links to everything else.

## Quick start

```bash
pnpm install
pnpm seed          # a development database with example runs and an owner account
pnpm dev           # http://localhost:3500 — sign in as owner@example.com / pullup-dev-password
pnpm test
```

Setting up `.env`, GitHub and all the checks: [docs/running-and-testing.md](docs/running-and-testing.md).

## Libraries with conditions

The animated components in `src/components/effects` include copies from React Bits, whose license
allows using them inside this app but not selling or redistributing the components themselves. See
`src/components/effects/README.md`.
