// Tests for the opt-in diagnostics receiver: POST /api/telemetry and
// GET /api/telemetry/reports.
//
// Run:  node --test server/test/telemetry.test.js
//   (or node --test server/test/  — plain node:test, no dependencies)
//
// Each group boots the real server as a child process against a throwaway
// storage directory and a free port, with HAMCLOCK_DISABLE_POLLING=1 so the
// suite never touches the network.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = path.resolve(HERE, '..', 'src', 'server.js');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const DEVICE_A = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const DEVICE_B = 'a1b2c3d4-1111-4222-8333-444455556666';

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function pngChunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// A real, structurally valid PNG. `pad` inflates the file so size limits can
// be exercised with something that still has correct magic + IHDR.
function makePng(w = 8, h = 8, pad = 0) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const rows = [];
  for (let y = 0; y < h; y += 1) rows.push(Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x7f)]));
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  return pad > 0 ? Buffer.concat([png, Buffer.alloc(pad, 0x41)]) : png;
}

function validReport(overrides = {}) {
  return {
    schema: 1,
    device_id: DEVICE_A,
    sent_at: '2026-07-26T12:00:00Z',
    app: { version: 'abc1234', mode: 'pygame', install: 'kiosk' },
    host: {
      model: 'Raspberry Pi Model B Rev 2',
      cpu: 'ARMv6-compatible processor rev 7 (v6l)',
      cores: 1,
      mem_total_kb: 448_000,
      kernel: '6.6.51+rpt-rpi-v6',
      os: 'Debian GNU/Linux 12 (bookworm)',
      python: '3.11.2',
      uptime_s: 8123,
    },
    display: { sdl_driver: 'x11', bitsize: 16, size: [720, 450], fullscreen: true },
    versions: { pygame: '2.6.1', sdl: '2.28.4', cairosvg: null, cpulimit: true },
    perf: {
      frame_ms: { p50: 41.2, p90: 88.0, p99: 140.5, n: 600 },
      panel_ms: { solar: 12.4, muf: 38_200 },
      boot_to_first_paint_s: 31.7,
    },
    server: { ok: true, uptime_s: 900, sources: { solar: 'ok', muf: 'stale' } },
    screenshot_png_b64: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

class Harness {
  constructor(env = {}) {
    this.extraEnv = env;
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hamclock-telemetry-'));
  }

  async start() {
    this.port = await freePort();
    this.child = spawn(process.execPath, [SERVER_ENTRY], {
      env: {
        ...process.env,
        PORT: String(this.port),
        HAMCLOCK_TELEMETRY_DIR: this.dir,
        HAMCLOCK_DISABLE_POLLING: '1',
        ...this.extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.log = '';
    this.child.stdout.on('data', (d) => { this.log += d; });
    this.child.stderr.on('data', (d) => { this.log += d; });

    const deadline = Date.now() + 20_000;
    for (;;) {
      if (this.child.exitCode !== null) throw new Error(`server exited early:\n${this.log}`);
      try {
        const r = await fetch(`${this.base}/api/health`);
        if (r.ok) { await r.text(); return; }
      } catch { /* not up yet */ }
      if (Date.now() > deadline) throw new Error(`server never became ready:\n${this.log}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  async stop() {
    if (!this.child || this.child.exitCode !== null) return;
    const exited = new Promise((r) => this.child.once('exit', r));
    this.child.kill('SIGTERM');
    await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
    if (this.child.exitCode === null) this.child.kill('SIGKILL');
  }

  async restart() {
    await this.stop();
    await this.start();
  }

  get base() { return `http://127.0.0.1:${this.port}`; }

  // `ip` picks the rate-limit bucket: loopback is a trusted proxy peer, so the
  // server honours X-Real-IP exactly as it would behind nginx.
  post(body, { ip = '203.0.113.1', contentType = 'application/json', raw = null } = {}) {
    return fetch(`${this.base}/api/telemetry`, {
      method: 'POST',
      headers: { ...(contentType ? { 'Content-Type': contentType } : {}), 'X-Real-IP': ip },
      body: raw !== null ? raw : JSON.stringify(body),
    });
  }

  async postJson(body, opts) {
    const res = await this.post(body, opts);
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { res, text, json };
  }

  async reports(query = '', ip = '203.0.113.250') {
    const res = await fetch(`${this.base}/api/telemetry/reports${query}`, { headers: { 'X-Real-IP': ip } });
    const text = await res.text();
    return { res, text, json: JSON.parse(text) };
  }

  jsonl() {
    const p = path.join(this.dir, 'reports.jsonl');
    if (!fs.existsSync(p)) return [];
    return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  }

  rawJsonl() {
    const p = path.join(this.dir, 'reports.jsonl');
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  }

  shots() {
    const p = path.join(this.dir, 'shots');
    return fs.existsSync(p) ? fs.readdirSync(p).sort() : [];
  }

  async cleanup() {
    await this.stop();
    await fsp.rm(this.dir, { recursive: true, force: true });
  }
}

// ===========================================================================
describe('POST /api/telemetry — happy path and storage', () => {
  const h = new Harness();
  before(() => h.start());
  after(() => h.cleanup());

  test('accepts a well-formed report without a screenshot', async () => {
    const { res, json } = await h.postJson(validReport(), { ip: '203.0.113.10' });
    assert.equal(res.status, 200);
    assert.equal(json.ok, true);
    assert.match(json.id, /^[0-9a-f-]{36}$/);

    const rows = h.jsonl();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, json.id);
    assert.equal(rows[0].device_id, DEVICE_A);
    assert.equal(rows[0].screenshot, null);
  });

  test('records a server-side receive time and never the client clock', async () => {
    const [row] = h.jsonl();
    assert.match(row.received_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const skew = Math.abs(Date.parse(row.received_at) - Date.now());
    assert.ok(skew < 120_000, `received_at should be the server clock, skew=${skew}ms`);
    // The client-claimed time is kept, but clearly labelled as claimed.
    assert.equal(row.sent_at_claimed, '2026-07-26T12:00:00Z');
    assert.equal(row.sent_at, undefined);
  });

  test('stores a hashed + truncated IP, never the raw address', async () => {
    await h.postJson(validReport(), { ip: '198.51.100.77' });
    const raw = h.rawJsonl();
    assert.ok(!raw.includes('198.51.100.77'), 'raw client IP must not be stored');
    const row = h.jsonl().at(-1);
    assert.equal(row.ip_trunc, '198.51.100.0/24');
    assert.match(row.ip_hash, /^[0-9a-f]{16}$/);
  });

  // Behind the tunnel every report used to arrive as the tunnel's own IPv4
  // address, so the IPv6 branch of truncateIp never ran on a real client.
  // Taking the client from CF-Connecting-IP makes it live, and the old
  // split-and-slice returned the wrong hextets for any compressed address.
  // Documentation prefixes only: 2001:db8::/32 (RFC 3849), 3fff::/20 (RFC 9637).
  test('truncates IPv6 to a real /48, expanding :: before slicing', async () => {
    const cases = [
      // before: '2001:db8:abcd::/48' (right by luck — no elision in the head)
      ['2001:db8:abcd:12::5', '2001:db8:abcd::/48'],
      // before: '2001:db8:::/48' — a malformed label
      ['2001:db8::dead:beef', '2001:db8:0::/48'],
      // before: '3fff::abcd::/48' — published hextet 7 of the client's address
      ['3fff::abcd:1234', '3fff:0:0::/48'],
    ];
    for (const [ip, want] of cases) {
      const { res } = await h.postJson(validReport(), { ip });
      assert.equal(res.status, 200, ip);
      const row = h.jsonl().at(-1);
      assert.equal(row.ip_trunc, want, ip);
      for (const low of ip.split(':').slice(-2).filter((g) => g.length >= 2)) {
        assert.ok(!row.ip_trunc.includes(low),
          `${ip}: low-order group '${low}' leaked into ${row.ip_trunc}`);
      }
    }
    assert.ok(!h.rawJsonl().includes('dead:beef'), 'raw IPv6 must not be stored');
  });

  // isPlausibleIp is a character-class check, so every one of these reaches
  // truncateIp through X-Real-IP. Nine groups, or eight plus '::', make the
  // elided run negative; without the length guard that is Array(-1), a
  // RangeError, and the report is lost to a 500. None may yield a prefix: a
  // guess at which groups are the high ones is a guess at what to publish.
  test('malformed IPv6 that passes the header check is stored as unknown, not a 500', async () => {
    const malformed = [
      '1:2:3:4:5:6:7:8:9',     // nine groups
      '1:2:3:4:5:6:7::8',      // eight groups AND '::'
      '1::2::3',               // two '::'
      '1:2:3:4:5:6:7:8::9::a', // two '::' after a full eight-group head
      ':::1',                  // an empty group beside '::'
      ':1:2:3:4:5:6:7',        // leading single colon
      '12345::1',              // five-digit group
      '::::::::',
    ];
    for (const ip of malformed) {
      const { res } = await h.postJson(validReport(), { ip });
      assert.equal(res.status, 200, ip);
      assert.equal(h.jsonl().at(-1).ip_trunc, 'unknown', ip);
    }
    // And the compressed edge forms that ARE addresses still get their /48.
    for (const [ip, want] of [['::', '0:0:0::/48'], ['1:2:3:4:5:6:7::', '1:2:3::/48'],
      ['2001:DB8:ABCD:0001::1', '2001:db8:abcd::/48']]) {
      const { res } = await h.postJson(validReport(), { ip });
      assert.equal(res.status, 200, ip);
      assert.equal(h.jsonl().at(-1).ip_trunc, want, ip);
    }
  });

  test('writes the screenshot as a .png file, never inline in the log line', async () => {
    const png = makePng(24, 16);
    const { res, json } = await h.postJson(
      validReport({ screenshot_png_b64: png.toString('base64') }),
      { ip: '203.0.113.11' },
    );
    assert.equal(res.status, 200);

    const row = h.jsonl().find((r) => r.id === json.id);
    assert.equal(row.screenshot_bytes, png.length);
    assert.match(row.screenshot, /^[0-9a-f-]+_[0-9TZ:.-]+_[0-9a-f]{8}\.png$/);

    // Never inlined into JSON.
    assert.ok(!h.rawJsonl().includes(png.toString('base64').slice(0, 40)));

    const onDisk = fs.readFileSync(path.join(h.dir, 'shots', row.screenshot));
    assert.deepEqual(onDisk, png);
  });

  test('derives the screenshot filename itself — caller cannot steer the path', async () => {
    const names = h.shots();
    assert.ok(names.length >= 1);
    for (const n of names) {
      assert.ok(!n.includes('..') && !n.includes('/') && !n.includes('\\'), `unsafe name ${n}`);
      assert.ok(n.startsWith(DEVICE_A.toLowerCase()) || n.startsWith(DEVICE_B), n);
      assert.ok(n.endsWith('.png'));
    }
  });

  test('accepts a report at the documented ~98 kB screenshot size', async () => {
    // This is the case the 100 kb default body limit would have rejected.
    const png = makePng(8, 8, 98 * 1024);
    const body = validReport({ device_id: DEVICE_B, screenshot_png_b64: png.toString('base64') });
    assert.ok(JSON.stringify(body).length > 100 * 1024, 'fixture must exceed the 100 kb default');
    const { res, json } = await h.postJson(body, { ip: '203.0.113.12' });
    assert.equal(res.status, 200);
    const row = h.jsonl().find((r) => r.id === json.id);
    assert.equal(row.screenshot_bytes, png.length);
  });

  test('a null/absent screenshot is fine', async () => {
    const noKey = validReport();
    delete noKey.screenshot_png_b64;
    const a = await h.postJson(noKey, { ip: '203.0.113.13' });
    assert.equal(a.res.status, 200);
    const b = await h.postJson(validReport({ screenshot_png_b64: '' }), { ip: '203.0.113.14' });
    assert.equal(b.res.status, 200);
    assert.equal(h.jsonl().at(-1).screenshot, null);
  });
});

// ===========================================================================
describe('POST /api/telemetry — hostile input', () => {
  const h = new Harness();
  before(() => h.start());
  after(() => h.cleanup());

  let ipSeq = 0;
  const nextIp = () => `192.0.2.${(ipSeq += 1)}`;

  const rejects = async (body, expectStatus, expectError, opts = {}) => {
    const { res, json } = await h.postJson(body, { ip: nextIp(), ...opts });
    assert.equal(res.status, expectStatus, `body=${JSON.stringify(json)}`);
    assert.equal(json.ok, false);
    assert.equal(json.error, expectError);
    return json;
  };

  test('rejects a missing/incorrect schema version', async () => {
    await rejects(validReport({ schema: 2 }), 400, 'unsupported_schema');
    await rejects(validReport({ schema: '1' }), 400, 'unsupported_schema');
    const noSchema = validReport();
    delete noSchema.schema;
    await rejects(noSchema, 400, 'unsupported_schema');
  });

  test('rejects a device_id that is not a UUID', async () => {
    await rejects(validReport({ device_id: '../../etc/shadow' }), 400, 'invalid_device_id');
    await rejects(validReport({ device_id: 'not-a-uuid' }), 400, 'invalid_device_id');
    await rejects(validReport({ device_id: 42 }), 400, 'invalid_device_id');
    const none = validReport();
    delete none.device_id;
    await rejects(none, 400, 'invalid_device_id');
  });

  test('rejects unknown top-level keys without echoing them back', async () => {
    const json = await rejects(
      validReport({ wifi_psk_smuggled_in: 'hunter2' }), 400, 'unknown_field',
    );
    const text = JSON.stringify(json);
    assert.ok(!text.includes('wifi_psk'), 'error must not echo submitted content');
    assert.ok(!text.includes('hunter2'), 'error must not echo submitted content');
  });

  test('rejects wrong-typed sections and a non-object body', async () => {
    await rejects(validReport({ host: 'a string' }), 400, 'invalid_host');
    await rejects(validReport({ display: [1, 2, 3] }), 400, 'invalid_display');
    await rejects([1, 2, 3], 400, 'invalid_body');
    await rejects(validReport({ sent_at: 'yesterday' }), 400, 'invalid_sent_at');
  });

  test('rejects malformed JSON and non-JSON content types', async () => {
    const bad = await h.postJson(null, { ip: nextIp(), raw: '{"schema":1,,,' });
    assert.equal(bad.res.status, 400);
    assert.equal(bad.json.error, 'invalid_json');
    // No stack trace, no filesystem paths.
    assert.ok(!/ at |node_modules|\.js:\d+/.test(bad.text), bad.text);

    const wrongType = await h.postJson(null, {
      ip: nextIp(), raw: 'schema=1', contentType: 'text/plain',
    });
    assert.equal(wrongType.res.status, 415);
    assert.equal(wrongType.json.error, 'unsupported_media_type');
  });

  test('rejects a body over the 1 mb route limit with clean JSON', async () => {
    const huge = JSON.stringify(validReport({ screenshot_png_b64: 'A'.repeat(1_400_000) }));
    const { res, json, text } = await h.postJson(null, { ip: nextIp(), raw: huge });
    assert.equal(res.status, 413);
    assert.equal(json.error, 'payload_too_large');
    assert.ok(!/PayloadTooLargeError|node_modules/.test(text), 'no stack trace');
  });

  test('rejects oversized non-screenshot fields', async () => {
    const server = {};
    for (let i = 0; i < 60; i += 1) server[`key_${i}`] = 'x'.repeat(200);
    const host = {};
    for (let i = 0; i < 60; i += 1) host[`h_${i}`] = 'y'.repeat(200);
    await rejects(validReport({ server, host }), 413, 'report_fields_too_large');
  });

  test('rejects screenshots that are not PNG, not base64, or too big', async () => {
    await rejects(
      validReport({ screenshot_png_b64: Buffer.from('hello, not a png at all!!').toString('base64') }),
      400, 'screenshot_not_png',
    );
    await rejects(validReport({ screenshot_png_b64: '!!!not base64!!!' }), 400, 'invalid_screenshot_encoding');
    await rejects(validReport({ screenshot_png_b64: 'QUJD' + 'Q' }), 400, 'invalid_screenshot_encoding');
    await rejects(validReport({ screenshot_png_b64: 12345 }), 400, 'invalid_screenshot');
    // JPEG magic wearing a .png name
    await rejects(
      validReport({ screenshot_png_b64: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]).toString('base64') }),
      400, 'screenshot_not_png',
    );
    // Correct magic, no IHDR
    await rejects(
      validReport({ screenshot_png_b64: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]).toString('base64') }),
      400, 'screenshot_not_png',
    );
    // Real PNG magic but 500 kB decoded — over the 400 kB cap, under the body cap
    await rejects(
      validReport({ screenshot_png_b64: makePng(8, 8, 500 * 1024).toString('base64') }),
      413, 'screenshot_too_large',
    );
  });

  test('nothing hostile reached disk', async () => {
    assert.equal(h.jsonl().length, 0, 'no rejected report may be stored');
    assert.equal(h.shots().length, 0, 'no rejected screenshot may be stored');
  });

  test('drops prototype-pollution keys instead of applying them', async () => {
    const evil = validReport();
    evil.host = JSON.parse('{"model":"Pi","__proto__":{"polluted":"yes"},"constructor":{"x":1}}');
    const { res, json } = await h.postJson(evil, { ip: nextIp() });
    assert.equal(res.status, 200);
    const row = h.jsonl().find((r) => r.id === json.id);
    assert.deepEqual(Object.keys(row.host), ['model']);
    assert.ok(!h.rawJsonl().includes('polluted'));
    // The server is still healthy and unpolluted afterwards.
    const health = await fetch(`${h.base}/api/health`);
    assert.equal(health.status, 200);
    await health.text();
  });

  test('clamps long strings and deep/wide structures instead of failing', async () => {
    const body = validReport({
      device_id: DEVICE_B,
      app: { version: 'v'.repeat(5000), mode: 'pygame', install: 'kiosk' },
      display: { sdl_driver: 'x11', size: new Array(500).fill(7) },
      server: { deep: { a: { b: { c: { d: { e: { f: 'too deep' } } } } } } },
    });
    const { res, json } = await h.postJson(body, { ip: nextIp() });
    assert.equal(res.status, 200);
    const row = h.jsonl().find((r) => r.id === json.id);
    assert.equal(row.app.version.length, 200);
    assert.equal(row.display.size.length, 64);
  });
});

// ===========================================================================
describe('POST /api/telemetry — rate limiting', () => {
  const h = new Harness();
  before(() => h.start());
  after(() => h.cleanup());

  test('allows 10 reports per hour per IP, then 429s with Retry-After', async () => {
    const ip = '198.51.100.5';
    for (let i = 0; i < 10; i += 1) {
      const { res } = await h.postJson(validReport(), { ip });
      assert.equal(res.status, 200, `request ${i + 1} should be accepted`);
    }
    const blocked = await h.postJson(validReport(), { ip });
    assert.equal(blocked.res.status, 429);
    assert.equal(blocked.json.error, 'rate_limited');
    const retry = Number(blocked.res.headers.get('retry-after'));
    assert.ok(Number.isInteger(retry) && retry > 0 && retry <= 3600, `Retry-After=${retry}`);
  });

  // Keyed per /128, one IPv6 client could walk its own /64 and mint a fresh
  // bucket for every address. 2001:db8::/32 is documentation space (RFC 3849).
  test('IPv6 is limited per /64, so rotating addresses inside it buys nothing', async () => {
    for (let i = 1; i <= 10; i += 1) {
      const { res } = await h.postJson(validReport(), { ip: `2001:db8:5:6::${i.toString(16)}` });
      assert.equal(res.status, 200, `request ${i} should be accepted`);
    }
    // before: a new address in the same /64 was a new bucket, so this was 200
    const rotated = await h.postJson(validReport(), { ip: '2001:db8:5:6:ffff:1:2:3' });
    assert.equal(rotated.res.status, 429);
    const neighbour = await h.postJson(validReport({ device_id: DEVICE_B }), { ip: '2001:db8:5:7::1' });
    assert.equal(neighbour.res.status, 200, 'the next /64 is a different customer');
  });

  test('the limit is per IP — a different device on a different IP still works', async () => {
    const { res } = await h.postJson(validReport({ device_id: DEVICE_B }), { ip: '198.51.100.6' });
    assert.equal(res.status, 200);
  });

  test('rejected requests are counted too, so garbage cannot be pumped for free', async () => {
    const ip = '198.51.100.9';
    for (let i = 0; i < 10; i += 1) {
      const { res } = await h.postJson(validReport({ schema: 99 }), { ip });
      assert.equal(res.status, 400);
    }
    const blocked = await h.postJson(validReport(), { ip });
    assert.equal(blocked.res.status, 429);
  });

  test('a spoofed X-Forwarded-For chain cannot resurrect a blocked X-Real-IP', async () => {
    // nginx *sets* X-Real-IP, so it wins over anything the client appends.
    const res = await fetch(`${h.base}/api/telemetry`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Real-IP': '198.51.100.5',
        'X-Forwarded-For': '10.9.9.9, 8.8.8.8',
      },
      body: JSON.stringify(validReport()),
    });
    assert.equal(res.status, 429);
    await res.text();
  });
});

// ===========================================================================
describe('GET /api/telemetry/reports', () => {
  const h = new Harness({ HAMCLOCK_TELEMETRY_RATE_HOUR: '50' });
  before(async () => {
    await h.start();
    await h.postJson(validReport(), { ip: '203.0.113.31' });
    await h.postJson(
      validReport({ device_id: DEVICE_B, screenshot_png_b64: makePng(12, 12).toString('base64') }),
      { ip: '203.0.113.32' },
    );
  });
  after(() => h.cleanup());

  test('returns metadata newest first', async () => {
    const { res, json } = await h.reports();
    assert.equal(res.status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.total, 2);
    assert.equal(json.reports.length, 2);
    assert.equal(json.reports[0].device_id, DEVICE_B);
    assert.equal(json.reports[1].device_id, DEVICE_A);
    assert.ok(Date.parse(json.reports[0].received_at) >= Date.parse(json.reports[1].received_at));
  });

  test('exposes the fields the maintainer needs and nothing sensitive', async () => {
    const { text, json } = await h.reports();
    const r = json.reports[1];
    assert.equal(r.host.model, 'Raspberry Pi Model B Rev 2');
    assert.equal(r.display.sdl_driver, 'x11');
    assert.equal(r.display.bitsize, 16);
    assert.equal(r.versions.pygame, '2.6.1');
    assert.equal(r.perf.frame_ms.p50, 41.2);
    assert.equal(r.has_screenshot, false);
    assert.equal(json.reports[0].has_screenshot, true);
    assert.ok(json.reports[0].screenshot_bytes > 0);

    // This endpoint is unauthenticated: no IPs, no user agents, no raw
    // screenshot data, no filename, no `server` blob — only the stable
    // server.boot shape, empty here because this blob has no typed boot fields.
    for (const forbidden of ['ip_hash', 'ip_trunc', 'user_agent', 'screenshot_png_b64', '198.51', '203.0.113', 'iVBOR', 'stale']) {
      assert.ok(!text.includes(forbidden), `reports listing leaked ${forbidden}`);
    }
    assert.deepEqual(r.server, { boot: {} });
    assert.equal(r.screenshot, undefined);
  });

  test('?limit= is clamped and never trusted', async () => {
    assert.equal((await h.reports('?limit=1')).json.reports.length, 1);
    assert.equal((await h.reports('?limit=1')).json.limit, 1);
    assert.equal((await h.reports('?limit=999999')).json.limit, 100);
    assert.equal((await h.reports('?limit=-5')).json.limit, 1);
    assert.equal((await h.reports('?limit=abc')).json.limit, 25);
    assert.equal((await h.reports('?limit[]=3')).json.limit, 25);
    assert.equal((await h.reports('')).json.limit, 25);
  });

  test('is not cacheable by intermediaries', async () => {
    const { res } = await h.reports();
    assert.equal(res.headers.get('cache-control'), 'no-store');
  });

  // The Oct 2026 report raised questions it could not answer from this
  // listing — which frames were slow, how old the processes were, whether the
  // clock had stepped — and answering them took shell access to the box. Pi
  // 1.0.11 sends those fields; the listing must carry them, and still nothing
  // that was not picked by name.
  test('carries the 1.0.11 diagnostics, and only the named ones', async () => {
    const report = validReport({
      app: { version: '1.0.11', mode: 'pygame', install: 'kiosk', proc_age_s: 446.2 },
      host: { ...validReport().host, clock_step_s: -9.6, ntp_synced: false },
      perf: {
        ...validReport().perf,
        present: { n: 120, p50: 3.1, p90: 12.4, max: 61.0, span_p50: 60, span_max: 312, flips_total: 2 },
        slow_frames: [{ ago_s: 12.5, ms: 96.4, present_ms: 61.0, span: 312, drew: 'propagation', flip: false }],
        glyph: { hit: 900, miss: 40, evict: 0, volatile: 180, size: 151, cap: 256 },
        not_picked: 'must not appear',
      },
    });
    const { res } = await h.postJson(report, { ip: '203.0.113.33' });
    assert.equal(res.status, 200);
    const { text, json } = await h.reports();
    const r = json.reports.find((x) => x.app && x.app.version === '1.0.11');
    assert.ok(r, 'the 1.0.11 report is listed');
    assert.equal(r.app.proc_age_s, 446.2);
    assert.equal(r.host.clock_step_s, -9.6);
    assert.equal(r.host.ntp_synced, false);
    assert.equal(r.perf.present.span_max, 312);
    assert.equal(r.perf.slow_frames[0].drew, 'propagation');
    assert.equal(r.perf.glyph.cap, 256);
    assert.ok(!text.includes('not_picked'), 'an unpicked perf field leaked into the listing');
  });

  // Picked by name alone, these fields would republish anything a sender
  // nested under them on an unauthenticated page. They are projected by type.
  test('the 1.0.11 fields carry only numbers, booleans and panel names', async () => {
    const report = validReport({
      app: { version: '1.0.11-hostile', mode: 'pygame', install: 'kiosk', proc_age_s: 'BUY NOW' },
      host: { ...validReport().host, clock_step_s: { nested: 'x' }, ntp_synced: 'yes' },
      perf: {
        ...validReport().perf,
        present: { n: 5, p50: 'http://spam.example', extra: 1 },
        slow_frames: [
          { ago_s: 1, ms: 99, drew: '<script>alert(1)</script>', flip: 'no' },
          'not an object',
          { ms: 120, drew: 'header+open_bands', flip: false },
        ],
        glyph: { hit: 1, miss: [1, 2], size: 'big' },
      },
    });
    const { res } = await h.postJson(report, { ip: '203.0.113.34' });
    assert.equal(res.status, 200);
    const { text, json } = await h.reports();
    const r = json.reports.find((x) => x.app && x.app.version === '1.0.11-hostile');
    assert.ok(r, 'the report is listed');
    assert.equal(r.app.proc_age_s, undefined);
    assert.equal(r.host.clock_step_s, undefined);
    assert.equal(r.host.ntp_synced, undefined);
    assert.deepEqual(r.perf.present, { n: 5 });
    assert.deepEqual(r.perf.slow_frames, [{ ago_s: 1, ms: 99 }, { ms: 120, drew: 'header+open_bands', flip: false }]);
    assert.deepEqual(r.perf.glyph, { hit: 1 });
    for (const bad of ['BUY NOW', 'spam.example', '<script>', 'big']) {
      assert.ok(!text.includes(bad), `the listing republished ${bad}`);
    }
  });

  // A field report's clock had been stepped back ~9.5 s before the client
  // process started, so the client's own clock_step_s read 0 and the step was
  // recoverable only by hand from the private `server` blob. Pi 1.0.12's local
  // server reports it as server.boot.clock_step_s; the listing carries that,
  // the server's age, and two new client fields — and nothing else from it.
  test('carries the 1.0.12 diagnostics, and only the named ones', async () => {
    const report = validReport({
      app: { version: '1.0.12', mode: 'pygame', install: 'kiosk', proc_age_s: 30.5 },
      host: { ...validReport().host, clock_step_s: 0, ntp_synced: true, ntp_last_sync_age_s: 1134.2 },
      perf: {
        ...validReport().perf,
        image_prep: { threaded: true, jobs: 14, failed: 1, pending: 0, last_ms: 820.5, max_ms: 2310 },
      },
      server: {
        schema: 1,
        boot: {
          started_at: 1793835660.25, uptime_s: 1150, clock_step_s: -9.5,
          disk_warm: true, restored: ['muf_image_png'], first_ok_s: { sdo: 3.1 },
        },
        fetch: { sdo: { last_error: 'URLError' } },
        process: { python: '3.11.2' },
      },
    });
    const { res } = await h.postJson(report, { ip: '203.0.113.35' });
    assert.equal(res.status, 200);
    const { text, json } = await h.reports();
    const r = json.reports.find((x) => x.app && x.app.version === '1.0.12');
    assert.ok(r, 'the 1.0.12 report is listed');
    assert.equal(r.host.ntp_last_sync_age_s, 1134.2);
    assert.deepEqual(r.perf.image_prep, { threaded: true, jobs: 14, failed: 1, pending: 0, last_ms: 820.5, max_ms: 2310 });
    assert.deepEqual(Object.keys(r.server), ['boot']);
    assert.deepEqual(r.server.boot, { uptime_s: 1150, clock_step_s: -9.5 });
    for (const leaked of ['started_at', 'disk_warm', 'muf_image_png', 'first_ok_s', 'URLError', '1793835660']) {
      assert.ok(!text.includes(leaked), `the listing republished server content: ${leaked}`);
    }
  });

  test('the 1.0.12 client fields carry only numbers and booleans', async () => {
    // [name, host.ntp_last_sync_age_s, perf.image_prep, published image_prep (undefined = no key)]
    const cases = [
      ['typed', 'an hour ago', {
        threaded: 'yes', jobs: '14', failed: [1], pending: { n: 0 }, last_ms: true, max_ms: 2310, smuggled: 'SMUGGLED-PREP',
      }, { max_ms: 2310 }],
      ['string', null, 'SMUGGLED-STRING', undefined],
      ['array', { s: 1 }, [{ jobs: 1 }], undefined],
      ['null', true, null, undefined],
    ];
    let ip = 50;
    for (const [name, ntpAge, imagePrep] of cases) {
      const report = validReport({
        app: { version: `1.0.12-client-${name}`, mode: 'pygame', install: 'kiosk' },
        host: { ...validReport().host, ntp_last_sync_age_s: ntpAge },
        perf: { ...validReport().perf, image_prep: imagePrep },
      });
      const { res } = await h.postJson(report, { ip: `203.0.113.${ip += 1}` });
      assert.equal(res.status, 200, name);
    }
    const { text, json } = await h.reports();
    for (const [name, , , want] of cases) {
      const r = json.reports.find((x) => x.app && x.app.version === `1.0.12-client-${name}`);
      assert.ok(r, `${name} is listed`);
      // null (the Pi could not tell) and every non-number are simply omitted.
      assert.ok(!('ntp_last_sync_age_s' in r.host), name);
      if (want === undefined) assert.ok(!('image_prep' in r.perf), name);
      else assert.deepEqual(r.perf.image_prep, want, name);
    }
    for (const bad of ['an hour ago', 'SMUGGLED']) {
      assert.ok(!text.includes(bad), `the listing republished ${bad}`);
    }
  });

  // `server` is the Pi's private diagnostics blob: absent, null, the client's
  // {error: ...} when its local server was unreachable, or anything at all.
  // Whatever arrives, the listing shows { boot } holding at most two numbers.
  test('server is always { boot } with typed numbers only, whatever was sent', async () => {
    // [name, server (undefined = key absent), published server.boot]
    const cases = [
      ['absent', undefined, {}],
      ['null', null, {}],
      ['error', { error: 'URLError' }, {}],
      ['boot-string', { boot: 'SMUGGLED-BOOT' }, {}],
      ['boot-array', { boot: [1150, -9.5] }, {}],
      ['wrong-types', { boot: { uptime_s: true, clock_step_s: '-9.5' } }, {}],
      ['nested', { boot: { uptime_s: { n: 1150 }, clock_step_s: [-9.5] } }, {}],
      ['step-null', { boot: { uptime_s: 1150, clock_step_s: null } }, { uptime_s: 1150 }],
      // A pre-1.0.12 local server: no clock_step_s, so nothing from it.
      ['pre-1.0.12', { boot: { uptime_s: 1150, started_at: 1.5 } }, {}],
      ['huge-string', { boot: { uptime_s: 'Z'.repeat(5000), clock_step_s: -1 } }, { clock_step_s: -1 }],
      ['extra-keys', {
        boot: { uptime_s: 61, clock_step_s: 0.4, started_at: 1.5, note: 'SMUGGLED-BOOT-KEY' },
        note: 'SMUGGLED-SERVER-KEY',
        uptime_s: 999,
      }, { uptime_s: 61, clock_step_s: 0.4 }],
    ];
    let ip = 60;
    for (const [name, server] of cases) {
      const report = validReport({ app: { version: `1.0.12-server-${name}`, mode: 'pygame', install: 'kiosk' } });
      if (server === undefined) delete report.server;
      else report.server = server;
      const { res } = await h.postJson(report, { ip: `203.0.113.${ip += 1}` });
      assert.equal(res.status, 200, name);
    }
    const { text, json } = await h.reports();
    for (const [name, , want] of cases) {
      const r = json.reports.find((x) => x.app && x.app.version === `1.0.12-server-${name}`);
      assert.ok(r, `${name} is listed`);
      assert.deepEqual(Object.keys(r.server), ['boot'], name);
      assert.deepEqual(r.server.boot, want, name);
    }
    for (const bad of ['SMUGGLED', 'URLError', 'ZZZZ']) {
      assert.ok(!text.includes(bad), `the listing republished ${bad}`);
    }

    // A bare string is not an object: the whole report is refused at the door.
    const { res, json: refused } = await h.postJson(validReport({ server: 'x' }), { ip: '203.0.113.90' });
    assert.equal(res.status, 400);
    assert.equal(refused.error, 'invalid_server');
  });

  test('rate-limits reads as well', async () => {
    const ip = '198.51.100.200';
    let sawLimit = false;
    for (let i = 0; i < 130; i += 1) {
      const res = await fetch(`${h.base}/api/telemetry/reports?limit=1`, { headers: { 'X-Real-IP': ip } });
      await res.text();
      if (res.status === 429) { sawLimit = true; break; }
    }
    assert.ok(sawLimit, 'read endpoint should rate-limit');
  });
});

// ===========================================================================
// The projection also runs over every line of reports.jsonl at startup —
// lines an older receiver wrote, or a hand edit — where `server` can hold what
// no POST could deliver today: a bare string, an array, a string past the
// 200-char clamp. One such line must neither stop the receiver nor be listed.
describe('GET /api/telemetry/reports — stored records with any `server` value', () => {
  const h = new Harness();
  const huge = 'Q'.repeat(10_000);
  // [name, stored server value, published server.boot]
  const stored = [
    ['absent', undefined, {}],
    ['null', null, {}],
    ['bare-string', huge, {}],
    ['number', 42, {}],
    ['array', [{ boot: { uptime_s: 1 } }], {}],
    ['boot-string', { boot: huge }, {}],
    ['huge-strings', { boot: { uptime_s: huge, clock_step_s: huge, note: huge }, note: huge }, {}],
    ['valid', { boot: { uptime_s: 1150, clock_step_s: -9.5, started_at: 1.5 }, error: 'URLError' },
      { uptime_s: 1150, clock_step_s: -9.5 }],
    // What every 1.0.10/1.0.11 report on disk looks like. Those were sent
    // under "nothing from the server blob is in the listing": still nothing.
    ['sent-by-1.0.11', { schema: 1, boot: { started_at: 1793559719.3, uptime_s: 1150, disk_warm: true } }, {}],
  ];
  before(async () => {
    const lines = stored.map(([name, server], i) => JSON.stringify({
      id: `00000000-0000-4000-8000-00000000000${i}`,
      device_id: DEVICE_A,
      received_at: '2026-11-01T00:00:00.000Z',
      app: { version: `stored-${name}` },
      server,
      screenshot: null,
      screenshot_bytes: 0,
    }));
    fs.writeFileSync(path.join(h.dir, 'reports.jsonl'), `${lines.join('\n')}\n`);
    await h.start();
  });
  after(() => h.cleanup());

  test('every stored record is listed as { boot } with typed numbers only', async () => {
    const { text, json } = await h.reports();
    assert.equal(json.total, stored.length);
    for (const [name, , want] of stored) {
      const r = json.reports.find((x) => x.app.version === `stored-${name}`);
      assert.ok(r, `${name} is listed`);
      assert.deepEqual(Object.keys(r.server), ['boot'], name);
      assert.deepEqual(r.server.boot, want, name);
    }
    assert.ok(!text.includes('QQQQ'), 'a stored server string reached the listing');
    assert.ok(!text.includes('URLError'), 'stored server content reached the listing');

    // ...and the receiver is still accepting reports.
    const { res } = await h.postJson(validReport(), { ip: '203.0.113.95' });
    assert.equal(res.status, 200);
  });
});

// ===========================================================================
describe('storage is bounded and survives restart', () => {
  const h = new Harness({
    HAMCLOCK_TELEMETRY_RATE_HOUR: '500',
    HAMCLOCK_TELEMETRY_RATE_DAY: '500',
    HAMCLOCK_TELEMETRY_MAX_PER_DEVICE: '3',
    HAMCLOCK_TELEMETRY_MAX_REPORTS: '5',
  });
  before(() => h.start());
  after(() => h.cleanup());

  test('prunes oldest reports past the per-device cap and deletes their screenshots', async () => {
    const ids = [];
    for (let i = 0; i < 6; i += 1) {
      const { res, json } = await h.postJson(
        validReport({ screenshot_png_b64: makePng(8, 8, i).toString('base64') }),
        { ip: '203.0.113.40' },
      );
      assert.equal(res.status, 200);
      ids.push(json.id);
    }
    const rows = h.jsonl();
    assert.equal(rows.length, 3, 'per-device cap should hold on disk');
    // The NEWEST three survive; the oldest three and their screenshots are gone.
    assert.deepEqual(rows.map((r) => r.id), ids.slice(-3));
    assert.equal(h.shots().length, 3, 'evicted screenshots must be deleted');
    const { json } = await h.reports();
    assert.equal(json.total, 3);
  });

  test('honours the global cap across devices', async () => {
    for (let i = 0; i < 4; i += 1) {
      await h.postJson(validReport({ device_id: DEVICE_B }), { ip: '203.0.113.41' });
    }
    assert.ok(h.jsonl().length <= 5, `global cap exceeded: ${h.jsonl().length}`);
    const { json } = await h.reports();
    assert.ok(json.total <= 5);
  });

  test('reloads the index from disk after a restart', async () => {
    const before = h.jsonl().map((r) => r.id);
    await h.restart();
    const { json } = await h.reports();
    assert.equal(json.total, before.length);
    assert.deepEqual(json.reports.map((r) => r.id).reverse(), before);
  });

  test('a corrupt log line is skipped, not fatal', async () => {
    fs.appendFileSync(path.join(h.dir, 'reports.jsonl'), 'this is not json\n{"partial":\n');
    await h.restart();
    const { res, json } = await h.reports();
    assert.equal(res.status, 200);
    assert.ok(json.total >= 1);
    const { res: postRes } = await h.postJson(validReport({ device_id: DEVICE_B }), { ip: '203.0.113.42' });
    assert.equal(postRes.status, 200);
  });
});

// ===========================================================================
describe('existing endpoints are unaffected', () => {
  const h = new Harness();
  before(() => h.start());
  after(() => h.cleanup());

  test('health, status and cached data endpoints still respond', async () => {
    const routes = [
      '/api/health',
      '/api/status',
      '/api/solar',
      '/api/dxspots',
      '/api/propagation?fromLat=40&fromLng=-74&toLat=51&toLng=0',
    ];
    for (const route of routes) {
      const res = await fetch(`${h.base}${route}`);
      const text = await res.text();
      assert.equal(res.status, 200, `${route} -> ${res.status}`);
      assert.doesNotThrow(() => JSON.parse(text), `${route} did not return JSON`);
    }
  });

  test('the global 100 kb body limit is NOT raised for other routes', async () => {
    const res = await fetch(`${h.base}/api/health`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 'a'.repeat(200 * 1024) }),
    });
    await res.text();
    assert.equal(res.status, 413, 'only /api/telemetry may accept >100 kb');
  });

  test('an unknown /api path is still a 404, not a telemetry route', async () => {
    const res = await fetch(`${h.base}/api/telemetry/nope`);
    await res.text();
    assert.equal(res.status, 404);
  });
});
