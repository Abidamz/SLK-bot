# Market Analysis & Historical Simulation — Architecture Specification

**Status:** Phases 1–3 (requirements, architecture, interfaces). No implementation.
**Scope:** historical data and simulated observations only. No live order execution, no broker
connection, no order placement.
**Date:** 2026-10-13

---

## 0. The question that has to be settled first

A working system already exists in this repository: `worker/scripts/backtest.ts` replays OANDA
and Dukascopy history through the production engine, `worker/src/replay_stats.ts` scores the
result, `worker/src/prop_sim.ts` simulates prop-firm challenges, and 546 tests cover them.

So before any module is designed, one decision governs everything else:

**Is this a new application, or a formalisation of the existing replay?**

The two answers produce different projects:

| | New application | Formalisation |
|---|---|---|
| Risk | Two systems drift; findings stop being comparable | Refactoring risk to a working, tested system |
| Cost | High — re-derives data loading, spread models, outcome logic | Moderate — mostly extraction and typing |
| Value | Clean slate, no legacy constraints | Findings stay comparable with everything measured so far |

**Recommendation: formalisation.** Every number in `docs/BACKTEST_FINDINGS_2026-10-11.md` came from
the current replay. A parallel implementation would make new results incomparable with old ones,
and the comparison *is* the asset. The engineering requirements below are achievable by extracting
what exists behind proper interfaces rather than by rewriting it.

This document is written to serve either answer; the open questions in §1.4 are where the choice
bites.

---

## Phase 1 — Requirements and Assumptions

### Deliverables
1. Functional and non-functional requirements (§1.1, §1.2)
2. Explicit assumptions with the consequence if each is wrong (§1.3)
3. Open questions blocking design (§1.4)

### 1.1 Functional requirements

| ID | Requirement |
|---|---|
| F1 | Load OHLCV history for a named instrument set over a bounded window from at least one provider. |
| F2 | Validate every loaded series before analysis; reject, quarantine and report bad rows rather than silently coercing them. |
| F3 | Evaluate analytical rules that are each individually named, versioned and documented. |
| F4 | Replay history bar-by-bar, producing simulated observations with entry, stop, target and realised outcome. |
| F5 | Score a replay: expectancy, win rate, profit factor, drawdown, streaks, per-instrument and per-timeframe breakdowns. |
| F6 | Run the same replay under alternative configurations and report the difference. |
| F7 | Emit a reproducible report: identical inputs and configuration must produce a byte-identical result. |
| F8 | Emit structured logs sufficient to reconstruct any single simulated observation. |

### 1.2 Non-functional requirements

| ID | Requirement | Why it is here |
|---|---|---|
| N1 | **No look-ahead.** No evaluation at time *t* may read data timestamped after *t*. | This has already bitten this project: a shadow model used a candle's *open* time as if it were its close. |
| N2 | **Determinism.** No wall-clock, no unseeded randomness, no unordered iteration over sets. | A result that cannot be reproduced cannot be argued with. |
| N3 | **Costs are first-class.** Spread and slippage are modelled explicitly, never assumed away. | Measured: cost was 19.19R of 22.51R gross on one 180-day run — 85% of the edge. |
| N4 | **Every knob must fail loudly.** An unrecognised configuration key is an error, not a no-op. | A stale checkout once silently ignored an unknown variable and produced six unusable runs. |
| N5 | **No result may be presented as a forecast.** Reports state the window, the sample size and a confidence interval. | A 17-trade ledger once produced a 95% CI of [−0.20, +1.80]R — indistinguishable from break-even while looking excellent. |
| N6 | **Selection effects must be disclosed.** Any parameter chosen by looking at a window is labelled as fitted on that window. | The best row of a sweep over one window is partly selected by that window. |

### 1.3 Assumptions

