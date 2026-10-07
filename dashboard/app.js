const DEFAULT_URL = (typeof window !== 'undefined' && window.location && window.location.hostname && window.location.hostname.includes('workers.dev'))
  ? window.location.origin
  : 'https://slk-alert-worker.abidogundamilola.workers.dev';

const state = {
  url: DEFAULT_URL,
  adminKey: (typeof localStorage !== 'undefined' && localStorage.getItem('slkAdminKey')) || '',
  alerts: [],
  alertPage: 1,
  alertTotal: 0,
  alertPageSize: 25,
  perfPeriod: 'all',
  perfFrom: '',
  perfTo: '',
  marketSegment: 'all'
};

const $ = id => document.getElementById(id);

document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab, .tab-panel').forEach(x => x.classList.remove('active'));
    btn.classList.add('active');
    const panel = $(btn.dataset.tab);
    if (panel) panel.classList.add('active');
  });
});

function setViewMode(mode) {
  state.viewMode = mode === 'operator' ? 'operator' : 'public';
  document.body.classList.toggle('operator-mode', state.viewMode === 'operator');
  if ($('modePublicBtn')) $('modePublicBtn').classList.toggle('active', state.viewMode === 'public');
  if ($('modeOperatorBtn')) $('modeOperatorBtn').classList.toggle('active', state.viewMode === 'operator');
  if ($('activeModeLabel')) {
    $('activeModeLabel').textContent = state.viewMode === 'operator' ? 'Viewing: Operator Terminal' : 'Viewing: Public Overview';
    $('activeModeLabel').className = state.viewMode === 'operator' ? 'pill green' : 'pill gray';
  }
  try { localStorage.setItem('slkViewMode', state.viewMode); } catch (_) {}
}

if ($('modePublicBtn')) $('modePublicBtn').addEventListener('click', () => setViewMode('public'));
if ($('modeOperatorBtn')) $('modeOperatorBtn').addEventListener('click', () => setViewMode('operator'));
if ($('heroLedgerBtn')) {
  $('heroLedgerBtn').addEventListener('click', () => {
    const alertsTab = document.querySelector('.tab[data-tab="alerts"]');
    if (alertsTab) alertsTab.click();
  });
}

function setMarketSegment(seg) {
  state.marketSegment = seg || 'all';
  document.querySelectorAll('.segment-btn').forEach(b => {
    b.classList.toggle('active', (b.dataset.segment || 'all') === state.marketSegment);
  });
  document.querySelectorAll('.segment-card').forEach(card => {
    const target = card.dataset.targetSegment;
    card.classList.toggle('active', target === state.marketSegment);
  });
  document.querySelectorAll('.syntheticsNotice').forEach(el => {
    el.hidden = state.marketSegment !== 'synthetics';
  });
  if ($('syntheticsNotice')) {
    $('syntheticsNotice').hidden = state.marketSegment !== 'synthetics';
  }
  state.alertPage = 1;
  loadStats();
  loadAlerts();
}

document.querySelectorAll('.segment-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    setMarketSegment(btn.dataset.segment || 'all');
  });
});

document.querySelectorAll('.segment-card').forEach(card => {
  card.addEventListener('click', () => {
    const target = card.dataset.targetSegment;
    if (target) {
      if (state.marketSegment === target) {
        setMarketSegment('all');
      } else {
        setMarketSegment(target);
      }
    }
  });
});

document.querySelectorAll('.period-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.perfPeriod = btn.dataset.period || 'all';
    state.perfFrom = '';
    state.perfTo = '';
    if ($('perfFromDate')) $('perfFromDate').value = '';
    if ($('perfToDate')) $('perfToDate').value = '';
    loadStats();
  });
});

if ($('applyPerfDates')) {
  $('applyPerfDates').addEventListener('click', () => {
    const from = $('perfFromDate') ? $('perfFromDate').value : '';
    const to = $('perfToDate') ? $('perfToDate').value : '';
    if (!from && !to) return;
    document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
    state.perfPeriod = 'custom';
    state.perfFrom = from || '';
    state.perfTo = to || '';
    loadStats();
  });
}

if ($('resetPerfDates')) {
  $('resetPerfDates').addEventListener('click', () => {
    state.perfPeriod = 'all';
    state.perfFrom = '';
    state.perfTo = '';
    if ($('perfFromDate')) $('perfFromDate').value = '';
    if ($('perfToDate')) $('perfToDate').value = '';
    document.querySelectorAll('.period-btn').forEach(b => {
      if (b.dataset.period === 'all') b.classList.add('active');
      else b.classList.remove('active');
    });
    loadStats();
  });
}

if ($('refreshBtn')) $('refreshBtn').addEventListener('click', loadAll);

function formatScanAuditReport(report) {
  const scan = report?.scan || {};
  const delivery = report?.delivery || {};
  const errors = scan.errorCategories || {};
  const dailyRows = Array.isArray(scan.byDay) ? scan.byDay : [];
  const storedAlertRows = Array.isArray(scan.storedAlertsByDay) ? scan.storedAlertsByDay : [];
  const gateMetricsRows = dailyRows.reduce((total, day) => total + Number(day.gateMetricsRows || 0), 0);
  const storedAlertCount = storedAlertRows.reduce((total, row) => total + Number(row.count || 0), 0);
  const lines = [
    `Window (UTC): ${report?.window?.fromUtc || '—'} to ${report?.window?.toUtc || '—'}`,
    `Scan records: ${scan.scanRows ?? 0} total; ${scan.activeScanRows ?? 0} covered at least one market.`,
    `First/last scan: ${scan.firstScanUtc || 'none'} / ${scan.lastScanUtc || 'none'}.`,
    `Scan records with errors: ${scan.scanErrorRows ?? 0}.`,
    `Error rows by keyword match (not unique incidents): stale-feed ${errors.staleFeed ?? 0}; rate-limit/credits ${errors.rateLimitOrCredits ?? 0}; network/timeout ${errors.networkOrTimeout ?? 0}; other ${errors.other ?? 0}.`,
    `Scan-log alert insert counts: ${scan.alertRowsWritten ?? 0}; event insert counts: ${scan.eventRowsWritten ?? 0}.`,
    `Grouped rows in stored-alert table: ${scan.storedAlertsAvailable ? storedAlertCount : 'unavailable'}; these database rows do not prove message delivery.`,
    `Diagnostic rows: ${scan.diagnosticRows ?? 0} valid; ${scan.invalidDiagnosticRows ?? 0} invalid; available: ${scan.diagnosticsAvailable ? 'yes' : 'no'}.`,
    `Recorded confirmed-alert inserts: ${scan.recordedConfirmedAlerts ?? 0}.`,
    `Freshness/deduplication skip counts: ${gateMetricsRows} scan logs have these counters; stale ${dailyRows.reduce((n, d) => n + Number(d.staleConfirmationSkips || 0), 0)}, duplicate ${dailyRows.reduce((n, d) => n + Number(d.duplicateConfirmationSkips || 0), 0)}.`,
    'A day with zero counter-coverage means the old logs did not record these skips; it does not mean there were no skips.',
    '',
    'Daily scan and replay breakdown (UTC; replay numbers include repeat scans):',
  ];
  if (!dailyRows.length) lines.push('  Daily breakdown unavailable.');
  for (const day of dailyRows) {
    const c = day.errorCategories || {};
    lines.push(`  ${day.utcDay}: scans ${day.scanRows ?? 0} (${day.activeScanRows ?? 0} active), errors ${day.scanErrorRows ?? 0} [stale ${c.staleFeed ?? 0}, rate/credits ${c.rateLimitOrCredits ?? 0}, network ${c.networkOrTimeout ?? 0}, other ${c.other ?? 0}], diagnostics ${day.diagnosticRows ?? 0}, scan-log alert inserts ${day.alertRowsWritten ?? 0}, confirmed inserts ${day.recordedConfirmedAlerts ?? 0}, replay RETEST ${day.replayRetestTransitions ?? 0}, candidates ${day.retestCandidates ?? 0}, target/risk rejects ${day.targetRejects ?? 0}/${day.riskRejects ?? 0}, stale/duplicate skips ${day.staleConfirmationSkips ?? 0}/${day.duplicateConfirmationSkips ?? 0} (${day.gateMetricsRows ?? 0} covered).`);
  }
  lines.push('', 'Stored alert rows by UTC day / market / timeframe / alert status / trade status / suppress reason:');
  if (!scan.storedAlertsAvailable) lines.push('  Stored-alert table unavailable.');
  else if (!storedAlertRows.length) lines.push('  No stored alert rows in this window.');
  for (const row of storedAlertRows) {
    const reason = row.suppressReason ? ` — ${row.suppressReason}` : '';
    lines.push(`  ${row.utcDay} ${row.pair} ${row.timeframe} ${row.direction} / alert ${row.alertStatus}, trade ${row.tradeStatus}: ${row.count}${reason}`);
  }
  lines.push(
    '',
    `First tracked delivery result: ${delivery.firstTrackedUtc || 'none recorded'}.`,
    'Delivery audit writes are best-effort; missing rows do not prove that a message was not sent.',
    'Delivery counts below are channel API results, not proof the recipient saw the message:',
  );
  const deliveryRows = Array.isArray(delivery.byChannel) ? delivery.byChannel : [];
  if (!deliveryRows.length) lines.push('  No tracked delivery results in this window.');
  for (const row of deliveryRows) {
    lines.push(`  ${row.kind} / ${row.channel}: ${row.delivered} delivered, ${row.partial} partial, ${row.failed} failed, ${row.notConfigured} not configured.`);
  }
  lines.push('', 'Pair/timeframe funnel totals (replay counts; repeats are not unique setups):');
  const funnelRows = Array.isArray(scan.byPairTimeframe) ? scan.byPairTimeframe : [];
  if (!funnelRows.length) lines.push('  No per-pair/timeframe diagnostics available.');
  for (const row of funnelRows) {
    const f = row.replay || {};
    lines.push(`  ${row.pair} ${row.timeframe}: MAP ${f.MAP ?? 0} → TOUCH ${f.TOUCH ?? 0} → SWEEP ${f.SWEEP ?? 0} → SHIFT ${f.SHIFT ?? 0} → RETEST ${f.RETEST ?? 0}; target rejects ${f.targetRejects ?? 0}; risk rejects ${f.riskRejects ?? 0}.`);
  }
  for (const caveat of Array.isArray(report?.caveats) ? report.caveats : []) lines.push(`Note: ${caveat}`);
  return lines.join('\n');
}

