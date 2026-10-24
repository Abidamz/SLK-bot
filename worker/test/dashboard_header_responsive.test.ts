import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pagesCss = readFileSync(
  fileURLToPath(new URL("../../dashboard/styles.css", import.meta.url)),
  "utf8",
);
const pagesHtml = readFileSync(
  fileURLToPath(new URL("../../dashboard/index.html", import.meta.url)),
  "utf8",
);
const workerHtml = readFileSync(
  fileURLToPath(new URL("../src/dashboard_html.ts", import.meta.url)),
  "utf8",
);
const MARKER = "/* Keep the brand mark fixed-size and the header readable on narrow screens. */";

function responsiveHeaderRules(source: string): string {
  const start = source.indexOf(MARKER);
  expect(start, "responsive header rules missing").toBeGreaterThanOrEqual(0);
  const styleEnd = source.indexOf("</style>", start);
  return source.slice(start, styleEnd < 0 ? undefined : styleEnd).trim();
}

describe("responsive dashboard header", () => {
  it("keeps the Pages and Worker header rules in sync", () => {
    expect(responsiveHeaderRules(pagesCss)).toBe(responsiveHeaderRules(workerHtml));
  });

  it.each([
    ["Pages", pagesCss],
    ["Worker", workerHtml],
  ])("%s keeps branding readable and controls usable on mobile", (_name, css) => {
    const rules = responsiveHeaderRules(css);
    expect(rules).toContain(".brand-mark{flex:0 0 38px}");
    expect(rules).toContain(".topbar{height:auto;min-height:72px;flex-wrap:wrap");
    expect(rules).toContain(".brand small{font-size:9px;line-height:1.2;letter-spacing:.09em;white-space:nowrap}");
    expect(rules).toContain("min-height:44px");
    expect(rules).toContain(":focus-visible");
    expect(rules).toContain("@media(max-width:400px)");
  });

  it("serves the fresh Pages stylesheet URL while retaining the desktop header", () => {
    expect(pagesHtml).toContain('href="styles.css?v=16"');
    expect(pagesCss).toContain(".topbar{height:72px");
  });
});
