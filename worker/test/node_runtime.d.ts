/** Minimal typing for the one Node built-in the deploy-config guard test uses.
 *
 *  The Worker tsconfig sets `"types": []` so only Workers-compatible globals
 *  are visible; pulling in `@types/node` would widen globals for src/ too (and
 *  risk DOM/Worker type conflicts). This declares exactly what the test needs.
 */
declare module "node:fs" {
  export function readFileSync(path: string | URL, encoding: string): string;
}