if ($('runScanAuditBtn')) {
  $('runScanAuditBtn').addEventListener('click', async () => {
    const button = $('runScanAuditBtn');
    const output = $('scanAuditResults');
    button.disabled = true;
    button.textContent = 'Running…';
    if (output) output.textContent = 'Running the read-only 21-day audit…';
    try {
      const report = await api('/api/scan-audit?days=21', { admin: true });
      if (output) output.textContent = formatScanAuditReport(report);
    } catch (err) {
      if (output) output.textContent = `Audit unavailable: ${err.message || String(err)}`;
    } finally {
      button.disabled = false;
      button.textContent = 'Run 21-Day Audit';
    }
  });
}

['alertPair', 'alertTimeframe', 'alertDirection', 'alertLifecycle', 'alertSort', 'alertFrom', 'alertTo'].forEach(id => {
  const el = $(id);
  if (el) el.addEventListener('change', () => { state.alertPage = 1; loadAlerts(); });
});

if ($('alertSearch')) {
  $('alertSearch').addEventListener('input', debounce(() => {
    state.alertPage = 1;
    loadAlerts();
  }, 350));
}

if ($('clearAlertFilters')) $('clearAlertFilters').addEventListener('click', clearAlertFilters);
if ($('prevAlerts')) $('prevAlerts').addEventListener('click', () => {
  if (state.alertPage > 1) {
    state.alertPage--;
    loadAlerts();
  }
});
if ($('nextAlerts')) $('nextAlerts').addEventListener('click', () => {
  if (state.alertPage * state.alertPageSize < state.alertTotal) {
    state.alertPage++;
    loadAlerts();
  }
});

if ($('savePreferences')) $('savePreferences').addEventListener('click', savePreferences);
if ($('testTelegram')) $('testTelegram').addEventListener('click', () => testNotification('telegram'));

['expireOpenBtn', 'expireOpenTradesBtn'].forEach(id => {
  const btn = $(id);
  if (btn) {
    btn.addEventListener('click', async () => {
      if (!confirm('Close all currently open trades as Expired?')) return;
      const oldText = btn.textContent;
      btn.textContent = 'Closing…';
      btn.disabled = true;
      try {
        const res = await api('/admin/expire-open');
        alert(res.message || 'Open trades marked as EXPIRED.');
        await loadAll();
      } catch (err) {
        alert('Failed to close open trades: ' + (err.message || String(err)));
      } finally {
        btn.textContent = oldText;
        btn.disabled = false;
      }
    });
  }
});

if ($('clearSyntheticsBtn')) {
  $('clearSyntheticsBtn').addEventListener('click', async () => {
    if (!confirm('Purge all synthetic trade records from the journal?\n\nThis will restore the public overview to Institutional-only (+30.78R, 75.0% Win Rate) and give 24/7 Synthetics a clean slate under the active HTF conflict filter.')) return;
    const btn = $('clearSyntheticsBtn');
    const oldText = btn.textContent;
    btn.textContent = 'Purging…';
    btn.disabled = true;
    try {
      const res = await api('/admin/clear-synthetics', { method: 'POST' });
      alert(res.message || 'Synthetic trade records cleared successfully!');
      await loadAll();
    } catch (err) {
      alert('Failed to clear synthetic records: ' + (err.message || String(err)));
    } finally {
      btn.textContent = oldText;
      btn.disabled = false;
    }
  });
}

function clearAdminKey() {
  state.adminKey = '';
  try { localStorage.removeItem('slkAdminKey'); } catch (_) {}
}

async function getAdminKey(forcePrompt = false) {
  if (forcePrompt) clearAdminKey();
  if (!state.adminKey) {
    try { state.adminKey = localStorage.getItem('slkAdminKey') || ''; } catch (_) {}
  }
  if (state.adminKey) return state.adminKey;
  const key = window.prompt('Enter Admin Key:');
  if (key && key.trim()) {
    state.adminKey = key.trim();
    try { localStorage.setItem('slkAdminKey', state.adminKey); } catch (_) {}
  }
  return state.adminKey;
}

