import { DEO_EDGE_LOGO_DATA_URI } from "./brand_logo";
import { DASHBOARD_THEME_CSS } from "./dashboard_theme_css";

export const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="DEO Edge confirmation engine and paper research ledger." />
  <title>DEO Edge · Confirmation Engine & Research Ledger</title>
  <link rel="icon" type="image/png" sizes="128x128" href="${DEO_EDGE_LOGO_DATA_URI}">
  <link rel="apple-touch-icon" sizes="180x180" href="${DEO_EDGE_LOGO_DATA_URI}">
  <meta name="theme-color" content="#080b0e">
  <style>
:root{--bg:#090c12;--panel:#111722;--panel2:#151d2a;--line:#273245;--text:#eef3fb;--muted:#94a3b8;--accent:#8cf0c6;--blue:#38bdf8;--danger:#ff8f9b;--amber:#f6c66d;--radius:18px}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 85% -10%,#1c2b3f 0,transparent 35%),var(--bg);color:var(--text);font:14px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.topbar{height:72px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;padding:0 5vw;background:#0b1018cc;backdrop-filter:blur(14px)}.brand{display:inline-flex;align-items:center;gap:10px;min-width:0;padding:6px 15px 6px 6px;border:1px solid rgba(140,240,198,.28);border-radius:999px;background:linear-gradient(180deg,#111923,#0b1018);box-shadow:0 8px 24px rgba(0,0,0,.24),inset 0 1px rgba(255,255,255,.04);color:var(--text);text-decoration:none;font-size:20px;letter-spacing:-.03em;transition:transform 140ms cubic-bezier(.23,1,.32,1),border-color 140ms cubic-bezier(.23,1,.32,1),box-shadow 140ms cubic-bezier(.23,1,.32,1)}.brand small{display:block;color:var(--muted);font-size:10px;letter-spacing:.12em;text-transform:uppercase}.brand-mark{display:block;flex:0 0 38px;width:38px;height:38px;object-fit:contain;border:1px solid rgba(255,255,255,.14);border-radius:12px;background:#000}.status{display:flex;gap:8px;align-items:center;color:var(--muted);font-size:12px}.dot{width:8px;height:8px;border-radius:50%;background:var(--muted)}.dot.ok{background:var(--accent);box-shadow:0 0 12px var(--accent)}.dot.bad{background:var(--danger)}.shell{max-width:1180px;margin:0 auto;padding:54px 24px 70px}.hero{display:flex;justify-content:space-between;align-items:end;gap:30px;margin-bottom:34px}.eyebrow{color:var(--accent);font-size:10px;font-weight:800;letter-spacing:.16em;margin:0 0 8px;text-transform:uppercase}.hero h1{font-size:clamp(32px,5vw,58px);line-height:1.03;letter-spacing:-.06em;margin:0 0 15px;max-width:720px}.lede{color:var(--muted);font-size:16px;max-width:590px;margin:0}.execution-badge{border:1px solid #8b713b;background:#211c12;border-radius:16px;padding:17px 20px;min-width:170px}.execution-badge span,.execution-badge small{display:block;color:var(--amber);font-size:10px;letter-spacing:.13em;text-transform:uppercase}.execution-badge strong{display:block;font-size:21px;margin:3px 0;color:#ffe0a0}.execution-badge small{letter-spacing:0;color:#bd9e65;text-transform:none}.panel{border:1px solid var(--line);background:linear-gradient(145deg,#131b27e6,#0f151fe6);border-radius:var(--radius);padding:22px;box-shadow:0 18px 55px #00000022}.connection{display:flex;align-items:center;justify-content:space-between;gap:24px;margin-bottom:32px}.panel h2{font-size:17px;letter-spacing:-.02em;margin:0 0 4px}.panel p{color:var(--muted);margin:0}.connection-form{display:flex;gap:8px;min-width:min(610px,100%)}input,select,button{font:inherit;border-radius:10px;border:1px solid var(--line);background:#0c121b;color:var(--text);padding:10px 12px}input[type=url]{flex:1;min-width:230px}input[type=password]{width:180px}button{cursor:pointer;background:var(--accent);border-color:var(--accent);color:#07110d;font-weight:750}button:hover{filter:brightness(1.08)}button.secondary{background:transparent;border-color:var(--line);color:var(--text)}.error{color:var(--danger)!important;margin-top:10px!important}.tabs{display:flex;gap:8px;border-bottom:1px solid var(--line);margin-bottom:24px}.tab{background:transparent;border:0;color:var(--muted);border-radius:0;padding:12px 15px;border-bottom:2px solid transparent}.tab.active{color:var(--text);border-bottom-color:var(--accent)}.tab-panel{display:none}.tab-panel.active{display:block}.metric-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:18px}.metric{border:1px solid var(--line);background:var(--panel);border-radius:var(--radius);padding:19px}.metric span,.metric small{display:block;color:var(--muted);font-size:12px}.metric strong{display:block;font-size:30px;letter-spacing:-.05em;margin:9px 0 3px}.metric .small-value{font-size:18px;margin-top:17px;color:var(--amber)}.two-col{display:grid;grid-template-columns:1.35fr .8fr;gap:18px}.panel-head{display:flex;align-items:start;justify-content:space-between;gap:18px;margin-bottom:20px}.pill{border-radius:999px;padding:5px 9px;font-size:10px;white-space:nowrap}.pill.green{color:var(--accent);background:#153126;border:1px solid #295b47}.pill.gray{color:var(--muted);background:#1a2230;border:1px solid var(--line)}.steps{display:flex;align-items:center;flex-wrap:wrap;gap:7px;color:#8e9bb0;font-size:11px}.steps b{color:var(--accent);background:#153126;border-radius:8px;padding:6px 8px}.steps i{font-style:normal;color:#536074}.muted-copy{font-size:12px;margin-top:22px!important}.mc-verdict{margin-top:26px;border-top:1px solid var(--line);padding-top:18px}.mc-verdict h3{margin:0 0 6px;font-size:15px}.health-card dl{margin:0}.health-card dl div{display:flex;justify-content:space-between;border-bottom:1px solid var(--line);padding:10px 0}.health-card dt{color:var(--muted)}.health-card dd{margin:0;text-align:right}.alert-list{display:grid;gap:10px}.alert-row{display:grid;grid-template-columns:1.1fr .7fr .7fr .8fr;gap:12px;align-items:center;border:1px solid var(--line);border-radius:13px;padding:16px;background:#0e151f;color:#eef3fb!important;width:100%;text-align:left;cursor:pointer;transition:background .15s ease,border-color .15s ease}
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
.period-btn{background:transparent;border:1px solid var(--line);color:var(--muted);font-size:12px;padding:6px 12px;border-radius:8px;cursor:pointer;font-weight:600;transition:all .15s ease}.period-btn:hover{color:var(--text);border-color:#54719c}.period-btn.active{background:var(--panel2);border-color:var(--accent);color:var(--accent)}.breakdown-list{display:grid;gap:8px}.breakdown-row{display:grid;grid-template-columns:1.2fr 1fr .8fr;gap:10px;align-items:center;border:1px solid var(--line);border-radius:11px;padding:12px;background:#0e151f}.breakdown-row span{color:var(--muted);font-size:12px}.breakdown-row b{color:var(--text);text-align:right;font-size:12px}.breakdown-row b.loss-text{color:var(--danger)!important}.breakdown-row b.profit-text{color:var(--accent)!important}@media(max-width:800px){.breakdown-row{grid-template-columns:1fr}.breakdown-row b{text-align:left}}
.announcement-banner{background:linear-gradient(90deg,rgba(245,158,11,.12),rgba(36,129,204,.12));border:1px solid rgba(245,158,11,.3);border-radius:12px;padding:10px 18px;margin-bottom:24px;display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap}
.banner-left{display:flex;align-items:center;gap:10px;font-size:13px;flex-wrap:wrap}
.banner-badge{background:#f59e0b;color:#120c02;font-weight:800;font-size:10px;padding:3px 7px;border-radius:6px;letter-spacing:.05em}
.code-pill{color:#f6c66d;font-family:monospace;background:rgba(0,0,0,.35);padding:2px 7px;border-radius:5px;border:1px dashed rgba(245,158,11,.5);letter-spacing:.04em}
.banner-right{display:flex;gap:10px;align-items:center}
.banner-vip{color:#f6c66d;font-weight:700;font-size:12px;text-decoration:none}
.banner-vip:hover{text-decoration:underline}
.banner-sep{color:var(--line)}
.banner-tg{color:#29b6f6;font-weight:700;font-size:12px;text-decoration:none}
.banner-tg:hover{text-decoration:underline}

/* Market Segment Selector & Synthetics Badging */
.market-segment-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:18px;background:#0b111a;padding:6px;border-radius:12px;border:1px solid var(--line)}
.segment-btn{display:inline-flex;align-items:center;gap:7px;background:transparent;border:1px solid transparent;color:var(--muted);font-size:13px;font-weight:600;padding:8px 14px;border-radius:9px;cursor:pointer;transition:all .15s ease}
.segment-btn:hover{color:var(--text);background:#131c2a}
.segment-btn.active{background:#182335;color:#fff;border-color:#3b82f6;box-shadow:0 2px 10px rgba(59,130,246,.15)}
.segment-btn[data-segment="synthetics"].active{border-color:#a855f7;color:#f3e8ff;box-shadow:0 2px 12px rgba(168,85,247,.25);background:linear-gradient(135deg,#1f1338,#161d2d)}
.seg-count{font-size:11px;opacity:.75;background:rgba(255,255,255,.08);padding:2px 6px;border-radius:6px}
.market-tag{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.04em;padding:2px 7px;border-radius:5px;margin-left:7px;vertical-align:middle}
.synth-tag{background:rgba(168,85,247,.18);border:1px solid rgba(168,85,247,.45);color:#d8b4fe!important}
.inst-tag{background:rgba(59,130,246,.15);border:1px solid rgba(59,130,246,.35);color:#93c5fd!important}
.synthetics-btn{display:inline-flex;align-items:center;gap:7px;background:linear-gradient(135deg,#7e22ce,#9333ea);color:#fff;text-decoration:none;font-weight:700;font-size:12px;padding:8px 14px;border-radius:10px;box-shadow:0 4px 14px rgba(147,51,234,.3);transition:transform .15s ease,box-shadow .15s ease}
.synthetics-btn:hover{transform:translateY(-1px);box-shadow:0 6px 18px rgba(147,51,234,.45);filter:brightness(1.08)}
.synthetics-banner{background:linear-gradient(135deg,rgba(88,28,135,.22),rgba(30,27,75,.45));border:1px solid rgba(168,85,247,.35);border-radius:14px;padding:18px 22px;margin-bottom:20px}
.synth-badge{display:inline-block;background:#9333ea;color:#fff;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;padding:3px 8px;border-radius:6px;margin-bottom:8px}
.synth-banner-content h3{margin:0 0 6px;font-size:16px;color:#f3e8ff}
.synth-banner-content p{margin:0 0 12px;color:#c084fc;font-size:13px;line-height:1.5}
.synth-tg-link{display:inline-flex;align-items:center;gap:8px;background:#7e22ce;color:#fff;text-decoration:none;font-weight:700;font-size:12px;padding:8px 16px;border-radius:8px;transition:all .15s ease}
.synth-tg-link:hover{background:#9333ea;transform:translateY(-1px)}
.synth-tg-link.free{background:rgba(147,51,234,0.2);border:1px solid rgba(168,85,247,0.5);color:#e9d5ff}
.synth-tg-link.free:hover{background:rgba(147,51,234,0.38);color:#fff}
.synth-free-btn{display:inline-flex;align-items:center;gap:7px;background:rgba(147,51,234,0.18);border:1px solid rgba(168,85,247,0.45);color:#d8b4fe;text-decoration:none;font-weight:700;font-size:12px;padding:8px 14px;border-radius:10px;box-shadow:0 2px 10px rgba(147,51,234,.15);transition:transform .15s ease,background .15s ease,border-color .15s ease}
.synth-free-btn:hover{background:rgba(147,51,234,0.32);border-color:#c084fc;color:#fff;transform:translateY(-1px);box-shadow:0 4px 14px rgba(147,51,234,.3)}

/* Side-by-side Segment Comparative Cards */
.segment-comparison-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;margin:18px 0 22px}
.segment-card{background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:16px;cursor:pointer;transition:all .18s ease;position:relative;user-select:none}
.segment-card:hover{transform:translateY(-2px);border-color:#54719c;box-shadow:0 4px 18px rgba(0,0,0,.35)}
.segment-card.active{border-color:#3b82f6;box-shadow:0 0 0 1px #3b82f6;background:#101724}
.segment-card.synth-card{border-color:rgba(168,85,247,.3)}
.segment-card.synth-card:hover{border-color:rgba(168,85,247,.6)}
.segment-card.synth-card.active{border-color:#a855f7;box-shadow:0 0 0 1px #a855f7;background:linear-gradient(135deg,#18102a,#0f1523)}
.seg-card-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;text-align:center;background:#0b111a;padding:12px 6px;border-radius:9px;border:1px solid rgba(255,255,255,.05);margin-top:12px}
.seg-card-stats span{font-size:10.5px;color:var(--muted);display:block;white-space:nowrap;letter-spacing:-0.02em}
.seg-card-stats strong{font-size:13.5px;display:block;margin-top:2px;white-space:nowrap}
@media(max-width:700px){.seg-card-stats{grid-template-columns:1fr 1fr}}
.seg-badge-pill{font-size:10px;font-weight:700;letter-spacing:.03em;padding:2px 7px;border-radius:5px;background:rgba(255,255,255,.07);color:var(--muted)}

/* Institutional Cohort Waitlist Card */
.waitlist-card{margin-top:24px;border:1px solid rgba(246,198,109,0.38)!important;background:radial-gradient(circle at 92% 12%,rgba(246,198,109,0.09) 0,transparent 45%),linear-gradient(145deg,#131b27,#0f151f)!important;position:relative;overflow:hidden}
.waitlist-header{display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:16px;margin-bottom:18px}
.waitlist-header h2{font-size:20px;letter-spacing:-.02em;margin:0 0 6px;color:#fff}
.waitlist-perks{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:20px}
.waitlist-perk{background:rgba(255,255,255,0.03);border:1px solid var(--line);border-radius:11px;padding:12px 14px}
.waitlist-perk-head{display:flex;align-items:center;gap:8px;margin-bottom:4px}
.waitlist-form-grid{display:grid;grid-template-columns:1.2fr 1fr 1fr auto;gap:10px;align-items:center}
.waitlist-submit-btn{padding:11px 22px;font-size:13px;font-weight:800;background:linear-gradient(135deg,#f59e0b,#eab308);color:#120c02;border:none;border-radius:10px;cursor:pointer;white-space:nowrap;box-shadow:0 4px 14px rgba(245,158,11,0.35);transition:transform .15s ease,box-shadow .15s ease}
.waitlist-submit-btn:hover{transform:translateY(-1px);box-shadow:0 6px 20px rgba(245,158,11,0.52);filter:brightness(1.08)}
.waitlist-submit-btn:disabled{opacity:.6;cursor:not-allowed;transform:none}
@media(max-width:850px){.waitlist-form-grid{grid-template-columns:1fr}.waitlist-submit-btn{width:100%}}

/* View Mode Switcher & Operator Terminal */
.mode-switcher{display:inline-flex;background:#0c121b;border:1px solid var(--line);border-radius:10px;padding:3px;gap:3px}
.mode-btn{background:transparent;border:none;color:var(--muted);font-size:12px;font-weight:600;padding:6px 12px;border-radius:7px;cursor:pointer;transition:all .15s ease}
.mode-btn.active{background:#1a2536;color:#fff;box-shadow:0 1px 4px rgba(0,0,0,.3)}
.mode-btn:hover{color:#fff}
.operator-status-bar{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px;background:#0c121b;border:1px solid var(--line);border-radius:12px;padding:12px 18px;margin-bottom:20px}
.operator-status-item{display:flex;align-items:center;gap:10px}
.operator-status-item span{color:var(--muted);font-size:11px;display:block;text-transform:uppercase;letter-spacing:.05em}
.operator-status-item strong{color:var(--text);font-size:12.5px;display:block;margin-top:2px}
.community-links-row{display:flex;align-items:center;gap:18px;flex-wrap:wrap;margin-top:14px;font-size:12px;color:var(--muted)}
.community-link{color:var(--muted);text-decoration:none;display:inline-flex;align-items:center;gap:5px;transition:color .15s ease}
.community-link:hover{color:#fff;text-decoration:underline}
.community-link strong{color:#e2e8f0}
body.operator-mode .marketing-only{display:none!important}
body:not(.operator-mode) .operator-only{display:none!important}

/* Amber Paper Execution Tag */
.pill.amber{color:#f6c66d;background:#241a0b;border:1px solid #78531a}
.empty-notice-pill{display:inline-block;margin-top:5px;font-size:10.5px;color:#f6c66d;background:rgba(246,198,109,0.1);border:1px dashed rgba(246,198,109,0.3);padding:2px 7px;border-radius:5px}

/* Lifecycle Stages Table & Confirmation Checklist */
.lifecycle-table-wrap{margin-top:18px;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:#0c121b}
.lifecycle-table{width:100%;border-collapse:collapse;font-size:12px;text-align:left}
.lifecycle-table th{background:#141c2b;border-bottom:1px solid var(--line);color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.05em;padding:9px 12px}
.lifecycle-table td{padding:9px 12px;border-bottom:1px solid rgba(255,255,255,.04);vertical-align:middle}
.lifecycle-table tr:last-child td{border-bottom:none}
.confirmation-checklist{margin-top:14px;display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:10px}
.checklist-item{background:rgba(255,255,255,.02);border:1px solid var(--line);border-radius:9px;padding:10px 12px;display:flex;align-items:flex-start;gap:8px}
.checklist-item span{color:var(--accent);font-size:13px;line-height:1.2}
.checklist-item strong{color:var(--text);font-size:12px;display:block}
.checklist-item small{color:var(--muted);font-size:11px;display:block;margin-top:2px}

.replay-bar{margin-top:14px;padding:12px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:#0c121b}.replay-controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.replay-step{margin-left:auto;color:var(--muted);font-size:12px;font-family:'JetBrains Mono',monospace}.replay-stages{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}.replay-stages span{padding:3px 9px;border-radius:999px;border:1px solid rgba(255,255,255,.1);color:var(--muted);font-size:11px;font-family:'JetBrains Mono',monospace}.replay-stages span.done{border-color:#153126;background:#153126;color:#8cf0c6}.replay-stages span.now{border-color:#78531a;background:#1c150b;color:#f6c66d}.replay-narration{margin:10px 0 0;color:#c7d0dd;font-size:13px}.risk-calc{margin-top:14px;padding:12px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:#0c121b}.risk-calc h3{margin:0 0 10px;font-size:14px}.risk-inputs{display:flex;gap:12px;flex-wrap:wrap}.risk-inputs label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--muted)}.risk-inputs input{width:150px;padding:7px 9px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:#0b111a;color:#e8edf4;font-family:'JetBrains Mono',monospace}.risk-outputs{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-top:10px}.risk-outputs div{padding:8px 10px;border-radius:10px;background:#0b111a;border:1px solid rgba(255,255,255,.06);font-size:12px;color:var(--muted)}.risk-outputs strong{display:block;color:#e8edf4;font-size:14px;font-family:'JetBrains Mono',monospace;margin-top:2px}
.live-tape{list-style:none;margin:12px 0 0;padding:0;display:flex;flex-direction:column;gap:6px;max-height:320px;overflow:auto}.live-row{display:grid;grid-template-columns:86px 74px 92px 1fr;gap:10px;align-items:center;padding:8px 10px;border:1px solid rgba(255,255,255,.07);border-radius:10px;background:#0b111a;font-size:12px;color:var(--muted)}.live-time{font-family:'JetBrains Mono',monospace;color:#8793a7}.live-state{font-family:'JetBrains Mono',monospace;font-weight:700}.live-retest .live-state{color:#8cf0c6}.live-shift .live-state{color:#b093ff}.live-sweep .live-state{color:#38bdf8}.live-touch .live-state{color:#f6c66d}.live-map .live-state{color:#8793a7}.live-pair{color:#e8edf4;font-weight:600}.live-reason{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.live-empty{color:#8793a7;font-size:12px;padding:8px 4px;list-style:none}.live-flash{animation:liveflash .9s ease}@keyframes liveflash{0%{box-shadow:0 0 0 0 rgba(140,240,198,.45)}100%{box-shadow:0 0 0 14px rgba(140,240,198,0)}}


/* Plain-English Monte Carlo stress-test controls, explainer, and result cards */
.mc-explainer{margin:0 0 18px;border:1px solid rgba(255,255,255,.09);border-radius:12px;background:#0c121b;overflow:hidden}
.mc-explainer summary{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 15px;color:#d5deea;font-size:13px;font-weight:700;cursor:pointer;list-style:none}
.mc-explainer summary::-webkit-details-marker{display:none}
.mc-explainer summary::after{content:"+";display:grid;place-items:center;width:22px;height:22px;flex:0 0 22px;border:1px solid rgba(140,240,198,.28);border-radius:50%;color:var(--accent);font-size:16px;line-height:1}
.mc-explainer[open] summary::after{content:"−"}
.mc-explainer summary:focus-visible{outline:2px solid var(--accent);outline-offset:-3px;border-radius:10px}
.mc-explainer-content{padding:12px 15px 14px;border-top:1px solid rgba(255,255,255,.07);color:var(--muted);font-size:12px;line-height:1.6}
.mc-explainer-content p{margin:0!important;color:inherit}
.mc-explainer-content ul{margin:8px 0;padding-left:19px}
.mc-explainer-content li{margin:5px 0}
.mc-explainer-content strong{color:#d5deea}
.mc-explainer-caveat{padding-top:8px;border-top:1px solid rgba(255,255,255,.06)}
.mc-controls{align-items:flex-end}
.mc-input{flex:1 1 155px;min-width:135px}
.mc-input>span{color:#e0e7ef;font-weight:650}
.mc-input input{width:100%;max-width:190px}
.mc-input small{max-width:210px;color:#8793a7;font-size:11px;line-height:1.4}
.mc-controls button{align-self:flex-end;white-space:nowrap}
.mc-status{min-height:18px}
.mc-cards{grid-template-columns:repeat(auto-fit,minmax(185px,1fr));gap:10px}
.mc-cards .mc-card{min-height:118px;padding:12px 13px}
.mc-card-label{display:block;color:#bac6d5;font-size:12px;font-weight:700;line-height:1.35}
.mc-cards .mc-card strong.mc-card-value{display:block;margin-top:7px;color:#eef3fb;font-size:21px;font-family:'JetBrains Mono',monospace;line-height:1.15;letter-spacing:-.03em}
.mc-card-note{display:block;margin-top:7px;color:#8793a7;font-size:11px;line-height:1.4}
.mc-chart-legend{display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:10px;color:#94a3b8;font-size:11px}
.mc-chart-legend span{display:inline-flex;align-items:center;gap:7px}
.mc-chart-legend i{display:inline-block;width:17px;height:8px;border-radius:2px}
.mc-legend-typical{height:2px!important;background:#8cf0c6}
.mc-legend-range{background:rgba(56,189,248,.25);border:1px solid rgba(56,189,248,.45)}
@media(max-width:600px){.mc-input{flex-basis:calc(50% - 8px)}.mc-controls button{width:100%}.mc-cards{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:420px){.mc-input{flex-basis:100%}.mc-cards{grid-template-columns:1fr}}

/* Engine Pulse (24h read-only scan-diagnostics aggregate) */
.engine-pulse .engine-pulse-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:14px}
.engine-pulse-stat{border:1px solid var(--line);background:#0e151f;border-radius:13px;padding:13px 14px}
.engine-pulse-stat span{display:block;color:var(--muted);font-size:11px;letter-spacing:.04em;text-transform:uppercase}
.engine-pulse-stat strong{display:block;margin-top:6px;font-size:24px;letter-spacing:-.04em;color:#f1f5f9;font-family:'JetBrains Mono',monospace}
.engine-pulse-stat:nth-child(6) strong{color:var(--accent)}
@media(max-width:800px){.engine-pulse .engine-pulse-grid{grid-template-columns:repeat(2,1fr)}}

/* Keep the brand mark fixed-size and the header readable on narrow screens. */
.brand{min-width:0}.brand-mark{flex:0 0 38px}.brand-copy{min-width:0}.brand strong{display:block;line-height:1.1}
@media(max-width:800px){
  .topbar{height:auto;min-height:72px;flex-wrap:wrap;gap:10px 16px;padding:12px 16px}
  .brand{flex:0 1 auto;width:fit-content;max-width:100%;gap:10px}
  .brand-mark{flex-basis:40px;width:40px;height:40px}
  .brand-copy{flex:1 1 auto}
  .brand small{font-size:9px;line-height:1.2;letter-spacing:.09em;white-space:nowrap}
  .header-actions{width:100%;min-width:0;flex:1 1 100%;flex-wrap:wrap;justify-content:flex-start;gap:8px}
  .mode-switcher-wrap{width:100%;min-width:0;flex:1 1 100%;flex-wrap:wrap;gap:8px}
  .mode-switcher{width:100%;flex:1 1 auto;display:flex}
  .mode-btn{flex:1 1 0;min-width:0;min-height:44px;justify-content:center;padding:7px 8px;font-size:11px;white-space:nowrap}
  #activeModeLabel{display:none}
  .header-actions .status{margin-left:0;white-space:nowrap}
  .header-actions>.vip-btn{margin-left:auto;min-height:44px;padding:10px 12px}
  .header-actions .mode-btn:focus-visible,.header-actions>.vip-btn:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
}
@media(max-width:400px){
  .topbar{padding-inline:14px}
  .brand{font-size:18px;gap:10px}
  .brand-mark{flex-basis:38px;width:38px;height:38px}
  .brand small{font-size:8px;letter-spacing:.08em}
  .mode-btn{padding:6px 5px;font-size:10px}
}

.brand:focus-visible{outline:2px solid var(--accent);outline-offset:4px}
.brand:active{transform:scale(.97)}
@media(hover:hover) and (pointer:fine){.brand:hover{border-color:rgba(140,240,198,.58);box-shadow:0 10px 30px rgba(0,0,0,.28),0 0 18px rgba(140,240,198,.08)}}
@media(prefers-reduced-motion:reduce){.brand{transition:none}.brand:active{transform:none}}
</style>
  <style>${DASHBOARD_THEME_CSS}</style>
</head>
<body>
  <div class="app-shell">
    <header class="topbar">
      <a class="brand" href="/" aria-label="DEO Edge home" title="Go to dashboard home">
        <img class="brand-mark" src="${DEO_EDGE_LOGO_DATA_URI}" alt="" aria-hidden="true" width="28" height="28">
        <span class="brand-copy"><strong>DEO</strong><small>DEO Edge</small><span class="sr-only"><strong>DEO Edge</strong></span></span>
      </a>
      <div class="product-line">Structure <span>·</span> Liquidity <span>·</span> Key Levels</div>
      <div class="topbar-actions">
        <div class="mode-switch" role="group" aria-label="Product mode">
          <button id="modePublicBtn" class="mode-button is-active" data-view-mode="public" type="button" aria-pressed="true">Public Overview</button>
          <button id="modeOperatorBtn" class="mode-button" data-view-mode="operator" type="button" aria-pressed="false">Operator Terminal</button>
        </div>
        <span id="activeModeLabel" class="sr-only" aria-live="polite">Viewing: Public Overview</span>
        <a class="text-link" href="#vip">VIP Access <span aria-hidden="true">↗</span></a>
      </div>
    </header>

    <a class="skip-link" href="#mainContent">Skip to dashboard content</a>
    <main id="mainContent" class="dashboard-main" tabindex="-1">
      <span id="top" class="sr-only" aria-hidden="true"></span>
      <section class="status-rail" aria-label="System status">
        <div class="status-item"><span id="statusDot" class="status-dot checking" aria-hidden="true"></span><span><b id="statusText" aria-live="polite">Checking worker status…</b><small>Paper pipeline</small></span></div>
        <div class="status-item"><span class="status-icon" aria-hidden="true">⌁</span><span><b id="workerVersionLabel">Engine v2.5.3</b><small id="headerWorkerState">Cloud worker · status pending</small></span></div>
        <div class="status-item"><span class="status-icon" aria-hidden="true">◌</span><span><b>Configured feeds</b><small id="opFeeds">Awaiting Worker health response</small></span></div>
        <div class="status-item warning"><span class="status-icon" aria-hidden="true">◷</span><span><b>Last checked</b><small id="headerLastChecked">Waiting for health response</small></span></div>
        <div class="safety-lock"><span aria-hidden="true">▣</span> PAPER SIMULATION · NO LIVE ORDERS</div>
      </section>

      <div class="operator-status-bar operator-only" id="operatorStatusBar" aria-label="Private operator status">
        <div class="operator-status-item"><span class="status-dot checking" aria-hidden="true"></span><div><span>Worker Engine</span><strong id="opWorkerHealth">Checking health</strong></div></div>
        <div class="operator-status-item"><span aria-hidden="true">⌁</span><div><span>Market Feeds</span><strong id="opFeedSummary">Configured data sources · see health details</strong></div></div>
        <div class="operator-status-item"><span aria-hidden="true">◷</span><div><span>Scan Freshness</span><strong id="opLastScan">Waiting for the latest health check</strong></div></div>
        <div class="operator-status-item"><span aria-hidden="true">▣</span><div><span>Execution Safety</span><strong>PAPER SIMULATION · NO LIVE ORDERS</strong></div></div>
      </div>

      <section class="hero section-grid" aria-labelledby="hero-title">
        <div class="hero-copy">
          <p class="eyebrow"><span class="eyebrow-rule"></span> Quantitative research &amp; confirmation engine</p>
          <h1 id="hero-title">Make the close<br><em>earn its place.</em></h1>
          <p class="hero-text">Point-in-time paper outcomes from key-level liquidity sweeps, structure shifts, and confirmation entries across supported markets.</p>
          <div class="hero-actions marketing-only">
            <a class="button button-primary" href="https://whop.com/deoedge/deo-edge-vip-signals/" target="_blank" rel="noopener noreferrer">Join VIP Signals <span aria-hidden="true">↗</span></a>
            <button class="button button-quiet" id="heroLedgerBtn" type="button">Audit Trade Ledger <span aria-hidden="true">↓</span></button>
          </div>
          <p class="disclaimer"><span class="inline-alert">!</span> Research and education only; the production scanner sends paper/research signal alerts for these symbols but places no orders. Historical or simulated outcomes do not guarantee future results.</p>
          <p class="research-caveat">Deriv coverage includes all 10 supported Volatility Indices for paper/research alerts only; the required 360-day Deriv CFD replay remains unvalidated.</p>
          <div class="community-links-row marketing-only">
            <span>Free Telegram hubs:</span>
            <a href="https://t.me/DEOEDGE" target="_blank" rel="noopener noreferrer" class="community-link">DEO EDGE (FREE)</a><span aria-hidden="true">·</span>
            <a href="https://t.me/DEO_EDGE_synthetics_free" target="_blank" rel="noopener noreferrer" class="community-link">DEO EDGE | FREE SYNTHETICS</a>
          </div>
        </div>
        <div class="hero-pulse" role="img" aria-label="Illustrative engine-process graphic; not a performance chart or live metric">
          <div class="pulse-header"><span>ENGINE PULSE</span><span class="pulse-live"><i></i> READ-ONLY</span></div>
          <div class="pulse-graph" aria-hidden="true">
            <div class="graph-grid"></div>
            <svg viewBox="0 0 540 240" preserveAspectRatio="none">
              <defs><linearGradient id="pulseFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#62e6ff" stop-opacity=".26"/><stop offset="1" stop-color="#62e6ff" stop-opacity="0"/></linearGradient></defs>
              <path class="fill" d="M0 208 C42 208 42 184 78 184 S115 216 148 168 S188 126 216 144 S255 170 282 112 S310 104 334 122 S355 78 382 92 S416 122 440 68 S466 72 486 44 S516 26 540 36 V240 H0 Z"/>
              <path class="line" d="M0 208 C42 208 42 184 78 184 S115 216 148 168 S188 126 216 144 S255 170 282 112 S310 104 334 122 S355 78 382 92 S416 122 440 68 S466 72 486 44 S516 26 540 36"/>
              <circle cx="440" cy="68" r="4"/><circle class="glow-dot" cx="440" cy="68" r="10"/>
            </svg>
            <div class="graph-labels"><span>MAP</span><span>TOUCH</span><span>SWEEP</span><span>SHIFT</span><span>RETEST</span></div>
          </div>
          <div class="pulse-footer"><span>Process graphic · not performance data</span><strong>24h diagnostics below</strong></div>
        </div>
      </section>

      <nav class="section-tabs" role="tablist" aria-label="Dashboard sections">
        <button class="section-tab tab is-active active" id="tabOverview" role="tab" data-tab="overview" aria-controls="overview" aria-selected="true" tabindex="0" type="button">Overview</button>
        <button class="section-tab tab" id="tabPerformance" role="tab" data-tab="performance" aria-controls="performance" aria-selected="false" tabindex="-1" type="button">Performance</button>
        <button class="section-tab tab" id="tabAlerts" role="tab" data-tab="alerts" aria-controls="alerts" aria-selected="false" tabindex="-1" type="button">Trade Journal <span class="tab-count" id="alertTabCount">—</span></button>
        <button class="section-tab tab" id="tabHealth" role="tab" data-tab="health" aria-controls="health" aria-selected="false" tabindex="-1" type="button">Market Health</button>
        <button class="section-tab tab" id="tabPreferences" role="tab" data-tab="preferences" aria-controls="preferences" aria-selected="false" tabindex="-1" type="button">Channel</button>
      </nav>

      <section class="overview section-grid tab-panel is-visible active" id="overview" data-panel="overview" role="tabpanel" aria-labelledby="tabOverview" tabindex="0">
        <div class="section-heading"><div><p class="eyebrow">01 / Overview</p><h2 id="overview-heading">A ledger built for <em>proof.</em></h2></div><div class="section-note"><span id="overviewStatusDot" class="status-dot checking" aria-hidden="true"></span> Read-only · paper signals only</div></div>
        <div class="segment-switch" role="group" aria-label="Market segment">
          <button class="segment-button segment-btn is-active active" data-segment="all" type="button" aria-pressed="true"><span aria-hidden="true">◎</span> All Markets <b>24</b></button>
          <button class="segment-button segment-btn" data-segment="institutional" type="button" aria-pressed="false"><span aria-hidden="true">◈</span> Institutional <b>14</b></button>
          <button class="segment-button segment-btn" data-segment="synthetics" type="button" aria-pressed="false"><span aria-hidden="true">ϟ</span> Deriv Watchlist <b>10</b></button>
        </div>
        <div class="metric-grid">
          <article class="metric-card featured"><div class="metric-top"><span>Paper net return</span><span class="metric-tag" id="overviewNetRSegmentBadge">ALL</span></div><strong id="overviewNetR">—</strong><small>cumulative R · recorded outcomes only</small></article>
          <article class="metric-card"><div class="metric-top"><span>Win rate</span><span class="metric-symbol">%</span></div><strong id="winRate">—</strong><small>TP ÷ (TP + SL)</small></article>
          <article class="metric-card"><div class="metric-top"><span>Active / open</span><span class="metric-symbol">◉</span></div><strong id="open">—</strong><small>simulated trades in market</small></article>
          <article class="metric-card"><div class="metric-top"><span>Total signals</span><span class="metric-symbol">⌁</span></div><strong id="total">—</strong><small>confirmed setups recorded</small></article>
        </div>
        <div class="segment-detail-grid">
          <article class="segment-card" id="segCardInstOverview" data-target-segment="institutional" role="button" tabindex="0" aria-pressed="false" aria-label="Filter to institutional markets">
            <div class="segment-title"><span class="segment-icon blue" aria-hidden="true">◈</span><div><h3>Institutional FX &amp; Indices</h3><p>14 assets · Asian, London &amp; NY sessions</p></div><span class="card-arrow" aria-hidden="true">↗</span></div>
            <div class="segment-kpis"><span><b id="segInstSignalsOverview">—</b><small>signals</small></span><span><b id="segInstWinRateOverview">—</b><small>win rate</small></span><span><b id="segInstNetROverview">—</b><small>net return</small></span><span><b id="segInstOutcomesOverview">—</b><small>TP / SL</small></span></div>
          </article>
          <article class="segment-card deriv-card" id="segCardSynthOverview" data-target-segment="synthetics" role="button" tabindex="0" aria-pressed="false" aria-label="Filter to the Deriv watchlist">
            <div class="segment-title"><span class="segment-icon violet" aria-hidden="true">ϟ</span><div><h3>Deriv Synthetic Watchlist</h3><p>10 volatility indices · 24/7 · alert-only</p></div><span class="card-arrow" aria-hidden="true">↗</span></div>
            <div class="segment-kpis"><span><b id="segSynthSignalsOverview">—</b><small>signals</small></span><span><b id="segSynthWinRateOverview">—</b><small>win rate</small></span><span><b id="segSynthNetROverview">—</b><small>net return</small></span><span><b id="segSynthOutcomesOverview">—</b><small>TP / SL</small></span></div>
          </article>
        </div>
        <p class="chart-disclaimer">Reported outcomes are from the connected paper/research ledger. A blank or unavailable value is not a zero and is not a forecast.</p>
      </section>

      <article class="panel engine-pulse section-grid" id="enginePulse">
        <div class="panel-head">
          <div>
            <p class="eyebrow">LIVE ENGINE ACTIVITY · LAST 24H</p>
            <h2>Engine Pulse</h2>
          </div>
          <span class="pill green">Read-only</span>
        </div>
        <p class="muted-copy" id="enginePulseSummary">Loading 24-hour engine activity…</p>
        <div class="engine-pulse-grid" id="enginePulseGrid">
          <div class="engine-pulse-stat"><span>MAP event rows</span><strong id="epEvaluated">—</strong></div>
          <div class="engine-pulse-stat"><span>TOUCH event rows</span><strong id="epTouch">—</strong></div>
          <div class="engine-pulse-stat"><span>SWEEP event rows</span><strong id="epSweep">—</strong></div>
          <div class="engine-pulse-stat"><span>SHIFT event rows</span><strong id="epShift">—</strong></div>
          <div class="engine-pulse-stat"><span>RETEST event rows</span><strong id="epRetest">—</strong></div>
          <div class="engine-pulse-stat"><span>Alert rows inserted</span><strong id="epConfirmed">—</strong></div>
          <div class="engine-pulse-stat"><span>Scans run</span><strong id="epScans">—</strong></div>
          <div class="engine-pulse-stat"><span>Pairs covered</span><strong id="epPairs">—</strong></div>
        </div>
        <p class="muted-copy" id="enginePulseRejections" style="margin:10px 0 0;"></p>
        <p class="muted-copy" id="enginePulseFunnel" style="margin:10px 0 0;"></p>
        <p class="muted-copy" id="enginePulseTiming" style="margin:10px 0 0;"></p>
        <p class="chart-disclaimer">Read-only aggregate of recorded scan diagnostics — no orders, no predictions. Paper simulation — research only.</p>
      </article>

      <section class="lifecycle section-grid" aria-labelledby="lifecycle-heading">
        <div class="section-heading"><div><p class="eyebrow">02 / DEO EDGE CONFIRMATION METHOD</p><h2 id="lifecycle-heading">Seven stages. <em>No shortcuts.</em></h2></div><div class="section-note">Deterministic rules · bar-close finality</div></div>
        <div class="lifecycle-card">
          <div class="lifecycle-rail" role="group" aria-label="Confirmation method stages">
            <div class="rail-line" aria-hidden="true"></div>
            <button class="stage is-active" data-stage-index="0" type="button" aria-pressed="true" aria-controls="lifecycleDetail"><span class="stage-node">01</span><b>MAP</b><small>HTF bias</small></button>
            <button class="stage" data-stage-index="1" type="button" aria-pressed="false" aria-controls="lifecycleDetail"><span class="stage-node">02</span><b>TOUCH</b><small>Origin zone</small></button>
            <button class="stage" data-stage-index="2" type="button" aria-pressed="false" aria-controls="lifecycleDetail"><span class="stage-node">03</span><b>SWEEP</b><small>Liquidity run</small></button>
            <button class="stage" data-stage-index="3" type="button" aria-pressed="false" aria-controls="lifecycleDetail"><span class="stage-node">04</span><b>SHIFT</b><small>BOS</small></button>
            <button class="stage" data-stage-index="4" type="button" aria-pressed="false" aria-controls="lifecycleDetail"><span class="stage-node">05</span><b>RETEST</b><small>FVG rebalance</small></button>
            <button class="stage" data-stage-index="5" type="button" aria-pressed="false" aria-controls="lifecycleDetail"><span class="stage-node">06</span><b>ENTRY</b><small>Close locked</small></button>
            <button class="stage" data-stage-index="6" type="button" aria-pressed="false" aria-controls="lifecycleDetail"><span class="stage-node">07</span><b>OUTCOME</b><small>Resolved</small></button>
          </div>
          <div class="lifecycle-detail" id="lifecycleDetail" aria-live="polite">
            <p class="eyebrow" id="lifecycleStageLabel">Selected stage / MAP</p><h3 id="lifecycleStageTitle">HTF Directional Vantage Point</h3>
            <p id="lifecycleStageCopy">Weekly and daily opposing liquidity draw established. A 4H structural A/V-level is armed before the lower-timeframe radar begins.</p>
            <div class="rule-line"><span>Verification</span><strong id="lifecycleStageRule">4H structure + 1H execution context must align directionally.</strong></div>
            <div class="detail-actions"><button id="showRulesBtn" class="button button-small" type="button" aria-expanded="false" aria-controls="ruleReference">View deterministic rules <span aria-hidden="true">→</span></button><span class="sim-tag">RESEARCH RULES</span></div>
          </div>
          <details class="rule-reference" id="ruleReference"><summary>Full verification table and safeguards</summary><p class="research-caveat">This is the stated method description. The UI does not claim each stage was reached for a given market unless the live diagnostics show it.</p><div class="lifecycle-table-wrap">
            <table class="lifecycle-table">
              <thead>
                <tr>
                  <th>Stage</th>
                  <th>Market Mechanism</th>
                  <th>Deterministic Verification Rule</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong style="color: #38bdf8;">MAP</strong></td>
                  <td>HTF Bias & Origin Level</td>
                  <td>Weekly/Daily opposing liquidity draw established; 4H structural A/V-level armed.</td>
                </tr>
                <tr>
                  <td><strong style="color: #38bdf8;">TOUCH</strong></td>
                  <td>Origin Zone Mitigation</td>
                  <td>Price reaches and mitigates origin key level, activating lower-timeframe radar.</td>
                </tr>
                <tr>
                  <td><strong style="color: #f6c66d;">SWEEP</strong></td>
                  <td>Liquidity Pool Run</td>
                  <td>False breakout purges internal liquidity pool beyond swing high/low extreme.</td>
                </tr>
                <tr>
                  <td><strong style="color: #f6c66d;">SHIFT</strong></td>
                  <td>Market Structure Break (BOS)</td>
                  <td>Aggressive displacement breaks pullback structure with candle close; forms Fair Value Gap.</td>
                </tr>
                <tr>
                  <td><strong style="color: #f6c66d;">RETEST</strong></td>
                  <td>Inefficiency Rebalance</td>
                  <td>Controlled retracement into Fair Value Gap (FVG); candidate entry prepares.</td>
                </tr>
                <tr>
                  <td><strong style="color: #8cf0c6;">CONFIRMED</strong></td>
                  <td>Execution Candle Close</td>
                  <td>Finalized candle close locks entry price, stop-loss floor, and minimum 2.5R target. Zero repainting.</td>
                </tr>
                <tr>
                  <td><strong style="color: #a855f7;">OUTCOME</strong></td>
                  <td>Deterministic Resolution</td>
                  <td>Point-in-time resolution: Target 1 (+3.0R), Stop Loss (-1.0R), or 120-Bar Stale Expiration.</td>
                </tr>
              </tbody>
            </table>
          </div><div class="confirmation-checklist">
            <div class="checklist-item">
              <span>✓</span>
              <div>
                <strong>HTF Directional Vantage Point</strong>
                <small>4H structural direction and 1H execution context must align directionally.</small>
              </div>
            </div>
            <div class="checklist-item">
              <span>✓</span>
              <div>
                <strong>Candle-Close Invalidation Floor</strong>
                <small>Stop-loss triggers strictly on candle close beyond extreme to avoid wick-traps.</small>
              </div>
            </div>
            <div class="checklist-item">
              <span>✓</span>
              <div>
                <strong>Strict Minimum 2.5R Target Floor</strong>
                <small>Setups below 2.5R to primary opposing liquidity draw are rejected automatically.</small>
              </div>
            </div>
            <div class="checklist-item">
              <span>✓</span>
              <div>
                <strong>Zero Retrospective Repainting</strong>
                <small>Alert timestamp, entry price, and R-multiples freeze permanently on bar close.</small>
              </div>
            </div>
          </div></details>
        </div>
      </section>



      <section class="provenance section-grid" aria-labelledby="provenance-heading">
        <div class="provenance-copy"><p class="eyebrow">03 / Data provenance</p><h2 id="provenance-heading">Know what the<br><em>engine knows.</em></h2><p>Recorded events are timestamped at bar close. Confirmed entry details are frozen for review; no retrospective repainting and no live execution. The research record is not a prediction or a guarantee.</p><a class="text-link" href="#alerts">Inspect the signal ledger <span aria-hidden="true">↗</span></a></div>
        <div class="provenance-panel">
          <div class="panel-head"><span>SCANNER UNIVERSE</span><span id="healthPill" class="panel-status"><i></i> CHECKING</span></div>
          <div class="universe-row"><div><strong>24</strong><span>tracked markets</span></div><div><strong>Live Scanner (<span id="activePairCount">15</span>)</strong><span>pairs covered now</span></div><div><strong>09</strong><span>not scanned now</span></div></div>
          <div class="scanner-list" id="pairs">JAPAN225 · NAS100 · EURUSD · XAUUSD · NETHERLANDS25 · V75 · V100 · V50 · V25 · V10 · V75_1S · V100_1S · V50_1S · V25_1S · V10_1S</div>
          <div class="universe-row additional-universe"><div><strong>Other institutional pairs — not scanned now (9)</strong><span>GBPUSD · USDJPY · AUDJPY · GBPJPY · US30 · GER40 · USDCAD · NZDUSD · EURJPY</span></div></div>
          <div class="panel-foot"><span>Cloud engine · <strong id="workerName">Checking…</strong> · <span id="mode">PAPER SIMULATION · NO LIVE ORDERS</span></span><span>Last checked <time id="lastResponse">—</time></span></div>
          <p class="research-caveat">Institutional pairs are the research universe. The current scanner watchlist shown above is separate; Deriv alerts are paper/research only.</p>
        </div>
      </section>

      <section id="performance" class="performance section-grid tab-panel" role="tabpanel" aria-labelledby="tabPerformance" tabindex="0" hidden data-panel="performance">
      <!-- Market Segment Selector -->
      <div class="market-segment-bar">
        <button type="button" class="segment-btn active" data-segment="all" aria-pressed="true">
          <span>🌍</span> All Markets <span class="seg-count">24</span>
        </button>
        <button type="button" class="segment-btn" data-segment="institutional" aria-pressed="false">
          <span>🏛️</span> Institutional FX & Indices <span class="seg-count">14</span>
        </button>
        <button type="button" class="segment-btn" data-segment="synthetics" aria-pressed="false">
          <span>⚡</span> Deriv Watchlist <span class="seg-count">10</span>
        </button>
      </div>

      <!-- Synthetics Info Banner (Active when Synthetics is selected) -->
      <div id="syntheticsNotice" class="synthetics-banner" hidden>
        <div class="synth-banner-content">
          <span class="synth-badge">⚡ Deriv · 24/7 Watchlist</span>
          <h3>Deriv Synthetic Watchlist (10 Volatility Assets)</h3>
          <p>The Deriv scanner covers the supported Volatility Indices (V75, V100, V50, V25, V10 and the 1s series) for 24/7 paper/research signal alerts. No orders are placed, and the required 360-day Deriv CFD replay remains unvalidated.</p>
          <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:14px;">
            <a href="https://whop.com/deoedge/deo-edge-vip-signals/" target="_blank" rel="noopener noreferrer" class="synth-tg-link">
              <span>👉 Deriv Synthetics VIP Signals (Instant Access)</span>
            </a>
            <a href="https://t.me/DEO_EDGE_synthetics_free" target="_blank" rel="noopener noreferrer" class="synth-tg-link free">
              <span>💬 Join DEO EDGE | FREE SYNTHETICS</span>
            </a>
          </div>
        </div>
      </div>

      <div class="panel-head" style="align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 14px;">
        <div>
          <p class="eyebrow">PORTFOLIO TRACK RECORD</p>
          <h2 style="margin:0;">Rule-Checked Strategy Performance (Paper Simulation)</h2>
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

      <!-- Market Segment Comparative Performance -->
      <div class="segment-comparison-grid">
        <div class="segment-card" id="segCardInst" data-target-segment="institutional" role="button" tabindex="0" aria-pressed="false" title="Click to filter by Institutional FX & Indices">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:18px;">🏛️</span>
              <div>
                <strong style="color:var(--text); font-size:14px; display:block;">Institutional FX & Indices</strong>
                <small style="color:var(--muted); font-size:11px;">14 Assets · Asian, London & NY Sessions</small>
              </div>
            </div>
            <span class="pill" style="font-size:11px;">14 Markets</span>
          </div>
          <div class="seg-card-stats">
            <div><span>Win Rate</span><strong id="segInstWinRate" class="profit-text">—</strong></div>
            <div><span>Net Return</span><strong id="segInstNetR" class="accent-text">—</strong></div>
            <div><span>TP / SL</span><strong id="segInstOutcomes" style="color:var(--text);">—</strong></div>
            <div><span>Signals</span><strong id="segInstSignals" style="color:var(--text);">—</strong></div>
          </div>
        </div>

        <div class="segment-card synth-card" id="segCardSynth" data-target-segment="synthetics" role="button" tabindex="0" aria-pressed="false" title="Click to filter by the Deriv synthetic watchlist">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:18px;">⚡</span>
              <div>
                <strong style="color:#f3e8ff; font-size:14px; display:block;">Deriv Synthetic Watchlist</strong>
                <small style="color:var(--muted); font-size:11px;">10 Volatility Indices · 24/7 · Alert-only · No orders</small>
              </div>
            </div>
            <span class="pill" style="font-size:11px; background:rgba(168,85,247,0.2); color:#d8b4fe; border:1px solid rgba(168,85,247,0.4);">24/7 Feed</span>
          </div>
          <div class="seg-card-stats">
            <div><span>Win Rate</span><strong id="segSynthWinRate" style="color:#a855f7;">—</strong></div>
            <div><span>Net Return</span><strong id="segSynthNetR" class="accent-text">—</strong></div>
            <div><span>TP / SL</span><strong id="segSynthOutcomes" style="color:var(--text);">—</strong></div>
            <div><span>Signals</span><strong id="segSynthSignals" style="color:var(--text);">—</strong></div>
          </div>
        </div>
      </div>

      <div class="metric-grid">
        <article class="metric"><span>Net Return</span><strong id="netR" class="accent-text">—</strong><small>cumulative R (<span id="perfPeriodLabel">All Time</span>)</small></article>
        <article class="metric"><span>Win Rate</span><strong id="perfWinRate" class="profit-text">—</strong><small>TP / (TP + SL)</small></article>
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
        <p>All statistics are derived from automated Cloudflare D1 database trade records executing DEO Edge confirmation rules (Structure, Liquidity, Key Levels) on live broker market data. Not financial advice. See <a href="terms.html" style="color:var(--accent); text-decoration: underline;">Terms & Risk Disclaimer</a>.</p>
      </article>
    </section>
      <section id="alerts" class="ledger section-grid tab-panel" role="tabpanel" aria-labelledby="tabAlerts" tabindex="0" hidden data-panel="alerts">
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
        <select id="alertLifecycle" aria-label="Lifecycle"><option value="">All states</option><option value="OPEN">Open (Active)</option><option value="TP_HIT">TP Hit</option><option value="BE_HIT">Breakeven</option><option value="SL_HIT">SL Hit</option><option value="EXPIRED">Expired</option></select>
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
        <button id="exportCsv" class="secondary" title="Download verified ledger as CSV">⬇ CSV</button>
        <button id="exportJson" class="secondary" title="Download verified ledger as JSON">⬇ JSON</button>
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
      <section id="health" class="health section-grid tab-panel" role="tabpanel" aria-labelledby="tabHealth" tabindex="0" hidden data-panel="health">
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
      <article class="panel operator-only" style="margin-top:18px;">
        <div class="panel-head">
          <div>
            <p class="eyebrow">PRIVATE · OWNER KEY REQUIRED</p>
            <h2>21-Day Scan & Delivery Audit</h2>
            <p class="muted-copy">Run a read-only report of daily scan counts, stored alert statuses, replay filters, freshness/deduplication skips, and delivery API results. Your admin key stays in this browser.</p>
          </div>
          <button id="runScanAuditBtn" class="secondary">Run 21-Day Audit</button>
        </div>
        <pre id="scanAuditResults" class="muted-copy" aria-live="polite" style="white-space:pre-wrap; overflow-wrap:anywhere; margin:10px 0 0;">The report is private and loads only after the owner key is entered.</pre>
      </article>
    </section>
      <section id="preferences" class="channel section-grid tab-panel" role="tabpanel" aria-labelledby="tabPreferences" tabindex="0" hidden data-panel="preferences">
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
              <p>Posts the full DEO Edge confirmed entry, stop-loss, 3R target, bias grade, and path to your channel.</p>
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

      <section class="vip section-grid" id="vip" aria-labelledby="vip-heading">
        <div class="section-heading"><div><p class="eyebrow">04 / VIP access</p><h2 id="vip-heading">A cleaner feed<br>for <em>the close.</em></h2></div><div class="section-note">Optional channel · no execution</div></div>
        <p class="vip-intro">Priority access to confirmed-entry alerts, market briefs, and the research channel. Review current terms on the official VIP page.</p>
        <article class="panel waitlist-card marketing-only" id="waitlistCard">
        <div class="waitlist-header">
          <div>
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap;">
              <span class="pill" style="background: rgba(245, 158, 11, 0.2); color: #f6c66d; border: 1px solid rgba(245, 158, 11, 0.4); font-weight: 700;">🔒 COHORT WAITLIST · STRICT DESK CAPACITY</span>
              <span class="pill" style="background: rgba(140, 240, 198, 0.15); color: var(--accent); border: 1px solid rgba(140, 240, 198, 0.3);">Priority access</span>
            </div>
            <h2>Reserve Priority Access for Cohort Drop</h2>
            <p style="color: var(--muted); font-size: 13.5px; max-width: 680px; margin: 0; line-height: 1.5;">
              To protect market liquidity execution, eliminate slippage, and maintain direct trader onboarding, VIP desk seats are released in strictly capped cohorts of 25 desks. Lock your priority position 2 hours before the public drop.
            </p>
          </div>
          <div style="text-align: right; min-width: 160px;">
            <span style="font-size: 11px; color: var(--muted); display: block; text-transform: uppercase; letter-spacing: 0.06em;">Cohort status</span>
            <strong style="color: var(--cyan); font-size: 13px; display: block; margin: 5px 0;">Priority list</strong>
            <small style="color: #8793a7; font-size: 11px;">Current terms are shown on the official VIP page.</small>
          </div>
        </div>

        <div class="waitlist-perks">
          <div class="waitlist-perk">
            <div class="waitlist-perk-head">
              <span style="font-size: 16px;">⚡</span>
              <strong style="font-size: 13px; color: var(--text);">2-Hour Early Access</strong>
            </div>
            <p style="font-size: 12px; color: var(--muted); margin: 0;">Direct checkout link dispatched to your inbox 2 hours before the next public drop.</p>
          </div>
          <div class="waitlist-perk">
            <div class="waitlist-perk-head">
              <span style="font-size: 16px;">🏷️</span>
              <strong style="font-size: 13px; color: #f6c66d;">$49/mo Lifetime Lock</strong>
            </div>
            <p style="font-size: 12px; color: var(--muted); margin: 0;">Lock in founding pricing (code FOUNDING20) permanently before the $100/mo jump.</p>
          </div>
          <div class="waitlist-perk">
            <div class="waitlist-perk-head">
              <span style="font-size: 16px;">📊</span>
              <strong style="font-size: 13px; color: var(--accent);">Live Market Briefs</strong>
            </div>
            <p style="font-size: 12px; color: var(--muted); margin: 0;">Instant invite to the Free Telegram Hub for weekly HTF liquidity levels and win teasers.</p>
          </div>
        </div>

        <form id="waitlistForm" style="display: flex; flex-direction: column; gap: 14px;">
          <div class="waitlist-form-grid">
            <input type="email" id="waitlistEmail" placeholder="Enter your email address *" required style="padding: 11px 14px; font-size: 13px; background: #0c121b; border: 1px solid var(--line); border-radius: 10px; color: #fff;">
            <input type="text" id="waitlistTelegram" placeholder="Telegram @handle (optional)" style="padding: 11px 14px; font-size: 13px; background: #0c121b; border: 1px solid var(--line); border-radius: 10px; color: #fff;">
            <select id="waitlistInterest" style="padding: 11px 12px; font-size: 13px; background: #0c121b; border: 1px solid var(--line); border-radius: 10px; color: #fff;">
              <option value="all">🌐 All Markets (Full Suite)</option>
              <option value="institutional">🏛️ Institutional FX & Indices</option>
              <option value="synthetics">⚡ Deriv Synthetic Watchlist</option>
            </select>
            <button type="submit" id="waitlistSubmitBtn" class="waitlist-submit-btn">
              Reserve Priority Spot →
            </button>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; font-size: 12px; margin-top: 4px;">
            <span style="color: var(--muted);">🔒 Zero spam. Only used for cohort access notifications and priority discount codes.</span>
            <a href="https://whop.com/deoedge/deo-edge-vip-signals/" target="_blank" rel="noopener noreferrer" style="color: #f6c66d; text-decoration: none; font-weight: 700;">
              ⚡ View current VIP details on Whop →
            </a>
          </div>
          <div id="waitlistFeedback" style="display: none; font-size: 13px; padding: 10px 14px; border-radius: 8px;"></div>
        </form>

        <div id="waitlistSuccess" style="display: none; padding: 22px; border-radius: 12px; background: rgba(140, 240, 198, 0.08); border: 1px solid rgba(140, 240, 198, 0.35); text-align: center;">
          <div style="font-size: 30px; margin-bottom: 8px;">🎉</div>
          <strong style="color: var(--accent); font-size: 17px; display: block; margin-bottom: 6px;">You're on the Cohort 2 Priority Waitlist!</strong>
          <p style="color: var(--text); font-size: 13.5px; max-width: 580px; margin: 0 auto 16px; line-height: 1.5;">We've reserved your priority desk position. You will receive an email and Telegram notification 2 hours before the next cohort drop opens with founding pricing code <strong>FOUNDING20</strong>.</p>
          <div style="display: flex; justify-content: center; gap: 12px; flex-wrap: wrap;">
            <a href="https://t.me/DEOEDGE" target="_blank" rel="noopener noreferrer" class="tg-btn" style="padding: 9px 18px; font-size: 12.5px;">
              Join DEO EDGE (FREE)
            </a>
            <a href="https://t.me/DEO_EDGE_synthetics_free" target="_blank" rel="noopener noreferrer" class="synth-free-btn" style="padding: 9px 18px; font-size: 12.5px;">
              Join DEO EDGE | FREE SYNTHETICS
            </a>
          </div>
        </div>
      </article>
      </section>

      <section class="quant section-grid" aria-labelledby="quant-heading"><div class="section-heading"><div><p class="eyebrow">05 / Quant lab</p><h2 id="quant-heading">Stress-test the <em>assumptions.</em></h2></div><div class="section-note">Research tool · not a forecast</div></div><article class="panel quant-card" id="quantLab">
      <div class="panel-head">
        <div>
          <p class="eyebrow">QUANT LAB</p>
          <h2>🎲 Monte Carlo Drawdown Stress Test</h2>
          <p class="muted-copy">Explore how different possible outcomes could affect an account, using verified closed-trade history. This is a research stress test, not a forecast or performance promise.</p>
        </div>
      </div>
      <details class="mc-explainer">
        <summary>How does this stress test work?</summary>
        <div class="mc-explainer-content">
          <p>The test repeatedly picks a result from the verified, closed trades and uses it as a stand-in for a future trade. A past result can be picked more than once, creating many different possible paths.</p>
          <ul>
            <li>Each path starts at the same 100% balance. The risk percentage is applied to the current simulated balance on every trade, so gains and losses compound.</li>
            <li>Use the same <strong>Shuffle code</strong>, settings, and trade history to reproduce the same run.</li>
            <li>On the chart, 1.00× means no change from the starting balance; 1.10× means 10% higher and 0.90× means 10% lower. The shaded band covers the middle 90% of simulated paths.</li>
          </ul>
          <p class="mc-explainer-caveat">This assumes future results resemble the historical sample. Real trading costs, slippage, and market changes are not modeled, and outcomes can be better or worse.</p>
        </div>
      </details>
      <div class="risk-inputs mc-controls">
        <label class="mc-input">
          <span>Simulations</span>
          <input id="mcIterations" type="number" min="100" max="10000" step="100" value="2000">
          <small>Number of possible paths to compare.</small>
        </label>
        <label class="mc-input">
          <span>Future trades ahead</span>
          <input id="mcHorizon" type="number" min="10" max="500" step="10" value="100">
          <small>How many trades each path contains.</small>
        </label>
        <label class="mc-input">
          <span>Risk per trade (%)</span>
          <input id="mcRisk" type="number" min="0.1" max="5" step="0.1" value="1">
          <small>Percent of the current balance at risk per trade.</small>
        </label>
        <label class="mc-input">
          <span>Shuffle code</span>
          <input id="mcSeed" type="number" min="1" step="1" value="42">
          <small>Keep the same code to repeat a run.</small>
        </label>
        <button id="mcRun" class="secondary">▶ Run stress test</button>
      </div>
      <div id="mcStatus" class="muted-copy mc-status" role="status" aria-live="polite" aria-atomic="true">Set your assumptions, then run the stress test.</div>
      <div id="mcCards" class="risk-outputs mc-cards" aria-live="polite"></div>
      <div class="chart-wrap"><svg id="mcFan" viewBox="0 0 1000 380" role="img" aria-label="Simulated account balance range from the start through future trades"></svg></div>
      <div class="mc-chart-legend" aria-label="Chart legend">
        <span><i class="mc-legend-typical"></i>Typical path (middle result)</span>
        <span><i class="mc-legend-range"></i>Middle 90% of simulated paths</span>
      </div>
      <p class="chart-disclaimer">Historical outcomes do not guarantee future performance. Real costs, execution differences, and changing markets can make results differ.</p>
      <div class="mc-verdict">
        <h3>🏁 Prop challenge verdict — live mixture</h3>
        <p class="muted-copy">The target is the profit goal. Pass is the estimated chance a simulated account reaches it within 21 trading days before hitting a daily or overall loss limit—not a return you have already made. The 90% interval shows how that pass estimate varies when this small sample is resampled; it is not a return range or a guarantee. Assumes every alert is traded at the fixed risk shown.</p>
        <div id="pvWrap"><p class="muted-copy" id="pvStatus">Loading verdict…</p></div>
      </div>
    </article></section>

      <section class="live-desk section-grid" id="liveDesk" aria-labelledby="liveDeskHeading">
        <div class="section-heading"><div><p class="eyebrow">06 / Live desk</p><h2 id="liveDeskHeading">Recorded events, <em>as they arrive.</em></h2></div><div class="section-note">Cursor poll · every 15 seconds · no orders</div></div>
        <div class="live-desk-grid">
          <article class="event-tape">
            <div class="tape-head"><span>REAL-TIME EVENT TAPE</span><div><span id="liveDeskStatus" class="sim-tag">READ-ONLY</span><button id="tapePause" class="tape-control" type="button" aria-pressed="false" title="Pause or resume this display only">Pause display</button><button id="liveChimeToggle" class="tape-control" type="button" aria-pressed="false">Chime off</button></div></div>
            <ul id="liveTape" class="live-tape event-list" role="log" aria-live="polite" aria-relevant="additions text"><li class="live-empty">Loading recorded events…</li></ul>
            <div class="tape-foot"><span id="liveEventCount">— events in view</span><span>History is timestamped UTC; new items are cursor-polled.</span></div>
          </article>
          <article class="micro-chart-card">
            <div class="tape-head"><span>RECORDED EVENT VOLUME · 12H</span><span id="liveChartStatus" class="sim-tag">WAITING FOR DATA</span></div>
            <div class="micro-chart" role="img" aria-label="Recorded event counts by hour for the past twelve hours">
              <div class="micro-grid" aria-hidden="true"></div>
              <svg viewBox="0 0 600 220" preserveAspectRatio="none" aria-hidden="true"><path id="liveBand" class="chart-band"></path><path id="liveLine" class="chart-path"></path></svg>
              <span id="chartEndLabel" class="chart-end-label">—</span>
            </div>
            <div class="freshness-row"><span><b id="liveEventCount12h">—</b> recorded events</span><span><b id="liveUpdatedAt">—</b> latest event</span><span><b id="livePollMs">—</b> response time</span></div>
            <div class="tape-foot"><span>−12h</span><span>Loaded browser rows only · not total scans</span><span>now UTC</span></div>
          </article>
        </div>
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
        <div id="replayBar" class="replay-bar" hidden>
          <div class="replay-controls">
            <button id="replayReset" class="secondary" title="Restart replay">⏮</button>
            <button id="replayPrev" class="secondary" title="Previous step">◀ Step</button>
            <button id="replayPlay" class="secondary" title="Auto play">▶ Play</button>
            <button id="replayNext" class="secondary" title="Next step">Step ▶</button>
            <span id="replayStepLabel" class="replay-step"></span>
          </div>
          <div id="replayStages" class="replay-stages"></div>
          <p id="replayNarration" class="replay-narration"></p>
        </div>
        <div id="riskCalc" class="risk-calc" hidden>
          <h3>🧮 Position Size Calculator</h3>
          <div class="risk-inputs">
            <label>Account equity ($)<input id="riskEquity" type="number" min="1" step="100" value="10000"></label>
            <label>Risk per trade (%)<input id="riskPct" type="number" min="0.1" max="5" step="0.1" value="1"></label>
          </div>
          <div id="riskOutputs" class="risk-outputs"></div>
          <p class="chart-disclaimer">Contract specifications differ by broker — always verify lot size with your broker before ordering.</p>
        </div>
        <p class="chart-disclaimer">Real historical candles with entry, stop loss, invalidation, and target levels visualized.</p>
      </section>
      </div>
    </main>

    <footer class="footer">
      <div class="footer-brand"><img class="brand-mark small" src="${DEO_EDGE_LOGO_DATA_URI}" alt="" aria-hidden="true" width="17" height="17"><strong>DEO Edge</strong><span>·</span><span>Confirmation Engine &amp; Research Ledger</span></div>
      <div class="footer-meta"><span>Paper pipeline</span><span>Engine v2.5.3</span><a href="terms.html">Terms &amp; Risk</a><a href="terms.html#data-policy">Data policy</a><a href="https://t.me/DEOEDGE" target="_blank" rel="noopener noreferrer">DEO EDGE (FREE)</a></div>
      <p>Research and education only · Paper simulation · No live orders · Not financial advice</p>
    </footer>
  </div>
  <script>const DEFAULT_URL = (typeof window !== 'undefined' && window.location && window.location.hostname && window.location.hostname.includes('workers.dev'))
  ? window.location.origin
  : 'https://slk-alert-worker.abidogundamilola.workers.dev';

const state = {
  url: DEFAULT_URL,
  adminKey: (typeof localStorage !== 'undefined' && localStorage.getItem('tayoAdminKey')) || '',
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

const dashboardTabs = Array.from(document.querySelectorAll('.tab'));
function activateDashboardTab(btn, moveFocus = false) {
  const selectedPanelId = btn.dataset.tab;
  dashboardTabs.forEach(item => {
    const selected = item === btn;
    item.classList.toggle('active', selected);
    item.classList.toggle('is-active', selected);
    item.setAttribute('aria-selected', String(selected));
    item.tabIndex = selected ? 0 : -1;
  });
  document.querySelectorAll('.tab-panel').forEach(panel => {
    const selected = panel.id === selectedPanelId;
    panel.classList.toggle('active', selected);
    panel.classList.toggle('is-visible', selected);
    panel.hidden = !selected;
  });
  if (moveFocus) btn.focus();
}
dashboardTabs.forEach(btn => {
  btn.addEventListener('click', () => activateDashboardTab(btn));
  btn.addEventListener('keydown', event => {
    const currentIndex = dashboardTabs.indexOf(btn);
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % dashboardTabs.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + dashboardTabs.length) % dashboardTabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = dashboardTabs.length - 1;
    else return;
    event.preventDefault();
    activateDashboardTab(dashboardTabs[nextIndex], true);
  });
});

function setViewMode(mode) {
  state.viewMode = mode === 'operator' ? 'operator' : 'public';
  document.body.classList.toggle('operator-mode', state.viewMode === 'operator');
  if ($('modePublicBtn')) {
    $('modePublicBtn').classList.toggle('active', state.viewMode === 'public');
    $('modePublicBtn').classList.toggle('is-active', state.viewMode === 'public');
    $('modePublicBtn').setAttribute('aria-pressed', String(state.viewMode === 'public'));
  }
  if ($('modeOperatorBtn')) {
    $('modeOperatorBtn').classList.toggle('active', state.viewMode === 'operator');
    $('modeOperatorBtn').classList.toggle('is-active', state.viewMode === 'operator');
    $('modeOperatorBtn').setAttribute('aria-pressed', String(state.viewMode === 'operator'));
  }
  if ($('activeModeLabel')) {
    $('activeModeLabel').textContent = state.viewMode === 'operator' ? 'Viewing: Operator Terminal' : 'Viewing: Public Overview';
    $('activeModeLabel').className = state.viewMode === 'operator' ? 'pill green' : 'pill gray';
  }
  try { localStorage.setItem('tayoViewMode', state.viewMode); } catch (_) {}
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
    const selected = (b.dataset.segment || 'all') === state.marketSegment;
    b.classList.toggle('active', selected);
    b.classList.toggle('is-active', selected);
    b.setAttribute('aria-pressed', String(selected));
  });
  document.querySelectorAll('.segment-card').forEach(card => {
    const target = card.dataset.targetSegment;
    const selected = target === state.marketSegment;
    card.classList.toggle('active', selected);
    card.classList.toggle('is-active', selected);
    card.setAttribute('aria-pressed', String(selected));
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
  const activate = () => {
    const target = card.dataset.targetSegment;
    if (target) setMarketSegment(state.marketSegment === target ? 'all' : target);
  };
  card.addEventListener('click', activate);
  card.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate();
    }
  });
});

const methodStages = [
  { code: 'MAP', title: 'HTF Directional Vantage Point', copy: 'Weekly and daily opposing liquidity draw is established. A 4H structural A/V-level is armed before the lower-timeframe radar begins.', rule: '4H structural direction and 1H execution context must align directionally.' },
  { code: 'TOUCH', title: 'Origin Zone Mitigation', copy: 'Price reaches and mitigates the origin key level, activating the lower-timeframe radar.', rule: 'The origin-level interaction is checked before later confirmation stages.' },
  { code: 'SWEEP', title: 'Liquidity Pool Run', copy: 'A false breakout purges an internal liquidity pool beyond a swing high or low extreme.', rule: 'A recorded sweep must be followed by the specified structure confirmation.' },
  { code: 'SHIFT', title: 'Market Structure Break', copy: 'Displacement breaks pullback structure on a candle close and forms a Fair Value Gap.', rule: 'The structure break is evaluated on a finalized candle; no intrabar confirmation.' },
  { code: 'RETEST', title: 'Inefficiency Rebalance', copy: 'Price makes a controlled retracement into the Fair Value Gap and an entry candidate prepares.', rule: 'The retest must satisfy the engine’s risk and target checks before entry.' },
  { code: 'ENTRY', title: 'Confirmed Entry Close', copy: 'A finalized candle close locks the entry price and stop-loss floor. The recorded entry is not retrospectively repainted.', rule: 'Setups below the minimum 2.5R target floor are rejected automatically.' },
  { code: 'OUTCOME', title: 'Deterministic Resolution', copy: 'A recorded setup resolves at its configured target, stop loss, or stale-expiration rule.', rule: 'Current method disclosure: Target 1 (+3.0R), Stop Loss (−1.0R), or 120-bar stale expiration.' }
];
document.querySelectorAll('[data-stage-index]').forEach(button => {
  button.addEventListener('click', () => {
    const index = Number(button.dataset.stageIndex);
    const stage = methodStages[index];
    if (!stage) return;
    document.querySelectorAll('[data-stage-index]').forEach(item => {
      const selected = item === button;
      item.classList.toggle('is-active', selected);
      item.setAttribute('aria-pressed', String(selected));
    });
    if ($('lifecycleStageLabel')) $('lifecycleStageLabel').textContent = \`Selected stage / \${stage.code}\`;
    if ($('lifecycleStageTitle')) $('lifecycleStageTitle').textContent = stage.title;
    if ($('lifecycleStageCopy')) $('lifecycleStageCopy').textContent = stage.copy;
    if ($('lifecycleStageRule')) $('lifecycleStageRule').textContent = stage.rule;
  });
});
if ($('showRulesBtn') && $('ruleReference')) {
  $('showRulesBtn').addEventListener('click', () => {
    const rules = $('ruleReference');
    rules.open = !rules.open;
    $('showRulesBtn').setAttribute('aria-expanded', String(rules.open));
  });
  $('ruleReference').addEventListener('toggle', () => {
    $('showRulesBtn').setAttribute('aria-expanded', String($('ruleReference').open));
  });
}

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
    \`Window (UTC): \${report?.window?.fromUtc || '—'} to \${report?.window?.toUtc || '—'}\`,
    \`Scan records: \${scan.scanRows ?? 0} total; \${scan.activeScanRows ?? 0} covered at least one market.\`,
    \`First/last scan: \${scan.firstScanUtc || 'none'} / \${scan.lastScanUtc || 'none'}.\`,
    \`Scan records with errors: \${scan.scanErrorRows ?? 0}.\`,
    \`Error rows by keyword match (not unique incidents): stale-feed \${errors.staleFeed ?? 0}; rate-limit/credits \${errors.rateLimitOrCredits ?? 0}; network/timeout \${errors.networkOrTimeout ?? 0}; other \${errors.other ?? 0}.\`,
    \`Scan-log alert insert counts: \${scan.alertRowsWritten ?? 0}; event insert counts: \${scan.eventRowsWritten ?? 0}.\`,
    \`Grouped rows in stored-alert table: \${scan.storedAlertsAvailable ? storedAlertCount : 'unavailable'}; these database rows do not prove message delivery.\`,
    \`Diagnostic rows: \${scan.diagnosticRows ?? 0} valid; \${scan.invalidDiagnosticRows ?? 0} invalid; available: \${scan.diagnosticsAvailable ? 'yes' : 'no'}.\`,
    \`Recorded confirmed-alert inserts: \${scan.recordedConfirmedAlerts ?? 0}.\`,
    \`Freshness/deduplication skip counts: \${gateMetricsRows} scan logs have these counters; stale \${dailyRows.reduce((n, d) => n + Number(d.staleConfirmationSkips || 0), 0)}, duplicate \${dailyRows.reduce((n, d) => n + Number(d.duplicateConfirmationSkips || 0), 0)}.\`,
    'A day with zero counter-coverage means the old logs did not record these skips; it does not mean there were no skips.',
    '',
    'Daily scan and replay breakdown (UTC; replay numbers include repeat scans):',
  ];
  if (!dailyRows.length) lines.push('  Daily breakdown unavailable.');
  for (const day of dailyRows) {
    const c = day.errorCategories || {};
    lines.push(\`  \${day.utcDay}: scans \${day.scanRows ?? 0} (\${day.activeScanRows ?? 0} active), errors \${day.scanErrorRows ?? 0} [stale \${c.staleFeed ?? 0}, rate/credits \${c.rateLimitOrCredits ?? 0}, network \${c.networkOrTimeout ?? 0}, other \${c.other ?? 0}], diagnostics \${day.diagnosticRows ?? 0}, scan-log alert inserts \${day.alertRowsWritten ?? 0}, confirmed inserts \${day.recordedConfirmedAlerts ?? 0}, replay RETEST \${day.replayRetestTransitions ?? 0}, candidates \${day.retestCandidates ?? 0}, target/risk rejects \${day.targetRejects ?? 0}/\${day.riskRejects ?? 0}, stale/duplicate skips \${day.staleConfirmationSkips ?? 0}/\${day.duplicateConfirmationSkips ?? 0} (\${day.gateMetricsRows ?? 0} covered).\`);
  }
  lines.push('', 'Stored alert rows by UTC day / market / timeframe / alert status / trade status / suppress reason:');
  if (!scan.storedAlertsAvailable) lines.push('  Stored-alert table unavailable.');
  else if (!storedAlertRows.length) lines.push('  No stored alert rows in this window.');
  for (const row of storedAlertRows) {
    const reason = row.suppressReason ? \` — \${row.suppressReason}\` : '';
    lines.push(\`  \${row.utcDay} \${row.pair} \${row.timeframe} \${row.direction} / alert \${row.alertStatus}, trade \${row.tradeStatus}: \${row.count}\${reason}\`);
  }
  lines.push(
    '',
    \`First tracked delivery result: \${delivery.firstTrackedUtc || 'none recorded'}.\`,
    'Delivery audit writes are best-effort; missing rows do not prove that a message was not sent.',
    'Delivery counts below are channel API results, not proof the recipient saw the message:',
  );
  const deliveryRows = Array.isArray(delivery.byChannel) ? delivery.byChannel : [];
  if (!deliveryRows.length) lines.push('  No tracked delivery results in this window.');
  for (const row of deliveryRows) {
    lines.push(\`  \${row.kind} / \${row.channel}: \${row.delivered} delivered, \${row.partial} partial, \${row.failed} failed, \${row.notConfigured} not configured.\`);
  }
  lines.push('', 'Pair/timeframe funnel totals (replay counts; repeats are not unique setups):');
  const funnelRows = Array.isArray(scan.byPairTimeframe) ? scan.byPairTimeframe : [];
  if (!funnelRows.length) lines.push('  No per-pair/timeframe diagnostics available.');
  for (const row of funnelRows) {
    const f = row.replay || {};
    lines.push(\`  \${row.pair} \${row.timeframe}: MAP \${f.MAP ?? 0} → TOUCH \${f.TOUCH ?? 0} → SWEEP \${f.SWEEP ?? 0} → SHIFT \${f.SHIFT ?? 0} → RETEST \${f.RETEST ?? 0}; target rejects \${f.targetRejects ?? 0}; risk rejects \${f.riskRejects ?? 0}.\`);
  }
  for (const caveat of Array.isArray(report?.caveats) ? report.caveats : []) lines.push(\`Note: \${caveat}\`);
  return lines.join('\\n');
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
      if (output) output.textContent = \`Audit unavailable: \${err.message || String(err)}\`;
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
    if (!confirm('Purge all synthetic trade records from the journal?\\n\\nThis will restore the public overview to Institutional-only (+30.78R, 75.0% Win Rate) and give Deriv watchlist a clean slate under the active HTF conflict filter.')) return;
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
  try { localStorage.removeItem('tayoAdminKey'); } catch (_) {}
}

async function getAdminKey(forcePrompt = false) {
  if (forcePrompt) clearAdminKey();
  if (!state.adminKey) {
    try { state.adminKey = localStorage.getItem('tayoAdminKey') || ''; } catch (_) {}
  }
  if (state.adminKey) return state.adminKey;
  const key = window.prompt('Enter Admin Key:');
  if (key && key.trim()) {
    state.adminKey = key.trim();
    try { localStorage.setItem('tayoAdminKey', state.adminKey); } catch (_) {}
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
    ...(isAdmin && state.adminKey ? { 'x-admin-key': state.adminKey, Authorization: \`Bearer \${state.adminKey}\` } : {}),
    ...(options.body ? { 'Content-Type': 'application/json' } : {})
  };
  const requestOptions = { ...options };
  delete requestOptions.admin;
  delete requestOptions._retried;
  const r = await fetch(state.url.replace(/\\/$/, '') + path, { ...requestOptions, headers });
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
  if (!r.ok) throw new Error(\`\${r.status} \${await r.text()}\`);
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
    else {
      setStatus('Health response unavailable', 'bad');
      if ($('headerWorkerState')) $('headerWorkerState').textContent = 'Health response unavailable';
      if ($('headerLastChecked')) $('headerLastChecked').textContent = 'Not available';
    }
    if (prefs) renderPreferences(prefs);
    renderEnginePulse(pulse);
    await loadAlerts();
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
    const head = \`\${mapRows} MAP event rows · \${touchRows} TOUCH event rows · \${retestRows} RETEST event rows · \${alertRows} alert rows inserted\`;
    summary.textContent = alertRows > 0
      ? \`\${head}. Alert rows are persisted before delivery gates; this is not proof a Telegram message was sent.\`
      : \`\${head}. No alert row was stored in this window; this is a pipeline count, not a strategy-performance verdict.\`;
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
  if (num(rej.belowMinRiskAtr)) bits.push(\`\${num(rej.belowMinRiskAtr)} below the 0.8×ATR risk floor\`);
  if (num(rej.aboveMaxStopAtr)) bits.push(\`\${num(rej.aboveMaxStopAtr)} above the stop ceiling\`);
  if (num(rej.nonPositiveRisk)) bits.push(\`\${num(rej.nonPositiveRisk)} non-positive risk\`);
  if (num(rej.targetFloor)) bits.push(\`\${num(rej.targetFloor)} under the 2.5R target floor\`);
  const replayNote = 'Counts are replay attempts, not unique setups; the same opportunity can recur across scans.';
  const rejEl = $('enginePulseRejections');
  if (rejEl) rejEl.textContent = bits.length
    ? \`Replay rejection attempts: \${bits.join(' · ')}. \${replayNote}\`
    : \`No rejection attempts recorded in this window; that does not mean every market or candidate passed. \${replayNote}\`;
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
        + ' open research groups per tick · scheduler ' + secs(timing.avgScheduleMs) + 's · '
        + num(timing.avgStoreCalls) + ' store calls (' + secs(timing.avgStoreMs) + 's) · '
        + num(timing.avgHttpCalls) + ' HTTP requests/tick (max ' + num(timing.maxHttpCalls) + ')'
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
    const s = await api(\`/stats\${qs ? \`?\${qs}\` : ''}\`);
    renderStats(s);
    return s;
  } catch (e) {
    console.error('Failed to load stats:', e);
    return null;
  }
}

function setStatus(text, kind) {
  if ($('statusText')) $('statusText').textContent = text;
  if ($('statusDot')) $('statusDot').className = \`status-dot \${kind === 'ok' ? 'online' : kind === 'muted' ? 'checking' : 'bad'}\`;
}

function renderHealth(h) {
  if (!h) return;
  const healthy = Boolean(h.ok);
  const version = String(h.version || 'version unavailable');
  const checked = h.time ? fmtDate(h.time) : 'Time not reported';
  const pairs = Array.isArray(h.pairs) ? h.pairs : [];
  const feeds = h.oandaConfigured
    ? 'OANDA v3 · Twelve Data · Dukascopy · Deriv'
    : 'Twelve Data · Dukascopy · Deriv';

  if ($('mode')) $('mode').textContent = 'PAPER SIMULATION · NO LIVE ORDERS';
  if ($('workerName')) $('workerName').textContent = \`slk-alert-worker \${version}\`;
  if ($('lastResponse')) $('lastResponse').textContent = checked;
  if ($('headerLastChecked')) $('headerLastChecked').textContent = checked;
  if ($('workerVersionLabel')) $('workerVersionLabel').textContent = \`Engine \${version}\`;
  if ($('headerWorkerState')) $('headerWorkerState').textContent = healthy ? 'Health response received' : 'Health response reports degraded status';
  if ($('overviewStatusDot')) $('overviewStatusDot').className = \`status-dot \${healthy ? 'online' : 'bad'}\`;
  if ($('statusText')) $('statusText').textContent = healthy ? 'Worker Online · Health checked' : 'Worker responded · Review health';
  if ($('statusDot')) $('statusDot').className = \`status-dot \${healthy ? 'online' : 'bad'}\`;
  if ($('opWorkerHealth')) $('opWorkerHealth').textContent = \`\${version} · \${healthy ? 'Healthy' : 'Degraded'} (\${String(h.mode || 'PAPER').toUpperCase()})\`;
  if ($('opLastScan')) $('opLastScan').textContent = h.time ? fmtDate(h.time) : 'Time not reported by health endpoint';
  if ($('opFeeds')) $('opFeeds').textContent = feeds;
  if ($('opFeedSummary')) $('opFeedSummary').textContent = feeds;

  if (Array.isArray(h.pairs)) {
    if ($('activePairCount')) $('activePairCount').textContent = String(h.pairs.length);
    if ($('pairs')) $('pairs').textContent = pairs.length ? pairs.join(' · ') : 'No scanner pairs reported by the health endpoint';
    const pairSelect = $('alertPair');
    if (pairSelect) {
      const curVal = pairSelect.value;
      pairSelect.innerHTML = '<option value="">All pairs</option>' + pairs.map(pair => \`<option value="\${esc(pair)}">\${esc(pair)}</option>\`).join('');
      pairSelect.value = curVal;
    }
  }
  if ($('healthPill')) {
    $('healthPill').textContent = healthy ? 'WORKER ONLINE' : 'DEGRADED';
    $('healthPill').className = \`panel-status \${healthy ? 'online' : 'bad'}\`;
  }
  if ($('healthDetails')) {
    const entryTfs = Array.isArray(h.entryTfs) && h.entryTfs.length ? h.entryTfs.join(' · ') : 'Not reported by health endpoint';
    const relay = h.relayUrl ? esc(h.relayUrl) : 'Not reported by health endpoint';
    const feedStatus = h.feedStatus ? esc(h.feedStatus) : 'Not reported by health endpoint';
    $('healthDetails').innerHTML = \`
      <div class="health-item"><span>Cloud service</span><strong>slk-alert-worker</strong></div>
      <div class="health-item"><span>Engine version</span><strong>\${esc(version)}</strong></div>
      <div class="health-item"><span>System status</span><strong>\${healthy ? 'Healthy' : 'Degraded'}</strong></div>
      <div class="health-item"><span>Notification policy</span><strong>\${feedStatus}</strong></div>
      <div class="health-item"><span>Active timeframes</span><strong>\${esc(entryTfs)}</strong></div>
      <div class="health-item"><span>Deriv relay URL</span><strong>\${relay}</strong></div>
      <div class="health-item"><span>Server time (UTC)</span><strong>\${esc(h.time || 'Not reported')}</strong></div>
      <div class="health-item"><span>Scanner coverage</span><strong>\${pairs.length} markets reported by health endpoint</strong></div>
      <div class="health-item"><span>Execution mode</span><strong>Paper simulation · no live orders</strong></div>
      <div class="health-item"><span>Data source configuration</span><strong>\${esc(feeds)}</strong></div>
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
  const netRNum = Number(s.netR || 0);
  const netRText = s.netR == null ? (s.total === 0 ? '0.00R' : 'Syncing…') : \`\${netRNum > 0 ? '+' : ''}\${netRNum.toFixed(2)}R\`;
  if ($('total')) $('total').textContent = s.total != null ? String(s.total) : '0';
  if ($('alertTabCount')) $('alertTabCount').textContent = s.total != null ? String(s.total) : '—';
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
    $('maxDD').textContent = s.maxDD == null ? '0.00R' : \`\${ddNum.toFixed(2)}R\`;
    $('maxDD').classList.remove('loss-text', 'profit-text');
    if (ddNum < 0) $('maxDD').classList.add('loss-text');
  }
  const winRateText = s.winRate == null ? (s.total === 0 ? 'N/A' : 'Syncing…') : \`\${(s.winRate * 100).toFixed(1)}%\`;
  if ($('winRate')) $('winRate').textContent = winRateText;
  if ($('perfWinRate')) $('perfWinRate').textContent = winRateText;

  if (s.segments) {
    const inst = s.segments.institutional || {};
    const synth = s.segments.synthetics || {};
    const instWr = inst.winRate != null ? \`\${(inst.winRate * 100).toFixed(1)}%\` : '—';
    const instNr = inst.netR != null ? \`\${inst.netR > 0 ? '+' : ''}\${Number(inst.netR).toFixed(2)}R\` : '—';
    const instOut = \`\${inst.tp || 0} TP · \${inst.sl || 0} SL\`;

    const synthWr = synth.winRate != null ? \`\${(synth.winRate * 100).toFixed(1)}%\` : '0.0%';
    const synthNr = synth.netR != null ? \`\${synth.netR > 0 ? '+' : ''}\${Number(synth.netR).toFixed(2)}R\` : '0.00R';
    const synthOut = \`\${synth.tp || 0} TP · \${synth.sl || 0} SL\`;

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

  const segBadgeText = state.marketSegment === 'synthetics' ? '⚡ Deriv Watchlist' : state.marketSegment === 'institutional' ? '🏛️ Institutional' : 'All';
  ['overviewNetRSegmentBadge', 'overviewWinRateSegmentBadge', 'overviewOpenSegmentBadge', 'overviewTotalSegmentBadge'].forEach(id => {
    if ($(id)) $(id).textContent = segBadgeText;
  });

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
    const isSynth = r.group && (r.group.startsWith('V') || r.group.startsWith('R_'));
    const groupBadge = isSynth
      ? '<span class="market-tag synth-tag" style="margin-left:6px;">⚡ 24/7 SYNTHETICS</span>'
      : '';
    const netRVal = Number(r.netR || 0);
    const maxDDVal = Number(r.maxDD || 0);
    const netRClass = netRVal < 0 ? 'loss-text' : (netRVal > 0 ? 'profit-text' : '');
    const maxDDClass = maxDDVal < 0 ? 'loss-text' : '';
    const rowBClass = netRVal < 0 ? 'loss-text' : (netRVal > 0 ? 'profit-text' : '');
    const netRFormatted = \`\${netRVal > 0 ? '+' : ''}\${netRVal.toFixed(2)}R\`;
    const maxDDFormatted = \`\${maxDDVal.toFixed(2)}R\`;
    return \`
      <div class="breakdown-row">
        <div>
          <strong style="color:#f1f5f9;">\${esc(r.group)}\${groupBadge}</strong>
          <small style="display:block; color:var(--muted); font-size:11px; margin-top:2px;">📅 \${dateContext}</small>
        </div>
        <span>\${r.completed} completed · <span class="profit-text">\${r.tp} TP</span> · <span class="loss-text">\${r.sl} SL</span></span>
        <b class="\${rowBClass}"><span class="\${netRClass}">\${netRFormatted}</span> · Max DD <span class="\${maxDDClass}">\${maxDDFormatted}</span></b>
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
    const result = await api(\`/alerts?\${alertParams()}\`);
    const rawAlerts = Array.isArray(result) ? result : (result.items || []);
    state.alerts = rawAlerts.filter(a => a.alertStatus !== 'SUPPRESSED');
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
      const r = a.rMultiple != null ? Number(a.rMultiple) : (a.entry && a.stopLoss && a.tp1 && Math.abs(a.entry - a.stopLoss) > 0 ? Math.abs(a.tp1 - a.entry) / Math.abs(a.entry - a.stopLoss) : 2.5);
      statusLabel = \`TP HIT ✅ (+\${r.toFixed(2)}R)\`;
      statusClass = 'profit-text';
    } else if (a.status === 'SL_HIT') {
      const r = a.rMultiple != null ? Number(a.rMultiple) : -1.0;
      statusLabel = \`STOP LOSS 🛑 (\${r < 0 ? '' : '-'}\${Math.abs(r).toFixed(2)}R)\`;
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
    let timeLogHtml = \`Opened \${fmtDate(a.candleCloseTime)}\`;
    if (a.exitTime && (a.status === 'TP_HIT' || a.status === 'SL_HIT' || a.status === 'BE_HIT' || a.status === 'EXPIRED')) {
      const diffMs = Math.max(0, new Date(a.exitTime).getTime() - new Date(a.candleCloseTime).getTime());
      const diffMins = Math.round(diffMs / 60000);
      const durationStr = diffMins >= 60 ? \`\${Math.floor(diffMins / 60)}h \${diffMins % 60}m\` : \`\${diffMins}m\`;
      timeLogHtml += \` · Closed \${fmtDate(a.exitTime)} (\${durationStr})\`;
    }
    return \`
      <button class="alert-row" data-setup="\${esc(a.setupId)}" data-tf="\${esc(a.tf)}">
        <div>
          <strong class="alert-pair">\${esc(a.pair)} · \${esc(a.tf)} · <span class="\${dirClass}">\${esc(a.direction)}</span> \${marketTag}</strong>
          <small class="alert-meta">\${esc(a.keyLevel || 'Key Level')} · \${timeLogHtml}</small>
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
  stopReplayTimer();
  if ($('replayBar')) $('replayBar').hidden = true;
  if ($('riskCalc')) $('riskCalc').hidden = true;
  try {
    const data = await api(\`/dashboard/signals/\${encodeURIComponent(setupId)}/chart?timeframe=\${encodeURIComponent(tf)}&before=200&after=20\`);
    if (data.status && data.status !== 'OK' && (!data.candles || !data.candles.length)) {
      showChartNotice(\`\${data.status}: \${data.error || 'No finalized history available.'}\`);
      return;
    }
    initReplay(data);
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
  let out = \`<rect x="0" y="0" width="\${W}" height="\${H}" rx="14" fill="#0b111a"/>\`;
  for (let i = 0; i < 5; i++) {
    const val = hi - (hi - lo) * i / 4;
    out += \`<line x1="\${pad.l}" x2="\${W - pad.r}" y1="\${y(val)}" y2="\${y(val)}" stroke="#253044"/><text x="8" y="\${y(val) + 4}" fill="#8793a7" font-size="11">\${num(val)}</text>\`;
  }
  const cw = Math.max(2, Math.min(14, (W - pad.l - pad.r) / all.length * 0.65));
  candles.forEach((c, i) => {
    const xx = x(i), up = c.close >= c.open, color = up ? '#8cf0c6' : '#ff8f9b', bodyY = Math.min(y(c.open), y(c.close)), bodyH = Math.max(1, Math.abs(y(c.open) - y(c.close)));
    out += \`<g><title>\${fmtDate(c.time)} · O \${num(c.open)} H \${num(c.high)} L \${num(c.low)} C \${num(c.close)}</title><line x1="\${xx}" x2="\${xx}" y1="\${y(c.high)}" y2="\${y(c.low)}" stroke="\${color}"/><rect x="\${xx - cw / 2}" y="\${bodyY}" width="\${cw}" height="\${bodyH}" fill="\${color}" opacity=".9"/></g>\`;
  });
  const rVal = (levels.entry != null && levels.stop != null && levels.target1 != null && Math.abs(levels.entry - levels.stop) > 0)
    ? Math.abs(levels.target1 - levels.entry) / Math.abs(levels.entry - levels.stop)
    : null;
  const tp1Label = (rVal && Number.isFinite(rVal) && rVal > 0) ? \`TP1 (+\${rVal.toFixed(2)}R)\` : 'TP1';
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
      out += \`<line x1="\${pad.l}" x2="\${W - pad.r}" y1="\${y(val)}" y2="\${y(val)}" stroke="\${color}" stroke-dasharray="6 5"/><text x="\${W - pad.r - 5}" y="\${y(val) - 5}" text-anchor="end" fill="\${color}" font-size="11">\${label} \${num(val)}</text>\`;
    });
  }
  (data.evidenceMarkers || []).forEach(m => {
    const t = new Date(m.time).getTime(), idx = all.findIndex(c => new Date(c.time).getTime() >= t);
    if (idx < 0 || idx > upto) return;
    const xx = x(idx);
    out += \`<circle cx="\${xx}" cy="\${pad.t + 10}" r="5" fill="#f6c66d"><title>\${esc(m.type)} · \${esc(m.label)}</title></circle><text x="\${xx}" y="\${pad.t + 27}" text-anchor="middle" fill="#f6c66d" font-size="9">\${esc(m.type)}</text>\`;
  });
  if (v.showOutcome && data.outcome && data.outcome.status && data.outcome.status !== 'OPEN') {
    const oc = data.outcome;
    const color = oc.status === 'TP_HIT' ? '#8cf0c6' : oc.status === 'SL_HIT' ? '#ff8f9b' : oc.status === 'BE_HIT' ? '#f6c66d' : '#8793a7';
    const rTxt = oc.rMultiple != null ? \` \${Number(oc.rMultiple) >= 0 ? '+' : ''}\${Number(oc.rMultiple).toFixed(2)}R\` : '';
    const badge = \`\${oc.status}\${rTxt}\`;
    out += \`<rect x="\${pad.l + 8}" y="\${pad.t + 4}" width="\${badge.length * 8 + 30}" height="24" rx="12" fill="#0b111a" stroke="\${color}"/><text x="\${pad.l + 22}" y="\${pad.t + 20}" fill="\${color}" font-size="12" font-weight="700">🏁 \${esc(badge)}</text>\`;
  }
  out += \`<text x="\${pad.l}" y="\${H - 12}" fill="#8793a7" font-size="11">\${fmtDate(all[0].time)}</text><text x="\${W - pad.r}" y="\${H - 12}" text-anchor="end" fill="#8793a7" font-size="11">\${fmtDate(all[all.length - 1].time)}</text>\`;
  svg.innerHTML = out;
  const incomplete = data.dataHealth && !data.dataHealth.historyComplete;
  if ($('chartStatus')) $('chartStatus').textContent = \`LIVE OHLC · \${candles.length}/\${all.length} candles · \${data.provider || 'twelvedata'}\${incomplete ? ' · HISTORY_INSUFFICIENT' : ''}\`;
  if ($('chartLegend')) $('chartLegend').innerHTML = '<span class="legend-live">● LIVE OHLC</span> ' + lineDefs.map(xd => \`<span style="color:\${xd[2]}">━ \${xd[1]}</span>\`).join(' ');
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
    steps.push({ candleIdx: idx, stage: m.type, narration: \`\${m.type} — \${m.label}\` });
  }
  if (data.confirmedAt) {
    const idx = idxAt(data.confirmedAt);
    if (idx >= 0) steps.push({ candleIdx: idx, stage: 'CONFIRMED', narration: 'CONFIRMED — retest candle closed. DEO Edge entry alert dispatched to VIP with entry, stop loss and targets. Levels appear now (never before).' });
  }
  const oc = data.outcome;
  if (oc && oc.status && oc.status !== 'OPEN') {
    const idx = idxAt(oc.exitTime || data.confirmedAt);
    const r = oc.rMultiple != null ? \` (\${Number(oc.rMultiple) >= 0 ? '+' : ''}\${Number(oc.rMultiple).toFixed(2)}R)\` : '';
    steps.push({ candleIdx: idx < 0 ? candles.length - 1 : idx, stage: 'OUTCOME', narration: \`OUTCOME — \${oc.status}\${r} resolved on candle close and written to the verified ledger.\` });
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
      return \`<span class="\${cls}">\${STAGE_META[st][0]} \${st}</span>\`;
    }).join('');
  }
  const lbl = $('replayStepLabel');
  if (lbl) lbl.textContent = \`Step \${pos + 1}/\${steps.length} · \${step.stage}\`;
  const nar = $('replayNarration');
  if (nar) nar.textContent = \`\${STAGE_META[step.stage][0]} \${step.narration}\`;
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
  if (['US30', 'NAS100', 'GER40', 'DE40', 'JAPAN225', 'JP225', 'NETHERLANDS25', 'UK100', 'SPX500'].includes(p)) return 1;
  if (/^V\\d|^R_\\d|1HZ/.test(p)) return 1;
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
  out.innerHTML = \`
    <div>Dollar risk<strong>$\${riskUsd.toFixed(2)}</strong></div>
    <div>Suggested size<strong>\${lotsR.toFixed(2)} lots</strong></div>
    <div>Stop distance<strong>\${num(stopDist)} · \${cls}</strong></div>
    <div>Payout at TP1<strong>\${tp1Usd != null ? '$' + tp1Usd.toFixed(2) : '—'}</strong></div>\`;
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
    const res = await api(\`/alerts?pageSize=200&page=\${page}&sort=candleCloseTime&order=desc\`);
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
      downloadBlob(\`deo-edge-ledger-\${stamp}.json\`, 'application/json', JSON.stringify(rows, null, 2));
      return;
    }
    const escCsv = val => { const s = val == null ? '' : String(val); return /[",\\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lines = [EXPORT_FIELDS.map(([, label]) => escCsv(label)).join(',')];
    for (const r of rows) lines.push(EXPORT_FIELDS.map(([key]) => escCsv(r[key])).join(','));
    downloadBlob(\`deo-edge-ledger-\${stamp}.csv\`, 'text/csv', lines.join('\\n'));
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
        feedback.textContent = \`Unable to reserve spot: \${err.message || 'Please try again later'}\`;
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
    try { const m = localStorage.getItem('tayoViewMode'); if (m) setViewMode(m); } catch (_) {}
    setupWaitlist();
    loadAll();
  });
} else {
  try { const m = localStorage.getItem('tayoViewMode'); if (m) setViewMode(m); } catch (_) {}
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
  let out = \`<rect x="0" y="0" width="\${W}" height="\${H}" rx="14" fill="#0b111a"/>\`;
  for (let i = 0; i < 5; i++) {
    const v = hi - (hi - lo) * i / 4;
    out += \`<line x1="\${pad.l}" x2="\${W - pad.r}" y1="\${y(v)}" y2="\${y(v)}" stroke="#253044"/><text x="8" y="\${y(v) + 4}" fill="#8793a7" font-size="11">\${v.toFixed(2)}×</text>\`;
  }
  let fan = '';
  for (let i = 0; i <= d.horizon; i++) fan += x(i) + ',' + y(d.bands.p95[i]) + ' ';
  for (let i = d.horizon; i >= 0; i--) fan += x(i) + ',' + y(d.bands.p5[i]) + ' ';
  out += \`<polygon points="\${fan}" fill="#38bdf8" opacity="0.16"/>\`;
  out += \`<polyline points="\${d.bands.p50.map((v, i) => x(i) + ',' + y(v)).join(' ')}" fill="none" stroke="#8cf0c6" stroke-width="2.4"/>\`;
  out += \`<line x1="\${pad.l}" x2="\${W - pad.r}" y1="\${y(1)}" y2="\${y(1)}" stroke="#f6c66d" stroke-dasharray="6 5"/>\`;
  out += \`<text x="\${W - pad.r - 4}" y="\${y(1) - 6}" text-anchor="end" fill="#f6c66d" font-size="11">starting balance 1.00×</text>\`;
  out += \`<text x="\${pad.l}" y="\${H - 12}" fill="#8793a7" font-size="11">Start</text><text x="\${W - pad.r}" y="\${H - 12}" text-anchor="end" fill="#8793a7" font-size="11">After \${d.horizon} trades</text>\`;
  svg.innerHTML = out;
}

if ($('mcRun')) $('mcRun').addEventListener('click', runMonteCarloUI);

// ── Prop challenge verdict on the live mixture ───────────────────────────
async function loadPropVerdict() {
  const wrap = $('pvWrap');
  if (!wrap) return;
  try {
    const d = await api('/api/prop-verdict');
    if (!d.ok) {
      wrap.innerHTML = '<p class="muted-copy">Not enough closed trades yet (' + (d.closedTrades ?? 0) + ' of 5). The verdict appears once the ledger has a sample worth simulating.</p>';
      return;
    }
    const body = d.grid.map(c =>
      '<tr><td>' + c.targetPct + '% / ' + c.dailyPct + '%</td><td>' + c.riskPct.toFixed(2) + '%</td><td><strong>' + c.pass.toFixed(1) + '%</strong></td><td>' + c.blown.toFixed(1) + '%</td><td>' + c.lo.toFixed(0) + '% – ' + c.hi.toFixed(0) + '%</td></tr>'
    ).join('');
    wrap.innerHTML =
      '<p class="muted-copy">Sample: ' + d.n + ' closed alerts over ' + d.spanDays.toFixed(0) + ' days (' + d.alertsPerMonth.toFixed(1) + ' alerts/month service-wide). Mixture: ' +
      (d.mix.winRate * 100).toFixed(0) + '% win / ' + (d.mix.lossRate * 100).toFixed(0) + '% loss / ' + (d.mix.scratchRate * 100).toFixed(0) + '% scratch, model adjusted win-equivalent ' + d.mix.targetR.toFixed(2) + 'R.</p>' +
      '<table class="lifecycle-table"><thead><tr><th>Target / daily limit</th><th>Risk per trade</th><th title="Estimated chance of reaching the profit target before a loss limit">Pass</th><th title="Share of simulations that hit either the daily or overall loss limit">Drawdown</th><th title="Bootstrap range for the pass estimate, not an account-return range">Pass 90% interval</th></tr></thead><tbody>' + body + '</tbody></table>';
  } catch (e) {
    wrap.innerHTML = '<p class="muted-copy">Verdict unavailable: ' + (e && e.message ? e.message : e) + '</p>';
  }
}
loadPropVerdict();

// ── Live Desk: cursor-polled, real API event rows; never seeded with demo data ──
// The bootstrap request loads the newest rows and adopts the API cursor. Later
// requests fetch only newer rows, so stored history is never framed as new.
const liveDesk = {
  cursor: 0, timer: null, chime: false, audio: null, primed: false,
  paused: false, history: [], lastPollMs: null
};
function liveDeskBeep(freq) {
  if (!liveDesk.chime) return;
  try {
    if (!liveDesk.audio) liveDesk.audio = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = liveDesk.audio, oscillator = ctx.createOscillator(), gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = freq || 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.4);
  } catch (_) { /* Audio may be blocked or unavailable. */ }
}
function liveDeskEventTime(ev) {
  const raw = String(ev.createdUtc || ev.candleTime || '');
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}
// Stored event timestamps are UTC. Older rows include the date so history is
// not accidentally presented as a current signal.
function liveDeskTime(ev) {
  const ms = liveDeskEventTime(ev);
  if (ms == null) return 'Time unavailable';
  const d = new Date(ms), now = new Date();
  const p2 = n => String(n).padStart(2, '0');
  const hhmm = p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes());
  const today = d.getUTCFullYear() === now.getUTCFullYear()
    && d.getUTCMonth() === now.getUTCMonth()
    && d.getUTCDate() === now.getUTCDate();
  return today ? hhmm + ' UTC' : p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate()) + ' ' + hhmm + ' UTC';
}
function liveDeskRow(ev, animate = false) {
  const li = document.createElement('li');
  const stateName = String(ev.state || 'EVENT').toLowerCase();
  const tone = stateName === 'retest' || stateName === 'confirmed' ? 'violet'
    : stateName === 'sweep' || stateName === 'shift' ? 'amber' : '';
  li.className = \`event-row live-row live-\${stateName}\${animate ? ' live-event-enter' : ''}\`;
  li.innerHTML = '<time class="live-time">' + esc(liveDeskTime(ev)) + '</time>'
    + '<span class="event-tone ' + tone + '" aria-hidden="true"></span>'
    + '<span><strong>' + esc(ev.pair || 'Unknown pair') + ' <b>' + esc(ev.state || 'EVENT') + '</b></strong>'
    + '<small>' + esc(ev.reason || 'Recorded engine event') + '</small></span>'
    + '<span class="event-arrow" aria-hidden="true">↗</span>';
  return li;
}
function updateLiveDeskChart() {
  const now = Date.now();
  const rangeMs = 12 * 60 * 60 * 1000;
  const start = now - rangeMs;
  const timed = liveDesk.history
    .map(event => ({ event, time: liveDeskEventTime(event) }))
    .filter(row => row.time != null);
  const within = timed.filter(row => row.time >= start && row.time <= now);
  const counts = Array.from({ length: 12 }, () => 0);
  within.forEach(row => {
    const bin = Math.min(11, Math.max(0, Math.floor((row.time - start) / (60 * 60 * 1000))));
    counts[bin] += 1;
  });
  const line = $('liveLine'), band = $('liveBand');
  const status = $('liveChartStatus'), endLabel = $('chartEndLabel');
  const count12h = $('liveEventCount12h'), latest = $('liveUpdatedAt'), response = $('livePollMs');
  const max = Math.max(0, ...counts);
  if (line && band) {
    if (max === 0) {
      line.removeAttribute('d');
      band.removeAttribute('d');
    } else {
      const points = counts.map((count, index) => {
        const x = 8 + index * (584 / (counts.length - 1));
        const y = 194 - (count / max) * 148;
        return [x, y];
      });
      const d = points.map((point, index) => \`\${index ? 'L' : 'M'} \${point[0].toFixed(1)} \${point[1].toFixed(1)}\`).join(' ');
      line.setAttribute('d', d);
      band.setAttribute('d', \`\${d} L 592 210 L 8 210 Z\`);
    }
  }
  if (status) status.textContent = max ? 'LOADED ROWS' : (timed.length ? 'NO ROWS IN 12H' : 'NO TIMESTAMPED ROWS');
  if (endLabel) endLabel.textContent = max ? \`\${counts[11]} latest hour\` : 'No data';
  if (count12h) count12h.textContent = String(within.length);
  if (latest) {
    const newest = timed.sort((a, b) => b.time - a.time)[0];
    latest.textContent = newest ? liveDeskTime(newest.event) : '—';
  }
  if (response) response.textContent = liveDesk.lastPollMs == null ? '—' : \`\${liveDesk.lastPollMs} ms\`;
  if ($('liveEventCount')) $('liveEventCount').textContent = \`\${liveDesk.history.length} event rows in view\`;
}
async function liveDeskPoll(initial) {
  if (liveDesk.paused && !initial) return;
  const started = performance.now();
  try {
    const data = await api(initial
      ? '/api/recent-events?tail=1&limit=12'
      : '/api/recent-events?since=' + liveDesk.cursor + '&limit=50');
    const items = Array.isArray(data.items) ? data.items.slice() : [];
    const cursor = Number(data.cursor);
    if (Number.isFinite(cursor)) liveDesk.cursor = Math.max(liveDesk.cursor, cursor);
    const tape = $('liveTape');
    if (!tape) return;
    liveDesk.lastPollMs = Math.max(0, Math.round(performance.now() - started));
    if (initial) {
      liveDesk.history = items.slice(-500);
      tape.replaceChildren();
      items.slice().reverse().forEach(event => tape.appendChild(liveDeskRow(event)));
      if (!tape.children.length) tape.innerHTML = '<li class="live-empty">No structure events recorded in the returned history. The tape fills as scans record events.</li>';
      liveDesk.primed = true;
    } else if (items.length) {
      liveDesk.history.push(...items);
      if (liveDesk.history.length > 500) liveDesk.history.splice(0, liveDesk.history.length - 500);
      if (tape.querySelector('.live-empty')) tape.replaceChildren();
      items.slice().reverse().forEach(event => tape.insertBefore(liveDeskRow(event, true), tape.firstChild));
      while (tape.children.length > 30) tape.removeChild(tape.lastChild);
      // Only newly cursor-returned events can trigger a sound or brief visual cue.
      if (liveDesk.primed) {
        liveDeskBeep(items.some(event => event.state === 'RETEST' || event.state === 'SHIFT') ? 1046 : 784);
        const desk = $('liveDesk');
        if (desk) { desk.classList.remove('live-flash'); void desk.offsetWidth; desk.classList.add('live-flash'); }
      }
    }
    if (!liveDesk.primed) liveDesk.primed = true;
    if ($('liveDeskStatus')) $('liveDeskStatus').textContent = liveDesk.paused ? 'DISPLAY PAUSED' : 'READ-ONLY';
    updateLiveDeskChart();
  } catch (_) {
    if ($('liveDeskStatus')) $('liveDeskStatus').textContent = 'DATA UNAVAILABLE';
    if ($('liveChartStatus')) $('liveChartStatus').textContent = 'API UNAVAILABLE';
    if ($('liveTape') && !$('liveTape').children.length) {
      $('liveTape').innerHTML = '<li class="live-empty">Event feed unavailable; retrying automatically.</li>';
    }
  }
}
function liveDeskStart() {
  if (liveDesk.timer || !$('liveTape')) return;
  liveDeskPoll(true);
  liveDesk.timer = setInterval(() => {
    if (!document.hidden && !liveDesk.paused) liveDeskPoll(false);
  }, 15000);
}
if ($('tapePause')) $('tapePause').addEventListener('click', () => {
  liveDesk.paused = !liveDesk.paused;
  $('tapePause').setAttribute('aria-pressed', String(liveDesk.paused));
  $('tapePause').textContent = liveDesk.paused ? 'Resume display' : 'Pause display';
  $('tapePause').title = liveDesk.paused ? 'Resume display updates; the scanner continues.' : 'Pause this display only; the scanner continues.';
  if ($('liveDeskStatus')) $('liveDeskStatus').textContent = liveDesk.paused ? 'DISPLAY PAUSED' : 'READ-ONLY';
  if (!liveDesk.paused) liveDeskPoll(false);
});
if ($('liveChimeToggle')) $('liveChimeToggle').addEventListener('click', () => {
  liveDesk.chime = !liveDesk.chime;
  $('liveChimeToggle').textContent = liveDesk.chime ? 'Chime on' : 'Chime off';
  $('liveChimeToggle').setAttribute('aria-pressed', String(liveDesk.chime));
  if (liveDesk.chime) liveDeskBeep(880); // User gesture unlocks browser audio.
});
liveDeskStart();</script>
</body>
</html>
`;
