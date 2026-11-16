# Results: three ways to decide

Back to the [overview](README.md). Written by `pnpm demo:compare` on 2026-11-16.

> **Simulated engines.** Shows how the system behaves, not how good real models are. Every case is synthetic (from `pnpm generate-data`) and every answer came from AskWithAI's demo engines.

| Split | Configuration | Cases | Accuracy | Expected loss per 1,000 | Compute cost per 1,000 | Escalation | Average latency |
|---|---|---|---|---|---|---|---|
| holdout | Decision model only | 183 | 91.8% | $2049 | $0.0000 | 0.0% | 9 ms |
| holdout | Reasoning model on everything | 183 | 94.0% | $1503 | $0.0000 | 100.0% | 8 ms |
| holdout | AskWithAI routed | 183 | 94.0% | $1503 | $0.0000 | 100.0% | 11 ms |
| hard | Decision model only | 50 | 72.0% | $43600 | $0.0000 | 0.0% | 8 ms |
| hard | Reasoning model on everything | 50 | 100.0% | $0 | $0.0000 | 100.0% | 8 ms |
| hard | AskWithAI routed | 50 | 86.0% | $3500 | $0.0000 | 100.0% | 10 ms |

- **Expected loss** is the main number: the runtime's own mistake costs (a wrong "safe" costs $25 plus $2 per changed line in sensitive paths; a wrong "risky" costs $4) summed over the cases, per 1,000.
- **Decision model only** is the fast tier's own answer (parity). **Reasoning model on everything** uses only the reasoning tier. **AskWithAI routed** starts with the fast tier and escalates when a mistake would cost more than asking; the person tier is off so the three are compared on models alone.
- The **hard** split holds cases whose wording points the wrong way. AskWithAI's own first measured run met its expected-loss goal on the standard holdout but not on the hard split, so both are reported.
