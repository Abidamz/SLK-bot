export const DASHBOARD_THEME_CSS = String.raw`@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Manrope:wght@400;500;600;700;800&display=swap');

:root{--bg:#080b0e;--surface:#0e1318;--surface-2:#121920;--surface-3:#17212a;--line:rgba(181,209,224,.14);--line-strong:rgba(181,209,224,.23);--text:#eef5f7;--muted:#82919b;--subtle:#53636d;--cyan:#62e6ff;--cyan-soft:rgba(98,230,255,.11);--green:#71edaf;--amber:#ffcc70;--red:#ff7d83;--violet:#a89cff;--radius:16px;--mono:'DM Mono',ui-monospace,SFMono-Regular,Consolas,monospace;--sans:'Manrope',ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;--ease:cubic-bezier(.23,1,.32,1)}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:radial-gradient(circle at 85% 0%,rgba(35,69,83,.15),transparent 34rem),var(--bg);color:var(--text);font-family:var(--sans);font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased}body:before{content:'';position:fixed;inset:0;pointer-events:none;opacity:.18;background-image:linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.025) 1px,transparent 1px);background-size:72px 72px;mask-image:linear-gradient(to bottom,black,transparent 86%)}a{color:inherit;text-decoration:none}button,input{font:inherit}button{color:inherit;border:0;cursor:pointer}.app-shell{max-width:1480px;margin:auto;padding:0 34px}.topbar{position:sticky;top:0;z-index:40;height:86px;display:flex;align-items:center;gap:24px;border-bottom:1px solid var(--line);background:rgba(8,11,14,.97);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}.brand{display:flex;align-items:center;gap:11px;min-width:156px}.brand-mark{display:block;flex:0 0 28px;width:28px;height:28px;object-fit:contain;padding:0;border:1px solid rgba(98,230,255,.45);border-radius:5px;background:#000;box-shadow:0 0 18px rgba(98,230,255,.13)}.brand-mark i{display:block;width:4px;background:var(--cyan);transform:skewY(16deg)}.brand-mark i:nth-child(1){height:7px}.brand-mark i:nth-child(2){height:12px}.brand-mark i:nth-child(3){height:17px}.brand-copy{display:flex;flex-direction:column;line-height:1}.brand-copy strong{font-size:15px;letter-spacing:.14em}.brand-copy small{color:var(--muted);font-size:10px;letter-spacing:.08em;margin-top:4px}.product-line{color:var(--muted);font-family:var(--mono);font-size:11px;letter-spacing:.05em}.product-line span{color:var(--cyan);margin:0 5px}.topbar-actions{margin-left:auto;display:flex;align-items:center;gap:20px}.mode-switch,.segment-switch{display:flex;border:1px solid var(--line);background:rgba(13,18,23,.82);padding:3px;border-radius:8px}.mode-button,.segment-button{background:transparent;color:var(--muted);padding:9px 12px;border-radius:5px;font-size:11px;transition:background .18s var(--ease),color .18s var(--ease),transform .12s ease}.mode-button.is-active,.segment-button.is-active{color:var(--text);background:var(--surface-3);box-shadow:0 1px 0 rgba(255,255,255,.04)}.mode-button:hover,.segment-button:hover{color:var(--text)}.mode-button:active,.segment-button:active,.button:active{transform:scale(.97)}.text-link{color:var(--cyan);font-size:12px;font-weight:700;white-space:nowrap}.text-link span{font-size:15px;margin-left:4px}.status-rail{display:flex;align-items:center;gap:0;border-bottom:1px solid var(--line);min-height:67px}.status-item{display:flex;align-items:center;gap:9px;padding:0 22px;border-right:1px solid var(--line);min-height:31px}.status-item:first-child{padding-left:0}.status-item b,.status-item small{display:block}.status-item b{font-family:var(--mono);font-size:10px;font-weight:500;color:var(--text)}.status-item small{font-size:10px;color:var(--muted);margin-top:2px}.status-dot{width:7px;height:7px;border-radius:50%;display:inline-block;background:var(--subtle);box-shadow:0 0 0 4px rgba(83,99,109,.1)}.status-dot.online{background:var(--green);box-shadow:0 0 0 4px rgba(113,237,175,.1)}.status-icon{font-family:var(--mono);font-size:15px;color:var(--cyan)}.warning .status-icon{color:var(--amber)}.safety-lock{margin-left:auto;font-family:var(--mono);font-size:10px;letter-spacing:.06em;color:var(--amber);border:1px solid rgba(255,204,112,.23);background:rgba(255,204,112,.06);padding:9px 12px;border-radius:6px}.safety-lock span{margin-right:7px}.section-grid{max-width:1200px;margin-left:auto;margin-right:auto}.hero{display:grid;grid-template-columns:minmax(0,1.12fr) minmax(390px,.88fr);gap:74px;padding-top:87px;padding-bottom:86px}.eyebrow{font-family:var(--mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--cyan);margin:0 0 17px}.eyebrow-rule{display:inline-block;width:27px;height:1px;background:var(--cyan);vertical-align:middle;margin:0 8px 3px 0}.hero h1,.section-heading h2,.provenance h2,.vip h2{font-size:clamp(42px,5.25vw,78px);line-height:.98;letter-spacing:-.065em;margin:0;font-weight:700}.hero h1 em,.section-heading h2 em,.provenance h2 em,.vip h2 em{font-style:normal;color:var(--cyan)}.hero-text{max-width:610px;color:#a9b5bb;font-size:17px;line-height:1.7;margin:27px 0 28px}.hero-actions{display:flex;gap:11px;align-items:center}.button{display:inline-flex;align-items:center;gap:12px;background:transparent;border:1px solid var(--line-strong);border-radius:7px;color:var(--text);padding:12px 16px;font-size:12px;font-weight:700;transition:background .18s var(--ease),border-color .18s var(--ease),color .18s var(--ease),transform .12s ease}.button:hover{border-color:rgba(98,230,255,.62);background:var(--cyan-soft)}.button-primary{color:#041014;background:var(--cyan);border-color:var(--cyan);box-shadow:0 0 22px rgba(98,230,255,.11)}.button-primary:hover{background:#a1f1ff;border-color:#a1f1ff}.button-quiet{border-color:transparent;color:var(--muted)}.button-quiet:hover{border-color:var(--line);color:var(--text);background:var(--surface)}.button-small{padding:9px 12px;font-size:10px}.button-outline{color:var(--cyan)}.disclaimer{max-width:600px;color:var(--muted);font-size:11px;line-height:1.55;margin:31px 0 0}.inline-alert{display:inline-grid;place-items:center;width:16px;height:16px;border:1px solid var(--amber);color:var(--amber);border-radius:50%;font-family:var(--mono);font-size:10px;margin-right:4px}.hero-pulse{position:relative;align-self:center;background:linear-gradient(145deg,rgba(22,32,40,.95),rgba(10,14,18,.9));border:1px solid var(--line);border-radius:var(--radius);padding:20px 21px;box-shadow:0 25px 80px rgba(0,0,0,.28)}.hero-pulse:before{content:'';position:absolute;inset:-1px;border-radius:inherit;border:1px solid rgba(98,230,255,.07);pointer-events:none}.pulse-header,.pulse-footer,.panel-head,.panel-foot,.chart-title{display:flex;align-items:center;justify-content:space-between;font-family:var(--mono);font-size:10px;color:var(--muted);letter-spacing:.07em}.pulse-live,.panel-status{color:var(--green);font-size:9px}.pulse-live i,.panel-status i{display:inline-block;width:5px;height:5px;background:currentColor;border-radius:50%;margin-right:5px}.pulse-graph{height:270px;position:relative;margin:18px -1px 13px;overflow:hidden}.graph-grid{position:absolute;inset:0;background-image:linear-gradient(rgba(181,209,224,.08) 1px,transparent 1px),linear-gradient(90deg,rgba(181,209,224,.08) 1px,transparent 1px);background-size:20% 25%}.pulse-graph svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}.pulse-graph .fill{fill:url(#pulseFill)}.pulse-graph .line{fill:none;stroke:var(--cyan);stroke-width:2}.pulse-graph circle{fill:var(--cyan)}.pulse-graph .glow-dot{fill:none;stroke:var(--cyan);stroke-width:1;opacity:.4}.graph-labels{position:absolute;left:0;right:0;bottom:7px;display:flex;justify-content:space-between;color:var(--subtle);font:9px var(--mono)}.pulse-footer{border-top:1px solid var(--line);padding-top:15px;letter-spacing:0}.pulse-footer strong{color:var(--text);font-weight:400}.section-tabs{max-width:1200px;margin:0 auto;border-top:1px solid var(--line);border-bottom:1px solid var(--line);display:flex;gap:28px;overflow-x:auto;scrollbar-width:none}.section-tabs::-webkit-scrollbar{display:none}.section-tab{position:relative;background:transparent;color:var(--muted);padding:17px 0;white-space:nowrap;font-size:12px}.section-tab:after{content:'';position:absolute;left:0;right:0;bottom:-1px;height:2px;background:transparent}.section-tab.is-active{color:var(--text)}.section-tab.is-active:after{background:var(--cyan)}.tab-count{color:var(--cyan);font:10px var(--mono);margin-left:4px}.overview,.lifecycle,.provenance,.ledger-preview,.quant{padding-top:83px}.section-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;margin-bottom:30px}.section-heading h2{font-size:clamp(31px,4vw,52px)}.section-note{color:var(--muted);font:10px var(--mono);white-space:nowrap}.section-note .status-dot{margin-right:7px}.segment-switch{width:max-content;margin-bottom:21px}.segment-button{display:flex;align-items:center;gap:8px}.segment-button span{color:var(--cyan);font-size:14px}.segment-button b{font:10px var(--mono);color:var(--subtle);font-weight:400}.metric-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.metric-card{position:relative;min-height:161px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:18px;overflow:hidden}.metric-card.featured{background:linear-gradient(145deg,rgba(22,50,60,.82),rgba(14,19,24,.95));border-color:rgba(98,230,255,.29)}.metric-card:after{content:'';position:absolute;inset:auto 0 0;height:3px;background:linear-gradient(90deg,transparent,var(--cyan),transparent);opacity:.1}.metric-top{display:flex;justify-content:space-between;align-items:center;color:var(--muted);font-size:11px}.metric-tag,.metric-symbol{font:9px var(--mono);color:var(--cyan)}.metric-card strong{display:block;font:500 38px var(--mono);letter-spacing:-.08em;margin:21px 0 1px}.metric-card small{font-size:10px;color:var(--muted)}.metric-spark{height:25px;position:absolute;bottom:18px;left:18px;right:18px;opacity:.8}.line-spark:before{content:'';position:absolute;inset:10px 0 0;background:linear-gradient(145deg,transparent 32%,rgba(98,230,255,.5) 33% 36%,transparent 37% 48%,rgba(98,230,255,.2) 49% 51%,transparent 52% 70%,rgba(98,230,255,.55) 71% 74%,transparent 75%)}.bar-spark{background:repeating-linear-gradient(90deg,rgba(98,230,255,.08) 0 4px,transparent 4px 9px);mask-image:linear-gradient(to right,transparent,black)}.dot-spark:before{content:'•  •   • •     •   •';letter-spacing:12px;color:var(--cyan);font:18px var(--mono);opacity:.45}.muted-spark{border-top:1px dashed var(--subtle);top:auto;bottom:30px;height:1px}.segment-detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}.segment-card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:20px}.segment-title{display:flex;gap:12px;align-items:flex-start}.segment-icon{display:grid;place-items:center;width:31px;height:31px;border-radius:8px;font-size:16px}.segment-icon.blue{background:rgba(98,230,255,.1);color:var(--cyan)}.segment-icon.violet{background:rgba(168,156,255,.1);color:var(--violet)}.segment-title h3{font-size:13px;margin:1px 0 4px}.segment-title p{font-size:10px;color:var(--muted);margin:0}.card-arrow{margin-left:auto;color:var(--subtle)}.segment-kpis{display:grid;grid-template-columns:repeat(4,1fr);border-top:1px solid var(--line);margin-top:20px;padding-top:15px}.segment-kpis span{display:flex;flex-direction:column;gap:3px}.segment-kpis b{font:13px var(--mono);font-weight:500}.segment-kpis small{font-size:9px;color:var(--muted)}.lifecycle-card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:30px;display:grid;grid-template-columns:1.4fr .95fr;gap:36px}.lifecycle-rail{display:flex;justify-content:space-between;position:relative;gap:4px;padding-top:3px}.rail-line{height:1px;background:linear-gradient(90deg,var(--cyan),var(--line));position:absolute;left:18px;right:18px;top:17px}.stage{position:relative;background:transparent;display:flex;flex-direction:column;align-items:center;gap:8px;color:var(--subtle);min-width:45px;padding:0 2px}.stage-node{display:grid;place-items:center;width:30px;height:30px;border:1px solid var(--line-strong);border-radius:50%;background:var(--surface);font:9px var(--mono);transition:background .18s var(--ease),border-color .18s var(--ease),color .18s var(--ease),transform .18s var(--ease)}.stage b{font:10px var(--mono);font-weight:500}.stage small{font-size:9px;white-space:nowrap}.stage.is-active{color:var(--cyan)}.stage.is-active .stage-node{background:var(--cyan);border-color:var(--cyan);color:#051015;box-shadow:0 0 0 5px rgba(98,230,255,.12);transform:translateY(-2px)}.lifecycle-detail{border-left:1px solid var(--line);padding:3px 0 3px 28px}.lifecycle-detail h3{font-size:17px;margin:0 0 11px}.lifecycle-detail p:not(.eyebrow){font-size:12px;color:var(--muted);line-height:1.7;margin:0}.rule-line{border-top:1px solid var(--line);border-bottom:1px solid var(--line);margin:19px 0;padding:13px 0;display:flex;flex-direction:column;gap:3px}.rule-line span{font:9px var(--mono);color:var(--cyan);text-transform:uppercase}.rule-line strong{font-size:11px;font-weight:600}.detail-actions{display:flex;align-items:center;gap:12px}.sim-tag{font:9px var(--mono);color:var(--amber)}.provenance{display:grid;grid-template-columns:.72fr 1.28fr;gap:80px;padding-bottom:86px}.provenance h2{font-size:clamp(34px,4vw,55px)}.provenance-copy>p:not(.eyebrow){color:var(--muted);font-size:12px;line-height:1.7;max-width:350px;margin:23px 0}.provenance-panel{align-self:center;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:23px}.panel-head{padding-bottom:19px;border-bottom:1px solid var(--line)}.universe-row{display:grid;grid-template-columns:repeat(3,1fr);padding:23px 0;border-bottom:1px solid var(--line)}.universe-row strong{display:block;font:500 28px var(--mono);letter-spacing:-.07em}.universe-row span{display:block;color:var(--muted);font-size:10px;margin-top:3px}.scanner-list{display:flex;flex-wrap:wrap;gap:7px;padding:20px 0}.scanner-list span{font:9px var(--mono);border:1px solid var(--line);border-radius:4px;padding:6px 8px;color:#b5c2c8}.panel-foot{border-top:1px solid var(--line);padding-top:15px;font-size:9px;letter-spacing:0}.ledger-preview{border-top:1px solid var(--line);padding-bottom:83px}.ledger-table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface)}table{border-collapse:collapse;width:100%;min-width:780px;text-align:left}th{font:9px var(--mono);font-weight:400;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;background:var(--surface-2);padding:13px 15px;border-bottom:1px solid var(--line)}td{padding:0 15px}.empty-state{text-align:center;padding:58px 18px 65px}.empty-mark{display:grid;place-items:center;width:40px;height:40px;margin:0 auto 15px;border:1px dashed var(--subtle);border-radius:50%;color:var(--muted);font-size:18px}.empty-state strong{display:block;font-size:14px}.empty-state p{max-width:400px;color:var(--muted);font-size:11px;line-height:1.6;margin:8px auto 19px}.vip{padding-bottom:84px}.vip-card{display:grid;grid-template-columns:1.2fr .8fr;gap:40px;align-items:center;background:linear-gradient(120deg,rgba(22,51,60,.85),rgba(15,20,25,.98));border:1px solid rgba(98,230,255,.25);border-radius:20px;padding:38px 42px;overflow:hidden;position:relative}.vip-card:after{content:'DEO';position:absolute;right:-14px;bottom:-54px;color:rgba(98,230,255,.035);font:800 190px var(--sans);letter-spacing:-.12em;pointer-events:none}.vip h2{font-size:clamp(34px,4vw,56px)}.vip-copy>p:not(.eyebrow){color:#aebbc0;max-width:530px;font-size:12px;line-height:1.7;margin:19px 0}.vip-points{display:flex;gap:25px}.vip-points span{font-size:10px;color:var(--muted);display:flex;flex-direction:column;gap:3px}.vip-points b{color:var(--text);font:500 14px var(--mono)}.vip-action{justify-self:end;min-width:225px;position:relative;z-index:1}.price small,.price label{display:block;color:var(--muted);font-size:10px}.price strong{display:block;font:500 42px var(--mono);letter-spacing:-.09em;margin:4px 0}.price strong span{font:11px var(--mono);letter-spacing:0;color:var(--muted);margin-left:5px}.price label{text-decoration:line-through}.vip-action .button{margin-top:17px;width:100%;justify-content:center}.code-button{display:flex;align-items:center;justify-content:center;gap:8px;background:transparent;color:var(--muted);font:10px var(--mono);width:100%;padding:12px 0}.code-button strong{color:var(--cyan);font-weight:500}.micro-note{color:var(--subtle);font-size:9px;text-align:center;display:block}.quant{padding-bottom:100px}.quant-card{display:grid;grid-template-columns:.78fr 1.22fr;gap:35px;padding:27px 29px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius)}.quant-form>p{color:var(--muted);font-size:11px;line-height:1.65;margin:0 0 22px}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:11px;margin-bottom:18px}.form-grid label{position:relative;color:var(--muted);font:9px var(--mono);text-transform:uppercase}.form-grid input{display:block;width:100%;margin-top:7px;background:var(--surface-2);border:1px solid var(--line);border-radius:5px;padding:10px;color:var(--text);font:11px var(--mono);outline:none}.form-grid input:focus{border-color:var(--cyan);box-shadow:0 0 0 3px rgba(98,230,255,.09)}.input-suffix{position:absolute;right:10px;bottom:10px;color:var(--cyan);font:11px var(--mono)}.run-feedback{color:var(--amber)!important;font:9px var(--mono)!important;margin:14px 0 0!important}.quant-chart{position:relative;min-height:250px;border-left:1px solid var(--line);padding-left:26px}.chart-title{margin-bottom:16px;letter-spacing:0}.chart-title span:first-child{color:var(--text)}.legend-cyan{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--cyan);margin-right:5px}.quant-chart svg{width:100%;height:190px}.chart-band{fill:rgba(98,230,255,.1)}.chart-path{fill:none;stroke:var(--cyan);stroke-width:2;stroke-dasharray:5 5;opacity:.6}.quant-chart line{stroke:var(--line-strong)}.chart-empty{position:absolute;left:26px;right:0;bottom:4px;text-align:center;color:var(--subtle);font:9px var(--mono)}.footer{border-top:1px solid var(--line);padding:25px 0 38px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;color:var(--muted);font-size:10px}.footer-brand{display:flex;align-items:center;gap:8px;color:var(--text)}.footer-brand strong{font-size:12px}.footer-brand span{color:var(--subtle)}.brand-mark.small{flex-basis:17px;width:17px;height:17px;padding:0;border-radius:3px}.brand-mark.small i{width:3px}.brand-mark.small i:nth-child(1){height:5px}.brand-mark.small i:nth-child(2){height:9px}.brand-mark.small i:nth-child(3){height:13px}.footer-meta{display:flex;gap:14px;margin-left:auto;font:9px var(--mono)}.footer-meta a{color:var(--muted)}.footer>p{width:100%;margin:6px 0 0;color:var(--subtle);font:9px var(--mono)}.tab-panel{display:none}.tab-panel.is-visible{display:block}@media(max-width:1100px){.app-shell{padding:0 22px}.status-item{padding:0 12px}.status-item:nth-child(3){display:none}.hero{gap:38px}.lifecycle-card{grid-template-columns:1fr}.lifecycle-detail{border-left:0;border-top:1px solid var(--line);padding:24px 0 0}.provenance{gap:35px}}@media(max-width:780px){body{font-size:13px}.app-shell{padding:0 16px}.topbar{height:auto;min-height:75px;flex-wrap:wrap;padding:15px 0;gap:12px}.product-line{order:3;width:100%;font-size:10px}.topbar-actions{gap:10px}.topbar-actions .text-link{display:none}.mode-button{padding:8px 9px;font-size:10px}.status-rail{overflow:auto;margin:0 -16px;padding:0 16px;min-height:61px}.status-item{min-width:max-content;padding:0 14px}.status-item:first-child{padding-left:0}.status-item:nth-child(4){display:none}.safety-lock{margin-left:14px;min-width:max-content;font-size:9px}.hero{display:block;padding-top:63px;padding-bottom:62px}.hero h1{font-size:clamp(45px,13vw,67px)}.hero-text{font-size:15px}.hero-pulse{margin-top:44px}.section-tabs{margin:0 -16px;padding:0 16px;gap:25px}.section-heading{align-items:flex-start;flex-direction:column;margin-bottom:23px}.section-note{white-space:normal}.overview,.lifecycle,.provenance,.ledger-preview,.quant{padding-top:62px}.segment-switch{width:100%;overflow:auto}.segment-button{white-space:nowrap;padding:8px 9px}.metric-grid{grid-template-columns:1fr 1fr}.metric-card{min-height:147px;padding:15px}.metric-card strong{font-size:30px;margin-top:17px}.segment-detail-grid{grid-template-columns:1fr}.lifecycle-card{padding:22px 18px}.lifecycle-rail{display:grid;grid-template-columns:repeat(4,1fr);row-gap:23px}.rail-line{display:none}.stage small{font-size:8px}.provenance{display:block;padding-bottom:62px}.provenance-panel{margin-top:32px}.vip-card{grid-template-columns:1fr;padding:30px 25px;gap:28px}.vip-action{justify-self:stretch}.quant-card{grid-template-columns:1fr;padding:22px 18px}.quant-chart{border-left:0;border-top:1px solid var(--line);padding:23px 0 0;margin-top:8px}.chart-empty{left:0}.footer{display:block}.footer-meta{margin:17px 0;flex-wrap:wrap}.footer>p{margin-top:15px}}@media(max-width:390px){.hero-actions{display:grid}.hero-actions .button{justify-content:center}.metric-grid{gap:7px}.metric-card small{font-size:9px}.segment-kpis{gap:8px}.segment-kpis b{font-size:11px}.lifecycle-rail{grid-template-columns:repeat(3,1fr)}.stage small{white-space:normal;text-align:center}.vip-points{gap:12px}.vip-points b{font-size:12px}}@media(prefers-reduced-motion:reduce){*,*:before,*:after{scroll-behavior:auto!important;transition-duration:.01ms!important;animation-duration:.01ms!important;animation-iteration-count:1!important}}


.live-desk{padding-bottom:96px}.live-desk-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.event-tape,.micro-chart-card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:20px}.tape-head{display:flex;align-items:center;justify-content:space-between;color:var(--muted);font:10px var(--mono);letter-spacing:.07em;padding-bottom:15px;border-bottom:1px solid var(--line)}.tape-head>div{display:flex;align-items:center;gap:10px}.tape-control,.text-button{background:transparent;color:var(--cyan);font:10px var(--mono);padding:0}.event-list{min-height:183px}.event-row{display:grid;grid-template-columns:62px 8px 1fr auto;align-items:center;gap:10px;padding:13px 0;border-bottom:1px solid var(--line)}.event-row time{color:var(--subtle);font:9px var(--mono)}.event-tone{width:6px;height:6px;border-radius:50%;background:var(--cyan);box-shadow:0 0 0 4px rgba(98,230,255,.09)}.event-tone.violet{background:var(--violet);box-shadow:0 0 0 4px rgba(168,156,255,.09)}.event-tone.amber{background:var(--amber);box-shadow:0 0 0 4px rgba(255,204,112,.09)}.event-row strong{display:block;font:11px var(--mono);font-weight:500}.event-row strong b{color:var(--cyan);font-size:9px;font-weight:400;margin-left:5px}.event-row small{display:block;color:var(--muted);font-size:10px;margin-top:3px}.event-arrow{color:var(--subtle)}.event-enter{animation:eventIn .24s var(--ease)}@keyframes eventIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}.tape-foot{display:flex;justify-content:space-between;color:var(--subtle);font:9px var(--mono);padding-top:15px}.micro-chart{height:220px;position:relative;margin-top:18px;border:1px solid var(--line);background:var(--surface-2);overflow:hidden}.micro-grid{position:absolute;inset:0;background-image:linear-gradient(rgba(181,209,224,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(181,209,224,.07) 1px,transparent 1px);background-size:20% 25%}.micro-chart svg{position:absolute;inset:0;width:100%;height:100%}.micro-chart .chart-path{stroke:var(--green);stroke-dasharray:none;opacity:.85}.micro-chart .chart-band{fill:rgba(113,237,175,.08)}.chart-end-label{position:absolute;right:10px;top:10px;color:var(--green);font:9px var(--mono)}.freshness-row{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding-top:15px;color:var(--muted);font:9px var(--mono)}.freshness-row b{color:var(--text);font-weight:500;margin-right:3px}.micro-chart-card .panel-status{letter-spacing:0}@media(max-width:780px){.live-desk{padding-bottom:62px}.live-desk-grid{grid-template-columns:1fr}.event-tape,.micro-chart-card{padding:17px}.micro-chart{height:190px}.event-list{min-height:0}.freshness-row{gap:5px;font-size:8px}}

.brand:focus-visible{outline:2px solid var(--cyan);outline-offset:4px;border-radius:8px}
.tab-panel,#ledger,#vip{scroll-margin-top:110px}
@media(max-width:780px){.tab-panel,#ledger,#vip{scroll-margin-top:135px}}


/* Production integration: retain the 4175 design system while skinning the live product controls. */
:root {
  --panel: var(--surface);
  --panel2: var(--surface-2);
  --accent: var(--cyan);
  --blue: var(--cyan);
  --danger: var(--red);
  --success: var(--green);
  --radius: 16px;
}

html { scroll-padding-top: 110px; }
[hidden] { display: none !important; }
button, input, select, textarea { font: inherit; }
button { color: inherit; cursor: pointer; }

.skip-link {
  position: fixed; top: 8px; left: 8px; z-index: 120;
  transform: translateY(-160%); padding: 10px 14px; border-radius: 8px;
  background: var(--cyan); color: #041014; font-weight: 750;
}
.skip-link:focus-visible { transform: translateY(0); }
.sr-only {
  position: absolute !important; width: 1px !important; height: 1px !important;
  padding: 0 !important; margin: -1px !important; overflow: hidden !important;
  clip: rect(0, 0, 0, 0) !important; white-space: nowrap !important; border: 0 !important;
}

.status-rail { min-width: 0; }
.status-item { min-width: 0; }
.status-item .status-dot { flex: 0 0 7px; }
.status-item .status-dot.checking { background: var(--amber); }
.status-item .status-dot.bad { background: var(--red); }
.status-item .status-dot.ok { background: var(--green); }
.status-item small { line-height: 1.35; }
.safety-lock { white-space: nowrap; }
.topbar { scroll-margin-top: 0; }

.section-tabs { scroll-margin-top: 92px; }
.section-tab { min-height: 48px; cursor: pointer; }
.section-tab:focus-visible, .mode-button:focus-visible, .segment-button:focus-visible,
.stage:focus-visible, .tape-control:focus-visible, .text-button:focus-visible,
.button:focus-visible {
  outline: 3px solid var(--cyan); outline-offset: 4px;
}
.section-tab.is-active { color: var(--text); }
.section-tab.is-active:after { background: var(--cyan); }
.tab-panel { min-width: 0; }
.tab-panel[hidden] { display: none !important; }
.tab-panel.is-visible { display: block; }
.tab-panel:focus { outline: none; }
.tab-panel, #vip, #ledger { scroll-margin-top: 110px; }

/* Real API-backed metrics reuse the reference cards without demo figures. */
.metric-card { min-width: 0; }
.metric-card strong { font-variant-numeric: tabular-nums; }
.metric-card .metric-tag, .metric-card .metric-symbol { white-space: nowrap; }
.metric-card small { display: block; }
.metric-card .metric-spark[aria-hidden="true"] { pointer-events: none; }
.segment-detail-grid { align-items: stretch; }
.segment-card { cursor: pointer; text-align: left; transition: border-color .18s var(--ease), background .18s var(--ease), box-shadow .18s var(--ease); }
.segment-card:focus-visible { outline: 3px solid var(--cyan); outline-offset: 4px; }
.segment-card.is-active { border-color: rgba(98,230,255,.62); box-shadow: 0 0 0 1px rgba(98,230,255,.15); }
.segment-card.deriv-card.is-active { border-color: rgba(168,156,255,.7); box-shadow: 0 0 0 1px rgba(168,156,255,.14); }
.segment-button { min-height: 44px; white-space: nowrap; }
.segment-button[aria-pressed="true"] { color: var(--text); background: var(--surface-3); box-shadow: 0 1px 0 rgba(255,255,255,.04); }

/* Method rail and the full rule table stay available without crowding the hero. */
.lifecycle-card { min-width: 0; }
.lifecycle-rail { min-width: 0; }
.stage { border: 0; font: inherit; cursor: pointer; }
.stage.is-active { color: var(--cyan); }
.stage[aria-pressed="true"] .stage-node { background: var(--cyan); border-color: var(--cyan); color: #051015; box-shadow: 0 0 0 5px rgba(98,230,255,.12); transform: translateY(-2px); }
.lifecycle-detail { min-width: 0; }
.lifecycle-detail .eyebrow { margin-bottom: 10px; }
.rule-reference { margin-top: 18px; border-top: 1px solid var(--line); padding-top: 12px; }
.rule-reference summary { color: var(--cyan); font: 10px var(--mono); cursor: pointer; }
.rule-reference[open] { padding-bottom: 8px; }
.lifecycle-table-wrap { max-width: 100%; overflow-x: auto; }
.lifecycle-table { min-width: 610px; }
.confirmation-checklist { margin-top: 18px; }

/* Status and provenance readouts are populated from /health and /api/engine-pulse. */
.provenance { min-width: 0; }
.provenance-panel { min-width: 0; }
.universe-row { gap: 12px; }
.universe-row > div { min-width: 0; }
.universe-row strong { font-variant-numeric: tabular-nums; }
.scanner-list { min-height: 38px; }
.scanner-list span { overflow-wrap: anywhere; }
.panel-status { white-space: nowrap; }
.panel-foot { gap: 12px; flex-wrap: wrap; }
.engine-pulse { min-width: 0; margin: 26px auto 0; }
.engine-pulse .panel-head { margin-bottom: 12px; }
.engine-pulse-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.engine-pulse-stat { min-width: 0; }
.engine-pulse-stat strong { font-variant-numeric: tabular-nums; }
.engine-pulse .chart-disclaimer { color: var(--muted) !important; }

/* Preserve the full existing performance controls and ledger actions. */
.performance { min-width: 0; }
.performance .period-date-bar { background: var(--surface-2) !important; border-color: var(--line) !important; }
.performance .market-segment-bar { width: max-content; max-width: 100%; overflow-x: auto; }
.performance .segment-btn { white-space: nowrap; }
.period-btn {
  min-height: 40px; padding: 8px 12px; border: 1px solid var(--line);
  border-radius: 999px; background: transparent; color: var(--muted);
  font: 10px var(--mono); cursor: pointer;
  transition: color .18s var(--ease), background .18s var(--ease), border-color .18s var(--ease);
}
.period-btn.active { border-color: rgba(98,230,255,.45); background: var(--cyan-soft); color: var(--cyan); }
.performance .metric-grid { margin: 18px 0; }
.performance .metric { min-height: 145px; padding: 18px; border-radius: var(--radius); background: var(--surface); border-color: var(--line); }
.performance .metric > span { color: var(--muted); font-size: 11px; }
.performance .metric strong { display: block; margin: 20px 0 2px; color: var(--text); font: 500 30px var(--mono); letter-spacing: -.06em; }
.performance .metric small { color: var(--muted); font-size: 10px; }
.breakdown-list { display: grid; gap: 8px; }
.breakdown-row { display: grid; grid-template-columns: minmax(120px, 1fr) minmax(150px, 1fr) minmax(150px, auto); gap: 12px; align-items: center; padding: 14px; border: 1px solid var(--line); border-radius: 9px; background: var(--surface-2); }
.breakdown-row > * { min-width: 0; overflow-wrap: anywhere; }

/* The journal uses real alert rows; no preview-only sample trades are inserted. */
#alerts { min-width: 0; }
#alerts .panel-head { margin-bottom: 18px; }
.filter-bar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
.filter-bar select, .filter-bar input, .date-filter-group input {
  min-height: 42px; border: 1px solid var(--line); border-radius: 6px;
  background: var(--surface-2); color: var(--text); padding: 9px 10px;
}
.filter-bar input { min-width: 150px; }
.filter-bar button, .pagination button, .preference-actions button { min-height: 44px; }
.alert-list { display: grid; gap: 8px; }
.alert-row {
  display: grid; grid-template-columns: 1.1fr .7fr .7fr .8fr; gap: 12px; align-items: center;
  min-width: 0; padding: 14px; border: 1px solid var(--line); border-radius: 9px;
  background: var(--surface); color: var(--text) !important; text-align: left; cursor: pointer;
  transition: border-color .18s var(--ease), background .18s var(--ease);
}
.alert-row strong, .alert-row .alert-pair, .alert-row .alert-val { color: var(--text) !important; overflow-wrap: anywhere; }
.alert-row small, .alert-row .alert-meta { color: var(--muted) !important; }
.pagination { display: flex; justify-content: center; align-items: center; gap: 14px; margin-top: 18px; color: var(--muted); font-size: 11px; }

/* Health, channel settings, and private audit remain native, working controls. */
#health .panel, #preferences .panel { margin-bottom: 14px; }
.health-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.health-item { min-width: 0; padding: 14px; border: 1px solid var(--line); border-radius: 9px; background: var(--surface-2); }
.health-item span { color: var(--muted); font: 9px var(--mono); }
.health-item strong { overflow-wrap: anywhere; font-size: 12px; }
.preference-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.preference-card { min-width: 0; padding: 17px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface-2); }
.preference-card h3 { color: var(--text); }
.preference-footer { gap: 14px; flex-wrap: wrap; }
.preference-actions { display: flex; flex-wrap: wrap; gap: 8px; }
#scanAuditResults { max-height: 480px; overflow: auto; }

/* VIP sign-up is real; the 4175 mock pricing/seat counters are deliberately not reproduced. */
#waitlistCard {
  position: relative; overflow: hidden; margin-top: 24px; padding: 30px;
  border: 1px solid rgba(98,230,255,.25); border-radius: 20px;
  background: linear-gradient(120deg, rgba(22,51,60,.85), rgba(15,20,25,.98)); box-shadow: none;
}
#waitlistCard .waitlist-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; }
#waitlistCard .waitlist-perks { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 22px 0; }
#waitlistCard .waitlist-perk { min-width: 0; padding: 14px; border: 1px solid var(--line); border-radius: 9px; background: rgba(8,11,14,.55); }
#waitlistCard .waitlist-form-grid { display: grid; grid-template-columns: 1.1fr 1fr 1fr auto; gap: 8px; }
#waitlistCard input, #waitlistCard select { min-width: 0; min-height: 44px; border-radius: 6px; background: var(--surface-2) !important; border-color: var(--line) !important; color: var(--text) !important; }
#waitlistCard .waitlist-submit-btn { min-height: 44px; border-radius: 7px; background: var(--cyan); color: #041014; font-weight: 750; }
#waitlistCard > p, #waitlistCard .waitlist-header p { color: var(--muted) !important; }

/* Real Monte Carlo controls use the reference two-column Quant Lab composition. */
#quantLab { margin: 0; padding: 0 0 82px; border: 0; border-radius: 0; background: transparent; box-shadow: none; }
#quantLab .panel-head { display: none; }
#quantLab .quant-heading { display: flex; }
.quant-card { display: grid; grid-template-columns: minmax(300px, .8fr) minmax(0, 1.2fr); gap: 28px; padding: 26px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); }
.quant-form, .quant-chart { min-width: 0; }
.quant-form > p { color: var(--muted); font-size: 11px; line-height: 1.65; }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: 14px 0; }
.mc-input, .form-grid label { min-width: 0; color: var(--muted); font: 9px var(--mono); }
.mc-input input, .form-grid input { width: 100%; min-width: 0; min-height: 42px; margin-top: 6px; padding: 10px; border: 1px solid var(--line); border-radius: 5px; background: var(--surface-2); color: var(--text); font: 11px var(--mono); }
.mc-controls { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.mc-controls button { min-height: 44px; grid-column: 1 / -1; }
#mcStatus { margin: 12px 0 !important; color: var(--amber) !important; font: 9px var(--mono) !important; }
#mcCards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
#mcCards .risk-card { min-width: 0; }
.quant-chart { position: relative; min-height: 260px; border-left: 1px solid var(--line); padding-left: 24px; }
.quant-chart .chart-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 9px; background: var(--surface-2); }
.quant-chart svg { width: 100%; min-width: 520px; height: 230px; }
.mc-chart-legend { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 10px; color: var(--muted); font-size: 9px; }
.mc-verdict { margin-top: 16px; border-top: 1px solid var(--line); padding-top: 14px; }
.mc-verdict h3 { color: var(--text); font-size: 13px; }
.mc-verdict .lifecycle-table { min-width: 520px; }
#pvWrap { overflow-x: auto; }

/* The live tape and chart are driven only by the real recent-events/engine-pulse endpoints. */
#liveDesk { padding: 0 0 92px; }
.live-desk-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.event-tape, .micro-chart-card { min-width: 0; padding: 20px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); }
.tape-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding-bottom: 14px; border-bottom: 1px solid var(--line); color: var(--muted); font: 10px var(--mono); letter-spacing: .07em; }
.tape-head > div { display: flex; align-items: center; gap: 8px; }
.tape-control, .text-button { min-height: 40px; padding: 6px 9px; border: 1px solid var(--line); border-radius: 5px; background: transparent; color: var(--cyan); font: 9px var(--mono); }
.event-list, #liveTape { min-height: 183px; max-height: 360px; overflow: auto; margin: 0; padding: 0; list-style: none; }
.event-row { display: grid; grid-template-columns: 62px 8px minmax(0, 1fr) auto; align-items: center; gap: 10px; min-width: 0; padding: 13px 0; border-bottom: 1px solid var(--line); }
.event-row time, .live-time { color: var(--subtle); font: 9px var(--mono); }
.event-tone { width: 6px; height: 6px; border-radius: 50%; background: var(--cyan); box-shadow: 0 0 0 4px rgba(98,230,255,.09); }
.event-tone.violet { background: var(--violet); box-shadow: 0 0 0 4px rgba(168,156,255,.09); }
.event-tone.amber { background: var(--amber); box-shadow: 0 0 0 4px rgba(255,204,112,.09); }
.event-row strong { display: block; color: var(--text); font: 11px var(--mono); font-weight: 500; }
.event-row strong b { color: var(--cyan); font-size: 9px; font-weight: 400; margin-left: 5px; }
.event-row small { display: block; margin-top: 3px; color: var(--muted); font-size: 10px; overflow-wrap: anywhere; }
.event-arrow { color: var(--subtle); }
.event-empty, .live-empty { padding: 24px 8px; color: var(--muted); text-align: center; font-size: 11px; }
.tape-foot { display: flex; justify-content: space-between; gap: 10px; padding-top: 14px; color: var(--subtle); font: 9px var(--mono); }
.micro-chart { position: relative; height: 220px; overflow: hidden; margin-top: 16px; border: 1px solid var(--line); background: var(--surface-2); }
.micro-grid { position: absolute; inset: 0; background-image: linear-gradient(rgba(181,209,224,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(181,209,224,.07) 1px,transparent 1px); background-size: 20% 25%; }
.micro-chart svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.micro-chart .chart-path { fill: none; stroke: var(--cyan); stroke-width: 2; opacity: .85; }
.micro-chart .chart-band { fill: rgba(98,230,255,.08); }
.chart-end-label { position: absolute; top: 10px; right: 10px; color: var(--cyan); font: 9px var(--mono); }
.freshness-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; padding-top: 14px; color: var(--muted); font: 9px var(--mono); }
.freshness-row b { margin-right: 3px; color: var(--text); font-weight: 500; font-variant-numeric: tabular-nums; }
.live-event-enter { animation: eventIn .24s var(--ease); }
@keyframes eventIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }

/* Existing modal and its risk calculator remain usable with the new design. */
.modal[hidden] { display: none !important; }
.modal { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; padding: 22px; }
.modal-backdrop { position: absolute; inset: 0; background: rgba(2,5,10,.82); backdrop-filter: blur(8px); }
.chart-dialog { position: relative; width: min(1100px, 100%); max-height: 92vh; overflow: auto; z-index: 1; }
.chart-dialog .chart-wrap { overflow: auto; border: 1px solid var(--line); border-radius: 9px; background: var(--surface-2); }
.chart-dialog .chart-wrap svg { display: block; width: 100%; min-width: 680px; height: auto; }
.chart-notice { padding: 14px; border: 1px solid rgba(255,204,112,.35); border-radius: 9px; background: var(--warning-soft); color: var(--amber); margin-bottom: 14px; }
.chart-legend { display: flex; gap: 13px; flex-wrap: wrap; color: var(--muted); font-size: 11px; margin-top: 12px; }
.chart-disclaimer { margin-top: 14px !important; color: var(--muted) !important; font-size: 10px; line-height: 1.6; }

.footer { border-top: 1px solid var(--line); padding: 25px 0 38px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; color: var(--muted); font-size: 10px; }
.footer-brand { display: flex; align-items: center; gap: 8px; color: var(--text); }
.footer-brand img { display: block; }
.footer-brand strong { font-size: 12px; }
.footer-meta { display: flex; flex-wrap: wrap; gap: 14px; margin-left: auto; font: 9px var(--mono); }
.footer-meta a { color: var(--muted); }
.footer > p { width: 100%; margin: 6px 0 0; color: var(--subtle); font: 9px var(--mono); }

@media (hover: hover) and (pointer: fine) {
  .mode-button:hover, .segment-button:hover, .section-tab:hover, .text-link:hover, .footer-meta a:hover { color: var(--text); }
  .button:hover { border-color: rgba(98,230,255,.62); background: var(--cyan-soft); }
  .button-primary:hover { border-color: #a1f1ff; background: #a1f1ff; }
  .stage:hover .stage-node { border-color: var(--cyan); color: var(--cyan); }
  .segment-card:hover { border-color: rgba(98,230,255,.4); }
  .alert-row:hover { border-color: rgba(98,230,255,.4); background: var(--surface-2); }
}
@media (hover: none), (pointer: coarse) {
  .button:hover, .mode-button:hover, .segment-button:hover, .section-tab:hover, .alert-row:hover { filter: none; transform: none; }
}
@media (max-width: 1100px) {
  .engine-pulse-grid { grid-template-columns: repeat(2, minmax(0,1fr)); }
  .breakdown-row { grid-template-columns: minmax(0,1fr) minmax(0,1fr); }
  .breakdown-row > b { grid-column: 1 / -1; }
}
@media (max-width: 780px) {
  .app-shell { padding: 0 16px 64px; }
  .status-rail { overflow: auto; margin: 0 -16px; padding: 0 16px; min-height: 61px; scrollbar-width: none; }
  .status-rail::-webkit-scrollbar { display: none; }
  .status-item { min-width: max-content; padding: 0 14px; }
  .status-item:first-child { padding-left: 0; }
  .status-item:nth-child(3) { display: flex; }
  .status-item:nth-child(4) { display: none; }
  .safety-lock { margin-left: 14px; min-width: max-content; font-size: 9px; }
  .hero { display: block; padding-top: 48px; padding-bottom: 52px; }
  .hero h1 { font-size: clamp(45px,13vw,67px); }
  .hero-text { font-size: 15px; }
  .hero-pulse { margin-top: 36px; }
  .section-tabs { margin: 0 -16px; padding: 0 16px; gap: 25px; }
  .section-heading { align-items: flex-start; flex-direction: column; margin-bottom: 23px; }
  .section-note { white-space: normal; }
  .overview, .lifecycle, .provenance, .performance, #alerts, #health, #preferences, .quant { padding-top: 62px; }
  .segment-switch { width: 100%; overflow: auto; }
  .metric-grid, .performance .metric-grid { grid-template-columns: repeat(2, minmax(0,1fr)); }
  .metric-card, .performance .metric { min-height: 147px; padding: 15px; }
  .metric-card strong, .performance .metric strong { font-size: 30px; margin-top: 17px; }
  .segment-detail-grid { grid-template-columns: 1fr; }
  .lifecycle-card { grid-template-columns: 1fr; padding: 22px 18px; }
  .lifecycle-rail { display: grid; grid-template-columns: repeat(4,1fr); row-gap: 23px; }
  .rail-line { display: none; }
  .stage small { font-size: 8px; }
  .lifecycle-detail { border-left: 0; border-top: 1px solid var(--line); padding: 24px 0 0; }
  .provenance { display: block; padding-bottom: 62px; }
  .provenance-panel { margin-top: 32px; }
  #waitlistCard { padding: 25px; }
  #waitlistCard .waitlist-header { flex-direction: column; }
  #waitlistCard .waitlist-header > div:last-child { text-align: left !important; }
  #waitlistCard .waitlist-perks { grid-template-columns: 1fr; }
  #waitlistCard .waitlist-form-grid { grid-template-columns: 1fr; }
  .quant-card { grid-template-columns: 1fr; padding: 22px 18px; }
  .quant-chart { border-left: 0; border-top: 1px solid var(--line); padding: 23px 0 0; margin-top: 8px; }
  .live-desk-grid { grid-template-columns: 1fr; }
  .event-tape, .micro-chart-card { padding: 17px; }
  .micro-chart { height: 190px; }
  .freshness-row { gap: 5px; font-size: 8px; }
  .health-grid { grid-template-columns: repeat(2,minmax(0,1fr)); }
  .preference-grid { grid-template-columns: 1fr; }
  .preference-footer { align-items: stretch; flex-direction: column; }
  .preference-actions { width: 100%; flex-direction: column; }
  .preference-actions button { width: 100%; min-height: 44px; }
  .filter-bar > * { max-width: 100%; min-width: 0; }
  .alert-row { grid-template-columns: 1fr 1fr; }
  .footer { display: block; }
  .footer-meta { margin: 17px 0; flex-wrap: wrap; }
  .footer > p { margin-top: 15px; }
  .section-tab, .mode-button, .segment-button, .button, .period-btn, .tape-control, .text-button { min-height: 44px; }
}
@media (max-width: 390px) {
  .hero-actions { display: grid; }
  .hero-actions .button { justify-content: center; }
  .metric-grid, .performance .metric-grid { gap: 7px; }
  .metric-card small, .performance .metric small { font-size: 9px; }
  .segment-kpis { gap: 8px; }
  .segment-kpis b { font-size: 11px; }
  .lifecycle-rail { grid-template-columns: repeat(3,1fr); }
  .stage small { white-space: normal; text-align: center; }
  .freshness-row { grid-template-columns: 1fr; gap: 6px; }
  .health-grid { grid-template-columns: 1fr; }
  .breakdown-row { grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto !important; }
  *, *::before, *::after { scroll-behavior: auto !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
}

/* Final layout glue for the retained product controls. */
.status-item .status-dot.online { background: var(--green); box-shadow: 0 0 0 4px rgba(98,230,255,.08); }
.panel-status.online { color: var(--green); }
.panel-status.bad { color: var(--red); }
.panel-status::before { content: ""; display: inline-block; width: 5px; height: 5px; margin: 0 6px 1px 0; border-radius: 50%; background: currentColor; }
.additional-universe { margin-top: 8px; padding-top: 10px; border-top: 1px solid var(--line); }
.additional-universe strong { font-size: 10px; }
.additional-universe span { overflow-wrap: anywhere; }
.vip-intro { color: var(--muted); max-width: 620px; font-size: 12px; line-height: 1.7; margin: -13px 0 20px; }
.rule-reference { grid-column: 1 / -1; min-width: 0; }
.stage { min-height: 54px; padding: 4px 2px; }
#quantLab {
  display: grid;
  grid-template-columns: minmax(300px, .8fr) minmax(0, 1.2fr);
  gap: 14px 28px;
}
#quantLab > .mc-explainer,
#quantLab > .mc-controls,
#quantLab > #mcStatus,
#quantLab > #mcCards { grid-column: 1; }
#quantLab > .chart-wrap,
#quantLab > .mc-chart-legend,
#quantLab > .chart-disclaimer { grid-column: 2; }
#quantLab > .mc-verdict { grid-column: 1 / -1; }
@media (max-width: 780px) {
  #quantLab { grid-template-columns: minmax(0,1fr); gap: 12px; }
  #quantLab > .mc-explainer,
  #quantLab > .mc-controls,
  #quantLab > #mcStatus,
  #quantLab > #mcCards,
  #quantLab > .chart-wrap,
  #quantLab > .mc-chart-legend,
  #quantLab > .chart-disclaimer { grid-column: 1; }
  #quantLab > .mc-verdict { grid-column: 1; }
}
@media (hover: none), (pointer: coarse) {
  .brand:hover,
  .segment-card:hover,
  .vip-btn:hover,
  .waitlist-submit-btn:hover,
  .tg-btn:hover,
  .synth-tg-link:hover,
  .synth-free-btn:hover { transform: none !important; }
}
.engine-pulse {
  border-color: rgba(98,230,255,.28);
  background: linear-gradient(145deg, rgba(16,34,41,.96), rgba(10,14,18,.98));
  box-shadow: 0 18px 55px rgba(0,0,0,.22), 0 0 26px rgba(98,230,255,.035);
}
.engine-pulse .panel-head h2 { color: var(--text); }
.engine-pulse .pill.green { color: var(--cyan); background: var(--cyan-soft); border-color: rgba(98,230,255,.28); }
.engine-pulse-stat { border-color: rgba(98,230,255,.14); }
.engine-pulse-stat strong { color: var(--cyan); }

/* Keep the live scanner count and closing parenthesis on the heading line. */
.universe-row strong #activePairCount {
  display: inline;
  color: inherit;
  font: inherit;
  margin: 0;
}
`;
