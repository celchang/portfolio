// Current NYC conditions from Open-Meteo, reduced to the four states the
// palette knows about. No API key, one request, cached for 15 minutes.
//
// This is the only part of the piece that touches the network. When it fails
// or is slow the page stays on the clear sky for the current time, which is a
// complete design on its own.

import { NYC } from './sun.js';

export const CACHE_KEY = 'skyspace-weather';
export const CACHE_MS = 15 * 60 * 1000;
// A reading this old still beats falling back to clear.
export const STALE_MS = 60 * 60 * 1000;

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';

// WMO weather codes. Snow reads as rain for now — a decision in the build plan.
const WET = (code) =>
  (code >= 51 && code <= 67) || // drizzle, freezing drizzle, rain
  (code >= 71 && code <= 77) || // snow, snow grains
  (code >= 80 && code <= 86) || // rain and snow showers
  (code >= 95 && code <= 99); // thunderstorms

const FOG = (code) => code === 45 || code === 48;

// Anything wet is rain; fog counts as overcast; otherwise the sky is judged
// by how much cloud is in it, falling back to the code when cover is missing.
export function mapWeather({ weatherCode, cloudCover } = {}) {
  const code = Number(weatherCode);

  if (Number.isFinite(code)) {
    if (WET(code)) return 'rain';
    if (FOG(code)) return 'overcast';
  }

  const cover = Number(cloudCover);
  if (Number.isFinite(cover)) {
    if (cover >= 85) return 'overcast';
    if (cover >= 25) return 'partly';
    return 'clear';
  }

  // No cloud cover reading: read it off the code alone.
  if (code === 3) return 'overcast';
  if (code === 2) return 'partly';
  return 'clear';
}

function readCache(now = Date.now()) {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry || typeof entry.key !== 'string' || typeof entry.at !== 'number') return null;
    return { ...entry, age: now - entry.at };
  } catch (err) {
    return null;
  }
}

function writeCache(key, now = Date.now()) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ key, at: now }));
  } catch (err) {
    // Private browsing, or storage turned off. The page works without it.
  }
}

export async function fetchWeather({
  lat = NYC.lat,
  lon = NYC.lon,
  timeoutMs = 6000,
  fetchImpl = fetch,
} = {}) {
  const url =
    `${ENDPOINT}?latitude=${lat}&longitude=${lon}` +
    `&current=weather_code,cloud_cover&timezone=America%2FNew_York`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`weather ${res.status}`);
    const data = await res.json();
    const current = data && data.current;
    if (!current) throw new Error('weather: no current reading');

    return {
      key: mapWeather({
        weatherCode: current.weather_code,
        cloudCover: current.cloud_cover,
      }),
      weatherCode: current.weather_code,
      cloudCover: current.cloud_cover,
      observedAt: current.time,
    };
  } finally {
    clearTimeout(timer);
  }
}

// The state to draw: a fresh cached reading, else the network, else a recent
// stale reading, else clear.
export async function currentWeather(options = {}) {
  const now = Date.now();
  const cached = readCache(now);

  if (cached && cached.age < CACHE_MS) {
    return { key: cached.key, source: 'cache' };
  }

  try {
    const reading = await fetchWeather(options);
    writeCache(reading.key, now);
    return { ...reading, source: 'network' };
  } catch (err) {
    if (cached && cached.age < STALE_MS) {
      return { key: cached.key, source: 'stale', error: err };
    }
    return { key: 'clear', source: 'fallback', error: err };
  }
}
