// Unit tests for physics.js — RF propagation calculations
// Run: npm test
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const p = require('../physics.js');

// ── Validation vectors from spec ──────────────────────────────────────────────

test('haversine: ARLISS coordinates → 35810 m ±50 m', () => {
  const d = p.haversine(40.900522, -119.07909722, 40.654113159604734, -119.3529299890043);
  assert.ok(
    Math.abs(d - 35810) < 50,
    `Expected 35810±50 m, got ${d.toFixed(1)} m`,
  );
});

test('fspl_db: 35.81 km at 920 MHz → 122.8 dB ±0.5 dB', () => {
  const v = p.fspl_db(35810, 920e6);
  assert.ok(
    Math.abs(v - 122.8) < 0.5,
    `Expected 122.8±0.5 dB, got ${v.toFixed(3)} dB`,
  );
});

test('tworay_db: 30 km, ht=0.3 m, hr=4 m, 920 MHz → ~177.5 dB', () => {
  const v = p.tworay_db(30000, 0.3, 4, 920e6);
  assert.ok(
    Math.abs(v - 177.5) < 3,
    `Expected ~177.5 dB, got ${v.toFixed(2)} dB`,
  );
});

test('lora_bitrate: SF=10 BW=125kHz CR=1 → 977 bps (rounded)', () => {
  const rb = p.lora_bitrate(10, 125, 1);
  assert.strictEqual(Math.round(rb), 977, `Expected 977, got ${Math.round(rb)}`);
});

test('fresnel1_mid: 30 km at 920 MHz → 49.4 m ±0.5 m', () => {
  const v = p.fresnel1_mid(30000, 920e6);
  assert.ok(
    Math.abs(v - 49.4) < 0.5,
    `Expected 49.4±0.5 m, got ${v.toFixed(2)} m`,
  );
});

test('earth_bulge_mid: 30 km → 13.24 m ±0.1 m', () => {
  const v = p.earth_bulge_mid(30000);
  assert.ok(
    Math.abs(v - 13.24) < 0.1,
    `Expected 13.24±0.1 m, got ${v.toFixed(3)} m`,
  );
});

// ── Two-ray asymptotic behavior ───────────────────────────────────────────────

test('tworay_db asymptotic: frequency-independent at long range (920 vs 433 MHz)', () => {
  const v920 = p.tworay_db(30000, 0.3, 4, 920e6);
  const v433 = p.tworay_db(30000, 0.3, 4, 433e6);
  assert.ok(
    Math.abs(v920 - v433) < 1.0,
    `Two-ray should be freq-independent: 920 MHz=${v920.toFixed(2)}, 433 MHz=${v433.toFixed(2)}, diff=${Math.abs(v920-v433).toFixed(3)}`,
  );
});

test('tworay_db asymptotic: matches 40log(d)−20log(ht)−20log(hr) formula', () => {
  const d = 30000, ht = 0.3, hr = 4;
  const expected = 40 * Math.log10(d) - 20 * Math.log10(ht) - 20 * Math.log10(hr);
  const actual = p.tworay_db(d, ht, hr, 920e6);
  assert.ok(
    Math.abs(actual - expected) < 2.0,
    `Expected asymptotic ${expected.toFixed(2)} dB, got ${actual.toFixed(2)} dB`,
  );
});

// ── LoRa Time on Air ──────────────────────────────────────────────────────────

test('lora_toa: SF=7, BW=125kHz, CR=1, 20 bytes → ~56.6 ms', () => {
  const toa_ms = p.lora_toa(7, 125, 1, 20) * 1000;
  assert.ok(
    Math.abs(toa_ms - 56.576) < 2,
    `Expected ~56.6 ms, got ${toa_ms.toFixed(1)} ms`,
  );
});

test('lora_toa: SF=12 uses low data rate optimization (lowDR=1)', () => {
  // SF12: lowDR should activate, making ToA much longer than SF11
  const toa11 = p.lora_toa(11, 125, 1, 32) * 1000;
  const toa12 = p.lora_toa(12, 125, 1, 32) * 1000;
  assert.ok(toa12 > toa11 * 1.8, `SF12 ToA (${toa12.toFixed(0)}ms) should be >1.8× SF11 (${toa11.toFixed(0)}ms)`);
});

// ── Edge cases ────────────────────────────────────────────────────────────────

test('fspl_db: zero distance returns 0', () => {
  assert.strictEqual(p.fspl_db(0, 920e6), 0);
});

test('haversine: same point returns 0', () => {
  const d = p.haversine(40.9, -119.1, 40.9, -119.1);
  assert.ok(d < 1e-6, `Expected ~0, got ${d}`);
});

test('dbm_to_mw / mw_to_dbm: round-trip 20 dBm ↔ 100 mW', () => {
  assert.ok(Math.abs(p.dbm_to_mw(20) - 100) < 0.01);
  assert.ok(Math.abs(p.mw_to_dbm(100) - 20) < 0.01);
});

// ── compute_hop_metrics integration ──────────────────────────────────────────

test('compute_hop_metrics: 35.8 km, FSPL mode, known antenna params', () => {
  const m = p.compute_hop_metrics({
    d_m: 35810,
    h_a: 0.3,
    h_b: 4.0,
    f_hz: 920e6,
    tx_dbm: 13,
    g_tx: 2.1,
    l_tx: 1.0,
    g_rx: 12.5,
    l_rx: 1.5,
    sens_dbm: -132,
    use_tworay: false,
    fade_db: 8,
  });
  // eirp = 13 + 2.1 - 1.0 = 14.1 dBm
  assert.ok(Math.abs(m.eirp - 14.1) < 0.01, `EIRP: expected 14.1, got ${m.eirp}`);
  // fspl ~122.8 dB
  assert.ok(Math.abs(m.fspl - 122.8) < 0.5, `FSPL: expected ~122.8, got ${m.fspl.toFixed(2)}`);
  // prx = 14.1 - 122.8 - 8 - 2(ground) + 12.5 - 1.5 = -107.7
  assert.ok(typeof m.margin === 'number' && isFinite(m.margin));
});

test('compute_hop_metrics: two-ray mode gives higher loss than FSPL at long range', () => {
  const base = { d_m: 35810, h_a: 0.3, h_b: 4.0, f_hz: 920e6, tx_dbm: 13,
    g_tx: 2.0, l_tx: 0, g_rx: 0, l_rx: 0, sens_dbm: -130, fade_db: 0 };
  const fspl_m  = p.compute_hop_metrics({ ...base, use_tworay: false });
  const tworay_m = p.compute_hop_metrics({ ...base, use_tworay: true });
  assert.ok(tworay_m.margin < fspl_m.margin, 'Two-ray should give lower margin (more loss) at long range with low antennas');
});
