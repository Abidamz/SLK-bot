/** Diagnostics-only tagging coverage for the persisted rows:
 *  - the additive D1 columns are written when migration 0008 is applied;
 *  - a database that has not applied it keeps writing alerts/ledger rows
 *    (tags are dropped, never an error), and the probe re-checks later;
 *  - the memory store mirrors the same row shape;
 *  - the owner-only ledger endpoints expose the annotation.
 *  Nothing here may influence alerts, dedupe, delivery, or outcomes. */
import { beforeEach, describe, expect, it } from "vitest";
import worker, { captureFvgRetest50Experiments, parseDiagnosticTags, persistShadowExperiments, type Env } from "../src/index";
import { defaultStrategy } from "../src/config";
import { scanEntry } from "../src/engine";
import { buildH4VantageConfluence } from "../src/h4_context";
import { D1Store, MemStore, makeStore, resetDefaultMemStore, serializeDiagnosticTags, type D1Like } from "../src/store";
import type { Alert, ShadowExperimentCapture, ShadowTradeCapture } from "../src/types";
import { mkCandles, SHORT_ROWS, SHORT_STORY, snapsFor } from "./fixtures";

const H4 = 240;
const BULL_H4_ROWS: [number, number, number, number][] = [
  [101.0, 101.2, 100.8, 101.1], [101.1, 101.3, 100.9, 101.0],
  [101.0, 101.1, 100.7, 100.8], [100.8, 101.0, 100.6, 100.9],
  [100.9, 102.6, 100.8, 102.4], [102.4, 102.5, 102.0, 102.1],
  [102.1, 102.2, 101.9, 102.0], [102.0, 102.1, 101.7, 101.8],
  [101.8, 102.0, 101.6, 101.9], [101.9, 102.0, 101.7, 101.8],
  [101.8, 102.0, 101.5, 101.6], [101.6, 101.8, 101.4, 101.5],
  [101.5, 103.1, 101.9, 103.0], [102.5, 103.3, 102.6, 103.1],
  [103.1, 103.4, 103.0, 103.2],
];

function mirrorRows(rows: [number, number, number, number][], pivot: number): [number, number, number, number][] {
  return rows.map(([o, h, l, c]) => [2 * pivot - o, 2 * pivot - l, 2 * pivot - h, 2 * pivot - c]);
}

function taggedAlert(): Alert {
  return {
    setupId: "EURUSD:30m:SHORT:V:104.2:tagged", pair: "EURUSD", entryTf: "30m", mapTf: "4h",
    direction: "SHORT", entry: 104, stopLoss: 105, tpInternal: 102, tpExternal: null,
    candleCloseTime: Date.parse("2024-03-04T07:00:00Z"),
    environment: "bearish", phase: "pullback", htfAlignment: "H4:↓",
    originKeyLevel: 104.2, keyLevelType: "V", keyLevelBounds: [104.1, 104.3],
    keyLevelTested: true, keyLevelFlipped: false, imbalanceContext: [], internalLiquidity: [],
    externalLiquidity: [], drawOnLiquidity: null, nearestExternalTarget: null,
    intermediateZones: [], opposingLiquidityStanding: true,
    sweepTime: 0, bosTime: 0, returnTime: 0, invalidationLevel: 105, invalidationReason: null,
    parameterVersion: "1", alertStatus: "PAPER", suppressReason: null, session: null,
    atrEntry: 0.2, rrInternal: 3, cycleStage: "entry_alert", entryMode: "confirmation",
    h4ConfluenceGrade: "H4_PLUG_AND_PLAY",
    h4ConfluenceTags: ["H4_PLUG_AND_PLAY", "H4_KL_OC", "H4_BREAKOUT_BEARISH", "OBSERVATION_ONLY", "S08_12"],
    sessionBucket: "S08_12",
  };
}

/** Minimal D1 stub: records statements and rejects the diagnostics columns
 *  when `withTagColumns` is false (pre-migration production schema). */
