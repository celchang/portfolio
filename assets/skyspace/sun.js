// Where the sun sits above the New York horizon at a given moment.
// Pure math, no network. Everything is derived from the UTC instant, so
// daylight saving changes take care of themselves.

export const NYC = { lat: 40.7128, lon: -74.006, zone: 'America/New_York' };

// Degrees above (+) or below (-) the horizon.
export function sunElevation(date, lat = NYC.lat, lon = NYC.lon) {
  const d = date.getTime() / 86400000 + 2440587.5 - 2451545.0;
  const rad = Math.PI / 180;

  const g = (357.529 + 0.98560028 * d) * rad;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const e = (23.439 - 0.00000036 * d) * rad;

  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  const H = (gmst * 15 + lon) * rad - ra;
  const la = lat * rad;

  return (
    Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(H)) / rad
  );
}

// How far the zone is from UTC at that instant, in milliseconds.
function zoneOffset(date, zone = NYC.zone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);

  const f = {};
  for (const p of parts) f[p.type] = p.value;
  const asUTC = Date.UTC(+f.year, +f.month - 1, +f.day, +f.hour % 24, +f.minute, +f.second);
  return asUTC - date.getTime();
}

// The calendar date in New York right now, as { year, month, day }.
export function nycToday(now = new Date(), zone = NYC.zone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const f = {};
  for (const p of parts) f[p.type] = p.value;
  return { year: +f.year, month: +f.month, day: +f.day };
}

// The instant at which New York's wall clock reads this date and time.
// Resolved in two passes so it stays correct across a DST boundary.
export function nycTimeToDate({ year, month, day, hour = 12, minute = 0 }, zone = NYC.zone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = zoneOffset(new Date(guess), zone);
  let t = guess - first;
  const second = zoneOffset(new Date(t), zone);
  if (second !== first) t = guess - second;
  return new Date(t);
}

// "4:50 EST" — the zone abbreviation flips between EST and EDT on its own.
export function nycClockLabel(date, zone = NYC.zone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).formatToParts(date);

  const f = {};
  for (const p of parts) f[p.type] = p.value;
  return `${f.hour}:${f.minute} ${f.timeZoneName}`;
}
