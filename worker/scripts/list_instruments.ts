/**
 * Enumerate every instrument the OANDA account can actually trade.
 *
 * The universe for a book-wide backtest has to come from the account, not from
 * a hand-maintained list. OANDA_INSTRUMENTS in src/provider.ts maps 16
 * instruments; a prop book needs on the order of 30 uncorrelated ones. Guessing
 * which extra symbols a given account offers wastes a full run per mistake, so
 * this asks the API instead and emits a paste-ready block for what is missing.
 *
 *   cd worker && npx tsx scripts/list_instruments.ts
 *
 * No unit test: this is a one-shot enumeration with no logic to get wrong. The
 * ALREADY_MAPPED set below mirrors src/provider.ts as of 2026-10-13 and must be
 * updated if that map grows.
 */

const TOKEN = process.env.OANDA_API_TOKEN ?? process.env.OANDA_API_KEY ?? "";

const BASES = ["https://api-fxpractice.oanda.com", "https://api-fxtrade.oanda.com"];

/** RHS values already present in OANDA_INSTRUMENTS (src/provider.ts:68). */
const ALREADY_MAPPED = new Set([
  "AUD_JPY", "DE30_EUR", "EUR_JPY", "EUR_USD", "GBP_JPY", "GBP_USD",
  "JP225_USD", "NAS100_USD", "NZD_USD", "SPX500_USD", "UK100_GBP",
  "US30_USD", "USD_CAD", "USD_JPY", "XAG_USD", "XAU_USD",
]);

interface Instrument {
  name: string;
  type: string;
  displayName: string;
  precision: string;
  pipLocation: number;
  marginRate: string;
}

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0 (compatible; slk-backtest/1.0)",
    },
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url}: ${await r.text()}`);
  return (await r.json()) as T;
}

async function main() {
  if (!TOKEN) {
    console.error("OANDA_API_TOKEN (or OANDA_API_KEY) is not set.");
    process.exit(1);
  }

  // The account id is required for /instruments; it is not derivable offline.
  let base = "";
  let accountId = "";
  for (const b of BASES) {
    try {
      const { accounts } = await get<{ accounts: { id: string }[] }>(`${b}/v3/accounts`);
      if (accounts?.length) {
        base = b;
        accountId = accounts[0].id;
        break;
      }
    } catch (e) {
      console.error(`  ${b}: ${(e as Error).message.split("\n")[0]}`);
    }
  }
  if (!accountId) {
    console.error("\nNo account reachable with this token.");
    process.exit(1);
  }

  const { instruments } = await get<{ instruments: Instrument[] }>(
    `${base}/v3/accounts/${accountId}/instruments`,
  );

  console.log(`account ${accountId} on ${base}`);
  console.log(`${instruments.length} instruments offered\n`);

  const byType = new Map<string, Instrument[]>();
  for (const i of instruments) {
    if (!byType.has(i.type)) byType.set(i.type, []);
    byType.get(i.type)!.push(i);
  }

  for (const [type, list] of [...byType].sort()) {
    console.log(`${type} (${list.length})`);
    console.log(
      list
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((i) => `   ${i.name.padEnd(12)} ${ALREADY_MAPPED.has(i.name) ? "[mapped]" : "        "}`)
        .join("\n"),
    );
    console.log();
  }

  const missing = instruments.filter((i) => !ALREADY_MAPPED.has(i.name));
  console.log(`${missing.length} not yet in OANDA_INSTRUMENTS.\n`);
  console.log("Paste-ready block (canonical name = OANDA name with underscores removed):");
  console.log();
  for (const type of ["CURRENCY", "CFD_METAL", "INDEX", "COMMODITY", "METAL"]) {
    const list = missing.filter((i) => i.type === type);
    if (!list.length) continue;
    console.log(`  // ${type}`);
    for (const i of list.sort((a, b) => a.name.localeCompare(b.name))) {
      console.log(`  ${i.name.replace(/_/g, "")}: "${i.name}",`);
    }
  }
  const other = missing.filter(
    (i) => !["CURRENCY", "CFD_METAL", "INDEX", "COMMODITY", "METAL"].includes(i.type),
  );
  if (other.length) {
    console.log("  // other");
    for (const i of other.sort((a, b) => a.name.localeCompare(b.name))) {
      console.log(`  ${i.name.replace(/_/g, "")}: "${i.name}",`);
    }
  }
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
