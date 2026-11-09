// Turns a sun elevation and a weather state into the colors for one moment.
// The keyframes live in palette.json — tune them in the palette table, not here.

export const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

export const rgbToHex = (c) =>
  '#' +
  c
    .map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0'))
    .join('');

export const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

export const luminance = (c) => {
  const s = c.map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
};

export async function loadPalette(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`palette ${res.status}`);
  return res.json();
}

// Blend between the two keyframes bracketing this elevation.
export function sampleStops(palette, elevation) {
  const stops = palette.stops.slice().sort((a, b) => a.e - b.e);
  const keys = ['top', 'bot', 'room', 'glow'];
  const pick = (s) => Object.fromEntries(keys.map((k) => [k, hexToRgb(s[k])]));

  if (elevation <= stops[0].e) return pick(stops[0]);
  if (elevation >= stops[stops.length - 1].e) return pick(stops[stops.length - 1]);

  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (elevation >= a.e && elevation <= b.e) {
      const t = (elevation - a.e) / (b.e - a.e);
      const A = pick(a);
      const B = pick(b);
      return Object.fromEntries(keys.map((k) => [k, mix(A[k], B[k], t)]));
    }
  }
}

// The keyframe colors with the weather adjustments laid on top.
export function computeSky(palette, elevation, weatherKey = 'clear') {
  const w = palette.weather[weatherKey] || palette.weather.clear;
  const c = sampleStops(palette, elevation);

  // 0 in daylight, 1 deep in the night.
  const night = Math.max(0, Math.min(1, (-elevation - 4) / 10));
  const gray = mix(hexToRgb(palette.neutral.day), hexToRgb(palette.neutral.night), night);

  let top = mix(c.top, gray, w.desat);
  let bot = mix(c.bot, mix(gray, [255, 255, 255], 0.12 * (1 - night)), w.desat);
  top = mix(top, [0, 0, 0], w.shade);
  bot = mix(bot, [0, 0, 0], w.shade);

  let room = c.room;
  const glow = mix(c.glow, gray, w.desat * 0.8);
  if (weatherKey === 'rain' || weatherKey === 'overcast') {
    room = mix(room, mix([236, 234, 232], [22, 20, 26], night), 0.35);
  }

  const dark = luminance(room) < palette.ink.flipBelowLuminance;
  const ink = hexToRgb(dark ? palette.ink.light : palette.ink.dark);

  // Clouds pick up the low sun's warmth, and the city's glow at night.
  const warm = 1 - Math.max(0, Math.min(1, (elevation - 2) / 10));
  const cloudColor = mix(
    mix([255, 255, 255], c.glow, 0.45 * warm),
    mix(gray, [255, 255, 255], 0.08),
    night * 0.9
  );

  return {
    top,
    bot,
    room,
    glow,
    ink,
    dark,
    cloud: w.cloud,
    cloudColor,
    size: w.size,
    texture: w.texture,
  };
}