| # | Assumption | If wrong |
|---|---|---|
| A1 | Bars are timestamped at their **open** time, and a bar is not actionable until it has closed. | Look-ahead bias throughout. Must be verified per provider, not assumed. |
| A2 | Spread is a per-instrument constant, not a function of volatility or session. | Cost is understated in exactly the volatile conditions where trades cluster. A time-varying model is a later phase. |
| A3 | Fills occur at the next bar's open for market orders, and at the limit price when traded through. | Fill assumptions change measured expectancy; the current replay already models all three and they differ by 17%. |
| A4 | The provider's history is complete — no missing bars. | Gaps silently compress time. Must be detected, not assumed. |
| A5 | One instrument's series is independent of another's for replay purposes. | Correlation matters for drawdown; the prop simulation models it separately and must not inherit an independence assumption. |

### 1.4 Open questions (blocking)

1. **New build or formalisation?** (§0) — governs everything.
2. **Language.** The earlier specification named Python with `pandas_ta` and `ccxt`. This repository is TypeScript on Cloudflare Workers. Mixing them means findings are not comparable across the two. Which wins?
3. **Provider scope.** Only OANDA and Dukascopy are wired today, and a third of live alerts arrive on a 15-minute timeframe the replay cannot represent. Is closing that gap in scope?
4. **Survivorship.** Instrument lists are chosen after seeing results. Is out-of-sample selection a phase-1 requirement or deferred?

### Acceptance criteria for Phase 1
- Every requirement above is either accepted, amended or rejected in writing.
- Every assumption has a named owner and a verification method.
- All four open questions answered.

### Failure modes of this phase
- Requirements written as solutions ("use a queue") rather than needs ("ordered, replayable event stream").
- Assumptions left implicit, then discovered during implementation as bugs.

### Required tests
None yet. Phase 1 produces documents.

---

## Phase 2 — Architecture and Data Flow

### Deliverables
1. Module decomposition with a single responsibility each (§2.1)
2. Data-flow diagram and the invariant enforced at each boundary (§2.2)
3. The look-ahead firewall (§2.3)

### 2.1 Modules

```
┌──────────────────┐
│ A  config        │  declarative, validated, frozen at start
└────────┬─────────┘
         ▼
┌──────────────────┐   ┌──────────────────┐
│ B  ingestion     │──▶│ C  validation &  │
└──────────────────┘   │    normalization │
                       └────────┬─────────┘
                                ▼
                       ┌──────────────────┐
                       │ D  analysis      │  pure: (window, cfg) → observations
                       └────────┬─────────┘
                                ▼
                       ┌──────────────────┐
                       │ E  replay &      │  resolves outcomes, applies costs
                       │    simulation    │
                       └────────┬─────────┘
                                ▼
              ┌─────────────────┴─────────────────┐
              ▼                                   ▼
   ┌──────────────────┐                ┌──────────────────┐
   │ F  risk &        │                │ G  performance   │
   │    scenario mon. │                │    reporting     │
   └──────────────────┘                └──────────────────┘

   H  logging & observability — cross-cutting, structured, present in all
   I  automated testing        — cross-cutting, includes property tests
   J  documentation            — generated from the rule registry where possible
```

**Dependency rule:** arrows point one way. `D` must not import from `E`; `E` must not import from
`G`. Anything two modules need lives in a shared types module with no behaviour.

### 2.2 Data flow and the invariant at each boundary

| Boundary | Invariant enforced |
|---|---|
| B → C | Raw records are untrusted. Nothing downstream may touch them. |
| C → D | Series is gap-checked, timezone-normalised to UTC, monotonic in time, and carries a provenance record. **D may assume cleanliness and must not re-validate.** |
| D → E | Observations are timestamped and carry the configuration version that produced them. |
| E → F/G | Outcomes are final. Neither F nor G may recompute an outcome; they may only aggregate. |

The reason for the last rule: scoring logic duplicated between a simulator and a report is how two
numbers for the same thing end up in the same document.

### 2.3 The look-ahead firewall

