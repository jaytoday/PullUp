import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { count } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";

const productionUrl = process.env.BETTER_AUTH_URL?.trim();

/**
 * Email and password sign-in. The first person to sign up owns this PullUp;
 * after that, sign-up is closed unless PULLUP_OPEN_SIGNUP=1.
 */
export const auth = betterAuth({
  baseURL: productionUrl,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: productionUrl ? [productionUrl] : undefined,
  database: drizzleAdapter(db, { provider: "sqlite", schema }),
  emailAndPassword: { enabled: true },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const [{ n }] = (await db.select({ n: count() }).from(schema.user)) as [{ n: number }];
          if (n > 0 && process.env.PULLUP_OPEN_SIGNUP !== "1") throw new APIError("FORBIDDEN", { message: "Sign-up is closed. Ask the owner of this PullUp for an account." });
          return { data: user };
        },
      },
    },
  },
});
