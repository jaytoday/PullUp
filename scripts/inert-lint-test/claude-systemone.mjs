// A stand-in System One server (POST /v1/systemone) that answers yes/no ("noul")
// questions by asking Claude for a probability. Test harness only: Claude's stated
// probability is not Jev's calibrated one.
//
// REASON_FIRST=1 asks Claude to write its reasoning before the probability. Off, the
// probability comes first, which is closer to a fast model that answers without reasoning.
import { createServer } from "node:http";
const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) throw new Error("Set ANTHROPIC_API_KEY.");
const MODEL = process.env.CLAUDE_MODEL ?? "claude-sonnet-5";
const PORT = Number(process.env.PORT ?? 8787);
const REASON_FIRST = process.env.REASON_FIRST === "1";

async function askProbability(state, instructions) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: REASON_FIRST ? 800 : 400,
      system:
        "You answer one yes/no question about a code change. Reply with only JSON: " +
        (REASON_FIRST
          ? '{"why": "<two or three sentences of reasoning first>", "p_yes": <number 0..1, your calibrated probability the answer is yes>}'
          : '{"p_yes": <number 0..1, your calibrated probability the answer is yes>, "why": "<one sentence>"}'),
      messages: [{ role: "user", content: `Question:\n${instructions}\n\nThe change:\n${state}` }],
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);
  const body = await res.json();
  const text = body.content.map((c) => c.text ?? "").join("");
  const m = text.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(m[0]);
  return { p: Math.min(1, Math.max(0, Number(parsed.p_yes))), why: parsed.why, tokens: body.usage.input_tokens };
}

createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", async () => {
    if (req.method !== "POST" || req.url !== "/v1/systemone") return res.writeHead(404).end();
    try {
      const body = JSON.parse(raw);
      const state = typeof body.state === "string" ? body.state : JSON.stringify(body.state, null, 2);
      const answers = {};
      let tokens = 0;
      for (const [id, q] of Object.entries(body.questions)) {
        if (q.type !== "noul") throw new Error(`only noul supported, got ${q.type}`);
        const a = await askProbability(state, q.instructions ?? q.text ?? "");
        answers[id] = { type: "noul", noul: a.p };
        tokens += a.tokens;
        const file = (state.match(/^(?:file|path)[:=]\s*(\S+)/im) ?? [])[1] ?? "?";
        console.log(JSON.stringify({ id, file, p: a.p, why: a.why }));
      }
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ model: body.model, answers, usage: { input_tokens: tokens } }));
    } catch (e) {
      console.error(e);
      res.writeHead(500).end(String(e));
    }
  });
}).listen(PORT, "127.0.0.1", () => console.error(`claude-systemone on :${PORT} model ${MODEL}${REASON_FIRST ? " (reasoning first)" : ""}`));
