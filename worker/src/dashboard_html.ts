export const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SLK Bot · Algorithmic Trading Portfolio & Live Track Record</title>
  <style>
:root{--bg:#090c12;--panel:#111722;--panel2:#151d2a;--line:#273245;--text:#eef3fb;--muted:#8793a7;--accent:#8cf0c6;--blue:#80a9ff;--danger:#ff8f9b;--amber:#f6c66d;--radius:18px}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 85% -10%,#1c2b3f 0,transparent 35%),var(--bg);color:var(--text);font:14px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.topbar{height:72px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;padding:0 5vw;background:#0b1018cc;backdrop-filter:blur(14px)}.brand{display:flex;align-items:center;gap:11px;font-size:20px;letter-spacing:-.03em}.brand small{display:block;color:var(--muted);font-size:10px;letter-spacing:.12em;text-transform:uppercase}.brand-mark{display:grid;place-items:center;width:38px;height:38px;border:1px solid #4c806e;border-radius:12px;color:var(--accent);font-weight:800;font-size:12px}.status{display:flex;gap:8px;align-items:center;color:var(--muted);font-size:12px}.dot{width:8px;height:8px;border-radius:50%;background:var(--muted)}.dot.ok{background:var(--accent);box-shadow:0 0 12px var(--accent)}.dot.bad{background:var(--danger)}.shell{max-width:1180px;margin:0 auto;padding:54px 24px 70px}.hero{display:flex;justify-content:space-between;align-items:end;gap:30px;margin-bottom:34px}.eyebrow{color:var(--accent);font-size:10px;font-weight:800;letter-spacing:.16em;margin:0 0 8px;text-transform:uppercase}.hero h1{font-size:clamp(32px,5vw,58px);line-height:1.03;letter-spacing:-.06em;margin:0 0 15px;max-width:720px}.lede{color:var(--muted);font-size:16px;max-width:590px;margin:0}.execution-badge{border:1px solid #8b713b;background:#211c12;border-radius:16px;padding:17px 20px;min-width:170px}.execution-badge span,.execution-badge small{display:block;color:var(--amber);font-size:10px;letter-spacing:.13em;text-transform:uppercase}.execution-badge strong{display:block;font-size:21px;margin:3px 0;color:#ffe0a0}.execution-badge small{letter-spacing:0;color:#bd9e65;text-transform:none}.panel{border:1px solid var(--line);background:linear-gradient(145deg,#131b27e6,#0f151fe6);border-radius:var(--radius);padding:22px;box-shadow:0 18px 55px #00000022}.connection{display:flex;align-items:center;justify-content:space-between;gap:24px;margin-bottom:32px}.panel h2{font-size:17px;letter-spacing:-.02em;margin:0 0 4px}.panel p{color:var(--muted);margin:0}.connection-form{display:flex;gap:8px;min-width:min(610px,100%)}input,select,button{font:inherit;border-radius:10px;border:1px solid var(--line);background:#0c121b;color:var(--text);padding:10px 12px}input[type=url]{flex:1;min-width:230px}input[type=password]{width:180px}button{cursor:pointer;background:var(--accent);border-color:var(--accent);color:#07110d;font-weight:750}button:hover{filter:brightness(1.08)}button.secondary{background:transparent;border-color:var(--line);color:var(--text)}.error{color:var(--danger)!important;margin-top:10px!important}.tabs{display:flex;gap:8px;border-bottom:1px solid var(--line);margin-bottom:24px}.tab{background:transparent;border:0;color:var(--muted);border-radius:0;padding:12px 15px;border-bottom:2px solid transparent}.tab.active{color:var(--text);border-bottom-color:var(--accent)}.tab-panel{display:none}.tab-panel.active{display:block}.metric-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:18px}.metric{border:1px solid var(--line);background:var(--panel);border-radius:var(--radius);padding:19px}.metric span,.metric small{display:block;color:var(--muted);font-size:12px}.metric strong{display:block;font-size:30px;letter-spacing:-.05em;margin:9px 0 3px}.metric .small-value{font-size:18px;margin-top:17px;color:var(--amber)}.two-col{display:grid;grid-template-columns:1.35fr .8fr;gap:18px}.panel-head{display:flex;align-items:start;justify-content:space-between;gap:18px;margin-bottom:20px}.pill{border-radius:999px;padding:5px 9px;font-size:10px;white-space:nowrap}.pill.green{color:var(--accent);background:#153126;border:1px solid #295b47}.pill.gray{color:var(--muted);background:#1a2230;border:1px solid var(--line)}.steps{display:flex;align-items:center;flex-wrap:wrap;gap:7px;color:#8e9bb0;font-size:11px}.steps b{color:var(--accent);background:#153126;border-radius:8px;padding:6px 8px}.steps i{font-style:normal;color:#536074}.muted-copy{font-size:12px;margin-top:22px!important}.health-card dl{margin:0}.health-card dl div{display:flex;justify-content:space-between;border-bottom:1px solid var(--line);padding:10px 0}.health-card dt{color:var(--muted)}.health-card dd{margin:0;text-align:right}.alert-list{display:grid;gap:10px}.alert-row{display:grid;grid-template-columns:1.1fr .7fr .7fr .8fr;gap:12px;align-items:center;border:1px solid var(--line);border-radius:13px;padding:16px;background:#0e151f;color:#eef3fb!important;width:100%;text-align:left;cursor:pointer;transition:background .15s ease,border-color .15s ease}
.alert-row:hover{border-color:#54719c;background:#142033}
.alert-row strong,.alert-row .alert-pair,.alert-row .alert-val{display:block;font-size:14px;color:#f1f5f9!important;font-weight:700;margin-top:2px}
.alert-row small,.alert-row .alert-meta{display:block;color:#94a3b8!important;font-size:12px;margin-top:3px}
.alert-row span{display:block;color:#7d8ba1!important;font-size:11px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px}
.state{color:var(--accent)!important}
.state.loss{color:var(--danger)!important}
.notice{border-color:#554a2e;background:#1a1811}.notice h2{color:#ffe0a0;margin-top:2px}.notice p:last-child{margin-top:12px}.health-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.health-item{border:1px solid var(--line);border-radius:12px;padding:15px;background:#0e151f}.health-item span{display:block;color:var(--muted);font-size:11px}.health-item strong{display:block;margin-top:6px}.empty{padding:28px;border:1px dashed #344157;border-radius:13px;color:var(--muted);text-align:center}.connection+.tabs{}.header-actions{display:flex;align-items:center;gap:14px}
.tg-btn{display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,#2481cc,#2aabee);color:#fff;text-decoration:none;font-weight:700;font-size:12px;padding:8px 14px;border-radius:10px;box-shadow:0 4px 14px rgba(42,171,238,.28);transition:transform .15s ease,box-shadow .15s ease}
.tg-btn:hover{transform:translateY(-1px);box-shadow:0 6px 18px rgba(42,171,238,.42);filter:brightness(1.05)}
.tg-btn svg{width:16px;height:16px}
.vip-btn{display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,#f59e0b,#eab308);color:#120c02;text-decoration:none;font-weight:800;font-size:12px;padding:8px 15px;border-radius:10px;box-shadow:0 4px 16px rgba(245,158,11,.35);transition:transform .15s ease,box-shadow .15s ease}
.vip-btn:hover{transform:translateY(-1px);box-shadow:0 6px 22px rgba(245,158,11,.55);filter:brightness(1.06)}
.vip-btn svg{width:15px;height:15px}
.admin-toggle-btn{background:transparent;border:1px solid var(--line);color:var(--muted);padding:6px 10px;font-size:14px;border-radius:10px;cursor:pointer}
.admin-toggle-btn:hover{color:var(--text);border-color:#54719c}
.accent-text{color:var(--accent)!important}
.profit-text{color:#8cf0c6!important}
.loss-text{color:#ff8f9b!important}
.footer-content{display:flex;justify-content:space-between;align-items:center;max-width:1180px;margin:0 auto}
.footer-content a{color:var(--accent);text-decoration:none}
.footer-content a:hover{text-decoration:underline}
@media(max-width:800px){.footer-content{flex-direction:column;gap:8px;text-align:center}}
@media(max-width:800px){.hero,.connection{align-items:stretch;flex-direction:column}.connection-form{flex-direction:column;min-width:0}.connection-form input,.connection-form button{width:100%}.metric-grid{grid-template-columns:repeat(2,1fr)}.two-col{grid-template-columns:1fr}.health-grid{grid-template-columns:1fr}.alert-row{grid-template-columns:1fr 1fr}.tabs{overflow:auto}.tab{white-space:nowrap}}
.modal[hidden]{display:none}.modal{position:fixed;inset:0;z-index:10;display:grid;place-items:center;padding:22px}.modal-backdrop{position:absolute;inset:0;background:#02050acc;backdrop-filter:blur(8px)}.chart-dialog{position:relative;width:min(1100px,100%);max-height:92vh;overflow:auto;z-index:1}.chart-wrap{overflow:auto;border:1px solid var(--line);border-radius:14px;background:#0b111a}.chart-wrap svg{display:block;width:100%;min-width:680px;height:auto}.chart-notice{padding:14px;border:1px solid #6b5730;background:#211c12;color:#ffe0a0;border-radius:11px;margin-bottom:14px}.chart-legend{display:flex;gap:13px;flex-wrap:wrap;color:var(--muted);font-size:11px;margin-top:12px}.legend-live{color:var(--accent)}.chart-disclaimer{font-size:12px;margin-top:14px!important;color:#b89f6c!important}
.preference-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}.preference-card{display:flex;justify-content:space-between;gap:20px;align-items:center;border:1px solid var(--line);border-radius:14px;padding:18px;background:#0e151f;cursor:pointer}.preference-card h3{margin:0 0 6px;font-size:16px}.preference-card p{font-size:12px;max-width:390px}.preference-card input{width:22px;height:22px;accent-color:var(--accent)}.preference-footer{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:16px}.preference-warning{margin-top:18px;padding:14px;border-color:#554a2e;background:#1a1811}.preference-warning strong{color:#ffe0a0}.preference-warning p{margin-top:4px;font-size:12px}@media(max-width:800px){.preference-grid{grid-template-columns:1fr}.preference-footer{align-items:stretch;flex-direction:column}}
.preference-actions{display:flex;gap:8px;flex-wrap:wrap}
@media(max-width:800px){.preference-actions{width:100%;flex-direction:column}.preference-actions button{width:100%}}
.filter-bar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}.filter-bar input,.filter-bar select{min-width:130px}.filter-bar input{flex:1}.pagination{display:flex;justify-content:center;align-items:center;gap:14px;margin-top:18px;color:var(--muted);font-size:12px}.pagination button:disabled{opacity:.45;cursor:not-allowed}
.period-btn{background:transparent;border:1px solid var(--line);color:var(--muted);font-size:12px;padding:6px 12px;border-radius:8px;cursor:pointer;font-weight:600;transition:all .15s ease}.period-btn:hover{color:var(--text);border-color:#54719c}.period-btn.active{background:var(--panel2);border-color:var(--accent);color:var(--accent)}.breakdown-list{display:grid;gap:8px}.breakdown-row{display:grid;grid-template-columns:1.2fr 1fr .8fr;gap:10px;align-items:center;border:1px solid var(--line);border-radius:11px;padding:12px;background:#0e151f}.breakdown-row span{color:var(--muted);font-size:12px}.breakdown-row b{color:var(--accent);text-align:right;font-size:12px}@media(max-width:800px){.breakdown-row{grid-template-columns:1fr}.breakdown-row b{text-align:left}}

</style>
</head>
<body>
  <header class="topbar">
    <div class="brand">
      <span class="brand-mark">SLK</span>
      <div>
        <strong>SLK Radar</strong>
        <small>Quantitative Track Record</small>
      </div>
    </div>
    <div class="header-actions">
      <a href="https://whop.com/slk-radar/slk-radar-vip-signals" target="_blank" rel="noopener noreferrer" class="vip-btn">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
        <span>VIP Access</span>
      </a>
      <div class="status">
        <span id="statusDot" class="dot muted"></span>
        <span id="statusText">Connecting…</span>
      </div>
    </div>
  </header>

  <main class="shell">
    <section class="hero">
      <div>
        <p class="eyebrow">ALGORITHMIC SLK CONFIRMATION ENGINE</p>
        <h1>Live Quantitative Performance & Trade Journal</h1>
        <p class="lede">Real-time verified paper outcomes from institutional key-level liquidity sweeps, market structure shifts, and confirmation entries across 10 Forex, Metal, and Index markets.</p>
        <div style="margin-top: 20px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap;">
          <a href="https://whop.com/slk-radar/slk-radar-vip-signals" target="_blank" rel="noopener noreferrer" class="vip-btn" style="padding: 10px 18px; font-size: 13px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
            <span>Get VIP Signals Access ($100/mo)</span>
          </a>
        </div>
      </div>
      <div class="execution-badge">
        <span>EXECUTION</span>
        <strong>PAPER MODE</strong>
        <small>Automated Cloud Scanner</small>
      </div>
    </section>

    <nav class="tabs" aria-label="Dashboard sections">
      <button class="tab active" data-tab="overview">Overview</button>
      <button class="tab" data-tab="performance">Performance</button>
      <button class="tab" data-tab="alerts">Trade Journal & Alerts</button>
      <button class="tab" data-tab="health">Market Health</button>
      <button class="tab" data-tab="preferences">Channel Settings</button>
    </nav>

    <section id="overview" class="tab-panel active">
      <div class="metric-grid">
        <article class="metric">
          <span>Net Return</span>
          <strong id="overviewNetR" class="accent-text">—</strong>
          <small>Verified cumulative R</small>
        </article>
        <article class="metric">
          <span>Win Rate</span>
          <strong id="winRate">—</strong>
          <small>TP / (TP + SL)</small>
        </article>
        <article class="metric">
          <span>Active / Open</span>
          <strong id="open">—</strong>
          <small>trades in market</small>
        </article>
        <article class="metric">
          <span>Total Signals</span>
          <strong id="total">—</strong>
          <small>confirmed setups</small>
        </article>
      </div>

      <div class="two-col">
        <article class="panel lifecycle">
          <div class="panel-head">
            <div>
              <p class="eyebrow">SLK CONFIRMATION MODEL (STRUCTURE · LIQUIDITY · KEY LEVELS)</p>
              <h2>Entry Lifecycle</h2>
            </div>
            <span class="pill green">Institutional rules</span>
          </div>
          <div class="steps">
            <span>MAP</span><i>→</i>
            <span>TOUCH</span><i>→</i>
            <span>SWEEP</span><i>→</i>
            <span>SHIFT (BOS)</span><i>→</i>
            <span>RETEST</span><i>→</i>
            <b>CONFIRMED ENTRY</b><i>→</i>
            <span>OUTCOME</span>
          </div>
          <p class="muted-copy">Signals require liquidity draw alignment, pullback structure break, FVG rebalance, and a minimum 3.0 Risk:Reward target.</p>
        </article>

        <article class="panel health-card">
          <div class="panel-head">
            <div>
              <p class="eyebrow">SYSTEM</p>
              <h2>Engine Status</h2>
            </div>
            <span id="healthPill" class="pill green">Live · 24/7</span>
          </div>
          <dl>
            <div><dt>Cloud Engine</dt><dd id="workerName">slk-alert-worker</dd></div>
            <div><dt>Mode</dt><dd id="mode">PAPER / VERIFIED</dd></div>
            <div><dt>Active Markets (10)</dt><dd id="pairs">EURUSD · GBPUSD · USDJPY · AUDJPY · GBPJPY · XAUUSD · NAS100 · US30 · GER40 · JAPAN225</dd></div>
            <div><dt>Last Checked</dt><dd id="lastResponse">—</dd></div>
          </dl>
        </article>
      </div>
    </section>

    <section id="performance" class="tab-panel">
      <div class="panel-head" style="align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 14px;">
        <div>
          <p class="eyebrow">PORTFOLIO TRACK RECORD</p>
          <h2 style="margin:0;">Verified Strategy Performance</h2>
        </div>
        <div class="period-filter-group" style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
          <span style="color: var(--muted); font-size: 12px; font-weight: 600;">Period:</span>
          <div class="period-pills" id="perfPeriodButtons" style="display: flex; gap: 6px;">
            <button type="button" class="period-btn active" data-period="all">All Time</button>
            <button type="button" class="period-btn" data-period="90d">90D</button>
            <button type="button" class="period-btn" data-period="30d">30D</button>
            <button type="button" class="period-btn" data-period="7d">7D</button>
            <button type="button" class="period-btn" data-period="today">Today</button>
          </div>
          <span id="perfPeriodBadge" class="pill green">All Time</span>
        </div>
      </div>

      <div class="period-date-bar" style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; padding: 12px 18px; background: var(--panel2); border: 1px solid var(--line); border-radius: 12px; margin-bottom: 20px; font-size: 12px;">
        <span style="color: var(--muted);">📅 Date Range: <strong id="perfDateSpan" style="color: var(--text);">All Recorded Outcomes</strong></span>
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
          <span style="color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;">Custom Range:</span>
          <input id="perfFromDate" type="date" style="padding: 5px 10px; font-size: 12px; background: #0c121b; border: 1px solid var(--line); color: var(--text); border-radius: 7px;" aria-label="From Date">
          <span style="color: var(--muted);">to</span>
          <input id="perfToDate" type="date" style="padding: 5px 10px; font-size: 12px; background: #0c121b; border: 1px solid var(--line); color: var(--text); border-radius: 7px;" aria-label="To Date">
          <button id="applyPerfDates" class="secondary" style="padding: 5px 12px; font-size: 12px; border-radius: 7px;">Filter</button>
          <button id="resetPerfDates" class="secondary" style="padding: 5px 12px; font-size: 12px; border-radius: 7px;">Reset</button>
        </div>
      </div>

      <div class="metric-grid">
        <article class="metric"><span>Net Return</span><strong id="netR" class="accent-text">—</strong><small>cumulative R (<span id="perfPeriodLabel">All Time</span>)</small></article>
        <article class="metric"><span>TP Hits</span><strong id="tp" class="profit-text">—</strong><small>full target reached</small></article>
        <article class="metric"><span>SL Hits</span><strong id="sl" class="loss-text">—</strong><small>stop loss triggered</small></article>
        <article class="metric"><span>Max Drawdown</span><strong id="maxDD">—</strong><small>peak to trough</small></article>
        <article class="metric"><span>Completed</span><strong id="completed">—</strong><small>resolved trades</small></article>
        <article class="metric"><span>Expired</span><strong id="expired">—</strong><small>120 bars without resolution</small></article>
      </div>

      <article class="panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">COMPLETED OUTCOMES</p>
            <h2>Pair and Timeframe Breakdown</h2>
          </div>
        </div>
        <div id="performanceBreakdown" class="breakdown-list">
          <div class="empty">Loading performance metrics…</div>
        </div>
      </article>

      <article class="panel notice">
        <p class="eyebrow">RESEARCH & TRANSPARENCY</p>
        <h2>Algorithmic Paper Ledger</h2>
        <p>All statistics are derived from automated Cloudflare D1 database trade records executing SLK confirmation rules (Structure, Liquidity, Key Levels) on live broker market data. Not financial advice. See <a href="terms.html" style="color:var(--accent); text-decoration: underline;">Terms & Risk Disclaimer</a>.</p>
      </article>
    </section>

    <section id="alerts" class="tab-panel">
      <div class="panel-head" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
        <div>
          <p class="eyebrow">SIGNAL LEDGER</p>
          <h2>Confirmed Trade History</h2>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <button id="expireOpenBtn" type="button" class="secondary" style="font-size: 11px; padding: 6px 12px; border-radius: 8px; border: 1px solid var(--line); color: var(--accent); cursor: pointer;" title="Close active open positions as Expired">⚡ Close Open Trades</button>
          <span id="alertTotal" class="pill gray">— results</span>
        </div>
      </div>

      <div class="filter-bar">
        <select id="alertPair" aria-label="Pair"><option value="">All pairs</option></select>
        <select id="alertTimeframe" aria-label="Timeframe"><option value="">All timeframes</option><option>30m</option><option>1h</option><option>H1</option></select>
        <select id="alertDirection" aria-label="Direction"><option value="">Both directions</option><option value="LONG">Long</option><option value="SHORT">Short</option></select>
        <select id="alertLifecycle" aria-label="Lifecycle"><option value="">All states</option><option value="OPEN">Open (Active)</option><option value="TP_HIT">TP Hit</option><option value="SL_HIT">SL Hit</option><option value="EXPIRED">Expired</option></select>
        <div class="date-filter-group" style="display: flex; align-items: center; gap: 6px;">
          <span style="color: var(--muted); font-size: 11px;">From:</span>
          <input id="alertFrom" type="date" aria-label="From UTC" style="padding: 7px 9px;">
          <span style="color: var(--muted); font-size: 11px;">To:</span>
          <input id="alertTo" type="date" aria-label="To UTC" style="padding: 7px 9px;">
        </div>
        <select id="alertOutcome" aria-label="Outcome" hidden><option value="">All outcomes</option></select>
        <select id="alertChannel" aria-label="Channel" hidden><option value="">All channels</option></select>
        <select id="alertProvider" aria-label="Provider" hidden><option value="">All providers</option></select>
        <input id="alertSearch" type="search" placeholder="Search pair (e.g. XAUUSD, USDJPY)" aria-label="Search alerts">
        <select id="alertSort" aria-label="Sort"><option value="candleCloseTime">Newest</option><option value="pair">Pair</option><option value="status">Status</option></select>
        <button id="clearAlertFilters" class="secondary">Clear</button>
      </div>

      <div id="alertsList" class="alert-list">
        <div class="empty">Loading trade records…</div>
      </div>
      <div class="pagination">
        <button id="prevAlerts" class="secondary">Previous</button>
        <span id="alertPage">Page 1</span>
        <button id="nextAlerts" class="secondary">Next</button>
      </div>
    </section>

    <section id="health" class="tab-panel">
      <article class="panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">FEED HEALTH</p>
            <h2>Active Watchlist & Data Status</h2>
          </div>
          <button id="refreshBtn" class="secondary">Refresh Data</button>
        </div>
        <div id="healthDetails" class="health-grid">
          <div class="empty">Loading feed health…</div>
        </div>
      </article>
    </section>

    <section id="preferences" class="tab-panel">
      <article class="panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">TELEGRAM & NOTIFICATIONS</p>
            <h2>Channel Configuration</h2>
            <p class="muted-copy">Confirmed alerts automatically post to your connected Telegram channel.</p>
          </div>
          <span id="preferenceStatus" class="pill green">Active</span>
        </div>
        <div class="preference-grid">
          <label class="preference-card">
            <div>
              <span class="eyebrow">TELEGRAM</span>
              <h3>Confirmed Entry Alerts</h3>
              <p>Posts full SLK confirmation entry, stop-loss, 3R target, bias grade, and path to your channel.</p>
            </div>
            <span class="pill green">Enabled</span>
          </label>
          <label class="preference-card">
            <div>
              <span class="eyebrow">TELEGRAM</span>
              <h3>WATCH Heads-up Notifications</h3>
              <p>Optional setup forming heads-up (TOUCH/SWEEP/SHIFT).</p>
            </div>
            <input id="telegramWatch" type="checkbox" aria-label="Enable Telegram WATCH notifications">
          </label>
        </div>
        <div class="preference-footer">
          <span id="preferenceMeta" class="muted-copy">Direct delivery to Trade jounal channel active.</span>
          <div class="preference-actions">
            <button id="testTelegram" class="secondary">Send Test to Telegram</button>
            <button id="savePreferences">Save Preferences</button>
          </div>
        </div>
      </article>
    </section>

    <div id="chartModal" class="modal" hidden>
      <div class="modal-backdrop" data-close-chart></div>
      <section class="chart-dialog panel" role="dialog" aria-modal="true" aria-labelledby="chartTitle">
        <div class="panel-head">
          <div>
            <p class="eyebrow">REAL OHLC EVIDENCE</p>
            <h2 id="chartTitle">Signal Chart</h2>
            <p id="chartStatus" class="muted-copy"></p>
          </div>
          <button class="secondary" data-close-chart>Close</button>
        </div>
        <div id="chartNotice" class="chart-notice" hidden></div>
        <div class="chart-wrap"><svg id="ohlcChart" viewBox="0 0 1000 460" role="img" aria-label="OHLC evidence chart"></svg></div>
        <div id="chartLegend" class="chart-legend"></div>
        <p class="chart-disclaimer">Real historical candles with entry, stop loss, invalidation, and target levels visualized.</p>
      </section>
    </div>
  </main>

  <footer>
    <div class="footer-content">
      <span>SLK Radar · Algorithmic Quantitative Portfolio · 24/7 Automated Cloud Monitoring</span>
      <div style="display: flex; gap: 18px; align-items: center; flex-wrap: wrap;">
        <a href="terms.html" style="color: var(--muted); font-size: 13px;">Terms & Conditions</a>
        <a href="https://whop.com/slk-radar/slk-radar-vip-signals" target="_blank" rel="noopener noreferrer" style="color: #f6c66d; font-weight: 700;">⭐ Join VIP Signals</a>
      </div>
    </div>
  </footer>
  <script>
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
  perfTo: ''
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
    ...(options.admin && state.adminKey ? { Authorization: \`Bearer \${state.adminKey}\` } : {}),
    ...(options.body ? { 'Content-Type': 'application/json' } : {})
  };
  const r = await fetch(state.url.replace(/\\/$/, '') + path, { ...options, headers });
  if (!r.ok) throw new Error(\`\${r.status} \${await r.text()}\`);
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
    let q = '';
    if (state.perfPeriod && state.perfPeriod !== 'all' && state.perfPeriod !== 'custom') {
      q = \`?period=\${encodeURIComponent(state.perfPeriod)}\`;
    } else if (state.perfPeriod === 'custom' || state.perfFrom || state.perfTo) {
      const p = new URLSearchParams();
      if (state.perfFrom) p.set('from', state.perfFrom);
      if (state.perfTo) p.set('to', state.perfTo);
      q = \`?\${p.toString()}\`;
    }
    const s = await api(\`/stats\${q}\`);
    renderStats(s);
    return s;
  } catch (e) {
    console.error('Failed to load stats:', e);
    return null;
  }
}

function setStatus(text, kind) {
  if ($('statusText')) $('statusText').textContent = text;
  if ($('statusDot')) $('statusDot').className = \`dot \${kind}\`;
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
      pairSelect.innerHTML = '<option value="">All pairs</option>' + h.pairs.map(p => \`<option value="\${esc(p)}">\${esc(p)}</option>\`).join('');
      pairSelect.value = curVal;
    }
  }
  if ($('healthPill')) {
    $('healthPill').textContent = h.ok ? 'Live · 24/7' : 'degraded';
    $('healthPill').className = \`pill \${h.ok ? 'green' : 'gray'}\`;
  }
  if ($('healthDetails')) {
    $('healthDetails').innerHTML = \`
      <div class="health-item"><span>Cloud Service</span><strong>\${esc(h.service || '—')}</strong></div>
      <div class="health-item"><span>Active Timeframes</span><strong>\${esc((h.entryTfs || []).join(' · ') || '—')}</strong></div>
      <div class="health-item"><span>Server Time (UTC)</span><strong>\${esc(h.time || '—')}</strong></div>
      <div class="health-item"><span>Coverage</span><strong>\${(h.pairs || []).length} Markets Active</strong></div>
      <div class="health-item"><span>Execution Mode</span><strong>Paper / Verified Quantitative</strong></div>
      <div class="health-item"><span>Signals Destination</span><strong>Trade jounal Channel</strong></div>
    \`;
  }
}

function fmtDateOnly(x) {
  if (!x) return '';
  const d = new Date(x);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

function renderStats(s) {
  if (!s) return;
  const netRText = s.netR == null ? '—' : \`\${Number(s.netR) > 0 ? '+' : ''}\${Number(s.netR).toFixed(2)}R\`;
  if ($('total')) $('total').textContent = s.total ?? '—';
  if ($('open')) $('open').textContent = s.open ?? '—';
  if ($('tp')) $('tp').textContent = s.tp ?? '—';
  if ($('sl')) $('sl').textContent = s.sl ?? '—';
  if ($('expired')) $('expired').textContent = s.expired ?? '—';
  if ($('completed')) $('completed').textContent = s.completed ?? '—';
  if ($('overviewNetR')) $('overviewNetR').textContent = netRText;
  if ($('netR')) $('netR').textContent = netRText;
  if ($('maxDD')) $('maxDD').textContent = s.maxDD == null ? '—' : \`\${Number(s.maxDD).toFixed(2)}R\`;
  if ($('winRate')) $('winRate').textContent = s.winRate == null ? '—' : \`\${(s.winRate * 100).toFixed(1)}%\`;
  
  if ($('perfPeriodBadge')) $('perfPeriodBadge').textContent = s.periodLabel || 'All Time';
  if ($('perfPeriodLabel')) $('perfPeriodLabel').textContent = s.periodLabel || 'All Time';
  if ($('perfDateSpan')) {
    if (s.firstDate && s.lastDate) {
      const startStr = fmtDateOnly(s.firstDate);
      const endStr = fmtDateOnly(s.lastDate);
      $('perfDateSpan').textContent = startStr === endStr ? startStr : \`\${startStr} to \${endStr}\`;
    } else if (s.from || s.to) {
      $('perfDateSpan').textContent = \`\${fmtDateOnly(s.from) || 'Start'} to \${fmtDateOnly(s.to) || 'Present'}\`;
    } else {
      $('perfDateSpan').textContent = 'All Recorded Outcomes';
    }
  }
  if ($('overviewPeriodBadge')) {
    $('overviewPeriodBadge').textContent = s.periodLabel ? \`Period: \${s.periodLabel}\` : 'All-Time Record';
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
      dateContext = f === l ? \`Date: \${l}\` : \`\${f} → \${l}\`;
    }
    return \`
      <div class="breakdown-row">
        <div>
          <strong style="color:#f1f5f9;">\${esc(r.group)}</strong>
          <small style="display:block; color:var(--muted); font-size:11px; margin-top:2px;">📅 \${dateContext}</small>
        </div>
        <span>\${r.completed} completed · <span class="profit-text">\${r.tp} TP</span> · <span class="loss-text">\${r.sl} SL</span></span>
        <b>\${Number(r.netR) > 0 ? '+' : ''}\${Number(r.netR).toFixed(2)}R · Max DD \${Number(r.maxDD).toFixed(2)}R</b>
      </div>
    \`;
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
    $('preferenceMeta').textContent = \`Direct Telegram delivery active · Trade jounal channel\`;
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
      $('preferenceStatus').textContent = \`\${channel} test: \${status}\`;
      $('preferenceStatus').className = \`pill \${status === 'ok' ? 'green' : 'gray'}\`;
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
    const result = await api(\`/alerts?\${alertParams()}\`);
    state.alerts = Array.isArray(result) ? result : (result.items || []);
    state.alertTotal = result.total ?? state.alerts.length;
    if ($('alertTotal')) $('alertTotal').textContent = \`\${state.alertTotal} setups recorded\`;
    if ($('alertPage')) $('alertPage').textContent = \`Page \${state.alertPage}\`;
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
      statusLabel = 'TP HIT ✅ (+3R)';
      statusClass = 'profit-text';
    } else if (a.status === 'SL_HIT') {
      statusLabel = 'STOP LOSS 🛑 (-1R)';
      statusClass = 'loss-text';
    } else if (a.status === 'OPEN') {
      statusLabel = a.alertStatus === 'SUPPRESSED' ? 'OPEN · AUDIT' : 'ACTIVE IN MARKET';
      statusClass = 'state';
    } else if (a.status === 'EXPIRED') {
      statusLabel = 'EXPIRED ⌛';
      statusClass = 'state';
    }
    return \`
      <button class="alert-row" data-setup="\${esc(a.setupId)}" data-tf="\${esc(a.tf)}">
        <div>
          <strong class="alert-pair">\${esc(a.pair)} · \${esc(a.tf)} · <span class="\${dirClass}">\${esc(a.direction)}</span></strong>
          <small class="alert-meta">\${esc(a.keyLevel || 'Key Level')} · \${fmtDate(a.candleCloseTime)}</small>
        </div>
        <div>
          <span>Entry Price</span>
          <strong class="alert-val">\${num(a.entry)}</strong>
        </div>
        <div>
          <span>SL / TP1</span>
          <strong class="alert-val">\${num(a.stopLoss)} / \${num(a.tp1)}</strong>
        </div>
        <div>
          <span>Lifecycle Status</span>
          <strong class="\${statusClass}">\${statusLabel}</strong>
        </div>
      </button>
    \`;
  }).join('');
  document.querySelectorAll('.alert-row').forEach(row => {
    row.addEventListener('click', () => openChart(row.dataset.setup, row.dataset.tf));
  });
}

async function openChart(setupId, tf) {
  if (!$('chartModal')) return;
  $('chartModal').hidden = false;
  $('chartTitle').textContent = \`\${setupId} · OHLC Evidence\`;
  $('chartStatus').textContent = 'Loading market candles…';
  $('chartNotice').hidden = true;
  $('ohlcChart').innerHTML = '';
  try {
    const data = await api(\`/dashboard/signals/\${encodeURIComponent(setupId)}/chart?timeframe=\${encodeURIComponent(tf)}&before=200&after=20\`);
    if (data.status && data.status !== 'OK' && (!data.candles || !data.candles.length)) {
      showChartNotice(\`\${data.status}: \${data.error || 'No finalized history available.'}\`);
      return;
    }
    renderChart(data);
  } catch (e) {
    showChartNotice(\`Chart unavailable: \${e.message}\`);
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
  let out = \`<rect x="0" y="0" width="\${W}" height="\${H}" rx="14" fill="#0b111a"/>\`;
  for (let i = 0; i < 5; i++) {
    const v = hi - (hi - lo) * i / 4;
    out += \`<line x1="\${pad.l}" x2="\${W - pad.r}" y1="\${y(v)}" y2="\${y(v)}" stroke="#253044"/><text x="8" y="\${y(v) + 4}" fill="#8793a7" font-size="11">\${num(v)}</text>\`;
  }
  const cw = Math.max(2, Math.min(14, (W - pad.l - pad.r) / candles.length * 0.65));
  candles.forEach((c, i) => {
    const xx = x(i), up = c.close >= c.open, color = up ? '#8cf0c6' : '#ff8f9b', bodyY = Math.min(y(c.open), y(c.close)), bodyH = Math.max(1, Math.abs(y(c.open) - y(c.close)));
    out += \`<g><title>\${fmtDate(c.time)} · O \${num(c.open)} H \${num(c.high)} L \${num(c.low)} C \${num(c.close)}</title><line x1="\${xx}" x2="\${xx}" y1="\${y(c.high)}" y2="\${y(c.low)}" stroke="\${color}"/><rect x="\${xx - cw / 2}" y="\${bodyY}" width="\${cw}" height="\${bodyH}" fill="\${color}" opacity=".9"/></g>\`;
  });
  const lineDefs = [
    ['entry', 'Entry', '#80a9ff'],
    ['stop', 'Stop', '#ff8f9b'],
    ['invalidation', 'Invalidation', '#f6c66d'],
    ['target1', 'TP1 (3R)', '#8cf0c6'],
    ['target2', 'TP2', '#65d6bd'],
    ['keyLevelLow', 'Key Low', '#b093ff'],
    ['keyLevelHigh', 'Key High', '#b093ff']
  ];
  lineDefs.forEach(([key, label, color]) => {
    if (levels[key] == null) return;
    const v = Number(levels[key]);
    if (!Number.isFinite(v)) return;
    out += \`<line x1="\${pad.l}" x2="\${W - pad.r}" y1="\${y(v)}" y2="\${y(v)}" stroke="\${color}" stroke-dasharray="6 5"/><text x="\${W - pad.r - 5}" y="\${y(v) - 5}" text-anchor="end" fill="\${color}" font-size="11">\${label} \${num(v)}</text>\`;
  });
  (data.evidenceMarkers || []).forEach(m => {
    const t = new Date(m.time).getTime(), idx = candles.findIndex(c => new Date(c.time).getTime() >= t);
    if (idx < 0) return;
    const xx = x(idx);
    out += \`<circle cx="\${xx}" cy="\${pad.t + 10}" r="5" fill="#f6c66d"><title>\${esc(m.type)} · \${esc(m.label)}</title></circle>\`;
  });
  out += \`<text x="\${pad.l}" y="\${H - 12}" fill="#8793a7" font-size="11">\${fmtDate(candles[0].time)}</text><text x="\${W - pad.r}" y="\${H - 12}" text-anchor="end" fill="#8793a7" font-size="11">\${fmtDate(candles[candles.length - 1].time)}</text>\`;
  svg.innerHTML = out;
  const requested = data.requestedBefore || candles.length;
  const incomplete = data.dataHealth && !data.dataHealth.historyComplete;
  if ($('chartStatus')) $('chartStatus').textContent = \`LIVE OHLC · \${candles.length} candles · \${data.provider || 'twelvedata'}\${incomplete ? ' · HISTORY_INSUFFICIENT' : ''}\`;
  if ($('chartLegend')) $('chartLegend').innerHTML = '<span class="legend-live">● LIVE OHLC</span> ' + lineDefs.map(x => \`<span style="color:\${x[2]}">━ \${x[1]}</span>\`).join(' ');
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

</script>
</body>
</html>
`;
