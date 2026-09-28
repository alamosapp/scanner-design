/* ==========================================================================
   Scanner tables — formatting, color scales, column reordering,
   mobile cards and a mock live feed
   ========================================================================== */

(() => {
  "use strict";

  /* ---- Config ------------------------------------------------------------ */

  // Signal column: float tiers (shares). < low → low float, < mid → mid, else high.
  const FLOAT_TIERS = { low: 10e6, mid: 50e6 };

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

  const floatTier = (f) => (f < FLOAT_TIERS.low ? "low" : f < FLOAT_TIERS.mid ? "mid" : "high");
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
  try {
    const saved = JSON.parse(localStorage.getItem(GLOBAL_EXCLUDED_KEY) || "[]");
    if (Array.isArray(saved)) saved.forEach((s) => typeof s === "string" && globalExcluded.add(s));
  } catch { /* ignore */ }
  const saveGlobalExcluded = () => {
    try { localStorage.setItem(GLOBAL_EXCLUDED_KEY, JSON.stringify([...globalExcluded])); } catch { /* ignore */ }
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

  /* ---- Alert sound (Web Audio, starts only after the user turns it on) --- */

  let audio = null;
  const beep = (tone) => {
    audio ??= new AudioContext();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = { bull: 880, bear: 440, halt: 660 }[tone];
    gain.gain.setValueAtTime(0.0001, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, audio.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.18);
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + 0.2);
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
  };

  const mountTable = (root, seed, { cols, pins = PINNED, next, every = LIVE_INTERVAL, expires = false, quotes = false }) => {
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
    let soundOn = false;

    const columns = () => [...pins, ...order.filter((k) => !prefs.hidden.has(k))];
    const isExcluded = (sym) => prefs.excluded.has(sym) || globalExcluded.has(sym);
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
      const derived = rows.filter((r) => !isExcluded(r.sym)).map((r) => [derive(r, tone), r.sym]);
      body.replaceChildren(...derived.map(([d, sym]) => rowEl(d, sym)));
      cards.replaceChildren(...derived.map(([d, sym]) => cardEl(d, sym)));
      tickTimers();
      feed?.sync();
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

    const pushAlert = () => {
      const alert = next(rows);
      if (!alert) return;
      const i = rows.findIndex((r) => r.sym === alert.sym);
      if (i >= 0) rows.splice(i, 1);
      rows.unshift(alert);
      rows.length = Math.min(rows.length, MAX_ROWS);
      // Excluded tickers are tracked but never shown (nor sounded).
      if (isExcluded(alert.sym)) return;

      const d = derive(alert, tone);
      body.querySelector(`[data-sym="${alert.sym}"]`)?.remove();
      const tr = rowEl(d, alert.sym);
      tr.classList.add("is-new");
      body.prepend(tr);
      while (body.children.length > MAX_ROWS) body.lastElementChild.remove();

      const card = cardEl(d, alert.sym);
      card.classList.add("is-new");
      feed.insert(card);
      tickTimers();
      if (soundOn) beep(tone);
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

    soundBtn?.addEventListener("click", () => {
      soundOn = !soundOn;
      soundBtn.setAttribute("aria-pressed", String(soundOn));
      soundBtn.title = soundOn ? "Mute alerts" : "Alert sound";
      if (soundOn) beep(tone);
    });

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

    const tickPrices = () => {
      const count = 1 + Math.floor(Math.random() * 3);
      for (let n = 0; n < count; n++) {
        const r = pick(rows);
        const before = fmtPrice(r.price);
        r.price = jitter(r.price, 0.015);
        const after = fmtPrice(r.price);
        if (after === before) continue;
        const up = Number(after) > Number(before);
        // Refresh every cell that follows the price (%Chg Close, VWAP D., …)
        const tr = body.querySelector(`[data-sym="${r.sym}"]`);
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
    });
    const settingsBtn = root.querySelector("[data-settings]");
    settingsBtn.addEventListener("click", () => tableSettings.open(panel, settingsBtn));

    if (expires) {
      rows.splice(0, rows.length, ...rows.filter((r) => r.resumeAt > Date.now()));
      onTick.push(dropResumed);
    }
    applyColors();
    renderAll();
    if (next) setInterval(pushAlert, every + Math.random() * 1500);
    if (quotes) setInterval(tickPrices, QUOTE_INTERVAL + Math.random() * 600);
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
  let toastTimer = 0;
  const showToast = (text) => {
    clearTimeout(toastTimer);
    toastEl.querySelector("[data-toast-text]").textContent = text;
    toastEl.classList.remove("is-leaving");
    toastEl.hidden = false;
    toastTimer = setTimeout(() => {
      toastEl.classList.add("is-leaving");
      toastTimer = setTimeout(() => { toastEl.hidden = true; }, reduceMotion.matches ? 0 : 220);
    }, 2600);
  };

  /* ---- Table settings dialog ----------------------------------------------
     The settings icon in a panel's bar opens it for that panel.
     - Columns: pinned ones stay put; the others can be reordered (drag the
       handle, or ↑/↓ on it), switched on/off, and the heat columns
       (Vol. 1m, Hits) recolored.
     - Exclude tickers: hide tickers from this table, or from every table.
     Everything is a draft until Save; Cancel, Esc or a click outside drops it. */

  const SWATCH_LABEL = { amber: "Amber", violet: "Violet", cyan: "Cyan", pink: "Pink", orange: "Orange", teal: "Teal" };
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

    const renderColumns = () => {
      closePopover();
      pinnedList.innerHTML = table.pins.map((k) => `
        <li class="col-item">
          <span class="col-item__lead">${ICON.lock}</span>
          <span class="col-item__text"><span class="col-item__name">${COL[k].label}</span>${desc(COL[k])}</span>
          <span class="col-tag">Pinned</span>
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
            <span class="col-item__actions">${color}<button type="button" class="switch" role="switch" data-toggle aria-checked="${on}" aria-label="Show ${c.label}" title="${on ? "Hide" : "Show"} column"></button></span>
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

  /* ---- Mount -------------------------------------------------------------- */

  const panel = (id) => document.querySelector(`.terminal[data-panel="${id}"]`);
  document.querySelectorAll(".terminal[data-panel]").forEach(buildPanel);
  mountLayout();
  mountAppFullscreen();
  mountNavStatus();
  mountGuide();
  const tableSettings = mountTableSettings();

  // Vertical container: toplists
  mountTable(panel("gainers"), GAINERS, { cols: TOPLIST_COLS, pins: TOPLIST_PINS, quotes: true });
  mountTable(panel("gainers-open"), GAINERS_OPEN, { cols: TOPLIST_COLS, pins: TOPLIST_PINS, quotes: true });
  mountTable(panel("volume-leaders"), VOLUME_LEADERS, { cols: TOPLIST_COLS, pins: TOPLIST_PINS, quotes: true });
  // Top row: alerts
  mountTable(panel("new-hod"), BULL, { cols: HOD_COLS, next: nextAlert(BULL) });
  mountTable(panel("buying"), BUYING, { cols: PRESSURE_COLS, next: nextAlert(BUYING) });
  mountTable(panel("selling"), BEAR, { cols: PRESSURE_COLS, next: nextAlert(BEAR) });
  // Bottom row: momentum + halts
  mountTable(panel("momentum"), MOMENTUM, { cols: MOMENTUM_COLS, next: nextAlert(MOMENTUM) });
  mountTable(panel("halts"), HALTS, { cols: HALT_COLS, next: nextHalt, every: 18000, expires: true });

  setInterval(() => {
    tickTimers();
    onTick.forEach((fn) => fn());
  }, 1000);
})();
