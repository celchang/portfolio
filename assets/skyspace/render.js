// Paints the sky: reads the clock and the weather, works out the colors, and
// writes them to the page as CSS variables.
//
// Phase 3: the page opens straight on the current sky, then keeps itself up to
// date every minute. The transition lasts as long as the gap between updates,
// so the light is always drifting rather than stepping. Work pauses while the
// tab is hidden and catches up in one slow move when it comes back.

import { sunElevation, nycToday, nycTimeToDate, nycClockLabel } from './sun.js';
import { loadPalette, computeSky, rgbToHex } from './palette.js';
import { currentWeather } from './weather.js';

const PALETTE_URL = new URL('./palette.json', import.meta.url);
const WEATHER_LABELS = {
  clear: 'Clear',
  partly: 'Partly cloudy',
  overcast: 'Overcast',
  rain: 'Rain',
};

const TICK_MS = 60 * 1000; // one minute of real time
const WEATHER_POLL_MS = 5 * 60 * 1000; // the reading itself is cached for 15
const MIN_TICK_MS = 250; // floor, so a big ?speed= can't thrash the page
// The light drifts over a whole minute, but a change in the weather should
// arrive while you are still looking at it.
const WEATHER_FADE_MS = 4000;
// How much bigger the cloud forms are drawn, relative to the palette's size,
// now that the opening is a small disc rather than a tall rectangle.
const CLOUD_SHAPE_SCALE = 1.8;

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// ---- preview mode (see the build plan's Testing section) -------------------
// ?time=17:15 · ?date=2026-12-21 · ?weather=partly · ?speed=60
// These only ever affect the person who typed them into the URL.
function readPreview(search = window.location.search) {
  const params = new URLSearchParams(search);
  const preview = {};

  const time = params.get('time');
  if (time && /^\d{1,2}:\d{2}$/.test(time)) {
    const [hour, minute] = time.split(':').map(Number);
    if (hour < 24 && minute < 60) preview.time = { hour, minute };
  }

  const date = params.get('date');
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [year, month, day] = date.split('-').map(Number);
    preview.date = { year, month, day };
  }

  const weather = params.get('weather');
  if (weather && weather in WEATHER_LABELS) preview.weather = weather;

  const speed = Number(params.get('speed'));
  if (Number.isFinite(speed) && speed > 1) preview.speed = Math.min(speed, 3600);

  return preview;
}

// The moment the clock starts from: now, unless a preview asked for another.
function startingMoment(preview, now = new Date()) {
  if (!preview.time && !preview.date) return now;

  const day = preview.date || nycToday(now);
  const clock =
    preview.time ||
    (() => {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
      }).formatToParts(now);
      const f = {};
      for (const p of parts) f[p.type] = p.value;
      return { hour: +f.hour % 24, minute: +f.minute };
    })();

  return nycTimeToDate({ ...day, ...clock });
}

// ---- the clock this page runs on ------------------------------------------
// Normally real time. With ?speed= it runs faster, measured from the moment
// the page opened, so a sunset can be watched in about a minute.
function makeClock(preview) {
  const speed = preview.speed || 1;
  const startedAt = Date.now();
  const base = startingMoment(preview).getTime();

  return {
    speed,
    tickMs: Math.max(MIN_TICK_MS, TICK_MS / speed),
    now: () => new Date(base + (Date.now() - startedAt) * speed),
  };
}

// ---- clouds ---------------------------------------------------------------
// Low-frequency fractal noise, stretched sideways like a wind-blown cloud
// field, used as a mask so the cloud color can follow the light. Each mask is
// built once and cached, and the drift is a CSS transform on top — the
// textures are never redrawn, which keeps slow phones out of trouble.
const maskCache = new Map();

