import { describe, expect, it } from "vitest";
import { decodeJetta, fetchDukascopy, fetchOanda, fetchYahoo, providerForPair, symbolFor, DataQualityError } from "../src/provider";
import { dukaJson, yahooFlatFeed } from "./fixtures";
import type { Candle } from "../src/types";

describe("provider routing", () => {
  it("routes forex/metals to Twelve Data and index CFDs to the Dukascopy public feed", () => {
    expect(providerForPair("EURUSD")).toBe("twelvedata");
    expect(providerForPair("XAUUSD")).toBe("twelvedata");
    expect(providerForPair("USDZAR")).toBe("twelvedata");
    expect(providerForPair("US30")).toBe("dukascopy");
    expect(providerForPair("GER40")).toBe("dukascopy");
    expect(providerForPair("JAPAN225")).toBe("dukascopy");
  });

  it("PROVIDER_MAP overrides win over defaults", () => {
    expect(providerForPair("US30", { US30: "twelvedata" })).toBe("twelvedata");
    expect(providerForPair("EURUSD", { EURUSD: "yahoo" })).toBe("yahoo");
    expect(providerForPair("US30", { US30: "yahoo" })).toBe("yahoo");
  });

  it("index CFDs prefer OANDA when its token exists, then Dukascopy, Yahoo last resort; metals stay on Twelve Data", () => {
    expect(providerForPair("US30", {}, false)).toBe("dukascopy");
    expect(providerForPair("US30", {}, true)).toBe("oanda");
    expect(providerForPair("JAPAN225", {}, true)).toBe("oanda");
    expect(providerForPair("US30", {}, false, false)).toBe("yahoo"); // dukascopy disabled → yahoo fallback
    expect(providerForPair("XAUUSD", {}, true)).toBe("twelvedata"); // metals are NOT indices
    expect(providerForPair("XAUUSD", { XAUUSD: "oanda" }, true)).toBe("oanda"); // explicit single-source option
  });

  it("maps canonical names to provider symbols", () => {
    expect(symbolFor("EURUSD", {})).toBe("EUR/USD");
    expect(symbolFor("USDZAR", {})).toBe("USD/ZAR");
    expect(symbolFor("XAUUSD", {})).toBe("XAU/USD");
    expect(symbolFor("US30", { US30: "^DJI" })).toBe("^DJI");
  });
});

describe("fetchYahoo", () => {
  const wire = {
    chart: {
      result: [{
        timestamp: [1700000000, 1700001800, 1700003600],
        indicators: {
          quote: [{
            open: [39000, 39010, null],   // third bar = session gap → skipped
            high: [39020, 39030, null],
            low: [38990, 39000, null],
            close: [39010, 39015, null],
          }],
        },
      }],
      error: null,
    },
  };

  it("parses quote arrays and skips null (gap) bars", async () => {
    const fake: typeof fetch = async () => new Response(JSON.stringify(wire), { status: 200 });
    const candles = await fetchYahoo("US30", "30m", 100, {}, fake);
    expect(candles).toHaveLength(2);
    expect(candles[0]).toEqual({ t: 1700000000000, o: 39000, h: 39020, l: 38990, c: 39010 });
    expect(candles[1].c).toBe(39015);
  });

  it("uses the default Yahoo symbol for known index names, overridable by SYMBOL_MAP", async () => {
    const seen: string[] = [];
    const fake: typeof fetch = async (u) => {
      seen.push(String(u));
      return new Response(JSON.stringify(wire), { status: 200 });
    };
    await fetchYahoo("US30", "30m", 100, {}, fake);
    expect(seen[0]).toContain("%5EDJI");           // default ^DJI
    await fetchYahoo("US30", "30m", 100, { US30: "YM=F" }, fake);
    expect(seen[1]).toContain("YM%3DF");           // explicit override
  });

  it("throws a descriptive error on Yahoo errors", async () => {
    const fake: typeof fetch = async () =>
      new Response(JSON.stringify({ chart: { result: null, error: { description: "No data found" } } }), { status: 200 });
    await expect(fetchYahoo("GER40", "30m", 100, {}, fake)).rejects.toThrow(/Yahoo error for \^GDAXI/);
  });

  it("throws on empty/malformed results", async () => {
    const fake: typeof fetch = async () =>
      new Response(JSON.stringify({ chart: { result: [], error: null } }), { status: 200 });
    await expect(fetchYahoo("JAPAN225", "1d", 100, {}, fake)).rejects.toThrow(/no candles/);
  });
});

