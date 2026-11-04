import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

/**
 * Sign-in gate for the dashboard. The landing page (/) and /login are public;
 * API routes check their own credentials (webhook signatures, the session).
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (pathname === "/" || pathname === "/login") return NextResponse.next();
  const session = await auth.api.getSession({ headers: request.headers });
  if (session) return NextResponse.next();
  const login = new URL("/login", request.url);
  login.searchParams.set("redirect", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!api/|_next/|favicon.ico|.*\\.(?:png|svg|jpg|jpeg|gif|webp|ico|txt|xml|json|webmanifest)$).*)"],
};