function cloudMask(kind, coverage, size) {
  const key = `${kind}|${coverage.toFixed(2)}|${size.toFixed(2)}`;
  if (maskCache.has(key)) return maskCache.get(key);

  const big = kind === 'big';
  const fx = (big ? 0.0026 : 0.008) / size;
  const fy = (big ? 0.0062 : 0.03) / size;
  const k = big ? 3.2 : 4.2;
  const center = (big ? 0.66 : 0.62) - coverage * (big ? 0.32 : 0.28);
  const b = -k * center;

  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='1000' height='1000'>` +
    `<filter id='f' x='0' y='0' width='100%' height='100%'>` +
    `<feTurbulence type='fractalNoise' baseFrequency='${fx.toFixed(5)} ${fy.toFixed(5)}' numOctaves='3' seed='${big ? 7 : 23}'/>` +
    `<feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 ${k} 0 0 0 ${b.toFixed(3)}'/>` +
    `</filter><rect width='100%' height='100%' filter='url(#f)'/></svg>`;

  const value = `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
  maskCache.set(key, value);
  return value;
}

let appliedMask = '';

function paintClouds(sky) {
  const big = document.querySelector('.sky-cloud.is-big');
  const wisp = document.querySelector('.sky-cloud.is-wisp');
  if (!big || !wisp) return;

  const coverage = Math.round(sky.cloud * 20) / 20;
  if (coverage <= 0) {
    big.style.opacity = '0';
    wisp.style.opacity = '0';
    return;
  }

  // The palette's cloud size is tuned for a large opening. On a small disc the
  // same frequency would read as a scatter of specks, so the forms are
  // enlarged relative to it — a few soft shapes across the circle. This scales
  // the mask only; no palette value is touched.
  const size = Math.round(sky.size * CLOUD_SHAPE_SCALE * 10) / 10;
  const stamp = `${coverage}|${size}`;

  // Only touch the masks when the shape of the cloud field actually changes,
  // so a minute tick never interrupts the drift.
  if (stamp !== appliedMask) {
    big.style.webkitMaskImage = big.style.maskImage = cloudMask('big', coverage, size);
    wisp.style.webkitMaskImage = wisp.style.maskImage = cloudMask('wisp', coverage, size);
    appliedMask = stamp;
  }

  big.style.opacity = Math.min(1, 0.55 + coverage * 0.45).toFixed(2);
  wisp.style.opacity = (sky.texture * (0.4 + coverage * 0.5)).toFixed(2);
}

// ---- paint ----------------------------------------------------------------
function setFade(ms) {
  document.documentElement.style.setProperty('--sky-fade', `${Math.round(ms)}ms`);
}

function paint(palette, moment, weather) {
  const elevation = sunElevation(moment);
  const sky = computeSky(palette, elevation, weather);
  const root = document.documentElement;

  root.style.setProperty('--sky-top', rgbToHex(sky.top));
  root.style.setProperty('--sky-bot', rgbToHex(sky.bot));
  root.style.setProperty('--room', rgbToHex(sky.room));
  root.style.setProperty('--glow', rgbToHex(sky.glow));
  root.style.setProperty('--cloud', rgbToHex(sky.cloudColor));
  root.style.setProperty('--ink', rgbToHex(sky.ink));
  root.style.setProperty('--spill', sky.dark ? '0.35' : '0.55');
  root.dataset.skyspace = sky.dark ? 'dark' : 'light';
  root.dataset.weather = weather;

  paintClouds(sky);

  const clock = document.getElementById('skyspace-clock');
  if (clock) {
    clock.textContent = `NYC • ${nycClockLabel(moment)} • ${WEATHER_LABELS[weather]}`;
  }
}

// ---- the loop -------------------------------------------------------------
async function start() {
  const preview = readPreview();

  let palette;
  try {
    palette = await loadPalette(PALETTE_URL);
  } catch (err) {
    // The CSS defaults already show the cream room and a midday sky, which is
    // a complete design on its own. Leave it be.
    console.warn('Skyspace: palette unavailable, using CSS defaults.', err);
    return;
  }

  const clock = makeClock(preview);
  // Colors still change when motion is reduced; they just don't animate.
  const fadeMs = () => (reducedMotion.matches ? 0 : clock.tickMs);
  let weather = preview.weather || 'clear';
  let timer = null;

  // The page opens straight on the current sky: no arrival sequence, no
  // loading box, nothing to sit through.
  setFade(0);
  paint(palette, clock.now(), weather);
  document.body.classList.add('skyspace-ready');

  // Commit those colors with the transition still at zero, so the sky is
  // simply there rather than fading up from the stylesheet's defaults. Reading
  // a layout property forces that synchronously — waiting for a frame or a
  // timer would be too late in a tab that isn't drawing.
  void document.documentElement.offsetHeight;
  setFade(fadeMs());

  const tick = (fade = fadeMs()) => {
    if (document.hidden) return;
    setFade(fade);
    paint(palette, clock.now(), weather);
  };

  const startTicking = () => {
    if (timer) clearInterval(timer);
    timer = setInterval(tick, clock.tickMs);
  };

  // A forced ?weather= state stays forced, and asks the network for nothing.
  if (preview.weather) {
    document.documentElement.dataset.weatherSource = 'preview';
  } else {
    const refreshWeather = async () => {
      if (document.hidden) return;
      const reading = await currentWeather();
      if (reading.error) {
        console.warn('Skyspace: weather unavailable, staying on clear.', reading.error);
      }
      document.documentElement.dataset.weatherSource = reading.source;
      if (reading.key !== weather) {
        weather = reading.key;
        // Blend into the new state now, over a few seconds, rather than
        // waiting out the minute drift.
        tick(reducedMotion.matches ? 0 : Math.min(WEATHER_FADE_MS, clock.tickMs));
      }
    };

    refreshWeather();
    setInterval(refreshWeather, WEATHER_POLL_MS);
  }

  startTicking();

  // Nothing runs while the tab is in the background; coming back catches up
  // in one slow move.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearInterval(timer);
      timer = null;
      return;
    }
    tick();
    startTicking();
  });
}

start();