describe("fetchOanda", () => {
  const wire = {
    instrument: "US30_USD", granularity: "M30",
    candles: [
      { complete: true, volume: 51, time: "2026-09-04T20:00:00.000000000Z",
        mid: { o: "39100.2", h: "39120.4", l: "39090.1", c: "39110.0" } },
      { complete: false, volume: 4, time: "2026-09-04T20:30:00.000000000Z",
        mid: { o: "39110.0", h: "39115.0", l: "39105.1", c: "39112.3" } },
      { complete: true, volume: 0, time: "2026-09-04T21:00:00.000000000Z" }, // session gap (no mid)
    ],
  };

  it("parses midpoint candles, trims ns timestamps, skips gap bars", async () => {
    const seen: string[] = [];
    const fake: typeof fetch = async (u) => {
      seen.push(String(u));
      return new Response(JSON.stringify(wire), { status: 200 });
    };
    const candles = await fetchOanda("TOK", "US30", "30m", 100, {}, fake);
    expect(seen[0]).toContain("api-fxpractice.oanda.com/v3/instruments/US30_USD/candles");
    expect(seen[0]).toContain("granularity=M30");
    expect(candles).toHaveLength(2);
    expect(candles[0]).toEqual({ t: Date.parse("2026-09-04T20:00:00Z"), o: 39100.2, h: 39120.4, l: 39090.1, c: 39110 });
    expect(candles[1].c).toBe(39112.3);
  });

  it("maps canonical forex names too (future single-source option)", async () => {
    const seen: string[] = [];
    const fake: typeof fetch = async (u) => {
      seen.push(String(u));
      return new Response(JSON.stringify({ instrument: "X", granularity: "M30", candles: [] }), { status: 200 });
    };
    await fetchOanda("TOK", "USDZAR", "30m", 100, {}, fake);
    expect(seen[0]).toContain("USD_ZAR");
  });

  it("requires the token", async () => {
    await expect(fetchOanda("", "US30", "30m", 100, {}, fetch)).rejects.toThrow(/OANDA_API_TOKEN/);
  });

  it("throws a descriptive error on HTTP failures", async () => {
    const fake: typeof fetch = async () =>
      new Response(JSON.stringify({ errorMessage: "Invalid token" }), { status: 401 });
    await expect(fetchOanda("BAD", "US30", "30m", 100, {}, fake)).rejects.toThrow(/OANDA error for US30_USD.*401.*Invalid token/s);
  });
});

describe("decodeJetta", () => {
  const feed = yahooFlatFeed();

  it("decodes cumulative unit deltas back to the exact candles", () => {
    const out = decodeJetta(dukaJson(feed));
    expect(out.length).toBe(feed.length);
    expect(out[0].t).toBe(feed[0].t);
    expect(out[123].t).toBe(feed[123].t);
    expect(out[123].c).toBeCloseTo(feed[123].c, 4); // within 1e-5 unit quantisation
    expect(out[out.length - 1].h).toBeCloseTo(feed[out.length - 1].h, 4);
  });

  it("never flat-fills gap periods (no fabricated candles)", () => {
    const withGap: Candle[] = [
      { t: 1_000_000, o: 10, h: 11, l: 9, c: 10.5 },
      { t: 1_000_000 + 5 * 60_000, o: 10.5, h: 12, l: 10, c: 11 }, // 4 bars skipped
    ];
    const out = decodeJetta(dukaJson(withGap, 60_000));
    expect(out).toHaveLength(2);                       // gap bars absent, not synthesised
    expect(out[1].t).toBe(withGap[1].t);
    expect(out[1].c).toBeCloseTo(11, 6);
  });

  it("rejects malformed payloads instead of silently mis-decoding", () => {
    const good = dukaJson(feed);
    expect(() => decodeJetta({ ...good, opens: good.opens.slice(1) })).toThrow(DataQualityError);
    expect(() => decodeJetta({ ...good, shift: 0 })).toThrow(DataQualityError);
    expect(() => decodeJetta({ ...good, multiplier: undefined as unknown as number })).toThrow(DataQualityError);
  });

  it("empty bucket decodes to zero bars", () => {
    expect(decodeJetta({
      timestamp: 0, shift: 60_000, multiplier: 1e-5, open: 0, high: 0, low: 0, close: 0,
      times: [], opens: [], highs: [], lows: [], closes: [],
    })).toEqual([]);
  });
});

