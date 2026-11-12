// Paints the sky: reads the clock (and, from phase 2, the weather), works out
// the colors, and writes them to the page as CSS variables.
//
// Phase 2: the clear sky is drawn at once, then the live NYC conditions blend
// in when they arrive. The minute loop and cloud drift arrive in phase 3.

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

// ---- preview mode (see the build plan's Testing section) -------------------
// ?time=17:15 · ?date=2026-12-21 · ?weather=partly
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

  return preview;
}

// The moment to draw: now, unless a preview asked for another one.
function momentFor(preview, now = new Date()) {
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

// ---- clouds ---------------------------------------------------------------
// Low-frequency fractal noise, stretched sideways like a wind-blown cloud
// field, used as a mask so the cloud color can follow the light. Each mask is
// built once and cached; from phase 3 they are only moved, never redrawn.
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

  const size = Math.round(sky.size * 10) / 10;
  big.style.webkitMaskImage = big.style.maskImage = cloudMask('big', coverage, size);
  wisp.style.webkitMaskImage = wisp.style.maskImage = cloudMask('wisp', coverage, size);
  big.style.opacity = Math.min(1, 0.55 + coverage * 0.45).toFixed(2);
  wisp.style.opacity = (sky.texture * (0.4 + coverage * 0.5)).toFixed(2);
}

// ---- paint ----------------------------------------------------------------
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

  const moment = momentFor(preview);

  // The clear sky for this moment goes up straight away — never a blank page
  // or a loading box while the weather is on its way.
  paint(palette, moment, preview.weather || 'clear');
  document.body.classList.add('skyspace-ready');

  // A forced state stays forced, and asks the network for nothing.
  if (preview.weather) {
    document.documentElement.dataset.weatherSource = 'preview';
    return;
  }

  const reading = await currentWeather();
  if (reading.error) {
    console.warn('Skyspace: weather unavailable, staying on clear.', reading.error);
  }

  document.documentElement.dataset.weatherSource = reading.source;
  // The CSS transitions carry it over from clear.
  paint(palette, moment, reading.key);
}

start();
