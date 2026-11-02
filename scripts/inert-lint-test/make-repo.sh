#!/bin/bash
# Builds a small shop app repo with one branch per labeled case.
# Usage: make-repo.sh <target folder> <rule file>. Branch names starting with
# "inert-" are expected to pass the rule; every other branch is expected to fail it.
set -e
R=$1; RULE=$2; rm -rf $R; mkdir -p $R/src $R/.agents/gallant; cd $R
git init -q -b main
cat > src/flags.ts <<'X'
// Feature flags. Everything defaults to off; ops turns flags on per environment.
const defaults: Record<string, boolean> = {
  newSearch: false,
};
export function isEnabled(name: string): boolean {
  return process.env[`FLAG_${name.toUpperCase()}`] === "1" || defaults[name] === true;
}
X
cat > src/pricing.ts <<'X'
export interface Line { sku: string; unitCents: number; qty: number }
export function subtotal(lines: Line[]): number {
  return lines.reduce((sum, l) => sum + l.unitCents * l.qty, 0);
}
export function tax(cents: number): number {
  return Math.round(cents * 0.08);
}
export function total(lines: Line[]): number {
  const s = subtotal(lines);
  return s + tax(s);
}
X
cat > src/checkout.ts <<'X'
import { total, type Line } from "./pricing";
import { db } from "./db";
export async function checkout(userId: string, lines: Line[]) {
  const cents = total(lines);
  await db.insert("orders", { userId, cents });
  return { cents };
}
X
cat > src/db.ts <<'X'
export const db = {
  async insert(table: string, row: Record<string, unknown>) { /* writes a row */ },
  async update(table: string, where: Record<string, unknown>, set: Record<string, unknown>) { /* updates rows */ },
};
X
cat > src/server.ts <<'X'
import express from "express";
import { checkout } from "./checkout";
export const app = express();
app.post("/checkout", async (req, res) => res.json(await checkout(req.body.userId, req.body.lines)));
X
cp "$RULE" .agents/gallant/flag-off-behavior.md
git add -A && git commit -qm base

case_branch() { git checkout -q main; git checkout -q -b "$1"; }

# --- expected NO (inert) ---
case_branch inert-gated-discount
cat > src/discount.ts <<'X'
import type { Line } from "./pricing";
// Bulk discount: 10% off lines with 10 or more units.
export function bulkDiscount(lines: Line[]): number {
  return lines.filter((l) => l.qty >= 10).reduce((s, l) => s + Math.round(l.unitCents * l.qty * 0.1), 0);
}
X
cat > src/checkout.ts <<'X'
import { total, type Line } from "./pricing";
import { db } from "./db";
import { isEnabled } from "./flags";
import { bulkDiscount } from "./discount";
export async function checkout(userId: string, lines: Line[]) {
  let cents = total(lines);
  if (isEnabled("bulkDiscount")) cents -= bulkDiscount(lines);
  await db.insert("orders", { userId, cents });
  return { cents };
}
X
cat > src/flags.ts <<'X'
// Feature flags. Everything defaults to off; ops turns flags on per environment.
const defaults: Record<string, boolean> = {
  newSearch: false,
  bulkDiscount: false,
};
export function isEnabled(name: string): boolean {
  return process.env[`FLAG_${name.toUpperCase()}`] === "1" || defaults[name] === true;
}
X
git add -A && git commit -qm "Add bulk discount behind bulkDiscount flag"

case_branch inert-gated-route-handler
cat > src/server.ts <<'X'
import express from "express";
import { checkout } from "./checkout";
import { isEnabled } from "./flags";
export const app = express();
app.post("/checkout", async (req, res) => res.json(await checkout(req.body.userId, req.body.lines)));
if (isEnabled("orderHistory")) {
  app.get("/orders", async (_req, res) => res.json([]));
}
X
git add -A && git commit -qm "Add order history route behind flag"

case_branch inert-kill-switch
cat > src/checkout.ts <<'X'
import { total, type Line } from "./pricing";
import { db } from "./db";
import { isEnabled } from "./flags";
export async function checkout(userId: string, lines: Line[]) {
  const cents = total(lines);
  if (!isEnabled("disableOrderWrites")) await db.insert("orders", { userId, cents });
  return { cents };
}
X
git add -A && git commit -qm "Add kill switch for order writes"

# --- expected YES (not inert) ---
case_branch leak-shared-tax
cat > src/pricing.ts <<'X'
export interface Line { sku: string; unitCents: number; qty: number }
export function subtotal(lines: Line[]): number {
  return lines.reduce((sum, l) => sum + l.unitCents * l.qty, 0);
}
export function tax(cents: number): number {
  return Math.ceil(cents * 0.0825);
}
export function total(lines: Line[]): number {
  const s = subtotal(lines);
  return s + tax(s);
}
X
cat > src/checkout.ts <<'X'
import { total, type Line } from "./pricing";
import { db } from "./db";
import { isEnabled } from "./flags";
export async function checkout(userId: string, lines: Line[]) {
  const cents = total(lines);
  await db.insert("orders", { userId, cents, ...(isEnabled("taxV2") ? { taxVersion: 2 } : {}) });
  return { cents };
}
X
git add -A && git commit -qm "Tax v2 behind taxV2 flag"

case_branch inverted-check
cat > src/checkout.ts <<'X'
import { total, type Line } from "./pricing";
import { db } from "./db";
import { isEnabled } from "./flags";
export async function checkout(userId: string, lines: Line[]) {
  const cents = total(lines);
  if (!isEnabled("skipOrderAudit")) await db.insert("order_audit", { userId, cents, at: Date.now() });
  await db.insert("orders", { userId, cents });
  return { cents };
}
X
git add -A && git commit -qm "Add order audit log, gated by skipOrderAudit"

case_branch startup-side-effect
cat > src/warmup.ts <<'X'
import { db } from "./db";
// Pre-computes the search index for the new search experience.
setInterval(() => { void db.update("search_index", {}, { rebuiltAt: Date.now() }); }, 60_000);
export {};
X
cat > src/server.ts <<'X'
import express from "express";
import { checkout } from "./checkout";
import { isEnabled } from "./flags";
import "./warmup";
export const app = express();
app.post("/checkout", async (req, res) => res.json(await checkout(req.body.userId, req.body.lines)));
app.get("/search", async (req, res) => {
  if (!isEnabled("newSearch")) return res.status(404).end();
  res.json({ results: [] });
});
X
git add -A && git commit -qm "New search behind newSearch flag"

case_branch data-backfill
cat > src/checkout.ts <<'X'
import { total, type Line } from "./pricing";
import { db } from "./db";
import { isEnabled } from "./flags";
export async function checkout(userId: string, lines: Line[]) {
  const cents = total(lines);
  await db.insert("orders", { userId, cents, currency: "USD" });
  await db.update("users", { id: userId }, { lastOrderCents: cents });
  if (isEnabled("multiCurrency")) return { cents, currency: "USD" };
  return { cents };
}
X
git add -A && git commit -qm "Multi-currency groundwork behind multiCurrency flag"

case_branch flag-default-on
sed -i.bak 's/  newSearch: false,/  newSearch: true,/' src/flags.ts && rm -f src/flags.ts.bak
git add -A && git commit -qm "Enable new search"

git checkout -q main
