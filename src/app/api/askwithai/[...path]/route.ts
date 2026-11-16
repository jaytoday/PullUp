import { createAskWithAIHandler, type KitAction } from "@askwithai/react/server";
import { auth } from "@/lib/auth";
import { runtimeRef } from "@/server/decide/askwithai";

/**
 * The web kit's server route. The browser never holds the AskWithAI key: it
 * calls this route, which forwards only the kit's allow-listed calls for
 * PullUp's runtime, and only for a signed-in PullUp user.
 */

type Ctx = { params: Promise<{ path?: string[] }> };
type Handler = (req: Request, ctx: Ctx) => Promise<Response>;

let handler: ReturnType<typeof createAskWithAIHandler> | null = null;
function get(): ReturnType<typeof createAskWithAIHandler> | null {
  const apiKey = process.env.ASKWITHAI_API_KEY?.trim();
  const runtime = runtimeRef();
  if (!apiKey || !runtime) return null;
  handler ??= createAskWithAIHandler({
    apiKey,
    baseUrl: process.env.ASKWITHAI_URL?.trim() || undefined,
    runtimes: [runtime],
    // Any signed-in PullUp user may read, review, report outcomes and change the serving mode.
    authorize: async (req: Request, _action: KitAction) => !!(await auth.api.getSession({ headers: req.headers })),
  });
  return handler;
}

const notConfigured = () => Response.json({ error: { code: "not_configured", message: "AskWithAI is not configured: set ASKWITHAI_API_KEY and PULLUP_RUNTIME." } }, { status: 503 });
const route =
  (method: "GET" | "POST" | "PATCH"): Handler =>
  (req, ctx) => {
    const h = get();
    return h ? h[method](req, ctx) : Promise.resolve(notConfigured());
  };

export const GET = route("GET");
export const POST = route("POST");
export const PATCH = route("PATCH");