async function api(path, options = {}) {
  const isAdmin = Boolean(options.admin || path.startsWith('/admin/'));
  if (isAdmin) {
    const key = await getAdminKey();
    if (!key) throw new Error('Admin key required.');
  }
  const headers = {
    ...(options.headers || {}),
    ...(isAdmin && state.adminKey ? { 'x-admin-key': state.adminKey, Authorization: `Bearer ${state.adminKey}` } : {}),
    ...(options.body ? { 'Content-Type': 'application/json' } : {})
  };
  const requestOptions = { ...options };
  delete requestOptions.admin;
  delete requestOptions._retried;
  const r = await fetch(state.url.replace(/\/$/, '') + path, { ...requestOptions, headers });
  if (r.status === 401 && isAdmin) {
    clearAdminKey();
    if (!options._retried) {
      const retryKey = await getAdminKey(true);
      if (retryKey) {
        return api(path, { ...options, _retried: true });
      }
    }
    throw new Error('401 Unauthorized — invalid admin key.');
  }
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

async function loadAll() {
  setStatus('Syncing paper ledger…', 'muted');
  try {
    const [health, _stats, prefs, pulse] = await Promise.all([
      api('/health').catch(() => null),
      loadStats(),
      api('/dashboard/preferences/notifications').catch(() => null),
      api('/api/engine-pulse').catch(() => null)
    ]);
    if (health) renderHealth(health);
    if (prefs) renderPreferences(prefs);
    renderEnginePulse(pulse);
    await loadAlerts();
    setStatus('Worker Online · Pipeline Healthy', 'ok');
  } catch (e) {
    setStatus('Feed offline', 'bad');
  }
}

// ── Engine Pulse: read-only 24h aggregate of recorded scan diagnostics ──
function renderEnginePulse(p) {
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const put = (id, v) => { const el = $(id); if (el) el.textContent = (v == null ? '—' : String(v)); };
  if (!p || p.ok === false) {
    if ($('enginePulseSummary')) $('enginePulseSummary').textContent = 'Engine pulse unavailable right now — it rebuilds automatically from recorded scan diagnostics.';
    return;
  }
  const mapRows = num(p.evaluated);
  const touchRows = num(p.chains && p.chains.TOUCH);
  const retestRows = num(p.chains && p.chains.RETEST);
  const alertRows = num(p.confirmed);
  const summary = $('enginePulseSummary');
  if (summary) {
    const head = `${mapRows} MAP event rows · ${touchRows} TOUCH event rows · ${retestRows} RETEST event rows · ${alertRows} alert rows inserted`;
    summary.textContent = alertRows > 0
      ? `${head}. Alert rows are persisted before delivery gates; this is not proof a Telegram message was sent.`
      : `${head}. No alert row was stored in this window; this is a pipeline count, not a strategy-performance verdict.`;
  }
  put('epEvaluated', mapRows);
  put('epTouch', touchRows);
  put('epSweep', num(p.chains && p.chains.SWEEP));
  put('epShift', num(p.chains && p.chains.SHIFT));
  put('epRetest', retestRows);
  put('epConfirmed', alertRows);
  put('epScans', num(p.scans));
  put('epPairs', num(p.pairsCovered));
  const rej = p.rejections || {};
  const bits = [];
  if (num(rej.belowMinRiskAtr)) bits.push(`${num(rej.belowMinRiskAtr)} below the 0.8×ATR risk floor`);
  if (num(rej.aboveMaxStopAtr)) bits.push(`${num(rej.aboveMaxStopAtr)} above the stop ceiling`);
  if (num(rej.nonPositiveRisk)) bits.push(`${num(rej.nonPositiveRisk)} non-positive risk`);
  if (num(rej.targetFloor)) bits.push(`${num(rej.targetFloor)} under the 2.5R target floor`);
  const replayNote = 'Counts are replay attempts, not unique setups; the same opportunity can recur across scans.';
  const rejEl = $('enginePulseRejections');
  if (rejEl) rejEl.textContent = bits.length
    ? `Replay rejection attempts: ${bits.join(' · ')}. ${replayNote}`
    : `No rejection attempts recorded in this window; that does not mean every market or candidate passed. ${replayNote}`;
  // Confirmation funnel: discovery latency per entry timeframe. Shows how many
  // confirmations reached the live gate, how many were discovered inside the
  // freshness window, and how long discovery took — the difference between
  // "no setup formed" and "a setup formed but we looked too late".
  const funnels = Array.isArray(p.confirmations) ? p.confirmations : [];
  const funnelEl = $('enginePulseFunnel');
  if (funnelEl) {
    const fmtAge = (sec) => (num(sec) >= 90 ? (num(sec) / 60).toFixed(1) + ' min' : num(sec) + 's');
    funnelEl.textContent = funnels.length
      ? 'Confirmation funnel (last 24h): ' + funnels.map((f) => f.timeframe + ': ' + num(f.built)
        + ' reached the live gate, ' + num(f.fresh) + ' inside the freshness window, '
        + num(f.inserted) + ' stored, ' + num(f.stale) + ' dropped stale (avg discovery '
        + fmtAge(f.avgAgeSec) + (num(f.nearMiss) ? ', ' + num(f.nearMiss) + ' near-miss' : '') + ')').join(' · ')
      : 'Confirmation funnel: no confirmation reached the live gate in this window — no setup completed the full chain yet.';
  }

  // Phase timings: where each tick's wall clock actually goes. This is the
  // number that decides scan cadence, and therefore how much of the freshness
  // window is left for discovery.
  const timing = (p.timing && typeof p.timing === 'object') ? p.timing : null;
  const timingEl = $('enginePulseTiming');
  if (timingEl) {
    const secs = (ms) => (num(ms) / 1000).toFixed(1);
    timingEl.textContent = timing && num(timing.ticks) > 0
      ? 'Tick cost (last 24h, ' + num(timing.ticks) + ' timed ticks): pair scan '
        + secs(timing.avgPairScanMs) + 's avg / ' + secs(timing.maxPairScanMs) + 's max · live resolve '
        + secs(timing.avgLiveResolveMs) + 's · shadow resolve ' + secs(timing.avgShadowResolveMs)
        + 's for ' + num(timing.avgShadowChecked) + ' of ' + num(timing.avgShadowGroups)
        + ' open research groups per tick · ' + num(timing.avgHttpCalls) + ' HTTP requests/tick (max '
        + num(timing.maxHttpCalls) + ')'
      : 'Tick cost: no phase timings recorded in this window yet.';
  }
}

async function loadStats() {
  try {
    const p = new URLSearchParams();
    if (state.perfPeriod && state.perfPeriod !== 'all' && state.perfPeriod !== 'custom') {
      p.set('period', state.perfPeriod);
    }
    if (state.perfPeriod === 'custom' || state.perfFrom || state.perfTo) {
      if (state.perfFrom) p.set('from', state.perfFrom);
      if (state.perfTo) p.set('to', state.perfTo);
    }
    if (state.marketSegment && state.marketSegment !== 'all') {
      p.set('segment', state.marketSegment);
    }
    const qs = p.toString();
    const s = await api(`/stats${qs ? `?${qs}` : ''}`);
    renderStats(s);
    return s;
  } catch (e) {
    console.error('Failed to load stats:', e);
    return null;
  }
}

function setStatus(text, kind) {
  if ($('statusText')) $('statusText').textContent = text;
  if ($('statusDot')) $('statusDot').className = `dot ${kind}`;
}

function renderHealth(h) {
  if (!h) return;
  if ($('mode')) $('mode').textContent = 'PAPER PIPELINE · RULE-CHECKED';
  if ($('workerName')) $('workerName').textContent = 'slk-alert-worker';
  if ($('lastResponse')) $('lastResponse').textContent = new Date().toLocaleTimeString();
  if ($('opWorkerHealth')) $('opWorkerHealth').textContent = `${esc(h.version || 'v2.5.3')} · Healthy (${esc(String(h.mode || 'PAPER').toUpperCase())})`;
  if ($('opLastScan') && h.time) $('opLastScan').textContent = fmtDate(h.time);
  if (h.pairs && h.pairs.length) {
    if ($('pairs')) $('pairs').textContent = h.pairs.join(' · ');
    const pairSelect = $('alertPair');
    if (pairSelect) {
      const curVal = pairSelect.value;
      pairSelect.innerHTML = '<option value="">All pairs</option>' + h.pairs.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
      pairSelect.value = curVal;
    }
  }
  if ($('healthPill')) {
    $('healthPill').textContent = h.ok ? 'Worker Online' : 'Degraded';
    $('healthPill').className = `pill ${h.ok ? 'green' : 'gray'}`;
  }
  if ($('opFeeds')) {
    $('opFeeds').textContent = h.oandaConfigured
      ? 'OANDA v3 (Indices + Metals) · Twelve Data (FX/Metals) · Dukascopy failover · Deriv 24/7 (Synth)'
      : 'Twelve Data (FX/Metals) · Dukascopy (Indices failover) · Deriv 24/7 (Synth)';
  }
  if ($('healthDetails')) {
    $('healthDetails').innerHTML = `
      <div class="health-item"><span>Cloud Service</span><strong>slk-alert-worker</strong></div>
      <div class="health-item"><span>Engine Version</span><strong style="color: #2ecc71; font-family: monospace;">${esc(h.version || 'v2.5.3')} (Production)</strong></div>
      <div class="health-item"><span>System Status</span><strong style="color: #2ecc71;">Operational · 24/7 Continuous</strong></div>
      <div class="health-item"><span>VIP Notification Policy</span><strong style="color: #2ecc71;">${esc(h.feedStatus || 'Confirmed Entries Only (Zero Spam)')}</strong></div>
      <div class="health-item"><span>Active Timeframes</span><strong>${esc((h.entryTfs || []).join(' · ') || '15m · 30m · 1h')}</strong></div>
      <div class="health-item"><span>Deriv Synthetics Relay</span><strong>${esc(h.relayUrl || 'https://slk-bot.vercel.app')} · Connected</strong></div>
      <div class="health-item"><span>Server Time (UTC)</span><strong>${esc(h.time || '—')}</strong></div>
      <div class="health-item"><span>Coverage</span><strong>${(h.pairs || []).length} Markets Active</strong></div>
      <div class="health-item"><span>Execution Mode</span><strong>Paper Pipeline · Rule-Checked (Simulation Only)</strong></div>
      <div class="health-item"><span>Signals Destination</span><strong>Trade journal Channel</strong></div>
    `;
  }
}

function fmtDateOnly(x) {
  if (!x) return '';
  const d = new Date(x);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

function renderStats(s) {
  if (!s) return;
  const netRNum = Number(s.netR || 0);
  const netRText = s.netR == null ? (s.total === 0 ? '0.00R' : 'Syncing…') : `${netRNum > 0 ? '+' : ''}${netRNum.toFixed(2)}R`;
  if ($('total')) $('total').textContent = s.total != null ? String(s.total) : '0';
  if ($('open')) $('open').textContent = s.open != null ? String(s.open) : '0';
  if ($('tp')) $('tp').textContent = s.tp != null ? String(s.tp) : '0';
  if ($('sl')) $('sl').textContent = s.sl != null ? String(s.sl) : '0';
  if ($('expired')) $('expired').textContent = s.expired != null ? String(s.expired) : '0';
  if ($('completed')) $('completed').textContent = s.completed != null ? String(s.completed) : '0';

  const updateNetRElement = (el, val) => {
    if (!el) return;
    const num = Number(val);
    el.classList.remove('accent-text', 'profit-text', 'loss-text');
    if (isNaN(num) || num === 0) {
      el.classList.add('accent-text');
    } else if (num < 0) {
      el.classList.add('loss-text');
    } else {
      el.classList.add('profit-text');
    }
  };

  if ($('overviewNetR')) {
    $('overviewNetR').textContent = netRText;
    updateNetRElement($('overviewNetR'), s.netR);
  }
  if ($('netR')) {
    $('netR').textContent = netRText;
    updateNetRElement($('netR'), s.netR);
  }
  if ($('maxDD')) {
    const ddNum = Number(s.maxDD || 0);
    $('maxDD').textContent = s.maxDD == null ? '0.00R' : `${ddNum.toFixed(2)}R`;
    $('maxDD').classList.remove('loss-text', 'profit-text');
    if (ddNum < 0) $('maxDD').classList.add('loss-text');
  }
  const winRateText = s.winRate == null ? (s.total === 0 ? 'N/A' : 'Syncing…') : `${(s.winRate * 100).toFixed(1)}%`;
  if ($('winRate')) $('winRate').textContent = winRateText;
  if ($('perfWinRate')) $('perfWinRate').textContent = winRateText;

  if (s.segments) {
    const inst = s.segments.institutional || {};
    const synth = s.segments.synthetics || {};
    const instWr = inst.winRate != null ? `${(inst.winRate * 100).toFixed(1)}%` : '—';
    const instNr = inst.netR != null ? `${inst.netR > 0 ? '+' : ''}${Number(inst.netR).toFixed(2)}R` : '—';
    const instOut = `${inst.tp || 0} TP · ${inst.sl || 0} SL`;

    const synthWr = synth.winRate != null ? `${(synth.winRate * 100).toFixed(1)}%` : '0.0%';
    const synthNr = synth.netR != null ? `${synth.netR > 0 ? '+' : ''}${Number(synth.netR).toFixed(2)}R` : '0.00R';
    const synthOut = `${synth.tp || 0} TP · ${synth.sl || 0} SL`;

    ['segInstWinRate', 'segInstWinRateOverview'].forEach(id => { if ($(id)) $(id).textContent = instWr; });
    ['segInstNetR', 'segInstNetROverview'].forEach(id => {
      const el = $(id);
      if (el) {
        el.textContent = instNr;
        updateNetRElement(el, inst.netR);
      }
    });
    ['segInstOutcomes', 'segInstOutcomesOverview'].forEach(id => { if ($(id)) $(id).textContent = instOut; });
    ['segInstSignals', 'segInstSignalsOverview'].forEach(id => { if ($(id)) $(id).textContent = String(inst.total || 0); });

    ['segSynthWinRate', 'segSynthWinRateOverview'].forEach(id => { if ($(id)) $(id).textContent = synthWr; });
    ['segSynthNetR', 'segSynthNetROverview'].forEach(id => {
      const el = $(id);
      if (el) {
        if (!synth.total || synth.total === 0) {
          el.innerHTML = '0.00R <span class="empty-notice-pill">No completed paper outcomes yet</span>';
          updateNetRElement(el, 0);
        } else {
          el.textContent = synthNr;
          updateNetRElement(el, synth.netR);
        }
      }
    });
    ['segSynthOutcomes', 'segSynthOutcomesOverview'].forEach(id => { if ($(id)) $(id).textContent = synthOut; });
    ['segSynthSignals', 'segSynthSignalsOverview'].forEach(id => { if ($(id)) $(id).textContent = String(synth.total || 0); });
  }

  const segBadgeText = state.marketSegment === 'synthetics' ? '⚡ Synthetics' : state.marketSegment === 'institutional' ? '🏛️ Institutional' : 'All';
  ['overviewNetRSegmentBadge', 'overviewWinRateSegmentBadge', 'overviewOpenSegmentBadge', 'overviewTotalSegmentBadge'].forEach(id => {
    if ($(id)) $(id).textContent = segBadgeText;
  });
  
  if ($('perfPeriodBadge')) $('perfPeriodBadge').textContent = s.periodLabel || 'All Time';
  if ($('perfPeriodLabel')) $('perfPeriodLabel').textContent = s.periodLabel || 'All Time';
  if ($('perfDateSpan')) {
    if (s.firstDate && s.lastDate) {
      const startStr = fmtDateOnly(s.firstDate);
      const endStr = fmtDateOnly(s.lastDate);
      $('perfDateSpan').textContent = startStr === endStr ? startStr : `${startStr} to ${endStr}`;
    } else if (s.from || s.to) {
      $('perfDateSpan').textContent = `${fmtDateOnly(s.from) || 'Start'} to ${fmtDateOnly(s.to) || 'Present'}`;
    } else {
      $('perfDateSpan').textContent = 'All Recorded Outcomes';
    }
  }
  if ($('overviewPeriodBadge')) {
    $('overviewPeriodBadge').textContent = s.periodLabel ? `Period: ${s.periodLabel}` : 'All-Time Record';
  }

  renderBreakdown(s.breakdown || []);
}

function renderBreakdown(rows) {
  const el = $('performanceBreakdown');
  if (!el) return;
  if (!rows || !rows.length) {
    el.innerHTML = '<div class="empty">No completed outcomes recorded for this period.</div>';
    return;
  }
  el.innerHTML = rows.map(r => {
    let dateContext = 'Active Track Record';
    if (r.firstDate && r.lastDate) {
      const f = fmtDateOnly(r.firstDate);
      const l = fmtDateOnly(r.lastDate);
      dateContext = f === l ? `Date: ${l}` : `${f} → ${l}`;
    }
    const isSynth = r.group && (r.group.startsWith('V') || r.group.startsWith('R_'));
    const groupBadge = isSynth
      ? '<span class="market-tag synth-tag" style="margin-left:6px;">⚡ 24/7 SYNTHETICS</span>'
      : '';
    const netRVal = Number(r.netR || 0);
    const maxDDVal = Number(r.maxDD || 0);
    const netRClass = netRVal < 0 ? 'loss-text' : (netRVal > 0 ? 'profit-text' : '');
    const maxDDClass = maxDDVal < 0 ? 'loss-text' : '';
    const rowBClass = netRVal < 0 ? 'loss-text' : (netRVal > 0 ? 'profit-text' : '');
    const netRFormatted = `${netRVal > 0 ? '+' : ''}${netRVal.toFixed(2)}R`;
    const maxDDFormatted = `${maxDDVal.toFixed(2)}R`;
    return `
      <div class="breakdown-row">
        <div>
          <strong style="color:#f1f5f9;">${esc(r.group)}${groupBadge}</strong>
          <small style="display:block; color:var(--muted); font-size:11px; margin-top:2px;">📅 ${dateContext}</small>
        </div>
        <span>${r.completed} completed · <span class="profit-text">${r.tp} TP</span> · <span class="loss-text">${r.sl} SL</span></span>
        <b class="${rowBClass}"><span class="${netRClass}">${netRFormatted}</span> · Max DD <span class="${maxDDClass}">${maxDDFormatted}</span></b>
      </div>
    `;
  }).join('');
}

function renderPreferences(p) {
  if (!p) return;
  if ($('telegramWatch')) $('telegramWatch').checked = Boolean(p.telegram && p.telegram.watchEnabled);
  if ($('preferenceStatus')) {
    $('preferenceStatus').textContent = 'Connected';
    $('preferenceStatus').className = 'pill green';
  }
  if ($('preferenceMeta')) {
    $('preferenceMeta').textContent = `Direct Telegram delivery active · Trade jounal channel`;
  }
}

async function testNotification(channel) {
  const button = $('testTelegram');
  if (!button) return;
  const adminKey = await getAdminKey();
  if (!adminKey) {
    alert("Admin key required to send test alerts.");
    return;
  }
  button.disabled = true;
  button.textContent = 'Sending…';
  try {
    const result = await api('/test-notify', { admin: true, method: 'POST', body: JSON.stringify({ channel }) });
    const status = (result.results && result.results[channel]) || 'unknown';
    if ($('preferenceStatus')) {
      $('preferenceStatus').textContent = `${channel} test: ${status}`;
      $('preferenceStatus').className = `pill ${status === 'ok' ? 'green' : 'gray'}`;
    }
    setStatus(status === 'ok' ? 'Test delivered' : 'Test completed', 'ok');
  } catch (e) {
    alert('Test delivery failed: ' + e.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Send Test to Telegram';
  }
}

async function savePreferences() {
  const button = $('savePreferences');
  if (!button) return;
  const adminKey = await getAdminKey();
  if (!adminKey) {
    alert("Admin key required to update channel preferences.");
    return;
  }
  button.disabled = true;
  button.textContent = 'Saving…';
  try {
    const p = await api('/dashboard/preferences/notifications', {
      admin: true,
      method: 'PATCH',
      body: JSON.stringify({
        telegram: { watchEnabled: $('telegramWatch') ? $('telegramWatch').checked : false }
      })
    });
    renderPreferences(p);
    setStatus('Preferences saved', 'ok');
  } catch (e) {
    alert('Failed to save preferences: ' + e.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Save Preferences';
  }
}

function alertParams() {
  const p = new URLSearchParams({
    page: String(state.alertPage),
    pageSize: String(state.alertPageSize),
    sort: ($('alertSort') && $('alertSort').value) || 'candleCloseTime',
    order: 'desc'
  });
  if (state.marketSegment && state.marketSegment !== 'all') {
    p.set('segment', state.marketSegment);
  }
  [['pair', 'alertPair'], ['timeframe', 'alertTimeframe'], ['direction', 'alertDirection'], ['lifecycle', 'alertLifecycle'], ['search', 'alertSearch'], ['from', 'alertFrom'], ['to', 'alertTo']].forEach(([key, id]) => {
    const el = $(id);
    if (el && el.value) {
      p.set(key, el.value);
    }
  });
  return p.toString();
}

async function loadAlerts() {
  try {
    const result = await api(`/alerts?${alertParams()}`);
    const rawAlerts = Array.isArray(result) ? result : (result.items || []);
    state.alerts = rawAlerts.filter(a => a.alertStatus !== 'SUPPRESSED');
    state.alertTotal = result.total ?? state.alerts.length;
    if ($('alertTotal')) $('alertTotal').textContent = `${state.alertTotal} setups recorded`;
    if ($('alertPage')) $('alertPage').textContent = `Page ${state.alertPage}`;
    if ($('prevAlerts')) $('prevAlerts').disabled = state.alertPage <= 1;
    if ($('nextAlerts')) $('nextAlerts').disabled = state.alertPage * state.alertPageSize >= state.alertTotal;
    renderAlerts();
  } catch (e) {
    console.error('Failed to load alerts:', e);
  }
}

function clearAlertFilters() {
  ['alertPair', 'alertTimeframe', 'alertDirection', 'alertLifecycle', 'alertSearch', 'alertFrom', 'alertTo'].forEach(id => {
    const el = $(id);
    if (el) el.value = '';
  });
  state.alertPage = 1;
  loadAlerts();
}

function debounce(fn, ms) {
  let timer;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

function renderAlerts() {
  const rows = state.alerts;
  const listEl = $('alertsList');
  if (!listEl) return;
  if (!rows.length) {
    listEl.innerHTML = '<div class="empty">No alerts match this filter.</div>';
    return;
  }
  listEl.innerHTML = rows.map(a => {
    const isLong = a.direction === 'LONG';
    const dirClass = isLong ? 'profit-text' : 'loss-text';
    let statusLabel = a.status;
    let statusClass = 'state';
    if (a.status === 'TP_HIT') {
      const r = a.rMultiple != null ? Number(a.rMultiple) : (a.entry && a.stopLoss && a.tp1 && Math.abs(a.entry - a.stopLoss) > 0 ? Math.abs(a.tp1 - a.entry) / Math.abs(a.entry - a.stopLoss) : 2.5);
      statusLabel = `TP HIT ✅ (+${r.toFixed(2)}R)`;
      statusClass = 'profit-text';
    } else if (a.status === 'SL_HIT') {
      const r = a.rMultiple != null ? Number(a.rMultiple) : -1.0;
      statusLabel = `STOP LOSS 🛑 (${r < 0 ? '' : '-'}${Math.abs(r).toFixed(2)}R)`;
      statusClass = 'loss-text';
    } else if (a.status === 'BE_HIT') {
      statusLabel = 'BREAKEVEN 🛡️ (0.00R)';
      statusClass = 'state';
    } else if (a.status === 'OPEN') {
      statusLabel = 'ACTIVE IN MARKET';
      statusClass = 'state';
    } else if (a.status === 'EXPIRED') {
      statusLabel = 'EXPIRED ⌛';
      statusClass = 'state';
    }
    const isSynth = a.pair && (a.pair.startsWith('V') || a.pair.startsWith('R_'));
    const marketTag = isSynth
      ? '<span class="market-tag synth-tag">⚡ 24/7 SYNTHETICS</span>'
      : '<span class="market-tag inst-tag">INSTITUTIONAL</span>';
    let timeLogHtml = `Opened ${fmtDate(a.candleCloseTime)}`;
    if (a.exitTime && (a.status === 'TP_HIT' || a.status === 'SL_HIT' || a.status === 'BE_HIT' || a.status === 'EXPIRED')) {
      const diffMs = Math.max(0, new Date(a.exitTime).getTime() - new Date(a.candleCloseTime).getTime());
      const diffMins = Math.round(diffMs / 60000);
      const durationStr = diffMins >= 60 ? `${Math.floor(diffMins / 60)}h ${diffMins % 60}m` : `${diffMins}m`;
      timeLogHtml += ` · Closed ${fmtDate(a.exitTime)} (${durationStr})`;
    }
    return `
      <button class="alert-row" data-setup="${esc(a.setupId)}" data-tf="${esc(a.tf)}">
        <div>
          <strong class="alert-pair">${esc(a.pair)} · ${esc(a.tf)} · <span class="${dirClass}">${esc(a.direction)}</span> ${marketTag}</strong>
          <small class="alert-meta">${esc(a.keyLevel || 'Key Level')} · ${timeLogHtml}</small>
        </div>
        <div>
          <span>Entry Price</span>
          <strong class="alert-val">${num(a.entry)}</strong>
        </div>
        <div>
          <span>SL / TP1</span>
          <strong class="alert-val">${num(a.stopLoss)} / ${num(a.tp1)}</strong>
        </div>
        <div>
          <span>Lifecycle Status</span>
          <strong class="${statusClass}">${statusLabel}</strong>
        </div>
      </button>
    `;
  }).join('');
  document.querySelectorAll('.alert-row').forEach(row => {
    row.addEventListener('click', () => openChart(row.dataset.setup, row.dataset.tf));
  });
}

async function openChart(setupId, tf) {
  if (!$('chartModal')) return;
  $('chartModal').hidden = false;
  $('chartTitle').textContent = `${setupId} · OHLC Evidence`;
  $('chartStatus').textContent = 'Loading market candles…';
  $('chartNotice').hidden = true;
  $('ohlcChart').innerHTML = '';
  stopReplayTimer();
  if ($('replayBar')) $('replayBar').hidden = true;
  if ($('riskCalc')) $('riskCalc').hidden = true;
  try {
    const data = await api(`/dashboard/signals/${encodeURIComponent(setupId)}/chart?timeframe=${encodeURIComponent(tf)}&before=200&after=20`);
    if (data.status && data.status !== 'OK' && (!data.candles || !data.candles.length)) {
      showChartNotice(`${data.status}: ${data.error || 'No finalized history available.'}`);
      return;
    }
    initReplay(data);
  } catch (e) {
    showChartNotice(`Chart unavailable: ${e.message}`);
  }
}

function showChartNotice(text) {
  if ($('chartNotice')) {
    $('chartNotice').textContent = text;
    $('chartNotice').hidden = false;
  }
  if ($('chartStatus')) $('chartStatus').textContent = 'No real candles rendered';
  if ($('ohlcChart')) $('ohlcChart').innerHTML = '';
}

function renderChart(data, view) {
  const all = data.candles || [];
  if (!all.length) {
    showChartNotice('HISTORY_INSUFFICIENT: No historical candles available for this setup.');
    return;
  }
  const v = view || { upto: Infinity, showLevels: true, showOutcome: true };
  const upto = Math.min(all.length - 1, v.upto);
  const candles = all.slice(0, upto + 1);
  const svg = $('ohlcChart'), W = 1000, H = 460, pad = { l: 62, r: 24, t: 20, b: 44 };
  // Axes stay stable across replay steps: scale from the FULL window + levels
  const values = all.flatMap(c => [c.high, c.low]);
  const levels = data.levels || {};
  Object.values(levels).forEach(val => {
    if (val != null && Number.isFinite(Number(val))) values.push(Number(val));
  });
  let lo = Math.min(...values), hi = Math.max(...values), margin = (hi - lo) * 0.08 || 1;
  lo -= margin;
  hi += margin;
  const x = i => pad.l + i * (W - pad.l - pad.r) / Math.max(1, all.length - 1);
  const y = val => pad.t + (hi - val) * (H - pad.t - pad.b) / (hi - lo);
  let out = `<rect x="0" y="0" width="${W}" height="${H}" rx="14" fill="#0b111a"/>`;
  for (let i = 0; i < 5; i++) {
    const val = hi - (hi - lo) * i / 4;
    out += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(val)}" y2="${y(val)}" stroke="#253044"/><text x="8" y="${y(val) + 4}" fill="#8793a7" font-size="11">${num(val)}</text>`;
  }
  const cw = Math.max(2, Math.min(14, (W - pad.l - pad.r) / all.length * 0.65));
  candles.forEach((c, i) => {
    const xx = x(i), up = c.close >= c.open, color = up ? '#8cf0c6' : '#ff8f9b', bodyY = Math.min(y(c.open), y(c.close)), bodyH = Math.max(1, Math.abs(y(c.open) - y(c.close)));
    out += `<g><title>${fmtDate(c.time)} · O ${num(c.open)} H ${num(c.high)} L ${num(c.low)} C ${num(c.close)}</title><line x1="${xx}" x2="${xx}" y1="${y(c.high)}" y2="${y(c.low)}" stroke="${color}"/><rect x="${xx - cw / 2}" y="${bodyY}" width="${cw}" height="${bodyH}" fill="${color}" opacity=".9"/></g>`;
  });
  const rVal = (levels.entry != null && levels.stop != null && levels.target1 != null && Math.abs(levels.entry - levels.stop) > 0)
    ? Math.abs(levels.target1 - levels.entry) / Math.abs(levels.entry - levels.stop)
    : null;
  const tp1Label = (rVal && Number.isFinite(rVal) && rVal > 0) ? `TP1 (+${rVal.toFixed(2)}R)` : 'TP1';
  const lineDefs = [
    ['entry', 'Entry', '#80a9ff'],
    ['stop', 'Stop', '#ff8f9b'],
    ['invalidation', 'Invalidation', '#f6c66d'],
    ['target1', tp1Label, '#8cf0c6'],
    ['target2', 'TP2', '#65d6bd'],
    ['keyLevelLow', 'Key Low', '#b093ff'],
    ['keyLevelHigh', 'Key High', '#b093ff']
  ];
  if (v.showLevels) {
    lineDefs.forEach(([key, label, color]) => {
      if (levels[key] == null) return;
      const val = Number(levels[key]);
      if (!Number.isFinite(val)) return;
      out += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(val)}" y2="${y(val)}" stroke="${color}" stroke-dasharray="6 5"/><text x="${W - pad.r - 5}" y="${y(val) - 5}" text-anchor="end" fill="${color}" font-size="11">${label} ${num(val)}</text>`;
    });
  }
  (data.evidenceMarkers || []).forEach(m => {
    const t = new Date(m.time).getTime(), idx = all.findIndex(c => new Date(c.time).getTime() >= t);
    if (idx < 0 || idx > upto) return;
    const xx = x(idx);
    out += `<circle cx="${xx}" cy="${pad.t + 10}" r="5" fill="#f6c66d"><title>${esc(m.type)} · ${esc(m.label)}</title></circle><text x="${xx}" y="${pad.t + 27}" text-anchor="middle" fill="#f6c66d" font-size="9">${esc(m.type)}</text>`;
  });
  if (v.showOutcome && data.outcome && data.outcome.status && data.outcome.status !== 'OPEN') {
    const oc = data.outcome;
    const color = oc.status === 'TP_HIT' ? '#8cf0c6' : oc.status === 'SL_HIT' ? '#ff8f9b' : oc.status === 'BE_HIT' ? '#f6c66d' : '#8793a7';
    const rTxt = oc.rMultiple != null ? ` ${Number(oc.rMultiple) >= 0 ? '+' : ''}${Number(oc.rMultiple).toFixed(2)}R` : '';
    const badge = `${oc.status}${rTxt}`;
    out += `<rect x="${pad.l + 8}" y="${pad.t + 4}" width="${badge.length * 8 + 30}" height="24" rx="12" fill="#0b111a" stroke="${color}"/><text x="${pad.l + 22}" y="${pad.t + 20}" fill="${color}" font-size="12" font-weight="700">🏁 ${esc(badge)}</text>`;
  }
  out += `<text x="${pad.l}" y="${H - 12}" fill="#8793a7" font-size="11">${fmtDate(all[0].time)}</text><text x="${W - pad.r}" y="${H - 12}" text-anchor="end" fill="#8793a7" font-size="11">${fmtDate(all[all.length - 1].time)}</text>`;
  svg.innerHTML = out;
  const incomplete = data.dataHealth && !data.dataHealth.historyComplete;
  if ($('chartStatus')) $('chartStatus').textContent = `LIVE OHLC · ${candles.length}/${all.length} candles · ${data.provider || 'twelvedata'}${incomplete ? ' · HISTORY_INSUFFICIENT' : ''}`;
  if ($('chartLegend')) $('chartLegend').innerHTML = '<span class="legend-live">● LIVE OHLC</span> ' + lineDefs.map(xd => `<span style="color:${xd[2]}">━ ${xd[1]}</span>`).join(' ');
}

// ── Functionality #7: Interactive Trade Replay & Candle Stepper ──────────
const STAGE_META = {
  START: ['🎬', 'HISTORY'],
  MAP: ['🗺️', 'MAP'],
  TOUCH: ['👆', 'TOUCH'],
  SWEEP: ['🌊', 'SWEEP'],
  SHIFT: ['⚡', 'SHIFT'],
  RETEST: ['🎯', 'RETEST'],
  CONFIRMED: ['📢', 'CONFIRMED'],
  OUTCOME: ['🏁', 'OUTCOME'],
};
let replay = null; // { data, steps, pos, timer }

function buildReplaySteps(data) {
  const candles = data.candles || [];
  const idxAt = t => candles.findIndex(c => new Date(c.time).getTime() >= new Date(t).getTime());
  const steps = [{ candleIdx: Math.min(20, Math.max(0, candles.length - 1)), stage: 'START', narration: 'Historical candles load — no lines drawn yet. This is exactly what the desk saw before the setup existed.' }];
  const markers = (data.evidenceMarkers || []).slice().sort((a, b) => new Date(a.time) - new Date(b.time));
  for (const m of markers) {
    if (!STAGE_META[m.type]) continue;
    const idx = idxAt(m.time);
    if (idx < 0) continue;
    steps.push({ candleIdx: idx, stage: m.type, narration: `${m.type} — ${m.label}` });
  }
  if (data.confirmedAt) {
    const idx = idxAt(data.confirmedAt);
    if (idx >= 0) steps.push({ candleIdx: idx, stage: 'CONFIRMED', narration: 'CONFIRMED — retest candle closed. SLK entry alert dispatched to VIP with entry, stop loss and targets. Levels appear now (never before).' });
  }
  const oc = data.outcome;
  if (oc && oc.status && oc.status !== 'OPEN') {
    const idx = idxAt(oc.exitTime || data.confirmedAt);
    const r = oc.rMultiple != null ? ` (${Number(oc.rMultiple) >= 0 ? '+' : ''}${Number(oc.rMultiple).toFixed(2)}R)` : '';
    steps.push({ candleIdx: idx < 0 ? candles.length - 1 : idx, stage: 'OUTCOME', narration: `OUTCOME — ${oc.status}${r} resolved on candle close and written to the verified ledger.` });
  }
  return steps;
}

function renderReplayFrame() {
  if (!replay) return;
  const { data, steps, pos } = replay;
  const step = steps[pos];
  const confirmedIdx = steps.findIndex(s => s.stage === 'CONFIRMED');
  const outcomeIdx = steps.findIndex(s => s.stage === 'OUTCOME');
  renderChart(data, {
    upto: step.candleIdx,
    showLevels: confirmedIdx < 0 ? true : pos >= confirmedIdx,
    showOutcome: outcomeIdx < 0 ? true : pos >= outcomeIdx,
  });
  const reached = steps.slice(0, pos + 1).map(s => s.stage);
  const stagesEl = $('replayStages');
  if (stagesEl) {
    stagesEl.innerHTML = ['MAP', 'TOUCH', 'SWEEP', 'SHIFT', 'RETEST', 'CONFIRMED', 'OUTCOME'].map(st => {
      const stageList = steps.map(s => s.stage);
      const cls = stageList[pos] === st ? 'now' : (reached.includes(st) ? 'done' : '');
      return `<span class="${cls}">${STAGE_META[st][0]} ${st}</span>`;
    }).join('');
  }
  const lbl = $('replayStepLabel');
  if (lbl) lbl.textContent = `Step ${pos + 1}/${steps.length} · ${step.stage}`;
  const nar = $('replayNarration');
  if (nar) nar.textContent = `${STAGE_META[step.stage][0]} ${step.narration}`;
}

function stopReplayTimer() {
  if (replay && replay.timer) { clearInterval(replay.timer); replay.timer = null; }
  const b = $('replayPlay');
  if (b) b.textContent = '▶ Play';
}

function stepReplay(d) {
  if (!replay) return;
  replay.pos = Math.max(0, Math.min(replay.steps.length - 1, replay.pos + d));
  renderReplayFrame();
}

function toggleReplayPlay() {
  if (!replay) return;
  if (replay.timer) { stopReplayTimer(); return; }
  if (replay.pos >= replay.steps.length - 1) replay.pos = 0;
  const b = $('replayPlay');
  if (b) b.textContent = '⏸ Pause';
  replay.timer = setInterval(() => {
    if (!replay || replay.pos >= replay.steps.length - 1) { stopReplayTimer(); return; }
    replay.pos++;
    renderReplayFrame();
  }, 1100);
  renderReplayFrame();
}

function initReplay(data) {
  stopReplayTimer();
  replay = { data, steps: buildReplaySteps(data), pos: 0 };
  const bar = $('replayBar');
  if (bar) bar.hidden = false;
  replay.pos = replay.steps.length - 1; // open on the finished picture
  renderReplayFrame();
  renderRiskCalc(data);
}

[['replayReset', () => { stopReplayTimer(); if (replay) { replay.pos = 0; renderReplayFrame(); } }],
 ['replayPrev', () => { stopReplayTimer(); stepReplay(-1); }],
 ['replayNext', () => { stopReplayTimer(); stepReplay(1); }],
 ['replayPlay', () => toggleReplayPlay()]].forEach(([id, fn]) => {
  const el = $(id);
  if (el) el.addEventListener('click', fn);
});

// ── Functionality #8: In-app Risk & Position Sizing Calculator ───────────
function pointValuePerLot(pair, price) {
  const p = String(pair || '').toUpperCase();
  if (p.endsWith('JPY')) return 100000 / (price || 1);
  if (p === 'XAUUSD' || p === 'XAGUSD') return 100;
  if (['US30', 'NAS100', 'GER40', 'DE40', 'JAPAN225', 'JP225', 'UK100', 'SPX500'].includes(p)) return 1;
  if (/^V\d|^R_\d|1HZ/.test(p)) return 1;
  return 100000; // USD-quoted forex: $10 per pip per standard lot
}

function updateRiskCalc() {
  const box = $('riskCalc'), out = $('riskOutputs');
  if (!box || !out || box.hidden) return;
  const pair = box.dataset.pair || '';
  const entry = Number(box.dataset.entry), stop = Number(box.dataset.stop), tp1 = Number(box.dataset.tp1 || '');
  const equity = Number(($('riskEquity') || {}).value) || 0;
  const pct = Number(($('riskPct') || {}).value) || 0;
  const pv = pointValuePerLot(pair, entry);
  const riskUsd = equity * pct / 100;
  const stopDist = Math.abs(entry - stop);
  const lots = stopDist > 0 ? riskUsd / (stopDist * pv) : 0;
  const lotsR = Math.floor(lots * 100) / 100;
  const tp1Usd = Number.isFinite(tp1) && tp1 > 0 ? Math.abs(tp1 - entry) * lotsR * pv : null;
  const cls = pair.endsWith('JPY') ? 'forex · JPY quote' : (pv === 100 ? 'metal · 100 oz/lot' : (pv === 1 ? 'index/synthetic · $1/point/lot' : 'forex · USD quote'));
  out.innerHTML = `
    <div>Dollar risk<strong>$${riskUsd.toFixed(2)}</strong></div>
    <div>Suggested size<strong>${lotsR.toFixed(2)} lots</strong></div>
    <div>Stop distance<strong>${num(stopDist)} · ${cls}</strong></div>
    <div>Payout at TP1<strong>${tp1Usd != null ? '$' + tp1Usd.toFixed(2) : '—'}</strong></div>`;
}

function renderRiskCalc(data) {
  const box = $('riskCalc');
  if (!box) return;
  const lv = data.levels || {};
  if (lv.entry == null || lv.stop == null || Math.abs(Number(lv.entry) - Number(lv.stop)) <= 0) { box.hidden = true; return; }
  box.hidden = false;
  box.dataset.pair = data.symbol || '';
  box.dataset.entry = lv.entry;
  box.dataset.stop = lv.stop;
  box.dataset.tp1 = lv.target1 != null ? lv.target1 : '';
  updateRiskCalc();
}

[['riskEquity'], ['riskPct']].forEach(([id]) => {
  const el = $(id);
  if (el) el.addEventListener('input', updateRiskCalc);
});

// ── Functionality #9: Exportable institutional audit log (CSV / JSON) ────
async function fetchLedgerRows() {
  const rows = [];
  for (let page = 1; page <= 6; page++) {
    const res = await api(`/alerts?pageSize=200&page=${page}&sort=candleCloseTime&order=desc`);
    const items = (res.items || []).filter(r => r.alertStatus !== 'SUPPRESSED');
    rows.push(...items);
    if (items.length < 200) break;
  }
  return rows.map(r => ({
    ...r,
    rr: (r.entry != null && r.stopLoss != null && r.tp1 != null && Math.abs(r.entry - r.stopLoss) > 0)
      ? Number((Math.abs(r.tp1 - r.entry) / Math.abs(r.entry - r.stopLoss)).toFixed(2)) : null,
  }));
}

function downloadBlob(name, mime, text) {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

const EXPORT_FIELDS = [
  ['setupId', 'Setup ID'], ['pair', 'Pair'], ['tf', 'Timeframe'], ['direction', 'Direction'],
  ['entry', 'Entry Price'], ['stopLoss', 'Stop Loss'], ['tp1', 'Take Profit 1'], ['tp2', 'Take Profit 2'],
  ['rr', 'Target RR'], ['status', 'Outcome'], ['rMultiple', 'Net R'],
  ['candleCloseTime', 'Timestamp Opened'], ['exitTime', 'Timestamp Resolved'],
];

async function exportLedger(fmt) {
  try {
    const rows = await fetchLedgerRows();
    const stamp = new Date().toISOString().slice(0, 10);
    if (fmt === 'json') {
      downloadBlob(`slk-radar-ledger-${stamp}.json`, 'application/json', JSON.stringify(rows, null, 2));
      return;
    }
    const escCsv = val => { const s = val == null ? '' : String(val); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lines = [EXPORT_FIELDS.map(([, label]) => escCsv(label)).join(',')];
    for (const r of rows) lines.push(EXPORT_FIELDS.map(([key]) => escCsv(r[key])).join(','));
    downloadBlob(`slk-radar-ledger-${stamp}.csv`, 'text/csv', lines.join('\n'));
  } catch (e) {
    alert('Export failed: ' + e.message);
  }
}

[['exportCsv', 'csv'], ['exportJson', 'json']].forEach(([id, fmt]) => {
  const el = $(id);
  if (el) el.addEventListener('click', () => exportLedger(fmt));
});

function num(x) {
  return x == null ? '—' : Number(x).toPrecision(7);
}

function fmtDate(x) {
  if (!x) return '—';
  const d = new Date(x);
  return Number.isNaN(d.getTime()) ? '—' : d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

function esc(x) {
  return String(x ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

document.querySelectorAll('[data-close-chart]').forEach(x => x.addEventListener('click', () => {
  if ($('chartModal')) $('chartModal').hidden = true;
}));

function setupWaitlist() {
  const form = $('waitlistForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('waitlistEmail')?.value?.trim();
    const telegram = $('waitlistTelegram')?.value?.trim();
    const marketInterest = $('waitlistInterest')?.value || 'all';
    const feedback = $('waitlistFeedback');
    const btn = $('waitlistSubmitBtn');
    const successCard = $('waitlistSuccess');

    if (!email || !email.includes('@')) {
      if (feedback) {
        feedback.style.display = 'block';
        feedback.style.background = 'rgba(239, 68, 68, 0.15)';
        feedback.style.color = '#ff8f9b';
        feedback.style.border = '1px solid rgba(239, 68, 68, 0.3)';
        feedback.textContent = 'Please enter a valid email address.';
      }
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Reserving Spot…';
    }

    try {
      const res = await api('/api/waitlist', {
        method: 'POST',
        body: JSON.stringify({ email, telegram, marketInterest, source: 'dashboard' })
      });

      if (res && res.ok) {
        form.style.display = 'none';
        if (successCard) successCard.style.display = 'block';
      } else {
        throw new Error(res?.error || 'Failed to join waitlist');
      }
    } catch (err) {
      if (feedback) {
        feedback.style.display = 'block';
        feedback.style.background = 'rgba(239, 68, 68, 0.15)';
        feedback.style.color = '#ff8f9b';
        feedback.style.border = '1px solid rgba(239, 68, 68, 0.3)';
        feedback.textContent = `Unable to reserve spot: ${err.message || 'Please try again later'}`;
      }
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Reserve Priority Spot →';
      }
    }
  });
}

// Automatically load live data on open
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    try { const m = localStorage.getItem('slkViewMode'); if (m) setViewMode(m); } catch (_) {}
    setupWaitlist();
    loadAll();
  });
} else {
  try { const m = localStorage.getItem('slkViewMode'); if (m) setViewMode(m); } catch (_) {}
  setupWaitlist();
  loadAll();
}

// ── Functionality #10: Monte Carlo Quant Lab ─────────────────────────────
async function runMonteCarloUI() {
  const status = $('mcStatus'), cards = $('mcCards'), svg = $('mcFan'), runButton = $('mcRun');
  if (!status || (runButton && runButton.disabled)) return;
  status.textContent = 'Building possible outcomes…';
  status.setAttribute('aria-busy', 'true');
  if (cards) cards.innerHTML = '';
  if (svg) svg.innerHTML = '';
  if (runButton) {
    runButton.disabled = true;
    runButton.textContent = 'Running…';
  }
  try {
    const val = id => (($('#' + id.slice(1)) || $(id) || {}).value);
    const q = 'iterations=' + encodeURIComponent(val('mcIterations') || 2000)
      + '&horizon=' + encodeURIComponent(val('mcHorizon') || 100)
      + '&riskPct=' + encodeURIComponent(val('mcRisk') || 1)
      + '&seed=' + encodeURIComponent(val('mcSeed') || 42);
    const d = await api('/api/monte-carlo?' + q);
    if (!d.ok) {
      status.textContent = d.error === 'INSUFFICIENT_HISTORY'
        ? 'At least 5 verified closed trades are needed before this stress test can run.'
        : 'The stress test could not be run. Please try again in a moment.';
      return;
    }
    const tradeCount = Number(d.trades);
    status.textContent = Number(d.iterations).toLocaleString() + ' simulations · '
      + Number(d.horizon).toLocaleString() + ' future trades ahead per simulation · shuffle code ' + d.seed
      + ' · based on ' + tradeCount.toLocaleString() + ' verified closed ' + (tradeCount === 1 ? 'trade.' : 'trades.');
    const g = d.finalGrowth;
    const growth = x => {
      const change = (Number(x) - 1) * 100;
      return (change > 0 ? '+' : '') + change.toFixed(1) + '%';
    };
    const chance = x => (Number(x) * 100).toFixed(1) + '%';
    const card = (label, value, note) => '<div class="mc-card"><span class="mc-card-label">' + label
      + '</span><strong class="mc-card-value">' + value + '</strong><small class="mc-card-note">' + note + '</small></div>';
    const losingRun = Math.ceil(Number(d.consecLoss.p95));
    if (cards) cards.innerHTML = [
      card('Typical Growth', growth(g.p50), 'The middle result across all simulated paths.'),
      card('Unlucky Scenario', growth(g.p5), '5% of simulated paths finished lower.'),
      card('Lucky Scenario', growth(g.p95), '5% of simulated paths finished higher.'),
      card('Chance of Ending Down', chance(d.probNetLoss), 'Finished below the starting balance.'),
      card('Chance of a 10% Dip', chance(d.probDd10), 'Fell 10% or more from a past high, at least once.'),
      card('Chance of a 20% Dip', chance(d.probDd20), 'Fell 20% or more from a past high, at least once.'),
      card('Worst Realistic Dip', Number(d.maxDrawdownPct.p95).toFixed(1) + '%', '95% of paths had a dip this size or smaller.'),
      card('Longest Losing Run', losingRun + (losingRun === 1 ? ' trade' : ' trades'), '95% of paths had a run this long or shorter.')
    ].join('');
    renderMcFan(d);
  } catch (e) {
    status.textContent = 'The stress test could not be completed. Please try again.';
  } finally {
    status.removeAttribute('aria-busy');
    if (runButton) {
      runButton.disabled = false;
      runButton.textContent = '▶ Run stress test';
    }
  }
}

function renderMcFan(d) {
  const svg = $('mcFan');
  if (!svg) return;
  const W = 1000, H = 380, pad = { l: 62, r: 24, t: 18, b: 40 };
  const all = d.bands.p5.concat(d.bands.p95, [1]);
  let lo = Math.min(...all), hi = Math.max(...all);
  const margin = (hi - lo) * 0.08 || 0.2;
  lo -= margin;
  hi += margin;
  const x = i => pad.l + i * (W - pad.l - pad.r) / Math.max(1, d.horizon);
  const y = v => pad.t + (hi - v) * (H - pad.t - pad.b) / (hi - lo);
  let out = `<rect x="0" y="0" width="${W}" height="${H}" rx="14" fill="#0b111a"/>`;
  for (let i = 0; i < 5; i++) {
    const v = hi - (hi - lo) * i / 4;
    out += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="#253044"/><text x="8" y="${y(v) + 4}" fill="#8793a7" font-size="11">${v.toFixed(2)}×</text>`;
  }
  let fan = '';
  for (let i = 0; i <= d.horizon; i++) fan += x(i) + ',' + y(d.bands.p95[i]) + ' ';
  for (let i = d.horizon; i >= 0; i--) fan += x(i) + ',' + y(d.bands.p5[i]) + ' ';
  out += `<polygon points="${fan}" fill="#38bdf8" opacity="0.16"/>`;
  out += `<polyline points="${d.bands.p50.map((v, i) => x(i) + ',' + y(v)).join(' ')}" fill="none" stroke="#8cf0c6" stroke-width="2.4"/>`;
  out += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(1)}" y2="${y(1)}" stroke="#f6c66d" stroke-dasharray="6 5"/>`;
  out += `<text x="${W - pad.r - 4}" y="${y(1) - 6}" text-anchor="end" fill="#f6c66d" font-size="11">starting balance 1.00×</text>`;
  out += `<text x="${pad.l}" y="${H - 12}" fill="#8793a7" font-size="11">Start</text><text x="${W - pad.r}" y="${H - 12}" text-anchor="end" fill="#8793a7" font-size="11">After ${d.horizon} trades</text>`;
  svg.innerHTML = out;
}

if ($('mcRun')) $('mcRun').addEventListener('click', runMonteCarloUI);

// ── Functionality #11: Live Desk Mode (smart-polling event tape) ─────────
// The tape starts at the LIVE EDGE: the first poll asks for the newest rows
// (`tail=1`) and adopts their max id as the cursor, so /api/recent-events
// never replays stored history as if it were live. Every later poll streams
// strictly forward with `since=cursor`.
const liveDesk = { cursor: 0, timer: null, chime: false, audio: null, primed: false };
function liveDeskBeep(freq) {
  if (!liveDesk.chime) return;
  try {
    if (!liveDesk.audio) liveDesk.audio = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = liveDesk.audio, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = freq || 880;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.4);
  } catch (e) { /* audio unavailable */ }
}
// Stored events are UTC; the tape shows "HH:MM UTC" for today and
// "MM-DD HH:MM UTC" for anything older so history can never look live.
function liveDeskTime(ev) {
  const raw = String(ev.createdUtc || ev.candleTime || '');
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms), now = new Date();
  const p2 = n => String(n).padStart(2, '0');
  const hhmm = p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes());
  const today = d.getUTCFullYear() === now.getUTCFullYear()
    && d.getUTCMonth() === now.getUTCMonth()
    && d.getUTCDate() === now.getUTCDate();
  return today ? hhmm + ' UTC' : p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate()) + ' ' + hhmm + ' UTC';
}
function liveDeskRow(ev) {
  const li = document.createElement('li');
  li.className = 'live-row live-' + String(ev.state).toLowerCase();
  li.innerHTML = '<span class="live-time">' + esc(liveDeskTime(ev)) + '</span>'
    + '<span class="live-state">' + esc(ev.state) + '</span>'
    + '<span class="live-pair">' + esc(ev.pair) + '</span>'
    + '<span class="live-reason">' + esc(ev.reason || '') + '</span>';
  return li;
}
async function liveDeskPoll(initial) {
  try {
    // Bootstrap: newest 12 rows + cursor at the max event id. Afterwards: strictly
    // forward from the cursor, so nothing already on the tape is re-rendered.
    const d = await api(initial
      ? '/api/recent-events?tail=1&limit=12'
      : '/api/recent-events?since=' + liveDesk.cursor + '&limit=50');
    const items = (d.items || []).slice();
    const cursor = Number(d.cursor);
    if (Number.isFinite(cursor)) liveDesk.cursor = Math.max(liveDesk.cursor, cursor);
    const tape = $('liveTape');
    if (!tape) return;
    if (initial) {
      tape.innerHTML = '';
      items.slice().reverse().forEach(ev => tape.appendChild(liveDeskRow(ev)));
      if (!tape.children.length) tape.innerHTML = '<li class="live-empty">No structure events recorded yet — the tape fills as scans run.</li>';
      liveDesk.primed = true;
      return; // history is rendered, never chimed
    }
    if (!items.length) return;
    if (tape.querySelector('.live-empty')) tape.innerHTML = '';
    items.slice().reverse().forEach(ev => tape.insertBefore(liveDeskRow(ev), tape.firstChild));
    while (tape.children.length > 30) tape.removeChild(tape.lastChild);
    // Chime/flash only for genuinely new events arriving after the initial render.
    if (!liveDesk.primed) { liveDesk.primed = true; return; }
    liveDeskBeep(items.some(ev => ev.state === 'RETEST' || ev.state === 'SHIFT') ? 1046 : 784);
    const desk = $('liveDesk');
    if (desk) { desk.classList.remove('live-flash'); void desk.offsetWidth; desk.classList.add('live-flash'); }
  } catch (e) { /* silent retry on next tick */ }
}
function liveDeskStart() {
  if (liveDesk.timer || !$('liveTape')) return;
  liveDeskPoll(true);
  liveDesk.timer = setInterval(() => { if (!document.hidden) liveDeskPoll(false); }, 15000);
}
if ($('liveChimeToggle')) $('liveChimeToggle').addEventListener('click', () => {
  liveDesk.chime = !liveDesk.chime;
  $('liveChimeToggle').textContent = liveDesk.chime ? '🔔 Chime on' : '🔕 Chime off';
  if (liveDesk.chime) liveDeskBeep(880); // user gesture unlocks browser audio
});
liveDeskStart();
