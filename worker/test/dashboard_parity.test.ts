/** Parity sentinels for the TWO dashboards the repo ships.
 *
 *  The repo has two parallel UI codebases: the Worker-embedded HTML in
 *  src/dashboard_html.ts and the static Pages app in ../dashboard/. They
 *  drift silently, and one drift already shipped: commit e37ef9d mirrored
 *  the prop card into dashboard/index.html and accidentally deleted the
 *  chart modal's wrapper line (`<div id="chartModal" class="modal" hidden>`).
 *  Without that wrapper the modal backdrop - position:absolute, inset:0,
 *  blur(8px), near-black - renders bare on the page: a full-screen veil
 *  over the whole site that no Close click can dismiss, because the close
 *  handler looks up #chartModal and finds null.
 *
 *  These sentinels pin the structural facts that made that bug invisible
 *  to every other test: the wrapper exists, it OPENS before the backdrop
 *  it is meant to hide, and both dashboards carry the same feature cards.
 *  Markup-only checks; no rendering, no network.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pagesHtml = readFileSync(
  fileURLToPath(new URL("../../dashboard/index.html", import.meta.url)),
  "utf8",
);
const pagesCss = readFileSync(
  fileURLToPath(new URL("../../dashboard/styles.css", import.meta.url)),
  "utf8",
);
const pagesApp = readFileSync(
  fileURLToPath(new URL("../../dashboard/app.js", import.meta.url)),
  "utf8",
);
const workerHtml = readFileSync(
  fileURLToPath(new URL("../src/dashboard_html.ts", import.meta.url)),
  "utf8",
);

const WRAPPER = '<div id="chartModal" class="modal" hidden>';
const BACKDROP = '<div class="modal-backdrop" data-close-chart></div>';

describe("dashboard parity sentinels", () => {
  it.each([
    ["pages", pagesHtml],
    ["worker", workerHtml],
  ])("%s: chart modal wrapper exists and opens before its backdrop", (_name, html) => {
    const w = html.indexOf(WRAPPER);
    const b = html.indexOf(BACKDROP);
    expect(w, "chartModal wrapper missing - its backdrop would veil the whole page").toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(-1);
    expect(w).toBeLessThan(b);
  });

  it.each([
    ["pages", pagesHtml],
    ["worker", workerHtml],
  ])("%s: modal wrapper closes immediately after the dialog", (_name, html) => {
    const start = html.indexOf(WRAPPER);
    const end = html.indexOf("</section>", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(html.slice(end)).toMatch(/^<\/section>\s*<\/div>/);
  });

  it.each([
    ["pages", pagesHtml],
    ["worker", workerHtml],
  ])("%s: backdrop and dialog close hooks are present", (_name, html) => {
    // Two dismiss paths: the backdrop click and the Close button.
    expect(html.match(/data-close-chart/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it.each([
    ["pages", pagesCss],
    ["worker", workerHtml],
  ])("%s: hidden modal CSS really suppresses the overlay", (_name, css) => {
    // `.modal` itself sets display:grid, so relying only on the browser's
    // default [hidden] style is insufficient; this author rule must exist.
    expect(css).toMatch(/\.modal\[hidden\]\s*\{\s*display\s*:\s*none\s*\}/);
  });

  it.each([
    ["pages", pagesHtml],
    ["worker", workerHtml],
  ])("%s: prop verdict copy explains the drawdown-limit outcome", (_name, html) => {
    expect(html).toContain("hitting a drawdown limit");
    expect(html).not.toContain("blown probabilities");
  });

  it.each([
    ["pages", pagesApp],
    ["worker", workerHtml],
  ])("%s: prop verdict table labels the loss-limit outcome as drawdown", (_name, source) => {
    expect(source).toContain('title="Share of simulations that hit either the daily or overall loss limit">Drawdown</th>');
    expect(source).not.toContain("<th>Blown</th>");
  });

  it.each([
    ["pages", pagesHtml],
    ["worker", workerHtml],
  ])("%s: prop verdict card mount points exist", (_name, html) => {
    expect(html).toContain('id="pvWrap"');
    expect(html).toContain('id="pvStatus"');
  });
});
