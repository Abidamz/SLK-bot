import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pagesDashboardPath = fileURLToPath(
  new URL("../../dashboard/index.html", import.meta.url),
);
const pagesTermsPath = fileURLToPath(
  new URL("../../dashboard/terms.html", import.meta.url),
);
const logoPath = fileURLToPath(
  new URL("../../dashboard/favicon.png", import.meta.url),
);
const pagesDashboard = readFileSync(pagesDashboardPath, "utf8");
const pagesTerms = readFileSync(pagesTermsPath, "utf8");
const pagesCss = readFileSync(
  fileURLToPath(new URL("../../dashboard/styles.css", import.meta.url)),
  "utf8",
);
const workerDashboard = readFileSync(
  fileURLToPath(new URL("../src/dashboard_html.ts", import.meta.url)),
  "utf8",
);
const workerTerms = readFileSync(
  fileURLToPath(new URL("../src/terms_html.ts", import.meta.url)),
  "utf8",
);
const workerLogo = readFileSync(
  fileURLToPath(new URL("../src/brand_logo.ts", import.meta.url)),
  "utf8",
);

const STATIC_LOGO =
  '<img class="brand-mark" src="/favicon.png?v=3" alt="" aria-hidden="true" width="40" height="40">';
const WORKER_LOGO =
  '<img class="brand-mark" src="${DEO_EDGE_LOGO_DATA_URI}" alt="" aria-hidden="true" width="40" height="40">';

describe("DEO Edge logo usage", () => {
  it("uses the supplied mark in both static Pages headers and links it home", () => {
    expect(existsSync(logoPath)).toBe(true);
    expect(pagesDashboard).toContain(STATIC_LOGO);
    expect(pagesTerms).toContain(STATIC_LOGO);
    expect(pagesDashboard).toContain('<a class="brand" href="/" aria-label="DEO Edge home"');
    expect(pagesTerms).toContain('<a class="brand" href="/" aria-label="DEO Edge home"');
  });

  it("embeds the same mark in both self-contained Worker pages and links it home", () => {
    expect(workerDashboard).toContain('import { DEO_EDGE_LOGO_DATA_URI } from "./brand_logo";');
    expect(workerTerms).toContain('import { DEO_EDGE_LOGO_DATA_URI } from "./brand_logo";');
    expect(workerDashboard).toContain(WORKER_LOGO);
    expect(workerTerms).toContain(WORKER_LOGO);
    expect(workerDashboard).toContain('<a class="brand" href="/" aria-label="DEO Edge home"');
    expect(workerTerms).toContain('<a class="brand" href="/" aria-label="DEO Edge home"');
    expect(workerLogo).toContain("data:image/png;base64,");
  });

  it("styles the brand link as a focused, touch-friendly island", () => {
    expect(pagesCss).toContain(".brand{display:inline-flex;align-items:center;gap:10px");
    expect(pagesCss).toContain("border-radius:999px");
    expect(pagesCss).toContain(".brand:focus-visible");
    expect(pagesCss).toContain(".brand:active{transform:scale(.97)}");
    expect(pagesCss).toContain("@media(hover:hover) and (pointer:fine)");
    expect(pagesCss).toContain("@media(prefers-reduced-motion:reduce)");
    expect(workerDashboard).toContain(".brand:focus-visible");
    expect(workerTerms).toContain(".brand:focus-visible");
  });
});
