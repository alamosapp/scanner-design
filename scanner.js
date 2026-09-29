/* ==========================================================================
   Scanner tables — formatting, color scales, column reordering,
   mobile cards and a mock live feed
   ========================================================================== */

(() => {
  "use strict";

  /* ---- Config ------------------------------------------------------------ */

  // Signal column: float tiers (shares). < low → low float, < mid → mid, else high.
  // These are the defaults; the Float tiers dialog can change both cuts and
  // the tier colors (palette token names; "muted" is --text-3).
  const FLOAT_DEFAULTS = { low: 10e6, mid: 50e6, colors: { low: "cyan", mid: "violet", high: "muted" } };
  const FLOAT_TIERS = { low: FLOAT_DEFAULTS.low, mid: FLOAT_DEFAULTS.mid };
  const FLOAT_RANGE = { min: 1e6, max: 1e9 }; // what the dialog accepts (and its log scale)

  // Color scales. `min` is the faintest value, `max` the brightest; values
  // past `max` stay at full brightness, values short of `min` get no color.
  const SCALES = {
    chgUp:   { min: 2,  max: 35 },
    chgDown: { min: -2, max: -25 },
    vol1m:   { min: 1,  max: 10000, log: true }, // spans 4 orders of magnitude
    hits:    { min: 1,  max: 150 },
    chgDayUp:   { min: 5,  max: 100 },  // vs. close / open: day moves run far bigger
    chgDayDown: { min: -5, max: -50 },
  };

  // Heat hue per metric. %Chg follows the table's direction; volume and hits
  // are direction-neutral so they never read as bullish/bearish.
  const HUES = { chgUp: "green", chgDown: "red", chgDayUp: "green", chgDayDown: "red", vol1m: "amber", hits: "violet" };

  // VWAP D.: >= +1% green, < -1% red, anything else amber.
  const VWAP_D = { up: 1, down: -1 };

  const MAX_ROWS = 40;
  const LIVE_INTERVAL = 4000;
  const QUOTE_INTERVAL = 1200; // toplist price updates

  /* ---- Formatters -------------------------------------------------------- */

  const pad = (n) => String(n).padStart(2, "0");
  const fmtTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

  // 20.51 above $1, 0.0985 below.
  const fmtPrice = (v) => v.toFixed(v >= 1 ? 2 : 4);

  // 1.5B · 89.5M · 525.2k
  const fmtAbbr = (v) => {
    const units = [[1e9, "B"], [1e6, "M"], [1e3, "k"]];
    for (let i = 0; i < units.length; i++) {
      const [size, suffix] = units[i];
      if (v >= size) {
        const scaled = Math.round((v / size) * 10) / 10;
        // 999.96k rounds to 1000.0k → promote to 1.0M
        if (scaled >= 1000 && i > 0) return `${(scaled / 1000).toFixed(1)}${units[i - 1][1]}`;
        return `${scaled.toFixed(1)}${suffix}`;
      }
    }
    return String(Math.round(v));
  };

  // 12.5x · 245x · 2,450x
  const fmtMult = (v) => (v >= 100 ? `${Math.round(v).toLocaleString("en-US")}x` : `${v.toFixed(1)}x`);

  // Timers: 04:05 · 75:12
  const fmtClock = (ms) => {
    const sec = Math.max(0, Math.floor(ms / 1000));
    return `${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`;
  };

  const round = (v, dp) => Math.round(v * 10 ** dp) / 10 ** dp;
  const fmtPct = (v, dp) => `${v > 0 ? "+" : ""}${v.toFixed(dp)}%`;

  /* ---- Color scales ------------------------------------------------------ */

  // 0 → faintest, 1 → brightest, null → outside the scale (no color).
  const intensity = (v, { min, max, log }) => {
    const dir = Math.sign(max - min);
    if ((v - min) * dir < 0) return null;
    const t = log
      ? Math.log10(v / min) / Math.log10(max / min)
      : (v - min) / (max - min);
    return Math.min(1, Math.max(0, t));
  };

  // Every heat cell is a chip; `--t` drives background + text brightness in CSS.
  const heat = (text, t, hue) => {
    if (t === null) return `<span class="heat is-off">${text}</span>`;
    const cls = t >= 0.85 ? "heat is-hot" : "heat";
    return `<span class="${cls}" data-hue="${hue}" style="--t:${t.toFixed(3)}">${text}</span>`;
  };

  const floatTier = (f, tiers = FLOAT_TIERS) => (f < tiers.low ? "low" : f < tiers.mid ? "mid" : "high");
  const FLOAT_LABEL = { low: "Low float", mid: "Mid float", high: "High float" };

  const vwapClass = (d) => (d >= VWAP_D.up ? "up" : d < VWAP_D.down ? "down" : "flat");

  /* ---- Mini charts ------------------------------------------------------- */

  const seeded = (str) => {
    let a = [...str].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 2654435761), 1779033703);
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  const sparkPoints = (seed, up) => {
    const rnd = seeded(seed);
    const n = 16;
    const pts = [];
    let y = 0;
    for (let i = 0; i < n; i++) {
      y += (up ? 1 : -1) * (0.4 + rnd()) + (rnd() - 0.5) * 1.6;
      pts.push(y);
    }
    const lo = Math.min(...pts);
    const hi = Math.max(...pts);
    return pts
      .map((v, i) => `${((i / (n - 1)) * 88).toFixed(1)},${(25 - ((v - lo) / (hi - lo || 1)) * 22).toFixed(1)}`)
      .join(" ");
  };

  /* ---- Cell contents (shared by table rows and mobile cards) ------------- */

  const derive = (r, tone) => {
    const bear = tone === "bear" || r.dir === "down";
    const chgScale = bear ? "chgDown" : "chgUp";
    const chg = (v, suffix = "") => {
      if (v == null) return "";
      const shown = round(v, 1);
      return heat(fmtPct(shown, 1) + suffix, intensity(shown, SCALES[chgScale]), HUES[chgScale]);
    };
    // Halt timers are filled in (and kept ticking) by tickTimers().
    const timer = (kind) => r.haltAt
      ? `<span class="timer" data-timer="${kind}" data-since="${r.haltAt.getTime()}" data-until="${r.resumeAt.getTime()}"></span>`
      : "";
    // Session moves: vs. yesterday's close and today's open. Their color
    // follows the sign of the move, not the table.
    const dayChg = (ref) => {
      const pct = round(((r.price - ref) / ref) * 100, 1);
      const scale = pct >= 0 ? "chgDayUp" : "chgDayDown";
      return heat(fmtPct(pct, 1), intensity(pct, SCALES[scale]), HUES[scale]);
    };
    const dayAbs = (ref) => {
      const diff = r.price - ref;
      const shown = diff.toFixed(Math.abs(diff) >= 1 ? 2 : 4);
      const n = Number(shown);
      return `<span class="${n > 0 ? "up" : n < 0 ? "down" : ""}">${n > 0 ? "+" : ""}${shown}</span>`;
    };
    const vwapD = round(((r.price - r.vwap) / r.vwap) * 100, 2);
    const tier = floatTier(r.float);
    const vol1m = round(r.vol1m, r.vol1m >= 100 ? 0 : 1);

    return {
      tier,
      sig: `<i class="sig-bar" data-float="${tier}" title="${FLOAT_LABEL[tier]} · ${fmtAbbr(r.float)}"></i><span class="sr-only">${FLOAT_LABEL[tier]}</span>`,
      time: fmtTime(r.time),
      sym: `<span class="sym">${r.sym}</span>`,
      price: fmtPrice(r.price),
      chg1: chg(r.chg1),
      chg1Tag: chg(r.chg1, " / 1m"),
      chgClose: dayChg(r.close),
      chgCloseAbs: dayAbs(r.close),
      chgOpen: dayChg(r.open),
      chgOpenAbs: dayAbs(r.open),
      vol1m: heat(fmtMult(vol1m), intensity(vol1m, SCALES.vol1m), HUES.vol1m),
      rvol: fmtMult(r.rvol),
      hits: heat(String(r.hits), intensity(r.hits, SCALES.hits), HUES.hits),
      vwapD: `<span class="vwap-d ${vwapClass(vwapD)}">${fmtPct(vwapD, 2)}</span>`,
      vwap: fmtPrice(r.vwap),
      chg5: chg(r.chg5),
      chg15: chg(r.chg15),
      chg30: chg(r.chg30),
      duration: timer("duration"),
      resume: timer("resume"),
      volume: fmtAbbr(r.volume),
      float: fmtAbbr(r.float),
      mcap: fmtAbbr(r.mcap),
      press: `<div class="pressure" title="Buying vs selling pressure"><i class="buy" style="width:${r.buy}%"></i><i class="sell" style="width:${100 - r.buy}%"></i></div>`,
      trend: `<svg class="spark ${bear ? "down" : "up"}" viewBox="0 0 88 28" aria-hidden="true"><polyline points="${sparkPoints(r.sym + r.hits, !bear)}"></polyline></svg>`,
    };
  };

  /* ---- Columns ------------------------------------------------------------
     Pinned columns stay first; the rest can be dragged into any order.
     Every column has a fixed whole-pixel width (`w`), so pinned offsets and
     row lines land on exact pixels and the header never drifts off the body. */

  const COLUMNS = [
    { key: "sig",      label: "Signal",      w: 24,  pinned: true, cls: "col-sig", title: "Float size", srOnly: true },
    { key: "time",     label: "Time",        w: 88,  pinned: true, cls: "col-time" },
    { key: "sym",      label: "Ticker",      w: 68, pinned: true, cls: "col-sym" },
    { key: "price",    label: "Price",       w: 80,  num: true },
    { key: "chg1",     label: "%Chg 1m",     w: 96,  num: true, title: "% change, last minute" },
    { key: "vol1m",    label: "Vol. 1m",     w: 100, num: true, title: "Volume spike vs. normal 1m volume" },
    { key: "chgClose",    label: "%Chg Close", w: 108, num: true, title: "% change vs. previous close" },
    { key: "chgCloseAbs", label: "Chg Close",  w: 96,  num: true, title: "Change vs. previous close" },
    { key: "chgOpen",     label: "%Chg Open",  w: 104, num: true, title: "% change vs. today's open" },
    { key: "chgOpenAbs",  label: "Chg Open",   w: 92,  num: true, title: "Change vs. today's open" },
    { key: "rvol",     label: "RVol",        w: 72,  num: true, title: "Relative volume" },
    { key: "hits",     label: "Hits",        w: 88,  num: true, title: "Alerts fired today" },
    { key: "vwapD",    label: "VWAP D.",     w: 92,  num: true, title: "Distance to VWAP" },
    { key: "vwap",     label: "VWAP",        w: 80,  num: true },
    { key: "chg5",     label: "%Chg 5m",     w: 96,  num: true },
    { key: "chg15",    label: "%Chg 15m",    w: 104, num: true },
    { key: "chg30",    label: "%Chg 30m",    w: 104, num: true },
    { key: "duration", label: "Duration",    w: 92,  num: true, title: "Time halted" },
    { key: "resume",   label: "Resume Est.", w: 116, num: true, title: "Countdown to the estimated resumption" },
    { key: "volume",   label: "Volume",      w: 84,  num: true, muted: true },
    { key: "float",    label: "Float",       w: 76,  num: true, muted: true },
    { key: "mcap",     label: "MCap",        w: 76,  num: true, muted: true },
    { key: "press",    label: "Bull/Sell Press", w: 128 },
    { key: "trend",    label: "Trend",       w: 116 },
  ];
  const COL = Object.fromEntries(COLUMNS.map((c) => [c.key, c]));
  const PINNED = COLUMNS.filter((c) => c.pinned).map((c) => c.key);
  // Toplists rank tickers rather than log alerts, so they pin no Time column.
  const TOPLIST_PINS = ["sig", "sym"];

  // Default (movable) column order per table. Every table starts with the
  // same session block, then adds its own columns.
  const BASE_COLS = ["price", "volume", "chgClose", "chgCloseAbs", "chgOpen", "chgOpenAbs", "float", "rvol", "mcap"];
  const TOPLIST_COLS = [...BASE_COLS, "vwapD", "vwap", "press", "trend"];
  const HALT_COLS = [...BASE_COLS, "duration", "resume", "press", "trend"];
  const HOD_COLS = [...BASE_COLS, "chg1", "hits", "vol1m", "press", "trend"];
  const PRESSURE_COLS = [...BASE_COLS, "chg1", "vol1m", "press", "trend"];
  const MOMENTUM_COLS = [...BASE_COLS, "chg1", "vol1m", "chg5", "chg15", "chg30", "press", "trend"];

  const cellClass = (c) => [c.cls, c.num && "num", c.muted && "muted"].filter(Boolean).join(" ");

  // Column order per table survives reloads (best effort — storage may be
  // blocked). v2: the column sets changed, so orders saved before are dropped.
  const storeKey = (panel) => `scanner:columns:v2:${panel}`;
  const loadOrder = (panel, movable) => {
    try {
      const saved = JSON.parse(localStorage.getItem(storeKey(panel)) || "null");
      if (Array.isArray(saved)) {
        const known = saved.filter((k) => movable.includes(k));
        return [...known, ...movable.filter((k) => !known.includes(k))];
      }
    } catch { /* ignore */ }
    return [...movable];
  };
  const saveOrder = (panel, order) => {
    try { localStorage.setItem(storeKey(panel), JSON.stringify(order)); } catch { /* ignore */ }
  };

  // Table settings per panel: hidden columns, heat colors and excluded
  // tickers. Colors are palette token names (--amber, --pink…), not hex.
  // Direction-neutral heat columns only: green/red stay bull/bear.
  const COLORABLE = { vol1m: "amber", hits: "violet" };
  const SWATCHES = ["amber", "violet", "cyan", "pink", "orange", "teal"];

  const prefsKey = (panel) => `scanner:prefs:v1:${panel}`;
  const loadPrefs = (panel, movable) => {
    const prefs = { hidden: new Set(), colors: {}, excluded: new Set() };
    try {
      const saved = JSON.parse(localStorage.getItem(prefsKey(panel)) || "null");
      if (saved) {
        (saved.hidden || []).filter((k) => movable.includes(k)).forEach((k) => prefs.hidden.add(k));
        for (const [k, v] of Object.entries(saved.colors || {})) {
          if (movable.includes(k) && k in COLORABLE && SWATCHES.includes(v)) prefs.colors[k] = v;
        }
        (saved.excluded || []).forEach((s) => typeof s === "string" && prefs.excluded.add(s));
      }
    } catch { /* ignore */ }
    return prefs;
  };
  const savePrefs = (panel, { hidden, colors, excluded }) => {
    try {
      localStorage.setItem(prefsKey(panel), JSON.stringify({ hidden: [...hidden], colors, excluded: [...excluded] }));
    } catch { /* ignore */ }
  };

  // Tickers excluded from every table.
  const GLOBAL_EXCLUDED_KEY = "scanner:excluded:all";
  const globalExcluded = new Set();
  const loadGlobalExcluded = () => {
    globalExcluded.clear();
    try {
      const saved = JSON.parse(localStorage.getItem(GLOBAL_EXCLUDED_KEY) || "[]");
      if (Array.isArray(saved)) saved.forEach((s) => typeof s === "string" && globalExcluded.add(s));
    } catch { /* ignore */ }
  };
  loadGlobalExcluded();
  const saveGlobalExcluded = () => {
    try { localStorage.setItem(GLOBAL_EXCLUDED_KEY, JSON.stringify([...globalExcluded])); } catch { /* ignore */ }
  };

  // Float tiers, shared by every table: cuts in FLOAT_TIERS, colors as the
  // --float-* tokens on :root.
  const FLOAT_SWATCHES = ["cyan", "violet", "pink", "orange", "teal", "amber", "muted"];
  const FLOAT_KEY = "scanner:float:v1";
  const swatchVar = (s) => (s === "muted" ? "var(--text-3)" : `var(--${s})`);
  const floatColors = { ...FLOAT_DEFAULTS.colors };
  const validCuts = (low, mid) => [low, mid].every((v) => Number.isFinite(v) && v >= FLOAT_RANGE.min && v <= FLOAT_RANGE.max) && low < mid;
  const applyFloat = () => {
    for (const [tier, c] of Object.entries(floatColors)) document.documentElement.style.setProperty(`--float-${tier}`, swatchVar(c));
  };
  const loadFloat = () => {
    Object.assign(FLOAT_TIERS, { low: FLOAT_DEFAULTS.low, mid: FLOAT_DEFAULTS.mid });
    Object.assign(floatColors, FLOAT_DEFAULTS.colors);
    try {
      const saved = JSON.parse(localStorage.getItem(FLOAT_KEY) || "null");
      if (saved) {
        if (validCuts(saved.low, saved.mid)) Object.assign(FLOAT_TIERS, { low: saved.low, mid: saved.mid });
        for (const tier of Object.keys(floatColors)) {
          if (FLOAT_SWATCHES.includes(saved.colors?.[tier])) floatColors[tier] = saved.colors[tier];
        }
      }
    } catch { /* ignore */ }
    applyFloat();
  };
  loadFloat();
  const saveFloat = () => {
    try { localStorage.setItem(FLOAT_KEY, JSON.stringify({ ...FLOAT_TIERS, colors: floatColors })); } catch { /* ignore */ }
  };

  // Every mounted table, by panel id: what the settings dialog reads and writes.
  const tables = new Map();

  /* ---- Mobile card ------------------------------------------------------- */

  // Two lines: ticker · price · time / volume · RVol · 1m change (or halt timers).
  const renderCard = (d) => `
    <div class="card-line">
      ${d.sym}<span class="card-price">${d.price}</span>
      <time class="card-time">${d.time}</time>
    </div>
    <div class="card-line card-meta">
      <span>Vol <b>${d.volume}</b></span><span>RVol <b>${d.rvol}</b></span>
      <span class="card-end">${d.duration ? `<span class="card-halt">${d.duration}<i>→</i>${d.resume}</span>` : d.chg1Tag}</span>
    </div>`;

  /* ---- Mock data --------------------------------------------------------- */

  const at = (hms) => {
    const [h, m, s] = hms.split(":").map(Number);
    const d = new Date();
    d.setHours(h, m, s, 0);
    return d;
  };

  const BULL = [
    { sym: "NVLX", time: at("17:00:15"), price: 4.64,   chg1: 33.3, vol1m: 2450, rvol: 48.2, hits: 142, vwap: 3.98,   chg5: 41.2, chg15: 58.7, chg30: 64.1, volume: 3.0e6,   float: 3.2e6,   mcap: 14.8e6,  buy: 84 },
    { sym: "BRZN", time: at("16:59:48"), price: 11.21,  chg1: 29.4, vol1m: 865,  rvol: 22.7, hits: 96,  vwap: 10.44,  chg5: 24.1, chg15: 30.2, chg30: 18.5, volume: 2.2e6,   float: 18.4e6,  mcap: 206.3e6, buy: 68 },
    { sym: "HLIO", time: at("16:59:31"), price: 2.43,   chg1: 23.5, vol1m: 312,  rvol: 15.1, hits: 71,  vwap: 2.18,   chg5: 18.2, chg15: 12.4, chg30: 9.8,  volume: 4.8e6,   float: 6.7e6,   mcap: 16.3e6,  buy: 62 },
    { sym: "ZENT", time: at("16:58:57"), price: 0.4185, chg1: 10.9, vol1m: 58.4, rvol: 8.6,  hits: 38,  vwap: 0.4102, chg5: 12.7, chg15: 7.3,  chg30: 4.1,  volume: 21.4e6,  float: 72.5e6,  mcap: 30.3e6,  buy: 59 },
    { sym: "ORBT", time: at("16:58:12"), price: 3.09,   chg1: 11.6, vol1m: 24.3, rvol: 6.2,  hits: 22,  vwap: 3.12,   chg5: 6.4,  chg15: 3.2,  chg30: 2.5,  volume: 1.7e6,   float: 24.9e6,  mcap: 76.9e6,  buy: 52 },
    { sym: "KRYP", time: at("16:57:40"), price: 15.69,  chg1: 8.4,  vol1m: 12.8, rvol: 4.3,  hits: 14,  vwap: 16.02,  chg5: 5.1,  chg15: 2.4,  chg30: 1.2,  volume: 812.4e3, float: 41.2e6,  mcap: 1.52e9,  buy: 40 },
    { sym: "QMTR", time: at("16:56:05"), price: 0.1042, chg1: 5.3,  vol1m: 4.2,  rvol: 3.1,  hits: 6,   vwap: 0.0985, chg5: 3.8,  chg15: -1.4, chg30: 2.2,  volume: 38.6e6,  float: 312.4e6, mcap: 32.6e6,  buy: 57 },
    { sym: "VYRA", time: at("16:54:22"), price: 6.87,   chg1: 2.6,  vol1m: 1.8,  rvol: 2.2,  hits: 2,   vwap: 6.81,   chg5: 2.1,  chg15: 0.8,  chg30: -3.1, volume: 525.2e3, float: 9.1e6,   mcap: 62.5e6,  buy: 49 },
  ];

  const BEAR = [
    { sym: "DRFT", time: at("16:59:52"), price: 1.87,   chg1: -24.6, vol1m: 3120, rvol: 31.4, hits: 118, vwap: 2.34,   chg5: -28.3, chg15: -31.0, chg30: -22.4, volume: 5.6e6,   float: 4.1e6,   mcap: 7.7e6,   buy: 18 },
    { sym: "SOLQ", time: at("16:59:10"), price: 8.42,   chg1: -15.2, vol1m: 640,  rvol: 14.8, hits: 64,  vwap: 9.21,   chg5: -12.8, chg15: -9.1,  chg30: -6.3,  volume: 1.9e6,   float: 15.6e6,  mcap: 131.4e6, buy: 27 },
    { sym: "MIRA", time: at("16:58:33"), price: 0.6120, chg1: -9.7,  vol1m: 88.5, rvol: 7.9,  hits: 31,  vwap: 0.6588, chg5: -7.4,  chg15: -11.2, chg30: -4.8,  volume: 12.3e6,  float: 58.0e6,  mcap: 35.5e6,  buy: 34 },
    { sym: "PLXR", time: at("16:57:21"), price: 22.05,  chg1: -5.8,  vol1m: 19.6, rvol: 4.1,  hits: 12,  vwap: 22.19,  chg5: -3.9,  chg15: -2.1,  chg30: -1.5,  volume: 740.2e3, float: 88.4e6,  mcap: 1.95e9,  buy: 41 },
    { sym: "TUNE", time: at("16:55:48"), price: 3.36,   chg1: -3.1,  vol1m: 3.4,  rvol: 2.6,  hits: 4,   vwap: 3.30,   chg5: -2.2,  chg15: 1.1,   chg30: 4.3,   volume: 1.1e6,   float: 22.7e6,  mcap: 76.3e6,  buy: 46 },
    { sym: "CELR", time: at("16:54:02"), price: 0.0842, chg1: -2.2,  vol1m: 1.6,  rvol: 1.9,  hits: 1,   vwap: 0.0851, chg5: -1.2,  chg15: -3.4,  chg30: -6.8,  volume: 64.2e6,  float: 420.0e6, mcap: 35.4e6,  buy: 44 },
  ];

  // Older alerts to give the tables enough rows to scroll.
  const backfill = (seed, syms, bear) => {
    const rnd = seeded(syms.join(""));
    const s = bear ? -1 : 1;
    let t = seed[seed.length - 1].time.getTime();
    return syms.map((sym) => {
      t -= (20 + rnd() * 70) * 1000;
      const price = rnd() < 0.25 ? 0.05 + rnd() * 0.9 : 1 + rnd() * 20;
      const chg1 = s * (1.5 + rnd() ** 2 * 26);
      const chg5 = chg1 * (0.5 + rnd());
      const float = 10 ** (6.2 + rnd() * 2.4);
      return {
        sym, time: new Date(t), price, chg1, chg5,
        vol1m: 10 ** (rnd() ** 1.6 * 3.3),
        rvol: 1.5 + rnd() ** 2 * 30,
        hits: Math.max(1, Math.round(rnd() ** 2.2 * 110)),
        vwap: price * (1 - s * (rnd() * 0.1 - 0.025)),
        chg15: chg5 * (0.3 + rnd() * 1.2) - s * rnd() * 3,
        chg30: chg5 * (0.2 + rnd() * 1.4) - s * rnd() * 5,
        volume: 10 ** (5.4 + rnd() * 2.1),
        float,
        mcap: float * price * (0.8 + rnd() * 1.5),
        buy: Math.round(bear ? 15 + rnd() * 35 : 48 + rnd() * 40),
      };
    });
  };

  BULL.push(...backfill(BULL, ["AUXO", "PNTR", "GLYD", "FRST", "MOXY", "TRBO", "LUMA", "KINE", "SPRK", "VOLT", "NEXA", "CRUX"], false));
  BEAR.push(...backfill(BEAR, ["SLAB", "DUSK", "HALO", "WREN", "OPTX", "BRKN", "FADE", "NUMB", "ASHN", "TIDE"], true));

  // Session reference prices: yesterday's close and today's open. One pair
  // per ticker, so a symbol measures against the same levels in every table.
  const SESSION = new Map();
  const withSession = (r) => {
    if (!SESSION.has(r.sym)) {
      const rnd = seeded(`${r.sym}:session`);
      const bear = r.dir === "down" || r.chg1 < 0;
      const dayPct = bear ? -(4 + rnd() * 36) : 8 + rnd() ** 1.5 * 140;
      const close = r.price / (1 + dayPct / 100);
      const open = close + (r.price - close) * (0.2 + rnd() * 0.6); // gapped part of the move
      SESSION.set(r.sym, { close, open });
    }
    return Object.assign(r, SESSION.get(r.sym));
  };
  BULL.forEach(withSession);
  BEAR.forEach(withSession);

  // Placeholder seeds for the other alert tables, carved out of the same mock data.
  const BUYING = BULL.filter((r) => r.buy >= 55);
  const MOMENTUM = BULL.filter((r) => r.chg5 >= 5);

  // Toplists: ranked snapshots (the ranking is static for now).
  const rankBy = (list, score) => [...list].sort((a, b) => score(b) - score(a));
  const GAINERS = rankBy(BULL, (r) => r.price / r.close);
  const GAINERS_OPEN = rankBy(BULL, (r) => r.price / r.open);
  const VOLUME_LEADERS = rankBy([...BULL, ...BEAR], (r) => r.volume);

  // Halts: `resumeAt` is the estimated resumption (LULD pauses last 5 minutes).
  const ago = (sec) => new Date(Date.now() - sec * 1000);
  const soon = (sec) => new Date(Date.now() + sec * 1000);
  const HALTS = [
    { sym: "NVLX", dir: "up",   haltAt: ago(212),  resumeAt: soon(88),  price: 5.12,   vol1m: 1880, rvol: 52.4, hits: 143, vwap: 4.21,   volume: 3.4e6,   float: 3.2e6,   mcap: 16.4e6,  buy: 81 },
    { sym: "DRFT", dir: "down", haltAt: ago(265),  resumeAt: soon(35),  price: 1.64,   vol1m: 2210, rvol: 34.9, hits: 121, vwap: 2.19,   volume: 6.1e6,   float: 4.1e6,   mcap: 6.7e6,   buy: 16 },
    { sym: "HLIO", dir: "up",   haltAt: ago(96),   resumeAt: soon(204), price: 2.78,   vol1m: 405,  rvol: 17.8, hits: 74,  vwap: 2.29,   volume: 5.3e6,   float: 6.7e6,   mcap: 18.6e6,  buy: 66 },
    { sym: "QBIT", dir: "up",   haltAt: ago(1510), resumeAt: soon(590), price: 0.8420, vol1m: 96.2, rvol: 11.3, hits: 29,  vwap: 0.7315, volume: 18.2e6,  float: 24.3e6,  mcap: 20.5e6,  buy: 58 },
    { sym: "SOLQ", dir: "down", haltAt: ago(42),   resumeAt: soon(258), price: 7.31,   vol1m: 512,  rvol: 16.2, hits: 66,  vwap: 8.95,   volume: 2.2e6,   float: 15.6e6,  mcap: 114.0e6, buy: 24 },
    { sym: "ZENT", dir: "up",   haltAt: ago(284),  resumeAt: soon(16),  price: 0.4630, vol1m: 44.7, rvol: 9.1,  hits: 41,  vwap: 0.4188, volume: 23.9e6,  float: 72.5e6,  mcap: 33.6e6,  buy: 61 },
  ].map((h) => withSession({ ...h, time: h.haltAt })).sort((a, b) => b.time - a.time);

  /* ---- Mock live feeds -------------------------------------------------- */

  const jitter = (v, pct) => v * (1 + (Math.random() - 0.5) * 2 * pct);
  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  // Scanner alerts: one of the most active tickers fires again, hits + 1.
  const nextAlert = (seed) => (rows) => {
    const src = pick(seed.slice(0, 10));
    const prev = rows.find((r) => r.sym === src.sym) ?? src;
    const price = jitter(prev.price, 0.04);
    return {
      ...prev,
      time: new Date(),
      price,
      vwap: jitter(prev.vwap, 0.01),
      chg1: jitter(prev.chg1, 0.25),
      vol1m: Math.max(1, jitter(prev.vol1m, 0.3)),
      rvol: Math.max(1, jitter(prev.rvol, 0.1)),
      hits: prev.hits + 1,
      chg5: jitter(prev.chg5, 0.15),
      buy: Math.min(95, Math.max(5, Math.round(jitter(prev.buy, 0.08)))),
      volume: prev.volume * 1.03,
      mcap: prev.mcap * (price / prev.price),
    };
  };

  // Halts: a ticker that is not already halted gets a 5-minute LULD pause.
  const HALT_PAUSE = 5 * 60 * 1000;
  const HALT_POOL = [
    ...BULL.slice(0, 12).map((r) => ({ ...r, dir: "up" })),
    ...BEAR.slice(0, 10).map((r) => ({ ...r, dir: "down" })),
  ];
  const nextHalt = (rows) => {
    const free = HALT_POOL.filter((r) => !rows.some((h) => h.sym === r.sym));
    if (!free.length) return null;
    const src = pick(free);
    const now = Date.now();
    return {
      ...src,
      price: jitter(src.price, 0.06),
      hits: src.hits + 1,
      time: new Date(now),
      haltAt: new Date(now),
      resumeAt: new Date(now + HALT_PAUSE),
    };
  };

  /* ---- Alert sound ----------------------------------------------------------
     One setup per alert table, off by default (set in the Alert sound dialog):
     - voice: reads the ticker letter by letter (Web Speech);
     - chime: a short synthesized tone, pitched by the table's tone (Web Audio);
     - custom: the user's own audio file, kept in IndexedDB.
     Browsers only allow audio after a click, so nothing plays before one. */

  const SOUND_KEY = "scanner:sound:v1";
  const SOUND_FILES_KEY = "scanner:sound-files"; // bumped once custom files are stored
  const SOUND_MODES = ["voice", "chime", "custom"];
  const CHIME_STYLES = ["ping", "chime", "blip"];
  const SOUND_DEFAULT = { on: false, mode: "chime", chime: "ping", voice: "", rate: 1, volume: 70, file: null }; // file: { name, size }; rate: voice speed
  const MAX_SOUND_BYTES = 10 * 1024 * 1024;

  const cleanSound = (s = {}) => ({
    on: s.on === true,
    mode: SOUND_MODES.includes(s.mode) ? s.mode : SOUND_DEFAULT.mode,
    chime: CHIME_STYLES.includes(s.chime) ? s.chime : SOUND_DEFAULT.chime,
    voice: typeof s.voice === "string" ? s.voice : "",
    rate: Number.isFinite(s.rate) ? Math.round(Math.max(0.6, Math.min(1.8, s.rate)) * 10) / 10 : SOUND_DEFAULT.rate,
    volume: Number.isFinite(s.volume) ? Math.max(0, Math.min(100, s.volume)) : SOUND_DEFAULT.volume,
    file: s.file && typeof s.file.name === "string" ? { name: s.file.name, size: Number(s.file.size) || 0 } : null,
  });
  const soundPrefs = {}; // panel → setup
  const loadSoundPrefs = () => {
    for (const panel of Object.keys(soundPrefs)) delete soundPrefs[panel];
    try {
      const saved = JSON.parse(localStorage.getItem(SOUND_KEY) || "{}");
      for (const [panel, s] of Object.entries(saved || {})) soundPrefs[panel] = cleanSound(s);
    } catch { /* ignore */ }
  };
  loadSoundPrefs();
  const soundOf = (panel) => soundPrefs[panel] || cleanSound();
  const saveSoundPrefs = () => {
    try { localStorage.setItem(SOUND_KEY, JSON.stringify(soundPrefs)); } catch { /* ignore */ }
  };

  // Custom files: { panel, blob } records in IndexedDB, played from object URLs.
  const soundFiles = new Map(); // panel → object URL
  let soundDb = null;
  const openSoundDb = () => (soundDb ??= new Promise((resolve, reject) => {
    const req = indexedDB.open("scanner-sounds", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("files", { keyPath: "panel" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
  const soundStore = async (mode, fn) => {
    const db = await openSoundDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("files", mode);
      const req = fn(tx.objectStore("files"));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
    });
  };
  const setSoundFile = (panel, blob) => {
    if (soundFiles.has(panel)) URL.revokeObjectURL(soundFiles.get(panel));
    if (blob) soundFiles.set(panel, URL.createObjectURL(blob));
    else soundFiles.delete(panel);
  };
  const loadSoundFiles = () => {
    if (!("indexedDB" in window)) return;
    soundStore("readonly", (s) => s.getAll())
      .then((records) => {
        const kept = new Set(records.map((r) => r.panel));
        [...soundFiles.keys()].filter((p) => !kept.has(p)).forEach((p) => setSoundFile(p, null));
        records.forEach((r) => setSoundFile(r.panel, r.blob));
      })
      .catch(() => { /* storage blocked: custom sounds last this session only */ });
  };
  loadSoundFiles();

  // Chime: notes of [frequency, start, length] in seconds.
  let audioCtx = null;
  const audioNow = () => {
    audioCtx ??= new AudioContext();
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  };
  const CHIMES = {
    ping:  { wave: "sine",     notes: [[880, 0, 0.26]] },
    chime: { wave: "sine",     notes: [[660, 0, 0.18], [990, 0.13, 0.3]] },
    blip:  { wave: "triangle", notes: [[1320, 0, 0.07], [1320, 0.1, 0.07]] },
  };
  const PITCH = { bull: 1, halt: 0.84, bear: 0.67 };
  // Returns how long it rings, in ms.
  const playChime = (style, tone, volume) => {
    const { wave, notes } = CHIMES[style];
    const a = audioNow();
    const t0 = a.currentTime;
    const peak = 0.16 * (volume / 100);
    if (peak > 0) {
      for (const [f, at, len] of notes) {
        const osc = a.createOscillator();
        const gain = a.createGain();
        osc.type = wave;
        osc.frequency.value = f * (PITCH[tone] ?? 1);
        gain.gain.setValueAtTime(0.0001, t0 + at);
        gain.gain.exponentialRampToValueAtTime(peak, t0 + at + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + len);
        osc.connect(gain).connect(a.destination);
        osc.start(t0 + at);
        osc.stop(t0 + at + len + 0.02);
      }
    }
    return Math.max(...notes.map(([, at, len]) => at + len)) * 1000;
  };

  // Voice: "NVLX" → "N V L X", in the chosen English voice.
  const canSpeak = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
  const spell = (sym) => sym.replace(/[^A-Z0-9]/gi, "").split("").join(" ");
  const englishVoices = () => (canSpeak ? speechSynthesis.getVoices().filter((v) => /^en(-|_|$)/i.test(v.lang)) : []);
  const speak = (text, voiceURI, volume, rate = 1) => {
    if (!canSpeak) return null;
    const u = new SpeechSynthesisUtterance(text);
    const list = englishVoices();
    const voice = list.find((v) => v.voiceURI === voiceURI) || list.find((v) => v.lang === "en-US") || list[0];
    if (voice) u.voice = voice;
    u.lang = voice?.lang || "en-US";
    u.rate = rate;
    u.volume = volume / 100;
    speechSynthesis.speak(u);
    return u;
  };

  const lastSound = new Map();
  const playAlertSound = (panel, tone, sym) => {
    const s = soundOf(panel);
    if (!s.on || s.volume === 0) return;
    const now = performance.now();
    if (now - (lastSound.get(panel) || 0) < 150) return; // a burst of alerts plays once
    lastSound.set(panel, now);
    if (s.mode === "voice") {
      if (canSpeak && speechSynthesis.pending) return; // don't pile up a backlog of tickers
      speak(spell(sym), s.voice, s.volume, s.rate);
    } else if (s.mode === "custom" && soundFiles.has(panel)) {
      const clip = new Audio(soundFiles.get(panel));
      clip.volume = s.volume / 100;
      clip.play().catch(() => { /* blocked until the page gets a click */ });
    } else {
      playChime(s.chime, tone, s.volume);
    }
  };

  // Speaker icon in each alert table's bar: lit while its sound is on.
  const syncSoundButtons = () => document.querySelectorAll(".terminal [data-sound]").forEach((btn) => {
    const root = btn.closest(".terminal");
    const on = soundOf(root.dataset.panel).on;
    btn.dataset.on = String(on);
    btn.title = `Alert sound: ${on ? "on" : "off"}`;
    btn.setAttribute("aria-label", `Alert sound for ${root.dataset.title}: ${on ? "on" : "off"}`);
  });

  /* ---- Filters -------------------------------------------------------------
     Global row filters, set in the Filters dialog (rules: FILTER_RULES.md of
     the dashboard). A filter is a variable, the sessions and tables it works
     in, a condition and one or two values. A table keeps a row only if it
     passes every enabled filter aimed at (current session, that table).
     Variable and session names are the scanner's contract: keep them as is. */

  const FILTER_KEY = "scanner:filters:v1";
  const MARKET_SESSIONS = ["Regular Market", "Premarket", "Postmarket"];
  const ALL_SESSIONS = "All sessions";
  const ALL_TABLES = "All tables";
  const FILTER_TABLES = [
    ["gainers", "Gainers"], ["gainers-open", "Gainers Open"], ["volume-leaders", "Volume Leaders"],
    ["new-hod", "New HoD"], ["buying", "Buying Pressure"], ["selling", "Selling Pressure"],
    ["momentum", "Fast-Growing Momentum"], ["halts", "Halts"],
  ];
  const TABLE_NAME = Object.fromEntries(FILTER_TABLES);

  // Table sets of the compatibility matrix. Gainers Open only runs in the
  // regular session; Halts windows publish no VWAP.
  const STATUS_R = ["gainers", "gainers-open", "volume-leaders"];
  const STATUS_X = ["gainers", "volume-leaders"];
  const FLOW = ["new-hod", "buying", "selling", "momentum"];
  const ALL_R = [...STATUS_R, ...FLOW, "halts"];
  const ALL_X = [...STATUS_X, ...FLOW, "halts"];
  const inEvery = (t) => Object.fromEntries(MARKET_SESSIONS.map((s) => [s, t]));
  const EVERY_TABLE = { "Regular Market": ALL_R, Premarket: ALL_X, Postmarket: ALL_X };
  const VWAP_TABLES = { "Regular Market": [...STATUS_R, ...FLOW], Premarket: [...STATUS_X, ...FLOW], Postmarket: [...STATUS_X, ...FLOW] };

  // What each variable reads from a row, rounded as the tables show it.
  // Pmkt Vol., the gaps and the post-market changes have no column yet: the
  // mock derives them from the same day data.
  const pctVs = (v, ref) => round(((v - ref) / ref) * 100, 1);
  const absVs = (v, ref) => Number((v - ref).toFixed(Math.abs(v - ref) >= 1 ? 2 : 4));
  const asMult = (v) => round(v, v >= 100 ? 0 : 1);
  const pctOf = (v) => (v == null ? null : round(v, 1));
  const FILTER_VARS = {
    Price:        { group: "Price",    about: "Last price",                    bySession: EVERY_TABLE, get: (r) => Number(fmtPrice(r.price)) },
    VWAP:         { group: "Price",    about: "Volume-weighted average price", bySession: VWAP_TABLES, get: (r) => Number(fmtPrice(r.vwap)) },
    "VWAP D.":    { group: "Price",    about: "Distance to VWAP",              bySession: VWAP_TABLES, unit: "%", get: (r) => round(((r.price - r.vwap) / r.vwap) * 100, 2) },
    "Vol.":       { group: "Volume",   about: "Volume today",                  bySession: { "Regular Market": ALL_R, Premarket: ALL_X }, get: (r) => r.volume },
    "Pmkt Vol.":  { group: "Volume",   about: "Post-market volume",            bySession: { Postmarket: ALL_X }, get: (r) => r.volume },
    RVol:         { group: "Volume",   about: "Relative volume",               bySession: EVERY_TABLE, unit: "x", get: (r) => asMult(r.rvol) },
    "Vol. 1m":    { group: "Volume",   about: "1-minute volume vs. normal",    bySession: inEvery(FLOW), unit: "x", get: (r) => asMult(r.vol1m) },
    "%Gap":       { group: "Change",   about: "% gap vs. previous close",      bySession: { Premarket: ALL_X }, unit: "%", get: (r) => pctVs(r.open, r.close) },
    Gap:          { group: "Change",   about: "Gap vs. previous close",        bySession: { Premarket: STATUS_X }, get: (r) => absVs(r.open, r.close) },
    "%Chg Close": { group: "Change",   about: "% change vs. previous close",   bySession: { "Regular Market": ALL_R }, unit: "%", get: (r) => pctVs(r.price, r.close) },
    "Chg Close":  { group: "Change",   about: "Change vs. previous close",     bySession: { "Regular Market": STATUS_R }, get: (r) => absVs(r.price, r.close) },
    "%Chg Open":  { group: "Change",   about: "% change vs. today's open",     bySession: { "Regular Market": ALL_R }, unit: "%", get: (r) => pctVs(r.price, r.open) },
    "Chg Open":   { group: "Change",   about: "Change vs. today's open",       bySession: { "Regular Market": STATUS_R }, get: (r) => absVs(r.price, r.open) },
    "%Chg Pmkt":  { group: "Change",   about: "% change after the close",      bySession: { Postmarket: ALL_X }, unit: "%", get: (r) => pctVs(r.price, r.close) },
    "Chg Pmkt":   { group: "Change",   about: "Change after the close",        bySession: { Postmarket: STATUS_X }, get: (r) => absVs(r.price, r.close) },
    "%Chg 1m":    { group: "Momentum", about: "% change, last minute",         bySession: inEvery(FLOW), unit: "%", get: (r) => pctOf(r.chg1) },
    "%Chg 5m":    { group: "Momentum", about: "% change, last 5 minutes",      bySession: inEvery(["momentum"]), unit: "%", get: (r) => pctOf(r.chg5) },
    "%Chg 15m":   { group: "Momentum", about: "% change, last 15 minutes",     bySession: inEvery(["momentum"]), unit: "%", get: (r) => pctOf(r.chg15) },
    "%Chg 30m":   { group: "Momentum", about: "% change, last 30 minutes",     bySession: inEvery(["momentum"]), unit: "%", get: (r) => pctOf(r.chg30) },
    Hits:         { group: "Momentum", about: "Alerts fired today",            bySession: inEvery(["new-hod"]), get: (r) => r.hits },
    Float:        { group: "Size",     about: "Shares free to trade",          bySession: EVERY_TABLE, get: (r) => r.float },
    MCap:         { group: "Size",     about: "Market cap",                    bySession: EVERY_TABLE, get: (r) => r.mcap },
  };
  const isFilterVar = (v) => Object.hasOwn(FILTER_VARS, v);

  // What the scanner can publish, per variable (and per table where that
  // differs). Multipliers are plain here (1 = 1x), as the tables show them.
  const FILTER_LIMITS = {
    Price: { default: { min: 0.1, max: 50, minLabel: "0.1", maxLabel: "50" } },
    "Vol.": { default: { min: 5e3, minLabel: "5K" } },
    "Pmkt Vol.": { default: { min: 5e3, minLabel: "5K" } },
    Float: { default: { max: 200e6, maxLabel: "200M" } },
    MCap: { default: { min: 1e6, minLabel: "1M" } },
    "%Chg 1m": { default: { min: 2.5, minLabel: "2.5%" }, byTable: { selling: { max: -2.5, maxLabel: "-2.5%" } } },
    "%Chg 5m": { default: { min: 3, minLabel: "3%" } },
    "%Chg 15m": { default: { min: 5, minLabel: "5%" } },
    "%Chg 30m": { default: { min: 8, minLabel: "8%" } },
    Hits: { default: { min: 1, minLabel: "1" } },
    "Vol. 1m": { default: { min: 1, minLabel: "1x" } },
  };

  // Conditions: the stored name, and the short form the chips show.
  const FILTER_OPS = [
    ["between", "Between"], ["not between", "Not between"],
    ["less than", "<"], ["less than or equal to", "≤"],
    ["greater than", ">"], ["greater than or equal to", "≥"],
    ["equal to", "="], ["not equal to", "≠"],
  ];
  const OP_SHORT = Object.fromEntries(FILTER_OPS);
  const isRangeOp = (op) => op === "between" || op === "not between";
  const valueCount = (op) => (isRangeOp(op) ? 2 : 1);

  /* Values: negatives, decimals, thousands separators and K/M/B. The % or x
     of a percent or multiplier variable sits beside the field, so typing it
     is fine but it is not kept. */
  const VALUE_RE = /^-?(?:\d{1,3}(?:,\d{3})*|\d+)(?:\.\d+)?[KMB]?[x%]?$/i;
  const formatValue = (value, variable) => {
    const src = String(value ?? "").trim();
    const typed = /[x%]\s*$/i.exec(src);
    const suffix = FILTER_VARS[variable]?.unit || !typed ? "" : typed[0].trim().toLowerCase();
    let s = src.replace(/[x%]\s*$/i, "").replace(/[^\d.KMB]/gi, "");
    const mag = (/[KMB]/i.exec(s)?.[0] || "").toUpperCase();
    s = s.replace(/[KMB]/gi, "");
    const dot = s.indexOf(".");
    let int = (dot >= 0 ? s.slice(0, dot) : s).replace(/^0+(?=\d)/, "");
    const dec = dot >= 0 ? s.slice(dot + 1).replace(/\./g, "") : null;
    int = int ? int.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : dec !== null ? "0" : "";
    return `${src.startsWith("-") ? "-" : ""}${int}${dec !== null ? `.${dec}` : ""}${mag}${suffix}`;
  };
  const isValidValue = (value, variable) => {
    const v = String(value ?? "").trim();
    const unit = FILTER_VARS[variable]?.unit;
    return VALUE_RE.test(v) && (!/x$/i.test(v) || unit === "x") && (!/%$/.test(v) || unit === "%");
  };
  const parseValue = (value) => {
    const m = /^(-?\d*\.?\d+)([KMB])?$/i.exec(String(value ?? "").trim().replace(/,/g, "").replace(/[x%]$/i, ""));
    return m ? Number(m[1]) * ({ K: 1e3, M: 1e6, B: 1e9 }[m[2]?.toUpperCase()] || 1) : NaN;
  };

  /* Sessions and tables. Stored as { allSessions, sessions } and
     { allTables, tables }; picking every option equals picking "All". */
  const sessionsOf = (variable) => MARKET_SESSIONS.filter((s) => FILTER_VARS[variable]?.bySession[s]?.length);
  const tablesIn = (variable, session) => FILTER_VARS[variable]?.bySession[session] || [];
  const normSessions = (sel, variable) => {
    const picked = sessionsOf(variable).filter((s) => sel?.allSessions === true || (Array.isArray(sel?.sessions) && sel.sessions.includes(s)));
    if (!picked.length) return null;
    return picked.length === MARKET_SESSIONS.length ? { allSessions: true, sessions: [] } : { allSessions: false, sessions: picked };
  };
  const pickedSessions = (variable, sel) => {
    const n = normSessions(sel, variable);
    return !n ? [] : n.allSessions ? MARKET_SESSIONS : n.sessions;
  };
  // Every table the chosen sessions allow, in display order.
  const eligibleTables = (variable, sel) => {
    const sessions = pickedSessions(variable, sel);
    return FILTER_TABLES.map(([k]) => k).filter((k) => sessions.some((s) => tablesIn(variable, s).includes(k)));
  };
  const normScope = (scope, variable, sessions) => {
    const eligible = eligibleTables(variable, sessions);
    if (!eligible.length) return null;
    const picked = eligible.filter((k) => scope?.allTables === true || (Array.isArray(scope?.tables) && scope.tables.includes(k)));
    if (!picked.length) return null;
    return picked.length === eligible.length && eligible.length > 1 ? { allTables: true, tables: [] } : { allTables: false, tables: picked };
  };
  const hasSessions = (f) => f.sessions.allSessions || f.sessions.sessions.length > 0;
  const hasScope = (f) => f.scope.allTables || f.scope.tables.length > 0;
  const sameJSON = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  const isFilterComplete = (f) => {
    const values = f.values.slice(0, valueCount(f.operator));
    return isFilterVar(f.variable)
      && sameJSON(normSessions(f.sessions, f.variable), f.sessions)
      && sameJSON(normScope(f.scope, f.variable, f.sessions), f.scope)
      && Object.hasOwn(OP_SHORT, f.operator)
      && values.length === valueCount(f.operator)
      && values.every((v) => isValidValue(v, f.variable));
  };

  // The (session, table) pairs a filter really covers: not the cross product
  // of both picks, only the pairs where the variable exists.
  const filterTargets = (f) => {
    if (!isFilterVar(f.variable) || !hasSessions(f) || !hasScope(f)) return [];
    return pickedSessions(f.variable, f.sessions).flatMap((s) => tablesIn(f.variable, s)
      .filter((k) => f.scope.allTables || f.scope.tables.includes(k))
      .map((k) => `${s}|${k}`));
  };
  // Identity: variable, targets, condition and values on the comparison
  // scale (a range typed high-to-low is the same range).
  const filterSignature = (f) => {
    if (!isFilterComplete(f)) return "";
    const values = f.values.slice(0, valueCount(f.operator)).map(parseValue);
    if (isRangeOp(f.operator)) values.sort((a, b) => a - b);
    return JSON.stringify([f.variable, filterTargets(f).sort(), f.operator, values]);
  };

  /* Validation. Messages describe the invalid state; they don't give orders. */

  // No two identical filters (on or off), and no two enabled filters of one
  // variable on the same (session, table).
  const filterConflict = (f, list) => {
    const others = list.filter((o) => o.id !== f.id && isFilterComplete(o));
    const sig = filterSignature(f);
    if (sig && others.some((o) => filterSignature(o) === sig)) {
      return { type: "duplicate", message: "An identical filter already exists.", notice: "An identical filter has already been created." };
    }
    if (!f.enabled) return null;
    const mine = new Set(filterTargets(f));
    const pair = others.filter((o) => o.enabled && o.variable === f.variable).flatMap(filterTargets).find((p) => mine.has(p));
    if (!pair) return null;
    const [session, key] = pair.split("|");
    const message = `${f.variable} is already filtered in ${session} for ${TABLE_NAME[key]}.`;
    return { type: "overlap", message, notice: message };
  };

  const limitText = (l) => (l.min !== undefined && l.max !== undefined ? `between ${l.minLabel} and ${l.maxLabel}`
    : l.min !== undefined ? `${l.minLabel} or higher` : `${l.maxLabel} or lower`);
  // The distinct limits of the tables a filter is aimed at.
  const filterLimits = (f) => {
    const cfg = FILTER_LIMITS[f.variable];
    if (!cfg || !hasScope(f)) return [];
    const aimed = eligibleTables(f.variable, f.sessions).filter((k) => f.scope.allTables || f.scope.tables.includes(k));
    const limits = [...new Set(aimed.map((k) => cfg.byTable?.[k] || cfg.default))];
    return limits.length ? limits : [cfg.default];
  };
  const inLimit = (n, l) => (l.min === undefined || n >= l.min) && (l.max === undefined || n <= l.max);
  // Can the condition match anything inside the limit?
  const canMatch = (op, [a, b], l) => {
    const lo = l.min ?? -Infinity;
    const hi = l.max ?? Infinity;
    if (op === "between") return hi >= Math.min(a, b) && lo <= Math.max(a, b);
    if (op === "not between") return lo < Math.min(a, b) || hi > Math.max(a, b);
    if (op === "less than") return lo < a;
    if (op === "less than or equal to") return lo <= a;
    if (op === "greater than") return hi > a;
    if (op === "greater than or equal to") return hi >= a;
    if (op === "equal to") return inLimit(a, l);
    if (op === "not equal to") return lo !== hi || lo !== a;
    return true;
  };

  // null, or { type, message, notice?, invalid: value indexes at fault }
  const validateFilter = (f, list) => {
    const conflict = filterConflict(f, list);
    if (conflict) return { ...conflict, invalid: [] };
    if (!f.operator) return null;
    const values = f.values.slice(0, valueCount(f.operator));
    const unit = FILTER_VARS[f.variable]?.unit;
    const badFormat = values.flatMap((v, i) => (String(v).trim() && !isValidValue(v, f.variable) ? [i] : []));
    if (badFormat.length) {
      const message = unit === "%" ? "Percentage values must be valid numbers, such as 2.8."
        : unit === "x" ? "Multiplier values must be valid numbers, such as 2.8." : "Filter values must be valid numbers.";
      return { type: "format", message, invalid: badFormat };
    }
    const limits = filterLimits(f);
    if (!limits.length || values.length < valueCount(f.operator) || !values.every((v) => isValidValue(v, f.variable))) return null;
    const nums = values.map(parseValue);
    const outside = nums.flatMap((n, i) => (limits.some((l) => inLimit(n, l)) ? [] : [i]));
    if (!outside.length && limits.some((l) => canMatch(f.operator, nums, l))) return null;
    const rule = `${f.variable} values must be ${limits.map(limitText).join(" or ")}.`;
    return outside.length
      ? { type: "limit", message: rule, invalid: outside }
      : { type: "limit", message: `The selected ${f.variable} ${isRangeOp(f.operator) ? "range" : "condition"} has no matches; ${rule}`, invalid: nums.map((_, i) => i) };
  };
  const isFilterValid = (f, list) => isFilterComplete(f) && !validateFilter(f, list);

  /* Saved filters: best effort (storage may be blocked). Invalid ones are
     dropped on load; so are later duplicates and later enabled filters that
     overlap one already kept. */
  const newFilterId = () => globalThis.crypto?.randomUUID?.() ?? `f-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const cleanFilter = (c, ids) => {
    if (!c || typeof c !== "object" || !isFilterVar(c.variable)) return null;
    const sessions = normSessions(c.sessions, c.variable);
    const scope = sessions && normScope(c.scope, c.variable, sessions);
    if (!scope) return null;
    const id = typeof c.id === "string" && c.id && !ids.has(c.id) ? c.id : newFilterId();
    const values = (Array.isArray(c.values) ? c.values : []).slice(0, valueCount(c.operator)).map((v) => formatValue(v, c.variable));
    const f = { id, variable: c.variable, sessions, scope, operator: c.operator, values, enabled: c.enabled !== false };
    if (!isFilterComplete(f)) return null;
    ids.add(id);
    return f;
  };
  const filters = [];
  const saveFilters = () => {
    try { localStorage.setItem(FILTER_KEY, JSON.stringify(filters)); } catch { /* ignore */ }
  };
  const loadFilters = () => {
    filters.length = 0;
    try {
      const raw = localStorage.getItem(FILTER_KEY);
      const saved = JSON.parse(raw || "[]");
      const ids = new Set();
      (Array.isArray(saved) ? saved : []).forEach((c) => {
        const f = cleanFilter(c, ids);
        if (f && !filterConflict(f, filters)) filters.push(f);
      });
      if (raw && raw !== JSON.stringify(filters)) saveFilters();
    } catch { /* ignore */ }
  };
  loadFilters();

  // The session filters follow: the nav status (mountNavStatus) keeps it.
  // Outside trading hours the post-market filters stay in force.
  const FILTER_SESSION_OF = { pre: "Premarket", regular: "Regular Market", after: "Postmarket", closed: "Postmarket" };
  let marketState = "closed";
  const filterSession = () => FILTER_SESSION_OF[marketState];
  const onSessionChange = [];

  const passesFilter = (f, r) => {
    const v = FILTER_VARS[f.variable].get(r);
    if (v == null) return true; // no such value in this row: nothing to judge
    if (!Number.isFinite(v)) return false;
    const [a, b] = f.values.map(parseValue);
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    switch (f.operator) {
      case "between": return v >= lo && v <= hi;
      case "not between": return v < lo || v > hi;
      case "less than": return v < a;
      case "less than or equal to": return v <= a;
      case "greater than": return v > a;
      case "greater than or equal to": return v >= a;
      case "equal to": return v === a;
      case "not equal to": return v !== a;
      default: return true;
    }
  };
  // Enabled filters aimed at this table in the current session.
  const filtersOn = (panel, list = filters) => {
    const pair = `${filterSession()}|${panel}`;
    return list.filter((f) => f.enabled && filterTargets(f).includes(pair));
  };

  /* ---- Table controller -------------------------------------------------- */

  // Fill a panel from the shared <template>. Anything already inside it
  // (e.g. a chart) goes between the bar and the table.
  const panelTpl = document.getElementById("terminal-tpl");
  const buildPanel = (root) => {
    const { panel, title, kind } = root.dataset;
    const extras = [...root.children];
    root.append(panelTpl.content.cloneNode(true));
    root.querySelector(".terminal-bar").after(...extras);
    const titleEl = root.querySelector(".terminal-title");
    titleEl.id = `${panel}-title`;
    titleEl.textContent = title;
    root.setAttribute("role", "region");
    root.setAttribute("aria-labelledby", titleEl.id);
    root.querySelectorAll("[data-label]").forEach((el) => {
      el.setAttribute("aria-label", el.dataset.label.replace("{title}", title));
      el.removeAttribute("data-label");
    });
    // Toplists are snapshots, not alerts: nothing to sound.
    if (kind === "toplist") root.querySelector("[data-sound]").remove();

    /* Fullscreen: the panel takes the whole screen (Fullscreen API; Esc
       leaves). Where the API is missing or refused — e.g. iPhone Safari —
       the panel is maximized over the page instead. */
    const fsBtn = root.querySelector("[data-fullscreen]");
    const setFull = (on, fallback = false) => {
      root.classList.toggle("is-full", on);
      root.classList.toggle("is-maximized", on && fallback);
      document.documentElement.classList.toggle("has-maximized", on && fallback);
      fsBtn.setAttribute("aria-pressed", String(on));
      fsBtn.title = on ? "Exit fullscreen" : "Fullscreen";
      fsBtn.setAttribute("aria-label", `${on ? "Exit fullscreen" : "Fullscreen"}: ${title}`);
    };
    fsBtn.addEventListener("click", () => {
      if (document.fullscreenElement === root) document.exitFullscreen();
      else if (root.classList.contains("is-maximized")) setFull(false);
      else if (root.requestFullscreen) root.requestFullscreen().catch(() => setFull(true, true));
      else setFull(true, true);
    });
    document.addEventListener("fullscreenchange", () => {
      if (!root.classList.contains("is-maximized")) setFull(document.fullscreenElement === root);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && root.classList.contains("is-maximized")) setFull(false);
    });

    // Detach: every click opens one more live copy in its own window.
    const detachBtn = root.querySelector(".detach-icon");
    if (canDetach) detachBtn.addEventListener("click", () => openCopy(root));
    else detachBtn.remove();
  };

  // `relay` hands every alert and price tick of the live feed to the
  // detached copies; the API returned is how a copy is fed.
  const mountTable = (root, seed, { cols, pins = PINNED, next, every = LIVE_INTERVAL, expires = false, quotes = false, onAlert, onRender, relay }) => {
    const tone = root.dataset.tone;
    const panel = root.dataset.panel;
    const table = root.querySelector(".scan-table");
    const headRow = table.querySelector("thead tr");
    const body = table.querySelector("tbody");
    const wrap = root.querySelector(".table-wrap");
    const cards = root.querySelector("[data-cards]");
    const soundBtn = root.querySelector("[data-sound]");
    const rows = seed.map((r) => ({ ...r }));
    let order = loadOrder(panel, cols);
    let prefs = loadPrefs(panel, cols);

    const columns = () => [...pins, ...order.filter((k) => !prefs.hidden.has(k))];
    const isExcluded = (sym) => prefs.excluded.has(sym) || globalExcluded.has(sym);
    // Rows on screen: not excluded, and passing every filter on this table.
    const shownTest = () => {
      const on = filtersOn(panel);
      return (r) => !isExcluded(r.sym) && on.every((f) => passesFilter(f, r));
    };
    const applyColors = () => Object.keys(COLORABLE).forEach((k) => {
      if (prefs.colors[k]) root.style.setProperty(`--hue-${k}`, `var(--${prefs.colors[k]})`);
      else root.style.removeProperty(`--hue-${k}`);
    });
    const colgroup = table.insertBefore(document.createElement("colgroup"), table.firstChild);
    const FILL = '<td class="col-fill" aria-hidden="true"></td>';

    // Ticker sticks right after Signal (--pin-sym). It gets there once the
    // columns between them (Time, in the alert tables) have scrolled away:
    // `stickAt` is that scroll distance. Whole pixels, nothing to measure.
    table.style.setProperty("--pin-sym", `${COL.sig.w}px`);
    const stickAt = pins.slice(1, pins.indexOf("sym")).reduce((sum, key) => sum + COL[key].w, 0);

    /* Header + rows */

    const renderHead = () => {
      const keys = columns();
      // Fixed layout: each column gets exactly its width; a trailing filler
      // column soaks up any spare room so the others never stretch.
      colgroup.replaceChildren(...keys.map((key) => {
        const col = document.createElement("col");
        col.style.width = `${COL[key].w}px`;
        return col;
      }), document.createElement("col"));
      table.style.minWidth = `${keys.reduce((sum, key) => sum + COL[key].w, 0)}px`;

      const fill = document.createElement("th");
      fill.className = "col-fill";
      fill.setAttribute("aria-hidden", "true");
      headRow.replaceChildren(...keys.map((key) => {
        const c = COL[key];
        const th = document.createElement("th");
        th.scope = "col";
        th.dataset.key = key;
        th.className = cellClass(c);
        if (c.title) th.title = c.title;
        th.innerHTML = c.srOnly ? `<span class="sr-only">${c.label}</span>` : c.label;
        if (!c.pinned) {
          th.draggable = true;
          th.tabIndex = 0;
          th.setAttribute("aria-description", "Drag, or Alt + arrow keys, to move this column");
        }
        return th;
      }), fill);
    };

    const rowEl = (d, sym) => {
      const tr = document.createElement("tr");
      tr.dataset.sym = sym;
      tr.innerHTML = columns().map((key) => `<td class="${cellClass(COL[key])}">${d[key]}</td>`).join("") + FILL;
      return tr;
    };

    const cardEl = (d, sym) => {
      const el = document.createElement("article");
      el.className = "alert-card";
      el.dataset.sym = sym;
      el.dataset.float = d.tier;
      el.innerHTML = renderCard(d);
      return el;
    };

    const renderAll = () => {
      renderHead();
      const derived = rows.filter(shownTest()).map((r) => [derive(r, tone), r.sym]);
      body.replaceChildren(...derived.map(([d, sym]) => rowEl(d, sym)));
      cards.replaceChildren(...derived.map(([d, sym]) => cardEl(d, sym)));
      tickTimers();
      feed?.sync();
      onRender?.();
    };

    /* Column drag & drop */

    const moveColumn = (key, targetKey, after) => {
      if (key === targetKey) return;
      const next = order.filter((k) => k !== key);
      const i = next.indexOf(targetKey) + (after ? 1 : 0);
      next.splice(i, 0, key);
      order = next;
      saveOrder(panel, order);
      renderAll();
    };

    let dragKey = null;
    const clearDrop = () => headRow.querySelectorAll(".drop-before, .drop-after")
      .forEach((th) => th.classList.remove("drop-before", "drop-after"));

    headRow.addEventListener("dragstart", (e) => {
      const th = e.target.closest("th[draggable]");
      if (!th) return;
      dragKey = th.dataset.key;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", dragKey);
      th.classList.add("is-dragging");
      table.dataset.dragging = dragKey;
    });

    headRow.addEventListener("dragover", (e) => {
      const th = e.target.closest("th[draggable]");
      if (!th || !dragKey) return;
      e.preventDefault();
      const box = th.getBoundingClientRect();
      const after = e.clientX > box.left + box.width / 2;
      clearDrop();
      if (th.dataset.key !== dragKey) th.classList.add(after ? "drop-after" : "drop-before");
    });

    headRow.addEventListener("drop", (e) => {
      const th = e.target.closest("th[draggable]");
      if (!th || !dragKey) return;
      e.preventDefault();
      moveColumn(dragKey, th.dataset.key, th.classList.contains("drop-after"));
    });

    headRow.addEventListener("dragend", () => {
      dragKey = null;
      delete table.dataset.dragging;
      clearDrop();
      headRow.querySelectorAll(".is-dragging").forEach((th) => th.classList.remove("is-dragging"));
    });

    // Keyboard alternative: Alt + ←/→ on a focused header.
    headRow.addEventListener("keydown", (e) => {
      const th = e.target.closest("th[draggable]");
      if (!th || !e.altKey || !["ArrowLeft", "ArrowRight"].includes(e.key)) return;
      e.preventDefault();
      const key = th.dataset.key;
      const shown = order.filter((k) => !prefs.hidden.has(k));
      const i = shown.indexOf(key);
      const j = e.key === "ArrowLeft" ? i - 1 : i + 1;
      if (j < 0 || j >= shown.length) return;
      moveColumn(key, shown[j], e.key === "ArrowRight");
      headRow.querySelector(`[data-key="${key}"]`).focus();
    });

    /* Live feed: the newest alert goes on top; a ticker already listed
       moves up instead of appearing twice. */

    const pushAlert = (alert) => {
      const i = rows.findIndex((r) => r.sym === alert.sym);
      if (i >= 0) rows.splice(i, 1);
      rows.unshift(alert);
      rows.length = Math.min(rows.length, MAX_ROWS);
      onAlert?.(alert); // every alert, shown or not (the chart applies its own test)
      // Excluded or filtered-out tickers are tracked but never shown (nor
      // sounded); an earlier row of the ticker leaves, as it no longer passes.
      body.querySelector(`[data-sym="${alert.sym}"]`)?.remove();
      if (!shownTest()(alert)) return;

      const d = derive(alert, tone);
      const tr = rowEl(d, alert.sym);
      tr.classList.add("is-new");
      body.prepend(tr);
      while (body.children.length > MAX_ROWS) body.lastElementChild.remove();

      const card = cardEl(d, alert.sym);
      card.classList.add("is-new");
      feed.insert(card);
      tickTimers();
      if (!DETACHED) playAlertSound(panel, tone, alert.sym); // the main window sounds it
    };

    const feed = mountCardFeed(root.querySelector(".card-view"));

    // Halts: once a ticker resumes trading its alert leaves the table.
    const dropResumed = () => {
      const now = Date.now();
      for (const r of rows.filter((row) => row.resumeAt <= now)) {
        rows.splice(rows.indexOf(r), 1);
        const tr = body.querySelector(`[data-sym="${r.sym}"]`);
        if (tr) {
          tr.classList.add("is-leaving");
          tr.addEventListener("animationend", () => tr.remove(), { once: true });
          if (reduceMotion.matches) tr.remove();
        }
        feed.remove(r.sym);
      }
    };

    /* Toolbar */

    soundBtn?.addEventListener("click", () => soundSettings.open(panel, soundBtn));

    // Edge shadow on Ticker while it is stuck. With display scaling scrollLeft
    // can rest a fraction of a pixel off 0; that still counts as "not stuck".
    // The class only changes when the state flips, so scrolling itself
    // triggers no style work.
    let stuck = false;
    wrap.addEventListener("scroll", () => {
      const now = wrap.scrollLeft >= Math.max(stickAt, 1);
      if (now !== stuck) wrap.classList.toggle("is-stuck", (stuck = now));
    }, { passive: true });

    /* Live prices (toplists): a changed price flashes green when it ticks
       up, red when it ticks down — in the table cell and on the card. */

    const flash = (el, up) => {
      el.classList.remove("flash-up", "flash-down");
      void el.offsetWidth; // restart the animation if it is still running
      el.classList.add(up ? "flash-up" : "flash-down");
    };

    const setPrice = (r, price) => {
      const before = fmtPrice(r.price);
      r.price = price;
      const after = fmtPrice(r.price);
      if (after === before) return;
      const up = Number(after) > Number(before);
      // Refresh every cell that follows the price (%Chg Close, VWAP D., …)
      const tr = body.querySelector(`[data-sym="${r.sym}"]`);
      // The new price crossed a filter: the row joins or leaves the table.
      if (Boolean(tr) !== shownTest()(r)) { renderAll(); return; }
      if (tr) {
        const d = derive(r, tone);
        columns().forEach((key, i) => {
          const td = tr.children[i];
          if (td.innerHTML !== d[key]) td.innerHTML = d[key];
        });
        const priceAt = columns().indexOf("price");
        if (priceAt >= 0) flash(tr.children[priceAt], up);
      }
      const cardPrice = cards.querySelector(`[data-sym="${r.sym}"] .card-price`);
      if (cardPrice) { cardPrice.textContent = after; flash(cardPrice, up); }
    };

    const tickPrices = () => {
      const count = 1 + Math.floor(Math.random() * 3);
      for (let n = 0; n < count; n++) {
        const r = pick(rows);
        const price = jitter(r.price, 0.015);
        relay?.({ type: "quote", sym: r.sym, price });
        setPrice(r, price);
      }
    };

    // Drop the class once done so re-renders never replay a stale flash.
    root.addEventListener("animationend", (e) => {
      if (/^flash(Up|Down)$/.test(e.animationName)) e.target.classList.remove("flash-up", "flash-down");
    });

    /* Table settings: the dialog drafts a copy of this state and hands it
       back on Save. */
    tables.set(panel, {
      title: root.dataset.title,
      tone: getComputedStyle(root).getPropertyValue("--tone").trim(),
      pins,
      defaults: cols,
      rows: () => rows,
      excluded: isExcluded,
      shows: shownTest,
      state: () => ({ order: [...order], hidden: new Set(prefs.hidden), colors: { ...prefs.colors }, excluded: new Set(prefs.excluded) }),
      apply: (s) => {
        order = [...s.order];
        prefs = { hidden: new Set(s.hidden), colors: { ...s.colors }, excluded: new Set(s.excluded) };
        saveOrder(panel, order);
        savePrefs(panel, prefs);
        applyColors();
        renderAll();
      },
      refresh: renderAll,
      // Settings saved in another window (a detached copy, or the main one).
      reload: () => {
        order = loadOrder(panel, cols);
        prefs = loadPrefs(panel, cols);
        applyColors();
        renderAll();
      },
    });
    const settingsBtn = root.querySelector("[data-settings]");
    settingsBtn.addEventListener("click", () => tableSettings.open(panel, settingsBtn));

    const dropExpired = () => rows.splice(0, rows.length, ...rows.filter((r) => r.resumeAt > Date.now()));
    if (expires) {
      dropExpired();
      onTick.push(dropResumed);
    }
    applyColors();
    renderAll();
    if (next) {
      setInterval(() => {
        const alert = next(rows);
        if (!alert) return;
        relay?.({ type: "alert", row: alert });
        pushAlert(alert);
      }, every + Math.random() * 1500);
    }
    if (quotes) setInterval(tickPrices, QUOTE_INTERVAL + Math.random() * 600);

    return {
      push: pushAlert,
      quote: (sym, price) => {
        const r = rows.find((row) => row.sym === sym);
        if (r) setPrice(r, price);
      },
      // A fresh snapshot of the feed (a detached copy linking up again).
      reset: (list) => {
        rows.splice(0, rows.length, ...list.slice(0, MAX_ROWS));
        if (expires) dropExpired();
        renderAll();
      },
    };
  };

  /* ---- Mobile card feed --------------------------------------------------
     - Every new alert lands on top and pushes every earlier card down one
       slot; a ticker that fires again gets a new card, its older ones stay.
     - At the top: the push is animated.
     - Scrolled away: the view stays put and a "new" pill counts what
       arrived above.
     - A custom scrollbar rail, since iOS hides native ones. */

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

  const mountCardFeed = (view) => {
    const list = view.querySelector("[data-cards]");
    const pill = view.querySelector("[data-new-pill]");
    const pillCount = view.querySelector("[data-new-count]");
    const rail = view.querySelector("[data-rail]");
    const thumb = rail.firstElementChild;
    const slides = new WeakMap(); // card → its running slide/entry animation
    let unseen = 0;

    const atTop = () => list.scrollTop <= 2;
    const scrollListTo = (top) => {
      if (Math.round(top) !== Math.round(list.scrollTop)) list.scrollTop = top;
    };

    const syncRail = () => {
      const { scrollTop, scrollHeight, clientHeight } = list;
      const ratio = clientHeight / (scrollHeight || 1);
      rail.hidden = ratio >= 1;
      const h = Math.max(28, ratio * rail.clientHeight);
      const travel = rail.clientHeight - h;
      thumb.style.height = `${h}px`;
      thumb.style.transform = `translateY(${(scrollTop / (scrollHeight - clientHeight || 1)) * travel}px)`;
    };

    const setUnseen = (n) => {
      unseen = n;
      pill.hidden = n === 0;
      pillCount.textContent = String(n);
    };

    list.addEventListener("scroll", () => {
      if (atTop()) setUnseen(0);
      syncRail();
    }, { passive: true });

    pill.addEventListener("click", () => list.scrollTo({ top: 0, behavior: reduceMotion.matches ? "auto" : "smooth" }));

    // Drag the rail thumb (or tap the rail) to scroll.
    rail.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      rail.setPointerCapture(e.pointerId);
      rail.classList.add("is-active");
      const box = rail.getBoundingClientRect();
      const grab = e.target === thumb ? e.clientY - thumb.getBoundingClientRect().top : thumb.offsetHeight / 2;
      const move = (ev) => {
        const travel = box.height - thumb.offsetHeight;
        const pos = Math.min(travel, Math.max(0, ev.clientY - box.top - grab));
        list.scrollTop = (pos / (travel || 1)) * (list.scrollHeight - list.clientHeight);
      };
      const up = () => {
        rail.classList.remove("is-active");
        rail.removeEventListener("pointermove", move);
        rail.removeEventListener("pointerup", up);
        rail.removeEventListener("pointercancel", up);
      };
      move(e);
      rail.addEventListener("pointermove", move);
      rail.addEventListener("pointerup", up);
      rail.addEventListener("pointercancel", up);
    });

    const insert = (card) => {
      const visible = list.offsetParent !== null;
      const top = visible && atTop();

      // FLIP: remember where the cards on screen are right now — measured
      // with the transform of a slide still in flight, so alerts arriving in
      // quick succession keep pushing smoothly instead of jumping.
      const first = new Map();
      let anchor = null;
      let anchorOffset = 0;
      if (top) {
        const limit = list.getBoundingClientRect().bottom + list.clientHeight / 2;
        for (const el of list.children) {
          const y = el.getBoundingClientRect().top;
          if (y > limit) break;
          first.set(el, y);
        }
      } else if (visible) {
        anchor = [...list.children].find((el) => el.offsetTop + el.offsetHeight > list.scrollTop);
        anchorOffset = anchor ? anchor.offsetTop - list.scrollTop : 0;
      }

      list.prepend(card);
      while (list.children.length > MAX_ROWS) list.lastElementChild.remove();

      if (top) {
        scrollListTo(0);
        // …then slide every one of them down to its new spot.
        if (!reduceMotion.matches) {
          first.forEach((y, el) => {
            if (!el.isConnected) return;
            slides.get(el)?.cancel();
            const dy = y - el.getBoundingClientRect().top;
            if (dy) {
              slides.set(el, el.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 420, easing: EASE }));
            }
          });
          slides.set(card, card.animate(
            [{ opacity: 0, transform: "translateY(-10px) scale(0.98)" }, { opacity: 1, transform: "none" }],
            { duration: 320, delay: 90, easing: EASE, fill: "backwards" },
          ));
        }
      } else if (visible) {
        if (anchor?.isConnected) scrollListTo(anchor.offsetTop - anchorOffset);
        setUnseen(unseen + 1);
      }
      syncRail();
    };

    // An alert that leaves (a halt that resumed) folds away; cards below
    // slide up into its place. Above the viewport it goes instantly and the
    // scroll position compensates, so what the user is reading stays put.
    const remove = (sym) => {
      const el = list.querySelector(`[data-sym="${sym}"]:not(.is-leaving)`);
      if (!el) return;
      const visible = list.offsetParent !== null;
      if (!visible || reduceMotion.matches || el.offsetTop + el.offsetHeight <= list.scrollTop) {
        const shift = visible && el.offsetTop < list.scrollTop
          ? el.offsetHeight + parseFloat(getComputedStyle(list).rowGap || 0) : 0;
        el.remove();
        if (shift) scrollListTo(list.scrollTop - shift);
        syncRail();
        return;
      }
      el.classList.add("is-leaving");
      const gap = parseFloat(getComputedStyle(list).rowGap || 0);
      el.animate(
        [
          { opacity: 1, height: `${el.offsetHeight}px`, marginBottom: "0px" },
          { opacity: 0, height: "0px", marginBottom: `${-gap}px`, paddingBlock: "0px" },
        ],
        { duration: 380, easing: EASE },
      ).finished.then(() => { el.remove(); syncRail(); });
    };

    const ro = new ResizeObserver(syncRail);
    ro.observe(list);
    syncRail();
    return { insert, remove, sync: syncRail };
  };

  /* ---- Halt timers --------------------------------------------------------
     Duration counts up from the halt; Resume Est. counts down to resumption.
     When the countdown ends the ticker has resumed and its alert is removed. */

  const DUE_SOON = 60 * 1000;
  const onTick = [];

  function tickTimers() {
    const now = Date.now();
    document.querySelectorAll("[data-timer]").forEach((el) => {
      const since = Number(el.dataset.since);
      const until = Number(el.dataset.until);
      const left = until - now;
      el.textContent = el.dataset.timer === "duration"
        ? fmtClock(Math.min(now, until) - since)
        : fmtClock(left);
      if (el.dataset.timer === "resume") el.classList.toggle("is-soon", left > 0 && left <= DUE_SOON);
    });
  }

  /* ---- Layout: resizable panes --------------------------------------------
     - The line between the toplists and the rest sets the toplists' width.
     - The line between the two alert rows sets how the height is shared.
     - The lines between the panes of a row (width) or between the toplists
       (height) move space between the two neighbours; the rest stays put.
     Drag it, or focus it and use the arrow keys (Shift = bigger steps);
     double-click restores the default. The split survives reloads.
     Side/row limits are also enforced in CSS, so a smaller window never
     squeezes a pane below its minimum. */

  const LAYOUT_KEY = "scanner:layout";
  const LAYOUT_DEFAULT = {
    side: 360,
    top: 0.55,
    // Each pane's share of its group's width / height (flex-grow)
    cols: { top: [1, 1, 1], bottom: [1, 1.5, 1], side: [1, 1, 1] },
  };
  const MIN_SIDE = 220;  // toplists
  const MIN_COL = 160;   // each pane within a row
  const MIN_CELL = 100;  // each toplist's height
  const MIN_MAIN = 3 * MIN_COL + 2 * 10;  // everything right of the toplists (3 panes + 2 gaps)
  const MIN_ROW = 140;   // each alert row

  const mountLayout = () => {
    const workspace = document.querySelector(".workspace");
    const side = workspace.querySelector(".side-pane");
    const main = workspace.querySelector(".main-pane");
    const [topRow, bottomRow] = main.querySelectorAll(".pane-row");
    const colHandle = workspace.querySelector('[data-split="side"]');
    const rowHandle = workspace.querySelector('[data-split="rows"]');
    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));

    const state = structuredClone(LAYOUT_DEFAULT);
    try {
      const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) || "{}");
      if (Number.isFinite(saved.side)) state.side = saved.side;
      if (Number.isFinite(saved.top)) state.top = saved.top;
      for (const row of Object.keys(state.cols)) {
        const g = saved.cols?.[row];
        if (Array.isArray(g) && g.length === state.cols[row].length && g.every((v) => v > 0)) state.cols[row] = g;
      }
    } catch { /* ignore */ }
    const save = () => {
      try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(state)); } catch { /* ignore */ }
    };

    const applySide = () => {
      workspace.style.setProperty("--side-w", `${Math.round(state.side)}px`);
      const total = side.offsetWidth + main.offsetWidth;
      colHandle.setAttribute("aria-valuenow", String(Math.round((side.offsetWidth / (total || 1)) * 100)));
    };
    const applyRows = () => {
      main.style.setProperty("--top-ratio", state.top.toFixed(4));
      rowHandle.setAttribute("aria-valuenow", String(Math.round(state.top * 100)));
    };

    // Each handle resizes one pane: size() reads it in px, resize(px) sets it.
    const panes = [
      {
        handle: colHandle, axis: "x",
        size: () => side.getBoundingClientRect().width,
        resize: (px) => {
          const max = side.getBoundingClientRect().width + main.getBoundingClientRect().width - MIN_MAIN;
          state.side = clamp(px, MIN_SIDE, max);
          applySide();
        },
        reset: () => { state.side = LAYOUT_DEFAULT.side; applySide(); },
      },
      {
        handle: rowHandle, axis: "y",
        size: () => topRow.getBoundingClientRect().height,
        resize: (px) => {
          const avail = topRow.getBoundingClientRect().height + bottomRow.getBoundingClientRect().height;
          state.top = clamp(px, MIN_ROW, avail - MIN_ROW) / (avail || 1);
          applyRows();
        },
        reset: () => { state.top = LAYOUT_DEFAULT.top; applyRows(); },
      },
    ];

    // Panes within a group — side by side in the alert rows (x), stacked in
    // the toplists (y): splitter i sits between pane i and pane i + 1.
    // resetAll: a double-click restores the whole group, not just the pair.
    const groups = [[topRow, "x", MIN_COL], [bottomRow, "x", MIN_COL], [side, "y", MIN_CELL, true]];
    const groupAppliers = groups.map(([rowEl, axis, min, resetAll = false]) => {
      const row = rowEl.dataset.row;
      const items = [...rowEl.children].filter((el) => !el.classList.contains("splitter"));
      const handles = [...rowEl.querySelectorAll(":scope > .splitter")];
      const width = (el) => el.getBoundingClientRect()[axis === "x" ? "width" : "height"];

      const apply = () => {
        const g = state.cols[row];
        items.forEach((el, i) => el.style.setProperty("--grow", g[i].toFixed(4)));
        const sum = g.reduce((a, b) => a + b, 0);
        let edge = 0;
        handles.forEach((h, i) => {
          edge += g[i];
          h.setAttribute("aria-valuenow", String(Math.round((edge / sum) * 100)));
        });
      };

      handles.forEach((handle, i) => {
        const [a, b] = [items[i], items[i + 1]];
        panes.push({
          handle, axis,
          size: () => width(a),
          // Sizes follow the grow factors, so keeping the pair's sum fixed
          // leaves every other pane in the group exactly where it was.
          resize: (px) => {
            const total = width(a) + width(b);
            const g = state.cols[row];
            const pair = g[i] + g[i + 1];
            g[i] = (pair * clamp(px, min, total - min)) / (total || 1);
            g[i + 1] = pair - g[i];
            apply();
          },
          reset: () => {
            const g = state.cols[row];
            const d = LAYOUT_DEFAULT.cols[row];
            if (resetAll) {
              g.splice(0, g.length, ...d);
              apply();
              return;
            }
            const pair = g[i] + g[i + 1];
            g[i] = (pair * d[i]) / (d[i] + d[i + 1]);
            g[i + 1] = pair - g[i];
            apply();
          },
        });
      });
      return apply;
    });

    panes.forEach(({ handle, axis, size, resize, reset }) => {
      const pos = (e) => (axis === "x" ? e.clientX : e.clientY);

      handle.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        handle.setPointerCapture(e.pointerId);
        const start = pos(e);
        const from = size();
        let frame = 0;
        let last = e;
        handle.classList.add("is-active");
        document.documentElement.dataset.resizing = axis;

        // One resize per frame: every pane's tables relayout on each step.
        const move = (ev) => {
          last = ev;
          frame ||= requestAnimationFrame(() => { frame = 0; resize(from + pos(last) - start); });
        };
        const up = () => {
          cancelAnimationFrame(frame);
          resize(from + pos(last) - start);
          handle.classList.remove("is-active");
          delete document.documentElement.dataset.resizing;
          handle.removeEventListener("pointermove", move);
          handle.removeEventListener("pointerup", up);
          handle.removeEventListener("pointercancel", up);
          save();
        };
        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", up);
        handle.addEventListener("pointercancel", up);
      });

      handle.addEventListener("keydown", (e) => {
        const step = e.shiftKey ? 64 : 16;
        const keys = axis === "x" ? { ArrowLeft: -step, ArrowRight: step } : { ArrowUp: -step, ArrowDown: step };
        if (!(e.key in keys)) return;
        e.preventDefault();
        resize(size() + keys[e.key]);
        save();
      });

      handle.addEventListener("dblclick", () => { reset(); save(); });
    });

    groupAppliers.forEach((apply) => apply());
    applySide();
    applyRows();
  };

  /* Whole dashboard fullscreen (nav button). Only offered where the
     Fullscreen API works; a panel can still go fullscreen on top of it,
     and leaving that panel returns to the fullscreen dashboard. */
  const mountAppFullscreen = () => {
    const btn = document.querySelector("[data-app-fullscreen]");
    const page = document.documentElement;
    if (!btn || !document.fullscreenEnabled || !page.requestFullscreen) return;
    btn.hidden = false;
    btn.addEventListener("click", () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else page.requestFullscreen().catch(() => {});
    });
    document.addEventListener("fullscreenchange", () => {
      const on = document.fullscreenElement === page;
      btn.setAttribute("aria-pressed", String(on));
      btn.title = on ? "Exit fullscreen" : "Fullscreen dashboard";
      btn.setAttribute("aria-label", on ? "Exit fullscreen" : "Fullscreen dashboard");
    });
  };

  /* Nav status: US market session and clock in New York time (weekends are
     closed; exchange holidays are not taken into account). The session chip
     is the scanner's status: its dot pulses during any trading session. */
  const SESSIONS = [
    { id: "pre",     label: "Pre-Market",  from: 4 * 60,      to: 9 * 60 + 30 },
    { id: "regular", label: "Market Open", from: 9 * 60 + 30, to: 16 * 60 },
    { id: "after",   label: "After Hours", from: 16 * 60,     to: 20 * 60 },
  ];
  const nyTime = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });

  const mountNavStatus = () => {
    const session = document.querySelector(".market-session");
    const sessionLabel = session.querySelector("[data-session-label]");
    const clock = document.querySelector("[data-clock]");

    const tick = () => {
      const p = Object.fromEntries(nyTime.formatToParts(new Date()).map(({ type, value }) => [type, value]));
      const mins = Number(p.hour) * 60 + Number(p.minute);
      const weekend = p.weekday === "Sat" || p.weekday === "Sun";
      const s = (!weekend && SESSIONS.find((x) => mins >= x.from && mins < x.to)) || { id: "closed", label: "Closed" };
      if (session.dataset.session !== s.id) {
        session.dataset.session = s.id;
        sessionLabel.textContent = s.label;
        const before = filterSession();
        marketState = s.id;
        onSessionChange.forEach((fn) => fn(filterSession() !== before));
      }
      clock.firstChild.textContent = `${p.hour}:${p.minute}:${p.second} `;
    };
    tick();
    // Align to the start of each second so the clock never skips a digit.
    setTimeout(() => { tick(); setInterval(tick, 1000); }, 1000 - (Date.now() % 1000));
  };

  /* User Guide: the floating help button opens a modal side panel (Esc, the
     close button or a click outside closes it). The search box keeps only
     the sections that mention every word typed, and opens them. */
  const mountGuide = () => {
    const openers = document.querySelectorAll("[data-guide-open]");
    let openBtn = openers[0];
    const panel = document.getElementById("user-guide");
    const search = panel.querySelector("[data-guide-search]");
    const empty = panel.querySelector("[data-guide-empty]");
    const items = [...panel.querySelectorAll(".guide-item")];
    const initiallyOpen = items.map((d) => d.open);
    const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const texts = items.map((d) => norm(d.textContent));

    openers.forEach((btn) => btn.addEventListener("click", () => {
      openBtn = btn;
      panel.showModal();
      search.focus();
    }));
    panel.querySelector("[data-guide-close]").addEventListener("click", () => panel.close());
    panel.addEventListener("click", (e) => {
      if (e.target !== panel) return;
      const r = panel.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) panel.close();
    });
    panel.addEventListener("close", () => openBtn.focus());

    search.addEventListener("input", () => {
      const words = norm(search.value).split(/\s+/).filter(Boolean);
      let shown = 0;
      items.forEach((d, i) => {
        const match = words.every((w) => texts[i].includes(w));
        d.hidden = !match;
        d.open = words.length ? match : initiallyOpen[i];
        shown += match;
      });
      empty.hidden = shown > 0;
    });
  };

  /* Toast: a short confirmation at the bottom of the screen. */
  const toastEl = document.querySelector("[data-toast]");
  // As a popover it sits in the top layer, above any open dialog; re-showing
  // it puts it back on top. Without popover support it falls back to `hidden`.
  const toastPops = typeof toastEl.showPopover === "function";
  if (toastPops) toastEl.hidden = false;
  const setToast = (on) => {
    if (!toastPops) { toastEl.hidden = !on; return; }
    if (toastEl.matches(":popover-open")) toastEl.hidePopover();
    if (on) toastEl.showPopover();
  };
  let toastTimer = 0;
  const showToast = (text) => {
    clearTimeout(toastTimer);
    toastEl.querySelector("[data-toast-text]").textContent = text;
    toastEl.classList.remove("is-leaving");
    setToast(true);
    toastTimer = setTimeout(() => {
      toastEl.classList.add("is-leaving");
      toastTimer = setTimeout(() => setToast(false), reduceMotion.matches ? 0 : 220);
    }, 2600);
  };

  /* ---- Table settings dialog ----------------------------------------------
     The settings icon in a panel's bar opens it for that panel.
     - Columns: pinned ones stay put; the others can be reordered (drag the
       handle, or ↑/↓ on it), switched on/off, and the heat columns
       (Vol. 1m, Hits) recolored.
     - Exclude tickers: hide tickers from this table, or from every table.
     Everything is a draft until Save; Cancel, Esc or a click outside drops it. */

  const SWATCH_LABEL = { amber: "Amber", violet: "Violet", cyan: "Cyan", pink: "Pink", orange: "Orange", teal: "Teal", muted: "Gray" };
  const ICON = {
    grip: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
    lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5.5" y="10.5" width="13" height="9" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg>',
    globe: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 2.5 14.4 0 17M12 3.5c-2.5 2.6-2.5 14.4 0 17"/></svg>',
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg>',
    empty: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="m6 6 12 12"/></svg>',
  };

  const mountTableSettings = () => {
    const dlg = document.getElementById("table-settings");
    const $ = (sel) => dlg.querySelector(sel);
    const titleEl = $("[data-ts-title]");
    const tablist = $("[role='tablist']");
    const tabs = [...dlg.querySelectorAll("[data-ts-tab]")];
    const panels = Object.fromEntries([...dlg.querySelectorAll("[data-ts-panel]")].map((p) => [p.dataset.tsPanel, p]));
    const counts = Object.fromEntries([...dlg.querySelectorAll("[data-ts-count]")].map((c) => [c.dataset.tsCount, c]));
    const pinnedList = $("[data-ts-pinned]");
    const colList = $("[data-ts-columns]");
    const shownEl = $("[data-ts-shown]");
    const showAllBtn = $("[data-ts-show-all]");
    const resetBtn = $("[data-ts-reset]");
    const dirtyEl = $("[data-ts-dirty]");
    const saveBtn = $("[data-ts-save]");
    const input = $("[data-ex-input]");
    const clearInputBtn = $("[data-ex-clear-input]");
    const suggest = $("[data-ex-suggest]");
    const addBtn = $("[data-ex-add]");
    const chips = $("[data-ex-chips]");
    const totalEl = $("[data-ex-total]");
    const legendEl = $("[data-ex-legend]");
    const allBox = $("[data-ex-all]");
    const cleanBtn = $("[data-ex-clean]");

    let key = null;          // panel being edited
    let table = null;
    let draft = null;        // { order, hidden, colors, excluded }
    let draftGlobal = null;  // tickers excluded from every table
    let baseline = "";
    let trigger = null;
    let tickers = new Map(); // sym → { price, tier } for the search
    let activeOpt = -1;
    let popover = null;      // open color picker: { key, btn, pop }
    let justAdded = "";

    const snapshot = () => JSON.stringify([
      draft.order,
      [...draft.hidden].sort(),
      Object.entries(draft.colors).sort(),
      [...draft.excluded].sort(),
      [...draftGlobal].sort(),
    ]);
    const update = () => {
      const dirty = snapshot() !== baseline;
      saveBtn.disabled = !dirty;
      dirtyEl.hidden = !dirty;
    };
    const setCount = (el, n) => { el.textContent = String(n); el.dataset.count = String(n); };

    /* Columns tab */

    const colorOf = (k) => draft.colors[k] || COLORABLE[k];
    const desc = (c) => (c.title ? `<span class="col-item__desc">${c.title}</span>` : "");

    // Opens the Float tiers dialog; the dots show the current tier colors.
    const floatOpener = (compact) => `<button type="button" class="float-open${compact ? " float-open--icon" : ""}" data-float-open aria-haspopup="dialog" aria-controls="float-settings" aria-label="Float tiers" title="Float tiers: sizes and colors">
      <span class="float-dots" aria-hidden="true"><i data-float="low"></i><i data-float="mid"></i><i data-float="high"></i></span>${compact ? "" : "<span>Float tiers</span>"}
    </button>`;

    const renderColumns = () => {
      closePopover();
      pinnedList.innerHTML = table.pins.map((k) => `
        <li class="col-item">
          <span class="col-item__lead">${ICON.lock}</span>
          <span class="col-item__text"><span class="col-item__name">${COL[k].label}</span>${desc(COL[k])}</span>
          ${k === "sig" ? floatOpener(false) : '<span class="col-tag">Pinned</span>'}
        </li>`).join("");
      colList.innerHTML = draft.order.map((k) => {
        const c = COL[k];
        const on = !draft.hidden.has(k);
        const color = k in COLORABLE
          ? `<span class="swatch-wrap"><button type="button" class="swatch" data-swatch="${k}" style="--sw: var(--${colorOf(k)})" aria-haspopup="true" aria-expanded="false" aria-label="${c.label} color: ${SWATCH_LABEL[colorOf(k)]}" title="Change color"></button></span>`
          : "";
        return `
          <li class="col-item${on ? "" : " is-off"}" data-key="${k}">
            <button type="button" class="col-item__grip" data-grip aria-label="Move ${c.label}" aria-describedby="ts-cols-hint" title="Drag to reorder">${ICON.grip}</button>
            <span class="col-item__text"><span class="col-item__name">${c.label}</span>${desc(c)}</span>
            <span class="col-item__actions">${k === "float" ? floatOpener(true) : ""}${color}<button type="button" class="switch" role="switch" data-toggle aria-checked="${on}" aria-label="Show ${c.label}" title="${on ? "Hide" : "Show"} column"></button></span>
          </li>`;
      }).join("");
      syncShown();
    };

    const syncShown = () => {
      const shown = draft.order.filter((k) => !draft.hidden.has(k)).length;
      shownEl.textContent = `${shown} of ${draft.order.length} shown`;
      showAllBtn.disabled = shown === draft.order.length;
      setCount(counts.columns, table.pins.length + shown);
      update();
    };

    const moveColumn = (k, to) => {
      const from = draft.order.indexOf(k);
      to = Math.max(0, Math.min(draft.order.length - 1, to));
      if (from === to) return;
      draft.order.splice(from, 1);
      draft.order.splice(to, 0, k);
      renderColumns();
      colList.querySelector(`[data-key="${k}"] [data-grip]`)?.focus();
    };

    // Switch in place (no re-render) so the knob animates.
    dlg.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-float-open]");
      if (btn) floatSettings.open(btn, table.tone);
    });

    colList.addEventListener("click", (e) => {
      const sw = e.target.closest("[data-toggle]");
      if (sw) {
        const item = sw.closest(".col-item");
        const k = item.dataset.key;
        const on = draft.hidden.has(k);
        if (on) draft.hidden.delete(k); else draft.hidden.add(k);
        sw.setAttribute("aria-checked", String(on));
        sw.title = `${on ? "Hide" : "Show"} column`;
        item.classList.toggle("is-off", !on);
        syncShown();
        return;
      }
      const swatch = e.target.closest("[data-swatch]");
      if (swatch) {
        if (popover?.btn === swatch) closePopover();
        else openPopover(swatch);
        return;
      }
      const pick = e.target.closest("[data-pick]");
      if (pick) {
        const k = popover.key;
        if (pick.dataset.pick === COLORABLE[k]) delete draft.colors[k];
        else draft.colors[k] = pick.dataset.pick;
        renderColumns();
        colList.querySelector(`[data-swatch="${k}"]`)?.focus();
      }
    });

    showAllBtn.addEventListener("click", () => {
      draft.hidden.clear();
      renderColumns();
    });

    resetBtn.addEventListener("click", () => {
      draft.order = [...table.defaults];
      draft.hidden.clear();
      draft.colors = {};
      renderColumns();
    });

    /* Color picker popover */

    function openPopover(btn) {
      closePopover();
      const k = btn.dataset.swatch;
      const current = colorOf(k);
      const pop = document.createElement("div");
      pop.className = "swatch-pop";
      pop.setAttribute("role", "group");
      pop.setAttribute("aria-label", `${COL[k].label} color`);
      pop.innerHTML = SWATCHES.map((s) => `<button type="button" class="swatch" data-pick="${s}" style="--sw: var(--${s})" aria-pressed="${s === current}" aria-label="${SWATCH_LABEL[s]}" title="${SWATCH_LABEL[s]}"></button>`).join("");
      btn.after(pop);
      // No room below inside the scrolling list: open upwards.
      if (pop.getBoundingClientRect().bottom > panels.columns.getBoundingClientRect().bottom) pop.classList.add("is-up");
      btn.setAttribute("aria-expanded", "true");
      popover = { key: k, btn, pop };
      pop.querySelector("[aria-pressed='true']").focus();
    }
    function closePopover({ focus = false } = {}) {
      if (!popover) return;
      popover.pop.remove();
      popover.btn.setAttribute("aria-expanded", "false");
      if (focus) popover.btn.focus();
      popover = null;
    }

    // Arrow keys move between swatches.
    colList.addEventListener("keydown", (e) => {
      const pick = e.target.closest("[data-pick]");
      if (pick && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
        e.preventDefault();
        const all = [...popover.pop.children];
        const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 }[e.key];
        all[(all.indexOf(pick) + step + all.length) % all.length].focus();
        return;
      }
      const grip = e.target.closest("[data-grip]");
      if (grip && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        const k = grip.closest(".col-item").dataset.key;
        moveColumn(k, draft.order.indexOf(k) + (e.key === "ArrowUp" ? -1 : 1));
      }
    });

    /* Drag to reorder: the item follows the pointer and the others slide
       out of its way; the order is committed on release. */

    const scroller = panels.columns;
    let drag = null;

    colList.addEventListener("pointerdown", (e) => {
      const grip = e.target.closest("[data-grip]");
      if (!grip || e.button !== 0) return;
      e.preventDefault();
      closePopover();
      const item = grip.closest(".col-item");
      const items = [...colList.children];
      grip.setPointerCapture(e.pointerId);
      drag = {
        id: e.pointerId, item, items,
        from: items.indexOf(item), to: items.indexOf(item),
        step: items.length > 1 ? items[1].offsetTop - items[0].offsetTop : item.offsetHeight,
        y: e.clientY, scroll: scroller.scrollTop, moved: false,
      };
    });

    colList.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const box = scroller.getBoundingClientRect();
      if (e.clientY < box.top + 36) scroller.scrollTop -= 10;
      else if (e.clientY > box.bottom - 36) scroller.scrollTop += 10;
      const dy = e.clientY - drag.y + scroller.scrollTop - drag.scroll;
      if (!drag.moved) {
        if (Math.abs(dy) < 4) return;
        drag.moved = true;
        colList.classList.add("is-sorting");
        drag.item.classList.add("is-dragging");
      }
      const { from, items, step } = drag;
      const to = Math.max(0, Math.min(items.length - 1, Math.round(from + dy / step)));
      drag.to = to;
      drag.item.style.transform = `translateY(${dy}px)`;
      items.forEach((el, i) => {
        if (el === drag.item) return;
        const shift = from < i && i <= to ? -step : to <= i && i < from ? step : 0;
        el.style.transform = shift ? `translateY(${shift}px)` : "";
      });
    });

    const endDrag = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const { item, from, to, moved } = drag;
      drag = null;
      colList.classList.remove("is-sorting");
      if (!moved || !draft) return;
      const k = item.dataset.key;
      draft.order.splice(from, 1);
      draft.order.splice(to, 0, k);
      renderColumns();
      colList.querySelector(`[data-key="${k}"] [data-grip]`)?.focus({ preventScroll: true });
    };
    // Release can land outside the list (or capture can be lost): end anyway.
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    colList.addEventListener("lostpointercapture", endDrag);

    /* Exclude tickers tab */

    const effective = () => new Set([...draft.excluded, ...draftGlobal]);
    const selected = () => (tickers.has(input.value.trim()) ? input.value.trim() : "");
    const alreadyExcluded = (sym) => (allBox.checked ? draftGlobal.has(sym) : effective().has(sym));

    const syncAdd = () => {
      const sym = selected();
      clearInputBtn.hidden = !input.value;
      addBtn.disabled = !sym || alreadyExcluded(sym);
    };

    const renderChips = () => {
      const list = [...effective()].sort();
      totalEl.textContent = list.length ? `${list.length} ticker${list.length === 1 ? "" : "s"}` : "";
      legendEl.hidden = !list.some((s) => draftGlobal.has(s));
      chips.innerHTML = list.length
        ? list.map((sym) => {
            const all = draftGlobal.has(sym);
            const where = all ? " from all tables" : "";
            return `<span class="ex-chip${all ? " is-all" : ""}${sym === justAdded ? " is-new" : ""}" data-sym="${sym}" title="${all ? "Excluded from all tables" : "Excluded from this table"}">
              ${all ? ICON.globe : ""}<span>${sym}</span>
              <button type="button" class="ex-chip__x" data-remove="${sym}" aria-label="Remove ${sym}${where}" title="Remove${where}">${ICON.x}</button>
            </span>`;
          }).join("")
        : `<div class="ex-empty">${ICON.empty}<b>No tickers excluded</b><span>Search a ticker above to hide it.</span></div>`;
      justAdded = "";
      cleanBtn.disabled = list.length === 0;
      setCount(counts.exclude, list.length);
      syncAdd();
      update();
    };

    const closeSuggest = () => {
      activeOpt = -1;
      suggest.hidden = true;
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
    };

    const renderSuggest = () => {
      const q = input.value.trim();
      const matches = [...tickers.keys()]
        .filter((s) => s.includes(q))
        .sort((a, b) => Number(b.startsWith(q)) - Number(a.startsWith(q)) || a.localeCompare(b))
        .slice(0, 8);
      const out = effective();
      activeOpt = -1;
      input.removeAttribute("aria-activedescendant");
      suggest.innerHTML = matches.length
        ? matches.map((s, i) => {
            const { price, tier } = tickers.get(s);
            const name = q ? s.replace(q, `<mark>${q}</mark>`) : s;
            const off = out.has(s) && !(allBox.checked && !draftGlobal.has(s));
            return `<li class="ex-option" id="ex-opt-${i}" role="option" data-sym="${s}" aria-selected="false"${off ? ' aria-disabled="true"' : ""}>
              <i class="sig-bar" data-float="${tier}" aria-hidden="true"></i><b>${name}</b>
              ${off ? '<span class="ex-option__tag">Excluded</span>' : ""}
              <span class="ex-option__price">$${fmtPrice(price)}</span>
            </li>`;
          }).join("")
        : `<li class="ex-suggest__empty" role="presentation">No ticker matches “${q}”</li>`;
      suggest.hidden = false;
      input.setAttribute("aria-expanded", String(matches.length > 0));
    };

    const choose = (sym) => {
      input.value = sym;
      closeSuggest();
      syncAdd();
    };

    const exclude = () => {
      const sym = selected();
      if (!sym || alreadyExcluded(sym)) return;
      if (allBox.checked) { draftGlobal.add(sym); draft.excluded.delete(sym); }
      else draft.excluded.add(sym);
      justAdded = sym;
      input.value = "";
      closeSuggest();
      renderChips();
      input.focus();
    };

    input.addEventListener("input", () => {
      input.value = input.value.toUpperCase().replace(/[^A-Z0-9.-]/g, "");
      renderSuggest();
      syncAdd();
    });
    input.addEventListener("focus", renderSuggest);
    input.addEventListener("blur", () => setTimeout(closeSuggest, 120));
    input.addEventListener("keydown", (e) => {
      const opts = [...suggest.querySelectorAll("[role='option']")];
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (suggest.hidden) renderSuggest();
        if (!opts.length) return;
        activeOpt = (activeOpt + (e.key === "ArrowDown" ? 1 : -1) + opts.length) % opts.length;
        opts.forEach((o, i) => {
          o.classList.toggle("is-active", i === activeOpt);
          o.setAttribute("aria-selected", String(i === activeOpt));
        });
        opts[activeOpt].scrollIntoView({ block: "nearest" });
        input.setAttribute("aria-activedescendant", opts[activeOpt].id);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const opt = opts[activeOpt];
        if (opt && opt.getAttribute("aria-disabled") !== "true") choose(opt.dataset.sym);
        else if (selected()) exclude();
      }
    });
    suggest.addEventListener("mousedown", (e) => {
      const opt = e.target.closest("[role='option']");
      e.preventDefault();
      if (opt && opt.getAttribute("aria-disabled") !== "true") choose(opt.dataset.sym);
    });
    clearInputBtn.addEventListener("click", () => {
      input.value = "";
      syncAdd();
      input.focus();
    });
    addBtn.addEventListener("click", exclude);
    allBox.addEventListener("change", syncAdd);

    chips.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-remove]");
      if (!btn) return;
      const sym = btn.dataset.remove;
      const next = btn.closest(".ex-chip").nextElementSibling?.dataset.sym;
      draft.excluded.delete(sym);
      draftGlobal.delete(sym);
      renderChips();
      (chips.querySelector(`[data-remove="${next}"]`) || input).focus();
    });

    cleanBtn.addEventListener("click", () => {
      draft.excluded.clear();
      draftGlobal.clear();
      renderChips();
      input.focus();
    });

    /* Tabs */

    const setTab = (name) => {
      tabs.forEach((t) => {
        const on = t.dataset.tsTab === name;
        t.setAttribute("aria-selected", String(on));
        t.tabIndex = on ? 0 : -1;
      });
      Object.entries(panels).forEach(([n, p]) => { p.hidden = n !== name; });
      tablist.dataset.active = name;
      resetBtn.hidden = name !== "columns";
      closePopover();
      closeSuggest();
    };
    tablist.addEventListener("click", (e) => {
      const t = e.target.closest("[data-ts-tab]");
      if (t) setTab(t.dataset.tsTab);
    });
    tablist.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const i = (tabs.indexOf(e.target.closest("[data-ts-tab]")) + 1) % tabs.length; // two tabs: either key flips
      setTab(tabs[i].dataset.tsTab);
      tabs[i].focus();
    });

    /* Open / close / save */

    const collectTickers = () => {
      const map = new Map();
      tables.forEach((t) => t.rows().forEach((r) => {
        if (!map.has(r.sym)) map.set(r.sym, { price: r.price, tier: floatTier(r.float) });
      }));
      return new Map([...map].sort(([a], [b]) => a.localeCompare(b)));
    };

    const open = (panelId, btn) => {
      key = panelId;
      table = tables.get(panelId);
      trigger = btn;
      draft = table.state();
      draftGlobal = new Set(globalExcluded);
      baseline = snapshot();
      tickers = collectTickers();
      dlg.style.setProperty("--tone", table.tone);
      titleEl.textContent = table.title;
      input.value = "";
      allBox.checked = false;
      closeSuggest();
      renderColumns();
      renderChips();
      setTab("columns");
      dlg.showModal();
      Object.values(panels).forEach((p) => { p.scrollTop = 0; });
    };

    const close = () => dlg.close();

    dlg.addEventListener("close", () => {
      closePopover();
      closeSuggest();
      drag = null;
      colList.classList.remove("is-sorting");
      draft = null;
      trigger?.focus();
    });
    // Esc closes the innermost layer first: color picker, suggestions, dialog.
    // Handled on keydown: Chrome won't always let `cancel` be prevented.
    dlg.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (popover) { e.preventDefault(); closePopover({ focus: true }); }
      else if (!suggest.hidden) { e.preventDefault(); closeSuggest(); }
    });
    dlg.addEventListener("cancel", (e) => {
      if (popover) { e.preventDefault(); closePopover({ focus: true }); }
      else if (!suggest.hidden) { e.preventDefault(); closeSuggest(); }
    });
    dlg.addEventListener("click", (e) => {
      if (e.target === dlg) { close(); return; }
      if (popover && !e.target.closest(".swatch-wrap")) closePopover();
    });
    $("[data-ts-close]").addEventListener("click", close);
    $("[data-ts-cancel]").addEventListener("click", close);

    saveBtn.addEventListener("click", () => {
      if (saveBtn.disabled) return;
      const globalChanged = [...draftGlobal].sort().join() !== [...globalExcluded].sort().join();
      if (globalChanged) {
        globalExcluded.clear();
        draftGlobal.forEach((s) => globalExcluded.add(s));
        saveGlobalExcluded();
      }
      table.apply(draft);
      if (globalChanged) tables.forEach((t, id) => id !== key && t.refresh());
      showToast(`${table.title} settings saved`);
      close();
    });

    return { open };
  };

  /* ---- Float tiers dialog --------------------------------------------------
     Opened from Table settings (Signal / Float rows), on top of it. Sets the
     two cuts (Low | Mid | High) and a color per tier, for every table.
     - Spectrum: 1M → 1B on a log scale. Drag a handle (or focus it and use
       the arrow keys), or press the track to bring the nearest one there.
       The dots are the tickers on screen now, colored by the draft tiers.
     - Or type a size: 10M, 800K, 1.5B (a bare number means millions).
     - Picking a color another tier uses swaps the two, so tiers stay apart.
     Everything is a draft until Save; Cancel, Esc or a click outside drops it. */

  // Handle stops: round sizes, so a drag never lands on 12.37M.
  const FLOAT_STOPS = [1e6, 1e7, 1e8]
    .flatMap((d) => [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 9].map((s) => s * d))
    .concat(1e9);
  const LOG_MIN = Math.log10(FLOAT_RANGE.min);
  const LOG_SPAN = Math.log10(FLOAT_RANGE.max) - LOG_MIN;
  const floatPos = (v) => Math.max(0, Math.min(100, ((Math.log10(v) - LOG_MIN) / LOG_SPAN) * 100));
  const floatAt = (pct) => 10 ** (LOG_MIN + (pct / 100) * LOG_SPAN);
  const fmtShares = (v) => {
    const [div, unit] = v >= 1e9 ? [1e9, "B"] : v >= 1e6 ? [1e6, "M"] : [1e3, "K"];
    return `${Number((v / div).toFixed(2))}${unit}`;
  };
  const parseShares = (text) => {
    const m = /^(\d+(?:\.\d*)?|\.\d+)\s*([KMB])?$/i.exec(text.trim());
    if (!m) return NaN;
    return Math.round(Number(m[1]) * { K: 1e3, M: 1e6, B: 1e9 }[(m[2] || "M").toUpperCase()]);
  };

  const mountFloatSettings = () => {
    const dlg = document.getElementById("float-settings");
    const $ = (sel) => dlg.querySelector(sel);
    const all = (attr) => Object.fromEntries([...dlg.querySelectorAll(`[${attr}]`)].map((el) => [el.getAttribute(attr), el]));
    const panel = $(".sm-panel");
    const spectrum = $("[data-fl-spectrum]");
    const track = $("[data-fl-track]");
    const dotsEl = $("[data-fl-dots]");
    const thumbs = all("data-fl-thumb");
    const tips = all("data-fl-tip");
    const inputs = all("data-fl-input");
    const froms = all("data-fl-from");
    const counts = all("data-fl-count");
    const groups = all("data-fl-swatches");
    const presets = [...dlg.querySelectorAll("[data-fl-preset]")];
    const liveEl = $("[data-fl-live]");
    const errorEl = $("[data-fl-error]");
    const dirtyEl = $("[data-fl-dirty]");
    const saveBtn = $("[data-fl-save]");
    const CUTS = ["low", "mid"];

    let draft = null;   // { low, mid, colors }
    let baseline = "";
    let trigger = null;
    let floats = [];    // float of each ticker on screen
    let bad = {};       // cut → message, while its field holds an invalid size
    let drag = null;

    Object.values(thumbs).forEach((t) => {
      t.setAttribute("aria-valuemin", String(FLOAT_RANGE.min));
      t.setAttribute("aria-valuemax", String(FLOAT_RANGE.max));
    });
    // One swatch per tier; its palette opens in a pop, like Table settings.
    Object.values(groups).forEach((wrap) => {
      wrap.querySelector(".swatch-pop").innerHTML = FLOAT_SWATCHES.map((s) => `<button type="button" class="swatch" role="radio" data-pick="${s}" style="--sw: ${swatchVar(s)}" aria-checked="false" aria-label="${SWATCH_LABEL[s]}" title="${SWATCH_LABEL[s]}"></button>`).join("");
    });

    const snapshot = () => JSON.stringify([draft.low, draft.mid, draft.colors]);

    const render = () => {
      const { low, mid, colors } = draft;
      // The dialog previews the draft colors; the page keeps the saved ones.
      for (const [tier, c] of Object.entries(colors)) dlg.style.setProperty(`--sig-${tier}`, swatchVar(c));
      spectrum.style.setProperty("--a", floatPos(low).toFixed(3));
      spectrum.style.setProperty("--b", floatPos(mid).toFixed(3));
      spectrum.classList.toggle("is-close", floatPos(mid) - floatPos(low) < 14); // tips side by side
      for (const tier of CUTS) {
        tips[tier].textContent = fmtShares(draft[tier]);
        thumbs[tier].setAttribute("aria-valuenow", String(draft[tier]));
        thumbs[tier].setAttribute("aria-valuetext", fmtShares(draft[tier]));
      }
      froms.mid.textContent = fmtShares(low);
      froms.high.textContent = fmtShares(mid);

      const n = { low: 0, mid: 0, high: 0 };
      floats.forEach((f) => n[floatTier(f, draft)]++);
      [...dotsEl.children].forEach((dot, i) => { dot.dataset.float = floatTier(floats[i], draft); });
      for (const [tier, el] of Object.entries(counts)) el.textContent = floats.length ? `${n[tier]} on screen` : "";

      for (const [tier, wrap] of Object.entries(groups)) {
        const btn = wrap.querySelector("[data-fl-swatch]");
        btn.style.setProperty("--sw", swatchVar(colors[tier]));
        btn.setAttribute("aria-label", `${FLOAT_LABEL[tier]} color: ${SWATCH_LABEL[colors[tier]]}`);
        btn.title = "Change color";
        wrap.querySelectorAll("[data-pick]").forEach((b) => {
          const on = b.dataset.pick === colors[tier];
          b.setAttribute("aria-checked", String(on));
          b.tabIndex = on ? 0 : -1;
        });
      }
      presets.forEach((b) => {
        const [l, m] = b.dataset.flPreset.split(",").map(Number);
        b.setAttribute("aria-pressed", String(l === low && m === mid));
      });

      const msg = bad.low || bad.mid || "";
      errorEl.textContent = msg;
      errorEl.hidden = !msg;
      CUTS.forEach((tier) => inputs[tier].setAttribute("aria-invalid", String(Boolean(bad[tier]))));
      const dirty = snapshot() !== baseline;
      saveBtn.disabled = !dirty || Boolean(msg);
      dirtyEl.hidden = !dirty;
    };

    const writeInputs = () => CUTS.forEach((tier) => { inputs[tier].value = fmtShares(draft[tier]); });
    const setCuts = (cuts) => {
      Object.assign(draft, cuts);
      bad = {};
      writeInputs();
      render();
    };

    /* Typed sizes: the draft only takes them once both are valid and in order. */
    const readInputs = (edited) => {
      bad = {};
      const next = {};
      for (const tier of CUTS) {
        const v = parseShares(inputs[tier].value);
        if (!(v > 0)) bad[tier] = "Enter a size like 10M or 800K.";
        else if (v < FLOAT_RANGE.min || v > FLOAT_RANGE.max) bad[tier] = "Pick a size between 1M and 1B.";
        else next[tier] = v;
      }
      if (!bad.low && !bad.mid) {
        if (next.low < next.mid) Object.assign(draft, next);
        else bad[edited] = "Low float has to end before Mid float starts.";
      }
      render();
    };
    CUTS.forEach((tier) => {
      const input = inputs[tier];
      input.addEventListener("input", () => readInputs(tier));
      input.addEventListener("change", () => { if (!bad.low && !bad.mid) writeInputs(); }); // 10 → 10M
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); input.dispatchEvent(new Event("change")); }
      });
    });

    /* Spectrum handles */

    // Stops a handle can take: it never reaches the other one.
    const stopsFor = (tier) => FLOAT_STOPS.filter((s) => (tier === "low" ? s < draft.mid : s > draft.low));
    const snap = (tier, v) => stopsFor(tier).reduce((a, b) => (Math.abs(Math.log(b / v)) < Math.abs(Math.log(a / v)) ? b : a));
    const valueAt = (x) => {
      const r = track.getBoundingClientRect();
      return floatAt(((x - r.left) / r.width) * 100);
    };

    track.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !draft) return;
      const v = valueAt(e.clientX);
      const tier = e.target.closest("[data-fl-thumb]")?.dataset.flThumb
        || (Math.abs(Math.log(v / draft.low)) <= Math.abs(Math.log(v / draft.mid)) ? "low" : "mid");
      e.preventDefault();
      drag = { tier, id: e.pointerId };
      track.setPointerCapture(e.pointerId);
      thumbs[tier].classList.add("is-dragging");
      thumbs[tier].focus({ preventScroll: true });
      setCuts({ [tier]: snap(tier, v) });
    });
    track.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id || !draft) return;
      const v = snap(drag.tier, valueAt(e.clientX));
      if (v !== draft[drag.tier]) setCuts({ [drag.tier]: v });
    });
    const endDrag = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      thumbs[drag.tier].classList.remove("is-dragging");
      drag = null;
    };
    track.addEventListener("pointerup", endDrag);
    track.addEventListener("pointercancel", endDrag);
    track.addEventListener("lostpointercapture", endDrag);

    Object.entries(thumbs).forEach(([tier, thumb]) => thumb.addEventListener("keydown", (e) => {
      const stops = stopsFor(tier);
      const cur = draft[tier];
      const above = stops.filter((s) => s > cur);
      const below = stops.filter((s) => s < cur);
      const target = {
        ArrowRight: above[0], ArrowUp: above[0], ArrowLeft: below.at(-1), ArrowDown: below.at(-1),
        PageUp: above[2] ?? above.at(-1), PageDown: below.at(-3) ?? below[0],
        Home: stops[0], End: stops.at(-1),
      };
      if (!(e.key in target)) return;
      e.preventDefault();
      if (target[e.key] !== undefined) setCuts({ [tier]: target[e.key] });
    }));

    presets.forEach((b) => b.addEventListener("click", () => {
      const [low, mid] = b.dataset.flPreset.split(",").map(Number);
      setCuts({ low, mid });
    }));

    /* Colors */

    let openPop = null; // tier whose palette is open
    const popOf = (tier) => groups[tier].querySelector(".swatch-pop");
    const btnOf = (tier) => groups[tier].querySelector("[data-fl-swatch]");
    const closePop = ({ focus = false } = {}) => {
      if (!openPop) return;
      const tier = openPop;
      openPop = null;
      popOf(tier).hidden = true;
      btnOf(tier).setAttribute("aria-expanded", "false");
      if (focus) btnOf(tier).focus();
    };
    const showPop = (tier) => {
      closePop();
      const pop = popOf(tier);
      openPop = tier;
      pop.hidden = false;
      btnOf(tier).setAttribute("aria-expanded", "true");
      // Open upward when the panel has no room below
      pop.classList.remove("is-up");
      if (pop.getBoundingClientRect().bottom > panel.getBoundingClientRect().bottom) pop.classList.add("is-up");
      pop.querySelector('[aria-checked="true"]')?.focus();
    };
    const pick = (tier, c) => {
      const other = Object.keys(draft.colors).find((t) => t !== tier && draft.colors[t] === c);
      if (other) draft.colors[other] = draft.colors[tier];
      draft.colors[tier] = c;
      render();
    };
    Object.entries(groups).forEach(([tier, wrap]) => {
      wrap.addEventListener("click", (e) => {
        if (e.target.closest("[data-fl-swatch]")) { if (openPop === tier) closePop(); else showPop(tier); return; }
        const b = e.target.closest("[data-pick]");
        if (b) { pick(tier, b.dataset.pick); closePop({ focus: true }); }
      });
      // Radio group: arrows move the choice
      popOf(tier).addEventListener("keydown", (e) => {
        const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
        if (!dir) return;
        e.preventDefault();
        const i = FLOAT_SWATCHES.indexOf(draft.colors[tier]);
        const next = FLOAT_SWATCHES[(i + dir + FLOAT_SWATCHES.length) % FLOAT_SWATCHES.length];
        pick(tier, next);
        popOf(tier).querySelector(`[data-pick="${next}"]`).focus();
      });
    });
    // Esc closes the palette first, then the dialog
    dlg.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && openPop) { e.preventDefault(); closePop({ focus: true }); }
    });
    dlg.addEventListener("cancel", (e) => { if (openPop) { e.preventDefault(); closePop({ focus: true }); } });
    dlg.addEventListener("click", (e) => { if (openPop && !e.target.closest(".swatch-wrap")) closePop(); });

    /* Open / close / save */

    const open = (btn, tone) => {
      trigger = btn;
      draft = { low: FLOAT_TIERS.low, mid: FLOAT_TIERS.mid, colors: { ...floatColors } };
      baseline = snapshot();
      bad = {};
      // Tickers on screen, one dot each; the height is a stable per-ticker jitter.
      const seen = new Map();
      tables.forEach((t) => t.rows().forEach((r) => { if (!seen.has(r.sym)) seen.set(r.sym, r.float); }));
      floats = [...seen.values()];
      dotsEl.innerHTML = [...seen].map(([sym, f]) => {
        const y = [...sym].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 997, 7) % 100;
        return `<i style="--x: ${floatPos(f).toFixed(2)}; --y: ${y}"></i>`;
      }).join("");
      liveEl.textContent = floats.length ? `Dots: ${floats.length} tickers on screen` : "";
      dlg.style.setProperty("--tone", tone || "var(--green)");
      writeInputs();
      render();
      dlg.showModal();
      panel.scrollTop = 0;
    };

    const close = () => dlg.close();
    dlg.addEventListener("close", () => {
      closePop();
      if (drag) thumbs[drag.tier].classList.remove("is-dragging");
      drag = null;
      draft = null;
      trigger?.focus();
    });
    dlg.addEventListener("click", (e) => { if (e.target === dlg) close(); });
    $("[data-fl-close]").addEventListener("click", close);
    $("[data-fl-cancel]").addEventListener("click", close);
    $("[data-fl-reset]").addEventListener("click", () => {
      draft.colors = { ...FLOAT_DEFAULTS.colors };
      setCuts({ low: FLOAT_DEFAULTS.low, mid: FLOAT_DEFAULTS.mid });
    });

    saveBtn.addEventListener("click", () => {
      if (saveBtn.disabled) return;
      Object.assign(FLOAT_TIERS, { low: draft.low, mid: draft.mid });
      Object.assign(floatColors, draft.colors);
      applyFloat();
      saveFloat();
      tables.forEach((t) => t.refresh());
      close();
      showToast("Float tiers saved · all tables");
    });

    return { open };
  };

  /* ---- Alert sound dialog --------------------------------------------------
     The speaker icon of an alert table opens it on that table; the chips on
     top switch tables. Each table has its own draft, all saved together.
     - Switch: sound on or off for new alerts.
     - Output: Voice (+ voice pick), Chime (+ style), Custom (+ audio file).
     - Volume and a preview of the draft.
     Cancel, Esc or a click outside drops every draft. */

  const SOUND_MODE_LABEL = { voice: "Voice", chime: "Chime", custom: "Custom file" };
  const fmtBytes = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
  const fmtClip = (sec) => (!Number.isFinite(sec) ? "" : sec < 10 ? `${sec.toFixed(1)} s` : `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`);
  const isAudioFile = (f) => f.type.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|aac)$/i.test(f.name);

  const mountSoundSettings = () => {
    const dlg = document.getElementById("sound-settings");
    const $ = (sel) => dlg.querySelector(sel);
    const titleEl = $("[data-snd-title]");
    const tabsEl = $("[data-snd-tables]");
    const panelEl = $("[data-snd-panel]");
    const master = $("[data-snd-master]");
    const onSwitch = $("[data-snd-on]");
    const stateEl = $("[data-snd-state]");
    const settingsEl = $("[data-snd-settings]");
    const modes = [...dlg.querySelectorAll("[data-snd-mode]")];
    const details = Object.fromEntries([...dlg.querySelectorAll("[data-snd-detail]")].map((d) => [d.dataset.sndDetail, d]));
    const voiceSel = $("[data-snd-voice]");
    const rateIn = $("[data-snd-rate]");
    const rateOut = $("[data-snd-rate-out]");
    const strip = $("[data-snd-strip]");
    const arrows = [...dlg.querySelectorAll("[data-snd-scroll]")];
    const sampleEl = $("[data-snd-sample]");
    const chimes = [...dlg.querySelectorAll("[data-snd-chime]")];
    const drop = $("[data-snd-drop]");
    const fileInput = $("[data-snd-file]");
    const fileName = $("[data-snd-file-name]");
    const fileMeta = $("[data-snd-file-meta]");
    const chooseLabel = $("[data-snd-choose]");
    const removeBtn = $("[data-snd-remove]");
    const volume = $("[data-snd-volume]");
    const volumeOut = $("[data-snd-volume-out]");
    const playBtn = $("[data-snd-play]");
    const playLabel = $("[data-snd-play-label]");
    const statusEl = $("[data-snd-status]");
    const dirtyEl = $("[data-snd-dirty]");
    const saveBtn = $("[data-snd-save]");

    let panels = [];         // alert tables, in page order
    let key = null;          // table on screen
    let drafts = null;       // panel → setup
    let files = null;        // panel → File (new) | null (removed); absent = unchanged
    let clipLength = new Map(); // File → seconds, for the meta line
    let baseline = "";
    let trigger = null;
    let preview = null;      // { stop } while a preview plays
    let fileError = "";

    const snapshot = () => JSON.stringify([panels.map((p) => drafts[p]), [...files].map(([p, f]) => [p, f ? f.name + f.size + f.lastModified : null])]);
    const draft = () => drafts[key];
    const setStatus = (text = "", error = false) => {
      statusEl.textContent = text;
      statusEl.classList.toggle("is-error", error);
    };
    // Custom needs a file: the new one, or the saved one if not removed.
    const hasFile = (p) => (files.has(p) ? Boolean(files.get(p)) : soundFiles.has(p) && Boolean(drafts[p].file));
    const missingFile = (p) => drafts[p].on && drafts[p].mode === "custom" && !hasFile(p);

    const fillVoices = () => {
      const list = englishVoices();
      voiceSel.innerHTML = `<option value="">Default English voice</option>` + list
        .map((v) => `<option value="${v.voiceURI}">${v.name.replace(/^(Microsoft|Google)\s+/, "")} · ${v.lang}</option>`).join("");
      voiceSel.disabled = !canSpeak;
      if (drafts) voiceSel.value = list.some((v) => v.voiceURI === draft().voice) ? draft().voice : "";
    };
    if (canSpeak) speechSynthesis.addEventListener("voiceschanged", () => { if (dlg.open) fillVoices(); });

    const renderTabs = () => {
      tabsEl.innerHTML = panels.map((p) => {
        const t = tables.get(p);
        return `<button type="button" class="snd-tab" role="tab" data-snd-tab="${p}" style="--tab-tone: ${t.tone}" aria-selected="false" tabindex="-1"><i aria-hidden="true"></i>${t.title}</button>`;
      }).join("");
    };

    const render = () => {
      const s = draft();
      const t = tables.get(key);
      titleEl.textContent = t.title;
      dlg.style.setProperty("--tone", t.tone);
      tabsEl.querySelectorAll("[data-snd-tab]").forEach((b) => {
        const on = b.dataset.sndTab === key;
        b.setAttribute("aria-selected", String(on));
        b.tabIndex = on ? 0 : -1;
        b.dataset.on = String(drafts[b.dataset.sndTab].on);
      });

      onSwitch.setAttribute("aria-checked", String(s.on));
      master.classList.toggle("is-on", s.on);
      settingsEl.classList.toggle("is-muted", !s.on);
      stateEl.textContent = s.on ? `On · ${SOUND_MODE_LABEL[s.mode]} at ${s.volume}%` : "Off · this table stays silent";

      modes.forEach((m) => {
        const on = m.dataset.sndMode === s.mode;
        m.setAttribute("aria-checked", String(on));
        m.tabIndex = on ? 0 : -1;
      });
      Object.entries(details).forEach(([m, d]) => { d.hidden = m !== s.mode; });

      voiceSel.value = [...voiceSel.options].some((o) => o.value === s.voice) ? s.voice : "";
      sampleEl.textContent = spell(t.rows()[0]?.sym || "NVLX");
      rateIn.value = String(s.rate);
      rateIn.style.setProperty("--fill", `${((s.rate - 0.6) / 1.2) * 100}%`);
      rateIn.setAttribute("aria-valuetext", `${s.rate.toFixed(1)} times`);
      rateOut.textContent = `${s.rate.toFixed(1)}×`;
      chimes.forEach((c) => {
        const on = c.dataset.sndChime === s.chime;
        c.setAttribute("aria-checked", String(on));
        c.tabIndex = on ? 0 : -1;
      });

      // Custom file row
      const pending = files.get(key);
      const has = hasFile(key);
      drop.classList.toggle("has-file", has);
      drop.classList.toggle("is-error", Boolean(fileError));
      removeBtn.hidden = !has;
      chooseLabel.textContent = has ? "Replace" : "Choose file";
      if (has) {
        const name = pending ? pending.name : s.file.name;
        const size = pending ? pending.size : s.file.size;
        const len = pending ? fmtClip(clipLength.get(pending)) : "";
        fileName.textContent = name;
        fileMeta.textContent = fileError || [fmtBytes(size), len].filter(Boolean).join(" · ");
      } else {
        fileName.textContent = "Drop an audio file here";
        fileMeta.textContent = fileError || "MP3, WAV, OGG, M4A or AAC · up to 10 MB";
      }

      volume.value = String(s.volume);
      volume.style.setProperty("--fill", `${s.volume}%`);
      volume.setAttribute("aria-valuetext", `${s.volume}%`);
      volumeOut.textContent = `${s.volume}%`;

      const blocked = panels.find(missingFile);
      const dirty = snapshot() !== baseline;
      saveBtn.disabled = !dirty || Boolean(blocked);
      dirtyEl.hidden = !dirty;
      if (blocked && !preview && !fileError) {
        setStatus(blocked === key ? "Choose an audio file to use Custom." : `${tables.get(blocked).title} needs an audio file.`, true);
      } else if (!preview && statusEl.classList.contains("is-error") && !fileError) setStatus();
    };

    /* Preview */

    const stopPreview = (text = "") => {
      if (!preview) return;
      const p = preview;
      preview = null;
      p.stop();
      playBtn.setAttribute("aria-pressed", "false");
      playLabel.textContent = "Play preview";
      setStatus(text);
    };
    const startPreview = () => {
      const s = draft();
      const done = (text) => () => { if (preview === handle) stopPreview(text); };
      let handle = null;
      if (s.mode === "voice") {
        if (!canSpeak) { setStatus("This browser can't read tickers aloud.", true); return; }
        speechSynthesis.cancel();
        const text = sampleEl.textContent;
        const u = speak(text, s.voice, s.volume, s.rate);
        handle = { stop: () => speechSynthesis.cancel() };
        u.addEventListener("end", done(`Read “${text}”.`));
        u.addEventListener("error", done(""));
        setStatus(`Reading “${text}”…`);
      } else if (s.mode === "custom") {
        const pending = files.get(key);
        const url = pending ? URL.createObjectURL(pending) : soundFiles.get(key);
        if (!url) { setStatus("Choose an audio file first.", true); return; }
        const clip = new Audio(url);
        clip.volume = s.volume / 100;
        handle = { stop: () => { clip.pause(); if (pending) URL.revokeObjectURL(url); } };
        clip.addEventListener("ended", done("Preview finished."));
        clip.play().catch(done("This file can't be played in this browser."));
        setStatus("Playing your file…");
      } else {
        const ms = playChime(s.chime, toneOf(key), s.volume);
        const timer = setTimeout(done(""), ms + 250);
        handle = { stop: () => clearTimeout(timer) };
        setStatus("");
      }
      preview = handle;
      playBtn.setAttribute("aria-pressed", "true");
      playLabel.textContent = "Stop";
    };
    const toneOf = (p) => document.querySelector(`.terminal[data-panel="${p}"]`)?.dataset.tone || "bull";
    playBtn.addEventListener("click", () => (preview ? stopPreview() : startPreview()));

    /* Controls */

    const edit = (patch) => {
      Object.assign(draft(), patch);
      render();
    };

    // Radio groups (output cards, chime styles): arrows move and pick.
    const radioKeys = (items, pick) => items.forEach((el, i) => el.addEventListener("keydown", (e) => {
      const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!dir) return;
      e.preventDefault();
      const next = items[(i + dir + items.length) % items.length];
      pick(next);
      next.focus();
    }));

    const pickMode = (m) => {
      stopPreview();
      fileError = "";
      edit({ mode: m.dataset.sndMode });
    };
    modes.forEach((m) => m.addEventListener("click", () => pickMode(m)));
    radioKeys(modes, pickMode);

    const pickChime = (c) => {
      stopPreview();
      edit({ chime: c.dataset.sndChime });
      playChime(c.dataset.sndChime, toneOf(key), draft().volume); // hear it right away
    };
    chimes.forEach((c) => c.addEventListener("click", () => pickChime(c)));
    radioKeys(chimes, pickChime);

    onSwitch.addEventListener("click", () => edit({ on: !draft().on }));
    voiceSel.addEventListener("change", () => edit({ voice: voiceSel.value }));
    rateIn.addEventListener("input", () => { stopPreview(); edit({ rate: Number(rateIn.value) }); });
    // Letting go of the speed slider reads the sample at the new speed
    rateIn.addEventListener("change", () => { if (canSpeak) startPreview(); });
    volume.addEventListener("input", () => edit({ volume: Number(volume.value) }));

    const takeFile = (f) => {
      stopPreview();
      if (!f) return;
      if (!isAudioFile(f)) fileError = "That's not an audio file. Try MP3, WAV, OGG, M4A or AAC.";
      else if (f.size > MAX_SOUND_BYTES) fileError = `${fmtBytes(f.size)} is too big: the limit is 10 MB.`;
      else {
        fileError = "";
        files.set(key, f);
        draft().file = { name: f.name, size: f.size };
        // Length for the meta line, once the browser has read it
        const url = URL.createObjectURL(f);
        const probe = new Audio();
        probe.preload = "metadata";
        probe.addEventListener("loadedmetadata", () => {
          clipLength.set(f, probe.duration);
          URL.revokeObjectURL(url);
          if (dlg.open) render();
        }, { once: true });
        probe.addEventListener("error", () => URL.revokeObjectURL(url), { once: true });
        probe.src = url;
        setStatus(`${f.name} ready. Press Play preview to hear it.`);
      }
      render();
    };
    fileInput.addEventListener("change", () => {
      takeFile(fileInput.files[0]);
      fileInput.value = "";
    });
    drop.addEventListener("dragover", (e) => {
      e.preventDefault();
      drop.classList.add("is-over");
    });
    drop.addEventListener("dragleave", (e) => { if (!drop.contains(e.relatedTarget)) drop.classList.remove("is-over"); });
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("is-over");
      takeFile(e.dataTransfer.files[0]);
    });
    removeBtn.addEventListener("click", () => {
      stopPreview();
      fileError = "";
      files.set(key, null);
      draft().file = null;
      render();
      fileInput.focus();
    });

    /* Table chips */

    const showTable = (p) => {
      if (p === key) return;
      stopPreview();
      fileError = "";
      setStatus();
      key = p;
      render();
      panelEl.scrollTop = 0;
      tabsEl.querySelector(`[data-snd-tab="${p}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    };
    tabsEl.addEventListener("click", (e) => {
      const b = e.target.closest("[data-snd-tab]");
      if (b) showTable(b.dataset.sndTab);
    });
    tabsEl.addEventListener("keydown", (e) => {
      const dir = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (!dir) return;
      e.preventDefault();
      const next = panels[(panels.indexOf(key) + dir + panels.length) % panels.length];
      showTable(next);
      const b = tabsEl.querySelector(`[data-snd-tab="${next}"]`);
      b.focus();
      b.scrollIntoView({ block: "nearest", inline: "nearest" });
    });

    // Strip arrows: shown on each side that has more chips; a click slides
    // about two thirds of the visible width. Wheel scrolls it sideways too.
    const syncArrows = () => {
      const max = tabsEl.scrollWidth - tabsEl.clientWidth;
      const prev = tabsEl.scrollLeft > 1;
      const next = tabsEl.scrollLeft < max - 1;
      strip.classList.toggle("can-prev", prev);
      strip.classList.toggle("can-next", next);
      arrows[0].hidden = !prev;
      arrows[1].hidden = !next;
    };
    arrows.forEach((a) => a.addEventListener("click", () => {
      tabsEl.scrollBy({ left: Number(a.dataset.sndScroll) * tabsEl.clientWidth * 0.66 });
    }));
    tabsEl.addEventListener("scroll", syncArrows, { passive: true });
    tabsEl.addEventListener("wheel", (e) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || tabsEl.scrollWidth <= tabsEl.clientWidth) return;
      e.preventDefault();
      tabsEl.scrollLeft += e.deltaY;
    }, { passive: false });
    new ResizeObserver(syncArrows).observe(tabsEl);

    /* Open / close / save */

    const open = (panel, btn) => {
      trigger = btn;
      panels = [...document.querySelectorAll(".terminal [data-sound]")].map((b) => b.closest(".terminal").dataset.panel);
      drafts = Object.fromEntries(panels.map((p) => [p, cleanSound(soundOf(p))]));
      files = new Map();
      clipLength = new Map();
      key = panel;
      fileError = "";
      baseline = snapshot();
      renderTabs();
      fillVoices();
      setStatus();
      render();
      dlg.showModal();
      panelEl.scrollTop = 0;
      tabsEl.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
      syncArrows();
    };

    const close = () => dlg.close();
    dlg.addEventListener("close", () => {
      stopPreview();
      drafts = null;
      files = null;
      trigger?.focus();
    });
    dlg.addEventListener("click", (e) => { if (e.target === dlg) close(); });
    $("[data-snd-close]").addEventListener("click", close);
    $("[data-snd-cancel]").addEventListener("click", close);

    saveBtn.addEventListener("click", () => {
      if (saveBtn.disabled) return;
      stopPreview();
      panels.forEach((p) => { soundPrefs[p] = drafts[p]; });
      saveSoundPrefs();
      const stored = [...files].map(([p, f]) => {
        setSoundFile(p, f);
        if (!("indexedDB" in window)) return null;
        return soundStore("readwrite", (s) => (f ? s.put({ panel: p, blob: f }) : s.delete(p))).catch(() => { /* this session only */ });
      }).filter(Boolean);
      // Other windows (detached copies) reload the files once they are stored.
      if (stored.length) Promise.all(stored).then(() => {
        try { localStorage.setItem(SOUND_FILES_KEY, String(Date.now())); } catch { /* ignore */ }
      });
      if (panels.some((p) => drafts[p].on)) audioNow(); // unlock audio while we have a click
      syncSoundButtons();
      const on = panels.filter((p) => drafts[p].on).length;
      close();
      showToast(`Alert sound saved · ${on ? `on for ${on} table${on === 1 ? "" : "s"}` : "all tables muted"}`);
    });

    return { open };
  };

  /* ---- Filters dialog ------------------------------------------------------
     Opened from the Filter button in the nav, or from the funnel a filtered
     table shows in its bar. Saved filters are cards: the switch turns one on
     or off, a click opens it in the editor. The editor goes step by step
     (variable → sessions → tables → condition) and saves that one filter:
     Apply filter, or Save draft while it is off. One filter is edited at a
     time; closing the dialog drops unsaved edits. */

  const FLT_GROUPS = ["Price", "Volume", "Change", "Momentum", "Size"];
  const FLT_PRESETS = [
    { variable: "Price", operator: "between", values: ["1", "20"] },
    { variable: "Float", operator: "less than or equal to", values: ["20M"] },
    { variable: "RVol", operator: "greater than or equal to", values: ["2"] },
  ];
  const FLT_ICON = {
    clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    table: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M9.5 9.5v10"/></svg>',
    check: '<svg class="flt-chip__check" viewBox="0 0 24 24" aria-hidden="true"><path d="m5.5 12.5 4 4 9-9"/></svg>',
    done: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5.5 12.5 4 4 9-9"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2M6.5 7l1 12h9l1-12"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>',
    alert: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5.5M12 16.5h.01"/></svg>',
  };
  const escHTML = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  const mountFilters = () => {
    const dlg = document.getElementById("filters");
    const $ = (sel) => dlg.querySelector(sel);
    const list = $("[data-flt-list]");
    const empty = $("[data-flt-empty]");
    const notice = $("[data-flt-notice]");
    const statsEl = $("[data-flt-stats]");
    const nowEl = $("[data-flt-now]");
    const addBtn = $("[data-flt-add]");
    const scroller = $(".sm-panel");
    const navBtn = document.querySelector("[data-global-filter]");
    const navCount = navBtn.querySelector("[data-filter-count]");

    let editor = null;     // { isNew, data, auto }: the one filter being edited
    let picking = false;   // the editor shows every variable
    let confirming = null; // id of the card asking "delete?"
    let trigger = null;
    let noticeTimer = 0;
    let escHandled = false;
    let drag = null;

    const blank = () => ({ id: newFilterId(), variable: "", sessions: { allSessions: false, sessions: [] }, scope: { allTables: false, tables: [] }, operator: "", values: [""], enabled: true });
    const clone = (f) => JSON.parse(JSON.stringify(f));
    const savedOf = (id) => filters.find((f) => f.id === id);
    const unitOf = (f) => FILTER_VARS[f.variable]?.unit || "";
    const comparable = (f) => JSON.stringify([f.enabled, f.variable, f.sessions, f.scope, f.operator, f.values.slice(0, valueCount(f.operator)).map((v) => formatValue(v, f.variable))]);
    const isBlank = (f) => !f.variable && !hasSessions(f) && !hasScope(f) && !f.operator && f.values.every((v) => !String(v).trim());
    const isDirty = () => Boolean(editor) && (editor.isNew ? !isBlank(editor.data) : comparable(editor.data) !== comparable(savedOf(editor.data.id)));
    const canSave = () => isFilterValid(editor.data, filters) && (editor.isNew || isDirty());
    const cardOf = (id) => list.querySelector(`[data-id="${id}"]`);
    const liveNow = (f) => filterTargets(f).some((p) => p.startsWith(`${filterSession()}|`));

    /* Saved filter: a card */

    const sessionsText = (f) => (f.sessions.allSessions ? ALL_SESSIONS : f.sessions.sessions.join(", "));
    const tablesText = (f) => {
      if (f.scope.allTables) return ALL_TABLES;
      const names = f.scope.tables.map((k) => TABLE_NAME[k]);
      return names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(", ");
    };
    const valueTag = (f, v) => `<span class="flt-val">${escHTML(v)}${unitOf(f)}</span>`;
    const ruleHTML = (f) => {
      const cond = isRangeOp(f.operator)
        ? `<span class="flt-op">${f.operator}</span> ${valueTag(f, f.values[0])} <span class="flt-op">and</span> ${valueTag(f, f.values[1])}`
        : `<span class="flt-op flt-op--sym" aria-hidden="true">${OP_SHORT[f.operator]}</span><span class="sr-only">${f.operator}</span> ${valueTag(f, f.values[0])}`;
      return `<b class="flt-var">${escHTML(f.variable)}</b> ${cond}`;
    };
    const tagHTML = (f) => (!f.enabled ? '<span class="flt-tag">Draft</span>'
      : liveNow(f) ? '<span class="flt-tag is-live"><i aria-hidden="true"></i>Live</span>'
      : `<span class="flt-tag" title="Not in use during ${filterSession()}">Other session</span>`);

    const cardHTML = (f) => {
      const name = escHTML(f.variable);
      const locked = Boolean(editor || confirming);
      return `
        <li class="flt-card${f.enabled ? "" : " is-off"}" data-id="${f.id}">
          <button type="button" class="flt-grip" data-flt-grip aria-label="Move ${name} filter" aria-describedby="flt-move-hint" title="Drag to reorder"${locked ? " disabled" : ""}>${ICON.grip}</button>
          <button type="button" class="flt-card__main" data-flt-edit title="Edit filter">
            <span class="sr-only">Edit filter:</span>
            <span class="flt-rule">${ruleHTML(f)}</span>
            <span class="flt-scope">${FLT_ICON.clock}<span>${escHTML(sessionsText(f))}</span>${FLT_ICON.table}<span>${escHTML(tablesText(f))}</span></span>
          </button>
          <span class="flt-card__side">
            ${tagHTML(f)}
            <button type="button" class="switch" role="switch" data-flt-toggle aria-checked="${f.enabled}" aria-label="${name} filter" title="${f.enabled ? "Turn off" : "Turn on"}"></button>
            <button type="button" class="icon-btn flt-del" data-flt-delete aria-label="Delete ${name} filter" title="Delete">${FLT_ICON.trash}</button>
          </span>
        </li>`;
    };

    const confirmHTML = (f) => `
      <li class="flt-card is-confirm" data-id="${f.id}">
        <span class="flt-confirm__icon" aria-hidden="true">${FLT_ICON.trash}</span>
        <p class="flt-confirm__text" id="flt-del-text"><b>Delete the ${escHTML(f.variable)} filter?</b>
          <span>${f.enabled ? `${escHTML(f.variable)} will be removed from the tables where it’s currently active.` : "This filter is currently inactive. Are you sure you want to delete it?"}</span></p>
        <span class="flt-confirm__actions">
          <button type="button" class="btn btn-ghost btn-sm" data-flt-keep>Keep</button>
          <button type="button" class="btn btn-danger btn-sm" data-flt-confirm aria-describedby="flt-del-text">Delete</button>
        </span>
      </li>`;

    /* The editor: four steps */

    const chipHTML = (attrs, label, pressed, { disabled = false, title = "" } = {}) =>
      `<button type="button" class="flt-chip" ${attrs} aria-pressed="${pressed}"${disabled ? " disabled" : ""}${title ? ` title="${escHTML(title)}"` : ""}>${FLT_ICON.check}<span>${escHTML(label)}</span></button>`;

    const stepHTML = (n, key, label, state, body, hint = "") => `
      <div class="flt-step is-${state}" data-step="${key}">
        <span class="flt-step__n" aria-hidden="true">${state === "done" ? FLT_ICON.done : n}</span>
        <div class="flt-step__head"><span class="flt-step__label" id="${editor.data.id}-${key}">${label}</span>${hint ? `<span class="flt-step__hint">${hint}</span>` : ""}</div>
        ${state === "locked" ? "" : `<div class="flt-step__body">${body}</div>`}
      </div>`;

    const variableStep = (f) => {
      if (f.variable && !picking) {
        return stepHTML(1, "variable", "Variable", "done", `
          <button type="button" class="flt-chip is-picked" data-flt-change aria-pressed="true" aria-label="Variable: ${escHTML(f.variable)}. Change it" title="Change the variable">
            <span>${escHTML(f.variable)}</span>${FLT_ICON.chevron}
          </button>
          <span class="flt-step__about">${FILTER_VARS[f.variable].about}</span>`);
      }
      const groups = FLT_GROUPS.map((g) => `
        <div class="flt-group">
          <span class="flt-group__label" id="${f.id}-g-${g}">${g}</span>
          <div class="flt-chips" role="group" aria-labelledby="${f.id}-g-${g}">
            ${Object.entries(FILTER_VARS).filter(([, v]) => v.group === g)
              .map(([name, v]) => chipHTML(`data-flt-var="${escHTML(name)}"`, name, f.variable === name, { title: v.about })).join("")}
          </div>
        </div>`).join("");
      return stepHTML(1, "variable", "Variable", "current", `<div class="flt-palette">${groups}</div>`, "What to filter by");
    };

    const sessionsStep = (f) => {
      if (!f.variable) return stepHTML(2, "sessions", "Sessions", "locked", "", "After the variable");
      const avail = sessionsOf(f.variable);
      const all = f.sessions.allSessions;
      const body = `<div class="flt-chips" role="group" aria-labelledby="${f.id}-sessions">
        ${avail.length === MARKET_SESSIONS.length ? chipHTML("data-flt-session-all", ALL_SESSIONS, all) : ""}
        ${avail.map((s) => chipHTML(`data-flt-session="${s}"`, s, !all && f.sessions.sessions.includes(s), { disabled: all })).join("")}
      </div>`;
      const hint = avail.length < MARKET_SESSIONS.length ? `${escHTML(f.variable)} only exists in ${avail.join(" and ")}` : "";
      return stepHTML(2, "sessions", "Sessions", hasSessions(f) ? "done" : "current", body, hint);
    };

    const tablesStep = (f) => {
      if (!hasSessions(f)) return stepHTML(3, "tables", "Apply to", "locked", "", "After the sessions");
      const eligible = eligibleTables(f.variable, f.sessions);
      const all = f.scope.allTables;
      const body = `<div class="flt-chips" role="group" aria-labelledby="${f.id}-tables">
        ${eligible.length > 1 ? chipHTML("data-flt-table-all", ALL_TABLES, all) : ""}
        ${eligible.map((k) => chipHTML(`data-flt-table="${k}"`, TABLE_NAME[k], !all && f.scope.tables.includes(k), { disabled: all })).join("")}
      </div>`;
      return stepHTML(3, "tables", "Apply to", hasScope(f) ? "done" : "current", body);
    };

    const inputHTML = (f, i, invalid) => {
      const unit = unitOf(f);
      const range = isRangeOp(f.operator);
      const label = (range ? (i ? "To" : "From") : "Value") + (unit === "%" ? ", in percent" : unit === "x" ? ", as a multiple" : "");
      return `<span class="flt-input${unit ? " has-unit" : ""}">
        <input type="text" autocomplete="off" spellcheck="false" maxlength="16" data-flt-value="${i}" value="${escHTML(f.values[i] ?? "")}"
               placeholder="${range ? (i ? "Max" : "Min") : "Value"}" aria-label="${label}"${invalid ? ` aria-invalid="true" aria-describedby="${f.id}-error"` : ""}>
        ${unit ? `<span class="flt-input__unit" aria-hidden="true">${unit}</span>` : ""}
      </span>`;
    };

    const limitHTML = (f) => {
      const limits = f.operator ? filterLimits(f) : [];
      return limits.length ? `<p class="flt-limit">Scanner range: ${limits.map(limitText).join(" or ")}</p>` : "";
    };

    const conditionStep = (f, v) => {
      if (!hasScope(f)) return stepHTML(4, "condition", "Condition", "locked", "", "After the tables");
      const ops = `<div class="flt-chips flt-ops" role="group" aria-labelledby="${f.id}-condition">
        ${FILTER_OPS.map(([op, short]) => `<button type="button" class="flt-chip flt-chip--op${short.length === 1 ? " is-sym" : ""}" data-flt-op="${op}" aria-pressed="${f.operator === op}" aria-label="${op}" title="${op}">${escHTML(short)}</button>`).join("")}
      </div>`;
      const values = f.operator ? `<div class="flt-values">
        ${Array.from({ length: valueCount(f.operator) }, (_, i) => (i ? '<span class="flt-and">and</span>' : "") + inputHTML(f, i, v?.invalid?.includes(i))).join("")}
      </div>` : "";
      const done = isFilterComplete(f) && !(v && v.invalid.length);
      return stepHTML(4, "condition", "Condition", done ? "done" : "current", ops + values + limitHTML(f));
    };

    // Live check: how many rows now on screen the filter keeps.
    const previewHTML = (f, v) => {
      if (!isFilterComplete(f) || (v && v.invalid.length)) return '<div class="flt-preview" data-flt-preview hidden></div>';
      const now = filterSession();
      const aimed = filterTargets(f).filter((p) => p.startsWith(`${now}|`)).map((p) => p.split("|")[1]);
      if (!aimed.length) {
        return `<div class="flt-preview is-idle" data-flt-preview>${FLT_ICON.clock}<span>Not in use right now: it’s ${now}.</span></div>`;
      }
      const others = filters.filter((o) => o.id !== f.id);
      let base = 0;
      let kept = 0;
      aimed.forEach((k) => {
        const t = tables.get(k);
        if (!t) return;
        const on = filtersOn(k, others);
        t.rows().forEach((r) => {
          if (t.excluded(r.sym) || !on.every((o) => passesFilter(o, r))) return;
          base += 1;
          if (passesFilter(f, r)) kept += 1;
        });
      });
      const where = aimed.length === 1 ? TABLE_NAME[aimed[0]] : `${aimed.length} tables`;
      return `<div class="flt-preview" data-flt-preview>
        <span class="flt-meter" aria-hidden="true"><i style="--keep: ${base ? Math.round((kept / base) * 100) : 0}%"></i></span>
        <span>Keeps <b>${kept}</b> of ${base} rows on screen · ${where}</span>
      </div>`;
    };

    const errorHTML = (f, v) => `<p class="flt-error" id="${f.id}-error" data-flt-error${v ? "" : " hidden"}>${FLT_ICON.alert}<span>${v ? escHTML(v.message) : ""}</span></p>`;

    const editorHTML = (f) => {
      const v = validateFilter(f, filters);
      return `
        <li class="flt-card is-editing${editor.shown ? "" : " is-entering"}${f.enabled ? "" : " is-off"}" data-id="${f.id}" aria-label="${editor.isNew ? "New filter" : `Editing the ${escHTML(f.variable)} filter`}">
          <div class="flt-ed__head">
            <span class="flt-ed__title">${editor.isNew ? "New filter" : "Edit filter"}</span>
            <span class="flt-ed__switch"><span id="${f.id}-on">Active</span><button type="button" class="switch" role="switch" data-flt-toggle aria-checked="${f.enabled}" aria-labelledby="${f.id}-on"></button></span>
          </div>
          <div class="flt-steps">
            ${variableStep(f)}${sessionsStep(f)}${tablesStep(f)}${conditionStep(f, v)}
          </div>
          ${previewHTML(f, v)}
          ${errorHTML(f, v)}
          <div class="flt-ed__foot">
            ${editor.isNew
              ? '<button type="button" class="btn btn-ghost btn-sm" data-flt-discard>Discard</button>'
              : `<button type="button" class="btn btn-ghost btn-sm flt-ed__delete" data-flt-delete>${FLT_ICON.trash}<span>Delete</span></button>`}
            <span class="flt-ed__actions">
              ${editor.isNew ? "" : '<button type="button" class="btn btn-secondary btn-sm" data-flt-cancel>Cancel</button>'}
              <button type="button" class="btn btn-primary btn-sm" data-flt-save${canSave() ? "" : " disabled"}>${f.enabled ? "Apply filter" : "Save draft"}</button>
            </span>
          </div>
        </li>`;
    };

    /* Render */

    const items = () => {
      const out = filters.map((f) => (editor && !editor.isNew && editor.data.id === f.id ? editor.data : f));
      if (editor?.isNew) out.unshift(editor.data);
      return out;
    };

    const syncStats = () => {
      const active = filters.filter((f) => f.enabled).length;
      const drafts = filters.length - active;
      statsEl.innerHTML = `<span><b>${active}</b> active</span><span><b>${drafts}</b> draft${drafts === 1 ? "" : "s"}</span>`;
      const live = marketState !== "closed";
      nowEl.classList.toggle("is-live", live);
      nowEl.querySelector("span").textContent = live ? filterSession() : `Closed · ${filterSession()}`;
      nowEl.title = `Filters set for ${filterSession()} are in use now`;
    };

    const setNotice = (kind, title = "", text = "") => {
      clearTimeout(noticeTimer);
      if (!kind) { notice.hidden = true; delete notice.dataset.kind; return; }
      if (notice.dataset.kind === kind && notice.dataset.text === text && !notice.hidden) return;
      notice.dataset.kind = kind;
      notice.dataset.text = text;
      notice.innerHTML = `${FLT_ICON.alert}<p><b>${title}</b> ${escHTML(text)}</p>`;
      notice.hidden = false;
      if (kind === "progress") noticeTimer = setTimeout(() => setNotice(null), 5000);
    };
    // A conflict notice stays for as long as the edited filter has one.
    const syncNotice = () => {
      const v = editor && validateFilter(editor.data, filters);
      if (v?.notice) setNotice("conflict", "Filter conflict", v.notice);
      else if (notice.dataset.kind === "conflict") setNotice(null);
    };

    // Focus without the browser's scroll jump; only scroll if it's out of view.
    const calmFocus = (el) => {
      if (!el) return;
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: "nearest", behavior: reduceMotion.matches ? "auto" : "smooth" });
    };

    const render = (focus) => {
      const all = items();
      list.innerHTML = all.map((f) => (editor?.data.id === f.id ? editorHTML(f) : confirming === f.id ? confirmHTML(f) : cardHTML(f))).join("");
      list.hidden = !all.length;
      empty.hidden = all.length > 0;
      dlg.classList.toggle("is-editing", Boolean(editor));
      // The editor animates in once; later rebuilds (each pick) stay still.
      if (editor) editor.shown = true;
      syncStats();
      syncNotice();
      calmFocus(typeof focus === "string" ? list.querySelector(focus) : focus);
    };

    // Typing a value re-checks the filter without rebuilding the card, so
    // the caret stays put.
    const syncEditor = () => {
      const f = editor.data;
      const card = cardOf(f.id);
      if (!card) return;
      const v = validateFilter(f, filters);
      card.classList.toggle("is-off", !f.enabled);
      card.querySelectorAll("[data-flt-value]").forEach((input) => {
        const bad = Boolean(v?.invalid.includes(Number(input.dataset.fltValue)));
        if (bad) {
          input.setAttribute("aria-invalid", "true");
          input.setAttribute("aria-describedby", `${f.id}-error`);
        } else {
          input.removeAttribute("aria-invalid");
          input.removeAttribute("aria-describedby");
        }
      });
      const step = card.querySelector("[data-step='condition']");
      if (!step.classList.contains("is-locked")) {
        const done = isFilterComplete(f) && !(v && v.invalid.length);
        step.classList.toggle("is-done", done);
        step.classList.toggle("is-current", !done);
        step.querySelector(".flt-step__n").innerHTML = done ? FLT_ICON.done : "4";
      }
      card.querySelector("[data-flt-preview]").outerHTML = previewHTML(f, v);
      const err = card.querySelector("[data-flt-error]");
      err.hidden = !v;
      err.querySelector("span").textContent = v ? v.message : "";
      const save = card.querySelector("[data-flt-save]");
      save.disabled = !canSave();
      save.textContent = f.enabled ? "Apply filter" : "Save draft";
      syncNotice();
    };

    // Where the editor needs input next.
    const focusNext = () => {
      if (!editor) return;
      const f = editor.data;
      const card = cardOf(f.id);
      if (!card) return;
      const q = (sel) => card.querySelector(sel);
      const v = validateFilter(f, filters);
      const missing = f.operator ? f.values.slice(0, valueCount(f.operator)).findIndex((x) => !isValidValue(x, f.variable)) : -1;
      const el = !f.variable || picking ? q("[data-flt-var][aria-pressed='true']") || q("[data-flt-var]")
        : !hasSessions(f) ? q("[data-flt-session-all], [data-flt-session]:not(:disabled)")
        : !hasScope(f) ? q("[data-flt-table-all], [data-flt-table]:not(:disabled)")
        : !f.operator ? q("[data-flt-op]")
        : missing >= 0 ? q(`[data-flt-value="${missing}"]`)
        : v?.invalid.length ? q(`[data-flt-value="${v.invalid[0]}"]`)
        : v ? q("[data-flt-table-all], [data-flt-table]:not(:disabled)")
        : q("[data-flt-save]:not(:disabled)") || q("[data-flt-toggle]");
      calmFocus(el);
    };

    /* Only one filter is edited at a time. One without changes gives way;
       one with changes asks to be finished (or saved) first. */
    const leaveEditor = () => {
      if (!editor) return true;
      if (!isDirty()) { editor = null; picking = false; return true; }
      const v = validateFilter(editor.data, filters);
      if (!v?.notice) setNotice("progress", "Filter in progress", "Finish or save it before creating or editing another filter.");
      focusNext();
      return false;
    };

    const commit = () => {
      saveFilters();
      tables.forEach((t) => t.refresh());
      syncBadges();
    };

    /* Actions */

    const add = (preset) => {
      if (!leaveEditor()) return;
      confirming = null;
      const f = blank();
      if (preset) {
        Object.assign(f, { variable: preset.variable, operator: preset.operator, values: [...preset.values] });
        f.sessions = normSessions({ allSessions: true }, f.variable);
        f.scope = normScope({ allTables: true }, f.variable, f.sessions);
      }
      editor = { isNew: true, data: f };
      picking = !preset;
      render();
      if (!preset) { focusNext(); return; }
      const first = cardOf(f.id).querySelector("[data-flt-value='0']");
      first?.focus();
      first?.select();
    };

    const edit = (id) => {
      if (editor?.data.id === id) return;
      if (!leaveEditor()) return;
      confirming = null;
      editor = { isNew: false, data: clone(savedOf(id)) };
      picking = false;
      render(`[data-id="${id}"] [data-flt-change]`);
    };

    const pickVariable = (name) => {
      const f = editor.data;
      f.variable = name;
      f.sessions = normSessions(f.sessions, name) || { allSessions: false, sessions: [] };
      f.scope = normScope(f.scope, name, f.sessions) || { allTables: false, tables: [] };
      f.values = f.values.map((v) => (String(v).trim() ? formatValue(v, name) : v));
      picking = false;
      render();
      focusNext();
    };

    // After a pick, focus stays on that chip (or on its "All" chip, when the
    // pick completed the set).
    const reRender = (sel, fallback) => {
      render();
      const card = cardOf(editor.data.id);
      calmFocus(card.querySelector(`${sel}:not(:disabled)`) || card.querySelector(fallback));
    };

    const toggleSession = (session) => {
      const f = editor.data;
      if (!session) {
        f.sessions = { allSessions: !f.sessions.allSessions, sessions: [] };
      } else {
        const set = new Set(f.sessions.allSessions ? [] : f.sessions.sessions);
        if (set.has(session)) set.delete(session); else set.add(session);
        f.sessions = normSessions({ allSessions: false, sessions: [...set] }, f.variable) || { allSessions: false, sessions: [] };
      }
      f.scope = normScope(f.scope, f.variable, f.sessions) || { allTables: false, tables: [] };
      reRender(session ? `[data-flt-session="${session}"]` : "[data-flt-session-all]", "[data-flt-session-all]");
    };

    const toggleTable = (key) => {
      const f = editor.data;
      if (!key) {
        f.scope = { allTables: !f.scope.allTables, tables: [] };
      } else {
        const set = new Set(f.scope.allTables ? [] : f.scope.tables);
        if (set.has(key)) set.delete(key); else set.add(key);
        f.scope = normScope({ allTables: false, tables: [...set] }, f.variable, f.sessions) || { allTables: false, tables: [] };
      }
      reRender(key ? `[data-flt-table="${key}"]` : "[data-flt-table-all]", "[data-flt-table-all]");
    };

    const pickOperator = (op) => {
      const f = editor.data;
      f.operator = op;
      f.values = Array.from({ length: valueCount(op) }, (_, i) => f.values[i] ?? "");
      render();
      const next = f.values.findIndex((v) => !String(v).trim());
      calmFocus(cardOf(f.id).querySelector(`[data-flt-value="${Math.max(0, next)}"]`));
    };

    const setValue = (input, formatted = false) => {
      const i = Number(input.dataset.fltValue);
      if (formatted) input.value = formatValue(input.value, editor.data.variable);
      editor.data.values[i] = input.value;
      syncEditor();
    };

    const save = () => {
      if (!editor) return;
      const f = editor.data;
      f.values = f.values.slice(0, valueCount(f.operator)).map((v) => formatValue(v, f.variable));
      if (!canSave()) { render(); focusNext(); return; }
      if (editor.isNew) filters.unshift(f);
      else filters.splice(filters.findIndex((o) => o.id === f.id), 1, f);
      editor = null;
      picking = false;
      setNotice(null);
      commit();
      render(`[data-id="${f.id}"] [data-flt-edit]`);
      showToast(f.enabled ? `${f.variable} filter applied` : `${f.variable} draft saved`);
    };

    const closeEditor = (focus) => {
      editor = null;
      picking = false;
      setNotice(null);
      render(focus);
    };

    // A card's switch saves at once. Turning on a filter that would clash
    // with another one opens it in the editor instead, with the conflict.
    const toggle = (id, btn) => {
      if (editor?.data.id === id) {
        editor.data.enabled = !editor.data.enabled;
        // Opened by that clash and switched back: nothing left to edit.
        if (editor.auto && !isDirty()) { closeEditor(`[data-id="${id}"] [data-flt-toggle]`); return; }
        btn.setAttribute("aria-checked", String(editor.data.enabled));
        syncEditor();
        return;
      }
      const busy = Boolean(editor || confirming); // the list needs a rebuild
      if (!leaveEditor()) return;
      confirming = null;
      const f = savedOf(id);
      if (!f.enabled && filterConflict({ ...f, enabled: true }, filters)) {
        editor = { isNew: false, data: { ...clone(f), enabled: true }, auto: true };
        picking = false;
        render(`[data-id="${id}"] [data-flt-toggle]`);
        return;
      }
      f.enabled = !f.enabled;
      commit();
      if (busy) {
        render(`[data-id="${id}"] [data-flt-toggle]`);
      } else {
        // In place, so the knob slides.
        const card = cardOf(id);
        btn.setAttribute("aria-checked", String(f.enabled));
        btn.title = f.enabled ? "Turn off" : "Turn on";
        card.classList.toggle("is-off", !f.enabled);
        card.querySelector(".flt-tag").outerHTML = tagHTML(f);
        syncStats();
      }
      showToast(`${f.variable} filter ${f.enabled ? "on" : "off"}`);
    };

    const askDelete = (id) => {
      if (editor?.data.id !== id && !leaveEditor()) return;
      if (editor?.data.id === id) { editor = null; picking = false; setNotice(null); }
      confirming = id;
      render(`[data-id="${id}"] [data-flt-confirm]`);
    };
    const keep = () => {
      const id = confirming;
      confirming = null;
      render(`[data-id="${id}"] [data-flt-delete]`);
    };
    const remove = () => {
      const i = filters.findIndex((f) => f.id === confirming);
      const [f] = filters.splice(i, 1);
      confirming = null;
      commit();
      const next = filters[i] ?? filters[i - 1];
      render(next ? `[data-id="${next.id}"] [data-flt-edit]` : addBtn);
      showToast(`${f.variable} filter deleted`);
    };

    const move = (id, to) => {
      const from = filters.findIndex((f) => f.id === id);
      to = Math.max(0, Math.min(filters.length - 1, to));
      if (from === to) return;
      filters.splice(to, 0, ...filters.splice(from, 1));
      saveFilters(); // order never changes what a table shows
      render(`[data-id="${id}"] [data-flt-grip]`);
    };

    /* Events */

    list.addEventListener("click", (e) => {
      const card = e.target.closest(".flt-card");
      if (!card) return;
      const id = card.dataset.id;
      const hit = (sel) => e.target.closest(sel);
      let el;
      if ((el = hit("[data-flt-var]"))) pickVariable(el.dataset.fltVar);
      else if (hit("[data-flt-change]")) { picking = true; render(`[data-id="${id}"] [data-flt-var][aria-pressed="true"]`); }
      else if (hit("[data-flt-session-all]")) toggleSession(null);
      else if ((el = hit("[data-flt-session]"))) toggleSession(el.dataset.fltSession);
      else if (hit("[data-flt-table-all]")) toggleTable(null);
      else if ((el = hit("[data-flt-table]"))) toggleTable(el.dataset.fltTable);
      else if ((el = hit("[data-flt-op]"))) pickOperator(el.dataset.fltOp);
      else if ((el = hit("[data-flt-toggle]"))) toggle(id, el);
      else if (hit("[data-flt-delete]")) askDelete(id);
      else if (hit("[data-flt-keep]")) keep();
      else if (hit("[data-flt-confirm]")) remove();
      else if (hit("[data-flt-save]")) save();
      else if (hit("[data-flt-cancel]")) closeEditor(`[data-id="${id}"] [data-flt-edit]`);
      else if (hit("[data-flt-discard]")) closeEditor(addBtn);
      else if (hit("[data-flt-edit]")) edit(id);
    });

    list.addEventListener("input", (e) => {
      const input = e.target.closest("[data-flt-value]");
      if (input && editor) setValue(input);
    });
    // The typed value is tidied up (1,500 · 2.5M) once the field is left.
    list.addEventListener("focusout", (e) => {
      const input = e.target.closest("[data-flt-value]");
      if (input && editor && input.isConnected) setValue(input, true);
    });

    list.addEventListener("keydown", (e) => {
      const grip = e.target.closest("[data-flt-grip]");
      if (grip && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        const id = grip.closest(".flt-card").dataset.id;
        move(id, filters.findIndex((f) => f.id === id) + (e.key === "ArrowUp" ? -1 : 1));
        return;
      }
      // Arrow keys move between the chips of a group (all the variables are one).
      const chip = e.target.closest(".flt-chip");
      const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (chip && dir) {
        e.preventDefault();
        const group = chip.closest(".flt-palette") || chip.closest(".flt-chips");
        const all = [...group.querySelectorAll(".flt-chip:not(:disabled)")];
        all[(all.indexOf(chip) + dir + all.length) % all.length]?.focus();
        return;
      }
      const input = e.target.closest("[data-flt-value]");
      if (input && e.key === "Enter") {
        e.preventDefault();
        setValue(input, true);
        if (canSave()) save(); else focusNext();
      }
    });

    /* Drag a grip to reorder: the card follows the pointer, the others make
       room; the order is committed on release. */
    list.addEventListener("pointerdown", (e) => {
      const grip = e.target.closest("[data-flt-grip]");
      if (!grip || grip.disabled || e.button !== 0) return;
      e.preventDefault();
      const item = grip.closest(".flt-card");
      const all = [...list.children];
      grip.setPointerCapture(e.pointerId);
      drag = {
        id: e.pointerId, item, all,
        from: all.indexOf(item), to: all.indexOf(item),
        step: all.length > 1 ? all[1].offsetTop - all[0].offsetTop : item.offsetHeight,
        y: e.clientY, scroll: scroller.scrollTop, moved: false,
      };
    });
    list.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const box = scroller.getBoundingClientRect();
      if (e.clientY < box.top + 36) scroller.scrollTop -= 10;
      else if (e.clientY > box.bottom - 36) scroller.scrollTop += 10;
      const dy = e.clientY - drag.y + scroller.scrollTop - drag.scroll;
      if (!drag.moved) {
        if (Math.abs(dy) < 4) return;
        drag.moved = true;
        list.classList.add("is-sorting");
        drag.item.classList.add("is-dragging");
      }
      const { from, all, step } = drag;
      const to = Math.max(0, Math.min(all.length - 1, Math.round(from + dy / step)));
      drag.to = to;
      drag.item.style.transform = `translateY(${dy}px)`;
      all.forEach((el, i) => {
        if (el === drag.item) return;
        const shift = from < i && i <= to ? -step : to <= i && i < from ? step : 0;
        el.style.transform = shift ? `translateY(${shift}px)` : "";
      });
    });
    const endDrag = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const { item, from, to, moved } = drag;
      drag = null;
      list.classList.remove("is-sorting");
      if (!moved) return;
      const id = item.dataset.id;
      filters.splice(to, 0, ...filters.splice(from, 1));
      saveFilters();
      render();
      cardOf(id)?.querySelector("[data-flt-grip]")?.focus({ preventScroll: true });
    };
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    list.addEventListener("lostpointercapture", endDrag);

    /* Badges: the nav button counts the active filters; a table's bar shows
       a funnel with the filters working on it right now. */
    const syncBadges = () => {
      const active = filters.filter((f) => f.enabled).length;
      navCount.textContent = String(active);
      navCount.dataset.count = String(active);
      navCount.setAttribute("aria-label", `${active} filter${active === 1 ? "" : "s"} applied`);
      navBtn.title = active ? `Filters · ${active} active` : "Filters";
      document.querySelectorAll(".terminal[data-panel]").forEach((root) => {
        const btn = root.querySelector("[data-bar-filter]");
        if (!btn) return;
        const n = filtersOn(root.dataset.panel).length;
        btn.hidden = n === 0;
        btn.querySelector("[data-bar-filter-count]").textContent = String(n);
        btn.title = `${n} filter${n === 1 ? "" : "s"} on this table`;
        btn.setAttribute("aria-label", `${root.dataset.title}: ${n} filter${n === 1 ? "" : "s"} on. Open filters`);
      });
    };

    // A new session brings its own filters into force; so do filters saved
    // in another window (a detached copy, or the main one).
    const sync = (changed = true) => {
      if (changed) tables.forEach((t) => t.refresh());
      syncBadges();
      if (!dlg.open) return;
      if (editor) { syncStats(); syncEditor(); } else render();
    };
    onSessionChange.push(sync);

    /* Open / close */

    const open = (btn) => {
      trigger = btn;
      editor = null;
      picking = false;
      confirming = null;
      setNotice(null);
      render();
      dlg.showModal();
      scroller.scrollTop = 0;
      addBtn.focus();
    };
    const close = () => dlg.close();

    dlg.addEventListener("close", () => {
      editor = null;
      picking = false;
      confirming = null;
      drag = null;
      list.classList.remove("is-sorting");
      setNotice(null);
      trigger?.focus();
    });
    // Esc steps back one layer: a delete question, then the editor, then the
    // dialog. Handled on keydown: Chrome won't always let `cancel` be
    // prevented; the flag stops that same key press from closing the dialog.
    const stepBack = () => {
      if (confirming) keep();
      else if (editor) closeEditor(editor.isNew ? addBtn : `[data-id="${editor.data.id}"] [data-flt-edit]`);
      else return false;
      return true;
    };
    dlg.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !stepBack()) return;
      e.preventDefault();
      escHandled = true;
    });
    dlg.addEventListener("keyup", () => { escHandled = false; });
    dlg.addEventListener("cancel", (e) => {
      if (escHandled || stepBack()) e.preventDefault();
      escHandled = false;
    });
    // A click outside closes the dialog, but not while a value is being typed,
    // nor when a press started inside (e.g. selecting text in a field and
    // releasing past the edge).
    let pressedOutside = false;
    dlg.addEventListener("pointerdown", (e) => { pressedOutside = e.target === dlg; });
    dlg.addEventListener("click", (e) => {
      const typing = document.activeElement?.matches("[data-flt-value]");
      if (e.target === dlg && pressedOutside && !typing) close();
      pressedOutside = false;
    });
    $("[data-flt-close]").addEventListener("click", close);
    $("[data-flt-done]").addEventListener("click", close);
    addBtn.addEventListener("click", () => add());
    empty.addEventListener("click", (e) => {
      const preset = e.target.closest("[data-flt-preset]");
      if (preset) add(FLT_PRESETS[Number(preset.dataset.fltPreset)]);
    });
    navBtn.addEventListener("click", () => open(navBtn));
    document.querySelectorAll("[data-bar-filter]").forEach((btn) => btn.addEventListener("click", () => open(btn)));

    syncBadges();
    return { open, sync };
  };

  /* ---- Momentum constellation ---------------------------------------------
     The Momentum table's tickers (the rows it shows: no exclusions, every
     filter passed) as a constellation: the bigger, brighter, warmer and
     closer to the center, the more momentum right now.
     - Heat: every alert adds its intensity (each %Chg in multiples of the
       scanner's minimum, log2-compressed and weighted, times a Vol. 1m
       factor), which decays with a 4-minute half-life. A ticker leaves
       15 minutes after its last alert, fading over the last 40 %.
     - A Halt freezes that clock (no decay, no expiry) until the Resume.
     - Each ticker keeps the angle it arrived with (golden angle); only its
       distance to the center changes.
     - Motion: labels never teleport. Every frame solves a layout with no
       overlaps, starting from the previous one so it stays coherent, and
       each label glides toward its spot on a critically damped spring with
       capped speed and acceleration. However tight the space gets, nothing
       jumps or bursts; size and distance follow the heat just as smoothly. */

  const HEAT_WINDOW = 15 * 60e3;
  const HEAT_HALF_LIFE = 4 * 60e3;
  const HEAT_FRESH = 60e3;          // Rising: an alert in the last minute
  const HEAT_FADING = 5 * 60e3;     // Fading: none in the last 5 minutes
  const HEAT_RESUMED = 2 * 60e3;    // "RESUMED mm:ss" shows this long
  const HEAT_MAX = 14;              // the rest is summed up as "+N more"
  const HEAT_FLOOR = 1.5;           // scale minimum: a lone weak ticker is no leader
  // Column · scanner minimum · weight
  const HEAT_HORIZONS = [["chg1", 2.5, 0.35], ["chg5", 3, 0.3], ["chg15", 5, 0.2], ["chg30", 8, 0.15]];
  const HEAT_COLUMN = { chg1: "%Chg 1m", chg5: "%Chg 5m", chg15: "%Chg 15m", chg30: "%Chg 30m" };
  const HEAT_STATUS = { halted: "Halted", resumed: "Resumed", rising: "Rising", holding: "Momentum holding", fading: "Fading" };
  const HEAT_TONE = { halted: "halt", resumed: "resume", rising: "hot", holding: "warm", fading: "cool" };
  const LEGEND_H = 22;
  // Motion
  const SPRING = 6.5;       // rad/s: settles in about 0.7 s
  const MAX_SPEED = 170;    // px/s
  const MAX_ACCEL = 800;    // px/s²
  const GROW_TAU = 0.45;    // s: size and distance ease toward the heat
  const PULL_TAU = 0.3;     // s: the layout drifts back toward each anchor
  const SCALE_TAU = 0.6;    // s: the scale follows the leader
  // s: labels shrink fast when the room tightens and grow back slowly, so
  // they never outgrow the spots they are still gliding toward.
  const FIT_SHRINK_TAU = 0.25;
  const FIT_GROW_TAU = 0.9;
  const FIT_FILL = 0.42;    // share of the room the labels may cover
  const FIT_MIN = 0.4;      // never below 40 % of their natural size
  const FADE_MS = 450;      // in and out of the chart
  const PULSE_MS = 900;     // a new alert
  const SWAY = 2.5;         // px, drawn only: the layout never sees it
  const GAP = 6;            // px between labels: covers two opposite sways
  const REPEL = 45;         // px/s² per px of overlap between drawn labels
  const SUB_FONT = 8;       // px: the "Halt mm:ss" / "Resumed mm:ss" line
  const SUB_H = 5;          // px the sub line adds above and below the label's center
  const PULSE_GROW = 0.2;   // a new alert's label grows up to 20 %, within its box

  // One alert's intensity: 1 = right at the scanner's minimum.
  const alertHeat = (r) => {
    let total = 0;
    let weights = 0;
    for (const [key, min, weight] of HEAT_HORIZONS) {
      if (!Number.isFinite(r[key])) continue;
      total += weight * Math.log2(1 + Math.max(0, r[key]) / min);
      weights += weight;
    }
    if (!weights) return 0;
    const volume = r.vol1m > 0 ? Math.min(1.5, Math.max(0.8, 1 + 0.2 * Math.log2(r.vol1m))) : 1;
    return (total / weights) * volume;
  };

  // Time a ticker spent halted between two instants.
  const haltedFor = (list, from, to) => list.reduce((sum, h) => sum + Math.max(0, Math.min(h.end, to) - Math.max(h.start, from)), 0);

  const fmtAgo = (ms) => {
    const sec = Math.max(0, Math.round(ms / 1000));
    return sec < 60 ? `${sec}s ago` : `${Math.floor(sec / 60)}m ${pad(sec % 60)}s ago`;
  };

  const mountConstellation = (root) => {
    const canvas = root.querySelector("canvas");
    const tip = root.querySelector(".constellation__tip");
    const ctx = canvas.getContext("2d");

    // Tokens → canvas colors (the canvas normalizes any CSS color to hex).
    const css = getComputedStyle(document.documentElement);
    const token = (name, fallback) => {
      ctx.fillStyle = fallback;
      ctx.fillStyle = css.getPropertyValue(name).trim() || fallback;
      return ctx.fillStyle;
    };
    const C = {
      cool: token("--heat-cool", "#6a86ad"),
      warm: token("--heat-warm", "#ffb84d"),
      hot: token("--heat-hot", "#ff6a3d"),
      halt: token("--heat-halt", "#4cc9ff"),
      resume: token("--heat-resume", "#c8ff38"),
      ring: token("--heat-ring", "#1f242c"),
      text: token("--text", "#f2f4f7"),
      muted: token("--text-3", "#7b8492"),
    };
    const SANS = css.getPropertyValue("--font-sans").trim() || "sans-serif";
    const MONO = css.getPropertyValue("--font-mono").trim() || "monospace";
    const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const alpha = (hex, a) => `rgba(${rgb(hex).join(",")},${a})`;
    const mix = (from, to, t) => {
      const [a, b] = [rgb(from), rgb(to)];
      return `#${a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
    };
    const heatColor = (s) => (s < 0.5 ? mix(C.cool, C.warm, s / 0.5) : mix(C.warm, C.hot, (s - 0.5) / 0.5));
    const smooth = (v) => { const c = Math.min(1, Math.max(0, v)); return c * c * (3 - 2 * c); };

    // Alerts per ticker, newest first; halts per ticker, oldest first.
    const log = new Map();
    const halts = new Map();
    let visible = new Map(); // `log` narrowed to what the Momentum table shows
    let dirty = true;
    let emptyText = "Waiting for momentum alerts...";

    // Animated state per ticker: angle, size, layout spot, drawn position.
    const bubbles = new Map();
    const axes = new Map(); // push axis per overlapping pair (with hysteresis)
    let sequence = 0;
    let scaleHeat = HEAT_FLOOR;
    let fit = 1;
    let W = 0;
    let H = 0;
    let raf = 0;
    let timer = 0;
    let last = 0;
    let pointer = null;
    let hover = "";
    let selected = "";
    let tipKey = "";
    let ariaText = "";

    const record = (r, t = r.time.getTime()) => {
      const list = log.get(r.sym) ?? [];
      list.push({ t, row: r, heat: alertHeat(r) });
      list.sort((a, b) => b.t - a.t);
      // Nothing older than the window can count again.
      while (list.length && Date.now() - list[list.length - 1].t > HEAT_WINDOW * 2) list.pop();
      log.set(r.sym, list);
      invalidate();
    };

    const rebuild = () => {
      const shows = tables.get("momentum")?.shows() ?? (() => true);
      const excluded = tables.get("momentum")?.excluded ?? (() => false);
      visible = new Map();
      let included = 0;
      log.forEach((list, sym) => {
        if (excluded(sym)) return;
        included += 1;
        const kept = list.filter((a) => shows(a.row));
        if (kept.length) visible.set(sym, kept);
      });
      emptyText = included ? "No rows match active filters" : "Waiting for momentum alerts...";
      dirty = false;
    };

    // Heat now. Each alert's age leaves out the time spent halted.
    const stateOf = (sym, alerts, now) => {
      const list = halts.get(sym) ?? [];
      const lastHalt = list[list.length - 1];
      const halted = !!lastHalt && lastHalt.start <= now && now < lastHalt.end;
      let heat = 0;
      let count = 0;
      let lastAge = Infinity;
      for (const a of alerts) {
        const age = Math.max(0, now - a.t - haltedFor(list, a.t, now));
        if (age > HEAT_WINDOW) break;
        if (!count) lastAge = age;
        heat += a.heat * 0.5 ** (age / HEAT_HALF_LIFE);
        count += 1;
      }
      if (!count) return null;
      const resumedAt = !halted && lastHalt && now >= lastHalt.end && now - lastHalt.end < HEAT_RESUMED ? lastHalt.end : null;
      const status = halted ? "halted" : resumedAt != null ? "resumed"
        : lastAge < HEAT_FRESH ? "rising" : lastAge > HEAT_FADING ? "fading" : "holding";
      return { sym, heat, count, lastAge, latest: alerts[0], first: alerts[count - 1], halted, haltStart: halted ? lastHalt.start : null, resumedAt, status };
    };

    const geometry = () => ({
      cx: W / 2,
      cy: (LEGEND_H + H) / 2,
      rx: Math.max(10, W / 2 - 16),
      ry: Math.max(10, (H - LEGEND_H) / 2 - 12),
      minFont: 11,
      maxFont: Math.max(18, Math.min(44, H * 0.2, W * 0.12)),
    });

    const sublabelOf = (st, now) => (st.halted ? `Halt ${fmtClock(now - st.haltStart)}`
      : st.resumedAt != null ? `Resumed ${fmtClock(now - st.resumedAt)}` : "");

    // Text width scales with the font size: measure each ticker once, at
    // 100px (measureText is the costly part of a frame).
    const widths = new Map();
    const textWidth = (sym, size) => {
      if (!widths.has(sym)) {
        ctx.font = `800 100px ${SANS}`;
        widths.set(sym, ctx.measureText(sym).width / 100);
      }
      return widths.get(sym) * size;
    };
    // The sub line is monospaced: one measure per character count.
    const subWidth = (text) => {
      const key = `\u0000sub${text.length}`;
      if (!widths.has(key)) {
        ctx.font = `600 ${SUB_FONT}px ${MONO}`;
        widths.set(key, ctx.measureText("0".repeat(text.length)).width);
      }
      return widths.get(key);
    };
    // Pause icon (halted), as drawn by drawPause.
    const pauseWidth = (size) => Math.max(2, size * 0.14) * 2.9 + size * 0.18;

    // Box of a label at its current (eased) size.
    const naturalFont = (b, g) => g.minFont + (g.maxFont - g.minFont) * b.s;
    // The size eases too, whatever changes it (heat, room, panel size):
    // shrinking is quick, growing slow, so a label never outgrows the spot
    // it is still gliding toward.
    const measure = (b, g, now, ease) => {
      const st = b.state;
      const font = Math.max(8, naturalFont(b, g) * fit);
      b.font = b.font ? b.font + (font - b.font) * ease(font < b.font ? FIT_SHRINK_TAU : FIT_GROW_TAU) : font;
      b.textW = textWidth(st.sym, b.font);
      b.iconW = st.halted ? pauseWidth(b.font) : st.status === "rising" ? b.font * 0.42 : 0;
      b.sub = sublabelOf(st, now);
      // The box holds the label and its sub line, whichever is wider.
      b.hw = Math.max((b.textW + b.iconW) / 2 + 3 + b.font * 0.1, b.sub ? subWidth(b.sub) / 2 + 2 : 0);
      b.hh = b.font * 0.5 + (b.sub ? SUB_H : 0) + 1;
    };

    // Separates overlapping boxes along the axis they overlap least on. The
    // axis only switches when the other one is clearly shorter, or when a
    // wall blocks it (at most every 0.6 s), so a pair never flip-flops; the
    // bigger label gives way less, and a label fading out not at all (it is
    // still drawn where it was, so the others go around it).
    const share = (a, b) => (a.leaving ? 0 : b.leaving ? 1 : (b.hw * b.hh) / (a.hw * a.hh + b.hw * b.hh));
    const solve = (items, clock) => {
      const top = LEGEND_H;
      for (let pass = 0; pass < 24; pass++) {
        let moved = false;
        for (let i = 0; i < items.length; i++) {
          for (let j = i + 1; j < items.length; j++) {
            const a = items[i];
            const b = items[j];
            if (a.leaving && b.leaving) continue;
            const key = a.sym < b.sym ? `${a.sym}|${b.sym}` : `${b.sym}|${a.sym}`;
            const dx = b.lx - a.lx;
            const dy = b.ly - a.ly;
            const ox = a.hw + b.hw + GAP - Math.abs(dx);
            const oy = a.hh + b.hh + GAP - Math.abs(dy);
            if (ox <= 0 || oy <= 0) { if (pass === 0) axes.delete(key); continue; }
            moved = true;
            const fx = ox / (a.hw + b.hw);
            const fy = oy / (a.hh + b.hh);
            const held = axes.get(key) ?? { axis: fx < fy ? "x" : "y", at: clock, lock: 0 };
            if (clock < held.lock) { /* a wall made it switch: keep it */ }
            else if (held.axis === "x" && fy < fx * 0.7) Object.assign(held, { axis: "y", at: clock });
            else if (held.axis === "y" && fx < fy * 0.7) Object.assign(held, { axis: "x", at: clock });
            axes.set(key, held);
            const { axis } = held;
            const wa = share(a, b);
            // Side: where they are, or where they are headed when stacked.
            const d = axis === "x" ? dx : dy;
            const side = Math.sign(Math.abs(d) > 0.5 ? d : (axis === "x" ? b.ax - a.ax : b.ay - a.ay) || (a.angle > b.angle ? 1 : -1));
            const push = side * (axis === "x" ? ox : oy);
            if (axis === "x") { a.lx -= push * wa; b.lx += push * (1 - wa); }
            else { a.ly -= push * wa; b.ly += push * (1 - wa); }
          }
        }
        for (const b of items) {
          if (b.leaving) continue;
          b.lx = Math.min(W - b.hw - 2, Math.max(b.hw + 2, b.lx));
          b.ly = Math.min(H - b.hh - 2, Math.max(top + b.hh, b.ly));
        }
        if (!moved) break;
      }
      // Still touching after every pass: a wall is in the way on that axis.
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i];
          const b = items[j];
          if (a.leaving && b.leaving) continue;
          if (a.hw + b.hw - Math.abs(b.lx - a.lx) <= 0.5 || a.hh + b.hh - Math.abs(b.ly - a.ly) <= 0.5) continue;
          const held = axes.get(a.sym < b.sym ? `${a.sym}|${b.sym}` : `${b.sym}|${a.sym}`);
          if (held && clock - held.at > 600) Object.assign(held, { axis: held.axis === "x" ? "y" : "x", at: clock, lock: clock + 600 });
        }
      }
    };

    // Critically damped spring toward the layout spot. Acceleration and speed
    // are capped as vectors, so the path stays straight and never spikes.
    const glide = (b, dt, snap) => {
      if (snap || !Number.isFinite(b.x)) {
        b.x = b.lx; b.y = b.ly; b.vx = 0; b.vy = 0;
        return;
      }
      let ax = SPRING * SPRING * (b.lx - b.x) - 2 * SPRING * b.vx + b.px;
      let ay = SPRING * SPRING * (b.ly - b.y) - 2 * SPRING * b.vy + b.py;
      const a = Math.hypot(ax, ay);
      if (a > MAX_ACCEL) { ax *= MAX_ACCEL / a; ay *= MAX_ACCEL / a; }
      b.vx += ax * dt;
      b.vy += ay * dt;
      const v = Math.hypot(b.vx, b.vy);
      if (v > MAX_SPEED) { b.vx *= MAX_SPEED / v; b.vy *= MAX_SPEED / v; }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    };

    // On the way to their spots, labels that touch nudge each other aside
    // (a force, inside the same acceleration cap) instead of crossing.
    const repel = (items) => {
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i];
          const b = items[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const ox = a.hw + b.hw + GAP / 2 - Math.abs(dx);
          const oy = a.hh + b.hh + GAP / 2 - Math.abs(dy);
          if (ox <= 0 || oy <= 0 || (a.leaving && b.leaving)) continue;
          const wa = share(a, b);
          if (ox / (a.hw + b.hw) < oy / (a.hh + b.hh)) {
            const push = Math.sign(dx || b.lx - a.lx || 1) * ox * REPEL;
            a.px -= push * wa;
            b.px += push * (1 - wa);
          } else {
            const push = Math.sign(dy || b.ly - a.ly || 1) * oy * REPEL;
            a.py -= push * wa;
            b.py += push * (1 - wa);
          }
        }
      }
    };

    const drawBackdrop = (g) => {
      ctx.save();
      ctx.strokeStyle = C.ring;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 5]);
      [1, 2 / 3, 1 / 3].forEach((f) => {
        ctx.beginPath();
        ctx.ellipse(g.cx, g.cy, g.rx * f, g.ry * f, 0, 0, Math.PI * 2);
        ctx.stroke();
      });
      ctx.restore();
    };

    const drawPause = (x, size, color) => {
      const w = Math.max(2, size * 0.14);
      const h = size * 0.62;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(x, -h / 2, w, h, w / 2);
      ctx.roundRect(x + w * 1.9, -h / 2, w, h, w / 2);
      ctx.fill();
      return w * 2.9 + size * 0.18;
    };

    const drawBubble = (b, now, still) => {
      const st = b.state;
      const sway = still ? 0 : SWAY;
      const wave = (now / b.period) * Math.PI * 2 + b.phase;
      const x = b.x + Math.sin(wave) * sway;
      const y = b.y + Math.cos(wave * 1.3) * sway;
      // Fades out over the last 40 % of the window unless new alerts arrive.
      const life = st.halted ? 1 : smooth((HEAT_WINDOW - st.lastAge) / (HEAT_WINDOW * 0.4));
      const a = smooth(b.vis) * Math.max(0.3, (0.45 + 0.55 * b.s) * life);
      const pulse = still ? 0 : Math.max(0, 1 - (now - b.pulseAt) / PULSE_MS);
      const color = st.halted ? C.halt : heatColor(b.s);
      const isHover = st.sym === hover;
      const isSelected = st.sym === selected;
      const labelY = y - (b.sub ? SUB_H - 0.5 : 0);

      ctx.save();
      ctx.globalAlpha = isHover ? Math.max(a, 0.92) : a;
      if (isHover || isSelected) {
        ctx.fillStyle = alpha(isSelected ? color : C.text, isSelected ? 0.1 : 0.06);
        ctx.strokeStyle = alpha(isSelected ? color : C.text, isSelected ? 0.55 : 0.22);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(x - b.hw - 3, y - b.hh - 2, b.hw * 2 + 6, b.hh * 2 + 4, 8);
        ctx.fill();
        ctx.stroke();
      }
      ctx.translate(x, labelY);
      // The pulse never grows the label past its box (the layout's spacing).
      const room = 2 * (b.hw - 1) / (b.textW + b.iconW) - 1;
      const grow = 1 + Math.max(0, Math.min(PULSE_GROW, room)) * pulse;
      ctx.scale(grow, grow);
      ctx.shadowColor = alpha(color, 0.55);
      ctx.shadowBlur = st.halted ? 8 : 4 + 12 * b.s + 16 * pulse;
      ctx.font = `800 ${b.font.toFixed(1)}px ${SANS}`;
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      let cursor = -(b.textW + b.iconW) / 2;
      if (st.halted) cursor += drawPause(cursor, b.font, color);
      ctx.fillStyle = color;
      ctx.fillText(st.sym, cursor, b.font * 0.04);
      if (st.status === "rising") {
        // "Rising now": an alert in the last minute.
        const size = b.font * 0.26;
        const left = cursor + b.textW + b.font * 0.12;
        const top = -b.font * 0.34;
        ctx.beginPath();
        ctx.moveTo(left, top + size);
        ctx.lineTo(left + size, top + size);
        ctx.lineTo(left + size / 2, top);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();

      if (b.sub) {
        ctx.save();
        ctx.globalAlpha = smooth(b.vis);
        ctx.font = `600 ${SUB_FONT}px ${MONO}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = st.halted ? C.halt : C.resume;
        ctx.fillText(b.sub, x, y + b.hh - SUB_H);
        ctx.restore();
      }
    };

    const updateTip = (b, total, now) => {
      if (!b) {
        tipKey = "";
        tip.hidden = true;
        return;
      }
      const st = b.state;
      // Its text only changes from second to second (ages and clocks).
      const key = `${st.sym}|${st.latest.t}|${st.status}|${st.rank}|${total}|${Math.floor(now / 1000)}`;
      if (key !== tipKey) {
        tipKey = key;
        const { latest, first } = st;
        const r = latest.row;
        const move = st.count > 1 && first.row.price > 0 ? (r.price / first.row.price - 1) * 100 : NaN;
        let status = HEAT_STATUS[st.status];
        if (st.halted) status += ` · ${fmtClock(now - st.haltStart)}`;
        if (st.resumedAt != null) status += ` · ${fmtAgo(now - st.resumedAt)}`;
        const line = (label, value, cls = "") => `<dt>${label}</dt><dd class="${cls}">${escHTML(value)}</dd>`;
        const sign = (v) => (v > 0 ? "up" : v < 0 ? "down" : "");
        tip.innerHTML = `
          <span class="constellation__tip-title"><strong>${escHTML(st.sym)}</strong>#${st.rank} of ${total}</span>
          <span class="constellation__tip-status" data-tone="${HEAT_TONE[st.status]}">${escHTML(status)}</span>
          <dl>
            ${line("Last alert", fmtTime(new Date(latest.t)))}
            ${line("Age", fmtAgo(now - latest.t))}
            ${line("Alerts (15m)", String(st.count))}
            ${line("Price", fmtPrice(r.price))}
            ${Number.isFinite(move) ? line("Since 1st alert", fmtPct(move, 1), sign(move)) : ""}
            ${HEAT_HORIZONS.filter(([k]) => Number.isFinite(r[k])).map(([k]) => line(HEAT_COLUMN[k], fmtPct(r[k], 2), sign(r[k]))).join("")}
            ${r.vol1m > 0 ? line("Vol. 1m", fmtMult(r.vol1m)) : ""}
          </dl>
          <span class="constellation__tip-hint">${st.sym === selected ? "Click to deselect" : "Click to select"}</span>`;
        tip.hidden = false;
      }
      // Fixed to the viewport: it may overflow the panel, never the screen.
      const { offsetWidth: tw, offsetHeight: th } = tip;
      const box = canvas.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      const x = box.left + b.x;
      const right = x + b.hw + 12;
      const left = right + tw <= vw - 8 ? right : Math.min(vw - tw - 8, Math.max(8, x - b.hw - 12 - tw));
      const top = Math.min(vh - th - 8, Math.max(8, box.top + b.y - th / 2));
      tip.style.left = `${Math.round(left)}px`;
      tip.style.top = `${Math.round(top)}px`;
    };

    const frame = () => {
      raf = 0;
      if (!W || !H) return;
      if (dirty) rebuild();
      const now = Date.now();
      // Motion runs on the monotonic clock; only the first frame snaps.
      const tick = performance.now();
      const dt = last ? Math.min(0.1, (tick - last) / 1000) : 0;
      const snap = reduceMotion.matches || !last;
      const still = reduceMotion.matches;
      last = tick;
      const ease = (tau) => (snap ? 1 : 1 - Math.exp(-dt / tau));
      const g = geometry();

      const states = [];
      visible.forEach((alerts, sym) => {
        const st = stateOf(sym, alerts, now);
        if (st) states.push(st);
      });
      states.sort((a, b) => b.heat - a.heat);
      const shown = states.slice(0, HEAT_MAX);
      shown.forEach((st, i) => { st.rank = i + 1; });

      // The scale follows the leader smoothly, so the rest never lurch.
      const target = Math.max(HEAT_FLOOR, shown[0]?.heat ?? 0);
      scaleHeat += (target - scaleHeat) * ease(SCALE_TAU);

      const live = new Set();
      shown.forEach((st) => {
        const strength = Math.min(1, Math.sqrt(st.heat / scaleHeat));
        let b = bubbles.get(st.sym);
        if (!b) {
          const seed = seeded(st.sym)();
          b = {
            sym: st.sym,
            // Golden angle by arrival: tickers spread around the center.
            angle: -Math.PI / 2 + sequence++ * 2.39996,
            phase: seed * Math.PI * 2,
            period: 7000 + seed * 4000,
            s: strength,
            vis: 0,
            lastAlertAt: st.latest.t,
            pulseAt: now - st.latest.t < PULSE_MS ? now : -Infinity,
            lx: NaN, ly: NaN, x: NaN, y: NaN, vx: 0, vy: 0, px: 0, py: 0,
          };
          bubbles.set(st.sym, b);
        } else if (st.latest.t > b.lastAlertAt) {
          b.lastAlertAt = st.latest.t;
          b.pulseAt = now;
        }
        b.state = st;
        b.s += (strength - b.s) * ease(GROW_TAU);
        live.add(st.sym);
      });

      // In and out: fade, then drop. A ticker that leaves the top list or
      // expires keeps its spot while it fades.
      const step = snap ? 1 : (dt * 1000) / FADE_MS;
      bubbles.forEach((b, sym) => {
        b.vis = live.has(sym) ? Math.min(1, b.vis + step) : Math.max(0, b.vis - step);
        if (!live.has(sym) && (b.vis <= 0 || still)) bubbles.delete(sym);
      });

      // Layout: anchors from the eased strength, drifted toward from the
      // previous spots, then pulled apart. The drawn labels glide after it.
      bubbles.forEach((b) => { b.leaving = !live.has(b.sym); });
      const active = [...bubbles.values()].filter((b) => !b.leaving);
      // Density: when the labels at their natural size would not fit (a
      // narrow panel, many hot tickers), they all shrink together, smoothly,
      // instead of shoving each other around.
      const room = W * (H - LEGEND_H) * FIT_FILL;
      const need = active.reduce((sum, b) => {
        const font = naturalFont(b, g);
        const sub = sublabelOf(b.state, now);
        const w = Math.max(textWidth(b.sym, font) + font * 0.8, sub ? subWidth(sub) + 4 : 0);
        return sum + (w + GAP) * (font + GAP + (sub ? SUB_H * 2 : 0));
      }, 0);
      fit = need ? Math.max(FIT_MIN, Math.min(1, Math.sqrt(room / need))) : 1;
      const pull = ease(PULL_TAU);
      active.forEach((b) => {
        measure(b, g, now, ease);
        const r = 1 - b.s;
        b.ax = g.cx + g.rx * r * Math.cos(b.angle);
        b.ay = g.cy + g.ry * r * Math.sin(b.angle);
        if (!Number.isFinite(b.lx)) { b.lx = b.ax; b.ly = b.ay; }
        else { b.lx += (b.ax - b.lx) * pull; b.ly += (b.ay - b.ly) * pull; }
      });
      // Labels fading out stay in as fixed obstacles until they are gone.
      const placed = [...bubbles.values()].filter((b) => !b.leaving || Number.isFinite(b.lx));
      solve(placed, tick);
      bubbles.forEach((b) => { b.px = 0; b.py = 0; });
      repel(placed.filter((b) => Number.isFinite(b.x)));
      bubbles.forEach((b) => glide(b, dt, snap));

      const items = [...bubbles.values()];
      const hovered = pointer
        ? [...active].sort((a, b) => b.s - a.s).find((b) => Math.abs(pointer.x - b.x) <= b.hw + 3 && Math.abs(pointer.y - b.y) <= b.hh + 3)
        : null;
      hover = hovered?.sym ?? "";
      canvas.style.cursor = hovered ? "pointer" : "";

      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      drawBackdrop(g);
      // Weakest first: the leader is drawn on top.
      items.sort((a, b) => a.s - b.s).forEach((b) => drawBubble(b, now, still));

      ctx.font = `600 10px ${MONO}`;
      ctx.textBaseline = "middle";
      ctx.fillStyle = C.muted;
      ctx.textAlign = "left";
      ctx.fillText("Last 15m · closer to center = stronger", 10, LEGEND_H / 2 + 2);
      if (states.length > shown.length) {
        ctx.textAlign = "right";
        ctx.fillText(`+${states.length - shown.length} more`, W - 10, H - 10);
      }
      if (!items.length) {
        ctx.font = `600 12px ${SANS}`;
        ctx.textAlign = "center";
        ctx.fillText(emptyText, g.cx, g.cy);
      }

      updateTip(hovered, shown.length, now);
      const aria = shown.length
        ? `Momentum constellation, strongest first: ${shown.slice(0, 5).map((st) => `${st.sym} ${HEAT_STATUS[st.status].toLowerCase()}`).join(", ")}`
        : `Momentum constellation: ${emptyText}`;
      if (aria !== ariaText) canvas.setAttribute("aria-label", (ariaText = aria));

      if (!items.length) return;
      // Reduced motion: one repaint a second is enough (decay and clocks).
      if (still) timer = setTimeout(() => { timer = 0; schedule(); }, 1000);
      else schedule();
    };

    const schedule = () => {
      if (raf || timer || document.hidden) return;
      raf = requestAnimationFrame(frame);
    };
    const invalidate = () => {
      dirty = true;
      schedule();
    };

    new ResizeObserver(() => {
      const box = root.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      W = Math.floor(box.width);
      H = Math.floor(box.height);
      canvas.width = Math.max(1, Math.round(W * dpr));
      canvas.height = Math.max(1, Math.round(H * dpr));
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      schedule();
    }).observe(root);

    canvas.addEventListener("pointermove", (e) => {
      const box = canvas.getBoundingClientRect();
      pointer = { x: e.clientX - box.left, y: e.clientY - box.top };
      schedule();
    });
    canvas.addEventListener("pointerleave", () => {
      pointer = null;
      schedule();
    });
    // Select a ticker (framed here; the chart panel will listen for it).
    canvas.addEventListener("click", () => {
      if (!hover) return;
      selected = selected === hover ? "" : hover;
      tipKey = "";
      document.dispatchEvent(new CustomEvent("scanner:select", { detail: { sym: selected } }));
      schedule();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) return;
      last = 0;
      schedule();
    });
    reduceMotion.addEventListener("change", () => {
      clearTimeout(timer);
      timer = 0;
      schedule();
    });
    document.fonts?.ready.then(() => { widths.clear(); schedule(); });

    return {
      alert: (r) => record(r),
      halt: (r) => {
        const list = halts.get(r.sym) ?? [];
        list.push({ start: r.haltAt.getTime(), end: r.resumeAt.getTime() });
        halts.set(r.sym, list);
        invalidate();
      },
      // Mock history: the seed tickers fired over the last few minutes, the
      // strongest more often and more recently.
      seed: (rows) => rows.forEach((r, i) => {
        const rnd = seeded(`${r.sym}:heat`);
        let t = Date.now() - (i * 34 + rnd() * 20) * 1000;
        for (let n = Math.max(1, 4 - Math.floor(i / 3)); n > 0; n--) {
          record(r, t);
          t -= (40 + rnd() * 60) * 1000;
        }
      }),
      refresh: invalidate,
      // Alert and halt history, so a detached copy starts with the same heat.
      dump: () => ({ log: [...log], halts: [...halts] }),
      load: (data) => {
        log.clear();
        halts.clear();
        data.log.forEach(([sym, list]) => log.set(sym, list));
        data.halts.forEach(([sym, list]) => halts.set(sym, list));
        invalidate();
      },
    };
  };

  /* ---- Chart panel: views, fullscreen and layouts --------------------------
     Outside fullscreen the stage holds one pane. In fullscreen the layout
     menu splits it into 1–3 panes (nested splits; the gaps between panes
     are drag handles). The toolbar tabs act on the active pane: picking a
     view shown in another pane swaps the two.
     A detached copy gets the layouts without fullscreen too, once its
     window is big enough (CHART_ROOMY); shrunk back, it shows one pane. */

  const CHART_LAYOUT_KEY = "scanner:chart-layout:v1";
  const PANE_MIN = { x: 200, y: 140 }; // smallest pane while resizing (px)
  // Panel size (px) from which a detached copy offers layouts. It drops
  // them only below the size minus SLACK, so a resize near the edge never
  // flickers between the two.
  const CHART_ROOMY = { w: 960, h: 600, slack: 40 };

  // Leaves are pane indexes. "row" puts its kids side by side (vertical
  // charts), "col" stacks them (horizontal charts).
  const CHART_LAYOUTS = [
    { id: "1", label: "One chart", tree: 0 },
    { id: "2v", label: "Two vertical charts", tree: { dir: "row", kids: [0, 1] } },
    { id: "2h", label: "Two horizontal charts", tree: { dir: "col", kids: [0, 1] } },
    { id: "3v", label: "Three vertical charts", tree: { dir: "row", kids: [0, 1, 2] } },
    { id: "3h", label: "Three horizontal charts", tree: { dir: "col", kids: [0, 1, 2] } },
    { id: "3l", label: "One vertical chart on the left, two horizontal on the right", tree: { dir: "row", kids: [0, { dir: "col", kids: [1, 2] }] } },
    { id: "3r", label: "Two horizontal charts on the left, one vertical on the right", tree: { dir: "row", kids: [{ dir: "col", kids: [0, 1] }, 2] } },
    { id: "3t", label: "One horizontal chart on top, two vertical below", tree: { dir: "col", kids: [0, { dir: "row", kids: [1, 2] }] } },
    { id: "3b", label: "Two vertical charts on top, one horizontal below", tree: { dir: "col", kids: [{ dir: "row", kids: [0, 1] }, 2] } },
  ];
  const paneCount = (node) => (typeof node === "number" ? 1 : node.kids.reduce((n, k) => n + paneCount(k), 0));

  // Menu tile: the layout drawn as rectangles in a 28 × 20 box.
  const layoutIcon = (tree) => {
    const rects = [];
    const walk = (node, x, y, w, h) => {
      if (typeof node === "number") {
        rects.push([x, y, w, h]);
        return;
      }
      const gap = 2;
      const along = ((node.dir === "row" ? w : h) - gap * (node.kids.length - 1)) / node.kids.length;
      node.kids.forEach((kid, i) => {
        const at = i * (along + gap);
        if (node.dir === "row") walk(kid, x + at, y, along, h);
        else walk(kid, x, y + at, w, along);
      });
    };
    walk(tree, 1, 1, 26, 18);
    const r = (v) => +v.toFixed(2);
    const shapes = rects.map(([x, y, w, h]) => `<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" rx="1.5"/>`);
    return `<svg viewBox="0 0 28 20" aria-hidden="true">${shapes.join("")}</svg>`;
  };

  // `persist: false` (a detached copy): it starts from the saved views and
  // layout but never saves over them, so each window keeps its own.
  // `adaptive`: layouts once the panel is roomy, not only in fullscreen.
  const mountChartPanel = (root, { persist = true, adaptive = false } = {}) => {
    const stage = root.querySelector(".chart-stage");
    const symbol = root.querySelector(".chart-symbol__input");
    const tablist = root.querySelector(".chart-tabs");
    const tabs = [...tablist.querySelectorAll("[role='tab']")];
    const ids = tabs.map((t) => t.getAttribute("aria-controls"));
    const views = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
    const tabOf = Object.fromEntries(ids.map((id, i) => [id, tabs[i]]));
    const fsBtn = root.querySelector("[data-chart-fullscreen]");
    const layoutBtn = root.querySelector("[data-chart-layout]");
    const menu = root.querySelector(".chart-layouts");
    const byId = Object.fromEntries(CHART_LAYOUTS.map((l) => [l.id, l]));
    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
    // Views off screen wait here, still in the document
    const stash = document.createElement("div");
    stash.hidden = true;

    // order: pane i shows order[i]; active: the pane the tabs act on.
    // Outside fullscreen the one pane shows order[active].
    const state = { layout: "1", order: [...ids], active: 0, sizes: {} };
    try {
      const saved = JSON.parse(localStorage.getItem(CHART_LAYOUT_KEY) || "{}");
      if (byId[saved.layout]) state.layout = saved.layout;
      if (Array.isArray(saved.order) && saved.order.length === ids.length && ids.every((id) => saved.order.includes(id))) state.order = saved.order;
      if (Number.isInteger(saved.active) && saved.active >= 0 && saved.active < paneCount(byId[state.layout].tree)) state.active = saved.active;
      if (saved.sizes && typeof saved.sizes === "object") state.sizes = saved.sizes;
    } catch { /* ignore */ }
    const save = () => {
      if (!persist) return;
      try { localStorage.setItem(CHART_LAYOUT_KEY, JSON.stringify(state)); } catch { /* ignore */ }
    };
    const sizesOf = (key, n) => {
      const s = state.sizes[key];
      return Array.isArray(s) && s.length === n && s.every((v) => v > 0) ? s : Array(n).fill(1 / n);
    };

    let full = false;
    let roomy = false; // a detached copy in a big enough window
    let panes = [];
    const multi = () => full || roomy; // layouts apply
    const layout = () => byId[multi() ? state.layout : "1"];
    const shown = () => (multi() ? state.order.slice(0, paneCount(layout().tree)) : [state.order[state.active]]);
    const activePane = () => (multi() ? state.active : 0);

    /* Panes ← views, active pane, tabs */
    const fill = () => {
      const list = shown();
      const active = activePane();
      Object.entries(views).forEach(([id, v]) => {
        if (list.includes(id)) return;
        v.hidden = true;
        if (v.parentElement !== stash) stash.append(v);
      });
      panes.forEach((pane, i) => {
        const v = views[list[i]];
        const body = pane.querySelector(".chart-pane__body");
        if (v.parentElement !== body) body.replaceChildren(v);
        v.hidden = false;
        pane.classList.toggle("is-active", i === active);
        const head = pane.querySelector(".chart-pane__head");
        if (head) {
          const tab = tabOf[list[i]];
          head.replaceChildren(tab.querySelector("svg").cloneNode(true), tab.querySelector("span").cloneNode(true));
          pane.setAttribute("aria-label", tab.textContent.trim());
        }
      });
      tabs.forEach((t, i) => {
        const on = ids[i] === list[active];
        t.setAttribute("aria-selected", String(on));
        t.tabIndex = on ? 0 : -1;
        t.toggleAttribute("data-shown", !on && list.includes(ids[i]));
      });
    };

    /* Divider between two siblings of a split. Resizing keeps the pair's
       sum, so every other pane stays where it was. */
    const divider = (split, key, axis) => {
      const d = document.createElement("div");
      d.className = "chart-divider";
      d.tabIndex = 0;
      d.setAttribute("role", "separator");
      d.setAttribute("aria-orientation", axis === "x" ? "vertical" : "horizontal");
      d.setAttribute("aria-label", "Resize charts");
      d.setAttribute("aria-valuemin", "0");
      d.setAttribute("aria-valuemax", "100");
      const kids = () => [...split.children].filter((el) => !el.classList.contains("chart-divider"));
      const index = () => [...split.querySelectorAll(":scope > .chart-divider")].indexOf(d);
      const size = (el) => el.getBoundingClientRect()[axis === "x" ? "width" : "height"];
      const grows = (list) => list.map((el) => Number(el.style.getPropertyValue("--grow")) || 1);
      const resize = (px) => {
        const i = index();
        const list = kids();
        const g = grows(list);
        const total = size(list[i]) + size(list[i + 1]);
        const lo = Math.min(PANE_MIN[axis], total / 2);
        const pair = g[i] + g[i + 1];
        g[i] = (pair * clamp(px, lo, total - lo)) / (total || 1);
        g[i + 1] = pair - g[i];
        list.forEach((el, j) => el.style.setProperty("--grow", String(g[j])));
        d.setAttribute("aria-valuenow", String(Math.round((100 * g[i]) / pair)));
      };
      const store = () => {
        const g = grows(kids());
        const sum = g.reduce((s, v) => s + v, 0);
        state.sizes[key] = g.map((v) => +(v / sum).toFixed(4));
        save();
      };
      const pos = (e) => (axis === "x" ? e.clientX : e.clientY);

      d.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        d.setPointerCapture(e.pointerId);
        const start = pos(e);
        const from = size(kids()[index()]);
        let frame = 0;
        let last = e;
        d.classList.add("is-active");
        document.documentElement.dataset.resizing = axis;
        const move = (ev) => {
          last = ev;
          frame ||= requestAnimationFrame(() => { frame = 0; resize(from + pos(last) - start); });
        };
        const up = () => {
          cancelAnimationFrame(frame);
          resize(from + pos(last) - start);
          d.classList.remove("is-active");
          delete document.documentElement.dataset.resizing;
          d.removeEventListener("pointermove", move);
          d.removeEventListener("pointerup", up);
          d.removeEventListener("pointercancel", up);
          store();
        };
        d.addEventListener("pointermove", move);
        d.addEventListener("pointerup", up);
        d.addEventListener("pointercancel", up);
      });
      d.addEventListener("keydown", (e) => {
        const step = e.shiftKey ? 64 : 16;
        const keys = axis === "x" ? { ArrowLeft: -step, ArrowRight: step } : { ArrowUp: -step, ArrowDown: step };
        if (!(e.key in keys)) return;
        e.preventDefault();
        resize(size(kids()[index()]) + keys[e.key]);
        store();
      });
      // Double-click: this split back to equal parts
      d.addEventListener("dblclick", () => {
        kids().forEach((el) => el.style.setProperty("--grow", "1"));
        d.setAttribute("aria-valuenow", "50");
        store();
      });
      return d;
    };

    /* Stage ← the current layout */
    const build = () => {
      const { id, tree } = layout();
      const multi = paneCount(tree) > 1;
      panes = [];
      const node = (n, path) => {
        if (typeof n === "number") {
          const pane = document.createElement("div");
          pane.className = "chart-pane";
          pane.dataset.pane = String(n);
          if (multi) {
            pane.setAttribute("role", "group");
            const head = document.createElement("div");
            head.className = "chart-pane__head";
            head.setAttribute("aria-hidden", "true");
            pane.append(head);
          }
          const body = document.createElement("div");
          body.className = "chart-pane__body";
          pane.append(body);
          panes[n] = pane;
          return pane;
        }
        const split = document.createElement("div");
        split.className = "chart-split";
        split.dataset.dir = n.dir;
        const key = `${id}:${path}`;
        const sizes = sizesOf(key, n.kids.length);
        n.kids.forEach((kid, i) => {
          if (i) {
            const d = divider(split, key, n.dir === "row" ? "x" : "y");
            d.setAttribute("aria-valuenow", String(Math.round((100 * sizes[i - 1]) / (sizes[i - 1] + sizes[i]))));
            split.append(d);
          }
          const el = node(kid, `${path}${i}`);
          el.style.setProperty("--grow", String(sizes[i]));
          split.append(el);
        });
        return split;
      };
      Object.values(views).forEach((v) => stash.append(v));
      stage.replaceChildren(node(tree, ""), stash);
      stage.toggleAttribute("data-multi", multi);
      fill();
    };

    /* Tabs: set the active pane's view */
    const select = (id, focus = false) => {
      const a = state.active;
      const j = state.order.indexOf(id);
      [state.order[a], state.order[j]] = [state.order[j], state.order[a]];
      fill();
      save();
      if (focus) tabOf[id].focus();
    };
    tablist.addEventListener("click", (e) => {
      const t = e.target.closest("[role='tab']");
      if (t && t.getAttribute("aria-selected") !== "true") select(t.getAttribute("aria-controls"));
    });
    tablist.addEventListener("keydown", (e) => {
      const i = tabs.indexOf(e.target.closest("[role='tab']"));
      if (i < 0) return;
      const n = tabs.length;
      const next = { ArrowRight: (i + 1) % n, ArrowLeft: (i - 1 + n) % n, Home: 0, End: n - 1 }[e.key];
      if (next === undefined) return;
      e.preventDefault();
      select(ids[next], true);
    });

    // A click or focus inside a pane makes it the active one
    const activate = (e) => {
      if (!multi()) return;
      const pane = e.target.closest(".chart-pane");
      if (!pane) return;
      const i = Number(pane.dataset.pane);
      if (i === state.active) return;
      state.active = i;
      fill();
      save();
    };
    stage.addEventListener("pointerdown", activate);
    stage.addEventListener("focusin", activate);

    /* Layout menu: tiles grouped by chart count */
    const tiles = [];
    menu.replaceChildren(...[1, 2, 3].map((n) => {
      const group = document.createElement("div");
      const title = `${n} chart${n > 1 ? "s" : ""}`;
      group.className = "chart-layouts__group";
      group.setAttribute("role", "group");
      group.setAttribute("aria-label", title);
      group.innerHTML = `<p class="chart-layouts__title" aria-hidden="true">${title}</p><div class="chart-layouts__row"></div>`;
      CHART_LAYOUTS.filter((l) => paneCount(l.tree) === n).forEach((l) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "chart-layout-opt";
        b.tabIndex = -1;
        b.dataset.layout = l.id;
        b.title = l.label;
        b.setAttribute("role", "menuitemradio");
        b.setAttribute("aria-label", l.label);
        b.innerHTML = layoutIcon(l.tree);
        group.lastElementChild.append(b);
        tiles.push(b);
      });
      return group;
    }));
    const markMenu = () => tiles.forEach((b) => b.setAttribute("aria-checked", String(b.dataset.layout === state.layout)));
    const openMenu = () => {
      markMenu();
      menu.hidden = false;
      layoutBtn.setAttribute("aria-expanded", "true");
      (tiles.find((b) => b.getAttribute("aria-checked") === "true") || tiles[0]).focus();
    };
    const closeMenu = (refocus = false) => {
      if (menu.hidden) return;
      menu.hidden = true;
      layoutBtn.setAttribute("aria-expanded", "false");
      if (refocus) layoutBtn.focus();
    };
    // Fewer panes: the active view moves into the last pane that remains
    const setLayout = (id) => {
      const n = paneCount(byId[id].tree);
      if (state.active >= n) {
        const a = state.active;
        [state.order[a], state.order[n - 1]] = [state.order[n - 1], state.order[a]];
        state.active = n - 1;
      }
      state.layout = id;
      save();
      build();
    };
    layoutBtn.addEventListener("click", () => (menu.hidden ? openMenu() : closeMenu()));
    menu.addEventListener("click", (e) => {
      const b = e.target.closest(".chart-layout-opt");
      if (!b) return;
      closeMenu(true);
      if (b.dataset.layout !== state.layout) setLayout(b.dataset.layout);
    });
    menu.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeMenu(true);
        return;
      }
      if (e.key === "Tab") {
        closeMenu();
        return;
      }
      const i = tiles.indexOf(document.activeElement);
      const n = tiles.length;
      const next = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: n - 1 }[e.key];
      if (next === undefined) return;
      e.preventDefault();
      tiles[(next + n) % n].focus();
    });
    document.addEventListener("pointerdown", (e) => {
      if (!menu.hidden && !menu.contains(e.target) && !layoutBtn.contains(e.target)) closeMenu();
    });

    /* Fullscreen: the panel takes the whole screen (Fullscreen API; Esc
       leaves), or is maximized over the page where the API is missing or
       refused. Layouts apply here (and in a roomy detached copy). */
    const setMulti = (update) => {
      const before = multi();
      update();
      if (multi() === before) return;
      layoutBtn.hidden = !multi();
      closeMenu();
      build();
    };
    const setFull = (on, fallback = false) => {
      root.classList.toggle("is-full", on);
      root.classList.toggle("is-maximized", on && fallback);
      document.documentElement.classList.toggle("has-maximized", on && fallback);
      fsBtn.setAttribute("aria-pressed", String(on));
      fsBtn.title = on ? "Exit fullscreen" : "Fullscreen";
      fsBtn.setAttribute("aria-label", on ? "Exit fullscreen: Charts" : "Fullscreen: Charts");
      setMulti(() => { full = on; });
    };
    fsBtn.addEventListener("click", () => {
      if (document.fullscreenElement === root) document.exitFullscreen();
      else if (root.classList.contains("is-maximized")) setFull(false);
      else if (root.requestFullscreen) root.requestFullscreen().catch(() => setFull(true, true));
      else setFull(true, true);
    });
    document.addEventListener("fullscreenchange", () => {
      const on = document.fullscreenElement === root;
      if (!root.classList.contains("is-maximized") && on !== full) setFull(on);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && root.classList.contains("is-maximized")) setFull(false);
    });

    // Detach: every click opens one more copy in its own window.
    const detachBtn = root.querySelector(".detach-icon");
    if (canDetach) detachBtn.addEventListener("click", () => openCopy(root));
    else detachBtn.remove();

    // A detached copy: growing its window past CHART_ROOMY brings the
    // layouts in, no fullscreen needed.
    if (adaptive) {
      new ResizeObserver(() => {
        const { width, height } = root.getBoundingClientRect();
        const slack = roomy ? CHART_ROOMY.slack : 0;
        const fits = width >= CHART_ROOMY.w - slack && height >= CHART_ROOMY.h - slack;
        setMulti(() => { roomy = fits; });
      }).observe(root);
    }

    build();
    return {
      symbol: () => symbol.value,
      setSymbol: (sym) => { symbol.value = sym; },
    };
  };

  /* ---- Detached copies -----------------------------------------------------
     The detach button opens a live copy of its panel in a window of its own
     (one more per click), to place anywhere on this screen or another one.
     A copy is this same page loaded with ?detach=<panel>: it shows that panel
     alone and runs no feed of its own. The main window feeds every copy over
     a BroadcastChannel:
     - a copy says "hello"; the main window answers it with a snapshot (a
       table's rows, plus the constellation's alert history for Momentum;
       the Charts panel's ticker);
     - from then on every alert and price tick is relayed as it happens;
     - "bye" when the main window closes or reloads: the copy waits for it
       to come back ("ready") and closes itself if it does not.
     Settings, filters, float tiers and sounds live in localStorage, so a
     change saved in any window reaches the others (the `storage` event).
     A Charts copy starts on the main window's ticker and views, then goes
     its own way. Only the main window sounds alerts, and only it detaches:
     a copy has no detach button, so copies never nest. */

  const LINK_TIMEOUT = 4000; // ms a copy waits for the main window
  const HUB_ID = globalThis.crypto?.randomUUID?.() ?? `w-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const hub = "BroadcastChannel" in window ? new BroadcastChannel("scanner:live") : null;
  const post = (msg) => hub?.postMessage({ ...msg, from: HUB_ID });
  const detachable = (id) => document.querySelector(`:is(.terminal, .chart-panel)[data-panel="${CSS.escape(id)}"]`);
  const detachParam = new URLSearchParams(location.search).get("detach");
  const DETACHED = detachParam && detachable(detachParam) ? detachParam : null;
  const canDetach = Boolean(hub) && !DETACHED;

  // Where a panel's copy was last left (size and screen position), saved by
  // the copy itself. Without one: the panel's size, next to the panel.
  const geomKey = (id) => `scanner:detach-geom:v1:${id}`;
  const loadGeom = (id) => {
    try {
      const g = JSON.parse(localStorage.getItem(geomKey(id)) || "null");
      if (g && ["w", "h", "x", "y"].every((k) => Number.isFinite(g[k]))) return g;
    } catch { /* ignore */ }
    return null;
  };
  // Chrome keeps a pop-up on the opener's screen unless the site holds the
  // "window-management" permission. When the saved place is not on this
  // screen, ask for it (once; the browser remembers the answer) and move the
  // copy there once granted.
  const onThisScreen = (g) => {
    const s = window.screen;
    const left = s.availLeft ?? 0;
    const top = s.availTop ?? 0;
    return g.x >= left && g.y >= top && g.x + g.w <= left + s.availWidth && g.y + g.h <= top + s.availHeight;
  };
  const placeOnScreen = (getWin, g) => {
    if (!("getScreenDetails" in window)) return;
    // Asked before window.open, while the click still counts as a gesture.
    window.getScreenDetails().then(() => {
      const win = getWin();
      if (!win || win.closed) return;
      win.moveTo(g.x, g.y);
      win.resizeBy(g.w - win.innerWidth, g.h - win.innerHeight);
    }, () => showToast("Allow window management for this site to reopen copies on other screens"));
  };

  // Copies of the same panel opened in this session cascade down-right, so
  // they never land exactly on top of each other.
  const opened = new Map(); // panel → copies opened
  const openCopy = (root) => {
    const id = root.dataset.panel;
    const n = opened.get(id) || 0;
    opened.set(id, n + 1);
    const box = root.getBoundingClientRect();
    const chrome = Math.max(0, window.outerHeight - window.innerHeight); // tabs + address bar
    const saved = loadGeom(id);
    const step = 28 * ((saved ? 0 : 1) + (n % 8));
    const g = saved ?? {
      w: Math.max(480, box.width),
      h: Math.max(360, box.height),
      x: window.screenX + box.left,
      y: window.screenY + chrome + box.top,
    };
    const place = { w: Math.round(g.w), h: Math.round(g.h), x: Math.round(g.x + step), y: Math.round(g.y + step) };
    const features = ["popup", `width=${place.w}`, `height=${place.h}`, `left=${place.x}`, `top=${place.y}`].join(",");
    const url = new URL(location.href);
    url.search = `?detach=${encodeURIComponent(root.dataset.panel)}`;
    url.hash = "";
    let win = null;
    if (saved && !onThisScreen(place)) placeOnScreen(() => win, place);
    win = window.open(url, `scanner-${root.dataset.panel}-${Date.now()}`, features);
    if (!win) showToast("Pop-ups are blocked: allow them for this site to detach panels");
  };

  // Main window: each copy's hello gets a snapshot of its panel.
  const serveCopies = (constellation, chart) => {
    if (!hub) return;
    const snapshotOf = (id) => {
      if (id === "chart") return { sym: chart.symbol() };
      if (!tables.has(id)) return null;
      return { rows: tables.get(id).rows(), heat: id === "momentum" ? constellation?.dump() : undefined };
    };
    hub.addEventListener("message", ({ data: m }) => {
      const snap = m.type === "hello" && snapshotOf(m.panel);
      if (snap) post({ type: "snapshot", to: m.from, panel: m.panel, ...snap });
    });
    post({ type: "ready" });
    window.addEventListener("pageshow", (e) => { if (e.persisted) post({ type: "ready" }); });
    window.addEventListener("pagehide", () => post({ type: "bye" }));
  };

  // Copy: `link.snapshot(m, first)` mounts (first) or refreshes the panel;
  // `link.relay(m)` applies each live message from the main window.
  const linkCopy = (root, link) => {
    const id = root.dataset.panel;
    const status = document.createElement("p");
    status.className = "detach-status";
    status.setAttribute("role", "status");
    root.append(status);
    const setStatus = (text) => { status.textContent = text; status.hidden = !text; };

    let source = null; // the main window feeding this copy
    let linked = false;
    let timer = 0;
    const hello = () => post({ type: "hello", panel: id });

    hub.addEventListener("message", ({ data: m }) => {
      if (m.type === "snapshot") {
        if (m.to !== HUB_ID || (source && m.from !== source)) return;
        source = m.from;
        clearTimeout(timer);
        setStatus("");
        link.snapshot(m, !linked);
        linked = true;
        return;
      }
      if (m.type === "ready") { if (!source) hello(); return; }
      if (m.from !== source) return;
      if (m.type === "bye") {
        source = null;
        setStatus("Scanner closed · waiting for it…");
        timer = setTimeout(() => window.close(), LINK_TIMEOUT);
      } else link.relay?.(m);
    });

    // Remember this window's size and place for the panel's next copy, once
    // it moves or resizes: a copy the browser kept off its saved screen must
    // not overwrite that place just by opening. Browsers fire no event when a
    // window moves: check once a second.
    const geomNow = () => JSON.stringify({ w: window.innerWidth, h: window.innerHeight, x: window.screenX, y: window.screenY });
    let geom = geomNow();
    const keepGeom = () => {
      const g = geomNow();
      if (g === geom) return;
      geom = g;
      try { localStorage.setItem(geomKey(id), g); } catch { /* ignore */ }
    };
    setInterval(keepGeom, 1000);
    window.addEventListener("resize", keepGeom);
    window.addEventListener("pagehide", keepGeom);

    setStatus("Connecting to the scanner…");
    timer = setTimeout(() => setStatus("Open the scanner to feed this copy"), LINK_TIMEOUT);
    hello();
  };

  /* ---- Mount -------------------------------------------------------------- */

  const panel = (id) => document.querySelector(`.terminal[data-panel="${id}"]`);
  // A copy keeps its panel alone on the page.
  if (DETACHED) {
    const root = detachable(DETACHED);
    document.documentElement.classList.add("is-detached");
    document.title = `${root.dataset.title} · Scanner`;
    document.querySelector(".workspace").replaceChildren(root);
  }
  document.querySelectorAll(".terminal[data-panel]").forEach(buildPanel);
  if (!DETACHED) {
    mountLayout();
    mountAppFullscreen();
    mountGuide();
  }
  mountNavStatus(); // the filters follow the market session
  const soundSettings = mountSoundSettings();
  const floatSettings = mountFloatSettings();
  const tableSettings = mountTableSettings();
  const filterDialog = mountFilters();
  const chartRoot = document.querySelector(".chart-panel");
  const chart = chartRoot && mountChartPanel(chartRoot, { persist: !DETACHED, adaptive: Boolean(DETACHED) });
  const heatRoot = document.querySelector("[data-constellation]");
  const constellation = heatRoot && mountConstellation(heatRoot);

  const TABLE_SETUP = {
    // Vertical container: toplists
    gainers: { seed: GAINERS, cols: TOPLIST_COLS, pins: TOPLIST_PINS, quotes: true },
    "gainers-open": { seed: GAINERS_OPEN, cols: TOPLIST_COLS, pins: TOPLIST_PINS, quotes: true },
    "volume-leaders": { seed: VOLUME_LEADERS, cols: TOPLIST_COLS, pins: TOPLIST_PINS, quotes: true },
    // Top row: alerts
    "new-hod": { seed: BULL, cols: HOD_COLS, next: nextAlert(BULL) },
    buying: { seed: BUYING, cols: PRESSURE_COLS, next: nextAlert(BUYING) },
    selling: { seed: BEAR, cols: PRESSURE_COLS, next: nextAlert(BEAR) },
    // Bottom row: momentum + halts
    momentum: { seed: MOMENTUM, cols: MOMENTUM_COLS, next: nextAlert(MOMENTUM), onAlert: constellation?.alert, onRender: constellation?.refresh },
    halts: { seed: HALTS, cols: HALT_COLS, next: nextHalt, every: 18000, expires: true, onAlert: constellation?.halt },
  };

  if (DETACHED === "chart") {
    // The main window's ticker to start with; later tickers are this copy's own.
    linkCopy(chartRoot, { snapshot: (m, first) => { if (first) chart.setSymbol(m.sym); } });
  } else if (DETACHED) {
    // No feed of its own: the rows come from the main window.
    const { seed, next, every, quotes, ...setup } = TABLE_SETUP[DETACHED];
    let feed = null;
    linkCopy(panel(DETACHED), {
      snapshot: (m, first) => {
        if (first) feed = mountTable(panel(DETACHED), m.rows, setup);
        else feed.reset(m.rows);
        if (m.heat) constellation?.load(m.heat);
      },
      relay: (m) => {
        if (m.type === "alert" && m.panel === DETACHED) feed.push(m.row);
        else if (m.type === "alert" && m.panel === "halts") constellation?.halt(m.row);
        else if (m.type === "quote" && m.panel === DETACHED) feed.quote(m.sym, m.price);
      },
    });
  } else {
    constellation.seed(MOMENTUM);
    HALTS.forEach(constellation.halt);
    for (const [id, { seed, ...setup }] of Object.entries(TABLE_SETUP)) {
      mountTable(panel(id), seed, { ...setup, relay: hub ? (msg) => post({ ...msg, panel: id }) : undefined });
    }
    serveCopies(constellation, chart);
  }
  syncSoundButtons();

  // Saved in another window (a detached copy, or the main one): follow it.
  const PANEL_KEY = /^scanner:(?:columns:v2|prefs:v1):(.+)$/;
  window.addEventListener("storage", ({ key }) => {
    if (!key) return;
    const own = key.match(PANEL_KEY);
    if (own) tables.get(own[1])?.reload();
    else if (key === GLOBAL_EXCLUDED_KEY) { loadGlobalExcluded(); tables.forEach((t) => t.refresh()); }
    else if (key === FILTER_KEY) { loadFilters(); filterDialog.sync(); }
    else if (key === FLOAT_KEY) { loadFloat(); tables.forEach((t) => t.refresh()); }
    else if (key === SOUND_KEY) { loadSoundPrefs(); syncSoundButtons(); }
    else if (key === SOUND_FILES_KEY) loadSoundFiles();
  });

  setInterval(() => {
    tickTimers();
    onTick.forEach((fn) => fn());
  }, 1000);
})();
