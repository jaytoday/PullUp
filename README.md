# PullUp

A CI decision agent built on AskWithAI. After a pull request's CI finishes, PullUp posts one GitHub check called **PullUp**:

1. **Something really broke → fail.** Plain code, no model call.
2. **Nothing tricky → pass.** Plain code, no model call.
3. **Something needs judgment → ask.** A small agent gathers the evidence and asks a decision runtime whether each concern (a flaky retry, deleted tests, a sensitive change) is risky or safe. A fixed rule turns the typed answers into the check; a reviewer decides when it matters.

PullUp is also the worked example of adopting AskWithAI in three steps: change the base address, watch in shadow, go active.

**Start here: [docs/README.md](docs/README.md).** The adoption runbook is [docs/adopting-askwithai.md](docs/adopting-askwithai.md).

## Quick start (demo mode, no GitHub App, no model keys)

```bash
pnpm install
cp .env.example .env.local          # set BETTER_AUTH_SECRET and PULLUP_PERMIT_KEY; PULLUP_DEMO=1
pnpm dev                            # http://localhost:3500, create the first account
pnpm test
```

With a local AskWithAI running, `pnpm demo` plays the whole adoption story on synthetic pull requests. See [docs/demo.md](docs/demo.md).
