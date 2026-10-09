#!/usr/bin/env node
/**
 * Fails if the underlying telephony provider's name appears anywhere a
 * customer could see it: browser bundles, public assets, web UI source,
 * or customer-facing strings in core. Provider specifics are allowed only in
 * the server-side adapter, env/config docs and this checker.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const NAME = new RegExp(["pl", "ivo"].join(""), "i");
const ALLOWED = [
  "packages/core/src/telephony/adapters/",
  "packages/core/src/telephony.ts",
  "docs/internal/",
  "scripts/check-brand-leaks.mjs",
  ".env.example",
];
const SCAN = ["apps/web/src", "apps/web/public", "apps/web/.next/static", "apps/web/.next/server/app", "packages/core/src", "apps/voice/src", "README.md", "docs"];
const SKIP_DIR = new Set(["node_modules", ".git", "cache"]);
const TEXT = /\.(m?[jt]sx?|css|html|json|md|txt|svg|rsc|body|meta)$/;

const hits = [];
function walk(p) {
  if (!existsSync(p)) return;
  const st = statSync(p);
  if (st.isDirectory()) {
    for (const f of readdirSync(p)) if (!SKIP_DIR.has(f)) walk(join(p, f));
    return;
  }
  const rel = relative(root, p);
  if (ALLOWED.some((a) => rel.startsWith(a)) || !TEXT.test(p) || st.size > 8_000_000) return;
  // Server-only JS never reaches the browser; prerendered HTML/RSC payloads do.
  if (rel.startsWith("apps/web/.next/server/") && /\.m?js$/.test(p)) return;
  const text = readFileSync(p, "utf8");
  if (!NAME.test(text)) return;
  text.split("\n").forEach((line, i) => NAME.test(line) && hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 140)}`));
}
SCAN.forEach((s) => walk(join(root, s)));

if (hits.length) {
  console.error("Provider name found in customer-reachable files:\n" + hits.join("\n"));
  process.exit(1);
}
console.log("Brand check passed: no provider names in customer-facing code or bundles.");