This deserves its own section because it is the failure mode that silently invalidates everything
else, and it has already occurred here.

Three mechanisms, all required:

1. **Cursor type.** Module D never receives a series. It receives a `MarketView` that exposes only
   bars at or before a cursor, and throws on any attempt to read beyond it. The restriction is
   structural, not conventional — a reviewer cannot miss it because the API does not offer the
   dangerous operation.
2. **Bar completeness.** A bar is only visible once closed. If the provider timestamps bars at
   their open (A1), the cursor sits at `bar.openTime + bar.duration`, not `bar.openTime`.
3. **Property test.** For any rule, evaluating at cursor *t* over a truncated series must equal
   evaluating at *t* over the full series. This catches leakage that the type system cannot, such
   as a rule that peeks through a cached aggregate.

### Acceptance criteria for Phase 2
- No module imports against the dependency rule; enforced by a test, not a convention.
- The firewall is a type, and the property test in §2.3(3) passes.
- A data-flow walkthrough of one instrument from raw fetch to reported row, with the invariant
  named at each hop.

### Failure modes of this phase
- A "utils" module that everything imports and that quietly couples the system.
- Validation performed twice, in C and again defensively in D, so the two disagree.
- The firewall implemented as a comment rather than a type.

### Required tests
- Import-direction test (static).
- Look-ahead property test (§2.3).
- Gap, duplicate and out-of-order injection at B → C, asserting quarantine rather than coercion.

### Dependencies
Phase 1 answers, especially §1.4(1) and (2).

---

## Phase 3 — Module Interfaces and Data Schemas

### Deliverables
1. Typed schemas for every boundary (§3.1)
2. Module interface signatures (§3.2)
3. The rule registry contract (§3.3)

Signatures are given in TypeScript-flavoured pseudocode. If §1.4(2) resolves to Python, the shapes
carry over directly; the optionality and the invariants are the content, not the syntax.

### 3.1 Schemas

```ts
/** Provenance travels with the data. A result whose source cannot be named
 *  cannot be reproduced, and an unreproducible result is an anecdote. */
type Provenance = {
  provider: string;          // "oanda" | "dukascopy" | ...
  instrument: string;        // canonical symbol, not the provider's alias
  fetchedAt: string;         // ISO-8601 UTC
  windowStart: string;
  windowEnd: string;
  barCount: number;
  contentHash: string;       // hash of the normalised series
};

type Bar = {
  openTime: string;          // ISO-8601 UTC. Explicit: never a local time.
  durationSec: number;       // carried, not inferred, so gaps are detectable
  open: number; high: number; low: number; close: number;
  volume: number | null;     // null is honest; 0 is a claim
};

type Series = {
  provenance: Provenance;
  bars: readonly Bar[];      // ascending openTime, no duplicates, no gaps
};

/** What ingestion produced, including what it refused. Quarantined rows are
 *  reported, never dropped silently — a loader that hides its rejects makes a
 *  short series look like a quiet market. */
type IngestionResult = {
  series: Series;
  quarantined: ReadonlyArray<{ raw: unknown; reason: string }>;
};

/** A rule is named, versioned and documented. The version is part of every
 *  result so that a number can always be traced to the rule that produced it. */
type RuleDescriptor = {
  id: string;                // "strong_pivot"
  version: string;           // "1.2.0"
  summary: string;           // one sentence, human-readable
  params: Readonly<Record<string, number | string | boolean>>;
};

type Observation = {
  rule: RuleDescriptor;
  instrument: string;
  timeframe: string;
  direction: "LONG" | "SHORT";
  signalTime: string;        // the close that triggered it — never a bar open
  entry: number; stop: number; target: number;
  context: Readonly<Record<string, unknown>>;   // rule-specific evidence
};

type Outcome = {
  status: "TP" | "SL" | "BE" | "EXPIRED" | "OPEN";
  exitPrice: number | null;
  exitTime: string | null;
  rMultiple: number | null;  // null when unresolved; never 0, which reads as a scratch
  costR: number;             // spread + slippage, charged explicitly (N3)
};

type ScoredTrade = { observation: Observation; outcome: Outcome };
```

