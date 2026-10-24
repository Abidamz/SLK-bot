import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DASHBOARD_HTML } from "../src/dashboard_html";
import { DASHBOARD_THEME_CSS } from "../src/dashboard_theme_css";

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const pages = read("../../dashboard/index.html");
const theme = read("../../dashboard/mhuzex.css");
const worker = read("../src/dashboard_html.ts");
const workerTheme = read("../src/dashboard_theme_css.ts");

describe("integrated DEO Edge terminal theme", () => {
  it("applies the new visual layer to Pages and the self-contained Worker page", () => {
    expect(pages).toContain('href="mhuzex.css?v=20"');
    expect(pages).toContain('<meta name="theme-color" content="#080b0e">');
    expect(worker).toContain('import { DASHBOARD_THEME_CSS } from "./dashboard_theme_css";');
    expect(worker).toContain('<style>${DASHBOARD_THEME_CSS}</style>');
    expect(workerTheme).toContain("export const DASHBOARD_THEME_CSS");
    expect(DASHBOARD_THEME_CSS).toBe(theme);
    expect(DASHBOARD_HTML).toContain(`<meta name="theme-color" content="#080b0e">`);
    expect(DASHBOARD_HTML).toContain(`<style>${DASHBOARD_THEME_CSS}</style>`);
    expect(theme).toContain("position: sticky");
    expect(theme).toContain("top: 0");
    expect(theme).toContain("prefers-reduced-motion: reduce");
    expect(theme).toContain("(hover: hover) and (pointer: fine)");
    expect(theme).toContain("(hover: none), (pointer: coarse)");
  });

  it("keeps the home-linked supplied mark, paper warnings, and feature hooks", () => {
    for (const html of [pages, worker]) {
      expect(html).toContain('<a class="brand" href="/" aria-label="DEO Edge home"');
      expect(html).toContain("PAPER SIMULATION · NO LIVE ORDERS");
      expect(html).toContain("required 360-day Deriv CFD replay remains unvalidated");
      expect(html).toContain('id="overviewNetR"');
      expect(html).toContain('id="alertsList"');
      expect(html).toContain('id="healthDetails"');
      expect(html).toContain('id="telegramWatch"');
      expect(html).toContain('id="mcRun"');
    }
    expect(pages).toContain('<h1>Make the close<br><em>earn its place.</em></h1>');
    expect(worker).toContain('<h1>Make the close<br><em>earn its place.</em></h1>');
  });

  it("retains accessible selected states and keyboard-operable segment cards", () => {
    for (const html of [pages, worker]) {
      expect(html).toContain('role="tablist" aria-label="Dashboard sections"');
      expect(html).toContain('id="tabOverview" role="tab" data-tab="overview" aria-controls="overview" aria-selected="true"');
      expect(html).toContain('role="tabpanel" aria-labelledby="tabOverview" tabindex="0"');
      expect(html).toContain('role="button" tabindex="0" aria-pressed="false"');
      expect(html).toContain('class="skip-link" href="#mainContent"');
    }
    for (const script of [read("../../dashboard/app.js"), worker]) {
      expect(script).toContain("event.key === 'ArrowRight'");
      expect(script).toContain("event.key === 'ArrowLeft'");
      expect(script).toContain("aria-selected");
    }
  });
});
