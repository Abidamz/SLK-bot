const DEFAULT_URL = (typeof window !== 'undefined' && window.location && window.location.hostname && window.location.hostname.includes('workers.dev'))
  ? window.location.origin
  : 'https://slk-alert-worker.abidogundamilola.workers.dev';

const state = {
  url: DEFAULT_URL,
  adminKey: sessionStorage.getItem('slkAdminKey') || '',
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

document.querySelectorAll('.segment-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.segment-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.marketSegment = btn.dataset.segment || 'all';
    if ($('syntheticsNotice')) {
      $('syntheticsNotice').hidden = state.marketSegment !== 'synthetics';
    }
    state.alertPage = 1;
    loadStats();
    loadAlerts();
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
if ($('expireOpenBtn')) {
  $('expireOpenBtn').addEventListener('click', async () => {
    if (!confirm('Close all currently open trades as Expired?')) return;
    const btn = $('expireOpenBtn');
    const oldText = btn.textContent;
    btn.textContent = 'Closing…';
    btn.disabled = true;
    try {
      const res = await api('/admin/expire-open');
      alert(res.message || 'Open trades marked as EXPIRED.');
      await loadStats();
      await loadAlerts();
    } catch (err) {
      alert('Failed to close open trades: ' + (err.message || String(err)));
    } finally {
      btn.textContent = oldText;
      btn.disabled = false;
    }
  });
}

async function api(path, options = {}) {
  const headers = {
    ...(options.admin && state.adminKey ? { Authorization: `Bearer ${state.adminKey}` } : {}),
    ...(options.body ? { 'Content-Type': 'application/json' } : {})
  };
  const r = await fetch(state.url.replace(/\/$/, '') + path, { ...options, headers });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

async function getAdminKey() {
  if (state.adminKey) return state.adminKey;
  const key = window.prompt("Enter Admin Key:");
  if (key) {
    state.adminKey = key.trim();
    sessionStorage.setItem('slkAdminKey', state.adminKey);
  }
  return state.adminKey;
}

async function loadAll() {
  setStatus('Syncing live ledger…', 'muted');
  try {
    const [health, _stats, prefs] = await Promise.all([
      api('/health').catch(() => null),
      loadStats(),
      api('/dashboard/preferences/notifications').catch(() => null)
    ]);
    if (health) renderHealth(health);
    if (prefs) renderPreferences(prefs);
    await loadAlerts();
    setStatus('Live Connected', 'ok');
  } catch (e) {
    setStatus('Feed offline', 'bad');
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
  if ($('mode')) $('mode').textContent = String(h.mode || 'PAPER').toUpperCase();
  if ($('workerName')) $('workerName').textContent = h.service || 'slk-alert-worker';
  if ($('lastResponse')) $('lastResponse').textContent = new Date().toLocaleTimeString();
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
    $('healthPill').textContent = h.ok ? 'Live · 24/7' : 'degraded';
    $('healthPill').className = `pill ${h.ok ? 'green' : 'gray'}`;
  }
  if ($('healthDetails')) {
    $('healthDetails').innerHTML = `
      <div class="health-item"><span>Cloud Service</span><strong>${esc(h.service || '—')}</strong></div>
      <div class="health-item"><span>Active Timeframes</span><strong>${esc((h.entryTfs || []).join(' · ') || '—')}</strong></div>
      <div class="health-item"><span>Server Time (UTC)</span><strong>${esc(h.time || '—')}</strong></div>
      <div class="health-item"><span>Coverage</span><strong>${(h.pairs || []).length} Markets Active</strong></div>
      <div class="health-item"><span>Execution Mode</span><strong>Paper / Verified Quantitative</strong></div>
      <div class="health-item"><span>Signals Destination</span><strong>Trade jounal Channel</strong></div>
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
  const netRText = s.netR == null ? '—' : `${Number(s.netR) > 0 ? '+' : ''}${Number(s.netR).toFixed(2)}R`;
  if ($('total')) $('total').textContent = s.total ?? '—';
  if ($('open')) $('open').textContent = s.open ?? '—';
  if ($('tp')) $('tp').textContent = s.tp ?? '—';
  if ($('sl')) $('sl').textContent = s.sl ?? '—';
  if ($('expired')) $('expired').textContent = s.expired ?? '—';
  if ($('completed')) $('completed').textContent = s.completed ?? '—';
  if ($('overviewNetR')) $('overviewNetR').textContent = netRText;
  if ($('netR')) $('netR').textContent = netRText;
  if ($('maxDD')) $('maxDD').textContent = s.maxDD == null ? '—' : `${Number(s.maxDD).toFixed(2)}R`;
  if ($('winRate')) $('winRate').textContent = s.winRate == null ? '—' : `${(s.winRate * 100).toFixed(1)}%`;
  
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
    return `
      <div class="breakdown-row">
        <div>
          <strong style="color:#f1f5f9;">${esc(r.group)}${groupBadge}</strong>
          <small style="display:block; color:var(--muted); font-size:11px; margin-top:2px;">📅 ${dateContext}</small>
        </div>
        <span>${r.completed} completed · <span class="profit-text">${r.tp} TP</span> · <span class="loss-text">${r.sl} SL</span></span>
        <b>${Number(r.netR) > 0 ? '+' : ''}${Number(r.netR).toFixed(2)}R · Max DD ${Number(r.maxDD).toFixed(2)}R</b>
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
    state.alerts = Array.isArray(result) ? result : (result.items || []);
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
    } else if (a.status === 'OPEN') {
      statusLabel = a.alertStatus === 'SUPPRESSED' ? 'OPEN · AUDIT' : 'ACTIVE IN MARKET';
      statusClass = 'state';
    } else if (a.status === 'EXPIRED') {
      statusLabel = 'EXPIRED ⌛';
      statusClass = 'state';
    }
    const isSynth = a.pair && (a.pair.startsWith('V') || a.pair.startsWith('R_'));
    const marketTag = isSynth
      ? '<span class="market-tag synth-tag">⚡ 24/7 SYNTHETICS</span>'
      : '<span class="market-tag inst-tag">INSTITUTIONAL</span>';
    return `
      <button class="alert-row" data-setup="${esc(a.setupId)}" data-tf="${esc(a.tf)}">
        <div>
          <strong class="alert-pair">${esc(a.pair)} · ${esc(a.tf)} · <span class="${dirClass}">${esc(a.direction)}</span> ${marketTag}</strong>
          <small class="alert-meta">${esc(a.keyLevel || 'Key Level')} · ${fmtDate(a.candleCloseTime)}</small>
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
  try {
    const data = await api(`/dashboard/signals/${encodeURIComponent(setupId)}/chart?timeframe=${encodeURIComponent(tf)}&before=200&after=20`);
    if (data.status && data.status !== 'OK' && (!data.candles || !data.candles.length)) {
      showChartNotice(`${data.status}: ${data.error || 'No finalized history available.'}`);
      return;
    }
    renderChart(data);
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

function renderChart(data) {
  const candles = data.candles || [];
  if (!candles.length) {
    showChartNotice('HISTORY_INSUFFICIENT: No historical candles available for this setup.');
    return;
  }
  const svg = $('ohlcChart'), W = 1000, H = 460, pad = { l: 62, r: 24, t: 20, b: 44 };
  const values = candles.flatMap(c => [c.high, c.low]);
  const levels = data.levels || {};
  Object.values(levels).forEach(v => {
    if (v != null && Number.isFinite(Number(v))) values.push(Number(v));
  });
  let lo = Math.min(...values), hi = Math.max(...values), margin = (hi - lo) * 0.08 || 1;
  lo -= margin;
  hi += margin;
  const x = i => pad.l + i * (W - pad.l - pad.r) / Math.max(1, candles.length - 1);
  const y = v => pad.t + (hi - v) * (H - pad.t - pad.b) / (hi - lo);
  let out = `<rect x="0" y="0" width="${W}" height="${H}" rx="14" fill="#0b111a"/>`;
  for (let i = 0; i < 5; i++) {
    const v = hi - (hi - lo) * i / 4;
    out += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="#253044"/><text x="8" y="${y(v) + 4}" fill="#8793a7" font-size="11">${num(v)}</text>`;
  }
  const cw = Math.max(2, Math.min(14, (W - pad.l - pad.r) / candles.length * 0.65));
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
  lineDefs.forEach(([key, label, color]) => {
    if (levels[key] == null) return;
    const v = Number(levels[key]);
    if (!Number.isFinite(v)) return;
    out += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="${color}" stroke-dasharray="6 5"/><text x="${W - pad.r - 5}" y="${y(v) - 5}" text-anchor="end" fill="${color}" font-size="11">${label} ${num(v)}</text>`;
  });
  (data.evidenceMarkers || []).forEach(m => {
    const t = new Date(m.time).getTime(), idx = candles.findIndex(c => new Date(c.time).getTime() >= t);
    if (idx < 0) return;
    const xx = x(idx);
    out += `<circle cx="${xx}" cy="${pad.t + 10}" r="5" fill="#f6c66d"><title>${esc(m.type)} · ${esc(m.label)}</title></circle>`;
  });
  out += `<text x="${pad.l}" y="${H - 12}" fill="#8793a7" font-size="11">${fmtDate(candles[0].time)}</text><text x="${W - pad.r}" y="${H - 12}" text-anchor="end" fill="#8793a7" font-size="11">${fmtDate(candles[candles.length - 1].time)}</text>`;
  svg.innerHTML = out;
  const requested = data.requestedBefore || candles.length;
  const incomplete = data.dataHealth && !data.dataHealth.historyComplete;
  if ($('chartStatus')) $('chartStatus').textContent = `LIVE OHLC · ${candles.length} candles · ${data.provider || 'twelvedata'}${incomplete ? ' · HISTORY_INSUFFICIENT' : ''}`;
  if ($('chartLegend')) $('chartLegend').innerHTML = '<span class="legend-live">● LIVE OHLC</span> ' + lineDefs.map(x => `<span style="color:${x[2]}">━ ${x[1]}</span>`).join(' ');
}

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

// Automatically load live data on open
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadAll);
} else {
  loadAll();
}
