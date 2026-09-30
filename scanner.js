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
      trend: `<svg class="spark ${bear ? "down" : "up"}" viewBox="0 0 88 28" preserveAspectRatio="none" aria-hidden="true"><polyline points="${sparkPoints(r.sym + r.hits, !bear)}"></polyline></svg>`,
    };
  };

  /* ---- Columns ------------------------------------------------------------
     Pinned columns stay first; the rest can be dragged into any order.
     Every column has a whole-pixel width (`w`, the default), so pinned
     offsets and row lines land on exact pixels and the header never drifts
     off the body. The user can resize any column but Signal (`fixed`)
     between its `min` (what its content needs: a heat chip, a clock, a
     ticker) and its `max`. */

  const COL_MIN = 56;
  const COL_MAX = 360;
  const HEAT_MIN = 84; // a heat chip (4.75em) plus the cell's padding

  const COLUMNS = [
    { key: "sig",      label: "Signal",      w: 24,  pinned: true, fixed: true, cls: "col-sig", title: "Float size", srOnly: true },
    { key: "time",     label: "Time",        w: 88,  min: 84, max: 140, pinned: true, cls: "col-time" },
    { key: "sym",      label: "Ticker",      w: 68,  min: 60, max: 140, pinned: true, cls: "col-sym" },
    { key: "price",    label: "Price",       w: 80,  num: true },
    { key: "chg1",     label: "%Chg 1m",     w: 96,  min: HEAT_MIN, num: true, title: "% change, last minute" },
    { key: "vol1m",    label: "Vol. 1m",     w: 100, min: HEAT_MIN, num: true, title: "Volume spike vs. normal 1m volume" },
    { key: "chgClose",    label: "%Chg Close", w: 108, min: HEAT_MIN, num: true, title: "% change vs. previous close" },
    { key: "chgCloseAbs", label: "Chg Close",  w: 96,  num: true, title: "Change vs. previous close" },
    { key: "chgOpen",     label: "%Chg Open",  w: 104, min: HEAT_MIN, num: true, title: "% change vs. today's open" },
    { key: "chgOpenAbs",  label: "Chg Open",   w: 92,  num: true, title: "Change vs. today's open" },
    { key: "rvol",     label: "RVol",        w: 72,  num: true, title: "Relative volume" },
    { key: "hits",     label: "Hits",        w: 88,  min: HEAT_MIN, num: true, title: "Alerts fired today" },
    { key: "vwapD",    label: "VWAP D.",     w: 92,  num: true, title: "Distance to VWAP" },
    { key: "vwap",     label: "VWAP",        w: 80,  num: true },
    { key: "chg5",     label: "%Chg 5m",     w: 96,  min: HEAT_MIN, num: true },
    { key: "chg15",    label: "%Chg 15m",    w: 104, min: HEAT_MIN, num: true },
    { key: "chg30",    label: "%Chg 30m",    w: 104, min: HEAT_MIN, num: true },
    { key: "duration", label: "Duration",    w: 92,  min: 64, num: true, title: "Time halted" },
    { key: "resume",   label: "Resume Est.", w: 116, min: 80, num: true, title: "Countdown to the estimated resumption" },
    { key: "volume",   label: "Volume",      w: 84,  num: true, muted: true },
    { key: "float",    label: "Float",       w: 76,  num: true, muted: true },
    { key: "mcap",     label: "MCap",        w: 76,  num: true, muted: true },
    { key: "press",    label: "Bull/Sell Press", w: 128, min: 64 },
    { key: "trend",    label: "Trend",       w: 116, min: 64 },
  ];
  const COL = Object.fromEntries(COLUMNS.map((c) => [c.key, c]));
  const clampWidth = (key, w) => Math.round(Math.min(COL[key].max ?? COL_MAX, Math.max(COL[key].min ?? COL_MIN, w)));
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

  // Column widths per table: only the ones changed from the default. A
  // detached copy keeps its own set (its window may sit on another, larger
  // screen), so widths are never synced between windows.
  const widthsKey = (panel) => `scanner:widths:v1:${DETACHED ? "copy:" : ""}${panel}`;
  const loadWidths = (panel) => {
    const widths = {};
    try {
      const saved = JSON.parse(localStorage.getItem(widthsKey(panel)) || "null");
      for (const [k, v] of Object.entries(saved && typeof saved === "object" ? saved : {})) {
        if (!COL[k] || COL[k].fixed || !Number.isFinite(v)) continue;
        const w = clampWidth(k, v);
        if (w !== COL[k].w) widths[k] = w;
      }
    } catch { /* ignore */ }
    return widths;
  };
  const saveWidths = (panel, widths) => {
    try {
      if (Object.keys(widths).length) localStorage.setItem(widthsKey(panel), JSON.stringify(widths));
      else localStorage.removeItem(widthsKey(panel));
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

  /* ---- Phones -------------------------------------------------------------
     At ≤ 720px, or a phone held sideways (short and touch; the same query
     as the CSS), the main window shows one panel at a time, picked from a
     tab strip (see mountPhone). Alert tables show their rows as cards;
     toplists keep a table, trimmed to a few columns at phone widths and
     never reordered or resized there. A detached copy always stays the
     desktop table. */

  const PHONE = window.matchMedia("(max-width: 720px), (max-height: 480px) and (pointer: coarse)");
  const PORTRAIT = window.matchMedia("(orientation: portrait)");

  // Alert card, two columns: ticker · time / volume · RVol on the left,
  // price / 1m change (or halt timers) on the right.
  const renderCard = (d) => `
    <div class="card-main">
      <div class="card-head">${d.sym}<time class="card-time">${d.time}</time></div>
      <div class="card-meta">Vol <b>${d.volume}</b> · RVol <b>${d.rvol}</b></div>
    </div>
    <div class="card-side">
      <span class="card-price">${d.price}</span>
      <span class="card-end">${d.duration ? `<span class="card-halt">${d.duration}<i>→</i>${d.resume}</span>` : d.chg1Tag}</span>
    </div>`;

  // Toplist columns on a phone (after the pinned Signal · Ticker), each
  // table's own change first, and their widths there.
  const PHONE_COLS = {
    gainers: ["price", "chgClose", "volume", "rvol", "float"],
    "gainers-open": ["price", "chgOpen", "volume", "rvol", "float"],
    "volume-leaders": ["price", "volume", "chgClose", "rvol", "float"],
  };
  const PHONE_W = { sym: 76, price: 76, chgClose: 100, chgOpen: 100, volume: 76, rvol: 68, float: 72 };

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
  // `phoneCols`: the columns this table shows at phone widths (toplists);
  // `onShown`: called for each new alert that reaches the screen.
  const mountTable = (root, seed, { cols, pins = PINNED, phoneCols, next, every = LIVE_INTERVAL, expires = false, quotes = false, onAlert, onRender, onShown, relay }) => {
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
    let widths = loadWidths(panel);

    // Phone widths: a fixed, trimmed set of columns (nothing to move or resize).
    const compact = () => Boolean(phoneCols) && PHONE.matches && !DETACHED;
    const columns = () => (compact() ? [...pins, ...phoneCols] : [...pins, ...order.filter((k) => !prefs.hidden.has(k))]);
    const widthOf = (key) => (compact() ? PHONE_W[key] ?? COL[key].w : widths[key] ?? COL[key].w);
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

    // Ticker sticks right after Signal (--pin-sym; Signal is never resized).
    // It gets there once the columns between them (Time, in the alert
    // tables) have scrolled away: `stickAt` is that scroll distance. Whole
    // pixels, nothing to measure.
    table.style.setProperty("--pin-sym", `${COL.sig.w}px`);
    const stickAt = () => pins.slice(1, pins.indexOf("sym")).reduce((sum, key) => sum + widthOf(key), 0);
    const totalWidth = () => columns().reduce((sum, key) => sum + widthOf(key), 0);
    // Edge shadow on Ticker while it is stuck. With display scaling scrollLeft
    // can rest a fraction of a pixel off 0; that still counts as "not stuck".
    // The class only changes when the state flips, so scrolling itself
    // triggers no style work. Resizing Time moves the point: re-checked then.
    let stuck = false;
    const syncStuck = () => {
      const now = wrap.scrollLeft >= Math.max(stickAt(), 1);
      if (now !== stuck) wrap.classList.toggle("is-stuck", (stuck = now));
    };

    /* Header + rows */

    const renderHead = () => {
      const keys = columns();
      // Fixed layout: each column gets exactly its width; a trailing filler
      // column soaks up any spare room so the others never stretch.
      colgroup.replaceChildren(...keys.map((key) => {
        const col = document.createElement("col");
        col.style.width = `${widthOf(key)}px`;
        return col;
      }), document.createElement("col"));
      table.style.minWidth = `${totalWidth()}px`;

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
        if (!c.pinned && !compact()) {
          th.draggable = true;
          th.tabIndex = 0;
          th.setAttribute("aria-description", "Drag, or Alt + arrow keys, to move this column. Alt + Shift + arrow keys to resize it");
        }
        if (!c.fixed && !compact()) th.insertAdjacentHTML("beforeend", '<span class="col-resize" data-resize aria-hidden="true" title="Drag to resize · double-click to fit"></span>');
        return th;
      }), fill);
      syncStuck();
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
      // A drag that starts on the resize edge resizes, never moves.
      if (resize) { e.preventDefault(); return; }
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
      if (!th || !e.altKey || e.shiftKey || !["ArrowLeft", "ArrowRight"].includes(e.key)) return;
      e.preventDefault();
      const key = th.dataset.key;
      const shown = order.filter((k) => !prefs.hidden.has(k));
      const i = shown.indexOf(key);
      const j = e.key === "ArrowLeft" ? i - 1 : i + 1;
      if (j < 0 || j >= shown.length) return;
      moveColumn(key, shown[j], e.key === "ArrowRight");
      headRow.querySelector(`[data-key="${key}"]`).focus();
    });

    /* Column resize: drag the right edge of a header; double-click it to fit
       the content; Alt + Shift + ←/→ on a focused header. Widths stay whole
       pixels within each column's min–max and are saved on release. Only
       the <col> and the table's min-width change: the rows never re-render,
       so live alerts keep flowing in at the new width. The header row holds
       the pointer capture, so a re-render mid-drag (a filter, a new header)
       never drops the gesture. */

    const setWidth = (key, w) => {
      const next = clampWidth(key, w);
      if (next === widthOf(key)) return false;
      if (next === COL[key].w) delete widths[key];
      else widths[key] = next;
      const col = colgroup.children[columns().indexOf(key)];
      if (col) col.style.width = `${next}px`;
      table.style.minWidth = `${totalWidth()}px`;
      syncStuck();
      return true;
    };

    // Guide line down the whole table while dragging.
    const guide = document.createElement("div");
    guide.className = "col-guide";
    guide.hidden = true;
    wrap.append(guide);
    const showGuide = (key) => {
      const th = headRow.querySelector(`th[data-key="${key}"]`);
      if (!th) return;
      const box = wrap.getBoundingClientRect();
      const x = th.getBoundingClientRect().right - box.left + wrap.scrollLeft;
      guide.style.transform = `translate(${Math.round(x) - 1}px, ${wrap.scrollTop}px)`;
      guide.style.height = `${wrap.clientHeight}px`;
      guide.hidden = false;
    };

    let resize = null; // { id, key, x, from }
    headRow.addEventListener("pointerdown", (e) => {
      const handle = e.target.closest("[data-resize]");
      if (!handle || e.button !== 0) return;
      e.preventDefault();
      const key = handle.closest("th").dataset.key;
      resize = { id: e.pointerId, key, x: e.clientX, from: widthOf(key) };
      try { headRow.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      document.documentElement.classList.add("is-col-resizing");
      table.dataset.resizing = key;
      showGuide(key);
    });
    headRow.addEventListener("pointermove", (e) => {
      if (!resize || e.pointerId !== resize.id) return;
      setWidth(resize.key, resize.from + e.clientX - resize.x);
      showGuide(resize.key);
    });
    const endResize = (e) => {
      if (!resize || e.pointerId !== resize.id) return;
      const { key, from } = resize;
      resize = null;
      document.documentElement.classList.remove("is-col-resizing");
      delete table.dataset.resizing;
      guide.hidden = true;
      if (widthOf(key) !== from) saveWidths(panel, widths);
    };
    headRow.addEventListener("pointerup", endResize);
    headRow.addEventListener("pointercancel", endResize);
    headRow.addEventListener("lostpointercapture", endResize);

    // Fit: the widest of the header and the rows on screen. A Range measures
    // the laid-out content even when the cell clips it with an ellipsis.
    const GRIP_W = 14; // the ⠿ shown on a movable header
    const fitWidth = (key) => {
      const i = columns().indexOf(key);
      const th = headRow.children[i];
      const range = document.createRange();
      const extent = (cell, before) => {
        range.selectNodeContents(cell);
        if (before) range.setEndBefore(before);
        return range.getBoundingClientRect().width;
      };
      const pad = (cell) => {
        const s = getComputedStyle(cell);
        return parseFloat(s.paddingLeft) + parseFloat(s.paddingRight);
      };
      let need = extent(th, th.querySelector("[data-resize]")) + pad(th) + (th.draggable ? GRIP_W : 0);
      const first = body.rows[0]?.children[i];
      const tdPad = first ? pad(first) : 0;
      for (const tr of body.rows) {
        const td = tr.children[i];
        if (td) need = Math.max(need, extent(td) + tdPad);
      }
      return Math.ceil(need) + 2;
    };
    headRow.addEventListener("dblclick", (e) => {
      const handle = e.target.closest("[data-resize]");
      if (!handle) return;
      const key = handle.closest("th").dataset.key;
      if (setWidth(key, fitWidth(key))) saveWidths(panel, widths);
    });

    headRow.addEventListener("keydown", (e) => {
      const th = e.target.closest("th[data-key]");
      if (!th || !e.altKey || !e.shiftKey || !["ArrowLeft", "ArrowRight"].includes(e.key)) return;
      e.preventDefault();
      const key = th.dataset.key;
      if (COL[key].fixed) return;
      if (setWidth(key, widthOf(key) + (e.key === "ArrowLeft" ? -8 : 8))) saveWidths(panel, widths);
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
      onShown?.();
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

    wrap.addEventListener("scroll", syncStuck, { passive: true });
    // Crossing the phone breakpoint swaps the trimmed and the full columns.
    if (phoneCols) PHONE.addEventListener("change", () => renderAll());

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

    // Drop the class once done so re-renders never replay a stale flash —
    // nor a panel shown again (a phone tab): CSS restarts its animations.
    root.addEventListener("animationend", (e) => {
      if (/^flash(Up|Down)$/.test(e.animationName)) e.target.classList.remove("flash-up", "flash-down");
      else if (e.animationName === "rowIn") e.target.closest(".is-new")?.classList.remove("is-new");
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
      state: () => ({ order: [...order], hidden: new Set(prefs.hidden), colors: { ...prefs.colors }, excluded: new Set(prefs.excluded), widths: { ...widths } }),
      apply: (s) => {
        order = [...s.order];
        prefs = { hidden: new Set(s.hidden), colors: { ...s.colors }, excluded: new Set(s.excluded) };
        widths = { ...s.widths };
        saveOrder(panel, order);
        savePrefs(panel, prefs);
        saveWidths(panel, widths);
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

      // A pane can be hidden for a session (Gainers Open after hours): its
      // following splitter hides with it, so splitter i pairs pane i with
      // the next visible pane.
      const next = (i) => {
        let j = i + 1;
        while (j < items.length - 1 && items[j].hidden) j++;
        return j;
      };
      handles.forEach((handle, i) => {
        const a = items[i];
        panes.push({
          handle, axis,
          size: () => width(a),
          // Sizes follow the grow factors, so keeping the pair's sum fixed
          // leaves every other pane in the group exactly where it was.
          resize: (px) => {
            const j = next(i);
            const total = width(a) + width(items[j]);
            const g = state.cols[row];
            const pair = g[i] + g[j];
            g[i] = (pair * clamp(px, min, total - min)) / (total || 1);
            g[j] = pair - g[i];
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
            const j = next(i);
            const pair = g[i] + g[j];
            g[i] = (pair * d[i]) / (d[i] + d[j]);
            g[j] = pair - g[i];
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

  /* User Guide: the help icon in the nav (the account menu on phones) opens
     a modal side panel (Esc, the close button or a click outside closes it). The search box keeps only
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
      panel.querySelector("[data-guide-body]").scrollTop = 0; // always from the top
      search.focus({ preventScroll: true });
    }));
    panel.querySelector("[data-guide-close]").addEventListener("click", () => panel.close());
    panel.addEventListener("click", (e) => {
      if (e.target !== panel) return;
      const r = panel.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) panel.close();
    });
    // Opened from the account menu, which is closed by now: back to the avatar.
    panel.addEventListener("close", () => {
      const back = openBtn.getClientRects().length ? openBtn : document.querySelector("[data-profile-btn]");
      back?.focus();
    });

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

  /* Account menu: the avatar opens it (click, Enter/Space or ↓ lands on the
     first item, ↑ on the last). ↑/↓/Home/End move between items; Esc, Tab,
     a click outside or picking an item closes it. Account and Subscriptions
     open Account settings on that tab; User Guide (phones only) opens the
     guide. Log out asks first (askLogout). On phones the menu is a sheet
     under the nav over a dark scrim; a tap on the scrim closes it. */
  const mountProfile = (account) => {
    const root = document.querySelector("[data-profile]");
    if (!root) return;
    const btn = root.querySelector("[data-profile-btn]");
    const menu = root.querySelector(".profile-menu");
    const scrim = root.querySelector("[data-profile-scrim]");
    // Only the items on screen (User Guide is for phones)
    const items = () => [...menu.querySelectorAll("[role=menuitem]")].filter((el) => el.getClientRects().length);

    const isOpen = () => !menu.hidden;
    const focusItem = (i) => {
      const list = items();
      list[(i + list.length) % list.length].focus();
    };
    const open = (at = 0) => {
      menu.hidden = false;
      scrim.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      focusItem(at);
    };
    const close = (refocus = true) => {
      if (!isOpen()) return;
      menu.hidden = true;
      scrim.hidden = true;
      btn.setAttribute("aria-expanded", "false");
      if (refocus) btn.focus();
    };

    btn.addEventListener("click", () => (isOpen() ? close() : open()));
    btn.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        open(e.key === "ArrowDown" ? 0 : -1);
      }
    });
    menu.addEventListener("keydown", (e) => {
      const at = items().indexOf(document.activeElement);
      const moves = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: -1 };
      if (e.key in moves) { e.preventDefault(); focusItem(moves[e.key]); }
      else if (e.key === "Escape") { e.preventDefault(); close(); }
      else if (e.key === "Tab") close(false);
    });
    document.addEventListener("pointerdown", (e) => { if (isOpen() && !root.contains(e.target)) close(false); });
    scrim.addEventListener("click", () => close(false));

    // Every item but the plain ones opens a dialog, which takes the focus;
    // closing it brings the focus back to the avatar. On phones the dialog
    // takes over from the menu scrim without fading (is-from-menu): no
    // glimpse of the scanner in between.
    menu.querySelectorAll("[role=menuitem]").forEach((item) => item.addEventListener("click", () => {
      const action = item.dataset.profileAction;
      const target = document.getElementById(item.getAttribute("aria-controls"));
      if (target?.showModal) {
        target.classList.add("is-from-menu");
        target.addEventListener("close", () => target.classList.remove("is-from-menu"), { once: true });
      }
      close(!["logout", "guide", "account", "subscriptions"].includes(action));
      if (action === "logout") askLogout(btn);
      else if (action === "account" || action === "subscriptions") account?.open(action, btn, true);
    }));
  };

  // A click on a modal dialog's backdrop (outside its box) closes it, unless
  // `canClose` says no.
  const closeOnBackdrop = (dialog, canClose = () => true) => dialog.addEventListener("click", (e) => {
    if (e.target !== dialog || !canClose()) return;
    const r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close();
  });

  /* Confirm dialog: one for every decision that ends something (log out,
     delete account, cancel plan, remove card). askConfirm sets its copy and
     icon and opens it over whatever is open (native dialogs stack); OK runs
     onConfirm. Cancel, Esc or the backdrop drop it. Either way the focus
     goes back to `returnTo` (the button that asked, by default). */
  const CONFIRM_GLYPHS = {
    logout: '<path d="M14 4h3.5A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5H14"/><path d="M10 16.5 5.5 12 10 7.5M5.5 12H15"/>',
    warning: '<path d="M12 9v4.5M12 16.8v.2"/><path d="M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
    trash: '<path d="M4.5 7h15M10 11v6M14 11v6M6.5 7l1 12.5h9L17.5 7M9.5 7V4.5h5V7"/>',
  };
  const confirmEl = document.getElementById("confirm-dialog");
  let confirmRun = null;
  let confirmReturn = null;
  const askConfirm = ({ title, text, action, cancel = "Cancel", icon = "warning", returnTo = document.activeElement, onConfirm }) => {
    confirmEl.querySelector("[data-cm-title]").textContent = title;
    confirmEl.querySelector("[data-cm-text]").textContent = text;
    confirmEl.querySelector("[data-cm-ok-text]").textContent = action;
    confirmEl.querySelector("[data-cm-cancel]").textContent = cancel;
    confirmEl.querySelector("[data-cm-glyph]").innerHTML = CONFIRM_GLYPHS[icon];
    confirmEl.querySelector("[data-cm-ok-glyph]").innerHTML = CONFIRM_GLYPHS[icon];
    confirmRun = onConfirm;
    confirmReturn = returnTo;
    confirmEl.showModal();
  };
  confirmEl.querySelector("[data-cm-cancel]").addEventListener("click", () => confirmEl.close());
  confirmEl.querySelector("[data-cm-ok]").addEventListener("click", () => {
    const run = confirmRun;
    confirmRun = null;
    confirmEl.close("ok");
    run?.();
  });
  closeOnBackdrop(confirmEl);
  confirmEl.addEventListener("close", () => {
    confirmRun = null;
    if (confirmReturn?.isConnected) confirmReturn.focus();
    confirmReturn = null;
  });

  // Log out (account menu, Account tab): fires `scanner:logout` for the
  // sign-in layer to handle.
  const askLogout = (returnTo, onLogout) => askConfirm({
    title: "Log out of Pulse?",
    text: "Live alerts stop on this device until you sign back in. Your layout, filters and sounds stay saved.",
    action: "Log out",
    icon: "logout",
    returnTo,
    onConfirm: () => {
      onLogout?.();
      document.dispatchEvent(new CustomEvent("scanner:logout"));
      showToast("Logged out");
    },
  });

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

  /* ---- Account settings -----------------------------------------------------
     Account and Subscriptions in the account menu open one dialog on that
     tab: side tabs on desktop (↑/↓), a segmented control on phones (←/→),
     full screen there. Frontend only: ACCOUNT is mock data kept in memory
     (a reload starts over); sign-in and payments will fill it later. Every
     change repaints what shows it (nav avatar, account menu, both tabs) and
     says so with a toast; anything that ends something asks first.
     - Account: avatar (New design draws a new gradient from the palette
       tokens), name (the email is the sign-in, read-only), log out, and
       delete, locked while the plan renews.
     - Subscriptions: plan, transactions, billing details (Edit), saved cards
       (Add new; each card's ⋯ menu edits it, makes it the default or removes
       it) and cancel / resume the plan.
     The form dialogs open over it: Save stays off until something changes,
     errors show under the fields, closing drops the draft. The card fields
     are a stand-in for the payment provider's own; only the brand and the
     last 4 digits are kept. */
  const ACCOUNT = {
    name: "Jordan Lee",
    email: "jordan.lee@example.com",
    avatar: 0, // 0: the default gradient; otherwise the seed of a new design
    plan: { name: "Pulse Pro", price: "$39.00/month", renews: "2026-10-25", ending: false },
    invoices: [
      { name: "Pulse Pro", date: "2026-09-25", status: "Paid", amount: 39 },
      { name: "Pulse Pro", date: "2026-08-25", status: "Paid", amount: 39 },
      { name: "Pulse Pro", date: "2026-07-25", status: "Paid", amount: 39 },
      { name: "Pulse Pro", date: "2026-06-25", status: "Paid", amount: 39 },
      { name: "Pulse Pro", date: "2026-05-25", status: "Paid", amount: 39 },
      { name: "Pulse Pro", date: "2026-04-25", status: "Paid", amount: 39 },
    ],
    billing: {
      email: "jordan.lee@example.com",
      name: "Jordan Lee",
      address: { country: "US", line1: "350 Fifth Avenue", line2: "Suite 4200", postalCode: "10118", city: "New York", state: "NY" },
    },
    cards: [
      { id: "card-1", brand: "visa", last4: "4242", expMonth: 8, expYear: 2028, isDefault: true, name: "Jordan Lee", address: { country: "US", line1: "350 Fifth Avenue", line2: "Suite 4200", postalCode: "10118", city: "New York", state: "NY" } },
      { id: "card-2", brand: "mastercard", last4: "5454", expMonth: 3, expYear: 2027, isDefault: false, name: "Jordan Lee", address: { country: "US", line1: "350 Fifth Avenue", line2: "", postalCode: "10118", city: "New York", state: "NY" } },
    ],
  };

  const COUNTRIES = [
    ["AR", "Argentina"], ["AU", "Australia"], ["BO", "Bolivia"], ["BR", "Brazil"], ["CA", "Canada"],
    ["CL", "Chile"], ["CO", "Colombia"], ["CR", "Costa Rica"], ["DE", "Germany"], ["DO", "Dominican Republic"],
    ["EC", "Ecuador"], ["ES", "Spain"], ["FR", "France"], ["GB", "United Kingdom"], ["GT", "Guatemala"],
    ["HN", "Honduras"], ["IT", "Italy"], ["MX", "Mexico"], ["NI", "Nicaragua"], ["PA", "Panama"],
    ["PE", "Peru"], ["PR", "Puerto Rico"], ["PT", "Portugal"], ["PY", "Paraguay"], ["SV", "El Salvador"],
    ["US", "United States"], ["UY", "Uruguay"], ["VE", "Venezuela"],
  ];
  const AR_PROVINCES = [
    "Buenos Aires", "Catamarca", "Chaco", "Chubut", "Ciudad Autónoma de Buenos Aires", "Córdoba", "Corrientes",
    "Entre Ríos", "Formosa", "Jujuy", "La Pampa", "La Rioja", "Mendoza", "Misiones", "Neuquén", "Río Negro",
    "Salta", "San Juan", "San Luis", "Santa Cruz", "Santa Fe", "Santiago del Estero", "Tierra del Fuego", "Tucumán",
  ];
  // Transaction history: the latest payments, newest first. Five covers a
  // monthly plan's last few months without making the tab long; older ones
  // live in the payment provider's billing page.
  const TXN_LIMIT = 5;
  const CARD_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 10h18M7 15h3"/></svg>';
  const CARD_BRANDS = { visa: ["Visa", "Visa"], mastercard: ["Mastercard", "MC"], amex: ["American Express", "Amex"], discover: ["Discover", "Disc"] };
  // Gradient stops for New design, as palette tokens; neighbours read well together.
  const AVATAR_STOPS = ["--green", "--teal", "--cyan", "--violet", "--pink", "--orange", "--amber"];

  const countryName = (code) => COUNTRIES.find(([c]) => c === code)?.[1] || code;
  const brandName = (brand) => CARD_BRANDS[brand]?.[0] || "Card";
  const cardLabel = (card) => `${brandName(card.brand)} •••• ${card.last4}`;
  // Noon, so no time zone moves the day.
  const longDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const shortDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
  const money = (n) => `$${n.toFixed(2)}`;
  const initialsOf = (name) => {
    const words = name.trim().split(/\s+/).map((w) => w.match(/\p{L}/u)?.[0]).filter(Boolean);
    return (words.length > 1 ? words[0] + words[words.length - 1] : words[0] || "?").toLocaleUpperCase();
  };
  const cardBrandOf = (digits) =>
    /^4/.test(digits) ? "visa" : /^(5[1-5]|2[2-7])/.test(digits) ? "mastercard" : /^3[47]/.test(digits) ? "amex" : /^6/.test(digits) ? "discover" : "";
  const luhn = (digits) => [...digits].reverse().reduce((sum, d, i) => {
    let n = Number(d) * (i % 2 ? 2 : 1);
    return sum + (n > 9 ? n - 9 : n);
  }, 0) % 10 === 0;
  // Expiry not in the past (the card works through the end of its month).
  const expired = (month, year) => {
    const now = new Date();
    return year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1);
  };
  const node = (tag, className, text) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  };

  /* Dialogs with text fields don't close by accident while one has the
     focus: Esc first leaves the field (the focus goes to the title), and a
     click on the backdrop does nothing. Cancel and ✕ still close. Returns
     the backdrop check for closeOnBackdrop. */
  const holdWhileTyping = (dialog) => {
    const inField = () => dialog.contains(document.activeElement) && document.activeElement.matches(".field__input");
    const leaveField = () => dialog.querySelector(".am-title, .fm-title").focus();
    let typing = false;
    // Read before the click moves the focus away from the field.
    dialog.addEventListener("pointerdown", () => { typing = inField(); }, true);
    dialog.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !inField()) return;
      e.preventDefault();
      e.stopPropagation();
      leaveField();
    });
    dialog.addEventListener("cancel", (e) => {
      if (!inField()) return;
      e.preventDefault();
      leaveField();
    });
    return () => !typing;
  };

  /* A form dialog (Edit billing, Edit card, Add card). `fill(form, ctx)`
     loads it; `save(form, ctx)` returns an error ({ message, field }) or
     nothing when it saved. The dialog handles Save's state, the error line,
     Cancel / ✕ / Esc / backdrop and the focus afterwards. */
  const mountFormDialog = (dialog, { fill, save }) => {
    const form = dialog.querySelector("form");
    const submit = form.querySelector("[type=submit]");
    const error = form.querySelector("[data-form-error]");
    let ctx = null;
    let returnTo = null;
    const showError = (message, field) => {
      error.textContent = message || "";
      error.hidden = !message;
      form.querySelectorAll("[aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
      if (field) {
        field.setAttribute("aria-invalid", "true");
        field.focus();
      }
    };
    form.addEventListener("input", () => {
      submit.disabled = false;
      showError("");
    });
    form.addEventListener("change", () => { submit.disabled = false; });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const problem = save(form, ctx);
      if (problem) { showError(problem.message, problem.field); return; }
      dialog.close();
    });
    dialog.querySelectorAll("[data-fm-close]").forEach((b) => b.addEventListener("click", () => dialog.close()));
    closeOnBackdrop(dialog, holdWhileTyping(dialog));
    dialog.addEventListener("close", () => {
      form.reset();
      showError("");
      // `returnTo` may be a function: the button it came from may have been repainted.
      const back = typeof returnTo === "function" ? returnTo() : returnTo;
      if (back?.isConnected) back.focus();
      ctx = returnTo = null;
    });
    return {
      open(context, from = document.activeElement) {
        ctx = context;
        returnTo = from;
        form.reset();
        fill(form, ctx);
        submit.disabled = true;
        showError("");
        dialog.showModal();
        // Always from the top: the header and the first fields.
        dialog.querySelector(".fm-body").scrollTop = 0;
        dialog.querySelector(".fm-title").focus({ preventScroll: true });
      },
    };
  };

  /* Address fields, built into a form's [data-address]: country, lines,
     postal code + city, and state. Argentina gets its province list, any
     other country a free-text state; only the visible one is enabled, so
     only it is read. `data-address-short` (Add card): country + line 1. */
  const buildAddress = (box) => {
    const short = box.hasAttribute("data-address-short");
    const field = (label, control) => {
      const wrap = node("label", "field");
      wrap.append(node("span", "field__label", label), control);
      return wrap;
    };
    const input = (name, autocomplete, required = false) => {
      const el = node("input", "field__input");
      Object.assign(el, { type: "text", name, autocomplete, required });
      return el;
    };
    const chevron = () => {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "field__icon");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("aria-hidden", "true");
      svg.innerHTML = '<path d="m6 9 6 6 6-6"/>';
      return svg;
    };
    const country = node("select", "field__input");
    Object.assign(country, { name: "country", autocomplete: "country" });
    country.append(...COUNTRIES.map(([code, name]) => new Option(name, code)));
    const countryField = field("Country or region", country);
    countryField.append(chevron());
    box.append(countryField, field("Address line 1", input("line1", "address-line1", true)));
    if (short) return;

    box.append(field("Address line 2", input("line2", "address-line2")));
    const pair = node("div", "field-pair");
    pair.append(field("Postal code", input("postalCode", "postal-code")), field("City", input("city", "address-level2")));
    const province = node("select", "field__input");
    Object.assign(province, { name: "state", autocomplete: "address-level1" });
    province.append(new Option("Select a province", ""), ...AR_PROVINCES.map((p) => new Option(p, p)));
    const state = input("state", "address-level1");
    // Two controls share the field, so each is named on its own (a <label>
    // would only name the first).
    const stateField = node("div", "field");
    const stateLabel = node("span", "field__label");
    stateLabel.setAttribute("aria-hidden", "true");
    province.setAttribute("aria-label", "Province");
    state.setAttribute("aria-label", "State or region");
    stateField.append(stateLabel, state, province, chevron());
    box.append(pair, stateField);
    const sync = () => {
      const ar = country.value === "AR";
      province.hidden = province.disabled = !ar;
      state.hidden = state.disabled = ar;
      stateLabel.textContent = ar ? "Province" : "State or region";
      stateField.querySelector(".field__icon").hidden = !ar;
    };
    country.addEventListener("change", sync);
    box.syncState = sync;
  };
  const setAddress = (form, a = {}) => {
    const f = form.elements;
    f.country.value = a.country || "US";
    form.querySelector("[data-address]").syncState?.();
    ["line1", "line2", "postalCode", "city"].forEach((k) => { if (f[k]) f[k].value = a[k] || ""; });
    const state = form.querySelector("[name=state]:not([disabled])");
    if (!state) return;
    state.value = state.tagName === "SELECT" && !AR_PROVINCES.includes(a.state) ? "" : a.state || "";
  };
  const readAddress = (form) => {
    const f = form.elements;
    const value = (name) => form.querySelector(`[name=${name}]:not([disabled])`)?.value.trim() || "";
    return { country: f.country.value, line1: value("line1"), line2: value("line2"), postalCode: value("postalCode"), city: value("city"), state: value("state") };
  };

  const mountAccount = () => {
    const dialog = document.getElementById("account-settings");
    if (!dialog) return null;
    const $ = (sel) => dialog.querySelector(sel);
    const tabs = [...dialog.querySelectorAll("[data-am-tab]")];
    const tablist = $(".am-tabs");
    const body = $(".am-body");
    const title = $("[data-am-title]");
    let returnTo = null;

    /* Tabs */
    const select = (name, focus = "title") => {
      tabs.forEach((tab) => {
        const on = tab.dataset.amTab === name;
        tab.setAttribute("aria-selected", String(on));
        tab.tabIndex = on ? 0 : -1;
        dialog.querySelector(`[data-am-panel="${tab.dataset.amTab}"]`).hidden = !on;
        if (on) title.textContent = tab.textContent.trim();
      });
      tablist.dataset.active = name;
      body.scrollTop = 0;
      if (focus === "tab") tabs.find((t) => t.dataset.amTab === name).focus();
      else if (focus === "title") title.focus({ preventScroll: true });
    };
    tabs.forEach((tab) => tab.addEventListener("click", () => select(tab.dataset.amTab, null)));
    tablist.addEventListener("keydown", (e) => {
      const at = tabs.indexOf(document.activeElement);
      const to = { ArrowDown: at + 1, ArrowRight: at + 1, ArrowUp: at - 1, ArrowLeft: at - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (to == null) return;
      e.preventDefault();
      select(tabs[(to + tabs.length) % tabs.length].dataset.amTab, "tab");
    });

    /* Everything that shows the account, painted from ACCOUNT */
    const paintIdentity = () => {
      const initials = initialsOf(ACCOUNT.name);
      let stops = null;
      if (ACCOUNT.avatar) {
        const r = seeded(`avatar:${ACCOUNT.avatar}`); // the same seed always draws the same avatar
        const from = Math.floor(r() * AVATAR_STOPS.length);
        const to = (from + 1 + Math.floor(r() * 2)) % AVATAR_STOPS.length;
        stops = [`var(${AVATAR_STOPS[from]})`, `var(${AVATAR_STOPS[to]})`, `${Math.round(r() * 360)}deg`];
      }
      document.querySelectorAll("[data-avatar]").forEach((el) => {
        el.textContent = initials;
        ["--avatar-from", "--avatar-to", "--avatar-angle"].forEach((prop, i) => {
          if (stops) el.style.setProperty(prop, stops[i]);
          else el.style.removeProperty(prop);
        });
      });
      document.querySelectorAll("[data-profile-name]").forEach((el) => { el.textContent = ACCOUNT.name; });
      document.querySelectorAll("[data-profile-email]").forEach((el) => {
        el.textContent = ACCOUNT.email;
        if (el.title) el.title = ACCOUNT.email;
      });
    };

    const paintPlan = () => {
      const { plan } = ACCOUNT;
      const renews = longDate(plan.renews);
      $("[data-am-plan-name]").textContent = plan.name;
      $("[data-am-plan-text]").textContent = plan.ending
        ? `Your plan won't renew. You keep full access to the scanner until ${renews}.`
        : `Your plan is active and renews at ${plan.price} on ${renews}.`;
      const badge = $("[data-am-plan-badge]");
      badge.textContent = plan.ending ? "Ending" : "Active";
      badge.dataset.tone = plan.ending ? "warn" : "live";
      document.querySelectorAll("[data-profile-plan]").forEach((el) => { el.textContent = plan.ending ? `${plan.name} · Ending` : plan.name; });
      $("[data-am-cancel-section]").hidden = plan.ending;
      $("[data-am-resume-section]").hidden = !plan.ending;
      $("[data-am-resume-text]").textContent = `Your plan ends on ${renews}. Resume it to keep the scanner after that.`;
      // A plan that will charge again blocks deleting the account.
      $("[data-am-delete]").disabled = !plan.ending;
      $("[data-am-delete-lock]").hidden = plan.ending;
    };

    const paintInvoices = () => {
      const box = $("[data-am-invoices]");
      if (!ACCOUNT.invoices.length) { box.replaceChildren(node("p", "am-empty", "No transactions yet.")); return; }
      box.replaceChildren(...ACCOUNT.invoices.slice(0, TXN_LIMIT).map((inv) => {
        // Each row will open its invoice (inv.url, from the payment provider);
        // the mock has none, so it's a plain row with the same chevron.
        const row = node(inv.url ? "a" : "div", "am-txn");
        if (inv.url) Object.assign(row, { href: inv.url, target: "_blank", rel: "noopener noreferrer" });
        const badge = node("span", "am-badge", inv.status);
        row.append(node("span", "am-txn__name", inv.name), node("span", "am-txn__date", shortDate(inv.date)), badge, node("span", "am-txn__amount", money(inv.amount)));
        row.insertAdjacentHTML("beforeend", '<svg class="am-txn__go" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>');
        return row;
      }));
    };

    const paintBilling = () => {
      const { billing } = ACCOUNT;
      const a = billing.address;
      $('[data-am-info="email"]').textContent = billing.email || "No email yet";
      $('[data-am-info="name"]').textContent = billing.name || "No name yet";
      const lines = [
        [a.line1, a.line2].filter(Boolean).join(", "),
        [a.city, a.state, a.postalCode].filter(Boolean).join(", "),
        a.country ? countryName(a.country) : "",
      ].filter(Boolean);
      const dd = $('[data-am-info="address"]');
      dd.replaceChildren();
      if (!lines.length) dd.textContent = "No address yet";
      lines.forEach((line, i) => { if (i) dd.append(document.createElement("br")); dd.append(line); });
    };

    /* Saved cards, each with a ⋯ menu (one open at a time) */
    const DOTS = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>';
    const MENU_ICONS = {
      edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/></svg>',
      star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>',
      trash: `<svg viewBox="0 0 24 24" aria-hidden="true">${CONFIRM_GLYPHS.trash}</svg>`,
    };
    let openMenu = null; // { toggle, list }
    const closeMenu = (refocus = false) => {
      if (!openMenu) return;
      openMenu.list.hidden = true;
      openMenu.toggle.setAttribute("aria-expanded", "false");
      if (refocus) openMenu.toggle.focus();
      openMenu = null;
    };
    const showMenu = (toggle, list) => {
      closeMenu();
      list.hidden = false;
      toggle.setAttribute("aria-expanded", "true");
      openMenu = { toggle, list };
      // Near the bottom of the scroll area, it opens upward instead.
      list.classList.remove("is-up");
      const room = body.getBoundingClientRect();
      const r = list.getBoundingClientRect();
      list.classList.toggle("is-up", r.bottom > room.bottom - 8 && r.top - room.top > r.height + 40);
      list.querySelector("[role=menuitem]").focus();
    };
    const menuItem = (icon, label, action, danger = false) => {
      const item = node("button", `am-menu-item${danger ? " am-menu-item--danger" : ""}`);
      item.type = "button";
      item.setAttribute("role", "menuitem");
      item.dataset.cardAction = action;
      item.innerHTML = MENU_ICONS[icon];
      item.append(node("span", "", label));
      return item;
    };
    const paintCards = () => {
      closeMenu();
      const box = $("[data-am-methods]");
      if (!ACCOUNT.cards.length) { box.replaceChildren(node("p", "am-card am-empty", "No payment methods yet.")); return; }
      box.replaceChildren(...ACCOUNT.cards.map((card) => {
        const row = node("div", "am-card am-method");
        row.dataset.card = card.id;
        const brand = node("span", "am-method__brand");
        brand.innerHTML = CARD_ICON;
        brand.setAttribute("aria-hidden", "true");
        const text = node("div", "am-method__text");
        const exp = `${String(card.expMonth).padStart(2, "0")}/${String(card.expYear).slice(-2)}`;
        const name = node("div", "am-method__name");
        name.append(node("strong", "", brandName(card.brand)));
        text.append(name, node("span", "am-method__number", `•••• ${card.last4} · ${exp}`));
        row.append(brand, text);
        if (card.isDefault) row.append(node("span", "am-badge", "Default")); // just left of ⋯

        const toggle = node("button", "icon-btn");
        toggle.type = "button";
        toggle.innerHTML = DOTS;
        toggle.setAttribute("aria-label", `Options for ${brandName(card.brand)} ending in ${card.last4}`);
        toggle.setAttribute("aria-haspopup", "menu");
        toggle.setAttribute("aria-expanded", "false");
        toggle.setAttribute("aria-controls", `am-menu-${card.id}`);
        const list = node("div", "am-menu");
        list.id = `am-menu-${card.id}`;
        list.setAttribute("role", "menu");
        list.setAttribute("aria-label", `${brandName(card.brand)} ending in ${card.last4}`);
        list.hidden = true;
        list.append(menuItem("edit", "Edit card", "edit"));
        if (!card.isDefault) list.append(menuItem("star", "Set as default", "default"));
        list.append(menuItem("trash", "Remove card", "remove", true));
        toggle.addEventListener("click", () => (openMenu?.list === list ? closeMenu() : showMenu(toggle, list)));
        list.addEventListener("keydown", (e) => {
          const items = [...list.querySelectorAll("[role=menuitem]")];
          const at = items.indexOf(document.activeElement);
          const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: -1 }[e.key];
          if (to != null) { e.preventDefault(); items[(to + items.length) % items.length].focus(); }
          else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeMenu(true); }
          else if (e.key === "Tab") closeMenu();
        });
        list.addEventListener("click", (e) => {
          const action = e.target.closest("[data-card-action]")?.dataset.cardAction;
          if (!action) return;
          closeMenu();
          cardAction(action, card, toggle);
        });
        row.append(toggle, list);
        return row;
      }));
    };
    // A card's ⋯ button after a repaint (or Add new if the card is gone).
    const cardButton = (id) => dialog.querySelector(`[data-card="${id}"] .icon-btn`) || $('[data-am-open="add-payment"]');
    const focusCard = (id) => cardButton(id).focus();
    const planRenews = () => !ACCOUNT.plan.ending;

    const cardAction = (action, card, toggle) => {
      if (action === "edit") editCard.open(card, () => cardButton(card.id));
      else if (action === "default") {
        ACCOUNT.cards.forEach((c) => { c.isDefault = c === card; });
        paintCards();
        focusCard(card.id);
        showToast(`${cardLabel(card)} is now your default card`);
      } else if (action === "remove") {
        const last = ACCOUNT.cards.length === 1;
        askConfirm({
          title: "Remove this card?",
          text: last && planRenews()
            ? `${cardLabel(card)} will be removed from your account. Add another payment method before your next charge to keep the scanner on.`
            : `${cardLabel(card)} will be removed from your account.`,
          action: "Remove card",
          cancel: "Keep card",
          icon: "trash",
          returnTo: toggle,
          onConfirm: () => {
            ACCOUNT.cards = ACCOUNT.cards.filter((c) => c !== card);
            if (card.isDefault && ACCOUNT.cards.length) ACCOUNT.cards[0].isDefault = true;
            paintCards();
            $('[data-am-open="add-payment"]').focus();
            showToast(`${cardLabel(card)} removed`);
          },
        });
      }
    };
    document.addEventListener("pointerdown", (e) => {
      if (openMenu && !openMenu.list.contains(e.target) && !openMenu.toggle.contains(e.target)) closeMenu();
    });

    /* Account tab */
    const nameForm = $("[data-am-name-form]");
    const nameInput = nameForm.elements.name;
    const nameSubmit = nameForm.querySelector("[type=submit]");
    const nameError = nameForm.querySelector("[data-form-error]");
    const nameProblem = (message) => {
      nameError.textContent = message || "";
      nameError.hidden = !message;
      if (message) nameInput.setAttribute("aria-invalid", "true");
      else nameInput.removeAttribute("aria-invalid");
    };
    const fillName = () => {
      nameInput.value = ACCOUNT.name;
      nameForm.elements.email.value = ACCOUNT.email;
      nameSubmit.disabled = true;
      nameProblem("");
    };
    nameForm.addEventListener("input", () => {
      nameSubmit.disabled = nameInput.value.trim() === ACCOUNT.name;
      nameProblem("");
    });
    nameForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = nameInput.value.trim().replace(/\s+/g, " ");
      if (!name) { nameProblem("Enter your name."); nameInput.focus(); return; }
      if (name === ACCOUNT.name) return;
      ACCOUNT.name = name;
      paintIdentity();
      fillName();
      showToast("Name updated");
    });

    // New design: each click draws another gradient at once.
    dialog.querySelectorAll("[data-am-shuffle]").forEach((b) => b.addEventListener("click", () => {
      let seed;
      do seed = crypto.getRandomValues(new Uint32Array(1))[0]; while (!seed || seed === ACCOUNT.avatar);
      ACCOUNT.avatar = seed;
      paintIdentity();
      const big = $(".avatar--xl");
      big.classList.remove("is-new");
      void big.offsetWidth; // restart the pop
      big.classList.add("is-new");
    }));

    $("[data-am-logout]").addEventListener("click", (e) => askLogout(e.currentTarget, () => dialog.close()));
    $("[data-am-delete]").addEventListener("click", (e) => askConfirm({
      title: "Delete your account?",
      text: "This permanently deletes your Pulse account, your profile and your saved cards. It can't be undone.",
      action: "Delete account",
      cancel: "Keep account",
      icon: "trash",
      returnTo: e.currentTarget,
      onConfirm: () => {
        dialog.close();
        document.dispatchEvent(new CustomEvent("scanner:delete-account"));
        showToast("Account deleted");
      },
    }));
    // "Cancel your plan in Subscriptions" (under a locked Delete)
    $("[data-am-goto]").addEventListener("click", () => {
      select("subscriptions", null);
      $("[data-am-cancel-plan]").focus();
    });

    /* Subscriptions tab */
    // View all: the full invoice history lives in the payment provider's
    // customer portal (Stripe's portal lists every invoice with its PDF).
    // Frontend only: the backend will create the portal session and return
    // its URL; until then the link says so.
    $("[data-am-portal]").addEventListener("click", () => showToast("The billing portal opens here once payments are connected"));
    $("[data-am-cancel-plan]").addEventListener("click", (e) => askConfirm({
      title: "Cancel your plan?",
      text: `You'll keep full access to your scanner until ${longDate(ACCOUNT.plan.renews)}. After that, the scanner and its alerts stop.`,
      action: "Cancel plan",
      cancel: "Keep plan",
      returnTo: e.currentTarget,
      onConfirm: () => {
        ACCOUNT.plan.ending = true;
        paintPlan();
        $("[data-am-resume-plan]").focus();
        showToast(`Plan canceled · access until ${longDate(ACCOUNT.plan.renews)}`);
      },
    }));
    $("[data-am-resume-plan]").addEventListener("click", () => {
      ACCOUNT.plan.ending = false;
      paintPlan();
      $("[data-am-cancel-plan]").focus();
      showToast("Your plan will renew as usual");
    });

    /* Form dialogs */
    document.querySelectorAll("[data-address]").forEach(buildAddress);
    document.querySelectorAll(".form-modal [data-digits]").forEach((input) =>
      input.addEventListener("input", () => { input.value = input.value.replace(/\D/g, ""); }));

    const editBilling = mountFormDialog(document.getElementById("edit-billing"), {
      fill: (form) => {
        form.elements.email.value = ACCOUNT.billing.email;
        form.elements.name.value = ACCOUNT.billing.name;
        setAddress(form, ACCOUNT.billing.address);
      },
      save: (form) => {
        const f = form.elements;
        const email = f.email.value.trim();
        if (!email || !f.email.checkValidity()) return { message: "Enter a valid billing email.", field: f.email };
        if (!f.name.value.trim()) return { message: "Enter the name for your invoices.", field: f.name };
        ACCOUNT.billing = { email, name: f.name.value.trim(), address: readAddress(form) };
        paintBilling();
        showToast("Billing information updated");
      },
    });

    const editCard = mountFormDialog(document.getElementById("edit-card"), {
      fill: (form, card) => {
        const id = form.querySelector("[data-fm-card]");
        const brand = node("span", "am-method__brand");
        brand.innerHTML = CARD_ICON;
        brand.setAttribute("aria-hidden", "true");
        id.replaceChildren(brand, `${brandName(card.brand)} ending in ${card.last4}`);
        form.elements.expMonth.value = String(card.expMonth).padStart(2, "0");
        form.elements.expYear.value = String(card.expYear);
        form.elements.name.value = card.name || "";
        setAddress(form, card.address);
      },
      save: (form, card) => {
        const f = form.elements;
        const month = Number(f.expMonth.value);
        const year = Number(f.expYear.value);
        if (!(month >= 1 && month <= 12)) return { message: "Enter the month as 01 to 12.", field: f.expMonth };
        if (f.expYear.value.length !== 4) return { message: "Enter the year with 4 digits.", field: f.expYear };
        if (expired(month, year)) return { message: "That date has passed. Check the card's expiration date.", field: f.expMonth };
        Object.assign(card, { expMonth: month, expYear: year, name: f.name.value.trim(), address: readAddress(form) });
        paintCards();
        showToast(`${cardLabel(card)} updated`);
      },
    });

    const addPayment = mountFormDialog(document.getElementById("add-payment"), {
      fill: (form) => {
        form.elements.name.value = ACCOUNT.billing.name;
        setAddress(form, ACCOUNT.billing.address);
        form.querySelector("[data-card-brand]").textContent = "";
      },
      save: (form) => {
        const f = form.elements;
        const digits = f.number.value.replace(/\D/g, "");
        const [mm, yy] = f.exp.value.split("/");
        const month = Number(mm);
        const year = 2000 + Number(yy);
        if (digits.length < 13 || !luhn(digits)) return { message: "Check the card number.", field: f.number };
        if (!(month >= 1 && month <= 12) || !yy || yy.length !== 2) return { message: "Enter the expiration as MM/YY.", field: f.exp };
        if (expired(month, year)) return { message: "This card has expired.", field: f.exp };
        if (!/^\d{3,4}$/.test(f.cvc.value)) return { message: "Enter the 3 or 4 digit security code.", field: f.cvc };
        if (!f.name.value.trim()) return { message: "Enter the name on the card.", field: f.name };
        if (!f.line1.value.trim()) return { message: "Enter the billing address.", field: f.line1 };
        // Only the brand and the last 4 digits are kept; the form resets on close.
        const card = {
          id: `card-${Date.now()}`, brand: cardBrandOf(digits), last4: digits.slice(-4), expMonth: month, expYear: year,
          isDefault: !ACCOUNT.cards.length, name: f.name.value.trim(), address: readAddress(form),
        };
        ACCOUNT.cards.push(card);
        paintCards();
        showToast(`${cardLabel(card)} added`);
      },
    });
    // Card number in groups of 4, with its brand; expiry as MM/YY.
    const numberInput = document.querySelector("[data-card-number]");
    numberInput.addEventListener("input", () => {
      const digits = numberInput.value.replace(/\D/g, "").slice(0, 19);
      numberInput.value = digits.replace(/(\d{4})(?=\d)/g, "$1 ");
      numberInput.form.querySelector("[data-card-brand]").textContent = CARD_BRANDS[cardBrandOf(digits)]?.[1] || "";
    });
    const expInput = document.querySelector("[data-card-exp]");
    expInput.addEventListener("input", (e) => {
      let digits = expInput.value.replace(/\D/g, "").slice(0, 4);
      if (digits.length === 1 && Number(digits) > 1) digits = `0${digits}`;
      // Backspace over the slash removes it instead of putting it back.
      expInput.value = digits.length > 2 || (digits.length === 2 && e.inputType !== "deleteContentBackward") ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
    });

    dialog.querySelectorAll("[data-am-open]").forEach((b) => b.addEventListener("click", () => {
      (b.dataset.amOpen === "edit-billing" ? editBilling : addPayment).open(null, b);
    }));

    /* Open / close */
    dialog.querySelector("[data-am-close]").addEventListener("click", () => dialog.close());
    closeOnBackdrop(dialog, holdWhileTyping(dialog));
    // Esc closes an open card menu first.
    dialog.addEventListener("cancel", (e) => {
      if (!openMenu) return;
      e.preventDefault();
      closeMenu(true);
    });
    dialog.addEventListener("close", () => {
      closeMenu();
      if (returnTo?.isConnected) returnTo.focus();
      returnTo = null;
    });

    paintIdentity();
    paintPlan();
    return {
      // `fromMenu`: the phone menu's scrim is already dark, so the sheet
      // takes over from it without fading (no glimpse of the scanner).
      open(tab = "account", from = document.activeElement, fromMenu = false) {
        returnTo = from;
        dialog.classList.toggle("is-from-menu", fromMenu);
        fillName();
        paintPlan();
        paintInvoices();
        paintBilling();
        paintCards();
        dialog.showModal();
        select(tab);
      },
    };
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
    const resetWidthsBtn = $("[data-ts-reset-widths]");
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
    let draft = null;        // { order, hidden, colors, excluded, widths }
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
      Object.entries(draft.widths).sort(),
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
      resetWidthsBtn.disabled = !Object.keys(draft.widths).length;
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

    // Widths are set in the table itself; here they can only go back to
    // their defaults (a draft too, applied on Save).
    resetWidthsBtn.addEventListener("click", () => {
      draft.widths = {};
      syncShown();
    });

    resetBtn.addEventListener("click", () => {
      draft.order = [...table.defaults];
      draft.hidden.clear();
      draft.colors = {};
      draft.widths = {};
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
       jumps or bursts; size and distance follow the heat just as smoothly.
     - One element: the pause icon, the ticker, the rising arrow and the
       "Halt / Resumed" line share one transform. Each part eases in and out
       (its slot and its box too), the pulse swells and settles, and the text
       is drawn at a fixed size and scaled, so every part keeps its place.
     - No kicks: every eased value (size, heat, parts) runs through two lags
       in a row, and each label aims at a softly trailing copy of its spot,
       so speeds build up and die down instead of starting at full. */

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
  const PULSE_GROW = 0.15;  // a new alert's label swells up to 15 % (its box too)
  const PART_TAU = 0.25;    // s: an icon or the sub line eases in / out
  const TEXT_REF = 100;     // px: tickers are drawn at this size and scaled
  const AIM_TAU = 0.12;     // s: the spot a label springs toward trails the layout's

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
    // Phones: no hover there, so a tap on a ticker pins its card (with a
    // close button) until ✕, a tap on empty space, or another ticker.
    let pinned = "";
    const tapMode = () => PHONE.matches && !DETACHED;
    const hitAt = (p) => [...bubbles.values()]
      .filter((b) => !b.leaving && Number.isFinite(b.x))
      .sort((a, b) => b.s - a.s)
      .find((b) => Math.abs(p.x - b.x) <= b.hw + 3 && Math.abs(p.y - b.y) <= b.hh + 3) ?? null;
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
    // Two first-order lags in a row (k = ease(tau / 2)): same settling time as
    // one, but the value starts moving gently instead of at full speed.
    const lag2 = (o, key, target, k) => {
      const mid = `${key}Lag`;
      o[mid] = (o[mid] ?? o[key]) + (target - (o[mid] ?? o[key])) * k;
      o[key] += (o[mid] - o[key]) * k;
    };
    // Parts ease their presence (0–1): pauseK (halted: the icon and the
    // halt color), riseK (the arrow), subK (the sub line, whose width eases
    // too). Their slots grow and shrink with them, so the text slides over
    // instead of jumping, and the box always holds what is drawn.
    const measure = (b, g, now, ease) => {
      const st = b.state;
      const font = Math.max(8, naturalFont(b, g) * fit);
      if (!b.font) b.font = font;
      else lag2(b, "font", font, ease((font < b.font ? FIT_SHRINK_TAU : FIT_GROW_TAU) / 2));
      const k = ease(PART_TAU / 2);
      lag2(b, "pauseK", st.halted ? 1 : 0, k);
      lag2(b, "riseK", st.status === "rising" ? 1 : 0, k);
      const sub = sublabelOf(st, now);
      if (sub) b.sub = sub; // the last text stays while the line eases out
      lag2(b, "subK", sub ? 1 : 0, k);
      if (b.sub) lag2(b, "subW", subWidth(b.sub), k);
      b.textW = textWidth(st.sym, b.font);
      b.pauseW = pauseWidth(b.font) * b.pauseK;
      b.riseW = b.font * 0.42 * b.riseK;
      b.labelW = b.pauseW + b.textW + b.riseW;
      b.grow = 1 + PULSE_GROW * b.pulse;
      // The box holds the label and its sub line, whichever is wider, pulse included.
      b.hw = b.grow * Math.max(b.labelW / 2 + 3 + b.font * 0.1, (b.subW * b.subK) / 2 + 2);
      b.hh = b.grow * (b.font * 0.5 + SUB_H * b.subK + 1);
    };
    // A new alert: a quick swell (a quarter of PULSE_MS) and a slow settle,
    // both eased, so the label never pops.
    const pulseOf = (b, t) => {
      const u = (t - b.pulseAt) / PULSE_MS;
      return u <= 0 || u >= 1 ? 0 : u < 0.25 ? smooth(u / 0.25) : 1 - smooth((u - 0.25) / 0.75);
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
    // It aims at a trailing copy of the spot (tx, ty): when the layout moves
    // the spot at once, the pull still builds up over a few frames.
    const glide = (b, dt, snap) => {
      if (snap || !Number.isFinite(b.x)) {
        b.x = b.tx = b.lx; b.y = b.ty = b.ly; b.vx = 0; b.vy = 0;
        return;
      }
      const aim = 1 - Math.exp(-dt / AIM_TAU);
      b.tx += (b.lx - b.tx) * aim;
      b.ty += (b.ly - b.ty) * aim;
      let ax = SPRING * SPRING * (b.tx - b.x) - 2 * SPRING * b.vx + b.px;
      let ay = SPRING * SPRING * (b.ty - b.y) - 2 * SPRING * b.vy + b.py;
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

    // t: the frame's clock (performance.now), so sway and pulse step evenly.
    const drawBubble = (b, t, still) => {
      const st = b.state;
      const sway = still ? 0 : SWAY;
      const wave = (t / b.period) * Math.PI * 2 + b.phase;
      const x = b.x + Math.sin(wave) * sway;
      const y = b.y + Math.cos(wave * 1.3) * sway;
      // Fades out over the last 40 % of the window unless new alerts arrive.
      const life = st.halted ? 1 : smooth((HEAT_WINDOW - st.lastAge) / (HEAT_WINDOW * 0.4));
      const a = smooth(b.vis) * Math.max(0.3, (0.45 + 0.55 * b.s) * life);
      const heat = heatColor(b.s);
      const color = b.pauseK > 0.005 ? mix(heat, C.halt, b.pauseK) : heat;
      const isHover = st.sym === hover;
      const isSelected = st.sym === selected;
      const shown = isHover ? Math.max(a, 0.92) : a;

      if (isHover || isSelected) {
        ctx.save();
        ctx.globalAlpha = shown;
        ctx.fillStyle = alpha(isSelected ? color : C.text, isSelected ? 0.1 : 0.06);
        ctx.strokeStyle = alpha(isSelected ? color : C.text, isSelected ? 0.55 : 0.22);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(x - b.hw - 3, y - b.hh - 2, b.hw * 2 + 6, b.hh * 2 + 4, 8);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      // One transform for every part: they move, sway and pulse together.
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(b.grow, b.grow);

      ctx.save();
      ctx.globalAlpha = shown;
      ctx.translate(0, -(SUB_H - 0.5) * b.subK);
      ctx.shadowColor = alpha(color, 0.55);
      ctx.shadowBlur = 8 * b.pauseK + (4 + 12 * b.s) * (1 - b.pauseK) + 16 * b.pulse;
      ctx.fillStyle = color;
      let cursor = -b.labelW / 2;
      if (b.pauseK > 0.01) {
        // Scaled within its slot while it eases in or out.
        const full = pauseWidth(b.font);
        ctx.save();
        ctx.globalAlpha *= b.pauseK;
        ctx.translate(cursor + b.pauseW / 2, 0);
        ctx.scale(b.pauseK, b.pauseK);
        drawPause(-full / 2, b.font, color);
        ctx.restore();
      }
      cursor += b.pauseW;
      // Drawn at TEXT_REF and scaled: the glyphs grow exactly as textW
      // does (no font-size steps or hinting), so the icons stay in place.
      ctx.save();
      ctx.translate(cursor, b.font * 0.04);
      ctx.scale(b.font / TEXT_REF, b.font / TEXT_REF);
      ctx.font = `800 ${TEXT_REF}px ${SANS}`;
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      ctx.fillText(st.sym, 0, 0);
      ctx.restore();
      if (b.riseK > 0.01) {
        // "Rising now": an alert in the last minute.
        const size = b.font * 0.26;
        ctx.save();
        ctx.globalAlpha *= b.riseK;
        ctx.translate(cursor + b.textW + b.font * 0.25 * b.riseK, -b.font * 0.21);
        ctx.scale(b.riseK, b.riseK);
        ctx.beginPath();
        ctx.moveTo(-size / 2, size / 2);
        ctx.lineTo(size / 2, size / 2);
        ctx.lineTo(0, -size / 2);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();

      if (b.subK > 0.01) {
        // Slides out from under the label as it eases in.
        ctx.save();
        ctx.globalAlpha = smooth(b.vis) * b.subK;
        ctx.translate(0, b.font * 0.5 + 1 - SUB_H * (1 - b.subK));
        ctx.scale(b.subK, b.subK);
        ctx.font = `600 ${SUB_FONT}px ${MONO}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = mix(C.resume, C.halt, b.pauseK);
        ctx.fillText(b.sub, 0, 0);
        ctx.restore();
      }
      ctx.restore();
    };

    const updateTip = (b, total, now) => {
      if (!b) {
        tipKey = "";
        tip.hidden = true;
        return;
      }
      const st = b.state;
      // Its text only changes from second to second (ages and clocks).
      const tap = tapMode();
      const key = `${st.sym}|${st.latest.t}|${st.status}|${st.rank}|${total}|${Math.floor(now / 1000)}|${tap}|${selected}`;
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
          ${tap ? `<button type="button" class="constellation__tip-close" data-tip-close aria-label="Close ${escHTML(st.sym)} details" title="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>` : ""}
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
          <span class="constellation__tip-hint">${st.sym === selected ? `${tap ? "Tap" : "Click"} to deselect` : `${tap ? "Tap" : "Click"} to select`}</span>`;
        tip.hidden = false;
      }
      tip.classList.toggle("is-pinned", tap);
      // Fixed to the viewport: it may overflow the panel, never the screen.
      const { offsetWidth: tw, offsetHeight: th } = tip;
      const box = canvas.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      const x = box.left + b.x;
      const right = x + b.hw + 12;
      const left = right + tw <= vw - 8 ? right : Math.min(vw - tw - 8, Math.max(8, x - b.hw - 12 - tw));
      // Phones: never over the nav and tabs, only from the chart's top down
      const floor = tap ? Math.max(8, box.top + 8) : 8;
      const top = Math.min(vh - th - 8, Math.max(floor, box.top + b.y - th / 2));
      tip.style.left = `${Math.round(left)}px`;
      tip.style.top = `${Math.round(top)}px`;
    };

    const frame = (ts) => {
      raf = 0;
      if (!W || !H) return;
      if (dirty) rebuild();
      const now = Date.now();
      // Motion runs on the frame's own clock (vsync-aligned when it comes
      // from requestAnimationFrame); only the first frame snaps.
      const tick = ts ?? performance.now();
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
          const sub = sublabelOf(st, now);
          b = {
            sym: st.sym,
            // Golden angle by arrival: tickers spread around the center.
            angle: -Math.PI / 2 + sequence++ * 2.39996,
            phase: seed * Math.PI * 2,
            period: 7000 + seed * 4000,
            s: strength,
            vis: 0,
            lastAlertAt: st.latest.t,
            pulseAt: now - st.latest.t < PULSE_MS ? tick : -Infinity,
            pulse: 0,
            // Parts start as they are: the label fades in whole.
            pauseK: st.halted ? 1 : 0,
            riseK: st.status === "rising" ? 1 : 0,
            subK: sub ? 1 : 0,
            sub,
            subW: sub ? subWidth(sub) : 0,
            lx: NaN, ly: NaN, tx: NaN, ty: NaN, x: NaN, y: NaN, vx: 0, vy: 0, px: 0, py: 0,
          };
          bubbles.set(st.sym, b);
        } else if (st.latest.t > b.lastAlertAt) {
          b.lastAlertAt = st.latest.t;
          b.pulseAt = tick;
        }
        b.state = st;
        lag2(b, "s", strength, ease(GROW_TAU / 2));
        b.pulse = still ? 0 : pulseOf(b, tick);
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
      const pointed = pointer
        ? [...active].sort((a, b) => b.s - a.s).find((b) => Math.abs(pointer.x - b.x) <= b.hw + 3 && Math.abs(pointer.y - b.y) <= b.hh + 3)
        : null;
      // Phones: the pinned ticker (gone from the chart, its card closes)
      if (pinned && !(tapMode() && active.some((b) => b.sym === pinned))) pinned = "";
      const hovered = tapMode() ? active.find((b) => b.sym === pinned) ?? null : pointed;
      hover = hovered?.sym ?? "";
      canvas.style.cursor = pointed ? "pointer" : "";

      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      drawBackdrop(g);
      // Weakest first: the leader is drawn on top.
      items.sort((a, b) => a.s - b.s).forEach((b) => drawBubble(b, tick, still));

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
    canvas.addEventListener("click", (e) => {
      if (tapMode()) {
        // A tap on a ticker pins its card (again on it: select / deselect);
        // on empty space it closes the card.
        const box = canvas.getBoundingClientRect();
        const sym = hitAt({ x: e.clientX - box.left, y: e.clientY - box.top })?.sym ?? "";
        if (!sym || sym !== pinned) {
          pinned = sym;
          tipKey = "";
          schedule();
          return;
        }
      } else if (!hover) return;
      selected = selected === hover ? "" : hover;
      tipKey = "";
      document.dispatchEvent(new CustomEvent("scanner:select", { detail: { sym: selected } }));
      schedule();
    });
    tip.addEventListener("click", (e) => {
      if (!e.target.closest("[data-tip-close]")) return;
      pinned = "";
      schedule();
    });
    PHONE.addEventListener("change", () => { pinned = ""; tipKey = ""; schedule(); });
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

    /* Landscape view (phones): the panel covers the screen, turned sideways
       while the phone is upright (CSS rotate) or simply filling it when the
       phone is held sideways. The same button, Esc, or leaving phone widths
       turns it back; the page behind is inert meanwhile. Turning the phone
       sideways with the Charts tab open enters it on its own, and turning
       it upright again leaves (only when it came in that way). The charts
       read their size and pointer in their own, unrotated frame (chartBox,
       chartPoint). The copies have no phone shell: no button there. */
    const rotateBtn = root.querySelector("[data-chart-rotate]");
    let turnedIn = false; // entered by turning the phone, not by the button
    const setLandscape = (on) => {
      turnedIn = false;
      if (on === root.classList.contains("is-landscape")) return;
      root.classList.toggle("is-landscape", on);
      document.documentElement.classList.toggle("has-landscape", on);
      document.querySelectorAll(".app-nav, .m-bar").forEach((el) => { el.inert = on; });
      rotateBtn.setAttribute("aria-pressed", String(on));
      rotateBtn.title = on ? "Exit landscape view" : "Landscape view";
      rotateBtn.setAttribute("aria-label", on ? "Exit landscape view: Charts" : "Landscape view: Charts");
    };
    if (DETACHED) rotateBtn.remove();
    else {
      rotateBtn.addEventListener("click", () => setLandscape(!root.classList.contains("is-landscape")));
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && root.classList.contains("is-landscape")) setLandscape(false);
      });
      PHONE.addEventListener("change", () => { if (!PHONE.matches) setLandscape(false); });
      const followPhone = () => {
        const sideways = PHONE.matches && !PORTRAIT.matches && root.hasAttribute("data-m-active");
        if (sideways && !root.classList.contains("is-landscape")) {
          setLandscape(true);
          turnedIn = true;
        } else if (!sideways && turnedIn) setLandscape(false);
      };
      PORTRAIT.addEventListener("change", followPhone);
      // The Charts tab opened while the phone is already sideways
      new MutationObserver(() => { if (root.hasAttribute("data-m-active")) followPhone(); })
        .observe(root, { attributes: true, attributeFilter: ["data-m-active"] });
      followPhone();
    }

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

  /* ---- Bull vs. Bear: mock feed --------------------------------------------
     Who controls the ticker, −100 (sellers) to +100 (buyers): the monitor's
     algorithm (see BULL_BEAR.md) run in the browser on one simulated ticker,
     GXAI, so the chart is designed against data that behaves like the real
     thing. Three pieces of evidence, each weighing half after 2.5 minutes
     (halted time does not count):
     - alert flow A (40 %): Buying / Selling Pressure alerts weighted by
       log2(1 + Vol. 1m / 100), capped at 12; A = tanh((buy − sell) / 16);
     - volume flow T (35 %): each Top List update's volume split into buy and
       sell by its return against recent volatility (Bulk Volume
       Classification), net against the day's usual volume;
     - price structure P (25 %): 3-minute momentum and distance to VWAP, both
       in units of volatility.
     Control C = 100 × (0.40 A + 0.35 T + 0.25 P). Every point also gets a
     momentum state (Real conviction, Buyers taking over, Divergence…); the
     state in force only changes once no point in the last 20 s backs it.
     The day is scripted (pre-market, open drive, a Halt, a flush, a
     divergence, a tug of war, a data gap, buyers back) on a mock clock that
     reads 10:44 ET when the page opens; from there live regimes follow.
     Key levels and Rally tracker draw the same day: each Top List update's
     price, volume and VWAP, the Pressure alerts, the Halts (and, for Rally
     tracker, each point's control and the participation).
     Only the main window runs it; copies get the series over the channel. */

  const BB_SYM = "GXAI";
  const BB_PREV_CLOSE = 1.66;        // GXAI's change in the chart bar
  const BB_CLOCK = 10 * 3600 + 44 * 60; // mock clock at page load (ET seconds of day)
  const BB_HALF_LIFE = 150e3;
  const BB_LOT = 5000;               // one Top List update every 5 s (the live CSV: ~15 s)
  const BB_GAP = 120e3;              // longer without data: no volume attributed, drawn gray
  const BB_DEBOUNCE = 20e3;
  const BB_MAX_WEIGHT = 12;          // heaviest alert: bars are drawn against it
  const BB_LABEL = {
    warming_up: "Warming up", quiet: "Quiet tape", tug_of_war: "Tug of war", holding: "Momentum holding",
    fading: "Momentum fading", conviction: "Real conviction", divergence: "Divergence detected", halted: "Halted",
  };
  const bbLabel = (key, side) => (key === "taking_over" ? `${side > 0 ? "Buyers" : "Sellers"} taking over` : BB_LABEL[key]);

  // The scripted day: minutes · price drift %/min · volume × usual · alerts/min
  const BB_SCRIPT = [
    { min: 40, drift: 0.05, vol: 0.3, buy: 0.08, sell: 0.06 },  // pre-market: quiet
    { min: 18, drift: 0.9, vol: 1.7, buy: 0.9, sell: 0.05 },    // open drive: buyers take over
    { min: 8, drift: 0.15, vol: 1, buy: 0.3, sell: 0.1 },       // holding
    { min: 5, halt: true },                                     // volatility halt
    { min: 11, drift: -0.8, vol: 1.9, buy: 0.05, sell: 1 },     // reopen flush: sellers
    { min: 8, drift: 0.35, vol: 0.9, buy: 0, sell: 0.7 },       // price up, flow down: divergence
    { min: 10, drift: 0, vol: 0.9, buy: 0.4, sell: 0.4 },       // tug of war
    { min: 3, gap: true },                                      // off the Top List
    { min: 11, drift: 0.6, vol: 1.4, buy: 0.8, sell: 0.1 },     // buyers back
  ];
  // Live: one of these every 2–5 minutes
  const BB_REGIMES = [
    { drift: 0.5, vol: 1.3, buy: 0.7, sell: 0.1 },
    { drift: 0.1, vol: 0.8, buy: 0.3, sell: 0.3 },
    { drift: -0.5, vol: 1.4, buy: 0.1, sell: 0.7 },
    { drift: 0, vol: 0.35, buy: 0.05, sell: 0.05 },
    { drift: 0.3, vol: 0.9, buy: 0, sell: 0.6 },
  ];

  // +62 · −18 · 0 (true minus sign)
  const fmtScore = (v) => {
    const r = Math.round(v);
    return r > 0 ? `+${r}` : r < 0 ? `−${-r}` : "0";
  };
  const clampTo = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  // Normal CDF (Abramowitz–Stegun erf, error < 1.5e-7)
  const ndtr = (x) => {
    const a = Math.abs(x) / Math.SQRT2;
    const k = 1 / (1 + 0.3275911 * a);
    const erf = 1 - ((((1.061405429 * k - 1.453152027) * k + 1.421413741) * k - 0.284496736) * k + 0.254829592) * k * Math.exp(-a * a);
    return 0.5 * (1 + Math.sign(x) * erf);
  };
  // Time spent halted between two instants (a Halt with no end is still on).
  const haltedIn = (halts, from, to) => halts.reduce((sum, h) => sum + Math.max(0, Math.min(h.end ?? Infinity, to) - Math.max(h.start, from)), 0);
  // Last index with t <= time (0 if none).
  const indexAt = (points, time) => {
    let lo = 0;
    let hi = points.length - 1;
    let found = 0;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (points[m].t <= time) { found = m; lo = m + 1; } else hi = m - 1;
    }
    return found;
  };
  const ET_PARTS = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" });
  const ET_HM = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const ET_HMS = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

  const createBullBearFeed = () => {
    const now = Date.now();
    const et = Object.fromEntries(ET_PARTS.formatToParts(now).map(({ type, value }) => [type, Number(value)]));
    const shift = (et.hour * 3600 + et.minute * 60 + et.second - BB_CLOCK) * 1000 + (now % 1000);
    const clock = () => Date.now() - shift;
    const anchor = clock();
    const session = (t) => {
      const s = (((BB_CLOCK + (t - anchor) / 1000) % 86400) + 86400) % 86400;
      return s < 9.5 * 3600 ? "pre" : s >= 16 * 3600 ? "post" : "";
    };

    const rand = seeded(BB_SYM);
    const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
    const points = [];
    const alerts = [];
    const halts = [];
    // Decayed sums: buy / sell alert weight and volume, all volume; plus day totals
    const ev = { t: 0, bA: 0, sA: 0, bV: 0, sV: 0, vol: 0, day: 0, active: 0, pv: 0, v: 0, lot: 0, last: 0, lots: 0, variance: 0.005 ** 2 / 15e3 };
    let price = 2.4;
    let status = null;
    let summary = null;

    const advance = (t) => {
      if (ev.t) {
        const dt = Math.max(0, t - ev.t - haltedIn(halts, ev.t, t));
        const k = 2 ** (-dt / BB_HALF_LIFE);
        ev.bA *= k; ev.sA *= k; ev.bV *= k; ev.sV *= k; ev.vol *= k;
        ev.active += dt;
      }
      ev.t = t;
    };

    const priceAt = (t) => points[indexAt(points, t)]?.price ?? price;

    // Raw state of one point, in priority order (BULL_BEAR.md · Estados)
    const classify = (t, { c, A, T, P, mom, part, buyShare, buying, selling }) => {
      const side = Math.sign(Math.round(c));
      const abs = Math.abs(c);
      const who = side > 0 ? "Buyers" : "Sellers";
      const pct = (v) => `${Math.round(v * 100)}%`;
      const x = `${part.toFixed(1)}x`;
      if (ev.lots < 4 && alerts.length < 2) return { key: "warming_up", side: 0, detail: `Collecting data: ${ev.lots} Top List updates so far.` };
      const flow = (0.4 * A + 0.35 * T) / 0.75;
      if (mom >= 0.45 && flow <= -0.25) return { key: "divergence", side: -1, detail: `Price is rising while ${pct(1 - buyShare)} of volume sells and selling alerts lead: no confirmation.` };
      if (mom <= -0.45 && flow >= 0.25) return { key: "divergence", side: 1, detail: `Price is falling but buyers absorb: ${pct(buyShare)} of volume on up-ticks.` };
      if (abs >= 50 && side * A >= 0.3 && side * T >= 0.2 && side * P >= 0.2 && part >= 0.9) {
        return { key: "conviction", side, detail: side > 0
          ? `Buy alerts, up-tick volume and price above VWAP all agree on ${x} volume.`
          : `Sell alerts, down-tick volume and price below VWAP all agree on ${x} volume.` };
      }
      let peak = 0;
      let recent = -Infinity;
      let flipped = false;
      let swing = 0;
      for (let i = points.length - 1; i >= 0 && points[i].t >= t - 600e3; i--) {
        const v = side * points[i].c;
        peak = Math.max(peak, v);
        if (points[i].t >= t - 180e3 && -v >= 15) flipped = true;
        if (points[i].t >= t - 120e3) { swing = Math.max(swing, side * (c - points[i].c)); recent = Math.max(recent, v); }
      }
      if (abs >= 20 && (flipped || swing >= 40)) return { key: "taking_over", side, detail: `${who} swung control to ${fmtScore(c)} in the last ${flipped ? 3 : 2} minutes.` };
      if (peak >= 40 && abs <= 0.6 * peak && recent - abs >= 10 && abs >= 10) {
        return { key: "fading", side, detail: `${who} still lead, but control fell from ${fmtScore(side * peak)} to ${fmtScore(c)} in 10 minutes.` };
      }
      if (abs >= 25 && !(side > 0 ? buying : selling) && part < 0.5) {
        return { key: "fading", side, detail: `${who} lead with no ${side > 0 ? "buying" : "selling"} alerts in 5 minutes and ${x} volume.` };
      }
      if (abs >= 25) {
        return { key: "holding", side, detail: `${who} keep control at ${fmtScore(c)}: ${pct(side > 0 ? buyShare : 1 - buyShare)} of recent volume on ${side > 0 ? "up" : "down"}-ticks.` };
      }
      if ((buying && selling) || part >= 0.5) return { key: "tug_of_war", side: 0, detail: `${buying} buying vs. ${selling} selling alerts in 5 minutes: neither side holds ±25.` };
      return { key: "quiet", side: 0, detail: `Little activity: ${x} normal volume and no pressure alerts to lead.` };
    };

    const evaluate = (t) => {
      const A = Math.tanh((ev.bA - ev.sA) / 16);
      const active = Math.max(ev.active, BB_LOT);
      const usual = ((ev.day / active) * BB_HALF_LIFE / Math.LN2) * (1 - 2 ** (-active / BB_HALF_LIFE));
      const T = ev.bV + ev.sV > 0 ? (ev.bV - ev.sV) / (ev.bV + ev.sV + 0.25 * usual) : 0;
      const part = usual > 0 ? ev.vol / usual : 0;
      const z = (ret, ms) => ret / Math.sqrt(ev.variance * ms);
      const mom = Math.tanh(z(Math.log(price / priceAt(t - 180e3)), 180e3) / 2);
      const vwap = ev.v ? ev.pv / ev.v : price;
      const P = (mom + Math.tanh(z(Math.log(price / vwap), 300e3) / 2)) / 2;
      const c = 100 * (0.4 * A + 0.35 * T + 0.25 * P);
      const buyShare = ev.bV + ev.sV > 0 ? ev.bV / (ev.bV + ev.sV) : 0.5;
      let buying = 0;
      let selling = 0;
      for (let i = alerts.length - 1; i >= 0 && alerts[i].t > t - 300e3; i--) alerts[i].side > 0 ? buying++ : selling++;
      const raw = classify(t, { c, A, T, P, mom, part, buyShare, buying, selling });
      const point = { t, c, alerts: A, tape: T, trend: P, price: round(price, 4), vwap: round(vwap, 4), part, raw: `${raw.key}:${raw.side}`, state: null, session: session(t) };
      // Debounce: the state in force holds while a point of the last 20 s backs it
      const current = status && `${status.key}:${status.side}`;
      let held = current === point.raw;
      for (let i = points.length - 1; !held && current && i >= 0 && points[i].t >= t - BB_DEBOUNCE; i--) held = points[i].raw === current;
      if (!held) status = { key: raw.key, side: raw.side, label: bbLabel(raw.key, raw.side), detail: raw.detail, since: t };
      else if (current === point.raw) status.detail = raw.detail; // the detail follows the last point that backs it
      point.state = { key: status.key, side: status.side, label: status.label };
      points.push(point);
      summary = { control: c, alerts: A, tape: T, trend: P, buyShare, participation: part, buying, selling, price: point.price, vwap };
    };

    const lot = (t, volume) => {
      const since = ev.lot ? t - ev.lot - haltedIn(halts, ev.lot, t) : Infinity;
      advance(t);
      if (since <= BB_GAP) {
        const r = Math.log(price / ev.last);
        const f = ndtr(r / Math.sqrt(ev.variance * since));
        ev.bV += f * volume;
        ev.sV += (1 - f) * volume;
        // ~40 updates of memory, never below half a tick per update
        ev.variance = Math.max((0.005 / price) ** 2 / BB_LOT, ev.variance + (r * r / since - ev.variance) / 40);
      }
      ev.vol += volume; ev.day += volume; ev.pv += price * volume; ev.v += volume;
      ev.lot = t; ev.last = price; ev.lots += 1;
      evaluate(t);
      // Top List updates carry their volume (Key levels); alert points do not.
      points[points.length - 1].vol = Math.round(volume);
    };

    const alert = (t, side, vol) => {
      advance(t);
      const weight = clampTo(Math.log2(1 + vol / 100), 0.5, BB_MAX_WEIGHT);
      if (side > 0) ev.bA += weight; else ev.sA += weight;
      alerts.push({ t, side, weight, vol, price: round(price, 4) });
      evaluate(t);
    };

    // One update: the alerts since the last one (in time order), then the update
    const step = (phase, t) => {
      const from = ev.lot || t - BB_LOT;
      const span = t - from;
      const due = [[1, phase.buy], [-1, phase.sell]]
        .filter(([, perMin]) => rand() < (perMin * span) / 60e3)
        .map(([side]) => ({ side, t: Math.round(from + (0.1 + 0.8 * rand()) * span), vol: 100 * 2 ** (1 + rand() * 7) }))
        .sort((a, b) => a.t - b.t);
      due.forEach((a) => alert(a.t, a.side, a.vol));
      price = Math.max(0.05, price * Math.exp((phase.drift / 100) * (span / 60e3) + 0.0013 * gauss()));
      lot(t, 12e3 * phase.vol * Math.exp(0.35 * gauss()));
    };

    let t = anchor - BB_SCRIPT.reduce((sum, p) => sum + p.min, 0) * 60e3;
    for (const phase of BB_SCRIPT) {
      const end = t + phase.min * 60e3;
      if (phase.halt) halts.push({ start: t, end });
      else if (!phase.gap) for (let at = t + BB_LOT; at <= end; at += BB_LOT) step(phase, at);
      t = end;
    }

    const copy = () => ({ halts: halts.map((h) => ({ ...h })), status: { ...status }, summary: { ...summary } });
    const listeners = [];
    let regime = BB_SCRIPT[BB_SCRIPT.length - 1];
    let regimeEnd = anchor + 3 * 60e3;
    setInterval(() => {
      const p0 = points.length;
      const a0 = alerts.length;
      const at = Math.max(ev.lot + 1000, clock());
      if (at >= regimeEnd) {
        regime = BB_REGIMES[Math.floor(rand() * BB_REGIMES.length)];
        regimeEnd = at + (2 + rand() * 3) * 60e3;
      }
      step(regime, at);
      const update = { points: points.slice(p0), alerts: alerts.slice(a0), ...copy() };
      listeners.forEach((fn) => fn(update));
    }, BB_LOT);

    return {
      dump: () => ({ points: points.slice(), alerts: alerts.slice(), ...copy() }),
      onUpdate: (fn) => listeners.push(fn),
    };
  };

  /* ---- Chart canvas helpers ------------------------------------------------
     Shared by the canvas charts (Bull vs. Bear, Key levels, Rally tracker): tokens read as
     canvas colors, crisp 1 px lines, value tags pushed apart on the axis
     and the hover card placed beside the cursor. */

  // A CSS token as a canvas color (the canvas normalizes any CSS color to hex).
  const chartColor = (ctx, css, name, fallback) => {
    ctx.fillStyle = fallback;
    ctx.fillStyle = css.getPropertyValue(name).trim() || fallback;
    return ctx.fillStyle;
  };
  const chartAlpha = (hex, a) => `rgba(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(",")},${a})`;
  const crisp = (v) => Math.round(v) + 0.5;

  // Tags on the value axis, pushed apart (and kept inside [min, max]) so none overlaps.
  const spreadTags = (tags, min, max, h) => {
    tags.sort((a, b) => a.y - b.y);
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 1; i < tags.length; i++) {
        const overlap = tags[i - 1].y + h - tags[i].y;
        if (overlap > 0) { tags[i - 1].y -= overlap / 2; tags[i].y += overlap / 2; }
      }
      tags.forEach((tag) => { tag.y = clampTo(tag.y, min, max); });
      for (let i = 1; i < tags.length; i++) tags[i].y = Math.max(tags[i].y, tags[i - 1].y + h);
      for (let i = tags.length - 2; i >= 0; i--) tags[i].y = Math.min(tags[i].y, tags[i + 1].y - h);
    }
    return tags;
  };

  // Phones can turn the Charts panel sideways (a CSS rotate of 90°
  // clockwise, see mountChartPanel's landscape view). Screen boxes are then
  // turned too, so the charts read their size and the pointer here, in
  // their own frame: x runs down the screen and y from right to left.
  const chartTurned = (el) => PORTRAIT.matches && Boolean(el.closest(".chart-panel.is-landscape"));
  const chartBox = (el) => {
    const r = el.getBoundingClientRect();
    return chartTurned(el) ? { width: r.height, height: r.width } : r;
  };
  const chartPoint = (el, e) => {
    const r = el.getBoundingClientRect();
    return chartTurned(el) ? { x: e.clientY - r.top, y: r.right - e.clientX } : { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  // Hover card next to the cursor, on its left; on the right when the left
  // edge leaves no room. Vertically centered on `cy`, kept inside the plot.
  const CHART_TIP_GAP = 14;
  const placeChartTip = (tip, x, cy, right, floor) => {
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const left = x - CHART_TIP_GAP - w >= 4 ? x - CHART_TIP_GAP - w : Math.min(x + CHART_TIP_GAP, right - w - 4);
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(clampTo(cy - h / 2, 4, Math.max(4, floor - h)))}px`;
  };

  /* ---- Bull vs. Bear chart --------------------------------------------------
     TradingView-style baseline chart on a canvas: control line green above
     zero and red below, each with an area that fades toward the zero line;
     fixed −100…+100 scale, so +60 always means the same. Around it:
     - band ±25 (nobody leads), grid at ±50, solid zero line;
     - each alert a bar from zero (Buying up, Selling down), as tall as its
       weight; never merged, so a burst reads as a wall of bars;
     - the price, neutral gray on a scale of its own, to spot divergences;
     - Halts shaded and labeled (the line stays flat, then jumps at the
       reopen); over 2 minutes without data, the line goes on solid in gray;
       pre-market / after hours shaded;
     - the state ribbon under the plot, stronger the clearer the lead;
     - right axis: BULLS · +50 · 0 · −50 · BEARS and the live tags (control,
       price); time axis with HH:MM, or HH:MM:SS below one-minute ticks.
     Nothing overlaps: axis labels give way to the tags, the two tags push
     each other apart, the HALT label only goes where no line, bar or price
     passes, and time labels keep their width apart. The hover card sits
     beside the cursor (left of it, right near the left edge).
     Crosshair (magnet): snaps to the nearest point; chips on both axes. The
     keyboard moves it too (←/→, Shift for a minute, Home/End, Esc).
     Colors, strengths and sizes are tokens in :root (--chart-*); the window
     and the price toggle are saved in localStorage. */

  const BB_KEY = "scanner:bull-bear:v1";
  const BB_WINDOWS = [60e3, 300e3, 900e3, 1800e3, 3600e3, 0];
  const BB_ZONE = 25;                // |control| < 25: nobody leads
  const BB_MIN_SPAN = 5 * 60e3;      // Day right after the first data still spans 5 minutes
  const BB_TIME_STEPS = [5e3, 10e3, 15e3, 30e3, 60e3, 120e3, 300e3, 600e3, 900e3, 1800e3, 3600e3, 7200e3];
  // Ribbon strength per state: the clearer the lead, the stronger.
  const BB_STATE_ALPHA = { conviction: 0.95, taking_over: 0.75, divergence: 0.85, holding: 0.55, fading: 0.3, tug_of_war: 0.35, quiet: 0.16, warming_up: 0.1, halted: 0.45 };
  const BB_AXIS = [[100, "BULLS"], [50, "+50"], [0, "0"], [-50, "−50"], [-100, "BEARS"]];
  const BB_STAT_TITLES = {
    alerts: "Net Buying vs. Selling Pressure alerts, weighted by Vol. 1m, with a 2.5-minute half-life (−100 to +100)",
    buyShare: "Share of recent volume traded on up-ticks: each Top List update is split into buy and sell volume (Bulk Volume Classification)",
    trend: "3-minute momentum and distance to VWAP, in units of recent volatility (−100 to +100)",
    participation: "Recent volume against the day's normal pace (1.0x = normal)",
    count: "Buying / Selling Pressure alerts in the last 5 minutes",
  };
  const bbTone = (key, side) => (key === "divergence" ? "warn" : key === "halted" || !side ? "neutral" : side > 0 ? "bull" : "bear");

  const bbPrefs = { window: 1800e3, price: true };
  const loadBbPrefs = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(BB_KEY) || "{}");
      bbPrefs.window = BB_WINDOWS.includes(saved.window) ? saved.window : 1800e3;
      bbPrefs.price = typeof saved.price === "boolean" ? saved.price : true;
    } catch { /* ignore */ }
  };
  const saveBbPrefs = () => {
    try { localStorage.setItem(BB_KEY, JSON.stringify(bbPrefs)); } catch { /* ignore */ }
  };
  loadBbPrefs();

  const mountBullBear = (view, root) => {
    const box = view.querySelector(".chart-canvas");
    const canvas = box.querySelector("canvas");
    const tip = box.querySelector(".chart-tip");
    const note = box.querySelector(".chart-message");
    const ctx = canvas.getContext("2d");
    const symbol = root.querySelector(".chart-symbol__input");
    const quote = { price: root.querySelector(".chart-quote__price"), change: root.querySelector(".chart-quote__change") };
    const pill = view.querySelector(".chart-state");
    const since = view.querySelector(".chart-since");
    const detail = view.querySelector(".chart-head__detail");
    const meter = view.querySelector(".chart-meter");
    const fill = meter.querySelector(".chart-meter__fill");
    const thumb = meter.querySelector(".chart-meter__thumb");
    const score = meter.querySelector(".chart-meter__score");
    const stats = view.querySelector(".chart-stats");
    const legendPrice = view.querySelector(".chart-key[data-key='overlay']").parentElement;
    const priceBtn = view.querySelector("[data-bb-price]");
    const windowBtns = [...view.querySelectorAll("[data-bb-window]")];
    const intro = detail.textContent;

    // Tokens → canvas colors
    const rootCss = getComputedStyle(document.documentElement);
    const color = (name, fallback) => chartColor(ctx, rootCss, name, fallback);
    const C = {
      bg: color("--chart-bg", "#08090b"),
      grid: color("--chart-grid", "#14181e"),
      bull: color("--chart-bull", "#c8ff38"),
      bear: color("--chart-bear", "#ff4f6b"),
      warn: color("--chart-warn", "#ffb84d"),
      neutral: color("--chart-neutral", "#5d6673"),
      overlay: color("--chart-overlay", "#b4bbc6"),
      zero: color("--chart-zero", "#7b8492"),
      axis: color("--chart-axis-text", "#7b8492"),
      cross: color("--chart-crosshair", "#7b8492"),
      chip: color("--chart-chip", "#1f242c"),
      chipText: color("--text", "#f2f4f7"),
      ink: color("--chart-ink", "#0a0f00"),
      mark: color("--chart-watermark", "#12151a"),
      session: color("--chart-session", "#12151a"),
      line: color("--line", "#23282f"),
    };
    const SANS = rootCss.getPropertyValue("--font-sans").trim() || "sans-serif";
    const MONO = rootCss.getPropertyValue("--font-mono").trim() || "monospace";
    const alpha = chartAlpha;
    const TONE ={ bull: C.bull, bear: C.bear, warn: C.warn, neutral: C.neutral };
    const stateColor = (s) => (s ? alpha(s.key === "halted" ? C.neutral : TONE[bbTone(s.key, s.side)], BB_STATE_ALPHA[s.key] ?? 0.3) : null);
    const sideColor = (c) => (c >= 0.5 ? C.bull : c <= -0.5 ? C.bear : C.neutral);

    // Strengths and sizes, read from the box: a narrow stage may override them.
    let A = {};
    let G = {};
    const readSizes = () => {
      const css = getComputedStyle(box);
      const num = (name, fallback) => {
        const v = parseFloat(css.getPropertyValue(name));
        return Number.isFinite(v) ? v : fallback;
      };
      A = { area: num("--chart-area-a", 0.2), bar: num("--chart-bar-a", 0.4), zone: num("--chart-zone-a", 0.06), overlay: num("--chart-overlay-a", 0.5), session: num("--chart-session-a", 0.6), halt: num("--chart-halt-a", 0.12) };
      G = {
        axisW: num("--chart-axis-w", 52), axisH: num("--chart-axis-h", 20), pad: num("--chart-pad", 10), live: num("--chart-live-pad", 28),
        tag: num("--chart-tag-h", 18), band: num("--chart-band-h", 6), bandGap: num("--chart-band-gap", 6),
      };
    };

    let data = null;
    let W = 0;
    let H = 0;
    let frame = 0;
    let geo = null;
    let hover = null; // index into data.points
    let pointerY = null; // cursor's y over the canvas (null: keyboard)

    const ticker = () => symbol.value.trim().toUpperCase();
    const message = () => {
      const sym = ticker();
      if (!sym) return "Type a ticker to see who is in control.";
      if (sym !== BB_SYM) return `Mock data covers ${BB_SYM} only for now: type ${BB_SYM} to see the chart.`;
      if (!data || !data.points.length) return `Waiting for ${sym} alerts and Top List data…`;
      return "";
    };

    /* Head: state pill, since, detail, meter, component stats, quote */
    const signOf = (v) => (v >= 0.005 ? "up" : v <= -0.005 ? "down" : "");
    const renderHead = () => {
      const off = message();
      const s = off ? null : data.status;
      const sum = off ? null : data.summary;
      pill.dataset.tone = s ? bbTone(s.key, s.side) : "neutral";
      pill.textContent = s ? s.label : "Waiting for data";
      since.textContent = s ? `since ${ET_HMS.format(s.since)} ET` : "since --:--:-- ET";
      detail.textContent = s ? s.detail : intro;
      detail.title = s ? s.detail : "";

      const c = sum ? clampTo(sum.control, -100, 100) : 0;
      const r = Math.round(c);
      meter.dataset.lead = r > 0 ? "bull" : r < 0 ? "bear" : "";
      fill.style.left = `${50 + Math.min(0, c) / 2}%`;
      fill.style.width = `${Math.abs(c) / 2}%`;
      thumb.style.left = `${50 + c / 2}%`;
      score.textContent = sum ? fmtScore(c) : "—";
      meter.setAttribute("aria-valuenow", String(r));
      meter.setAttribute("aria-valuetext", sum ? `${fmtScore(c)}, ${r > 0 ? "bulls ahead" : r < 0 ? "bears ahead" : "balanced"}` : "No data");

      const items = [
        ["Alert flow", sum && fmtScore(sum.alerts * 100), sum && signOf(sum.alerts), BB_STAT_TITLES.alerts],
        ["Buy volume", sum && `${Math.round(sum.buyShare * 100)}%`, sum && (sum.buyShare >= 0.55 ? "up" : sum.buyShare <= 0.45 ? "down" : ""), BB_STAT_TITLES.buyShare],
        ["Price trend", sum && fmtScore(sum.trend * 100), sum && signOf(sum.trend), BB_STAT_TITLES.trend],
        ["Participation", sum && `${sum.participation.toFixed(1)}x`, "", BB_STAT_TITLES.participation],
        ["Alerts 5m", sum && `${sum.buying}<small>buy</small>${sum.selling}<small>sell</small>`, "", BB_STAT_TITLES.count],
      ];
      stats.innerHTML = items.map(([label, value, sign, title]) => (
        `<div title="${title}"><dt>${label}</dt><dd${sign ? ` data-sign="${sign}"` : ""}>${value ?? "—"}</dd></div>`
      )).join("");

      if (sum && ticker() === BB_SYM) {
        const change = sum.price - BB_PREV_CLOSE;
        quote.price.textContent = fmtPrice(sum.price);
        quote.change.dataset.dir = change >= 0 ? "up" : "down";
        quote.change.innerHTML = `${change >= 0 ? "+" : "-"}${Math.abs(change).toFixed(2)} <span>${fmtPct((change / BB_PREV_CLOSE) * 100, 2)}</span>`;
      }
    };

    /* Plot geometry: +100 at `top`, −100 at `bottom`; `pad` above and below
       leaves room for the tags. The live point sits `live` px from the axis. */
    const geometry = (points) => {
      const right = W - G.axisW;
      const timeTop = H - G.axisH;
      const band = timeTop - G.bandGap - G.band;
      const top = G.pad;
      const bottom = Math.max(top + 40, band - G.bandGap - G.pad);
      const mid = (top + bottom) / 2;
      const half = (bottom - top) / 2;
      const end = points[points.length - 1].t;
      let start = bbPrefs.window ? end - bbPrefs.window : points[0].t;
      const minSpan = Math.min(BB_MIN_SPAN, bbPrefs.window || Infinity);
      if (end - start < minSpan) start = end - minSpan;
      const usable = Math.max(1, right - G.live);
      return {
        right, timeTop, band, top, bottom, mid, half, start, end, usable, floor: bottom + G.pad,
        first: indexAt(points, start), // the point before the window enters from the left edge
        x: (t) => ((t - start) / (end - start)) * usable,
        y: (c) => mid - (clampTo(c, -100, 100) / 100) * half,
      };
    };

    const axisTag = (g, y, text, bg, ink) => {
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.roundRect(g.right + 3, y - G.tag / 2, G.axisW - 6, G.tag, 3);
      ctx.fill();
      ctx.fillStyle = ink;
      ctx.font = `700 10.5px ${MONO}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, g.right + G.axisW / 2, y + 0.5);
    };

    const draw = () => {
      if (!W || !H) return;
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, W, H);
      const off = message();
      note.textContent = off;
      note.hidden = !off;
      legendPrice.hidden = !bbPrefs.price;
      if (off) {
        geo = null;
        tip.hidden = true;
        canvas.setAttribute("aria-label", `Bull vs. Bear chart. ${off}`);
        return;
      }

      const { points, alerts, halts, status } = data;
      const last = points[points.length - 1];
      const g = (geo = geometry(points));
      const { right, top, bottom, mid, half, floor, timeTop, start, end, first, usable, x, y } = g;
      const continuous = (i) => points[i + 1].t - points[i].t - haltedIn(halts, points[i].t, points[i + 1].t) <= BB_GAP;
      const haltBetween = (from, to) => halts.some((h) => h.start >= from && h.start < to);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      // Time ticks: the smallest step whose labels keep their width apart
      ctx.font = `500 10.5px ${MONO}`;
      const span = end - start;
      const labelW = (step) => ctx.measureText(step < 60e3 ? "00:00:00" : "00:00").width + 24;
      const step = BB_TIME_STEPS.find((s) => (s / span) * usable >= labelW(s)) || BB_TIME_STEPS[BB_TIME_STEPS.length - 1];
      const tickFmt = step < 60e3 ? ET_HMS : ET_HM;
      const ticks = [];
      for (let t = Math.ceil(start / step) * step; t <= end; t += step) ticks.push({ x: x(t), t });

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, right, floor);
      ctx.clip();

      // Pre-market / after hours, one band per run
      for (let i = first; i < points.length - 1; i++) {
        const s = points[i].session;
        if (!s) continue;
        let j = i;
        while (j < points.length - 1 && points[j].session === s) j++;
        ctx.fillStyle = alpha(C.session, A.session);
        ctx.fillRect(x(points[i].t), 0, x(points[j].t) - x(points[i].t), floor);
        i = j - 1;
      }

      // Ticker watermark
      ctx.font = `800 ${Math.round(clampTo(W * 0.11, 28, 84))}px ${SANS}`;
      ctx.fillStyle = C.mark;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(ticker(), usable / 2, mid);

      // No-control band, grid, zero line
      ctx.fillStyle = alpha(C.neutral, A.zone);
      ctx.fillRect(0, y(BB_ZONE), right, y(-BB_ZONE) - y(BB_ZONE));
      ctx.strokeStyle = C.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      [100, 50, -50, -100].forEach((v) => { ctx.moveTo(0, crisp(y(v))); ctx.lineTo(right, crisp(y(v))); });
      ticks.forEach((tick) => { ctx.moveTo(crisp(tick.x), 0); ctx.lineTo(crisp(tick.x), floor); });
      ctx.stroke();
      ctx.strokeStyle = alpha(C.zero, 0.55);
      ctx.beginPath();
      ctx.moveTo(0, crisp(mid));
      ctx.lineTo(right, crisp(mid));
      ctx.stroke();

      // Halts: shaded; the line stays flat through them
      const haltSpans = halts
        .map((h) => ({ l: Math.max(0, x(h.start)), r: Math.min(right, x(h.end ?? end)), c: points[indexAt(points, h.start)].c }))
        .filter((s) => s.r > s.l);
      ctx.fillStyle = alpha(C.neutral, A.halt);
      haltSpans.forEach((s) => ctx.fillRect(s.l, 0, s.r - s.l, floor));

      // Alert bars from zero, one per alert (never merged: a burst shows as
      // a wall of bars); each as tall as its weight
      const lotPx = (BB_LOT / span) * usable;
      const barW = clampTo(Math.round(lotPx * 0.5), 3, 6);
      const bars = [];
      for (let i = indexAt(alerts, start); i < alerts.length; i++) {
        const a = alerts[i];
        if (a.t >= start) bars.push({ side: a.side, x: x(a.t), w: a.weight });
      }
      bars.forEach((bar) => {
        bar.len = Math.max(3, Math.min(1, bar.w / BB_MAX_WEIGHT) * half * 0.9);
        bar.top = bar.side > 0 ? mid - bar.len : mid;
        ctx.fillStyle = alpha(bar.side > 0 ? C.bull : C.bear, A.bar);
        ctx.beginPath();
        ctx.roundRect(bar.x - barW / 2, bar.top, barW, bar.len, bar.side > 0 ? [1.5, 1.5, 0, 0] : [0, 0, 1.5, 1.5]);
        ctx.fill();
      });

      // Control line and baseline areas. A Halt: flat to the reopen, then the jump.
      const line = new Path2D();
      const area = new Path2D();
      const gaps = new Path2D();
      let run = first;
      for (let i = first; i < points.length; i++) {
        const p = points[i];
        const px = x(p.t);
        const py = y(p.c);
        if (i === run) {
          line.moveTo(px, py);
          area.moveTo(px, mid);
        } else {
          const prev = points[i - 1];
          const resumed = halts.reduce((m, h) => (h.end != null && h.start < p.t && h.end > prev.t && h.end <= p.t ? Math.max(m, h.end) : m), -Infinity);
          if (Number.isFinite(resumed)) {
            line.lineTo(x(resumed), y(prev.c));
            area.lineTo(x(resumed), y(prev.c));
          }
          line.lineTo(px, py);
        }
        area.lineTo(px, py);
        const isLast = i === points.length - 1;
        if (isLast || !continuous(i)) {
          area.lineTo(px, mid);
          area.closePath();
          if (!isLast) {
            gaps.moveTo(px, py);
            gaps.lineTo(x(points[i + 1].t), y(points[i + 1].c));
          }
          run = i + 1;
        }
      }
      [[C.bull, 0, mid, top, mid], [C.bear, mid, floor, bottom, mid]].forEach(([hue, from, to, edge, zero]) => {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, from, right, to - from);
        ctx.clip();
        const grad = ctx.createLinearGradient(0, edge, 0, zero);
        grad.addColorStop(0, alpha(hue, A.area));
        grad.addColorStop(1, alpha(hue, 0));
        ctx.fillStyle = grad;
        ctx.fill(area);
        ctx.strokeStyle = hue;
        ctx.lineWidth = 2;
        ctx.stroke(line);
        ctx.restore();
      });
      // No data for over 2 minutes: the same solid line, in neutral gray
      ctx.strokeStyle = C.neutral;
      ctx.lineWidth = 2;
      ctx.stroke(gaps);

      // Price on a scale of its own; broken at Halts and data gaps
      let priceTag = null;
      if (bbPrefs.price) {
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = first; i < points.length; i++) { lo = Math.min(lo, points[i].price); hi = Math.max(hi, points[i].price); }
        const padP = Math.max((hi - lo) * 0.08, hi * 0.002, 1e-4);
        const yP = (v) => bottom - 6 - ((v - (lo - padP)) / (hi - lo + 2 * padP)) * (bottom - top - 12);
        const path = new Path2D();
        for (let i = first; i < points.length; i++) {
          const px = x(points[i].t);
          const py = yP(points[i].price);
          if (i === first || !continuous(i - 1) || haltBetween(points[i - 1].t, points[i].t)) path.moveTo(px, py);
          else path.lineTo(px, py);
        }
        ctx.strokeStyle = alpha(C.overlay, A.overlay);
        ctx.lineWidth = 1.25;
        ctx.stroke(path);
        priceTag = { y: yP(last.price), text: fmtPrice(last.price), bg: C.overlay };
        g.yPrice = yP;
      }

      // Last value: dotted line across, live dot with a soft halo
      const tone = sideColor(last.c);
      const lx = x(last.t);
      const ly = y(last.c);
      ctx.setLineDash([1, 3]);
      ctx.strokeStyle = alpha(tone, 0.55);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, crisp(ly));
      ctx.lineTo(right, crisp(ly));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = alpha(tone, 0.18);
      ctx.beginPath();
      ctx.arc(lx, ly, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = tone;
      ctx.strokeStyle = C.bg;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(lx, ly, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // HALT label: centered on its Halt, at the edge of the half the frozen
      // line leaves free (else the other edge); skipped if both would cover
      // the control line, the price or an alert bar. It may be wider than a
      // short Halt.
      const clear = (l, r, t, b) => {
        if (ly > t - 3 && ly < b + 3) return false; // the last value's dotted line
        for (let i = Math.max(first, 1); i < points.length; i++) {
          const x0 = x(points[i - 1].t);
          const x1 = x(points[i].t);
          if (x1 < l - 3 || x0 > r + 3) continue;
          const spans = [[y(points[i - 1].c), y(points[i].c)]];
          if (g.yPrice) spans.push([g.yPrice(points[i - 1].price), g.yPrice(points[i].price)]);
          if (spans.some(([a, b2]) => Math.max(a, b2) > t - 3 && Math.min(a, b2) < b + 3)) return false;
        }
        for (const bar of bars) {
          if (bar.x + barW / 2 > l - 3 && bar.x - barW / 2 < r + 3 && bar.top + bar.len > t - 3 && bar.top < b + 3) return false;
        }
        return true;
      };
      ctx.font = `700 9.5px ${MONO}`;
      const haltW = ctx.measureText("HALT").width + 12;
      haltSpans.forEach((s) => {
        const l = clampTo((s.l + s.r - haltW) / 2, 0, right - haltW);
        const edges = s.c >= 0 ? [bottom - 10, top + 10] : [top + 10, bottom - 10];
        const cy = edges.find((e) => clear(l, l + haltW, e - 8, e + 8));
        if (cy === undefined) return;
        ctx.fillStyle = C.chip;
        ctx.beginPath();
        ctx.roundRect(l, cy - 8, haltW, 16, 4);
        ctx.fill();
        ctx.fillStyle = C.axis;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("HALT", l + haltW / 2, cy + 0.5);
      });
      ctx.restore();

      // State ribbon: one run per state
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(0, g.band, right, G.band, G.band / 2);
      ctx.clip();
      ctx.fillStyle = alpha(C.neutral, 0.1);
      ctx.fillRect(0, g.band, right, G.band);
      for (let i = first; i < points.length - 1; i++) {
        const hue = continuous(i) ? stateColor(points[i].state) : null;
        let j = i + 1;
        while (j < points.length - 1 && continuous(j) && stateColor(points[j].state) === hue) j++;
        if (hue) {
          ctx.fillStyle = hue;
          ctx.fillRect(Math.max(0, x(points[i].t)), g.band, x(points[j].t) - Math.max(0, x(points[i].t)), G.band);
        }
        i = j - 1;
      }
      haltSpans.forEach((s) => {
        ctx.fillStyle = C.bg;
        ctx.fillRect(s.l, g.band, s.r - s.l, G.band);
        ctx.fillStyle = alpha(C.neutral, BB_STATE_ALPHA.halted);
        ctx.fillRect(s.l, g.band, s.r - s.l, G.band);
      });
      ctx.restore();

      // Crosshair target (magnet: the nearest point)
      const h = hover == null ? null : clampTo(hover, first, points.length - 1);
      const hp = h == null ? null : points[h];
      ctx.font = `600 10.5px ${MONO}`;
      const hoverTime = hp && ET_HMS.format(hp.t);
      const timeChip = hp && (() => {
        const w = ctx.measureText(hoverTime).width + 14;
        return { l: clampTo(x(hp.t) - w / 2, 0, right - w), w };
      })();

      // Axes: background, borders, value labels, live tags, time labels
      ctx.fillStyle = C.bg;
      ctx.fillRect(right, 0, W - right, H);
      ctx.fillRect(0, timeTop, W, H - timeTop);
      ctx.strokeStyle = C.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(crisp(right), 0);
      ctx.lineTo(crisp(right), timeTop);
      ctx.moveTo(0, crisp(timeTop));
      ctx.lineTo(W, crisp(timeTop));
      ctx.stroke();

      const tags = spreadTags([{ y: ly, text: fmtScore(last.c), bg: tone }, ...(priceTag ? [priceTag] : [])], top - G.pad + G.tag / 2, floor - G.tag / 2, G.tag + 2);
      const blocked = [...tags.map((tag) => tag.y), ...(hp ? [y(hp.c)] : [])];
      let lastLabel = -Infinity;
      BB_AXIS.forEach(([v, text]) => {
        const ly2 = y(v);
        if (blocked.some((b) => Math.abs(b - ly2) < G.tag / 2 + 7) || ly2 - lastLabel < 14) return;
        lastLabel = ly2;
        const side = Math.abs(v) === 100;
        ctx.font = side ? `700 9px ${MONO}` : `500 10.5px ${MONO}`;
        ctx.fillStyle = side ? alpha(v > 0 ? C.bull : C.bear, 0.8) : C.axis;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text, right + G.axisW / 2, ly2);
      });
      tags.forEach((tag) => axisTag(g, tag.y, tag.text, tag.bg, C.ink));

      ctx.font = `500 10.5px ${MONO}`;
      ctx.fillStyle = C.axis;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ticks.forEach((tick) => {
        const text = tickFmt.format(tick.t);
        const w = ctx.measureText(text).width;
        if (tick.x - w / 2 < 2 || tick.x + w / 2 > right - 2) return;
        if (timeChip && tick.x + w / 2 > timeChip.l - 4 && tick.x - w / 2 < timeChip.l + timeChip.w + 4) return;
        ctx.fillText(text, tick.x, timeTop + G.axisH / 2);
      });

      // Crosshair: dashed lines, the point, chips on both axes, hover card
      if (hp) {
        const hx = x(hp.t);
        const hy = y(hp.c);
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = alpha(C.cross, 0.8);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(crisp(hx), 0);
        ctx.lineTo(crisp(hx), timeTop);
        ctx.moveTo(0, crisp(hy));
        ctx.lineTo(right, crisp(hy));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = sideColor(hp.c);
        ctx.strokeStyle = C.bg;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(hx, hy, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        axisTag(g, clampTo(hy, top - G.pad + G.tag / 2, floor - G.tag / 2), fmtScore(hp.c), C.chip, C.chipText);
        ctx.fillStyle = C.chip;
        ctx.beginPath();
        ctx.roundRect(timeChip.l, timeTop + 2, timeChip.w, G.axisH - 4, 3);
        ctx.fill();
        ctx.fillStyle = C.chipText;
        ctx.font = `600 10.5px ${MONO}`;
        ctx.fillText(hoverTime, timeChip.l + timeChip.w / 2, timeTop + G.axisH / 2 + 0.5);
        showTip(g, hp);
      } else tip.hidden = true;

      canvas.setAttribute("aria-label", `${ticker()} Bull vs. Bear: ${status.label}, control ${fmtScore(last.c)}. ${status.detail}`);
    };

    // Hover card beside the cursor (on the point, from the keyboard)
    const placeTip = (g, p) => placeChartTip(tip, g.x(p.t), pointerY ?? g.y(p.c), g.right, g.floor);

    const showTip = (g, p) => {
      const row = (label, value, sign = "") => `<dt>${label}</dt><dd${sign ? ` data-sign="${sign}"` : ""}>${value}</dd>`;
      const here = data.alerts.filter((a) => a.t === p.t);
      const session = p.session === "pre" ? "Pre-market" : p.session === "post" ? "After hours" : "";
      tip.innerHTML = `
        <p class="chart-tip__time">${ET_HMS.format(p.t)} ET${session ? `<span>${session}</span>` : ""}</p>
        ${p.state ? `<p class="chart-tip__state" data-tone="${bbTone(p.state.key, p.state.side)}">${p.state.label}</p>` : ""}
        <dl>
          ${row("Control", fmtScore(p.c), signOf(p.c / 100))}
          ${row("Alert flow", fmtScore(p.alerts * 100), signOf(p.alerts))}
          ${row("Volume flow", fmtScore(p.tape * 100), signOf(p.tape))}
          ${row("Price trend", fmtScore(p.trend * 100), signOf(p.trend))}
          ${row("Participation", `${p.part.toFixed(1)}x`)}
          ${row("Price", fmtPrice(p.price))}
        </dl>
        ${here.map((a) => `<p class="chart-tip__alert"><b data-tone="${a.side > 0 ? "bull" : "bear"}">${a.side > 0 ? "▲" : "▼"}</b>${a.side > 0 ? "Buying" : "Selling"} Pressure · ${fmtMult(a.vol / 100)}</p>`).join("")}`;
      tip.hidden = false;
      placeTip(g, p);
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; draw(); });
    };
    const render = () => {
      renderHead();
      schedule();
    };

    const resize = () => {
      const { width, height } = chartBox(box);
      const dpr = window.devicePixelRatio || 1;
      W = Math.floor(width);
      H = Math.floor(height);
      canvas.width = Math.max(1, Math.round(W * dpr));
      canvas.height = Math.max(1, Math.round(H * dpr));
      readSizes();
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      draw();
    };
    new ResizeObserver(resize).observe(box);
    // A copy dragged to a screen with another pixel ratio redraws sharp.
    const watchDpr = () => matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener("change", () => { resize(); watchDpr(); }, { once: true });
    watchDpr();
    document.fonts?.ready.then(schedule);

    /* Crosshair: pointer or keyboard */
    const setHover = (i) => {
      if (i === hover) return;
      hover = i;
      schedule();
    };
    const nearest = (px) => {
      const t = geo.start + (px / geo.usable) * (geo.end - geo.start);
      const pts = data.points;
      let i = indexAt(pts, t);
      if (pts[i + 1] && pts[i + 1].t - t < t - pts[i].t) i += 1;
      return Math.max(geo.first, i);
    };
    const track = (e) => {
      if (!geo) return;
      const { x: px, y } = chartPoint(canvas, e);
      pointerY = y;
      const next = px < geo.right ? nearest(px) : null;
      // Same point: only the card follows the cursor, no redraw
      if (next !== null && next === hover && !tip.hidden) placeTip(geo, data.points[next]);
      else setHover(next);
    };
    canvas.addEventListener("pointermove", track);
    canvas.addEventListener("pointerdown", track);
    canvas.addEventListener("pointerleave", () => setHover(null));
    canvas.addEventListener("blur", () => setHover(null));
    canvas.addEventListener("keydown", (e) => {
      if (!geo) return;
      pointerY = null;
      const lastIndex = data.points.length - 1;
      const from = hover ?? lastIndex;
      const jump = e.shiftKey ? 60e3 / BB_LOT : 1;
      const next = { ArrowLeft: from - jump, ArrowRight: from + jump, Home: geo.first, End: lastIndex, Escape: null }[e.key];
      if (next === undefined) return;
      e.preventDefault();
      setHover(next === null ? null : clampTo(next, geo.first, lastIndex));
    });

    /* Controls: price toggle and visible window (the live point stays at the right edge) */
    const syncControls = () => {
      windowBtns.forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.bbWindow) === bbPrefs.window)));
      priceBtn.setAttribute("aria-pressed", String(bbPrefs.price));
    };
    windowBtns.forEach((b) => b.addEventListener("click", () => {
      bbPrefs.window = Number(b.dataset.bbWindow);
      saveBbPrefs();
      syncControls();
      schedule();
    }));
    priceBtn.addEventListener("click", () => {
      bbPrefs.price = !bbPrefs.price;
      saveBbPrefs();
      syncControls();
      schedule();
    });
    symbol.addEventListener("input", () => {
      hover = null;
      render();
    });
    syncControls();
    render();

    return {
      // The whole day (a new page, or a copy's snapshot)
      load: (dump) => {
        data = dump && { points: dump.points.slice(), alerts: dump.alerts.slice(), halts: dump.halts, status: dump.status, summary: dump.summary };
        hover = null;
        render();
      },
      // One live update: new points and alerts, the Halts, status and summary
      push: (u) => {
        if (!data) return;
        data.points.push(...u.points);
        data.alerts.push(...u.alerts);
        Object.assign(data, { halts: u.halts, status: u.status, summary: u.summary });
        render();
      },
      // Window / price saved in another window
      reload: () => {
        loadBbPrefs();
        syncControls();
        schedule();
      },
    };
  };

  /* ---- Key levels: support and resistance ----------------------------------
     The monitor's algorithm (see KEY_LEVELS.md) run in the browser on the
     mock GXAI day. Up to 3 resistances above the last price and 3 supports
     below: the strongest and closest, each on a round (psychological) price.
     1. Grid: the first rung of 0.01 · 0.05 · 0.10 · 0.25 · 0.50 · 1 · 5 …
        at or above max(1.5 % of the price, the day's range / 15).
     2. Volume profile: each update's volume at the price it traded, in bins
        of ¼ grid smoothed with a Gaussian (σ = 1.5 bins): the POC and the
        high-volume nodes (peaks of 15 % prominence). Time at price when
        there is no volume.
     3. Swing highs and lows: peaks of the price with a prominence of
        max(0.6 grid, 4 % of the range), 8 updates apart.
     4. References: day High / Low, each session's High / Low (once the day
        has more than one), Prev Close, Open, the regular Close (after
        hours) and the Buying / Selling Pressure alerts' prices.
     Each candidate snaps to the roundest price within half a grid. Score:
     volume share × 3, POC 1.5, HVN 1, 1 per touch (≤ 4), the references,
     0.6 per alert (≤ 3) and 0.35 per round rung; a level needs 1.2 without
     the roundness. Ranked by score × e^(−1.5 × distance), 1.5 grids apart;
     strength 1–3 against the strongest one picked. Needs 20 updates. */

  const KL_LADDER = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 5, 10, 25, 50, 100, 250, 500];
  const KL_MIN_SAMPLES = 20;
  const KL_GAP = 120e3;              // longer without an update: no volume attributed, line breaks
  const KL_PER_SIDE = 3;
  const KL_SEPARATION = 1.5;         // grids between two levels of the same side
  const KL_WEIGHTS = { volume: 3, poc: 1.5, hvn: 1, touch: 1, day: 1.5, session: 1.2, prevClose: 1, open: 0.8, close: 1, alert: 0.6, round: 0.35 };
  const KL_MIN_EVIDENCE = 1.2;
  const KL_SESSIONS = { pre: "premarket", rm: "regular", post: "postmarket" };

  const klGrid = (price, range) => KL_LADDER.find((s) => s >= Math.max(price * 0.015, range / 15) - 1e-12) ?? KL_LADDER[KL_LADDER.length - 1];
  const isMultiple = (v, step) => Math.abs(v / step - Math.round(v / step)) < 1e-6;
  const klRoundness = (level, step) => KL_LADDER.filter((r) => r >= step - 1e-12 && isMultiple(level, r)).length;
  // The roundest price within half a grid; else the nearest grid multiple (grid 0.05: 1.52 → 1.50, 1.62 → 1.60).
  const klSnap = (v, step) => {
    for (let i = KL_LADDER.length - 1; i >= 0 && KL_LADDER[i] > step + 1e-12; i--) {
      const c = Math.round(v / KL_LADDER[i]) * KL_LADDER[i];
      if (c > 0 && Math.abs(c - v) <= step * 0.5 + 1e-12) return round(c, 4);
    }
    return round(Math.max(step, Math.round(v / step) * step), 4);
  };

  // scipy.signal.find_peaks: local maxima (a flat top counts once, at its
  // middle); of two closer than `distance`, the higher stays; then the
  // ones that stand out by `prominence`.
  const findPeaks = (x, prominence, distance = 1) => {
    const n = x.length;
    let peaks = [];
    for (let i = 1; i < n - 1; i++) {
      if (!(x[i - 1] < x[i])) continue;
      let ahead = i + 1;
      while (ahead < n - 1 && x[ahead] === x[i]) ahead++;
      if (x[ahead] < x[i]) { peaks.push((i + ahead - 1) >> 1); i = ahead; }
    }
    if (distance > 1 && peaks.length > 1) {
      const keep = peaks.map(() => true);
      const order = peaks.map((_, k) => k).sort((a, b) => x[peaks[b]] - x[peaks[a]]);
      order.forEach((j) => {
        if (!keep[j]) return;
        for (let k = j - 1; k >= 0 && peaks[j] - peaks[k] < distance; k--) keep[k] = false;
        for (let k = j + 1; k < peaks.length && peaks[k] - peaks[j] < distance; k++) keep[k] = false;
      });
      peaks = peaks.filter((_, k) => keep[k]);
    }
    return peaks.filter((p) => {
      let left = x[p];
      for (let i = p; i >= 0 && x[i] <= x[p]; i--) left = Math.min(left, x[i]);
      let right = x[p];
      for (let i = p; i < n && x[i] <= x[p]; i++) right = Math.min(right, x[i]);
      return x[p] - Math.max(left, right) >= prominence;
    });
  };

  // scipy.ndimage.gaussian_filter1d (mode "constant", truncated at 4 σ)
  const gaussianSmooth = (values, sigma) => {
    const radius = Math.floor(4 * sigma + 0.5);
    const kernel = Array.from({ length: 2 * radius + 1 }, (_, k) => Math.exp(-0.5 * ((k - radius) / sigma) ** 2));
    const norm = kernel.reduce((a, b) => a + b, 0);
    return values.map((_, i) => kernel.reduce((sum, w, k) => sum + w * (values[i + k - radius] ?? 0), 0) / norm);
  };

  // samples: Top List updates { t, p, v (its volume), s: "pre" | "rm" | "post" };
  // refs: { prevClose, open, close }; alerts: Pressure alerts { price, side }.
  const computeKeyLevels = (samples, refs, alerts) => {
    const n = samples.length;
    if (n < KL_MIN_SAMPLES) return { price: n ? samples[n - 1].p : null, step: null, levels: [] };
    const prices = samples.map((s) => s.p);
    const last = prices[n - 1];
    const high = Math.max(...prices);
    const low = Math.min(...prices);
    const step = klGrid(last, high - low);
    const tol = step / 2; // each pivot, alert or volume bin counts for one level only

    // Volume between two updates, at the price in between; none across a
    // session change or a gap. Without volume: time at price.
    let volume = samples.map((s, i) => (i && s.v != null && s.s === samples[i - 1].s && s.t - samples[i - 1].t <= KL_GAP ? Math.max(0, s.v) : 0));
    let total = volume.reduce((a, b) => a + b, 0);
    if (total <= 0) { volume = volume.map(() => 1); total = n; }
    const traded = prices.map((p, i) => (i ? (p + prices[i - 1]) / 2 : p));
    const bw = step / 4;
    const start = low - step;
    const bins = Math.max(1, Math.ceil((high - low + 2 * step + bw) / bw - 1e-9) - 1);
    const center = (i) => start + (i + 0.5) * bw;
    const hist = new Array(bins).fill(0);
    traded.forEach((p, i) => { hist[clampTo(Math.floor((p - start) / bw), 0, bins - 1)] += volume[i]; });
    const smooth = gaussianSmooth(hist, 1.5);
    let top = 0;
    smooth.forEach((v, i) => { if (v > smooth[top]) top = i; });
    const hvns = findPeaks(smooth, smooth[top] * 0.15).map(center);
    const prominence = Math.max(step * 0.6, (high - low) * 0.04);
    const swings = [...findPeaks(prices, prominence, 8), ...findPeaks(prices.map((p) => -p), prominence, 8)].map((i) => prices[i]);

    const candidates = new Map(); // level → { sources, evidence }
    const add = (value, source, weight = 0) => {
      if (!(value > 0) || !Number.isFinite(value)) return;
      const level = klSnap(value, step);
      if (!candidates.has(level)) candidates.set(level, { sources: new Set(), evidence: 0 });
      const c = candidates.get(level);
      if (!c.sources.has(source)) { c.sources.add(source); c.evidence += weight; }
    };
    add(center(top), "poc", KL_WEIGHTS.poc);
    hvns.forEach((v) => add(v, "hvn", KL_WEIGHTS.hvn));
    swings.forEach((v) => add(v, "pivot"));
    add(high, "day_high", KL_WEIGHTS.day);
    add(low, "day_low", KL_WEIGHTS.day);
    const present = Object.keys(KL_SESSIONS).filter((code) => samples.some((s) => s.s === code));
    if (present.length > 1) present.forEach((code) => {
      const ps = samples.filter((s) => s.s === code).map((s) => s.p);
      add(Math.max(...ps), `${KL_SESSIONS[code]}_high`, KL_WEIGHTS.session);
      add(Math.min(...ps), `${KL_SESSIONS[code]}_low`, KL_WEIGHTS.session);
    });
    add(refs.prevClose, "prev_close", KL_WEIGHTS.prevClose);
    add(refs.open, "open", KL_WEIGHTS.open);
    add(refs.close, "close", KL_WEIGHTS.close);
    alerts.forEach((a) => add(a.price, a.side > 0 ? "buying_pressure" : "selling_pressure"));

    const shares = new Map([...candidates.keys()].map((level) => [level, hist.reduce((sum, v, i) => sum + (Math.abs(center(i) - level) <= tol ? v : 0), 0) / total]));
    const maxShare = Math.max(0, ...shares.values()) || 1;
    const scale = Math.max(high - low, last * 0.03, step);
    const levels = [];
    candidates.forEach((c, level) => {
      const near = (v) => Math.abs(v - level) <= tol;
      const touches = swings.filter(near).length;
      const buying = alerts.filter((a) => a.side > 0 && near(a.price)).length;
      const selling = alerts.filter((a) => a.side < 0 && near(a.price)).length;
      const share = shares.get(level);
      const evidence = c.evidence + (KL_WEIGHTS.volume * share) / maxShare + KL_WEIGHTS.touch * Math.min(touches, 4) + KL_WEIGHTS.alert * Math.min(buying + selling, 3);
      if (evidence < KL_MIN_EVIDENCE) return;
      const score = evidence + KL_WEIGHTS.round * klRoundness(level, step);
      levels.push({
        price: level, type: level >= last ? "resistance" : "support", score: round(score, 3),
        rank: score * Math.exp((-1.5 * Math.abs(level - last)) / scale),
        touches, volumeShare: round(share, 4), buying, selling, sources: [...c.sources].sort(),
      });
    });

    const picked = [];
    ["resistance", "support"].forEach((type) => {
      const chosen = [];
      levels.filter((l) => l.type === type).sort((a, b) => b.rank - a.rank).forEach((l) => {
        if (chosen.length < KL_PER_SIDE && chosen.every((o) => Math.abs(l.price - o.price) >= step * KL_SEPARATION - 1e-9)) chosen.push(l);
      });
      picked.push(...chosen);
    });
    const best = Math.max(...picked.map((l) => l.score));
    picked.forEach((l) => {
      l.strength = l.score / best >= 0.75 ? 3 : l.score / best >= 0.45 ? 2 : 1;
      delete l.rank;
    });
    return { price: last, step, levels: picked.sort((a, b) => b.price - a.price) };
  };

  /* ---- Key levels chart -----------------------------------------------------
     TradingView-style price chart on a canvas, one bar per 15 s, 1 or
     5 minutes (the last price of each; the feed has no real OHLC):
     - price as a line with an area fading down; VWAP dashed and neutral;
       volume in a pane of its own, neutral (brighter when the bar rose);
     - support (green) and resistance (red) as thin lines across the plot,
       stronger the stronger the level, with their value on the line at the
       right edge ("R 3.00"), not on the axis; the live bar never passes the
       left edge of that column, so the history scrolls left from there;
     - the nearest levels pull the scale in when within half the visible
       range; farther ones never squash the curve;
     - alerts on the curve (menu Alerts): New HoD white triangle over it,
       Buying / Selling Pressure dot on the price with a halo by Vol. 1m,
       Halt / Resume gray square with an amber H / green R, stacked off the curve with a guide;
     - High / Low of the visible bars, labeled with a short stem;
     - Halts and gaps over 2 minutes: the line goes on in gray (the time
       axis skips them); pre-market / after hours shaded;
     - right axis: price labels, last price tag (green / red by the day's
       change), VWAP tag, top volume of the pane.
     Nothing overlaps: markers take their place first (Halt/Resume, New HoD,
     Pressure by Vol. 1m), then the High / Low labels move away from them,
     then the level values; whatever finds no room is left out. Axis labels
     give way to the tags and chips, tags push each other apart, time labels
     keep their width apart.
     Crosshair: snaps to a bar, the horizontal line follows the cursor; chips
     on both axes and the hover card beside the cursor. Wheel zooms around
     the cursor, drag (or Shift + wheel) pans, double-click goes back live.
     Keyboard on the canvas: ←/→ bar by bar (Shift: 10), Home/End, +/− zoom,
     Esc. The head says where the price stands against its levels.
     Interval, S/R and alert types are saved in localStorage. */

  const KL_KEY = "scanner:key-levels:v1";
  const KL_INTERVALS = [15e3, 60e3, 300e3];
  const KL_KINDS = ["hod", "buying", "selling", "halts"];
  const KL_ZOOM = { min: 3, max: 42 };     // bar spacing (px)
  const KL_ANCHOR_GAP = 14;                 // live bar ↔ level values
  const KL_LABEL_H = 12;                    // box of a label drawn in the plot
  const KL_MARK_GAP = 2;
  const KL_PRIORITY = { halt: 4, resume: 4, hod: 3, buying: 2, selling: 2 };
  const KL_ALERT_WINS = 15e3;               // an alert's price beats a later update this long (live bar)
  const KL_HOD_EVERY = 180e3;               // mock New HoD: a new high, once every 3 minutes at most
  const KL_BREAK_WINDOW = 300e3;            // a level crossed this recently: breakout / breakdown
  const KL_TIME_STEPS = [15e3, 30e3, 60e3, 120e3, 300e3, 600e3, 900e3, 1800e3, 3600e3, 7200e3];
  const KL_SOURCES = {
    poc: "POC", hvn: "volume node", day_high: "day high", day_low: "day low", premarket_high: "pre-market high",
    premarket_low: "pre-market low", regular_high: "regular high", regular_low: "regular low",
    postmarket_high: "after-hours high", postmarket_low: "after-hours low", prev_close: "prev. close", open: "open", close: "close",
  };
  const KL_STATES = {
    warming_up: ["Warming up", "neutral"], none: ["No clear levels", "neutral"], between: ["Between levels", "neutral"],
    test_r: ["Testing resistance", "neutral"], test_s: ["Testing support", "neutral"],
    breakout: ["Breaking out", "bull"], breakdown: ["Breaking down", "bear"],
    no_r: ["No resistance above", "bull"], no_s: ["No support below", "bear"],
  };
  const KL_STAT_TITLES = {
    vwap: "Volume-weighted average price of the day",
    slope: "Linear regression of VWAP over the last 5 minutes, in % of VWAP per minute",
    high: "High of the day (pre-market included)",
    low: "Low of the day (pre-market included)",
    open: "First price of the regular session",
    prev: "Previous close",
  };

  const klPrefs = { interval: 60e3, levels: true, alerts: [...KL_KINDS] };
  const loadKlPrefs = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(KL_KEY) || "{}");
      klPrefs.interval = KL_INTERVALS.includes(saved.interval) ? saved.interval : 60e3;
      klPrefs.levels = typeof saved.levels === "boolean" ? saved.levels : true;
      klPrefs.alerts = Array.isArray(saved.alerts) ? KL_KINDS.filter((k) => saved.alerts.includes(k)) : [...KL_KINDS];
    } catch { /* ignore */ }
  };
  const saveKlPrefs = () => {
    try { localStorage.setItem(KL_KEY, JSON.stringify(klPrefs)); } catch { /* ignore */ }
  };
  loadKlPrefs();

  const priceDp = (v) => (v >= 1 ? 2 : 4);
  const fmtAt = (v, dp) => v.toFixed(dp);
  const niceStep = (raw) => {
    if (!(raw > 0)) return 1;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const f = raw / mag;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
  };

  const mountKeyLevels = (view, root) => {
    const box = view.querySelector(".chart-canvas");
    const canvas = box.querySelector("canvas");
    const tip = box.querySelector(".chart-tip");
    const note = box.querySelector(".chart-message");
    const ctx = canvas.getContext("2d");
    const symbol = root.querySelector(".chart-symbol__input");
    const pill = view.querySelector(".chart-state");
    const since = view.querySelector(".chart-since");
    const detail = view.querySelector(".chart-head__detail");
    const meter = view.querySelector(".chart-meter");
    const thumb = meter.querySelector(".chart-meter__thumb");
    const score = meter.querySelector(".chart-meter__score");
    const supportLabel = meter.querySelector(".chart-meter__label[data-side='bull']");
    const resistanceLabel = meter.querySelector(".chart-meter__label[data-side='bear']");
    const stats = view.querySelector(".chart-stats");
    const legendLevels = [...view.querySelectorAll(".chart-key[data-key='support'], .chart-key[data-key='resistance']")].map((k) => k.parentElement);
    const levelsBtn = view.querySelector("[data-kl-levels]");
    const intervalBtns = [...view.querySelectorAll("[data-kl-interval]")];
    const menuBtn = view.querySelector("[data-kl-alerts]");
    const menuWrap = menuBtn.parentElement;
    const menu = view.querySelector(".chart-menu-list");
    const menuItems = [...menu.querySelectorAll("[data-kl-alert]")];
    const intro = detail.textContent;

    // Tokens → canvas colors
    const rootCss = getComputedStyle(document.documentElement);
    const color = (name, fallback) => chartColor(ctx, rootCss, name, fallback);
    const C = {
      bg: color("--chart-bg", "#08090b"),
      grid: color("--chart-grid", "#14181e"),
      bull: color("--chart-bull", "#c8ff38"),
      bear: color("--chart-bear", "#ff4f6b"),
      neutral: color("--chart-neutral", "#5d6673"),
      price: color("--chart-price", "#4cc9ff"),
      vwap: color("--chart-vwap", "#b4bbc6"),
      volume: color("--chart-volume", "#7b8492"),
      support: color("--chart-support", "#c8ff38"),
      resistance: color("--chart-resistance", "#ff4f6b"),
      hod: color("--chart-hod", "#f2f4f7"),
      haltInk: color("--chart-halt-ink", "#ffb84d"),
      resumeInk: color("--chart-resume-ink", "#c8ff38"),
      axis: color("--chart-axis-text", "#7b8492"),
      cross: color("--chart-crosshair", "#7b8492"),
      chip: color("--chart-chip", "#1f242c"),
      chipText: color("--text", "#f2f4f7"),
      ink: color("--chart-ink", "#0a0f00"),
      mark: color("--chart-watermark", "#12151a"),
      session: color("--chart-session", "#12151a"),
      line: color("--line", "#23282f"),
    };
    const SANS = rootCss.getPropertyValue("--font-sans").trim() || "sans-serif";
    const MONO = rootCss.getPropertyValue("--font-mono").trim() || "monospace";
    const alpha = chartAlpha;
    const levelColor = (l) => (l.type === "support" ? C.support : C.resistance);
    const markColor = (kind) => ({ hod: C.hod, buying: C.bull, selling: C.bear }[kind] ?? C.chip);
    const LEVEL_FONT = `700 10px ${MONO}`;

    // Strengths and sizes, read from the box: a narrow stage may override them.
    let A = {};
    let G = {};
    const readSizes = () => {
      const css = getComputedStyle(box);
      const num = (name, fallback) => {
        const v = parseFloat(css.getPropertyValue(name));
        return Number.isFinite(v) ? v : fallback;
      };
      A = {
        area: num("--chart-price-area-a", 0.16), vwap: num("--chart-vwap-a", 0.7), level: num("--chart-level-a", 0.3),
        levelStep: num("--chart-level-step-a", 0.15), volUp: num("--chart-volume-a", 0.4), volDown: num("--chart-volume-down-a", 0.2),
        session: num("--chart-session-a", 0.6),
      };
      G = {
        axisW: num("--chart-axis-w", 52), axisH: num("--chart-axis-h", 20), pad: num("--chart-pad", 10), live: num("--chart-live-pad", 28),
        tag: num("--chart-tag-h", 18), bar: num("--chart-bar-space", 9), volShare: num("--chart-vol-share", 0.2), volMax: num("--chart-vol-max", 90),
        paneGap: num("--chart-pane-sep", 10), labelRoom: num("--chart-label-room", 26), markRoom: num("--chart-marker-room", 20),
      };
    };
    readSizes();

    let samples = [];   // Top List updates { t, p, v, w, s }
    let pressure = [];  // Buying / Selling Pressure alerts { t, side, vol, price }
    let halts = [];
    let marks = [];     // alerts on the curve { t, kind, price, vol, i }
    let result = { price: null, step: null, levels: [] };
    let head = null;    // state against the levels
    let bars = [];
    let W = 0;
    let H = 0;
    let frame = 0;
    let geo = null;
    let spacing = G.bar;
    let offset = 0;     // bars between the last bar and the right edge (fractional)
    let follow = true;  // live: the last bar stays at the anchor
    let hover = null;   // { i, y } (y null: keyboard)
    let drag = null;

    const ticker = () => symbol.value.trim().toUpperCase();
    const message = () => {
      const sym = ticker();
      if (!sym) return "Type a ticker to see its key levels.";
      if (sym !== BB_SYM) return `Mock data covers ${BB_SYM} only for now: type ${BB_SYM} to see the chart.`;
      if (!bars.length) return `Waiting for ${sym} in the Top List feed…`;
      return "";
    };
    const shown = () => (klPrefs.levels ? result.levels : []);
    const enabled = (kind) => klPrefs.alerts.includes(kind === "halt" || kind === "resume" ? "halts" : kind);

    /* Data: Top List updates, alerts on the curve, bars, levels, head state */
    const sampleOf = (p) => ({ t: p.t, p: p.price, v: p.vol, w: p.vwap, s: p.session === "pre" ? "pre" : p.session === "post" ? "post" : "rm" });
    const references = () => {
      const open = samples.find((s) => s.s === "rm");
      const lastRegular = samples.findLast((s) => s.s === "rm");
      return { prevClose: BB_PREV_CLOSE, open: open?.p, close: samples[samples.length - 1]?.s === "post" ? lastRegular?.p : undefined };
    };

    // Bar of an instant: the one holding it. In a gap (Halt, off the Top
    // List), a Resume goes to the next bar and the rest to the previous one,
    // when close enough.
    const barOf = (t, kind) => {
      let lo = 0;
      let hi = bars.length - 1;
      let at = -1;
      while (lo <= hi) {
        const m = (lo + hi) >> 1;
        if (bars[m].t <= t) { at = m; lo = m + 1; } else hi = m - 1;
      }
      const iv = klPrefs.interval;
      if (bars[at] && t < bars[at].t + iv) return at;
      if (kind === "resume") return bars[at + 1] && bars[at + 1].t - t <= KL_GAP ? at + 1 : -1;
      return bars[at] && t - (bars[at].t + iv) <= KL_GAP ? at : -1;
    };

    // Bars: the last price in each interval. Short holes (≤ 2 min) repeat
    // the last price so the time axis keeps its pace; a Halt or a longer
    // gap starts a new run (`brk`). A bar holding an alert closes at the
    // alert's price, so its marker sits on the curve; only the live bar
    // lets a Top List update over 15 s later take over again.
    const buildBars = () => {
      const iv = klPrefs.interval;
      const out = [];
      let prev = null;
      samples.forEach((s) => {
        const bucket = Math.floor(s.t / iv) * iv;
        const halted = prev && halts.some((h) => h.start >= prev.t && h.start < s.t);
        const brk = prev && (halted || s.t - prev.t > KL_GAP) ? (halted ? "halt" : "gap") : null;
        let bar = out[out.length - 1];
        if (bar && !brk) for (let t = bar.t + iv; t < bucket; t += iv) out.push((bar = { t, c: bar.c, v: 0, w: bar.w, s: bar.s, lt: bar.lt }));
        if (!bar || bar.t !== bucket) out.push((bar = { t: bucket, c: s.p, v: 0, w: s.w, s: s.s, brk }));
        bar.c = s.p;
        bar.lt = s.t;
        bar.w = s.w;
        bar.s = s.s;
        bar.v += s.v || 0;
        prev = s;
      });
      bars = out;
      const lastBar = out[out.length - 1];
      marks.forEach((m) => {
        m.i = barOf(m.t, m.kind);
        const bar = out[m.i];
        if (!bar || m.t < bar.t || m.t >= bar.t + iv) return;
        if (bar !== lastBar || bar.lt < m.t + KL_ALERT_WINS) bar.c = m.price;
      });
    };

    // Alerts on the curve: Pressure from the feed; New HoD (a regular
    // session high above the day's, every 3 minutes at most) and Halt /
    // Resume derived from the updates.
    const buildMarks = () => {
      const out = pressure.map((a) => ({ t: a.t, kind: a.side > 0 ? "buying" : "selling", price: a.price, vol: a.vol }));
      let high = -Infinity;
      let lastHod = -Infinity;
      samples.forEach((s) => {
        if (s.s === "rm" && s.p > high && Number.isFinite(high) && s.t - lastHod >= KL_HOD_EVERY) {
          out.push({ t: s.t, kind: "hod", price: s.p });
          lastHod = s.t;
        }
        high = Math.max(high, s.p);
      });
      halts.forEach((h) => {
        const before = samples[indexAt(samples, h.start)];
        if (before && before.t <= h.start) out.push({ t: h.start, kind: "halt", price: before.p });
        const after = h.end != null && samples.find((s) => s.t >= h.end);
        if (after) out.push({ t: h.end, kind: "resume", price: after.p });
      });
      marks = out.sort((a, b) => a.t - b.t);
    };

    // Where the price stands against the levels at update `i`
    const stateAt = (i, levels, step) => {
      const p = samples[i].p;
      let above = null;
      let below = null;
      levels.forEach((l) => {
        if (l.price >= p) { if (!above || l.price < above.price) above = l; } else if (!below || l.price > below.price) below = l;
      });
      const crossed = (level, dir) => {
        for (let j = i - 1; j >= 0 && samples[j].t >= samples[i].t - KL_BREAK_WINDOW; j--) {
          if (dir > 0 ? samples[j].p < level : samples[j].p > level) return samples[j + 1].t;
        }
        return 0;
      };
      const base = { above, below, p };
      if (below && p - below.price <= step) {
        const at = crossed(below.price, 1);
        if (at) return { ...base, key: "breakout", level: below, at };
      }
      if (above && above.price - p <= step) {
        const at = crossed(above.price, -1);
        if (at) return { ...base, key: "breakdown", level: above, at };
      }
      if (above && above.price - p <= step * 0.35 && (!below || above.price - p <= p - below.price)) return { ...base, key: "test_r", level: above };
      if (below && p - below.price <= step * 0.35) return { ...base, key: "test_s", level: below };
      if (!above && !below) return { ...base, key: "none" };
      if (!above) return { ...base, key: "no_r" };
      if (!below) return { ...base, key: "no_s" };
      return { ...base, key: "between" };
    };

    // State of the last update and since when it holds (walking back with today's levels)
    const evaluate = () => {
      const n = samples.length;
      if (!n) { head = null; return; }
      if (n < KL_MIN_SAMPLES || !result.step) {
        head = { key: n < KL_MIN_SAMPLES ? "warming_up" : "none", p: samples[n - 1].p, since: samples[0].t };
        return;
      }
      const { levels, step } = result;
      const now = stateAt(n - 1, levels, step);
      const same = (s) => s.key === now.key && s.level?.price === now.level?.price;
      let from = n - 1;
      while (from > 0 && n - from < 1500 && same(stateAt(from - 1, levels, step))) from--;
      head = { ...now, since: now.at ?? samples[from].t };
    };

    const refresh = ({ keepView = true } = {}) => {
      const prevLast = keepView && bars.length ? bars[bars.length - 1].t : null;
      buildMarks();
      buildBars();
      result = computeKeyLevels(samples, references(), pressure);
      evaluate();
      // Bars already on screen keep their place; new ones appear to their right.
      const at = prevLast == null ? -1 : bars.findIndex((b) => b.t === prevLast);
      if (at < 0 || !W) {
        follow = true;
        offset = liveOffset();
      } else offset -= bars.length - 1 - at;
      pin();
    };

    /* View: bar spacing and offset. Live, the series starts at the left
       edge and grows right until the anchor (left of the level values);
       from there the last bar stays put and the history moves left. */
    const plotW = () => Math.max(0, W - G.axisW);
    const anchorX = () => {
      const levels = shown();
      if (!levels.length || !bars.length) return plotW() - G.live;
      const dp = priceDp(bars[bars.length - 1].c);
      ctx.font = LEVEL_FONT;
      const widest = Math.max(...[bars[bars.length - 1].c, ...levels.map((l) => l.price)].map((p) => ctx.measureText(`R ${fmtAt(p, dp)}`).width));
      return plotW() - 6 - widest - KL_ANCHOR_GAP;
    };
    const anchorOffset = () => (plotW() - anchorX() - spacing / 2) / spacing;
    const liveOffset = () => Math.max(anchorOffset(), plotW() / spacing - bars.length);
    const clampOffset = () => {
      const n = bars.length;
      offset = clampTo(offset, -Math.max(0, n - 3), Math.max(anchorOffset(), plotW() / spacing - Math.min(3, Math.max(1, n))));
    };
    const pin = () => {
      if (follow) offset = Math.max(offset, anchorOffset());
      clampOffset();
    };
    const updateFollow = () => { follow = bars.length > 0 && offset >= anchorOffset() - 0.25; };
    const resetView = () => {
      spacing = G.bar;
      follow = true;
      offset = liveOffset();
      clampOffset();
      schedule();
    };

    /* Geometry: price pane on top, volume pane under it, time axis below */
    const stackedIn = (first, last) => marks.some((m) => (m.kind === "hod" || m.kind === "halt" || m.kind === "resume") && enabled(m.kind) && m.i >= first && m.i <= last);
    const geometry = () => {
      const right = plotW();
      const timeTop = H - G.axisH;
      const volH = Math.round(Math.min(G.volMax, Math.max(24, timeTop - G.pad) * G.volShare));
      const volTop = timeTop - volH;
      const top = G.pad;
      const bottom = Math.max(top + 30, volTop - G.paneGap);
      const n = bars.length;
      const x = (i) => right - (n - 1 - i + offset) * spacing - spacing / 2;
      const first = clampTo(Math.floor(n - 1 + offset - right / spacing), 0, n - 1);
      const last = clampTo(Math.ceil(n - 1 + offset), first, n - 1);
      let lo = Infinity;
      let hi = -Infinity;
      let maxVol = 0;
      for (let i = first; i <= last; i++) {
        const b = bars[i];
        lo = Math.min(lo, b.c, b.w ?? Infinity);
        hi = Math.max(hi, b.c, b.w ?? -Infinity);
        maxVol = Math.max(maxVol, b.v);
      }
      // The nearest resistance and support join the scale when within half
      // the visible range; farther ones never squash the curve.
      const range = hi - lo;
      const levels = shown();
      const nearR = Math.min(...levels.filter((l) => l.type === "resistance").map((l) => l.price));
      const nearS = Math.max(...levels.filter((l) => l.type === "support").map((l) => l.price));
      if (nearR > hi && nearR - hi <= range * 0.5) hi = nearR;
      if (nearS < lo && lo - nearS <= range * 0.5) lo = nearS;
      if (hi - lo < Math.max(Math.abs(hi) * 0.004, 0.0004)) {
        const mid = (hi + lo) / 2;
        const half = Math.max(Math.abs(mid) * 0.004, 0.0004);
        lo = mid - half;
        hi = mid + half;
      }
      // Room for the High / Low labels, plus the stacked markers when any is
      // in view; never over 30 % of the pane, so a short chart keeps its curve.
      const span = bottom - top;
      const room = Math.min(G.labelRoom + (stackedIn(first, last) ? G.markRoom : 0), span * 0.3);
      const padP = (hi - lo) * Math.max(0.08, room / Math.max(1, span - 2 * room));
      lo -= padP;
      hi += padP;
      return {
        right, timeTop, volTop, volH, top, bottom, first, last, lo, hi, maxVol, x,
        y: (p) => bottom - ((p - lo) / (hi - lo)) * span,
        priceAt: (py) => lo + ((bottom - py) / span) * (hi - lo),
        yVol: (v) => timeTop - (maxVol > 0 ? (v / maxVol) * (volH - 2) : 0),
        volAt: (py) => ((timeTop - py) / (volH - 2)) * maxVol,
      };
    };

    const axisTag = (g, y, text, bg, ink) => {
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.roundRect(g.right + 3, y - G.tag / 2, G.axisW - 6, G.tag, 3);
      ctx.fill();
      ctx.fillStyle = ink;
      ctx.font = `700 10.5px ${MONO}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, g.right + G.axisW / 2, y + 0.5);
    };
    const overlaps = (a, b, gap = 4) => a.left < b.right + gap && b.left < a.right + gap && a.top < b.bottom + gap && b.top < a.bottom + gap;

    // Top and bottom of the curve between two x: stacked markers go off the
    // line, not only off their own point.
    const curveBetween = (g, left, right) => {
      let top = Infinity;
      let bottom = -Infinity;
      const take = (y) => { top = Math.min(top, y); bottom = Math.max(bottom, y); };
      for (let i = g.first; i <= g.last; i++) {
        const x0 = g.x(i);
        const y0 = g.y(bars[i].c);
        if (x0 >= left && x0 <= right) take(y0);
        if (i === g.last) continue;
        const x1 = g.x(i + 1);
        const y1 = g.y(bars[i + 1].c);
        [left, right].forEach((edge) => { if (edge > x0 && edge < x1) take(y0 + ((edge - x0) / (x1 - x0)) * (y1 - y0)); });
      }
      return { top, bottom };
    };

    // Alert markers (see the section comment). Returns their boxes.
    const drawMarks = (g) => {
      const groups = new Map();
      marks.forEach((m) => {
        if (!enabled(m.kind) || m.i < g.first || m.i > g.last) return;
        const key = `${m.i}|${m.kind}`;
        const group = groups.get(key);
        // The latest sets the price; the halo takes the largest Vol. 1m
        if (!group) groups.set(key, { i: m.i, kind: m.kind, price: m.price, vol: m.vol ?? 0 });
        else { group.price = m.price; group.vol = Math.max(group.vol, m.vol ?? 0); }
      });
      if (!groups.size) return [];
      // The halo's scale is the day's, so it does not change while panning
      const maxVol = pressure.reduce((m, a) => Math.max(m, a.vol), 0);
      const placed = [];
      const drawn = [];
      const fits = (b) => b.left >= 0 && b.right <= g.right && b.top >= g.top - 8 && b.bottom <= g.bottom + 8 && !placed.some((o) => overlaps(b, o, KL_MARK_GAP));
      [...groups.values()]
        .sort((a, b) => KL_PRIORITY[b.kind] - KL_PRIORITY[a.kind] || b.vol - a.vol || b.i - a.i)
        .forEach((m) => {
          const x = Math.round(g.x(m.i));
          const y = g.y(m.price);
          if (m.kind === "buying" || m.kind === "selling") {
            // The dot marks the exact price: it never moves, and waits for a zoom if it does not fit
            const r = 3.5;
            const b = { left: x - r, right: x + r, top: y - r, bottom: y + r };
            if (!fits(b)) return;
            placed.push(b);
            drawn.push({ ...m, x, y, r, glow: m.vol > 0 && maxVol > 0 ? 2 + 9 * Math.sqrt(m.vol / maxVol) : 3, box: b });
            return;
          }
          const size = m.kind === "hod" ? { w: 10, h: 9 } : { w: 13, h: 13 };
          const curve = curveBetween(g, x - size.w / 2 - 2, x + size.w / 2 + 2);
          const lane = size.h + KL_MARK_GAP + 1;
          let above = null;
          let below = null;
          for (let k = 0; k < 6 && !above; k++) {
            const b = Math.min(y, curve.top) - 6 - k * lane;
            const box = { left: x - size.w / 2, right: x + size.w / 2, top: b - size.h, bottom: b };
            if (fits(box)) above = box;
          }
          for (let k = 0; k < 6 && !below; k++) {
            const t = Math.max(y, curve.bottom) + 6 + k * lane;
            const box = { left: x - size.w / 2, right: x + size.w / 2, top: t, bottom: t + size.h };
            if (fits(box)) below = box;
          }
          // New HoD goes over the curve when it fits; Halt / Resume to the closer side
          const up = Boolean(above) && (!below || m.kind === "hod" || y - above.bottom <= below.top - y + lane);
          const box = up ? above : below;
          if (!box) return;
          placed.push(box);
          drawn.push({ ...m, x, y, box, up });
        });

      // Three passes: dots, guides, then triangles and squares, so no guide crosses an icon
      drawn.filter((m) => m.r).forEach((m) => {
        const hue = markColor(m.kind);
        ctx.fillStyle = alpha(hue, 0.14);
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.r + m.glow, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = alpha(hue, 0.3);
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.r + Math.min(3, m.glow), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = hue;
        ctx.strokeStyle = C.bg;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });
      const icons = drawn.filter((m) => !m.r);
      ctx.lineWidth = 1;
      icons.forEach((m) => {
        const end = m.up ? m.box.bottom : m.box.top;
        if (Math.abs(end - m.y) <= 3) return;
        ctx.strokeStyle = alpha(m.kind === "hod" ? C.hod : C.axis, 0.45);
        ctx.beginPath();
        ctx.moveTo(m.x + 0.5, m.y + (m.up ? -2 : 2));
        ctx.lineTo(m.x + 0.5, end + (m.up ? 1 : -1));
        ctx.stroke();
      });
      icons.forEach((m) => {
        const { box: b } = m;
        ctx.strokeStyle = C.bg;
        ctx.lineWidth = 2;
        ctx.fillStyle = markColor(m.kind);
        ctx.beginPath();
        if (m.kind === "hod") {
          ctx.moveTo(m.x, b.top);
          ctx.lineTo(b.right, b.bottom);
          ctx.lineTo(b.left, b.bottom);
          ctx.closePath();
          ctx.stroke();
          ctx.fill();
          return;
        }
        ctx.roundRect(b.left, b.top, b.right - b.left, b.bottom - b.top, 2.5);
        ctx.stroke();
        ctx.fill();
        ctx.fillStyle = m.kind === "halt" ? C.haltInk : C.resumeInk;
        ctx.font = `700 9px ${MONO}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(m.kind === "halt" ? "H" : "R", m.x, (b.top + b.bottom) / 2 + 0.5);
      });
      return drawn.map((m) => m.box);
    };

    // High and Low of the visible bars, with a short stem off the curve that
    // grows to clear the markers; left out when nothing is free.
    const drawExtremes = (g, obstacles) => {
      let hiI = null;
      let loI = null;
      for (let i = g.first; i <= g.last; i++) {
        if (hiI === null || bars[i].c >= bars[hiI].c) hiI = i;
        if (loI === null || bars[i].c <= bars[loI].c) loI = i;
      }
      if (hiI === null || bars[hiI].c === bars[loI].c) return [];
      const dp = priceDp(bars[g.last].c);
      const boxes = [];
      ctx.font = `600 10px ${MONO}`;
      ctx.fillStyle = C.axis;
      ctx.strokeStyle = alpha(C.axis, 0.6);
      ctx.lineWidth = 1;
      ctx.textAlign = "left";
      [[hiI, true], [loI, false]].forEach(([i, up]) => {
        const x = g.x(i);
        const y = g.y(bars[i].c);
        const text = fmtAt(bars[i].c, dp);
        const w = ctx.measureText(text).width;
        const left = clampTo(x - w / 2, 4, g.right - w - 4);
        for (let k = 0; k < 5; k++) {
          const d = 12 + k * 14;
          const label = up ? { left, right: left + w, top: y - d - KL_LABEL_H, bottom: y - d } : { left, right: left + w, top: y + d, bottom: y + d + KL_LABEL_H };
          const stem = up ? { left: x - 1, right: x + 1, top: y - d + 2, bottom: y - 3 } : { left: x - 1, right: x + 1, top: y + 3, bottom: y + d - 2 };
          const inside = label.top >= g.top - G.pad && label.bottom <= g.bottom + G.paneGap - 2;
          if (!inside || obstacles.some((o) => overlaps(label, o, 2) || overlaps(stem, o, 1))) continue;
          ctx.beginPath();
          ctx.moveTo(crisp(x), y + (up ? -3 : 3));
          ctx.lineTo(crisp(x), y + (up ? -(d - 2) : d - 2));
          ctx.stroke();
          ctx.textBaseline = up ? "bottom" : "top";
          ctx.fillText(text, left, up ? y - d : y + d);
          boxes.push({ left: Math.min(label.left, stem.left), right: Math.max(label.right, stem.right), top: Math.min(label.top, stem.top), bottom: Math.max(label.bottom, stem.bottom) });
          break;
        }
      });
      return boxes;
    };

    // Level values on their line at the right edge; a value that hits
    // another label moves left of it, strongest first; none fits: no value.
    const drawLevelLabels = (g, levels, obstacles) => {
      const dp = priceDp(bars[bars.length - 1].c);
      const placed = [...obstacles];
      ctx.font = LEVEL_FONT;
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      ctx.strokeStyle = C.bg;
      ctx.lineWidth = 3;
      [...levels].sort((a, b) => b.strength - a.strength).forEach((l) => {
        const text = `${l.type === "support" ? "S" : "R"} ${fmtAt(l.price, dp)}`;
        const w = ctx.measureText(text).width;
        let right = g.right - 6;
        let b = { left: right - w, right, top: l.y - 2 - KL_LABEL_H, bottom: l.y - 2 };
        for (let hit = placed.find((o) => overlaps(b, o)); hit; hit = placed.find((o) => overlaps(b, o))) {
          right = hit.left - 10;
          b = { left: right - w, right, top: l.y - 2 - KL_LABEL_H, bottom: l.y - 2 };
        }
        if (b.left < 4) return;
        placed.push(b);
        ctx.strokeText(text, right, l.y - 2);
        ctx.fillStyle = alpha(levelColor(l), 0.6 + l.strength * 0.13);
        ctx.fillText(text, right, l.y - 2);
      });
    };

    const draw = () => {
      if (!W || !H) return;
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, W, H);
      const off = message();
      note.textContent = off;
      note.hidden = !off;
      legendLevels.forEach((el) => { el.hidden = !klPrefs.levels; });
      if (off) {
        geo = null;
        tip.hidden = true;
        canvas.setAttribute("aria-label", `Key levels chart. ${off}`);
        return;
      }

      pin();
      const g = (geo = geometry());
      const { right, timeTop, volTop, top, bottom, first, last, x, y, yVol } = g;
      const lastBar = bars[bars.length - 1];
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      // Price grid and labels; time ticks on round ET steps, their labels kept apart
      const pStep = niceStep((g.hi - g.lo) / Math.max(2, (bottom - top) / 34));
      const dp = Math.min(4, Math.max(priceDp(lastBar.c), pStep >= 1 ? 0 : Math.ceil(-Math.log10(pStep) - 1e-9)));
      const pTicks = [];
      for (let p = Math.ceil(g.lo / pStep) * pStep; p <= g.hi; p += pStep) {
        const py = y(p);
        if (py >= top - 4 && py <= bottom + 4) pTicks.push({ p, y: py });
      }
      const iv = klPrefs.interval;
      ctx.font = `500 10.5px ${MONO}`;
      const tickW = ctx.measureText("00:00:00").width + 18;
      const tStep = KL_TIME_STEPS.find((s) => s >= iv && (s / iv) * spacing >= tickW) || KL_TIME_STEPS[KL_TIME_STEPS.length - 1];
      const tFmt = tStep < 60e3 ? ET_HMS : ET_HM;
      const tTicks = [];
      for (let i = Math.max(1, first); i <= last; i++) {
        if (Math.floor(bars[i].t / tStep) === Math.floor(bars[i - 1].t / tStep)) continue;
        const tx = x(i);
        if (tx < 0 || tx > right || (tTicks.length && tx - tTicks[tTicks.length - 1].x < tickW)) continue;
        tTicks.push({ x: tx, t: bars[i].t });
      }

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, right, timeTop);
      ctx.clip();

      // Pre-market / after hours, one band per run
      for (let i = first; i <= last; i++) {
        const s = bars[i].s;
        if (s === "rm") continue;
        let j = i;
        while (j < last && bars[j + 1].s === s) j++;
        ctx.fillStyle = alpha(C.session, A.session);
        ctx.fillRect(x(i) - spacing / 2, 0, x(j) - x(i) + spacing, timeTop);
        i = j;
      }

      // Ticker watermark, centered left of the level values
      const markX = anchorX() / 2;
      ctx.font = `800 ${Math.round(clampTo(W * 0.11, 28, 84))}px ${SANS}`;
      ctx.fillStyle = C.mark;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(ticker(), markX, (top + bottom) / 2);

      ctx.strokeStyle = C.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      pTicks.forEach((tk) => { ctx.moveTo(0, crisp(tk.y)); ctx.lineTo(right, crisp(tk.y)); });
      tTicks.forEach((tk) => { ctx.moveTo(crisp(tk.x), 0); ctx.lineTo(crisp(tk.x), timeTop); });
      ctx.moveTo(0, crisp(volTop - G.paneGap / 2));
      ctx.lineTo(right, crisp(volTop - G.paneGap / 2));
      ctx.stroke();

      // Volume: neutral, brighter when the bar closed up
      const barW = Math.max(1, Math.min(Math.floor(spacing * 0.68), 18));
      for (let i = first; i <= last; i++) {
        const b = bars[i];
        if (!b.v) continue;
        const up = b.c >= (bars[i - 1]?.c ?? b.c);
        const vt = yVol(b.v);
        ctx.fillStyle = alpha(C.volume, up ? A.volUp : A.volDown);
        ctx.fillRect(Math.round(x(i) - barW / 2), vt, barW, Math.max(1, timeTop - vt));
      }

      // Level lines across the plot, stronger the stronger the level
      const levels = shown().map((l) => ({ ...l, y: crisp(y(l.price)) })).filter((l) => l.y >= top - 6 && l.y <= bottom + 6);
      ctx.lineWidth = 1;
      levels.forEach((l) => {
        ctx.strokeStyle = alpha(levelColor(l), A.level + A.levelStep * (l.strength - 1));
        ctx.beginPath();
        ctx.moveTo(0, l.y);
        ctx.lineTo(right, l.y);
        ctx.stroke();
      });

      // Price: line and area; the step across a Halt or a gap is gray
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, top - G.pad, right, bottom - top + G.pad + G.paneGap / 2);
      ctx.clip();
      const line = new Path2D();
      const area = new Path2D();
      const joins = new Path2D();
      for (let i = first; i <= last; i++) {
        const px = x(i);
        const py = y(bars[i].c);
        if (i === first) { line.moveTo(px, py); area.moveTo(px, py); continue; }
        area.lineTo(px, py);
        if (!bars[i].brk) { line.lineTo(px, py); continue; }
        joins.moveTo(x(i - 1), y(bars[i - 1].c));
        joins.lineTo(px, py);
        line.moveTo(px, py);
      }
      area.lineTo(x(last), bottom + G.paneGap / 2);
      area.lineTo(x(first), bottom + G.paneGap / 2);
      area.closePath();
      const grad = ctx.createLinearGradient(0, top, 0, bottom);
      grad.addColorStop(0, alpha(C.price, A.area));
      grad.addColorStop(1, alpha(C.price, 0));
      ctx.fillStyle = grad;
      ctx.fill(area);
      ctx.strokeStyle = C.price;
      ctx.lineWidth = 2;
      ctx.stroke(line);
      ctx.strokeStyle = C.neutral;
      ctx.stroke(joins);

      // VWAP: dashed, neutral; broken with the price
      ctx.setLineDash([5, 4]);
      ctx.lineCap = "butt";
      ctx.strokeStyle = alpha(C.vwap, A.vwap);
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      for (let i = first; i <= last; i++) {
        if (bars[i].w == null) continue;
        if (i === first || bars[i].brk || bars[i - 1].w == null) ctx.moveTo(x(i), y(bars[i].w));
        else ctx.lineTo(x(i), y(bars[i].w));
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineCap = "round";
      ctx.restore();

      // Markers first, then High / Low away from them, then the level values away from both
      const markBoxes = drawMarks(g);
      const extremeBoxes = drawExtremes(g, markBoxes);
      drawLevelLabels(g, levels, [...markBoxes, ...extremeBoxes]);

      // Last price: dotted line across (green / red by the day's change), live dot
      const trend = lastBar.c - BB_PREV_CLOSE;
      const tone = trend >= 0 ? C.bull : C.bear;
      const ly = y(lastBar.c);
      ctx.setLineDash([1, 3]);
      ctx.strokeStyle = alpha(tone, 0.55);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, crisp(ly));
      ctx.lineTo(right, crisp(ly));
      ctx.stroke();
      ctx.setLineDash([]);
      if (last === bars.length - 1) {
        const lx = x(last);
        ctx.fillStyle = alpha(C.price, 0.18);
        ctx.beginPath();
        ctx.arc(lx, ly, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = C.price;
        ctx.strokeStyle = C.bg;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(lx, ly, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();

      // Crosshair target: a bar (magnet on x); y follows the cursor
      const h = hover && clampTo(hover.i, first, last);
      const hb = hover ? bars[h] : null;
      const hy = hover ? (hover.y ?? y(hb.c)) : null;
      ctx.font = `600 10.5px ${MONO}`;
      const hoverTime = hb && (iv < 60e3 ? ET_HMS : ET_HM).format(hb.t);
      const timeChip = hb && (() => {
        const w = ctx.measureText(hoverTime).width + 14;
        return { l: clampTo(x(h) - w / 2, 0, right - w), w };
      })();

      // Axes: background, borders, labels, tags
      ctx.fillStyle = C.bg;
      ctx.fillRect(right, 0, W - right, H);
      ctx.fillRect(0, timeTop, W, H - timeTop);
      ctx.strokeStyle = C.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(crisp(right), 0);
      ctx.lineTo(crisp(right), timeTop);
      ctx.moveTo(0, crisp(timeTop));
      ctx.lineTo(W, crisp(timeTop));
      ctx.stroke();

      const lastW = [...bars].reverse().find((b) => b.w != null)?.w;
      const tags = [{ y: ly, text: fmtAt(lastBar.c, dp), bg: tone }];
      if (lastW != null && lastW >= g.lo && lastW <= g.hi && fmtAt(lastW, dp) !== tags[0].text) tags.push({ y: y(lastW), text: fmtAt(lastW, dp), bg: C.vwap });
      spreadTags(tags, G.tag / 2, bottom, G.tag + 2);
      const chipY = hy != null && hy <= bottom + G.paneGap / 2 ? clampTo(hy, G.tag / 2, bottom) : null;
      const blocked = [...tags.map((t) => t.y), ...(chipY != null ? [chipY] : [])];
      ctx.font = `500 10.5px ${MONO}`;
      ctx.fillStyle = C.axis;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      pTicks.forEach((tk) => {
        if (blocked.some((b) => Math.abs(b - tk.y) < G.tag / 2 + 7)) return;
        ctx.fillText(fmtAt(tk.p, dp), right + G.axisW / 2, tk.y);
      });
      // Top of the volume pane, unless the crosshair chip is there
      const volLabelY = volTop + 7;
      if (g.maxVol > 0 && !(hy != null && hy > bottom + G.paneGap / 2 && Math.abs(hy - volLabelY) < G.tag)) {
        ctx.font = `500 9.5px ${MONO}`;
        ctx.fillText(fmtAbbr(g.maxVol), right + G.axisW / 2, volLabelY);
      }
      tags.slice(1).forEach((t) => axisTag(g, t.y, t.text, t.bg, C.ink));
      axisTag(g, tags[0].y, tags[0].text, tags[0].bg, C.ink);

      ctx.font = `500 10.5px ${MONO}`;
      ctx.fillStyle = C.axis;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      tTicks.forEach((tk) => {
        const text = tFmt.format(tk.t);
        const w = ctx.measureText(text).width;
        if (tk.x - w / 2 < 2 || tk.x + w / 2 > right - 2) return;
        if (timeChip && tk.x + w / 2 > timeChip.l - 4 && tk.x - w / 2 < timeChip.l + timeChip.w + 4) return;
        ctx.fillText(text, tk.x, timeTop + G.axisH / 2);
      });

      // Crosshair: dashed lines, the bar's point, chips on both axes, hover card
      if (hb) {
        const hx = x(h);
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = alpha(C.cross, 0.8);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(crisp(hx), 0);
        ctx.lineTo(crisp(hx), timeTop);
        if (hy >= 0 && hy <= timeTop) { ctx.moveTo(0, crisp(hy)); ctx.lineTo(right, crisp(hy)); }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = C.price;
        ctx.strokeStyle = C.bg;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(hx, y(hb.c), 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        if (chipY != null) axisTag(g, chipY, fmtAt(g.priceAt(chipY), dp), C.chip, C.chipText);
        else if (hy > volTop && hy <= timeTop) axisTag(g, clampTo(hy, volTop + G.tag / 2, timeTop - G.tag / 2), fmtAbbr(Math.max(0, g.volAt(hy))), C.chip, C.chipText);
        ctx.fillStyle = C.chip;
        ctx.beginPath();
        ctx.roundRect(timeChip.l, timeTop + 2, timeChip.w, G.axisH - 4, 3);
        ctx.fill();
        ctx.fillStyle = C.chipText;
        ctx.font = `600 10.5px ${MONO}`;
        ctx.textAlign = "center";
        ctx.fillText(hoverTime, timeChip.l + timeChip.w / 2, timeTop + G.axisH / 2 + 0.5);
        showTip(g, h, hy);
      } else tip.hidden = true;

      const said = levels.map((l) => `${l.type === "support" ? "support" : "resistance"} ${fmtPrice(l.price)}`).join(", ");
      canvas.setAttribute("aria-label", `${ticker()} price chart, ${bars.length} bars of ${iv / 1000 < 60 ? `${iv / 1000} s` : `${iv / 60e3} min`}. Last ${fmtPrice(lastBar.c)}${lastW != null ? `, VWAP ${fmtPrice(lastW)}` : ""}.${said ? ` Levels: ${said}.` : ""}`);
    };

    // Hover card: the bar's price, change, VWAP, volume and its alerts
    const KIND_TEXT = { hod: ["▲", "New HoD", "hod"], buying: ["●", "Buying Pressure", "bull"], selling: ["●", "Selling Pressure", "bear"], halt: ["■", "Halt", ""], resume: ["■", "Resume", ""] };
    const showTip = (g, i, cy) => {
      const b = bars[i];
      const prev = bars[i - 1];
      const dp = priceDp(b.c);
      const change = prev ? b.c - prev.c : 0;
      const row = (label, value, sign = "") => `<dt>${label}</dt><dd${sign ? ` data-sign="${sign}"` : ""}>${value}</dd>`;
      const session = b.s === "pre" ? "Pre-market" : b.s === "post" ? "After hours" : "";
      const here = marks.filter((m) => m.i === i && enabled(m.kind));
      const lines = Object.keys(KIND_TEXT).map((kind) => {
        const of = here.filter((m) => m.kind === kind);
        if (!of.length) return "";
        const [glyph, name, tone] = KIND_TEXT[kind];
        const vol = Math.max(0, ...of.map((m) => m.vol ?? 0));
        return `<p class="chart-tip__alert"><b${tone ? ` data-tone="${tone}"` : ""}>${glyph}</b>${name}${of.length > 1 ? ` ×${of.length}` : ""} · ${fmtAt(of[of.length - 1].price, dp)}${vol ? ` · ${fmtMult(vol / 100)}` : ""}</p>`;
      }).join("");
      tip.innerHTML = `
        <p class="chart-tip__time">${(klPrefs.interval < 60e3 ? ET_HMS : ET_HM).format(b.t)} ET${session ? `<span>${session}</span>` : ""}</p>
        <dl>
          ${row("Price", fmtAt(b.c, dp))}
          ${prev ? row("Change", `${change >= 0 ? "+" : "−"}${fmtAt(Math.abs(change), dp)} (${fmtPct((change / prev.c) * 100, 2).replace("-", "−")})`, change > 0 ? "up" : change < 0 ? "down" : "") : ""}
          ${b.w != null ? row("VWAP", fmtAt(b.w, dp)) : ""}
          ${row("Volume", b.v ? fmtAbbr(b.v) : "0")}
        </dl>
        ${lines}`;
      tip.hidden = false;
      placeChartTip(tip, g.x(i), cy, g.right, g.timeTop);
    };

    /* Head: state against the levels, meter between the nearest support
       and resistance, day stats */
    const levelWhy = (l) => [
      `strength ${l.strength}/3`,
      ...(l.touches ? [`${l.touches} touch${l.touches > 1 ? "es" : ""}`] : []),
      ...l.sources.filter((s) => KL_SOURCES[s]).slice(0, 2).map((s) => KL_SOURCES[s]),
      ...(l.volumeShare >= 0.05 ? [`${Math.round(l.volumeShare * 100)}% of volume`] : []),
      ...(l.buying + l.selling ? [`${l.buying + l.selling} pressure alert${l.buying + l.selling > 1 ? "s" : ""}`] : []),
    ].join(" · ");
    const describe = (s, dp) => {
      const f = (v) => fmtAt(v, dp);
      const gap = (a, b) => `${f(Math.abs(a - b))} (${((Math.abs(a - b) / s.p) * 100).toFixed(1)}%)`;
      switch (s.key) {
        case "warming_up": return `Levels need ${KL_MIN_SAMPLES} Top List updates: ${samples.length} so far.`;
        case "none": return "No price has enough volume, touches or references to be a level yet.";
        case "breakout": return `Broke above ${f(s.level.price)} at ${ET_HM.format(s.at)} ET and holds ${f(s.p - s.level.price)} over it${s.above ? `; next resistance ${f(s.above.price)}` : ""}.`;
        case "breakdown": return `Lost ${f(s.level.price)} at ${ET_HM.format(s.at)} ET and sits ${f(s.level.price - s.p)} under it${s.below ? `; next support ${f(s.below.price)}` : ""}.`;
        case "test_r": return `${gap(s.level.price, s.p)} under resistance ${f(s.level.price)}: ${levelWhy(s.level)}.`;
        case "test_s": return `${gap(s.p, s.level.price)} over support ${f(s.level.price)}: ${levelWhy(s.level)}.`;
        case "no_r": return `Above every level: the nearest support is ${f(s.below.price)}, ${gap(s.p, s.below.price)} below.`;
        case "no_s": return `Below every level: the nearest resistance is ${f(s.above.price)}, ${gap(s.above.price, s.p)} above.`;
        default: return `${gap(s.above.price, s.p)} to resistance ${f(s.above.price)} and ${gap(s.p, s.below.price)} to support ${f(s.below.price)}.`;
      }
    };
    // VWAP slope: linear regression of the last 5 minutes of the same session, % of VWAP per minute
    const vwapSlope = () => {
      const lastS = samples[samples.length - 1];
      const pts = [];
      for (let i = samples.length - 1; i >= 0 && samples[i].t >= lastS.t - 300e3 && samples[i].s === lastS.s; i--) if (samples[i].w != null) pts.push(samples[i]);
      if (pts.length < 2 || pts[0].t - pts[pts.length - 1].t < 60e3) return null;
      const mx = pts.reduce((s, p) => s + p.t / 60e3, 0) / pts.length;
      const my = pts.reduce((s, p) => s + p.w, 0) / pts.length;
      const num = pts.reduce((s, p) => s + (p.t / 60e3 - mx) * (p.w - my), 0);
      const den = pts.reduce((s, p) => s + (p.t / 60e3 - mx) ** 2, 0);
      return den ? ((num / den) / pts[0].w) * 100 : null;
    };

    const renderHead = () => {
      const off = message();
      const s = off ? null : head;
      const dp = s ? priceDp(s.p) : 2;
      const [label, tone] = s ? KL_STATES[s.key] : ["Waiting for data", "neutral"];
      pill.dataset.tone = tone;
      pill.textContent = label;
      since.textContent = s ? `since ${ET_HMS.format(s.since)} ET` : "since --:--:-- ET";
      detail.textContent = s ? describe(s, dp) : intro;
      detail.title = s ? detail.textContent : "";

      // Meter: the price between the nearest support (left) and resistance (right)
      const levels = s ? result.levels : [];
      const r = levels.filter((l) => l.type === "resistance").sort((a, b) => a.price - b.price)[0];
      const sup = levels.filter((l) => l.type === "support").sort((a, b) => b.price - a.price)[0];
      const p = s?.p;
      const pos = !s ? 0.5 : r && sup ? clampTo((p - sup.price) / (r.price - sup.price), 0, 1) : r ? 0 : sup ? 1 : 0.5;
      const toR = r ? (r.price - p) / p : Infinity;
      const toS = sup ? (p - sup.price) / p : Infinity;
      const lead = !s || (!r && !sup) ? "" : toS < toR ? "bull" : "bear";
      meter.dataset.lead = lead;
      thumb.style.left = `${pos * 100}%`;
      supportLabel.textContent = `S ${sup ? fmtAt(sup.price, dp) : "—"}`;
      resistanceLabel.textContent = `R ${r ? fmtAt(r.price, dp) : "—"}`;
      score.textContent = lead ? `${(Math.min(toR, toS) * 100).toFixed(1)}%` : "—";
      meter.setAttribute("aria-valuenow", String(Math.round(pos * 100)));
      meter.setAttribute("aria-valuetext", lead
        ? [r && `${(toR * 100).toFixed(1)}% under resistance ${fmtAt(r.price, dp)}`, sup && `${(toS * 100).toFixed(1)}% over support ${fmtAt(sup.price, dp)}`].filter(Boolean).join(", ")
        : "No levels");

      const lastS = s && samples[samples.length - 1];
      const slope = s ? vwapSlope() : null;
      const prices = s ? samples.map((x) => x.p) : [];
      const open = s && references().open;
      const items = [
        ["VWAP", lastS?.w != null ? fmtAt(lastS.w, dp) : null, "", KL_STAT_TITLES.vwap],
        ["VWAP slope", slope != null ? `${slope > 0 ? "+" : slope < 0 ? "−" : ""}${Math.abs(slope).toFixed(3)}` : null, slope > 0.0005 ? "up" : slope < -0.0005 ? "down" : "", KL_STAT_TITLES.slope],
        ["High", s ? fmtAt(Math.max(...prices), dp) : null, "", KL_STAT_TITLES.high],
        ["Low", s ? fmtAt(Math.min(...prices), dp) : null, "", KL_STAT_TITLES.low],
        ["Open", open != null ? fmtAt(open, dp) : null, "", KL_STAT_TITLES.open],
        ["Prev. close", s ? fmtAt(BB_PREV_CLOSE, dp) : null, "", KL_STAT_TITLES.prev],
      ];
      stats.innerHTML = items.map(([name, value, sign, title]) => (
        `<div title="${title}"><dt>${name}</dt><dd${sign ? ` data-sign="${sign}"` : ""}>${value ?? "—"}</dd></div>`
      )).join("");
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; draw(); });
    };
    const render = () => {
      renderHead();
      schedule();
    };

    const resize = () => {
      const { width, height } = chartBox(box);
      const dpr = window.devicePixelRatio || 1;
      const wasEmpty = !W;
      W = Math.floor(width);
      H = Math.floor(height);
      canvas.width = Math.max(1, Math.round(W * dpr));
      canvas.height = Math.max(1, Math.round(H * dpr));
      readSizes();
      if (wasEmpty) spacing = G.bar;
      if (follow || wasEmpty) { follow = true; offset = liveOffset(); }
      clampOffset();
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      draw();
    };
    new ResizeObserver(resize).observe(box);
    const watchDpr = () => matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener("change", () => { resize(); watchDpr(); }, { once: true });
    watchDpr();
    document.fonts?.ready.then(schedule);

    /* Pointer: crosshair, drag to pan, wheel to zoom, double-click to go live */
    const barAt = (px) => clampTo(Math.round(bars.length - 1 + offset - (plotW() - px - spacing / 2) / spacing), 0, bars.length - 1);
    const zoom = (factor, ax) => {
      const next = clampTo(spacing * factor, KL_ZOOM.min, KL_ZOOM.max);
      if (next === spacing) return;
      const right = plotW();
      const px = Number.isFinite(ax) ? ax : right - offset * spacing - spacing / 2;
      const i = bars.length - 1 + offset - (right - px - spacing / 2) / spacing;
      spacing = next;
      offset = i - bars.length + 1 + (right - px - next / 2) / next;
      clampOffset();
      updateFollow();
      schedule();
    };
    const pan = (n) => {
      offset += n;
      clampOffset();
      updateFollow();
      schedule();
    };
    const pointAt = (e) => {
      const { x, y } = chartPoint(canvas, e);
      return { px: x, py: y };
    };
    canvas.addEventListener("pointermove", (e) => {
      if (!geo) return;
      const { px, py } = pointAt(e);
      if (drag) {
        offset = drag.offset - (px - drag.x) / spacing;
        clampOffset();
        updateFollow();
      }
      hover = px < geo.right && py < geo.timeTop ? { i: barAt(px), y: py } : null;
      schedule();
    });
    canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !geo) return;
      drag = { x: pointAt(e).px, offset };
      canvas.setPointerCapture(e.pointerId);
      canvas.classList.add("is-dragging");
    });
    ["pointerup", "pointercancel"].forEach((type) => canvas.addEventListener(type, () => {
      drag = null;
      canvas.classList.remove("is-dragging");
    }));
    canvas.addEventListener("pointerleave", () => {
      if (drag) return;
      hover = null;
      schedule();
    });
    canvas.addEventListener("blur", () => { hover = null; schedule(); });
    canvas.addEventListener("wheel", (e) => {
      if (!geo) return;
      e.preventDefault();
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) pan((e.shiftKey ? e.deltaY : e.deltaX) / spacing);
      else zoom(e.deltaY < 0 ? 1.12 : 1 / 1.12, Math.min(plotW(), pointAt(e).px));
    }, { passive: false });
    canvas.addEventListener("dblclick", resetView);
    canvas.addEventListener("keydown", (e) => {
      if (!geo) return;
      const lastIndex = bars.length - 1;
      const from = hover?.i ?? lastIndex;
      const step = e.shiftKey ? 10 : 1;
      const moves = { ArrowLeft: from - step, ArrowRight: from + step, Home: geo.first, End: lastIndex };
      if (e.key in moves) {
        e.preventDefault();
        const i = clampTo(moves[e.key], 0, lastIndex);
        hover = { i, y: null };
        // Keep the bar in view
        if (e.key === "End") { follow = true; offset = liveOffset(); }
        else if (i < geo.first + 1) pan(-(geo.first + 1 - i));
        else if (i > geo.last - 1 && i < lastIndex) pan(i - geo.last + 1);
        clampOffset();
        schedule();
      } else if (e.key === "+" || e.key === "=") { e.preventDefault(); zoom(1.2, hover ? geo.x(hover.i) : undefined); }
      else if (e.key === "-") { e.preventDefault(); zoom(1 / 1.2, hover ? geo.x(hover.i) : undefined); }
      else if (e.key === "Escape") { hover = null; schedule(); }
    });

    /* Controls: Alerts menu, S/R, interval */
    const syncControls = () => {
      intervalBtns.forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.klInterval) === klPrefs.interval)));
      levelsBtn.setAttribute("aria-pressed", String(klPrefs.levels));
      menuItems.forEach((item) => {
        const kind = item.dataset.klAlert;
        item.setAttribute("aria-checked", String(kind === "all" ? klPrefs.alerts.length === KL_KINDS.length : klPrefs.alerts.includes(kind)));
      });
      menuBtn.dataset.count = klPrefs.alerts.length === KL_KINDS.length ? "" : String(klPrefs.alerts.length);
    };
    const setMenu = (open, { focus = false } = {}) => {
      menu.hidden = !open;
      menuBtn.setAttribute("aria-expanded", String(open));
      if (open) menuItems[0].focus();
      else if (focus) menuBtn.focus();
    };
    menuBtn.addEventListener("click", () => setMenu(menu.hidden));
    menu.addEventListener("click", (e) => {
      const item = e.target.closest("[data-kl-alert]");
      if (!item) return;
      const kind = item.dataset.klAlert;
      if (kind === "all") klPrefs.alerts = klPrefs.alerts.length === KL_KINDS.length ? [] : [...KL_KINDS];
      else klPrefs.alerts = klPrefs.alerts.includes(kind) ? klPrefs.alerts.filter((k) => k !== kind) : KL_KINDS.filter((k) => k === kind || klPrefs.alerts.includes(k));
      saveKlPrefs();
      syncControls();
      schedule();
    });
    menu.addEventListener("keydown", (e) => {
      const at = menuItems.indexOf(document.activeElement);
      const moves = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: menuItems.length - 1 };
      if (e.key in moves) {
        e.preventDefault();
        menuItems[(moves[e.key] + menuItems.length) % menuItems.length].focus();
      } else if (e.key === "Escape") {
        e.preventDefault();
        setMenu(false, { focus: true });
      } else if (e.key === "Tab") setMenu(false);
    });
    document.addEventListener("pointerdown", (e) => { if (!menu.hidden && !menuWrap.contains(e.target)) setMenu(false); });
    levelsBtn.addEventListener("click", () => {
      klPrefs.levels = !klPrefs.levels;
      saveKlPrefs();
      syncControls();
      schedule();
    });
    intervalBtns.forEach((b) => b.addEventListener("click", () => {
      klPrefs.interval = Number(b.dataset.klInterval);
      saveKlPrefs();
      syncControls();
      hover = null;
      refresh({ keepView: false });
      render();
    }));
    symbol.addEventListener("input", () => {
      hover = null;
      render();
    });
    syncControls();
    render();

    return {
      // The whole day (a new page, or a copy's snapshot)
      load: (dump) => {
        samples = dump ? dump.points.filter((p) => p.vol != null).map(sampleOf) : [];
        pressure = dump ? dump.alerts.slice() : [];
        halts = dump ? dump.halts : [];
        hover = null;
        refresh({ keepView: false });
        render();
      },
      // One live update: new points and alerts, the Halts
      push: (u) => {
        samples.push(...u.points.filter((p) => p.vol != null).map(sampleOf));
        pressure.push(...u.alerts);
        halts = u.halts;
        refresh();
        render();
      },
      // Interval, S/R or alerts saved in another window
      reload: () => {
        const interval = klPrefs.interval;
        loadKlPrefs();
        syncControls();
        if (interval !== klPrefs.interval) refresh({ keepView: false });
        render();
      },
    };
  };

  /* ---- Rally tracker: rallies, legs and states -------------------------------
     The monitor's algorithm (see RALLY_TRACKER.md) run in the browser on the
     mock GXAI day: is a rally running, how far, speeding up or fading?
     - Points: each Top List update plus each alert with a price (New HoD,
       Buying / Selling Pressure), in time order; at the same instant the
       alert's price wins. Halted time never counts (active time τ).
     - σ: volatility per 15 s from the updates (exponential, ~10 min); each
       update's volume split into buy and sell (Bulk Volume Classification).
     - Thresholds (log returns): leg max(0.8 %, 2 ticks, 2σ); a rise that took
       d starts a rally at max(1.5 %, 3 ticks, leg, 2.5σ·√(d / 15 s)), d ≥ 1
       min; a major drop is max(3 %, 2 legs, 2σ·√(10 min / 15 s)).
     - Start: of the successive lows of the last 10 active minutes, the lowest
       whose rise meets the threshold of its duration is the base; the start
       moves up to the launch (the last point within ¼ of the threshold).
     - Legs: a minor zigzag with the leg threshold (a Resume that reopens at
       or above the last price opens one too); each against the previous by
       mean speed: accelerating ≥ 1.25×, decelerating ≤ 0.8×, else steady.
     - End: a drop from the high of max(leg, min(61.8 % of the gain, major))
       (pullback), or 10 active minutes without a new high (stall).
     - Speed: least-squares slope of 100·ln(price) over the last 2 active
       minutes, in %/min; it accelerates or slows against the speed of 2
       minutes before by max(25 %, 1.5σ). Pace: Theil-Sen from start to high.
     - States in priority order (Halted; with a rally Pullback, Stalling,
       Accelerating, Decelerating, Sustained buying; without one Warming up,
       Rally ended, Rally building, No rally); the state in force holds while
       a point of the last 20 s backs it. Seven fade signals; the pullback
       zone, the fail price and the nearest Key levels. */

  const RT_BASE = 15e3;              // σ is per 15 s (the live CSV's pace)
  const RT_SIGMA = 0.005;            // σ before the first updates …
  const RT_SIGMA_MS = 600e3;         // … and its memory
  const RT_GAP = 120e3;              // longer without an update: its volume is not classified
  const RT_LOOKBACK = 600e3;
  const RT_START = { gain: 0.015, ticks: 3, z: 2.5, min: 60e3, horizon: 180e3, launch: 0.25 };
  const RT_LEG = { min: 0.008, ticks: 2, z: 2, accel: 1.25, decel: 0.8, minutes: 0.25 };
  const RT_END = { retrace: 0.618, z: 2, horizon: 600e3, stall: 600e3 };
  const RT_SPEED = { window: 2, points: 3, span: 0.75, lag: 2, relative: 0.25, noise: 1.5 };  // minutes
  const RT_PACE_POINTS = 600;        // Theil-Sen is O(n²): longer rallies are subsampled
  const RT_STATE = { warmup: 4, launch: 60e3, stallWarn: 180e3, fade: 0.5, build: 0.5, endedShow: 180e3, confirm: 20e3 };
  const RT_SIGNAL = { alerts: 300e3, noHigh: 120e3, participation: 0.8, z: 2.5, horizon: 1800e3 };
  const RT_ZONE = [0.382, 0.5];      // pullback zone of the leg in progress (Fibonacci)
  const RT_PACE_MIN_ACTIVE = 120e3;  // the day's volume pace needs this much trading before the rally
  const RT_LABELS = {
    warming_up: "Warming up", idle: "No rally", building: "Rally building", accelerating: "Accelerating", sustained: "Sustained buying",
    decelerating: "Decelerating", stalling: "Stalling", pullback: "Pullback", ended: "Rally ended", halted: "Halted",
  };
  const RT_SIGNALS = {
    speed: "Speed fading", legs: "Weaker legs", pullbacks: "Deeper pullbacks", highs: "No new high",
    sellers: "Sellers active", volume: "Volume drying up", extended: "Extended from VWAP",
  };

  const rtTick = (p) => (p < 1 ? 0.0001 : 0.01);
  const rtPct = (log) => (Math.exp(log) - 1) * 100;
  // [leg, major] thresholds as log returns
  const rtThresholds = (p, sigma) => {
    const leg = Math.max(RT_LEG.min, (RT_LEG.ticks * rtTick(p)) / p, RT_LEG.z * sigma);
    return [leg, Math.max(2 * RT_START.gain, 2 * leg, RT_END.z * sigma * Math.sqrt(RT_END.horizon / RT_BASE))];
  };
  // Rise (log) that starts a rally which took `d` ms to rise
  const rtStartAt = (p, sigma, d) => Math.max(
    RT_START.gain, (RT_START.ticks * rtTick(p)) / p, rtThresholds(p, sigma)[0],
    RT_START.z * sigma * Math.sqrt(Math.max(d, RT_START.min) / RT_BASE),
  );

  // +3.4 · −1.2 · 0.0 (true minus sign)
  const fmtSigned = (v, dp = 1) => {
    const text = Math.abs(v).toFixed(dp);
    return Number(text) === 0 ? text : `${v > 0 ? "+" : "−"}${text}`;
  };
  // 45s · 16m 03s · 1h 05m
  const fmtDuration = (ms) => {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    return m < 60 ? `${m}m ${pad(s % 60)}s` : `${Math.floor(m / 60)}h ${pad(m % 60)}m`;
  };

  // Theil-Sen slope: the median of the pairwise slopes. A finished rally
  // keeps its pace, so it is computed once.
  const rtPaceCache = new Map();
  const theilSen = (xs, ys, key) => {
    if (rtPaceCache.has(key)) return rtPaceCache.get(key);
    let x = xs;
    let y = ys;
    if (x.length > RT_PACE_POINTS) {
      const pick = Array.from({ length: RT_PACE_POINTS }, (_, k) => Math.round((k * (x.length - 1)) / (RT_PACE_POINTS - 1)));
      x = pick.map((k) => xs[k]);
      y = pick.map((k) => ys[k]);
    }
    const slopes = [];
    for (let i = 0; i < x.length; i++) for (let j = i + 1; j < x.length; j++) if (x[j] > x[i]) slopes.push((y[j] - y[i]) / (x[j] - x[i]));
    const sorted = Float64Array.from(slopes).sort();
    const n = sorted.length;
    const pace = n ? (n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2) : null;
    if (rtPaceCache.size > 64) rtPaceCache.clear();
    rtPaceCache.set(key, pace);
    return pace;
  };

  // One line on the state, with the numbers behind it
  const rtDescribe = (key, c) => {
    if (key === "warming_up" || !c) return "Collecting live alerts and Top List data.";
    if (key === "halted") {
      return c.rally != null
        ? `Trading is halted with the rally at ${fmtSigned(c.gain)}%. The tracker is frozen until the stock reopens.`
        : "Trading is halted. The tracker resumes when the stock reopens.";
    }
    const speed = c.speed != null ? `${c.speed.toFixed(1)}%/min` : "—";
    if (key === "idle" || key === "building") {
      const trigger = `a rally starts at +${c.start.toFixed(1)}%`;
      return key === "building"
        ? `Buyers are pushing: ${fmtSigned(c.rise)}% off the ${fmtPrice(c.low)} low at ${speed}; ${trigger}.`
        : `No rally in progress: price is ${fmtSigned(c.rise)}% off its ${fmtPrice(c.low)} low; ${trigger}.`;
    }
    if (key === "ended") {
      const e = c.ended || {};
      const why = e.reason === "stall" ? "no new high in 10 min" : `it gave back ${Math.round((e.giveback ?? 0) * 100)}% of its gain`;
      return `The rally ended at ${fmtPrice(e.high ?? 0)} after ${fmtSigned(e.gain ?? 0)}% in ${fmtDuration(e.duration ?? 0)}: ${why}.`;
    }
    const gain = fmtSigned(c.gain);
    const age = fmtDuration(c.age);
    if (key === "pullback") {
      return `Pulling back ${c.drawdown.toFixed(1)}% from the ${fmtPrice(c.high)} high, giving back ${Math.round(c.giveback * 100)}% of the rally; it fails below ${fmtPrice(c.fail)}.`;
    }
    if (key === "stalling") return `No new high in ${fmtDuration(c.sinceHigh)}: the rally is stalling at ${fmtPrice(c.high)} (${fmtSigned(c.highGain)}%).`;
    if (key === "accelerating") {
      return c.previous != null && c.speed != null && c.speed > c.previous
        ? `Rally ${gain}% in ${age} is speeding up: ${speed}, up from ${Math.max(0, c.previous).toFixed(1)}%/min 2 min ago.`
        : `New rally: ${gain}% in ${age} at ${speed}.`;
    }
    if (key === "decelerating") {
      if (c.control != null && c.control < 0) return `Rally ${gain}% is losing steam: sellers lead Bull vs. Bear at ${fmtSigned(c.control, 0)}.`;
      if (c.speed != null && c.peak) return `Rally ${gain}% is slowing: ${speed}, ${Math.round((Math.max(0, c.speed) / c.peak) * 100)}% of its ${c.peak.toFixed(1)}%/min peak.`;
      return `Rally ${gain}% is slowing: ${speed}, down from ${(c.previous || 0).toFixed(1)}%/min 2 min ago.`;
    }
    const evidence = [];
    if (c.buying) evidence.push(`${c.buying} buy alert${c.buying === 1 ? "" : "s"}`);
    if (c.buyShare != null) evidence.push(`${Math.round(c.buyShare * 100)}% buy volume`);
    return `Rally ${gain}% in ${age} holds its pace at ${speed}${evidence.length ? `; ${evidence.join(" and ")}` : ""}.`;
  };

  /* samples: Top List updates { t, p, v, w (VWAP), s: "pre" | "rm" | "post" };
     marks: alerts with a price { t, kind: "hod" | "buying" | "selling", price, vol };
     halts: { start, end (null while halted) }; control: Bull vs. Bear points
     { t, c }; participation: Bull vs. Bear's; levels: Key levels'. */
  const computeRallies = ({ samples, marks, halts, control, participation, levels }) => {
    const spans = halts.map((h) => ({ start: h.start, end: h.end ?? Infinity })).sort((a, b) => a.start - b.start);
    const inHalt = (t) => spans.some((h) => t >= h.start && t < h.end);
    const haltedBetween = (from, to) => spans.reduce((sum, h) => sum + Math.max(0, Math.min(h.end, to) - Math.max(h.start, from)), 0);
    // The CSV repeats the frozen price during a Halt
    const rows = samples.filter((s) => s.p > 0 && !inHalt(s.t));
    const priced = marks.filter((m) => m.price > 0 && !inHalt(m.t));
    const empty = {
      points: [], rallies: [], alerts: [], halts: spans.map((h) => ({ start: h.start, end: Number.isFinite(h.end) ? h.end : null })), signals: [], summary: null,
      status: { key: "warming_up", label: RT_LABELS.warming_up, detail: "Waiting for live alerts and Top List data.", since: null, rally: null },
    };
    if (!rows.length && !priced.length) return empty;

    // Volatility and buy / sell volume per update
    let variance = RT_SIGMA ** 2 / RT_BASE; // per ms
    const flow = rows.map((s, i) => {
      const prev = rows[i - 1];
      const since = prev ? s.t - prev.t - haltedBetween(prev.t, s.t) : Infinity;
      const out = { buy: 0, sell: 0, traded: 0, active: 0, sigma: 0 };
      if (since > 0 && since <= RT_GAP) {
        const r = Math.log(s.p / prev.p);
        const f = ndtr(r / Math.sqrt(variance * since));
        const v = Math.max(0, s.v || 0);
        Object.assign(out, { buy: f * v, sell: (1 - f) * v, traded: v, active: since });
        variance = Math.max(((0.5 * rtTick(s.p)) / s.p) ** 2 / RT_BASE, variance + (r * r / since - variance) * (1 - Math.exp(-since / RT_SIGMA_MS)));
      }
      out.sigma = Math.sqrt(variance * RT_BASE);
      return out;
    });

    // One point per instant: updates and priced alerts, both in time order,
    // merged; at the same instant the update goes first, so the alert's price wins.
    const P = [];
    let lastRow = -1;
    for (let i = 0, j = 0; i < rows.length || j < priced.length;) {
      const isRow = j >= priced.length || (i < rows.length && rows[i].t <= priced[j].t);
      const t = isRow ? rows[i].t : priced[j].t;
      let p = P[P.length - 1];
      if (!p || p.t !== t) P.push((p = { t, price: 0, traded: 0, buy: 0, sell: 0, active: 0 }));
      if (isRow) {
        const f = flow[i];
        lastRow = i;
        p.traded += f.traded;
        p.buy += f.buy;
        p.sell += f.sell;
        p.active += f.active;
        p.price = rows[i++].p;
      } else p.price = priced[j++].price;
      const row = rows[Math.max(0, lastRow)];
      p.session = row?.s ?? "rm";
      p.vwap = lastRow >= 0 ? row.w ?? null : null;
      p.sigma = lastRow >= 0 ? flow[lastRow].sigma : RT_SIGMA;
    }
    const n = P.length;
    const times = P.map((p) => p.t);
    const prices = P.map((p) => p.price);
    const sig = P.map((p) => p.sigma);
    const tau = times.map((t) => t - spans.reduce((sum, h) => sum + Math.min(Math.max(t, h.start), h.end) - h.start, 0));
    const minutes = tau.map((v) => (v - tau[0]) / 60e3);
    const logP = prices.map((p) => 100 * Math.log(p));

    // Speed: least squares over the trailing 2 active minutes (past points
    // only), with cumulative sums; y is centered on the day's first price.
    const speed = new Array(n).fill(null);
    const cx = [0];
    const cy = [0];
    const cxx = [0];
    const cxy = [0];
    for (let i = 0; i < n; i++) {
      const xv = minutes[i];
      const yv = logP[i] - logP[0];
      cx.push(cx[i] + xv);
      cy.push(cy[i] + yv);
      cxx.push(cxx[i] + xv * xv);
      cxy.push(cxy[i] + xv * yv);
    }
    for (let i = 0, from = 0; i < n; i++) {
      while (minutes[from] <= minutes[i] - RT_SPEED.window) from++;
      const k = i + 1 - from;
      if (k < RT_SPEED.points || minutes[i] - minutes[from] < RT_SPEED.span) continue;
      const sx = cx[i + 1] - cx[from];
      const sy = cy[i + 1] - cy[from];
      const den = k * (cxx[i + 1] - cxx[from]) - sx * sx;
      if (den > 1e-9) speed[i] = (k * (cxy[i + 1] - cxy[from]) - sx * sy) / den;
    }
    // Acceleration: against the speed 2 minutes before, beyond max(25 %, noise)
    const previous = new Array(n).fill(null);
    const accel = new Array(n).fill(null);
    const noise = sig.map((s) => RT_SPEED.noise * 100 * s);
    for (let i = 0, lag = -1; i < n; i++) {
      while (lag + 1 < n && minutes[lag + 1] <= minutes[i] - RT_SPEED.lag) lag++;
      if (lag >= 0 && minutes[i] - minutes[lag] <= RT_SPEED.lag + 1) previous[i] = speed[lag];
      const s = speed[i];
      const pv = previous[i];
      if (s == null || pv == null) continue;
      const base = Math.max(pv, 0);
      if (s > 0 && s - base >= Math.max(noise[i], RT_SPEED.relative * base)) accel[i] = 1;
      else if (pv > 0 && pv - s >= Math.max(noise[i], RT_SPEED.relative * Math.abs(pv))) accel[i] = -1;
      else accel[i] = 0;
    }

    const controlAt = (t) => {
      if (!control.length || control[0].t > t) return null;
      return control[indexAt(control, t)].c;
    };
    const markTimes = marks.map((m) => m.t);
    const lowerBound = (arr, v) => {
      let lo = 0;
      let hi = arr.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; }
      return lo;
    };
    const countMarks = (kind, from, to) => {
      let count = 0;
      for (let i = lowerBound(markTimes, from); i < marks.length && marks[i].t <= to; i++) if (marks[i].kind === kind) count++;
      return count;
    };

    /* State machine: each point sees only what was known at its time */
    const rallyOf = new Array(n).fill(-1);
    const gains = new Array(n).fill(0);
    const stateOf = new Array(n).fill("warming_up");
    const controlOf = new Array(n).fill(null);
    const rallies = [];
    let active = null;
    let lows = [];
    let lastEnd = null;
    let current = null;
    let currentSince = null;
    let currentRally = null;
    let confirmedAt = 0;
    let confirmed = {};
    let c = {};

    const pushLow = (i) => {
      while (lows.length && prices[lows[lows.length - 1]] >= prices[i]) lows.pop();
      lows.push(i);
    };
    // The rally's high and legs with point i
    const advance = (r, i) => {
      const price = prices[i];
      const legT = limits[i][0];
      const leg = r.legs[r.legs.length - 1];
      const resumed = times[i] - times[i - 1] > tau[i] - tau[i - 1] + 1;
      if (resumed && r.mode === "up" && price >= prices[i - 1]) {
        // Reopens after a Halt without losing ground: a new leg from the last price before it
        r.legs.push({ startI: i - 1, base: prices[i - 1], high: price, highI: i, pullback: null, halt: true });
      } else if (r.mode === "up") {
        if (price > leg.high) { leg.high = price; leg.highI = i; }
        else if (Math.log(leg.high / price) >= legT) { r.mode = "pullback"; r.pbLow = price; r.pbLowI = i; }
      } else {
        if (price < r.pbLow) { r.pbLow = price; r.pbLowI = i; }
        if (price > r.high || Math.log(price / r.pbLow) >= legT) {
          leg.pullback = Math.log(leg.high / r.pbLow);
          r.legs.push({ startI: r.pbLowI, base: r.pbLow, high: price, highI: i, pullback: null, halt: false });
          r.mode = "up";
        }
      }
      if (price > r.high) { r.high = price; r.highI = i; }
      if (speed[i] != null) r.peak = Math.max(r.peak, speed[i]);
    };

    // Per point: [leg, major] and the start threshold's parts (only √d varies)
    const limits = prices.map((p, i) => rtThresholds(p, sig[i]));
    const startFloor = prices.map((p, i) => Math.max(RT_START.gain, (RT_START.ticks * rtTick(p)) / p, limits[i][0]));
    const startZ = sig.map((v) => RT_START.z * v / Math.sqrt(RT_BASE));
    const startAt = (i, d) => Math.max(startFloor[i], startZ[i] * Math.sqrt(Math.max(d, RT_START.min)));

    for (let i = 0; i < n; i++) {
      const price = prices[i];
      const t = times[i];
      const [legT, majorT] = limits[i];
      let structural = false;

      if (active) {
        advance(active, i);
        const gainLog = Math.log(active.high / active.base);
        const endT = Math.max(legT, Math.min(RT_END.retrace * gainLog, majorT));
        const reason = Math.log(active.high / price) >= endT ? "pullback" : tau[i] - tau[active.highI] >= RT_END.stall ? "stall" : null;
        if (reason) {
          active.endI = i;
          active.reason = reason;
          rallyOf[i] = active.id;
          gains[i] = rtPct(Math.log(price / active.base));
          lastEnd = {
            tau: tau[i], reason, high: active.high, gain: rtPct(gainLog),
            duration: tau[active.highI] - tau[active.startI], giveback: (active.high - price) / (active.high - active.base),
          };
          // The next rally's low is looked for after this high
          lows = [];
          for (let j = active.highI + 1; j <= i; j++) if (tau[j] >= tau[i] - RT_LOOKBACK) pushLow(j);
          active = null;
          structural = true;
        }
      }

      let rise = 0;
      let lowI = i;
      let needed = 0;
      if (!active) {
        if (!structural) pushLow(i);
        while (lows.length && tau[lows[0]] < tau[i] - RT_LOOKBACK) lows.shift();
        if (!lows.length) pushLow(i);
        lowI = lows[0];
        rise = Math.log(price / prices[lowI]);
        if (rallyOf[i] < 0) gains[i] = rtPct(rise);
        needed = startAt(i, tau[i] - tau[lowI]);
        // Each successive low is the lowest since its time: the fastest rise
        // starts at one of them. The lowest that meets its threshold wins.
        // Lows go up along the list: once the rise misses the floor, all do.
        let trigger = null;
        for (const k of lows) {
          const up = Math.log(price / prices[k]);
          if (k === i || up < startFloor[i]) break;
          const th = startAt(i, tau[i] - tau[k]);
          if (up >= th) { trigger = { k, th }; break; }
        }
        if (trigger) {
          const low = prices[trigger.k];
          const band = low * Math.exp(RT_START.launch * trigger.th);
          let launch = i - 1;
          while (launch > trigger.k && prices[launch] > band) launch--;
          const id = rallies.length;
          active = {
            id, startI: launch, triggerI: i, base: low, high: prices[launch], highI: launch, endI: null, reason: null,
            mode: "up", pbLow: null, pbLowI: null, peak: 0,
            legs: [{ startI: launch, base: low, high: prices[launch], highI: launch, pullback: null, halt: false }],
          };
          const before = rallies[rallies.length - 1];
          // The launch falls in the previous rally's pullback: that one is cut there
          if (before && before.endI != null && before.endI >= launch) before.endI = launch;
          rallies.push(active);
          for (let j = launch; j <= i; j++) {
            if (j > launch) advance(active, j);
            rallyOf[j] = id;
            gains[j] = rtPct(Math.log(prices[j] / low));
          }
          lows = [];
          structural = true;
        }
      }
      if (active) {
        rallyOf[i] = active.id;
        gains[i] = rtPct(Math.log(price / active.base));
      }

      // Raw state with what is known at this point
      const controlValue = (controlOf[i] = controlAt(t));
      c = { speed: speed[i], previous: previous[i], control: controlValue };
      let raw;
      if (active) {
        const gainLog = Math.log(active.high / active.base);
        const drawdown = Math.log(active.high / price);
        const sinceHigh = tau[i] - tau[active.highI];
        const endT = Math.max(legT, Math.min(RT_END.retrace * gainLog, majorT));
        const span = active.high - active.base;
        Object.assign(c, {
          rally: active.id, gain: gains[i], highGain: rtPct(gainLog), high: active.high, age: tau[i] - tau[active.startI], sinceHigh,
          drawdown: (1 - price / active.high) * 100, giveback: span > 0 ? (active.high - price) / span : 0,
          fail: active.high * Math.exp(-endT), peak: active.peak,
          buying: countMarks("buying", Math.max(times[active.startI], t - RT_SIGNAL.alerts), t),
        });
        const s = speed[i];
        const launching = tau[i] - tau[active.triggerI] < RT_STATE.launch;
        if (drawdown >= legT) raw = "pullback";
        else if (sinceHigh >= RT_STATE.stallWarn) raw = "stalling";
        else if (accel[i] === 1 || (launching && (s == null || s > 0))) raw = "accelerating";
        else if (accel[i] === -1 || (s != null && active.peak >= noise[i] && s <= RT_STATE.fade * active.peak) || (controlValue != null && controlValue < 0)) raw = "decelerating";
        else raw = "sustained";
      } else {
        Object.assign(c, { low: prices[lowI], rise: rtPct(rise), start: rtPct(needed), ended: lastEnd });
        if (i + 1 < RT_STATE.warmup && !lastEnd) raw = "warming_up";
        else if (lastEnd && tau[i] - lastEnd.tau < RT_STATE.endedShow) raw = "ended";
        else if (rise >= RT_STATE.build * needed && (speed[i] || 0) > 0) raw = "building";
        else raw = "idle";
      }

      // Debounce: the state in force holds while a point of the last 20 s
      // backs it; a rally's start or end is taken at once.
      const rallyNow = active ? active.id : null;
      if (raw === current && rallyNow === currentRally) { confirmedAt = t; confirmed = c; }
      else if (current === null || structural || current === "warming_up" || rallyNow !== currentRally || t - confirmedAt >= RT_STATE.confirm) {
        current = raw;
        currentSince = t;
        currentRally = rallyNow;
        confirmedAt = t;
        confirmed = c;
      }
      stateOf[i] = current;
    }

    /* Result */
    const lastI = n - 1;
    const lastPrice = prices[lastI];
    const cumTraded = [0];
    const cumActive = [0];
    const cumBuy = [0];
    const cumSell = [0];
    P.forEach((p, i) => {
      cumTraded.push(cumTraded[i] + p.traded);
      cumActive.push(cumActive[i] + p.active);
      cumBuy.push(cumBuy[i] + p.buy);
      cumSell.push(cumSell[i] + p.sell);
    });

    const payload = (r) => {
      const { startI, highI, base, high } = r;
      const endI = r.endI ?? lastI;
      let prevSpeed = null;
      let top = 0;
      const legs = r.legs.map((leg, k) => {
        const mins = Math.max(RT_LEG.minutes, (tau[leg.highI] - tau[leg.startI]) / 60e3);
        const legSpeed = (100 * Math.log(leg.high / leg.base)) / mins;
        const cls = k === 0 ? "launch" : prevSpeed == null || prevSpeed <= 0 ? "steady"
          : legSpeed >= RT_LEG.accel * prevSpeed ? "accelerating" : legSpeed <= RT_LEG.decel * prevSpeed ? "decelerating" : "steady";
        const live = k === r.legs.length - 1 && r.mode === "pullback" && r.endI == null;
        const pullback = live ? Math.log(leg.high / r.pbLow) : leg.pullback;
        const out = {
          start: times[leg.startI], highTime: times[leg.highI], base: leg.base, high: leg.high,
          gain: rtPct(Math.log(leg.high / leg.base)), speed: legSpeed, cls, higherHigh: leg.high > top,
          pullback: pullback == null ? null : (1 - Math.exp(-pullback)) * 100, pullbackLive: live, afterHalt: leg.halt,
        };
        prevSpeed = legSpeed;
        top = Math.max(top, leg.high);
        return out;
      });
      const volume = cumTraded[endI + 1] - cumTraded[startI + 1];
      const buy = cumBuy[endI + 1] - cumBuy[startI + 1];
      const sell = cumSell[endI + 1] - cumSell[startI + 1];
      const rallyActive = cumActive[endI + 1] - cumActive[startI + 1];
      let beforeVolume = cumTraded[startI + 1];
      let beforeActive = cumActive[startI + 1];
      if (beforeActive < RT_PACE_MIN_ACTIVE) { beforeVolume = cumTraded[n]; beforeActive = cumActive[n]; }
      const startT = times[startI];
      const endT = times[endI];
      return {
        id: r.id, start: startT, trigger: times[r.triggerI], highTime: times[highI], end: r.endI == null ? null : endT,
        active: r.endI == null, endReason: r.reason, base, high, last: prices[endI],
        gain: (high / base - 1) * 100, gainAbs: high - base, lastGain: (prices[endI] / base - 1) * 100,
        giveback: high > base ? (high - prices[endI]) / (high - base) : 0,
        durationMs: tau[highI] - tau[startI], ageMs: tau[endI] - tau[startI], peakSpeed: r.peak, legs,
        alerts: Object.fromEntries(["hod", "buying", "selling"].map((kind) => [kind, countMarks(kind, startT, endT)])),
        halts: spans.filter((h) => h.start <= endT && h.end >= startT).length,
        volume, buyShare: buy + sell > 0 ? buy / (buy + sell) : null,
        relativeVolume: rallyActive > 0 && beforeActive > 0 && beforeVolume > 0 ? (volume / rallyActive) / (beforeVolume / beforeActive) : null,
        firstIndex: startI, lastIndex: endI,
        // Pace (Theil-Sen, %/min) only when read: O(n²), and the active rally's changes with each high
        get pace() {
          return highI - startI >= 2 ? theilSen(minutes.slice(startI, highI + 1), logP.slice(startI, highI + 1), `${times[startI]}|${times[highI]}|${highI - startI}`) : null;
        },
      };
    };
    const out = rallies.map(payload);

    // Points: the rally, its leg and the segment's class (the rise to the leg's high, else pullback)
    const points = P.map((p, i) => ({
      t: p.t, price: p.price, rally: rallyOf[i], gain: gains[i], speed: speed[i], accel: accel[i],
      state: stateOf[i], session: p.session, control: controlOf[i], leg: -1, segment: "",
    }));
    out.forEach((r) => {
      let k = 0;
      for (let i = r.firstIndex; i <= r.lastIndex; i++) {
        if (points[i].rally !== r.id) continue;
        while (k < r.legs.length - 1 && points[i].t >= r.legs[k + 1].start) k++;
        points[i].leg = k;
        points[i].segment = points[i].t < r.legs[k].highTime ? r.legs[k].cls : "pullback";
      }
    });
    const rallyAt = (t) => out.find((r) => t >= r.start && t <= (r.end ?? times[lastI]))?.id ?? -1;

    let key = current;
    let since = currentSince;
    const lastHalt = spans[spans.length - 1];
    if (lastHalt && lastHalt.end === Infinity) { key = "halted"; since = lastHalt.start; }

    // Fade signals of the rally in progress (or of the one that just ended)
    const activeOut = active ? out[active.id] : null;
    const signalRally = activeOut ?? (current === "ended" && out.length ? out[out.length - 1] : null);
    const speedNow = speed[lastI];
    const controlNow = controlAt(times[lastI]);
    const vwapNow = P[lastI].vwap;
    const signals = [];
    if (signalRally) {
      const { legs, peakSpeed: peak } = signalRally;
      const state = rallies[signalRally.id];
      const add = (key2, on, detail) => signals.push({ key: key2, label: RT_SIGNALS[key2], active: Boolean(on), detail });
      add("speed", speedNow != null && peak >= noise[lastI] && speedNow <= RT_STATE.fade * peak,
        speedNow == null || peak <= 0 ? "Not enough data"
          : speedNow <= 0 ? `Price falling at ${Math.abs(speedNow).toFixed(1)}%/min; peak was ${peak.toFixed(1)}%/min`
            : `${speedNow.toFixed(1)}%/min, ${Math.round((speedNow / peak) * 100)}% of the ${peak.toFixed(1)}%/min peak`);
      const [prevLeg, lastLeg] = legs.slice(-2);
      add("legs", legs.length >= 2 && (lastLeg.cls === "decelerating" || !lastLeg.higherHigh),
        legs.length >= 2 ? `Leg ${legs.length} at ${lastLeg.speed.toFixed(1)}%/min vs ${prevLeg.speed.toFixed(1)}%/min${lastLeg.higherHigh ? "" : ", lower high"}` : "Single leg so far");
      const depths = legs.map((l) => l.pullback).filter((v) => v != null);
      add("pullbacks", depths.length >= 2 && depths[depths.length - 1] > depths[depths.length - 2],
        depths.length >= 2 ? `−${depths[depths.length - 1].toFixed(1)}% vs −${depths[depths.length - 2].toFixed(1)}% before`
          : depths.length ? `One pullback of −${depths[0].toFixed(1)}%` : "No pullbacks yet");
      const endI = state.endI ?? lastI;
      const sinceHigh = tau[endI] - tau[state.highI];
      add("highs", sinceHigh >= RT_SIGNAL.noHigh, `Last high ${fmtPrice(state.high)} ${fmtDuration(sinceHigh)} ago`);
      const sellAlerts = countMarks("selling", Math.max(signalRally.start, times[endI] - RT_SIGNAL.alerts), times[endI]);
      const parts = [];
      if (sellAlerts) parts.push(`${sellAlerts} sell alert${sellAlerts === 1 ? "" : "s"} in 5 min`);
      if (controlNow != null) parts.push(`Bull vs. Bear ${fmtSigned(controlNow, 0)}`);
      add("sellers", sellAlerts > 0 || (controlNow != null && controlNow < 0), parts.join(", ") || "No sell alerts");
      const part = Number.isFinite(participation) ? participation : null;
      add("volume", part != null && part < RT_SIGNAL.participation, part != null ? `Recent volume ${part.toFixed(1)}x the session pace` : "No volume data");
      let extended = false;
      let extension = "No VWAP data";
      if (vwapNow) {
        extended = Math.log(lastPrice / vwapNow) >= RT_SIGNAL.z * sig[lastI] * Math.sqrt(RT_SIGNAL.horizon / RT_BASE);
        extension = `${fmtSigned((lastPrice / vwapNow - 1) * 100)}% from VWAP ${fmtPrice(vwapNow)}`;
      }
      add("extended", extended, extension);
    }

    const near = levels.filter((l) => l.type === "support" || l.type === "resistance");
    const above = near.filter((l) => l.price > lastPrice).map((l) => l.price);
    const below = near.filter((l) => l.price < lastPrice).map((l) => l.price);
    const summary = {
      updated: times[lastI], price: lastPrice, rally: active ? active.id : null, lastRally: out.length ? out[out.length - 1].id : null,
      rallies: out.length, speed: speedNow, previousSpeed: previous[lastI], accel: accel[lastI], control: controlNow,
      participation: Number.isFinite(participation) ? participation : null, vwap: vwapNow,
      resistance: above.length ? Math.min(...above) : null, support: below.length ? Math.max(...below) : null,
      // c is the last point's: the low in force when there is no rally
      startThreshold: c.start ?? rtPct(rtStartAt(lastPrice, sig[lastI], RT_START.horizon)),
      legThreshold: rtPct(rtThresholds(lastPrice, sig[lastI])[0]),
      low: active ? null : c.low, rise: active ? null : gains[lastI],
    };
    if (active) {
      const leg = active.legs[active.legs.length - 1];
      const [legT, majorT] = rtThresholds(lastPrice, sig[lastI]);
      const endT = Math.max(legT, Math.min(RT_END.retrace * Math.log(active.high / active.base), majorT));
      const legSpan = leg.high - leg.base;
      const from = Math.max(times[active.startI], times[lastI] - RT_SIGNAL.alerts);
      Object.assign(summary, {
        gain: gains[lastI], failPrice: active.high * Math.exp(-endT),
        pullbackZone: [leg.high - RT_ZONE[1] * legSpan, leg.high - RT_ZONE[0] * legSpan],
        sinceHighMs: tau[lastI] - tau[active.highI],
        buyingAlerts: countMarks("buying", from, times[lastI]), sellingAlerts: countMarks("selling", from, times[lastI]),
      });
    }

    // The detail uses the last point that backed the state, so it never contradicts the label
    const detailCtx = { ...confirmed };
    if (key === "halted" && active) Object.assign(detailCtx, { rally: active.id, gain: gains[lastI] });
    if (key === "sustained" && activeOut) detailCtx.buyShare = activeOut.buyShare;
    return {
      points,
      rallies: out,
      alerts: marks.map((m) => ({ ...m, rally: rallyAt(m.t) })),
      halts: empty.halts,
      status: { key, label: RT_LABELS[key], detail: rtDescribe(key, detailCtx), since, rally: active ? active.id : null },
      signals,
      summary,
    };
  };

  /* ---- Rally tracker chart --------------------------------------------------
     TradingView-style canvas, two panes on one time axis:
     - blocks: each rally a step up from its base (0 %), as wide as it lasted
       and as tall as its gain in %, so tickers of any price compare; colored
       by leg (accelerating / launch, steady, decelerating, pullback between
       legs); what was given back from the high shaded red. Over its high,
       the gain and, above it, the move and the duration (+49¢ · 16m 03s);
     - outside a rally, a thin neutral line: the rise off the 10-minute low
       (brighter while a rally builds) and the dashed Rally trigger it needs;
     - alerts on the curve: New HoD white triangle, Buying / Selling Pressure
       dot; dimmer outside a rally;
     - Levels of the active rally: pullback zone (neutral band), Fails < X
       (red, dotted) and the next Key levels resistance (red; only when within
       1.5× the visible top, so the blocks are never squashed);
     - speed pane: one neutral line, red area under zero (the price falls),
       the dotted Peak of the active rally; the gap between is the fade;
     - Halts shaded (HALT in the speed pane; an open Halt runs the axis to
       now), pre-market / after hours shaded, the state ribbon under both.
     Nothing overlaps: markers go first, then the rally labels (the active
     one first; over the high, else beside it) clear of markers, the curve,
     level lines and the live point, then the level values (right edge,
     moved left past whatever is there); whatever finds no room is left out.
     Axis labels give way to the live tag and the chips; time labels keep
     their width apart. Crosshair (magnet) and keyboard as in Bull vs. Bear.
     The head: state, since, detail, the rally meter (RALLY / LAST / RISE),
     fade signals in one line (+N) and the metrics. Window and Levels are
     saved in localStorage; the data is computed only while in view. */

  const RT_KEY = "scanner:rally-tracker:v1";
  const RT_WINDOWS = [60e3, 300e3, 900e3, 1800e3, 3600e3, 0];
  const RT_MIN_SPAN = 5 * 60e3;      // Day right after the first data still spans 5 minutes
  const RT_STALE = 120e3;            // no update for this long (and no Halt): off the Top List
  const RT_TONE = {
    accelerating: "bull", sustained: "bull", building: "neutral", decelerating: "warn", stalling: "warn",
    pullback: "bear", ended: "neutral", idle: "neutral", warming_up: "neutral", halted: "neutral",
  };
  // Ribbon: color and strength per state, stronger the harder the rally pushes
  const RT_RIBBON = {
    accelerating: ["accel", 0.95], sustained: ["steady", 0.7], building: ["steady", 0.28], decelerating: ["decel", 0.8], stalling: ["decel", 0.45],
    pullback: ["giveback", 0.6], ended: ["neutral", 0.3], idle: ["neutral", 0.12], warming_up: ["neutral", 0.08], halted: ["neutral", 0.45],
  };
  const RT_LEG_NAMES = { launch: "launch", accelerating: "accelerating", steady: "steady", decelerating: "decelerating", pullback: "pullback" };
  const RT_END_REASONS = { pullback: "gave back too much of its gain", stall: "no new high in 10 min" };
  const RT_ALERT_TEXT = { hod: ["▲", "New HoD", "hod"], buying: ["●", "Buying Pressure", "bull"], selling: ["●", "Selling Pressure", "bear"] };
  const RT_STAT_TITLES = {
    gain: "Gain from the rally base (its low) to the current price",
    duration: "Active time from the rally start to its high; halts do not count",
    speed: "Slope of the price over the last 2 minutes, in % per minute; the arrow compares it with 2 minutes earlier",
    fromHigh: "Distance from the rally high and share of the rally gain given back",
    buyFlow: "Share of the rally volume on upticks (Bulk Volume Classification) and Buying / Selling Pressure alerts in the last 5 minutes",
    volume: "Rally volume pace against the day's pace before the rally",
    resistance: "Nearest Key levels resistance above the price",
    support: "Nearest Key levels support below the price",
    fail: "The tracker ends the rally if the price falls below this level",
    rallies: "Rallies detected today",
    lastRally: "Gain of the most recent rally and the time of its high",
    rise: "Rise from the lowest price of the last 10 minutes and the rise that starts a rally",
    control: "Bull vs. Bear control score (−100 sellers to +100 buyers)",
  };
  // +37.1% · −2.2%
  const fmtGain = (v, dp = 1) => (Number.isFinite(v) ? `${fmtSigned(v, dp)}%` : "—");
  // In cents below $1 (+32¢), in dollars from there (+$1.25)
  const fmtMove = (v) => {
    const sign = v > 0 ? "+" : v < 0 ? "−" : "";
    const abs = Math.abs(v);
    if (abs >= 1) return `${sign}$${abs.toFixed(2)}`;
    const cents = abs * 100;
    return `${sign}${cents.toFixed(cents < 1 ? 2 : cents < 10 ? 1 : 0)}¢`;
  };
  const fmtSpeed = (v) => (v == null ? "—" : `${v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%/min`);
  const accelArrow = (a) => (a === 1 ? "▲ " : a === -1 ? "▼ " : "");

  const rtPrefs = { window: 3600e3, levels: true };
  const loadRtPrefs = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(RT_KEY) || "{}");
      rtPrefs.window = RT_WINDOWS.includes(saved.window) ? saved.window : 3600e3;
      rtPrefs.levels = typeof saved.levels === "boolean" ? saved.levels : true;
    } catch { /* ignore */ }
  };
  const saveRtPrefs = () => {
    try { localStorage.setItem(RT_KEY, JSON.stringify(rtPrefs)); } catch { /* ignore */ }
  };
  loadRtPrefs();

  const mountRallyTracker = (view, root) => {
    const box = view.querySelector(".chart-canvas");
    const canvas = box.querySelector("canvas");
    const tip = box.querySelector(".chart-tip");
    const note = box.querySelector(".chart-message");
    const ctx = canvas.getContext("2d");
    const symbol = root.querySelector(".chart-symbol__input");
    const pill = view.querySelector(".chart-state");
    const since = view.querySelector(".chart-since");
    const detail = view.querySelector(".chart-head__detail");
    const meter = view.querySelector(".chart-meter");
    const meterLabel = meter.querySelector(".chart-meter__label");
    const fill = meter.querySelector(".chart-meter__fill");
    const thumb = meter.querySelector(".chart-meter__thumb");
    const score = meter.querySelector(".chart-meter__score");
    const signalsEl = view.querySelector(".chart-signals");
    const stats = view.querySelector(".chart-stats");
    const levelsBtn = view.querySelector("[data-rt-levels]");
    const windowBtns = [...view.querySelectorAll("[data-rt-window]")];
    const intro = detail.textContent;

    // Tokens → canvas colors
    const rootCss = getComputedStyle(document.documentElement);
    const color = (name, fallback) => chartColor(ctx, rootCss, name, fallback);
    const C = {
      bg: color("--chart-bg", "#08090b"),
      grid: color("--chart-grid", "#14181e"),
      bull: color("--chart-bull", "#c8ff38"),
      bear: color("--chart-bear", "#ff4f6b"),
      warn: color("--chart-warn", "#ffb84d"),
      neutral: color("--chart-neutral", "#5d6673"),
      accel: color("--chart-accel", "#c8ff38"),
      steady: color("--chart-steady", "#8fc21a"),
      decel: color("--chart-decel", "#ffb84d"),
      pullback: color("--chart-pullback", "#5d6673"),
      giveback: color("--chart-giveback", "#ff4f6b"),
      fail: color("--chart-fail", "#ff4f6b"),
      zone: color("--chart-zone", "#b4bbc6"),
      rise: color("--chart-rise", "#5d6673"),
      building: color("--chart-building", "#b4bbc6"),
      speed: color("--chart-speed", "#b4bbc6"),
      resistance: color("--chart-resistance", "#ff4f6b"),
      hod: color("--chart-hod", "#f2f4f7"),
      axis: color("--chart-axis-text", "#7b8492"),
      cross: color("--chart-crosshair", "#7b8492"),
      chip: color("--chart-chip", "#1f242c"),
      chipText: color("--text", "#f2f4f7"),
      ink: color("--chart-ink", "#0a0f00"),
      mark: color("--chart-watermark", "#12151a"),
      session: color("--chart-session", "#12151a"),
      line: color("--line", "#23282f"),
    };
    const SANS = rootCss.getPropertyValue("--font-sans").trim() || "sans-serif";
    const MONO = rootCss.getPropertyValue("--font-mono").trim() || "monospace";
    const alpha = chartAlpha;
    const TONE = { bull: C.bull, bear: C.bear, warn: C.warn, neutral: C.neutral };
    const segColor = (s) => ({ launch: C.accel, accelerating: C.accel, decelerating: C.decel, pullback: C.pullback }[s] ?? C.steady);
    const ribbonColor = (key) => {
      const [hue, a] = RT_RIBBON[key] ?? ["neutral", 0.1];
      return alpha(C[hue], a);
    };

    // Strengths and sizes, read from the box: a narrow stage may override them.
    let A = {};
    let G = {};
    const readSizes = () => {
      const css = getComputedStyle(box);
      const num = (name, fallback) => {
        const v = parseFloat(css.getPropertyValue(name));
        return Number.isFinite(v) ? v : fallback;
      };
      A = {
        block: num("--chart-block-a", 0.3), steady: num("--chart-block-steady-a", 0.24), pull: num("--chart-block-pullback-a", 0.14),
        giveback: num("--chart-giveback-a", 0.12), zone: num("--chart-pullzone-a", 0.08), speed: num("--chart-speed-a", 0.12),
        speedDown: num("--chart-speed-down-a", 0.22), off: num("--chart-off-rally-a", 0.5), session: num("--chart-session-a", 0.6), halt: num("--chart-halt-a", 0.12),
      };
      G = {
        axisW: num("--chart-axis-w", 52), axisH: num("--chart-axis-h", 20), pad: num("--chart-pad", 10), live: num("--chart-live-pad", 28),
        tag: num("--chart-tag-h", 18), band: num("--chart-band-h", 6), bandGap: num("--chart-band-gap", 6), paneGap: num("--chart-pane-sep", 10),
        room: num("--chart-rally-room", 30), speedShare: num("--chart-speed-share", 0.27), speedMax: num("--chart-speed-max", 96),
      };
    };

    let feed = null;    // the Bull vs. Bear day: points, alerts, halts, summary
    let data = null;    // computeRallies' result
    let dirty = false;  // new feed data not computed yet (only computed while in view)
    let clock = { t: 0, at: 0 };
    let W = 0;
    let H = 0;
    let frame = 0;
    let geo = null;
    let hover = null;   // index into data.points
    let pointerY = null;

    const now = () => clock.t + (Date.now() - clock.at);
    const inView = () => box.offsetWidth > 0;
    const ticker = () => symbol.value.trim().toUpperCase();
    const message = () => {
      const sym = ticker();
      if (!sym) return "Type a ticker to follow its rallies.";
      if (sym !== BB_SYM) return `Mock data covers ${BB_SYM} only for now: type ${BB_SYM} to see the chart.`;
      if (!data || !data.points.length) return `Waiting for ${sym} alerts and Top List data…`;
      return "";
    };

    /* Data: the feed's Top List updates, Pressure alerts, New HoD (a regular
       session high above the day's, every 3 minutes at most, as in Key
       levels), Halts, Bull vs. Bear control and the Key levels. */
    const refresh = () => {
      dirty = false;
      if (!feed || !feed.points.length) { data = null; return; }
      const samples = feed.points.filter((p) => p.vol != null).map((p) => ({ t: p.t, p: p.price, v: p.vol, w: p.vwap, s: p.session === "pre" ? "pre" : p.session === "post" ? "post" : "rm" }));
      const marks = feed.alerts.map((a) => ({ t: a.t, kind: a.side > 0 ? "buying" : "selling", price: a.price, vol: a.vol }));
      let high = -Infinity;
      let lastHod = -Infinity;
      samples.forEach((s) => {
        if (s.s === "rm" && s.p > high && Number.isFinite(high) && s.t - lastHod >= KL_HOD_EVERY) {
          marks.push({ t: s.t, kind: "hod", price: s.p });
          lastHod = s.t;
        }
        high = Math.max(high, s.p);
      });
      marks.sort((a, b) => a.t - b.t);
      const open = samples.find((s) => s.s === "rm");
      const close = samples[samples.length - 1]?.s === "post" ? samples.findLast((s) => s.s === "rm")?.p : undefined;
      const { levels } = computeKeyLevels(samples, { prevClose: BB_PREV_CLOSE, open: open?.p, close }, feed.alerts);
      data = computeRallies({ samples, marks, halts: feed.halts, control: feed.points, participation: feed.summary?.participation, levels });
      if (!data.points.length) data = null;
    };

    const activeRally = () => (data?.summary && data.summary.rally != null ? data.rallies[data.summary.rally] : null);
    // The rally of the meter and the metrics: the active one or, in Rally ended, the last
    const shownRally = () => {
      const s = data?.summary;
      if (!s) return null;
      if (s.rally != null) return data.rallies[s.rally];
      return data.status.key === "ended" && s.lastRally != null ? data.rallies[s.lastRally] : null;
    };

    /* Head: state, since, detail, meter, fade signals, metrics */
    const renderHead = () => {
      const off = message();
      const d = off ? null : data;
      const s = d?.status;
      const sum = d?.summary;
      pill.dataset.tone = s ? RT_TONE[s.key] : "neutral";
      pill.textContent = s ? s.label : "Waiting for data";
      const parts = s?.since != null ? [`since ${ET_HMS.format(s.since)} ET`] : [];
      if (sum && s.key !== "halted" && now() - sum.updated > RT_STALE) parts.push(`no new data since ${ET_HM.format(sum.updated)} ET`);
      since.textContent = parts.length ? parts.join(" · ") : "since --:--:-- ET";
      detail.textContent = s ? s.detail : intro;
      detail.title = s ? s.detail : "";

      // Levels exist only with an active rally; the saved choice stays.
      const rally = shownRally();
      levelsBtn.disabled = !activeRally();
      levelsBtn.title = levelsBtn.disabled ? "Levels show while a rally is active" : "Show or hide the pullback zone, fail level and next resistance of the active rally";

      // Meter. RALLY / LAST: the price from the base (left) to the high
      // (right). RISE: off the 10-minute low up to the trigger (right edge).
      let mode = "rise";
      let pos = 0;
      let text = "—";
      let label = "Rise";
      let lead = "";
      let valueText = "No data";
      if (sum && rally) {
        const current = rally.active ? sum.price : rally.last;
        const range = rally.high - rally.base;
        pos = range > 0 ? (current - rally.base) / range : 1;
        text = fmtGain((current / rally.base - 1) * 100);
        mode = "rally";
        label = rally.active ? "Rally" : "Last";
        lead = rally.active ? (RT_TONE[s.key] === "bull" ? "bull" : "warn") : "";
        valueText = `${text} from the ${fmtPrice(rally.base)} base, ${Math.round((1 - clampTo(pos, 0, 1)) * 100)}% of the gain given back from the ${fmtPrice(rally.high)} high`;
      } else if (sum) {
        const rise = sum.rise ?? 0;
        pos = sum.startThreshold > 0 ? rise / sum.startThreshold : 0;
        text = fmtGain(rise);
        valueText = `${text} off the low; a rally starts at ${fmtGain(sum.startThreshold)}`;
      }
      pos = clampTo(pos, 0, 1);
      meter.dataset.mode = mode;
      meter.dataset.lead = lead;
      meterLabel.textContent = label;
      fill.style.width = `${pos * 100}%`;
      thumb.style.left = `${pos * 100}%`;
      score.textContent = text;
      meter.title = valueText;
      meter.setAttribute("aria-valuenow", String(Math.round(pos * 100)));
      meter.setAttribute("aria-valuetext", valueText);

      // Fade signals: the active ones as chips; the title lists all seven
      const signals = d?.signals ?? [];
      const on = signals.filter((x) => x.active);
      const count = `<span class="chart-signals__count">Fade signals ${signals.length ? `${on.length}/${signals.length}` : "—"}</span>`;
      signalsEl.innerHTML = count + (!signals.length ? '<span class="chart-signal is-empty">No rally to watch</span>'
        : on.length ? on.map((x) => `<span class="chart-signal" title="${x.detail}">${x.label}</span>`).join("")
          : '<span class="chart-signal is-empty">No signs of slowing</span>');
      signalsEl.title = signals.map((x) => `${x.active ? "●" : "○"} ${x.label}: ${x.detail}`).join("\n");
      fitSignals();

      // Metrics
      const sub = (v) => `<small>${v}</small>`;
      const sign = (v) => (v > 0 ? "up" : v < 0 ? "down" : "");
      const items = [];
      if (sum && rally) {
        const current = rally.active ? sum.price : rally.last;
        const gain = (current / rally.base - 1) * 100;
        const drawdown = (1 - current / rally.high) * 100;
        const back = rally.high > rally.base ? (rally.high - current) / (rally.high - rally.base) : 0;
        items.push(["Gain", `${fmtGain(gain)}${sub(fmtMove(current - rally.base))}`, sign(gain), RT_STAT_TITLES.gain]);
        items.push(["Duration", fmtDuration(rally.durationMs), "", RT_STAT_TITLES.duration]);
        if (rally.active) items.push(["Speed", `${accelArrow(sum.accel)}${fmtSpeed(sum.speed)}${sub(`peak ${rally.peakSpeed.toFixed(1)}`)}`, sum.accel === 1 ? "up" : sum.accel === -1 || sum.speed < 0 ? "down" : "", RT_STAT_TITLES.speed]);
        // Under 0.05 % it rounds to 0.0 %: at the high
        const below = drawdown >= 0.05;
        items.push(["From high", below ? `${fmtGain(-drawdown)}${sub(`${Math.round(back * 100)}% back`)}` : "At high", below ? "down" : "up", RT_STAT_TITLES.fromHigh]);
        items.push(["Buy flow", `${rally.buyShare == null ? "—" : `${Math.round(rally.buyShare * 100)}%`}${rally.active ? sub(`${sum.buyingAlerts}↑ ${sum.sellingAlerts}↓`) : ""}`,
          rally.buyShare >= 0.55 ? "up" : rally.buyShare != null && rally.buyShare <= 0.45 ? "down" : "", RT_STAT_TITLES.buyFlow]);
        items.push(["Volume", rally.relativeVolume == null ? "—" : `${rally.relativeVolume.toFixed(1)}x`, "", RT_STAT_TITLES.volume]);
        if (rally.active) {
          items.push(["Next R", sum.resistance != null ? `${fmtPrice(sum.resistance)}${sub(fmtGain((sum.resistance / sum.price - 1) * 100))}` : "—", "", RT_STAT_TITLES.resistance]);
          items.push(["Fails <", fmtPrice(sum.failPrice), "", RT_STAT_TITLES.fail]);
        }
      } else if (sum) {
        const lastR = sum.lastRally != null ? d.rallies[sum.lastRally] : null;
        items.push(["Rallies", String(sum.rallies), "", RT_STAT_TITLES.rallies]);
        items.push(["Last rally", lastR ? `${fmtGain(lastR.gain)}${sub(ET_HM.format(lastR.highTime))}` : "—", lastR ? "up" : "", RT_STAT_TITLES.lastRally]);
        items.push(["Off the low", `${fmtGain(sum.rise)}${sub(`of ${fmtGain(sum.startThreshold)}`)}`, "", RT_STAT_TITLES.rise]);
        items.push(["Speed", `${accelArrow(sum.accel)}${fmtSpeed(sum.speed)}`, sign(sum.speed ?? 0), RT_STAT_TITLES.speed]);
        items.push(["Bull vs. Bear", sum.control == null ? "—" : fmtScore(sum.control), sign(Math.round(sum.control ?? 0)), RT_STAT_TITLES.control]);
        items.push(["Next R", sum.resistance != null ? fmtPrice(sum.resistance) : "—", "", RT_STAT_TITLES.resistance]);
        items.push(["Support", sum.support != null ? fmtPrice(sum.support) : "—", "", RT_STAT_TITLES.support]);
      } else {
        ["Rallies", "Last rally", "Off the low", "Speed", "Bull vs. Bear", "Next R", "Support"].forEach((name) => items.push([name, null, "", ""]));
      }
      stats.innerHTML = items.map(([name, value, sg, title]) => (
        `<div${title ? ` title="${title}"` : ""}><dt>${name}</dt><dd${sg ? ` data-sign="${sg}"` : ""}>${value ?? "—"}</dd></div>`
      )).join("");
    };

    // The signals keep one line: the ones that do not fit fold into "+N"
    const fitSignals = () => {
      const chips = [...signalsEl.querySelectorAll(".chart-signal:not(.is-empty)")];
      chips.forEach((chip) => { chip.hidden = false; });
      if (!chips.length || signalsEl.scrollWidth <= signalsEl.clientWidth) return;
      const more = document.createElement("span");
      more.className = "chart-signal chart-signal--more";
      signalsEl.append(more);
      let folded = 0;
      for (let i = chips.length - 1; i > 0 && signalsEl.scrollWidth > signalsEl.clientWidth; i--) {
        chips[i].hidden = true;
        more.textContent = `+${++folded}`;
      }
      if (!folded) more.remove();
    };

    // Levels of the active rally, in % over its base
    const overlaysOf = () => {
      const r = activeRally();
      const s = data.summary;
      if (!rtPrefs.levels || !r) return [];
      const gainOf = (p) => (p / r.base - 1) * 100;
      const out = [];
      const leg = r.legs[r.legs.length - 1];
      if (s.pullbackZone && leg) out.push({ kind: "zone", from: leg.start, low: gainOf(s.pullbackZone[0]), high: gainOf(s.pullbackZone[1]), prices: s.pullbackZone });
      if (s.failPrice > 0) out.push({ kind: "fail", from: r.start, gain: gainOf(s.failPrice), price: s.failPrice });
      if (s.resistance > 0) out.push({ kind: "resistance", from: r.start, gain: gainOf(s.resistance), price: s.resistance });
      return out;
    };

    /* Geometry: gain pane on top, speed pane under it, the ribbon and the
       time axis below. The live point sits `live` px from the axis. */
    const geometry = () => {
      const { points, rallies, halts, summary } = data;
      const right = W - G.axisW;
      const timeTop = H - G.axisH;
      const band = timeTop - G.bandGap - G.band;
      const speedBottom = band - G.bandGap;
      const top = G.pad;
      const speedH = Math.round(clampTo(Math.max(80, speedBottom - top) * G.speedShare, 28, G.speedMax));
      const speedTop = speedBottom - speedH;
      const mainBottom = Math.max(top + G.room + 30, speedTop - G.paneGap);
      const gainTop = top + G.room;
      const lastT = points[points.length - 1].t;
      // An open Halt runs the axis to now: the pause grows to the right
      const end = Math.max(lastT, halts.some((h) => h.end == null) ? now() : 0);
      let start = rtPrefs.window ? end - rtPrefs.window : points[0].t;
      const minSpan = Math.min(RT_MIN_SPAN, rtPrefs.window || Infinity);
      if (end - start < minSpan) start = end - minSpan;
      const usable = Math.max(1, right - G.live);
      const first = indexAt(points, start);
      const overlays = overlaysOf();

      // Gain: 0 at the bottom; on top the highest visible block, the trigger,
      // and the levels within 1.5× of that; round steps
      let high = 0;
      let low = 0;
      for (let i = first; i < points.length; i++) { high = Math.max(high, points[i].gain); low = Math.min(low, points[i].gain); }
      rallies.forEach((r) => { if ((r.end ?? end) >= start && r.start <= end) high = Math.max(high, r.gain); });
      if (summary.rally == null && Number.isFinite(summary.startThreshold)) high = Math.max(high, summary.startThreshold);
      const reach = Math.max(high, 1);
      overlays.forEach((o) => {
        const v = o.kind === "zone" ? o.high : o.gain;
        if (v <= reach * 1.5) high = Math.max(high, v);
        if (o.kind !== "resistance") low = Math.min(low, o.kind === "zone" ? o.low : o.gain);
      });
      const gainPx = Math.max(1, mainBottom - gainTop);
      const gainStep = niceStep(Math.max(Math.max(high, 1) / 4, ((high - low) / gainPx) * 18));
      const gainMax = Math.max(gainStep, Math.ceil((high * 1.02) / gainStep) * gainStep);
      const gainMin = low < 0 ? -Math.min(gainMax / 2, Math.ceil(-low / gainStep) * gainStep) : 0;

      // Speed: 0 in the pane; the active rally's peak always fits
      let sHigh = 0;
      let sLow = 0;
      for (let i = first; i < points.length; i++) {
        const v = points[i].speed;
        if (v != null) { sHigh = Math.max(sHigh, v); sLow = Math.min(sLow, v); }
      }
      const act = activeRally();
      if (act) sHigh = Math.max(sHigh, act.peakSpeed);
      const speedStep = niceStep(Math.max(sHigh, -sLow, 1) / 2);
      const speedMax = Math.max(speedStep, Math.ceil(sHigh / speedStep) * speedStep);
      const speedMin = sLow < 0 ? -Math.min(speedMax, Math.ceil(-sLow / speedStep) * speedStep) : 0;

      return {
        right, timeTop, band, top, gainTop, mainBottom, speedTop, speedBottom, start, end, usable, first, overlays,
        gainStep, gainMin, gainMax, speedMin, speedMax, act,
        x: (t) => ((t - start) / (end - start)) * usable,
        y: (v) => mainBottom - ((v - gainMin) / (gainMax - gainMin)) * (mainBottom - gainTop),
        yS: (v) => speedBottom - ((clampTo(v, speedMin, speedMax) - speedMin) / (speedMax - speedMin)) * (speedBottom - speedTop),
      };
    };

    const axisTag = (g, y, text, bg, ink) => {
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.roundRect(g.right + 3, y - G.tag / 2, G.axisW - 6, G.tag, 3);
      ctx.fill();
      ctx.fillStyle = ink;
      ctx.font = `700 10.5px ${MONO}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, g.right + G.axisW / 2, y + 0.5);
    };
    // Text with a background outline, so a line under it never cuts it
    const label = (text, x, y, hue, font, align = "center", baseline = "middle") => {
      ctx.font = font;
      ctx.textAlign = align;
      ctx.textBaseline = baseline;
      ctx.lineWidth = 3;
      ctx.strokeStyle = C.bg;
      ctx.strokeText(text, x, y);
      ctx.fillStyle = hue;
      ctx.fillText(text, x, y);
    };
    const overlaps = (a, b, gap = 3) => a.left < b.right + gap && b.left < a.right + gap && a.top < b.bottom + gap && b.top < a.bottom + gap;
    const dashed = (y, left, right, hue, dash) => {
      ctx.setLineDash(dash);
      ctx.strokeStyle = hue;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(left, crisp(y));
      ctx.lineTo(right, crisp(y));
      ctx.stroke();
      ctx.setLineDash([]);
    };

    const draw = () => {
      if (!W || !H) return;
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, W, H);
      const off = message();
      note.textContent = off;
      note.hidden = !off;
      if (off) {
        geo = null;
        tip.hidden = true;
        canvas.setAttribute("aria-label", `Rally tracker chart. ${off}`);
        return;
      }

      const { points, rallies, alerts, halts, status, summary } = data;
      const last = points[points.length - 1];
      const g = (geo = geometry());
      const { right, timeTop, top, gainTop, mainBottom, speedTop, speedBottom, start, end, usable, first, overlays, act, x, y, yS } = g;
      const zeroY = y(0);
      const liveX = x(end);
      const liveY = y(last.gain);
      ctx.lineJoin = "round";
      ctx.lineCap = "butt";

      // Time ticks: the smallest step whose labels keep their width apart
      ctx.font = `500 10.5px ${MONO}`;
      const span = end - start;
      const labelW = (step) => ctx.measureText(step < 60e3 ? "00:00:00" : "00:00").width + 24;
      const step = BB_TIME_STEPS.find((s) => (s / span) * usable >= labelW(s)) || BB_TIME_STEPS[BB_TIME_STEPS.length - 1];
      const tickFmt = step < 60e3 ? ET_HMS : ET_HM;
      const ticks = [];
      for (let t = Math.ceil(start / step) * step; t <= end; t += step) ticks.push({ x: x(t), t });
      const gainTicks = [];
      for (let v = g.gainMin; v <= g.gainMax + 1e-9; v += g.gainStep) gainTicks.push(round(v, 6));

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, right, speedBottom);
      ctx.clip();

      // Pre-market / after hours, one band per run; Halts shaded
      for (let i = first; i < points.length - 1; i++) {
        const s = points[i].session;
        if (s === "rm") continue;
        let j = i;
        while (j < points.length - 1 && points[j].session === s) j++;
        ctx.fillStyle = alpha(C.session, A.session);
        ctx.fillRect(x(points[i].t), 0, x(points[j].t) - x(points[i].t), speedBottom);
        i = j - 1;
      }
      const haltSpans = halts
        .map((h) => ({ l: Math.max(0, x(h.start)), r: Math.min(right, x(h.end ?? end)) }))
        .filter((s) => s.r > s.l);
      ctx.fillStyle = alpha(C.neutral, A.halt);
      haltSpans.forEach((s) => ctx.fillRect(s.l, 0, s.r - s.l, speedBottom));

      // Ticker watermark, grid, the line between the panes
      ctx.font = `800 ${Math.round(clampTo(W * 0.11, 28, 84))}px ${SANS}`;
      ctx.fillStyle = C.mark;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(ticker(), usable / 2, (gainTop + mainBottom) / 2);
      ctx.strokeStyle = C.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      gainTicks.forEach((v) => { if (v) { ctx.moveTo(0, crisp(y(v))); ctx.lineTo(right, crisp(y(v))); } });
      ticks.forEach((tick) => { ctx.moveTo(crisp(tick.x), 0); ctx.lineTo(crisp(tick.x), speedBottom); });
      ctx.moveTo(0, crisp(speedTop - G.paneGap / 2));
      ctx.lineTo(right, crisp(speedTop - G.paneGap / 2));
      ctx.stroke();

      /* Gain pane */
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, right, speedTop - G.paneGap / 2);
      ctx.clip();

      // Outside the rallies: the rise off the 10-minute low (brighter while one builds)
      const rise = new Path2D();
      const building = new Path2D();
      for (let i = first; i < points.length - 1; i++) {
        const p = points[i];
        const q = points[i + 1];
        if (p.rally >= 0) continue;
        const path = p.state === "building" ? building : rise;
        path.moveTo(x(p.t), y(p.gain));
        path.lineTo(x(q.t), y(p.gain));
        if (q.rally < 0) path.lineTo(x(q.t), y(q.gain));
      }
      ctx.lineWidth = 1;
      ctx.strokeStyle = C.rise;
      ctx.stroke(rise);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = C.building;
      ctx.stroke(building);

      // Level lines: what labels must keep off, with the curve
      const lines = [];
      const tags = []; // level values, placed after the rally labels
      if (!act && Number.isFinite(summary.startThreshold)) {
        const before = rallies[rallies.length - 1];
        const left = Math.max(0, before ? x(before.end ?? before.highTime) : 0);
        const ty = y(summary.startThreshold);
        dashed(ty, left, right, alpha(C.building, 0.6), [3, 4]);
        lines.push({ left, right, top: ty - 1, bottom: ty + 1 });
        tags.push({ y: ty, text: `Rally trigger ${fmtGain(summary.startThreshold)}`, hue: C.building });
      }

      // Blocks: a step per point from the base, colored by leg; given back shaded
      const visible = rallies.filter((r) => (r.end ?? end) >= start && r.start <= end);
      const outlines = new Map();
      const outline = (hue) => {
        if (!outlines.has(hue)) outlines.set(hue, new Path2D());
        return outlines.get(hue);
      };
      visible.forEach((r) => {
        let top2 = 0;
        for (let i = r.firstIndex; i < r.lastIndex; i++) {
          const p = points[i];
          const q = points[i + 1];
          // Whole-pixel edges: translucent fills never overlap into stripes
          const l = Math.round(x(p.t));
          const rr = Math.round(x(q.t));
          top2 = Math.max(top2, p.gain);
          if (rr <= l || rr < 0 || l > right) continue;
          const py = y(p.gain);
          const hue = segColor(p.segment);
          ctx.fillStyle = alpha(hue, p.segment === "pullback" ? A.pull : p.segment === "steady" ? A.steady : A.block);
          ctx.fillRect(l, Math.min(py, zeroY), rr - l, Math.abs(zeroY - py));
          if (top2 > p.gain) {
            ctx.fillStyle = alpha(C.giveback, A.giveback);
            ctx.fillRect(l, y(top2), rr - l, py - y(top2));
          }
          const path = outline(hue);
          if (i === r.firstIndex) { path.moveTo(x(p.t), zeroY); path.lineTo(x(p.t), py); } else path.moveTo(x(p.t), py);
          path.lineTo(x(q.t), py);
          path.lineTo(x(q.t), y(q.gain));
        }
        if (!r.active) {
          const lp = points[r.lastIndex];
          const path = outline(alpha(C.pullback, 0.6));
          path.moveTo(x(lp.t), y(lp.gain));
          path.lineTo(x(lp.t), zeroY);
        }
      });
      // An open Halt: the last price stays frozen up to now
      if (end > last.t) {
        const l = x(last.t);
        const hue = last.rally >= 0 ? segColor(last.segment) : C.rise;
        if (last.rally >= 0) {
          ctx.fillStyle = alpha(hue, A.pull);
          ctx.fillRect(l, Math.min(liveY, zeroY), liveX - l, Math.abs(zeroY - liveY));
        }
        const path = outline(hue);
        path.moveTo(l, liveY);
        path.lineTo(liveX, liveY);
      }
      ctx.lineWidth = 1.75;
      outlines.forEach((path, hue) => {
        ctx.strokeStyle = hue;
        ctx.stroke(path);
      });
      ctx.strokeStyle = alpha(C.neutral, 0.6);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, crisp(zeroY));
      ctx.lineTo(right, crisp(zeroY));
      ctx.stroke();

      // The curve as boxes-free segments (axis-aligned steps)
      const segs = [];
      for (let i = first; i < points.length - 1; i++) {
        const x0 = x(points[i].t);
        const x1 = x(points[i + 1].t);
        if (x1 < 0 || x0 > right) continue;
        const y0 = y(points[i].gain);
        segs.push({ left: x0, right: x1, top: y0, bottom: y0 });
        segs.push({ left: x1, right: x1, top: Math.min(y0, y(points[i + 1].gain)), bottom: Math.max(y0, y(points[i + 1].gain)) });
      }
      if (end > last.t) segs.push({ left: x(last.t), right: liveX, top: liveY, bottom: liveY });

      // Levels of the active rally
      overlays.forEach((o) => {
        const left = Math.max(0, x(o.from));
        if (o.kind === "zone") {
          const zt = y(o.high);
          const zb = y(o.low);
          if (zb < top || zt > mainBottom) return;
          ctx.fillStyle = alpha(C.zone, A.zone);
          ctx.fillRect(left, zt, right - left, Math.max(1, zb - zt));
          const [lo, hi] = o.prices.map(fmtPrice);
          tags.push({ y: (zt + zb) / 2, text: `Pullback zone ${lo === hi ? lo : `${lo}–${hi}`}`, hue: C.zone, zone: true });
          return;
        }
        const ly = y(o.gain);
        if (ly < top - 4 || ly > mainBottom + 4) return;
        const hue = o.kind === "fail" ? C.fail : C.resistance;
        if (o.kind === "fail") dashed(ly, left, right, alpha(hue, 0.85), [2, 3]);
        else {
          ctx.strokeStyle = alpha(hue, 0.6);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(left, crisp(ly));
          ctx.lineTo(right, crisp(ly));
          ctx.stroke();
        }
        lines.push({ left, right, top: ly - 1, bottom: ly + 1 });
        tags.push({ y: ly, text: o.kind === "fail" ? `Fails < ${fmtPrice(o.price)}` : `R ${fmtPrice(o.price)}`, hue });
      });

      // Markers: New HoD over the curve, Pressure dots on it; dimmer off a rally
      const placed = [{ left: liveX - 8, right: liveX + 8, top: liveY - 8, bottom: liveY + 8 }];
      const hitsCurve = (b) => segs.some((s) => overlaps(b, s, 1));
      const marks = alerts
        .filter((a) => a.t >= start && a.t <= end && RT_ALERT_TEXT[a.kind])
        .map((a) => ({ ...a, x: x(a.t), y: y(points[indexAt(points, a.t)].gain) }))
        .sort((a, b) => (b.kind === "hod") - (a.kind === "hod") || (b.vol ?? 0) - (a.vol ?? 0));
      const drawn = [];
      marks.forEach((m) => {
        if (m.kind === "hod") {
          for (let k = 0; k < 4; k++) {
            const b = { left: m.x - 5, right: m.x + 5, top: m.y - 6 - 9 - k * 11, bottom: m.y - 6 - k * 11 };
            if (b.top < 0 || placed.some((o) => overlaps(b, o, 1)) || hitsCurve(b)) continue;
            placed.push(b);
            drawn.push({ ...m, box: b });
            return;
          }
          return;
        }
        const b = { left: m.x - 3, right: m.x + 3, top: m.y - 3, bottom: m.y + 3 };
        if (placed.some((o) => overlaps(b, o, 1))) return;
        placed.push(b);
        drawn.push({ ...m, box: b });
      });
      drawn.forEach((m) => {
        const a = m.rally >= 0 ? 1 : A.off;
        ctx.strokeStyle = C.bg;
        if (m.kind === "hod") {
          const b = m.box;
          if (b.bottom < m.y - 7) {
            ctx.strokeStyle = alpha(C.hod, 0.45 * a);
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(crisp(m.x), m.y - 2);
            ctx.lineTo(crisp(m.x), b.bottom + 1);
            ctx.stroke();
            ctx.strokeStyle = C.bg;
          }
          ctx.lineWidth = 2;
          ctx.fillStyle = alpha(C.hod, a);
          ctx.beginPath();
          ctx.moveTo(m.x, b.top);
          ctx.lineTo(b.right, b.bottom);
          ctx.lineTo(b.left, b.bottom);
          ctx.closePath();
          ctx.stroke();
          ctx.fill();
          return;
        }
        const hue = m.kind === "buying" ? C.bull : C.bear;
        ctx.fillStyle = alpha(hue, 0.28 * a);
        ctx.beginPath();
        ctx.arc(m.x, m.y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = alpha(hue, a);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(m.x, m.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });

      // Rally labels over their high: the gain, and above it the move and
      // the duration. The active rally picks first; over the high, else beside it.
      const free = (b) => b.left >= 2 && b.right <= right - 2 && b.top >= 0 && b.bottom <= mainBottom
        && !placed.some((o) => overlaps(b, o, 2)) && !lines.some((o) => overlaps(b, o, 1)) && !hitsCurve(b);
      const MAIN = `700 11px ${MONO}`;
      const SUB = `500 10px ${MONO}`;
      [...visible].sort((a, b) => Number(b.active) - Number(a.active) || b.gain - a.gain).forEach((r) => {
        const hx = x(r.highTime);
        const hy = y(r.gain);
        const main = fmtGain(r.gain);
        const sub = `${fmtMove(r.gainAbs)} · ${fmtDuration(r.durationMs)}`;
        ctx.font = MAIN;
        const mw = ctx.measureText(main).width;
        ctx.font = SUB;
        const w = Math.max(mw, ctx.measureText(sub).width) + 6;
        const h = 27;
        const cx = clampTo(hx, w / 2 + 2, right - w / 2 - 2);
        const spots = [0, 1, 2, 3].map((k) => ({ left: cx - w / 2, right: cx + w / 2, top: hy - 6 - h - k * 12, bottom: hy - 6 - k * 12 }));
        spots.push({ left: hx - 8 - w, right: hx - 8, top: hy + 4, bottom: hy + 4 + h }, { left: hx + 8, right: hx + 8 + w, top: hy + 4, bottom: hy + 4 + h });
        const b = spots.find(free);
        if (!b) return;
        placed.push(b);
        const mx = (b.left + b.right) / 2;
        label(sub, mx, b.top + 6, C.axis, SUB);
        label(main, mx, b.bottom - 6, segColor(r.active ? points[r.lastIndex].segment : "steady"), MAIN);
      });

      // Level values at the right edge, over (else under) their line; moved
      // left past whatever is there; none fits: no value.
      ctx.font = `600 10px ${MONO}`;
      tags.forEach((tag) => {
        const w = ctx.measureText(tag.text).width;
        const rows = tag.zone ? [[tag.y - 6, tag.y + 6]] : [[tag.y - 14, tag.y - 2], [tag.y + 2, tag.y + 14]];
        for (const [t0, t1] of rows) {
          for (let r0 = right - 6; r0 - w >= 4; r0 -= 8) {
            const b = { left: r0 - w, right: r0, top: t0, bottom: t1 };
            if (b.top < 0 || b.bottom > mainBottom) break;
            if (placed.some((o) => overlaps(b, o, 2)) || hitsCurve(b) || lines.some((o) => o.top !== tag.y - 1 && overlaps(b, o, 1))) continue;
            placed.push(b);
            label(tag.text, r0, (t0 + t1) / 2, tag.hue, `600 10px ${MONO}`, "right");
            return;
          }
        }
      });

      // Live point: on the active rally's block or on the rise line
      const tone = TONE[RT_TONE[status.key]] ?? C.neutral;
      ctx.fillStyle = alpha(tone, 0.18);
      ctx.beginPath();
      ctx.arc(liveX, liveY, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = tone;
      ctx.strokeStyle = C.bg;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(liveX, liveY, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      /* Speed pane: one line, cut at Halts; red under zero; the active rally's peak */
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, speedTop, right, speedBottom - speedTop);
      ctx.clip();
      const sZero = yS(0);
      const runs = [];
      let run = [];
      for (let i = first; i < points.length; i++) {
        const p = points[i];
        const prev = i > first ? points[i - 1] : null;
        const cut = p.speed == null || (prev && halts.some((h) => h.start >= prev.t && h.start < p.t));
        if (cut && run.length) runs.push(run);
        if (cut) run = [];
        if (p.speed != null) run.push(p);
      }
      if (run.length) runs.push(run);
      const speedSegs = [];
      runs.forEach((pts) => {
        const path = new Path2D();
        pts.forEach((p, k) => {
          const px = x(p.t);
          const py = yS(p.speed);
          if (k) {
            path.lineTo(px, py);
            const q = pts[k - 1];
            speedSegs.push({ left: Math.min(x(q.t), px), right: Math.max(x(q.t), px), top: Math.min(yS(q.speed), py), bottom: Math.max(yS(q.speed), py) });
          } else path.moveTo(px, py);
        });
        const area = new Path2D(path);
        area.lineTo(x(pts[pts.length - 1].t), sZero);
        area.lineTo(x(pts[0].t), sZero);
        area.closePath();
        ctx.save();
        ctx.clip(area);
        ctx.fillStyle = alpha(C.speed, A.speed);
        ctx.fillRect(0, speedTop, right, sZero - speedTop);
        ctx.fillStyle = alpha(C.giveback, A.speedDown);
        ctx.fillRect(0, sZero, right, speedBottom - sZero);
        ctx.restore();
        ctx.strokeStyle = alpha(C.speed, 0.9);
        ctx.lineWidth = 1.5;
        ctx.lineJoin = "round";
        ctx.stroke(path);
      });
      ctx.strokeStyle = alpha(C.neutral, 0.6);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, crisp(sZero));
      ctx.lineTo(right, crisp(sZero));
      ctx.stroke();
      const speedPlaced = [];
      const speedFree = (b) => b.top >= speedTop + 1 && b.bottom <= speedBottom - 1 && b.left >= 2 && b.right <= right - 2
        && !speedSegs.some((s) => overlaps(b, s, 1)) && !speedPlaced.some((o) => overlaps(b, o, 4));
      // Pane title, top left (bottom left when the line passes there)
      ctx.font = `700 9px ${MONO}`;
      const titleW = ctx.measureText("SPEED %/MIN").width;
      const title = [speedTop + 3, speedBottom - 14].map((t0) => ({ left: 6, right: 6 + titleW, top: t0, bottom: t0 + 11 })).find(speedFree);
      if (title) {
        speedPlaced.push(title);
        label("SPEED %/MIN", title.left, (title.top + title.bottom) / 2, C.axis, `700 9px ${MONO}`, "left");
      }
      if (act && act.peakSpeed > 0) {
        const py = yS(act.peakSpeed);
        const left = Math.max(0, x(act.start));
        dashed(py, left, right, alpha(C.speed, 0.6), [2, 3]);
        // Its name on the line (the value is the axis tag): right end, else left end
        ctx.font = `600 10px ${MONO}`;
        const w = ctx.measureText("Peak").width;
        const rows = [[py - 13, py - 2], [py + 2, py + 13]];
        const spot = [right - 6 - w, left + 6].flatMap((l) => rows.map(([t0, t1]) => ({ left: l, right: l + w, top: t0, bottom: t1 }))).find(speedFree);
        if (spot) {
          speedPlaced.push(spot);
          label("Peak", spot.left, (spot.top + spot.bottom) / 2, C.axis, `600 10px ${MONO}`, "left");
        }
      }
      // HALT: centered in its pause when the pause is wide enough
      ctx.font = `700 9.5px ${MONO}`;
      const haltW = ctx.measureText("HALT").width + 12;
      haltSpans.forEach((s) => {
        if (s.r - s.l < haltW + 4) return;
        const b = { left: (s.l + s.r - haltW) / 2, right: (s.l + s.r + haltW) / 2, top: (speedTop + speedBottom) / 2 - 8, bottom: (speedTop + speedBottom) / 2 + 8 };
        if (speedPlaced.some((o) => overlaps(b, o, 2))) return;
        ctx.fillStyle = C.chip;
        ctx.beginPath();
        ctx.roundRect(b.left, b.top, haltW, 16, 4);
        ctx.fill();
        ctx.fillStyle = C.axis;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("HALT", b.left + haltW / 2, b.top + 8.5);
      });
      ctx.restore();
      ctx.restore();

      // State ribbon: one run per state
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(0, g.band, right, G.band, G.band / 2);
      ctx.clip();
      ctx.fillStyle = alpha(C.neutral, 0.1);
      ctx.fillRect(0, g.band, right, G.band);
      for (let i = first; i < points.length - 1; i++) {
        let j = i + 1;
        while (j < points.length - 1 && points[j].state === points[i].state) j++;
        const l = Math.max(0, x(points[i].t));
        ctx.fillStyle = ribbonColor(points[i].state);
        ctx.fillRect(l, g.band, x(points[j].t) - l, G.band);
        i = j - 1;
      }
      if (end > last.t) {
        ctx.fillStyle = ribbonColor(last.state);
        ctx.fillRect(x(last.t), g.band, liveX - x(last.t), G.band);
      }
      haltSpans.forEach((s) => {
        ctx.fillStyle = C.bg;
        ctx.fillRect(s.l, g.band, s.r - s.l, G.band);
        ctx.fillStyle = ribbonColor("halted");
        ctx.fillRect(s.l, g.band, s.r - s.l, G.band);
      });
      ctx.restore();

      // Crosshair target (magnet: the nearest point)
      const h = hover == null ? null : clampTo(hover, first, points.length - 1);
      const hp = h == null ? null : points[h];
      ctx.font = `600 10.5px ${MONO}`;
      const hoverTime = hp && ET_HMS.format(hp.t);
      const timeChip = hp && (() => {
        const w = ctx.measureText(hoverTime).width + 14;
        return { l: clampTo(x(hp.t) - w / 2, 0, right - w), w };
      })();

      // Axes: background, borders, gain and speed labels, live tag, time labels
      ctx.fillStyle = C.bg;
      ctx.fillRect(right, 0, W - right, H);
      ctx.fillRect(0, timeTop, W, H - timeTop);
      ctx.strokeStyle = C.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(crisp(right), 0);
      ctx.lineTo(crisp(right), timeTop);
      ctx.moveTo(0, crisp(timeTop));
      ctx.lineTo(W, crisp(timeTop));
      ctx.stroke();

      const tagY = clampTo(liveY, G.tag / 2, mainBottom);
      const chipY = hp ? clampTo(y(hp.gain), G.tag / 2, mainBottom) : null;
      const blocked = [tagY, ...(chipY != null ? [chipY] : [])];
      const dp = g.gainStep < 1 ? 1 : 0;
      ctx.font = `500 10.5px ${MONO}`;
      ctx.fillStyle = C.axis;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      gainTicks.forEach((v) => {
        const ly = y(v);
        if (ly < gainTop - 4 || blocked.some((b) => Math.abs(b - ly) < G.tag / 2 + 7)) return;
        ctx.fillText(`${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(dp)}%`, right + G.axisW / 2, ly);
      });
      // Speed tags: the live speed (neutral) and the active rally's peak
      // (chip); the peak goes when the pane has no room for both.
      const fmtS = (v) => `${v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}`;
      const speedTags = [];
      if (last.speed != null) speedTags.push({ y: yS(last.speed), text: fmtS(last.speed), bg: C.speed, ink: C.ink });
      if (act && act.peakSpeed > 0 && speedBottom - speedTop >= 2 * (G.tag + 2)) speedTags.push({ y: yS(act.peakSpeed), text: fmtS(act.peakSpeed), bg: C.chip, ink: C.chipText });
      spreadTags(speedTags, speedTop + G.tag / 2, speedBottom - G.tag / 2, G.tag + 2);
      ctx.font = `500 9.5px ${MONO}`;
      ctx.fillStyle = C.axis;
      let lastSpeedLabel = -Infinity;
      [[g.speedMax, speedTop + 6], [0, sZero], ...(g.speedMin < 0 ? [[g.speedMin, speedBottom - 6]] : [])].forEach(([v, ly]) => {
        const at = clampTo(ly, speedTop + 6, speedBottom - 6);
        if (at - lastSpeedLabel < 12 || speedTags.some((tag) => Math.abs(tag.y - at) < G.tag / 2 + 6)) return;
        lastSpeedLabel = at;
        ctx.fillText(`${v < 0 ? "−" : ""}${Math.abs(v).toFixed(Number.isInteger(v) ? 0 : 1)}`, right + G.axisW / 2, at);
      });
      speedTags.forEach((tag) => axisTag(g, tag.y, tag.text, tag.bg, tag.ink));
      axisTag(g, tagY, fmtGain(last.gain), tone, C.ink);

      ctx.font = `500 10.5px ${MONO}`;
      ctx.fillStyle = C.axis;
      ticks.forEach((tick) => {
        const text = tickFmt.format(tick.t);
        const w = ctx.measureText(text).width;
        if (tick.x - w / 2 < 2 || tick.x + w / 2 > right - 2) return;
        if (timeChip && tick.x + w / 2 > timeChip.l - 4 && tick.x - w / 2 < timeChip.l + timeChip.w + 4) return;
        ctx.fillText(text, tick.x, timeTop + G.axisH / 2);
      });

      // Crosshair: dashed lines, the point (and its speed), chips, hover card
      if (hp) {
        const hx = x(hp.t);
        const hy = y(hp.gain);
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = alpha(C.cross, 0.8);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(crisp(hx), 0);
        ctx.lineTo(crisp(hx), timeTop);
        ctx.moveTo(0, crisp(hy));
        ctx.lineTo(right, crisp(hy));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = C.bg;
        ctx.lineWidth = 2;
        ctx.fillStyle = hp.rally >= 0 ? segColor(hp.segment) : C.rise;
        ctx.beginPath();
        ctx.arc(hx, hy, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        if (hp.speed != null) {
          ctx.fillStyle = C.speed;
          ctx.beginPath();
          ctx.arc(hx, yS(hp.speed), 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
        axisTag(g, chipY, fmtGain(hp.gain), C.chip, C.chipText);
        ctx.fillStyle = C.chip;
        ctx.beginPath();
        ctx.roundRect(timeChip.l, timeTop + 2, timeChip.w, G.axisH - 4, 3);
        ctx.fill();
        ctx.fillStyle = C.chipText;
        ctx.font = `600 10.5px ${MONO}`;
        ctx.textAlign = "center";
        ctx.fillText(hoverTime, timeChip.l + timeChip.w / 2, timeTop + G.axisH / 2 + 0.5);
        showTip(g, hp);
      } else tip.hidden = true;

      const said = act
        ? `rally ${fmtGain(summary.gain)} from ${fmtPrice(act.base)}, ${act.legs.length} leg${act.legs.length === 1 ? "" : "s"}`
        : `${summary.rallies} rall${summary.rallies === 1 ? "y" : "ies"} today`;
      canvas.setAttribute("aria-label", `${ticker()} Rally tracker: ${status.label}, ${said}. ${status.detail}`);
    };

    // Hover card beside the cursor (on the point, from the keyboard)
    const placeTip = (g, p) => placeChartTip(tip, g.x(p.t), pointerY ?? g.y(p.gain), g.right, g.timeTop);
    const showTip = (g, p) => {
      const row = (name, value, sg = "") => `<dt>${name}</dt><dd${sg ? ` data-sign="${sg}"` : ""}>${value}</dd>`;
      const session = p.session === "pre" ? "Pre-market" : p.session === "post" ? "After hours" : "";
      const r = p.rally >= 0 ? data.rallies[p.rally] : null;
      const leg = r && p.leg >= 0 ? r.legs[p.leg] : null;
      let rallyText = "";
      if (r) {
        const legText = leg ? ` · leg ${p.leg + 1}${leg.afterHalt ? " after halt" : ""}: ${RT_LEG_NAMES[p.segment] ?? p.segment}` : "";
        const ending = r.active ? "in progress" : `ended ${ET_HM.format(r.end)}, ${RT_END_REASONS[r.endReason] ?? "over"}`;
        rallyText = `<p class="chart-tip__rally"><b>Rally ${r.id + 1}</b>${legText}<br>${fmtGain(r.gain)} (${fmtMove(r.gainAbs)}) in ${fmtDuration(r.durationMs)}: ${fmtPrice(r.base)} → ${fmtPrice(r.high)}, ${ending}</p>`;
      }
      const here = data.alerts.filter((a) => a.t === p.t && RT_ALERT_TEXT[a.kind]);
      tip.innerHTML = `
        <p class="chart-tip__time">${ET_HMS.format(p.t)} ET${session ? `<span>${session}</span>` : ""}</p>
        <p class="chart-tip__state" data-tone="${RT_TONE[p.state]}">${RT_LABELS[p.state]}</p>
        <dl>
          ${row("Price", fmtPrice(p.price))}
          ${row(r ? "Gain" : "Off the low", fmtGain(p.gain), p.gain > 0 ? "up" : p.gain < 0 ? "down" : "")}
          ${row("Speed", `${accelArrow(p.accel)}${fmtSpeed(p.speed)}`, p.accel === 1 ? "up" : p.accel === -1 || p.speed < 0 ? "down" : "")}
          ${row("Bull vs. Bear", p.control == null ? "—" : fmtScore(p.control), p.control >= 0.5 ? "up" : p.control <= -0.5 ? "down" : "")}
        </dl>
        ${rallyText}
        ${here.map((a) => {
          const [glyph, name, tone] = RT_ALERT_TEXT[a.kind];
          return `<p class="chart-tip__alert"><b data-tone="${tone}">${glyph}</b>${name} · ${fmtPrice(a.price)}${a.vol ? ` · ${fmtMult(a.vol / 100)}` : ""}</p>`;
        }).join("")}`;
      tip.hidden = false;
      placeTip(g, p);
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; draw(); });
    };
    const render = () => {
      if (dirty) refresh();
      renderHead();
      schedule();
    };

    const resize = () => {
      const { width, height } = chartBox(box);
      const dpr = window.devicePixelRatio || 1;
      W = Math.floor(width);
      H = Math.floor(height);
      canvas.width = Math.max(1, Math.round(W * dpr));
      canvas.height = Math.max(1, Math.round(H * dpr));
      readSizes();
      // Back in view: compute what arrived meanwhile
      if (dirty && W) { refresh(); renderHead(); } else fitSignals();
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      draw();
    };
    new ResizeObserver(resize).observe(box);
    const watchDpr = () => matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener("change", () => { resize(); watchDpr(); }, { once: true });
    watchDpr();
    document.fonts?.ready.then(schedule);

    /* Crosshair: pointer or keyboard */
    const setHover = (i) => {
      if (i === hover) return;
      hover = i;
      schedule();
    };
    const nearest = (px) => {
      const t = geo.start + (px / geo.usable) * (geo.end - geo.start);
      const pts = data.points;
      let i = indexAt(pts, t);
      if (pts[i + 1] && pts[i + 1].t - t < t - pts[i].t) i += 1;
      return Math.max(geo.first, i);
    };
    const track = (e) => {
      if (!geo) return;
      const { x: px, y } = chartPoint(canvas, e);
      pointerY = y;
      const next = px < geo.right ? nearest(px) : null;
      if (next !== null && next === hover && !tip.hidden) placeTip(geo, data.points[next]);
      else setHover(next);
    };
    canvas.addEventListener("pointermove", track);
    canvas.addEventListener("pointerdown", track);
    canvas.addEventListener("pointerleave", () => setHover(null));
    canvas.addEventListener("blur", () => setHover(null));
    canvas.addEventListener("keydown", (e) => {
      if (!geo) return;
      pointerY = null;
      const pts = data.points;
      const lastIndex = pts.length - 1;
      const from = hover ?? lastIndex;
      let next = { ArrowLeft: from - 1, ArrowRight: from + 1, Home: geo.first, End: lastIndex, Escape: null }[e.key];
      if (next === undefined) return;
      e.preventDefault();
      // Shift: a minute at a time
      if (e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        next = indexAt(pts, pts[from].t + (e.key === "ArrowLeft" ? -60e3 : 60e3));
        if (next === from) next += e.key === "ArrowLeft" ? -1 : 1;
      }
      setHover(next === null ? null : clampTo(next, geo.first, lastIndex));
    });

    /* Controls: Levels and the visible window (the live point stays at the right edge) */
    const syncControls = () => {
      windowBtns.forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.rtWindow) === rtPrefs.window)));
      levelsBtn.setAttribute("aria-pressed", String(rtPrefs.levels));
    };
    windowBtns.forEach((b) => b.addEventListener("click", () => {
      rtPrefs.window = Number(b.dataset.rtWindow);
      saveRtPrefs();
      syncControls();
      schedule();
    }));
    levelsBtn.addEventListener("click", () => {
      rtPrefs.levels = !rtPrefs.levels;
      saveRtPrefs();
      syncControls();
      schedule();
    });
    symbol.addEventListener("input", () => {
      hover = null;
      render();
    });
    syncControls();
    render();

    const received = () => { clock = { t: feed?.points[feed.points.length - 1]?.t ?? 0, at: Date.now() }; };
    return {
      // The whole day (a new page, or a copy's snapshot)
      load: (dump) => {
        feed = dump && { points: dump.points.slice(), alerts: dump.alerts.slice(), halts: dump.halts, summary: dump.summary };
        received();
        hover = null;
        dirty = true;
        if (inView()) render();
      },
      // One live update: new points and alerts, the Halts and Bull vs. Bear's summary
      push: (u) => {
        if (!feed) return;
        feed.points.push(...u.points);
        feed.alerts.push(...u.alerts);
        Object.assign(feed, { halts: u.halts, summary: u.summary });
        received();
        dirty = true;
        if (inView()) render();
      },
      // Window / Levels saved in another window
      reload: () => {
        loadRtPrefs();
        syncControls();
        schedule();
      },
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
  const serveCopies = (constellation, chart, bbFeed) => {
    if (!hub) return;
    const snapshotOf = (id) => {
      if (id === "chart") return { sym: chart.symbol(), bb: bbFeed.dump() };
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

  /* ---- Phone shell ----------------------------------------------------------
     At phone widths (PHONE) the main window shows one panel at a time:
     - the nav keeps the brand and the account; the market status moves to
       the bar under it (and back into the nav at desktop widths);
     - one tab per table or chart, in PHONE_TABS order, in a strip that
       scrolls sideways (the edge with more tabs past it fades out); ←/→,
       Home and End move between tabs and open the focused one;
     - Gainers Open's tab follows its panel: off outside Market Open, and
       the strip falls back to Gainers while it was the open one;
     - an alert tab counts the alerts shown since it was last open (only
       at phone widths), in the panel's tone;
     - the open tab is remembered on this device. Never synced to the
       copies: they have no tab strip.
     Every panel stays mounted and live; CSS hides all but [data-m-active].
     Only the main window mounts it. */

  const PHONE_TABS = ["gainers", "gainers-open", "volume-leaders", "new-hod", "buying", "selling", "halts", "momentum", "chart"];
  const PHONE_TAB_KEY = "scanner:phone-tab:v1";

  const mountPhone = () => {
    const nav = document.querySelector(".app-nav");
    const status = nav.querySelector(".app-status");
    const tools = nav.querySelector(".app-tools");
    const bar = document.querySelector("[data-m-bar]");
    const strip = bar.querySelector("[data-m-tabs]");
    const panels = Object.fromEntries(PHONE_TABS
      .map((id) => [id, document.querySelector(`:is(.terminal, .chart-panel)[data-panel="${id}"]`)])
      .filter(([, el]) => el));
    const ids = Object.keys(panels);
    const counts = new Map();
    // How each panel is labelled at desktop widths, to restore it there
    const desk = new Map(ids.map((id) => [id, ["role", "aria-labelledby"].map((a) => panels[id].getAttribute(a))]));

    const tabs = Object.fromEntries(ids.map((id) => {
      const p = panels[id];
      p.id ||= `panel-${id}`;
      const t = document.createElement("button");
      t.type = "button";
      t.className = "m-tab";
      t.id = `m-tab-${id}`;
      t.dataset.tab = id;
      t.setAttribute("role", "tab");
      t.setAttribute("aria-controls", p.id);
      if (p.dataset.tone && p.dataset.kind !== "toplist") t.dataset.tone = p.dataset.tone;
      t.innerHTML = `<span>${p.dataset.title}</span><span class="m-tab__count" hidden><span></span><span class="sr-only"> new</span></span>`;
      strip.append(t);
      return [id, t];
    }));

    const available = (id) => Boolean(panels[id]) && !panels[id].hidden;
    let active = ids[0];
    try {
      const saved = localStorage.getItem(PHONE_TAB_KEY);
      if (panels[saved]) active = saved;
    } catch { /* ignore */ }

    const setCount = (id, n, bump = false) => {
      counts.set(id, n);
      const el = tabs[id].querySelector(".m-tab__count");
      el.hidden = n === 0;
      el.firstChild.textContent = n > 99 ? "99+" : String(n);
      if (bump && !reduceMotion.matches) {
        el.classList.remove("is-bump");
        void el.offsetWidth; // restart the bump
        el.classList.add("is-bump");
      }
    };

    // Strip edges: fade the side(s) with more tabs past them.
    const syncFade = () => {
      const max = strip.scrollWidth - strip.clientWidth;
      const start = strip.scrollLeft > 1;
      const end = strip.scrollLeft < max - 1;
      strip.dataset.more = start && end ? "both" : start ? "start" : end ? "end" : "";
    };

    // The open tab slides to the middle of the strip. An absolute target, so
    // a slide still in flight never adds up with the new one.
    const center = (t) => {
      const s = strip.getBoundingClientRect();
      const r = t.getBoundingClientRect();
      if (!s.width) return;
      const left = strip.scrollLeft + r.left - s.left - (s.width - r.width) / 2;
      strip.scrollTo({ left, behavior: reduceMotion.matches ? "auto" : "smooth" });
    };

    const select = (id, { focus = false, save = true } = {}) => {
      if (!available(id)) id = ids.find(available);
      active = id;
      ids.forEach((k) => {
        const on = k === id;
        panels[k].toggleAttribute("data-m-active", on);
        tabs[k].setAttribute("aria-selected", String(on));
        tabs[k].tabIndex = on ? 0 : -1;
      });
      setCount(id, 0);
      center(tabs[id]);
      if (focus) tabs[id].focus();
      if (save) {
        try { localStorage.setItem(PHONE_TAB_KEY, id); } catch { /* ignore */ }
      }
    };

    strip.addEventListener("click", (e) => {
      const t = e.target.closest(".m-tab");
      if (t && t.dataset.tab !== active) select(t.dataset.tab);
    });
    strip.addEventListener("keydown", (e) => {
      const list = ids.filter(available);
      const i = list.indexOf(e.target.closest(".m-tab")?.dataset.tab);
      if (i < 0) return;
      const n = list.length;
      const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: n - 1 }[e.key];
      if (next === undefined) return;
      e.preventDefault();
      select(list[(next + n) % n], { focus: true });
    });
    strip.addEventListener("scroll", syncFade, { passive: true });
    new ResizeObserver(syncFade).observe(strip);

    // Phone ↔ desktop widths: where the status sits, what labels the panels.
    const syncMode = () => {
      const phone = PHONE.matches;
      if (phone) bar.prepend(status);
      else nav.insertBefore(status, tools);
      ids.forEach((id) => {
        const p = panels[id];
        if (phone) {
          p.setAttribute("role", "tabpanel");
          p.setAttribute("aria-labelledby", tabs[id].id);
        } else {
          ["role", "aria-labelledby"].forEach((a, i) => {
            const v = desk.get(id)[i];
            if (v === null) p.removeAttribute(a);
            else p.setAttribute(a, v);
          });
          setCount(id, 0);
        }
      });
      if (phone) center(tabs[active]);
      syncFade();
    };
    PHONE.addEventListener("change", syncMode);

    // Browser chrome on phones: the page background
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", getComputedStyle(document.documentElement).getPropertyValue("--bg").trim());

    select(active, { save: false });
    syncMode();

    return {
      // A new alert reached the screen of `id`'s panel
      bump: (id) => {
        if (PHONE.matches && tabs[id] && id !== active) setCount(id, (counts.get(id) || 0) + 1, true);
      },
      // A panel turned on or off for the market session
      syncSession: () => {
        ids.forEach((id) => { tabs[id].hidden = !available(id); });
        if (!available(active)) select(active, { save: false });
        syncFade();
      },
    };
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
    mountProfile(mountAccount());
  }
  const phone = DETACHED ? null : mountPhone();
  mountNavStatus(); // the filters follow the market session
  const soundSettings = mountSoundSettings();
  const floatSettings = mountFloatSettings();
  const tableSettings = mountTableSettings();
  const filterDialog = mountFilters();
  const chartRoot = document.querySelector(".chart-panel");
  const chart = chartRoot && mountChartPanel(chartRoot, { persist: !DETACHED, adaptive: Boolean(DETACHED) });
  const bbView = chartRoot?.querySelector("#chart-view-bull-bear");
  const bullBear = bbView && mountBullBear(bbView, chartRoot);
  const klView = chartRoot?.querySelector("#chart-view-key-levels");
  const keyLevels = klView && mountKeyLevels(klView, chartRoot);
  const rtView = chartRoot?.querySelector("#chart-view-rally");
  const rallyTracker = rtView && mountRallyTracker(rtView, chartRoot);
  const heatRoot = document.querySelector("[data-constellation]");
  const constellation = heatRoot && mountConstellation(heatRoot);

  const TABLE_SETUP = {
    // Vertical container: toplists
    gainers: { seed: GAINERS, cols: TOPLIST_COLS, pins: TOPLIST_PINS, phoneCols: PHONE_COLS.gainers, quotes: true },
    "gainers-open": { seed: GAINERS_OPEN, cols: TOPLIST_COLS, pins: TOPLIST_PINS, phoneCols: PHONE_COLS["gainers-open"], quotes: true },
    "volume-leaders": { seed: VOLUME_LEADERS, cols: TOPLIST_COLS, pins: TOPLIST_PINS, phoneCols: PHONE_COLS["volume-leaders"], quotes: true },
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
    // Bull vs. Bear, Key levels and Rally tracker: the day's series in every snapshot, then each live update.
    linkCopy(chartRoot, {
      snapshot: (m, first) => {
        if (first) chart.setSymbol(m.sym);
        bullBear.load(m.bb);
        keyLevels.load(m.bb);
        rallyTracker.load(m.bb);
      },
      relay: (m) => {
        if (m.type !== "bb") return;
        bullBear.push(m);
        keyLevels.push(m);
        rallyTracker.push(m);
      },
    });
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
      mountTable(panel(id), seed, { ...setup, onShown: () => phone.bump(id), relay: hub ? (msg) => post({ ...msg, panel: id }) : undefined });
    }
    // The GXAI day runs here only (Bull vs. Bear, Key levels, Rally tracker); every update goes to the copies too.
    const bbFeed = createBullBearFeed();
    bullBear?.load(bbFeed.dump());
    keyLevels?.load(bbFeed.dump());
    rallyTracker?.load(bbFeed.dump());
    bbFeed.onUpdate((u) => {
      bullBear?.push(u);
      keyLevels?.push(u);
      rallyTracker?.push(u);
      post({ type: "bb", ...u });
    });
    serveCopies(constellation, chart, bbFeed);
  }
  syncSoundButtons();

  /* Session tables: Gainers Open (change vs. today's open) only runs from
     the open: it is off in Pre-Market, After Hours and while closed. The main window
     hides it with its splitter (Gainers and Volume Leaders share the space;
     the saved split returns with it) and keeps its settings. A copy of it
     stays open, dimmed with a notice, for the user to close it; it comes
     back to life at the open. On phones its tab goes with it (mountPhone).
     Follows the nav clock live. */
  const SESSION_OFF = { "gainers-open": ["pre", "after", "closed"] };
  const SESSION_OFF_TEXT = { pre: "during Pre-Market", after: "during After Hours", closed: "while the market is closed" };
  const syncSessionTables = () => {
    for (const [id, off] of Object.entries(SESSION_OFF)) {
      const root = panel(id);
      if (!root) continue;
      const hide = off.includes(marketState);
      if (DETACHED === id) {
        let note = root.querySelector(".detach-status--session");
        if (!note && hide) {
          note = Object.assign(document.createElement("p"), { className: "detach-status detach-status--session" });
          note.setAttribute("role", "status");
          root.append(note);
        }
        if (note) {
          note.textContent = hide ? `${root.dataset.title} is off ${SESSION_OFF_TEXT[marketState]} · back at the open` : "";
          note.hidden = !hide;
        }
        root.toggleAttribute("data-session-off", hide);
        continue;
      }
      if (root.hidden === hide) continue;
      if (hide && document.fullscreenElement === root) document.exitFullscreen().catch(() => {});
      root.classList.remove("is-maximized");
      root.hidden = hide;
      const split = root.nextElementSibling?.classList.contains("splitter") ? root.nextElementSibling : root.previousElementSibling;
      if (split?.classList.contains("splitter")) split.hidden = hide;
      // The splitter left in its place names the panes it now moves.
      const prev = root.previousElementSibling;
      if (prev?.classList.contains("splitter") && !prev.hidden) {
        const after = [...root.parentElement.children].slice([...root.parentElement.children].indexOf(root)).find((el) => el.matches(".terminal:not([hidden])"));
        prev.setAttribute("aria-label", `Resize ${prev.previousElementSibling.dataset.title} and ${(after || root).dataset.title}`);
      }
    }
  };
  syncSessionTables();
  phone?.syncSession();
  onSessionChange.push(syncSessionTables);
  if (phone) onSessionChange.push(phone.syncSession);

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
    else if (key === BB_KEY) bullBear?.reload();
    else if (key === KL_KEY) keyLevels?.reload();
    else if (key === RT_KEY) rallyTracker?.reload();
  });

  setInterval(() => {
    tickTimers();
    onTick.forEach((fn) => fn());
  }, 1000);
})();
