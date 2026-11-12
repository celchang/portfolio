// Tests for the Skyspace weather module. Run with:
//   node --test tests/weather.test.mjs        (LIVE=1 also hits the real API)
import assert from 'node:assert/strict';
import test from 'node:test';

const MOD = new URL('../assets/skyspace/weather.js', import.meta.url).href;
const { mapWeather, fetchWeather, currentWeather, CACHE_KEY, CACHE_MS } = await import(MOD);

test('WMO codes: anything wet reads as rain', () => {
  for (const code of [51, 55, 61, 63, 65, 66, 80, 81, 82, 95, 99]) {
    assert.equal(mapWeather({ weatherCode: code, cloudCover: 10 }), 'rain', `code ${code}`);
  }
});

test('snow reads as rain for now (build plan decision)', () => {
  for (const code of [71, 73, 75, 77, 85, 86]) {
    assert.equal(mapWeather({ weatherCode: code, cloudCover: 0 }), 'rain', `code ${code}`);
  }
});

test('fog reads as overcast', () => {
  assert.equal(mapWeather({ weatherCode: 45, cloudCover: 0 }), 'overcast');
  assert.equal(mapWeather({ weatherCode: 48, cloudCover: 0 }), 'overcast');
});

test('dry sky is judged by cloud cover', () => {
  assert.equal(mapWeather({ weatherCode: 0, cloudCover: 0 }), 'clear');
  assert.equal(mapWeather({ weatherCode: 1, cloudCover: 24 }), 'clear');
  assert.equal(mapWeather({ weatherCode: 1, cloudCover: 25 }), 'partly');
  assert.equal(mapWeather({ weatherCode: 2, cloudCover: 60 }), 'partly');
  assert.equal(mapWeather({ weatherCode: 3, cloudCover: 85 }), 'overcast');
  assert.equal(mapWeather({ weatherCode: 3, cloudCover: 100 }), 'overcast');
});

test('falls back to the code when cloud cover is missing', () => {
  assert.equal(mapWeather({ weatherCode: 3 }), 'overcast');
  assert.equal(mapWeather({ weatherCode: 2 }), 'partly');
  assert.equal(mapWeather({ weatherCode: 0 }), 'clear');
  assert.equal(mapWeather({}), 'clear');
  assert.equal(mapWeather(), 'clear');
});

test('fetchWeather maps a real-shaped Open-Meteo payload', async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ current: { time: '2026-11-12T08:45', weather_code: 3, cloud_cover: 100 } }),
  });
  const reading = await fetchWeather({ fetchImpl });
  assert.equal(reading.key, 'overcast');
  assert.equal(reading.cloudCover, 100);
  assert.equal(reading.observedAt, '2026-11-12T08:45');
});

test('fetchWeather rejects on a bad status', async () => {
  const fetchImpl = async () => ({ ok: false, status: 503 });
  await assert.rejects(() => fetchWeather({ fetchImpl }), /weather 503/);
});

test('fetchWeather gives up rather than hanging', async () => {
  const fetchImpl = (url, { signal }) =>
    new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
  await assert.rejects(() => fetchWeather({ fetchImpl, timeoutMs: 50 }));
});

// --- currentWeather, with a stand-in for the browser's localStorage ---------
function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

test('a failed request falls back to clear', async () => {
  globalThis.localStorage = fakeStorage();
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('offline');
  };
  try {
    const out = await currentWeather({ timeoutMs: 50 });
    assert.equal(out.key, 'clear');
    assert.equal(out.source, 'fallback');
  } finally {
    globalThis.fetch = original;
  }
});

test('a reading is cached, and the cache is used next time', async () => {
  globalThis.localStorage = fakeStorage();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return {
      ok: true,
      json: async () => ({ current: { weather_code: 61, cloud_cover: 90 } }),
    };
  };

  const first = await currentWeather({ fetchImpl });
  assert.equal(first.key, 'rain');
  assert.equal(first.source, 'network');
  assert.equal(calls, 1);

  const second = await currentWeather({ fetchImpl });
  assert.equal(second.key, 'rain');
  assert.equal(second.source, 'cache', 'should not hit the network again');
  assert.equal(calls, 1, 'exactly one request within the cache window');
});

test('a stale reading beats falling back to clear', async () => {
  globalThis.localStorage = fakeStorage();
  globalThis.localStorage.setItem(
    CACHE_KEY,
    JSON.stringify({ key: 'rain', at: Date.now() - (CACHE_MS + 60_000) })
  );
  const fetchImpl = async () => {
    throw new Error('offline');
  };
  const out = await currentWeather({ fetchImpl });
  assert.equal(out.key, 'rain');
  assert.equal(out.source, 'stale');
});

test('a corrupt cache entry is ignored, not thrown on', async () => {
  globalThis.localStorage = fakeStorage();
  globalThis.localStorage.setItem(CACHE_KEY, '{not json');
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ current: { weather_code: 0, cloud_cover: 5 } }),
  });
  const out = await currentWeather({ fetchImpl });
  assert.equal(out.key, 'clear');
  assert.equal(out.source, 'network');
});

test('works where localStorage throws (private browsing)', async () => {
  globalThis.localStorage = {
    getItem() {
      throw new Error('denied');
    },
    setItem() {
      throw new Error('denied');
    },
  };
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ current: { weather_code: 3, cloud_cover: 95 } }),
  });
  const out = await currentWeather({ fetchImpl });
  assert.equal(out.key, 'overcast');
  assert.equal(out.source, 'network');
});

test('live Open-Meteo answers in the shape we expect', { skip: !process.env.LIVE }, async () => {
  const reading = await fetchWeather({});
  assert.ok(['clear', 'partly', 'overcast', 'rain'].includes(reading.key));
  assert.ok(Number.isFinite(Number(reading.cloudCover)));
});
