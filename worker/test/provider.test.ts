import { describe, expect, it } from "vitest";
import { fetchOanda, fetchYahoo, providerForPair, symbolFor } from "../src/provider";

describe("provider routing", () => {
  it("routes forex/metals to Twelve Data and index CFDs to Yahoo", () => {
    expect(providerForPair("EURUSD")).toBe("twelvedata");
    expect(providerForPair("XAUUSD")).toBe("twelvedata");
    expect(providerForPair("USDZAR")).toBe("twelvedata");
    expect(providerForPair("US30")).toBe("yahoo");
    expect(providerForPair("GER40")).toBe("yahoo");
    expect(providerForPair("JAPAN225")).toBe("yahoo");
  });

  it("PROVIDER_MAP overrides win over defaults", () => {
    expect(providerForPair("US30", { US30: "twelvedata" })).toBe("twelvedata");
    expect(providerForPair("EURUSD", { EURUSD: "yahoo" })).toBe("yahoo");
  });

  it("index CFDs prefer OANDA when its token exists, Yahoo otherwise; metals stay on Twelve Data", () => {
    expect(providerForPair("US30", {}, false)).toBe("yahoo");
    expect(providerForPair("US30", {}, true)).toBe("oanda");
    expect(providerForPair("JAPAN225", {}, true)).toBe("oanda");
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