function fakeD1(withTagColumns: boolean, opts: { failOnce?: boolean } = {}) {
  const statements: { sql: string; values: unknown[] }[] = [];
  let tagWriteAttempts = 0;
  const handle = (sql: string, values: unknown[] = []) => {
    const touchesTags = /h4_confluence_(grade|tags)|session_bucket/.test(sql);
    if (touchesTags && !withTagColumns) {
      tagWriteAttempts++;
      return { ok: false };
    }
    statements.push({ sql, values });
    return { ok: true };
  };
  const db = {
    prepare(sql: string) {
      return {
        bind: (...values: unknown[]) => ({
          run: async () => {
            const res = handle(sql, values);
            if (!res.ok) throw new Error("no such column: h4_confluence_grade");
            return { meta: { changes: 1 } };
          },
          all: async () => {
            const res = handle(sql, values);
            if (!res.ok) throw new Error("no such column: h4_confluence_grade");
            return { results: [] };
          },
          first: async () => null,
        }),
      };
    },
  } as unknown as D1Like;
  return { db, statements, attempts: () => tagWriteAttempts };
}

function experiment(): ShadowExperimentCapture {
  return {
    experimentId: "BREAKOUT_CONTINUATION:EURUSD:30m:LONG:H4BREAKOUT:x:y",
    sourceSetupId: "EURUSD:30m:LONG:H4BREAKOUT:x",
    variant: "BREAKOUT_CONTINUATION", pair: "EURUSD", entryTf: "30m", direction: "LONG",
    entry: 100, stopLoss: 99, target: 102.5, rr: 2.5,
    candleCloseTime: Date.parse("2024-03-06T05:00:00Z"),
    h4ConfluenceGrade: "H4_FVG_ONLY",
    h4ConfluenceTags: ["H4_FVG_ONLY", "H4_BREAKOUT_BULLISH", "S04_08"],
    sessionBucket: "S04_08",
  };
}

function shadowTrade(): ShadowTradeCapture {
  return {
    setupId: "EURUSD:30m:SHORT:V:104.2:shadow", pair: "EURUSD", entryTf: "30m", direction: "SHORT",
    entry: 100, stopLoss: 101, tp1: 98, rr: 2, rejectReason: "TARGET_FLOOR",
    candleCloseTime: Date.parse("2024-03-04T07:00:00Z"),
    h4ConfluenceGrade: "H4_KL_IN_FVG",
    h4ConfluenceTags: ["H4_KL_IN_FVG", "H4_KL_V", "H4_BREAKOUT_BEARISH", "S08_12"],
    sessionBucket: "S08_12",
  };
}

