/** Shared credential and endpoint resolution for the read-only audit scripts.
 *
 *  This exists because of a specific, repeatable failure: the Worker itself
 *  reads `ADMIN_KEY` (src/index.ts authed(), README "wrangler secret put
 *  ADMIN_KEY"), so that is the name an operator has in their shell - but every
 *  audit script read only `TAYO_ADMIN_KEY`. Running an audit then failed with
 *  "TAYO_ADMIN_KEY is required" in a shell where the key was in fact present
 *  under its real name, which reads like a missing secret rather than a
 *  mismatched variable.
 *
 *  Resolution order, first non-empty wins:
 *    1. the script-prefixed name, so existing invocations keep working;
 *    2. the name the Worker actually uses;
 *    3. worker/.dev.vars, the Wrangler local-secret convention.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_BASE_URL = "https://slk-alert-worker.abidogundamilola.workers.dev";

/** Minimal .dev.vars reader: `KEY=value`, optional `export `, optional quotes.
 *  Not a general dotenv parser - just enough for the flat secrets this repo
 *  documents. Returns {} when the file is absent, which is the normal case in
 *  a fresh checkout, so callers fall through to the environment. */
function readDevVars(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const dir of [process.cwd(), join(process.cwd(), "..")]) {
    let raw: string;
    try {
      raw = readFileSync(join(dir, ".dev.vars"), "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq <= 0) continue;
      const k = t.slice(0, eq).replace(/^export\s+/, "").trim();
      let v = t.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (k && !(k in out)) out[k] = v;
    }
    break;
  }
  return out;
}

function first(...vals: Array<string | undefined>): string {
  for (const v of vals) {
    const t = (v ?? "").trim();
    if (t) return t;
  }
  return "";
}

/** The admin key, from the prefixed name, the Worker's own name, or .dev.vars.
 *  An empty-string env var counts as unset: `TAYO_ADMIN_KEY="$UNSET_VAR"` is
 *  exactly how this bug presents itself. */
export function adminKey(): string {
  const vars = readDevVars();
  return first(
    process.env.TAYO_ADMIN_KEY, process.env.ADMIN_KEY,
    vars.TAYO_ADMIN_KEY, vars.ADMIN_KEY,
  );
}

export function baseUrl(): string {
  const vars = readDevVars();
  return first(process.env.TAYO_BASE_URL, vars.TAYO_BASE_URL) || DEFAULT_BASE_URL;
}

/** Names of every credential source that is empty, for a message that says
 *  where to look instead of just refusing to run. */
export function missingKeyHint(): string {
  return [
    "No admin key found. Set any one of:",
    "  export ADMIN_KEY=<the value behind `npx wrangler secret put ADMIN_KEY`>",
    "  export TAYO_ADMIN_KEY=<same value>",
    "  echo 'ADMIN_KEY=<same value>' >> worker/.dev.vars",
  ].join("\n");
}
