# Screens

Back to the [overview](README.md). Built on Astryx with the Cyanotype theme, and AskWithAI's web kit (`@askwithai/react`).

| Route | Contents |
|---|---|
| `/` | What PullUp does and the three adoption steps |
| `/login` | Email and password; the first account owns this PullUp |
| `/runs` | One row per commit: the check result, mode, concerns with their answers, who decided, cost, a SIMULATED badge on demo answers |
| `/runs/[id]` | CI attempts, hard failures, each concern with its answer, the rule's reading and checked quotes, the agent's steps, and the commit's decisions in AskWithAI (`DecisionFeed` filtered by the head commit) |
| `/decisions` | The kit's decision feed and inspector (receipt, timeline, report what really happened) |
| `/reviews` | The kit's keyboard review queue, including input requests |
| `/quality` | Run counts, the serving-mode control, the quality panel and the shadow comparison; Demo controls in demo mode |
| `/settings` | The decision provider (which one, the base address, whether a key is set, the last call), and each repository's check mode |

The kit talks to `/api/askwithai/[...path]`, which forwards only the kit's allow-listed calls for `PULLUP_RUNTIME`, and only for a signed-in user; the AskWithAI key never reaches the browser. Without AskWithAI configured, the kit screens say how to connect it.
