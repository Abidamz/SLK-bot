import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const pagesDashboard = read("../../dashboard/index.html");
const pagesCss = read("../../dashboard/styles.css");
const logoPath = fileURLToPath(new URL("../../dashboard/favicon.png", import.meta.url));
const workerDashboard = read("../src/dashboard_html.ts");
const workerLogo = read("../src/brand_logo.ts");

const STATIC_DASHBOARD_LOGO =
  '<img class="brand-mark" src="/favicon.png?v=3" alt="" aria-hidden="true" width="28" height="28">';
const WORKER_DASHBOARD_LOGO =
  '<img class="brand-mark" src="${DEO_EDGE_LOGO_DATA_URI}" alt="" aria-hidden="true" width="28" height="28">';

describe("DEO Edge dashboard logo usage", () => {
  it("uses the supplied mark in the Pages header and links it home", () => {
    expect(existsSync(logoPath)).toBe(true);
    expect(pagesDashboard).toContain(STATIC_DASHBOARD_LOGO);
    expect(pagesDashboard).toContain('<a class="brand" href="/" aria-label="DEO Edge home"');
  });

  it("embeds the same mark in the self-contained Worker dashboard", () => {
    expect(workerDashboard).toContain('import { DEO_EDGE_LOGO_DATA_URI } from "./brand_logo";');
    expect(workerDashboard).toContain(WORKER_DASHBOARD_LOGO);
    expect(workerDashboard).toContain('<a class="brand" href="/" aria-label="DEO Edge home"');
    expect(workerLogo).toContain("data:image/png;base64,");
  });

  it("styles the brand link for focus, touch, reduced motion, and fine-pointer hover", () => {
    expect(pagesCss).toContain(".brand{display:inline-flex;align-items:center;gap:10px");
    expect(pagesCss).toContain("border-radius:999px");
    expect(pagesCss).toContain(".brand:focus-visible");
    expect(pagesCss).toContain(".brand:active{transform:scale(.97)}");
    expect(pagesCss).toContain("@media(hover:hover) and (pointer:fine)");
    expect(pagesCss).toContain("@media(prefers-reduced-motion:reduce)");
    expect(workerDashboard).toContain(".brand:focus-visible");
  });
});
