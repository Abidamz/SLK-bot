/** Dashboard markup guards.
 *
 *  The Pages dashboard has two view modes: Public Overview (default) and
 *  Operator Terminal, toggled in the header and remembered in localStorage.
 *  `styles.css` hides `.operator-only` panels unless `body.operator-mode` is
 *  set, so an operator panel that loses its class leaks into the public view —
 *  exactly what happened to the owner-key-gated 21-Day Scan & Delivery Audit
 *  card. These assertions pin the markup and both copies of the visibility
 *  rules so that cannot regress.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");

const indexHtml = read("../../dashboard/index.html");
const stylesCss = read("../../dashboard/styles.css");
const embedded = read("../src/dashboard_html.ts");

/** The <article> element whose panel-head contains the given <h2> title. */
function panelOpeningTagFor(title: string): string {
  const titleAt = indexHtml.indexOf(title);
  expect(titleAt, `markup should contain "${title}"`).toBeGreaterThan(-1);
  const open = indexHtml.lastIndexOf("<article", titleAt);
  expect(open).toBeGreaterThan(-1);
  return indexHtml.slice(open, indexHtml.indexOf(">", open) + 1);
}

describe("dashboard view modes", () => {
  it("hides every .operator-only panel unless operator mode is active", () => {
    expect(stylesCss).toContain("body:not(.operator-mode) .operator-only{display:none!important}");
    expect(stylesCss).toContain("body.operator-mode .marketing-only{display:none!important}");
    // The worker-hosted single-file dashboard carries its own copy of the rules.
    expect(embedded).toContain("body:not(.operator-mode) .operator-only{display:none!important}");
    expect(embedded).toContain("body.operator-mode .marketing-only{display:none!important}");
  });

  it("keeps the owner-key audit card out of the public view", () => {
    const panelTag = panelOpeningTagFor("21-Day Scan & Delivery Audit");
    expect(panelTag).toContain('class="panel operator-only"');
    // Its controls stay wired: hiding the card must not remove its handlers.
    expect(indexHtml).toContain('id="runScanAuditBtn"');
    expect(indexHtml).toContain('id="scanAuditResults"');
  });

  it("keeps the operator/public toggle that reveals it", () => {
    expect(indexHtml).toContain('id="modeOperatorBtn"');
    expect(indexHtml).toContain('id="modePublicBtn"');
  });

  it("keeps the worker-hosted copy free of the card, or guarded if it ever gains one", () => {
    // The embedded dashboard is a separate single-file build and today has no
    // audit controls. If the card is ever added there, the operator-only guard
    // must come with it.
    const buttonAt = embedded.indexOf("runScanAuditBtn");
    if (buttonAt === -1) {
      expect(embedded).not.toContain("21-Day Scan & Delivery Audit");
      return;
    }
    const open = embedded.lastIndexOf("<article", buttonAt);
    expect(embedded.slice(open, embedded.indexOf(">", open) + 1)).toContain("operator-only");
  });
});
