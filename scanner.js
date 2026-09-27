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
  };

  // Heat hue per metric. %Chg follows the table's direction; volume and hits
  // are direction-neutral so they never read as bullish/bearish.
  const HUES = { chgUp: "green", chgDown: "red", vol1m: "amber", hits: "violet" };

  // VWAP D.: >= +1% green, < -1% red, anything else amber.
  const VWAP_D = { up: 1, down: -1 };

  const MAX_ROWS = 40;
  const LIVE_INTERVAL = 4000;

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
    { key: "sym",      label: "Ticker",      w: 84,  pinned: true, cls: "col-sym" },
    { key: "price",    label: "Price",       w: 80,  num: true },
    { key: "chg1",     label: "%Chg 1m",     w: 96,  num: true, title: "% change, last minute" },
    { key: "vol1m",    label: "Vol 1m",      w: 100, num: true, title: "Volume spike vs. normal 1m volume" },
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

  // Default (movable) column order per table.
  const ALERT_COLS = ["price", "chg1", "vol1m", "rvol", "hits", "vwapD", "vwap", "chg5", "chg15", "chg30", "volume", "float", "mcap", "press", "trend"];
  const HALT_COLS = ["price", "duration", "resume", "vol1m", "rvol", "hits", "vwapD", "vwap", "volume", "float", "mcap", "press", "trend"];

  const cellClass = (c) => [c.cls, c.num && "num", c.muted && "muted"].filter(Boolean).join(" ");

  // Column order per table survives reloads (best effort — storage may be blocked).
  const storeKey = (tone) => `scanner:columns:${tone}`;
  const loadOrder = (tone, movable) => {
    try {
      const saved = JSON.parse(localStorage.getItem(storeKey(tone)) || "null");
      if (Array.isArray(saved)) {
        const known = saved.filter((k) => movable.includes(k));
        return [...known, ...movable.filter((k) => !known.includes(k))];
      }
    } catch { /* ignore */ }
    return [...movable];
  };
  const saveOrder = (tone, order) => {
    try { localStorage.setItem(storeKey(tone), JSON.stringify(order)); } catch { /* ignore */ }
  };

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
  ].map((h) => ({ ...h, time: h.haltAt })).sort((a, b) => b.time - a.time);

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

  const mountTable = (root, seed, { cols, next, every = LIVE_INTERVAL, expires = false }) => {
    const tone = root.dataset.tone;
    const table = root.querySelector(".scan-table");
    const headRow = table.querySelector("thead tr");
    const body = table.querySelector("tbody");
    const wrap = root.querySelector(".table-wrap");
    const cards = root.querySelector("[data-cards]");
    const soundBtn = root.querySelector("[data-sound]");
    const rows = seed.map((r) => ({ ...r }));
    let order = loadOrder(tone, cols);
    let soundOn = false;

    const columns = () => [...PINNED, ...order];
    const colgroup = table.insertBefore(document.createElement("colgroup"), table.firstChild);
    const FILL = '<td class="col-fill" aria-hidden="true"></td>';

    // Pinned offsets are plain sums of whole-pixel widths: nothing to measure.
    table.style.setProperty("--pin-time", `${COL.sig.w}px`);
    table.style.setProperty("--pin-sym", `${COL.sig.w + COL.time.w}px`);

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
      const derived = rows.map((r) => [derive(r, tone), r.sym]);
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
      saveOrder(tone, order);
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
      const i = order.indexOf(key);
      const j = e.key === "ArrowLeft" ? i - 1 : i + 1;
      if (j < 0 || j >= order.length) return;
      moveColumn(key, order[j], e.key === "ArrowRight");
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

    soundBtn.addEventListener("click", () => {
      soundOn = !soundOn;
      soundBtn.setAttribute("aria-pressed", String(soundOn));
      soundBtn.title = soundOn ? "Mute alerts" : "Alert sound";
      if (soundOn) beep(tone);
    });

    // Edge shadow on the pinned columns once the table scrolls sideways.
    wrap.addEventListener("scroll", () => {
      wrap.classList.toggle("is-scrolled", wrap.scrollLeft > 0);
    }, { passive: true });

    if (expires) {
      rows.splice(0, rows.length, ...rows.filter((r) => r.resumeAt > Date.now()));
      onTick.push(dropResumed);
    }
    renderAll();
    if (next) setInterval(pushAlert, every + Math.random() * 1500);
  };

  /* ---- Mobile card feed --------------------------------------------------
     - At the top and idle: new alerts slide in and push the rest down.
     - Scrolled away (or mid-gesture): the view stays put and a "new" pill
       counts what arrived above.
     - A custom scrollbar rail, since iOS hides native ones. */

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

  const mountCardFeed = (view) => {
    const list = view.querySelector("[data-cards]");
    const pill = view.querySelector("[data-new-pill]");
    const pillCount = view.querySelector("[data-new-count]");
    const rail = view.querySelector("[data-rail]");
    const thumb = rail.firstElementChild;
    let touching = false;
    let lastUserScroll = 0;
    let selfScroll = false;
    let unseen = 0;

    const atTop = () => list.scrollTop <= 2;
    const userBusy = () => touching || Date.now() - lastUserScroll < 350;
    const scrollListTo = (top) => {
      if (Math.round(top) === Math.round(list.scrollTop)) return;
      selfScroll = true;
      list.scrollTop = top;
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
      if (selfScroll) selfScroll = false;
      else lastUserScroll = Date.now();
      if (atTop()) setUnseen(0);
      syncRail();
    }, { passive: true });
    list.addEventListener("touchstart", () => { touching = true; }, { passive: true });
    list.addEventListener("touchend", () => { touching = false; lastUserScroll = Date.now(); }, { passive: true });
    list.addEventListener("touchcancel", () => { touching = false; }, { passive: true });

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
        lastUserScroll = Date.now();
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
      const old = list.querySelector(`[data-sym="${card.dataset.sym}"]`);
      const visible = list.offsetParent !== null;
      const stayTop = visible && atTop() && !userBusy();

      // FLIP: remember where the visible cards were…
      const first = new Map();
      let anchor = null;
      let anchorOffset = 0;
      if (stayTop) {
        const limit = list.clientHeight * 1.5;
        for (const el of list.children) if (el.offsetTop < limit) first.set(el, el.offsetTop);
      } else if (visible) {
        anchor = [...list.children].find((el) => el !== old && el.offsetTop + el.offsetHeight > list.scrollTop);
        anchorOffset = anchor ? anchor.offsetTop - list.scrollTop : 0;
      }

      old?.remove();
      list.prepend(card);
      while (list.children.length > MAX_ROWS) list.lastElementChild.remove();

      if (stayTop) {
        scrollListTo(0);
        // …then slide them from there to their new spot.
        if (!reduceMotion.matches) {
          first.forEach((top, el) => {
            const dy = top - el.offsetTop;
            if (dy && el.isConnected) {
              el.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 420, easing: EASE });
            }
          });
          card.animate(
            [{ opacity: 0, transform: "translateY(-10px) scale(0.98)" }, { opacity: 1, transform: "none" }],
            { duration: 320, delay: 90, easing: EASE, fill: "backwards" },
          );
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

  const [bull, bear, halts] = document.querySelectorAll(".terminal[data-tone]");
  mountTable(bull, BULL, { cols: ALERT_COLS, next: nextAlert(BULL) });
  mountTable(bear, BEAR, { cols: ALERT_COLS, next: nextAlert(BEAR) });
  mountTable(halts, HALTS, { cols: HALT_COLS, next: nextHalt, every: 18000, expires: true });
  setInterval(() => {
    tickTimers();
    onTick.forEach((fn) => fn());
  }, 1000);
})();
