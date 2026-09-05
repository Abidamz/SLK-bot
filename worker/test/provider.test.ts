import { describe, expect, it } from "vitest";
import { fetchYahoo, providerForPair, symbolFor } from "../src/provider";

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
