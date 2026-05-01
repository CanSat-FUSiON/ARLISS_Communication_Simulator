// physics.js — RF propagation calculations

const C_LIGHT = 299792458; // m/s
const R_EARTH = 6371000; // m
const K_FACTOR = 4 / 3; // standard atmospheric refraction k-factor
const EPS_0 = 8.854e-12; // F/m

// Ground material presets for Fresnel reflection model
const GROUND_PRESETS = {
  dry_sand:  { label: '乾燥砂(砂漠)', eps_r: 3.0,  sigma: 1e-4 },
  wet_sand:  { label: '湿った砂',     eps_r: 10.0, sigma: 1e-3 },
  rock:      { label: '岩盤',         eps_r: 6.0,  sigma: 1e-3 },
};

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

// ── Complex number helpers ────────────────────────────────────────────────────

function cadd(a, b) { return { r: a.r + b.r, i: a.i + b.i }; }
function csub(a, b) { return { r: a.r - b.r, i: a.i - b.i }; }
function cmul(a, b) { return { r: a.r*b.r - a.i*b.i, i: a.r*b.i + a.i*b.r }; }
function cdiv(a, b) {
  const d = b.r*b.r + b.i*b.i;
  return { r: (a.r*b.r + a.i*b.i)/d, i: (a.i*b.r - a.r*b.i)/d };
}
function csqrt(c) {
  const m = Math.sqrt(c.r*c.r + c.i*c.i);
  const ang = Math.atan2(c.i, c.r);
  return { r: Math.sqrt(m) * Math.cos(ang/2), i: Math.sqrt(m) * Math.sin(ang/2) };
}
function cabs(c) { return Math.sqrt(c.r*c.r + c.i*c.i); }

// Fresnel reflection coefficients at a dielectric interface.
// psi_rad: grazing angle (radians from horizontal)
// Returns { H: complex Γ_H, V: complex Γ_V }
// Based on Rappaport "Wireless Communications" 2nd ed., Section 4.5
function fresnel_reflect(psi_rad, f_hz, eps_r, sigma) {
  const omega = 2 * Math.PI * f_hz;
  // Complex relative permittivity: ε_c = ε_r - j*σ/(ω*ε_0)
  const eps_c = { r: eps_r, i: -(sigma / (omega * EPS_0)) };

  const sin_psi = Math.sin(psi_rad);
  const cos2_psi = Math.cos(psi_rad) ** 2;

  // A = sqrt(ε_c − cos²(ψ))
  const A = csqrt(csub(eps_c, { r: cos2_psi, i: 0 }));

  // Γ_H = (sin(ψ) − A) / (sin(ψ) + A)
  const sp = { r: sin_psi, i: 0 };
  const gamH = cdiv(csub(sp, A), cadd(sp, A));

  // Γ_V = (ε_c·sin(ψ) − A) / (ε_c·sin(ψ) + A)
  const epsC_sp = cmul(eps_c, sp);
  const gamV = cdiv(csub(epsC_sp, A), cadd(epsC_sp, A));

  return { H: gamH, V: gamV };
}

// Two-ray ground reflection model (dB total path loss).
// gamma_opts: null → PEC (Γ=-1); { pol:'V'|'H', eps_r, sigma } → Fresnel model
function tworay_db(d_m, ht_m, hr_m, f_hz, gamma_opts) {
  if (d_m <= 0) return 0;
  const lambda = C_LIGHT / f_hz;
  const d_los = Math.sqrt(d_m**2 + (ht_m - hr_m)**2);
  const d_ref = Math.sqrt(d_m**2 + (ht_m + hr_m)**2);
  const dphi = (2 * Math.PI / lambda) * (d_ref - d_los);

  let gamma_r, gamma_i;
  if (gamma_opts && gamma_opts.eps_r != null) {
    // Grazing angle at the reflection point
    const psi = Math.asin((ht_m + hr_m) / d_ref);
    const ref = fresnel_reflect(psi, f_hz, gamma_opts.eps_r, gamma_opts.sigma || 0);
    const gam = gamma_opts.pol === 'H' ? ref.H : ref.V;
    gamma_r = gam.r; gamma_i = gam.i;
  } else {
    // PEC: Γ = -1
    gamma_r = -1; gamma_i = 0;
  }

  // |1 + Γ·exp(−j·dphi)|
  // exp(−j·dphi) = cos(dphi) − j·sin(dphi)
  const g_re = gamma_r * Math.cos(dphi) - gamma_i * (-Math.sin(dphi));
  const g_im = gamma_r * (-Math.sin(dphi)) + gamma_i * Math.cos(dphi);
  const re = 1 + g_re;
  const im = g_im;
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
  // opts: { d_m, h_a, h_b, f_hz, tx_dbm, g_tx, l_tx, g_rx, l_rx, sens_dbm,
  //         use_tworay, fade_db, gamma_opts? }
  const fspl = fspl_db(opts.d_m, opts.f_hz);
  const tworay = tworay_db(opts.d_m, opts.h_a, opts.h_b, opts.f_hz, opts.gamma_opts || null);
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
    haversine, fspl_db, tworay_db, fresnel_reflect, fresnel1_mid, earth_bulge_mid,
    min_sym_height, lora_bitrate, lora_toa, dbm_to_mw, mw_to_dbm,
    compute_hop_metrics, GROUND_PRESETS,
  };
}
