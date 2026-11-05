import { describeExtensions } from "@pullup/engine";
import { NextResponse } from "next/server";

/**
 * The bundled extensions: id, title, summary, version, default mode, the JSON
 * Schema of each one's config section and its settings (with which ones
 * loosen PullUp). Public: it describes PullUp, not any repository.
 */
export function GET() {
  return NextResponse.json({ extensions: describeExtensions() });
}