describe("fetchDukascopy", () => {
  it("maps canonical index aliases to Dukascopy instrument codes", async () => {
    const urls: string[] = [];
    const fetchFn = async (u: RequestInfo | URL): Promise<Response> => {
      const url = typeof u === "string" ? u : u instanceof URL ? u.href : u.url;
      urls.push(url);
      return new Response(JSON.stringify(dukaJson(yahooFlatFeed())), { status: 200 });
    };
    await fetchDukascopy("US30", "30m", 120, {}, fetchFn);
    expect(urls.every((u) => u.includes("USA30.IDX-USD"))).toBe(true);
    urls.length = 0;
    await fetchDukascopy("GER40", "30m", 120, {}, fetchFn);
    expect(urls.every((u) => u.includes("DEU.IDX-EUR"))).toBe(true);
    urls.length = 0;
    await fetchDukascopy("JAPAN225", "30m", 120, {}, fetchFn);
    expect(urls.every((u) => u.includes("JPN.IDX-JPY"))).toBe(true);
  });

  it("generic 6-letter pairs fall back to AAA-BBB codes", async () => {
    const urls: string[] = [];
    const fetchFn = async (u: RequestInfo | URL): Promise<Response> => {
      urls.push(typeof u === "string" ? u : u instanceof URL ? u.href : u.url);
      return new Response(JSON.stringify(dukaJson(yahooFlatFeed())), { status: 200 });
    };
    await fetchDukascopy("EURUSD", "30m", 120, {}, fetchFn);
    expect(urls.every((u) => u.includes("EUR-USD"))).toBe(true);
  });

  it("enumerates one file per UTC day for 30m (minute source), 1-based month/day", async () => {
    const urls: string[] = [];
    const fetchFn = async (u: RequestInfo | URL): Promise<Response> => {
      urls.push(typeof u === "string" ? u : u instanceof URL ? u.href : u.url);
      return new Response(JSON.stringify(dukaJson(yahooFlatFeed())), { status: 200 });
    };
    const candles = await fetchDukascopy("US30", "30m", 120, {}, fetchFn);
    expect(candles.length).toBe(120);                  // sliced to limit after merge/dedupe
    expect(urls.length).toBeGreaterThanOrEqual(9);    // day-bucket enumeration
    expect(urls.every((u) => u.includes("/candles/minute/"))).toBe(true);
    // completed days: /BID/yyyy/m/d with 1-based m/d; today's ACTIVE bucket: ?from=
    const completed = urls.slice(0, -1);
    expect(completed.every((u) => /\/BID\/\d{4}\/\d{1,2}\/\d{1,2}$/.test(u))).toBe(true);
    expect(urls[urls.length - 1]).toMatch(/BID\?from=\d+$/);
  });

  it("current-period buckets use the active ?from= URL (year path 400s while active)", async () => {
    for (const [tf, src] of [["1h", "hour"], ["1d", "day"]] as const) {
      const urls: string[] = [];
      const fetchFn = async (u: RequestInfo | URL): Promise<Response> => {
        urls.push(typeof u === "string" ? u : u instanceof URL ? u.href : u.url);
        return new Response(JSON.stringify(dukaJson(yahooFlatFeed(), 3600_000)), { status: 200 });
      };
      await fetchDukascopy("US30", tf, 120, {}, fetchFn);
      expect(urls.every((u) => u.includes(`/candles/${src}/`))).toBe(true);
      expect(urls.filter((u) => u.includes("?from="))).toHaveLength(1);
      expect(urls[urls.length - 1]).toContain("?from="); // active bucket last
    }
  });

  it("skips 404 buckets (pre-instrument-history) instead of failing", async () => {
    let n = 0;
    const fetchFn = async (_u: RequestInfo | URL): Promise<Response> => {
      n += 1;
      if (n <= 3) return new Response("missing", { status: 404 });
      return new Response(JSON.stringify(dukaJson(yahooFlatFeed())), { status: 200 });
    };
    const candles = await fetchDukascopy("US30", "30m", 120, {}, fetchFn);
    expect(candles.length).toBeGreaterThan(0);
  });

  it("immutable buckets are cached in kv; mutable (today/yesterday) always refetch", async () => {
    const store = new Map<string, string>();
    const kv = { get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: string) => { store.set(k, v); } };
    let fetches = 0;
    const fetchFn = async (u: RequestInfo | URL): Promise<Response> => {
      fetches += 1;
      return new Response(JSON.stringify(dukaJson(yahooFlatFeed())), { status: 200 });
    };
    await fetchDukascopy("US30", "30m", 120, {}, fetchFn, kv);
    const firstRun = fetches;
    expect(store.size).toBeGreaterThan(0);
    fetches = 0;
    await fetchDukascopy("US30", "30m", 120, {}, fetchFn, kv);
    expect(fetches).toBeLessThan(firstRun / 2);        // only the mutable buckets refetch
  });
});

describe("SYMBOL_MAP precedence", () => {
  it("Yahoo-style SYMBOL_MAP values never poison Dukascopy instrument codes", async () => {
    const urls: string[] = [];
    const fetchFn = async (u: RequestInfo | URL): Promise<Response> => {
      urls.push(typeof u === "string" ? u : u instanceof URL ? u.href : u.url);
      return new Response(JSON.stringify(dukaJson(yahooFlatFeed())), { status: 200 });
    };
    await fetchDukascopy("US30", "30m", 120, { US30: "^DJI" }, fetchFn);
    expect(urls.every((u) => u.includes("USA30.IDX-USD") && !u.includes("%5EDJI"))).toBe(true);
  });

  it("Yahoo-style SYMBOL_MAP values never poison OANDA instruments", async () => {
    const urls: string[] = [];
    const fetchFn = async (u: RequestInfo | URL): Promise<Response> => {
      urls.push(typeof u === "string" ? u : u instanceof URL ? u.href : u.url);
      return new Response(JSON.stringify({ instrument: "X", granularity: "M30", candles: [
        { complete: true, volume: 0, time: "2024-03-04T00:00:00.000000000Z",
          mid: { o: "1", h: "1", l: "1", c: "1" } },
      ] }), { status: 200 });
    };
    await fetchOanda("TOK", "US30", "30m", 10, { US30: "^DJI" }, fetchFn);
    expect(urls[0]).toContain("US30_USD");
  });
});
