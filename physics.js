// physics.js — RF propagation calculations

const C_LIGHT = 299792458; // m/s
const R_EARTH = 6371000; // m
const K_FACTOR = 4 / 3; // standard atmospheric refraction k-factor

// Haversine — great-circle distance (m)
function haversine(lat1, lon1, lat2, lon2) {
  const toRad = (d) => d * Math.PI / 180;
  const phi1 = toRad(lat1), phi2 = toRad(lat2);
  const dphi = toRad(lat2 - lat1);
  const dlam = toRad(lon2 - lon1);
  const a = Math.sin(dphi/2)**2 + Math.cos(phi1)*Math.cos(phi2)*Math.sin(dlam/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R_EARTH * c;
}

// Free-space path loss (dB)
function fspl_db(d_m, f_hz) {
  if (d_m <= 0) return 0;
  return 20 * Math.log10(4 * Math.PI * d_m * f_hz / C_LIGHT);
}

// Two-ray ground reflection model (dB total path loss)
// Reflection coeff = -1 (PEC ground approximation, valid for grazing incidence)
function tworay_db(d_m, ht_m, hr_m, f_hz) {
  if (d_m <= 0) return 0;
  const lambda = C_LIGHT / f_hz;
  const d_los = Math.sqrt(d_m**2 + (ht_m - hr_m)**2);
  const d_ref = Math.sqrt(d_m**2 + (ht_m + hr_m)**2);
  const dphi = (2 * Math.PI / lambda) * (d_ref - d_los);
  // |1 + Gamma * exp(-j*dphi)| where Gamma = -1
  const re = 1 - Math.cos(dphi);
  const im = -Math.sin(dphi);
  const mag = Math.sqrt(re*re + im*im);
  const fspl_to_los = 20 * Math.log10(4 * Math.PI * d_los / lambda);
  const interference = mag > 1e-9 ? 20 * Math.log10(mag) : -60;
  return fspl_to_los - interference;
}

// First Fresnel zone radius at midpoint (m)
function fresnel1_mid(d_m, f_hz) {
  const lambda = C_LIGHT / f_hz;
  return 0.5 * Math.sqrt(lambda * d_m);
}

// Earth bulge at midpoint (m), with k-factor refraction
function earth_bulge_mid(d_m) {
  return (d_m * d_m) / (8 * K_FACTOR * R_EARTH);
}

// Required antenna height for symmetric setup to clear 60% of Fresnel zone
function min_sym_height(d_m, f_hz) {
  return 0.6 * fresnel1_mid(d_m, f_hz) + earth_bulge_mid(d_m);
}

// LoRa effective bit rate (bps): Rb = SF * BW * 4 / (2^SF * (4+CR))
function lora_bitrate(sf, bw_khz, cr) {
  const bw = bw_khz * 1000;
  return (sf * bw * 4) / (Math.pow(2, sf) * (4 + cr));
}

// LoRa Time on Air (s) — Semtech AN1200.13 simplified
function lora_toa(sf, bw_khz, cr, payload_bytes, preamble = 8, header = 1, crc = 1) {
  const bw = bw_khz * 1000;
  const Tsym = Math.pow(2, sf) / bw;
  const Tpreamble = (preamble + 4.25) * Tsym;
  const lowDR = sf >= 11 ? 1 : 0;
  const num = 8 * payload_bytes - 4 * sf + 28 + 16 * crc - 20 * (1 - header);
  const den = 4 * (sf - 2 * lowDR);
  const payloadSym = 8 + Math.max(Math.ceil(num / den) * (4 + cr), 0);
  return Tpreamble + payloadSym * Tsym;
}

// Convert dBm to mW
function dbm_to_mw(dbm) { return Math.pow(10, dbm / 10); }
function mw_to_dbm(mw) { return 10 * Math.log10(mw); }

// Compute one hop's link metrics
function compute_hop_metrics(opts) {
  // opts: { d_m, h_a, h_b, f_hz, tx_dbm, g_tx, l_tx, g_rx, l_rx, sens_dbm, use_tworay, fade_db }
  const fspl = fspl_db(opts.d_m, opts.f_hz);
  const tworay = tworay_db(opts.d_m, opts.h_a, opts.h_b, opts.f_hz);
  const path = opts.use_tworay ? tworay : fspl;
  const ground_extra = (opts.h_a < 0.5 || opts.h_b < 0.5) ? 2 : 0;
  const eirp = opts.tx_dbm + opts.g_tx - opts.l_tx;
  const prx = eirp - path - opts.fade_db - ground_extra + opts.g_rx - opts.l_rx;
  const margin = prx - opts.sens_dbm;
  const F1 = fresnel1_mid(opts.d_m, opts.f_hz);
  const bulge = earth_bulge_mid(opts.d_m);
  const min_h = min_sym_height(opts.d_m, opts.f_hz);
  return { fspl, tworay, path, eirp, prx, margin, F1, bulge, min_h, ground_extra };
}

// Node.js compatibility (keep browser globals intact)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    haversine, fspl_db, tworay_db, fresnel1_mid, earth_bulge_mid,
    min_sym_height, lora_bitrate, lora_toa, dbm_to_mw, mw_to_dbm,
    compute_hop_metrics,
  };
}