### 3.2 Module interfaces

```ts
// A — configuration
interface ConfigStore {
  load(source: string): FrozenConfig;      // throws on unknown keys (N4)
}

// B — ingestion
interface Ingester {
  fetch(req: DataRequest): Promise<IngestionResult>;
}

// C — validation
interface Validator {
  validate(raw: IngestionResult): ValidationResult;   // Series | Rejected
}

// D — analysis. PURE. No I/O, no clock, no randomness.
interface Analyzer {
  /** The view is cursor-bounded; reading ahead throws (§2.3). */
  evaluate(view: MarketView, rules: readonly RuleDescriptor[]): readonly Observation[];
}

// E — replay
interface Replayer {
  run(series: Series, analyzer: Analyzer, cfg: FrozenConfig): readonly ScoredTrade[];
}

// F — risk
interface RiskMonitor {
  assess(trades: readonly ScoredTrade[], limits: RiskLimits): RiskReport;
}

// G — reporting
interface Reporter {
  render(trades: readonly ScoredTrade[], meta: RunMeta): Report;
}
```

`Analyzer.evaluate` is pure by contract. That single constraint is what makes the whole system
testable: a rule can be exercised on a hand-built candle array with no provider, no cache and no
clock, which is how the current rule tests work and why they run in milliseconds.

### 3.3 The rule registry

Rules self-register with a descriptor and an implementation. Three consequences, all deliberate:

1. **Documentation cannot drift.** The report lists rules from the registry, so a rule that exists
   in code but not in the docs is visibly absent rather than silently undocumented.
2. **Every result names its rule version.** When a rule changes, old and new results are
   distinguishable instead of silently incomparable.
3. **Unknown knobs fail.** The registry is the authority on what parameters exist, which is how
   N4 is enforced rather than hoped for.

### Acceptance criteria for Phase 3
- Every boundary in §2.2 has exactly one schema, and no module reaches around it.
- `Observation.signalTime` is documented as a bar **close**, with the reason stated.
- `Outcome.rMultiple` is nullable and no code path defaults it to 0.
- A round-trip test: schema → serialise → deserialise → deep-equal.

### Failure modes of this phase
- `Record<string, unknown>` used as an escape hatch until the context field is untyped everywhere.
- Nullable fields defaulted to zero at the boundary, destroying the distinction between "no result"
  and "a result of nothing".
- Timestamps as epoch numbers, so a seconds/milliseconds mistake is invisible.

### Required tests
- Schema round-trip.
- Serialisation stability (same input → same bytes), which underwrites F7.
- A test that an `OPEN` outcome carries `rMultiple: null`, not `0`.

### Dependencies
Phase 2 module boundaries.

---

## Deliberately not in this document

Phases 4–7 (testing strategy, first component, test results, incremental expansion) are out of
scope here, per the instruction not to implement the application in one response.

Two things are worth flagging for Phase 4 rather than leaving to be discovered:

- **Mutation testing belongs in the strategy, not as an afterthought.** A test that passes with the
  logic deleted is worse than no test, because it is trusted. This project has shipped both kinds.
- **The test suite must include the failure modes, not only the happy path** — missing bars,
  duplicate timestamps, a provider returning a short series, a config key misspelled. Each of
  these has happened here.

## Assumptions and limitations of this document

- Written against the current state of this repository at commit `3cc49fb`.
- Assumes §1.4(1) resolves to formalisation; the module boundaries hold either way but the
  migration path does not.
- Does not address live execution, position sizing against a real account, or order routing. The
  brief excludes them and nothing here should be read as a step toward them.
- Nothing in this document is a claim about future market behaviour. It specifies software.