describe("diagnostics-only tag persistence", () => {
  beforeEach(() => resetDefaultMemStore());

  it("parses legacy nulls and both stored shapes", () => {
    expect(parseDiagnosticTags(null)).toEqual([]);
    expect(parseDiagnosticTags(undefined)).toEqual([]);
    expect(parseDiagnosticTags("")).toEqual([]);
    expect(parseDiagnosticTags("not json")).toEqual([]);
    expect(parseDiagnosticTags('{"a":1}')).toEqual([]);
    expect(parseDiagnosticTags('["H4_FVG_ONLY","S04_08"]')).toEqual(["H4_FVG_ONLY", "S04_08"]);
    expect(parseDiagnosticTags(["H4_FVG_ONLY"])).toEqual(["H4_FVG_ONLY"]);
    expect(serializeDiagnosticTags([])).toBeNull();
    expect(serializeDiagnosticTags(undefined)).toBeNull();
    expect(serializeDiagnosticTags(["X"])).toBe('["X"]');
  });

  it("writes the additive columns when migration 0008 is applied", async () => {
    const d1 = fakeD1(true);
    const store = new D1Store(d1.db);
    expect(await store.insertAlert(taggedAlert(), "twelvedata")).toBe(true);
    expect(await store.insertShadowTrade(shadowTrade())).toBe(true);
    expect(await store.insertShadowExperiment(experiment())).toBe(true);

    const alertInsert = d1.statements.find((s) => s.sql.includes("INSERT OR IGNORE INTO slk_alerts"));
    expect(alertInsert?.sql).toContain("h4_confluence_grade, h4_confluence_tags, session_bucket");
    expect(alertInsert?.values.slice(-3)).toEqual([
      "H4_PLUG_AND_PLAY", JSON.stringify(["H4_PLUG_AND_PLAY", "H4_KL_OC", "H4_BREAKOUT_BEARISH", "OBSERVATION_ONLY", "S08_12"]), "S08_12",
    ]);
    const tradeInsert = d1.statements.find((s) => s.sql.includes("INSERT OR IGNORE INTO slk_shadow_trades"));
    expect(tradeInsert?.sql).toContain("h4_confluence_grade, h4_confluence_tags, session_bucket");
    expect(tradeInsert?.values.slice(-3)).toEqual(["H4_KL_IN_FVG", JSON.stringify(shadowTrade().h4ConfluenceTags), "S08_12"]);
    const expInsert = d1.statements.find((s) => s.sql.includes("INSERT OR IGNORE INTO slk_shadow_experiments"));
    expect(expInsert?.sql).toContain("h4_confluence_grade, h4_confluence_tags, session_bucket");
    expect(expInsert?.values.slice(-3)).toEqual(["H4_FVG_ONLY", JSON.stringify(experiment().h4ConfluenceTags), "S04_08"]);
  });

  it("falls back to the legacy schema instead of failing a write", async () => {
    const d1 = fakeD1(false);
    const store = new D1Store(d1.db);
    // The row is still written — only the annotation is dropped.
    expect(await store.insertAlert(taggedAlert(), "twelvedata")).toBe(true);
    expect(await store.insertShadowTrade(shadowTrade())).toBe(true);
    expect(await store.insertShadowExperiment(experiment())).toBe(true);
    expect(d1.attempts()).toBeGreaterThan(0);
    const alertInsert = d1.statements.find((s) => s.sql.includes("INSERT OR IGNORE INTO slk_alerts"));
    expect(alertInsert?.sql).not.toContain("h4_confluence_grade");
    expect(alertInsert?.values).toHaveLength(38); // legacy column count
  });

  it("keeps the memory store row shape explicit for untagged and tagged rows", async () => {
    const store = new MemStore();
    const untagged = { ...taggedAlert(), h4ConfluenceGrade: undefined, h4ConfluenceTags: undefined, sessionBucket: undefined };
    await store.insertAlert(untagged, "twelvedata");
    await store.insertAlert({ ...taggedAlert(), setupId: "tagged-2" }, "twelvedata");
    const rows = await store.recentAlerts(10);
    expect(rows[0].h4_confluence_grade).toBe("H4_PLUG_AND_PLAY");
    expect(rows[0].session_bucket).toBe("S08_12");
    expect(parseDiagnosticTags(rows[0].h4_confluence_tags)).toContain("H4_KL_OC");
    expect(rows[1].h4_confluence_grade).toBeNull();
    expect(rows[1].h4_confluence_tags).toBeNull();
    expect(rows[1].session_bucket).toBeNull();
  });

  it("annotates alerts and ledger rows end to end without changing alert behavior", async () => {
    const cfg = { ...defaultStrategy(), minRiskAtr: 0.1 };
    const h4Context = buildH4VantageConfluence(mkCandles(mirrorRows(BULL_H4_ROWS, 104), H4), cfg);
    const result = scanEntry({
      pair: "EURUSD", entryTf: "30m", tfSeconds: 1800,
      candles: mkCandles(SHORT_ROWS, 30), snaps: snapsFor(SHORT_STORY),
      cfg, mode: "paper", provider: "test", h4Context,
    });
    expect(result.alerts).toHaveLength(1);
    const store = makeStore(undefined);
    await store.insertAlert(result.alerts[0], "twelvedata");
    const rows = await store.recentAlerts(10);
    expect(rows[0].h4_confluence_grade).toBe("H4_PLUG_AND_PLAY");
    expect(rows[0].session_bucket).toBe("S08_12");
    // No event, status, or lifecycle change is introduced by the annotation.
    expect(rows[0].alert_status).toBe("PAPER");
    expect(rows[0].status).toBe("OPEN");
  });

  it("annotates the 50% FVG-retest variant with the same confluence tags", () => {
    const cfg = { ...defaultStrategy(), minRiskAtr: 0.1 };
    const h4Context = buildH4VantageConfluence(mkCandles(mirrorRows(BULL_H4_ROWS, 104), H4), cfg);
    const result = scanEntry({
      pair: "EURUSD", entryTf: "30m", tfSeconds: 1800,
      candles: mkCandles(SHORT_ROWS, 30), snaps: snapsFor(SHORT_STORY),
      cfg, mode: "paper", provider: "test", h4Context,
    });
    const captured = captureFvgRetest50Experiments(
      "EURUSD", "30m", 1800, mkCandles(SHORT_ROWS, 30), result.alerts, h4Context,
    );
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      variant: "FVG_RETEST_50",
      h4ConfluenceGrade: "H4_PLUG_AND_PLAY",
      sessionBucket: "S08_12",
    });
    expect(captured[0].h4ConfluenceTags).toContain("H4_BREAKOUT_BEARISH");
    // Without a context the row still records its session bucket.
    const bare = captureFvgRetest50Experiments("EURUSD", "30m", 1800, mkCandles(SHORT_ROWS, 30), result.alerts);
    expect(bare[0].h4ConfluenceTags).toEqual(["S08_12"]);
    expect(bare[0].h4ConfluenceGrade).toBeNull();
  });

  it("exposes the annotation on the owner-only ledger endpoints", async () => {
    const store = makeStore(undefined);
    await persistShadowExperiments(store, [experiment()]);
    await store.insertShadowTrade(shadowTrade());
    const env = { ADMIN_KEY: "owner-test" } as Env;

    const auth = { authorization: "Bearer owner-test" };
    const experiments = await worker.fetch(new Request("https://w.test/api/shadow-experiments", { headers: auth }), env, {} as any);
    const experimentBody = (await experiments.json()) as any;
    expect(experimentBody.rows[0]).toMatchObject({
      variant: "BREAKOUT_CONTINUATION",
      h4ConfluenceGrade: "H4_FVG_ONLY",
      sessionBucket: "S04_08",
    });
    expect(experimentBody.rows[0].h4ConfluenceTags).toContain("S04_08");

    const ledger = await worker.fetch(new Request("https://w.test/api/shadow-ledger", { headers: auth }), env, {} as any);
    const ledgerBody = (await ledger.json()) as any;
    expect(ledgerBody.rows[0]).toMatchObject({
      rejectReason: "TARGET_FLOOR",
      h4ConfluenceGrade: "H4_KL_IN_FVG",
      sessionBucket: "S08_12",
    });
    expect(ledgerBody.rows[0].h4ConfluenceTags).toContain("H4_KL_V");
  });

  it("leaves the public alert journal untouched when no tags were recorded", async () => {
    const store = makeStore(undefined);
    const plain = { ...taggedAlert(), h4ConfluenceGrade: undefined, h4ConfluenceTags: undefined, sessionBucket: undefined };
    await store.insertAlert(plain, "twelvedata");
    const env = { TWELVEDATA_API_KEY: "K" } as Env;
    const resp = await worker.fetch(new Request("https://w.test/alerts"), env, {} as any);
    const body = (await resp.json()) as any;
    expect(body.items[0].h4ConfluenceGrade).toBeNull();
    expect(body.items[0].h4ConfluenceTags).toEqual([]);
    expect(body.items[0].sessionBucket).toBeNull();
  });
});
