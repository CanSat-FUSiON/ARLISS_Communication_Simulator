// app.js — main application logic

// ------------------- State -------------------
const state = {
  band: '920',
  txPwr: 13,
  txGain: null, // resolved from antenna preset
  txGainCustom: 2.0,
  txAntId: 'whip-rfd900',
  rxGain: null,
  rxGainCustom: 12.0,
  rxAntId: 'yagi-9el',
  hCansat: 0.3,
  hBase: 4.0,
  hRelay: 2.0,       // default for new relays
  rxAzimuth: null,   // null = auto-computed bearing to CanSat
  sf: 10,
  bw: 125,
  cr: 1,
  payload: 32,
  useTwoRay: true,
  gammaMode: 'fresnel',    // 'pec' | 'fresnel'
  groundPreset: 'dry_sand', // key into GROUND_PRESETS
  pol: 'V',                // 'V' | 'H'
  includeFade: true,
  marginTarget: 10,
  // map / relays
  cansat: { ...COORD_CANSAT },
  base:   { ...COORD_BASE },
  relays: [], // [{id, lat, lon, h, antId, gainCustom, azimuth}]
  // requirements
  req: {
    duration: 'day',
    latency: 'near',
    bidir: 'bidir',
    power: 'moderate',
    notes: '',
  },
};

let nextRelayId = 1;
let map, cansatMarker, baseMarker, relayMarkers = {}, pathLine;

// ------------------- Antenna helpers -------------------
function getAnt(id) {
  return ANTENNAS.find(a => a.id === id) || ANTENNAS[0];
}
function antennaGain(antId, customVal) {
  const a = getAnt(antId);
  if (a.id === 'custom') return customVal != null ? customVal : 2.0;
  return a.gain_dbi;
}
function antennasFor(role, band) {
  // role: 'cansat' / 'base' / 'relay'
  return ANTENNAS.filter(a => {
    if (!a.bands.includes(band)) return false;
    if (role === 'cansat' && !a.cansat_ok) return false;
    if (role === 'base' && !a.base_ok) return false;
    if (role === 'relay' && !a.relay_ok) return false;
    return true;
  });
}

// ------------------- Build antenna selects -------------------
function rebuildAntennaSelects() {
  const cansatSel = document.getElementById('cansat-ant');
  const baseSel = document.getElementById('base-ant');

  const cansatOpts = antennasFor('cansat', state.band);
  const baseOpts = antennasFor('base', state.band);

  cansatSel.innerHTML = cansatOpts.map(a => {
    const g = a.id === 'custom' ? '可変' : `${a.gain_dbi.toFixed(1)} dBi`;
    return `<option value="${a.id}">${a.name} (${g})</option>`;
  }).join('');
  baseSel.innerHTML = baseOpts.map(a => {
    const g = a.id === 'custom' ? '可変' : `${a.gain_dbi.toFixed(1)} dBi`;
    return `<option value="${a.id}">${a.name} (${g})</option>`;
  }).join('');

  // Choose existing or fall back
  if (cansatOpts.find(a => a.id === state.txAntId)) cansatSel.value = state.txAntId;
  else { state.txAntId = cansatOpts[0].id; cansatSel.value = state.txAntId; }
  if (baseOpts.find(a => a.id === state.rxAntId)) baseSel.value = state.rxAntId;
  else { state.rxAntId = baseOpts[0].id; baseSel.value = state.rxAntId; }

  updateAntennaNotes();
}
function updateAntennaNotes() {
  const ca = getAnt(state.txAntId);
  const ba = getAnt(state.rxAntId);
  document.getElementById('cansat-ant-note').textContent =
    `${ca.note} · パターン: ${ca.pattern === 'omni' ? '無指向' : '指向性'}` + (ca.price_jpy ? ` · 約¥${ca.price_jpy.toLocaleString()}` : '');
  document.getElementById('base-ant-note').textContent =
    `${ba.note} · パターン: ${ba.pattern === 'omni' ? '無指向' : '指向性'}` + (ba.price_jpy ? ` · 約¥${ba.price_jpy.toLocaleString()}` : '');
}

// ------------------- Map -------------------
function initMap() {
  // Center between cansat and base
  const cy = (state.cansat.lat + state.base.lat) / 2;
  const cx = (state.cansat.lon + state.base.lon) / 2;
  map = L.map('map', { zoomControl: true, attributionControl: true }).setView([cy, cx], 11);

  // Esri World Imagery (no API key required)
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, GIS User Community',
    maxZoom: 18,
  }).addTo(map);

  // Reference: OSM labels overlay (transparent)
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
    attribution: '',
    maxZoom: 18,
    opacity: 0.6,
  }).addTo(map);

  // CanSat marker (fixed)
  const cansatIcon = L.divIcon({
    className: 'cansat-marker',
    iconSize: [16, 16],
    html: '',
  });
  cansatMarker = L.marker([state.cansat.lat, state.cansat.lon], { icon: cansatIcon, draggable: false })
    .addTo(map)
    .bindPopup(`<strong>CanSat (始点)</strong><br>${state.cansat.lat.toFixed(6)}, ${state.cansat.lon.toFixed(6)}`);

  // Base marker (fixed)
  const baseIcon = L.divIcon({
    className: 'base-marker',
    iconSize: [16, 16],
    html: '',
  });
  baseMarker = L.marker([state.base.lat, state.base.lon], { icon: baseIcon, draggable: false })
    .addTo(map)
    .bindPopup(`<strong>地上局 (終点)</strong><br>${state.base.lat.toFixed(6)}, ${state.base.lon.toFixed(6)}`);

  // Map click → add relay
  map.on('click', (e) => {
    if (state.relays.length >= MAX_RELAYS) {
      alert(`中継器は最大 ${MAX_RELAYS} 台までです`);
      return;
    }
    addRelay(e.latlng.lat, e.latlng.lng);
  });

  // Fit bounds to include both endpoints + padding
  const bounds = L.latLngBounds([state.cansat.lat, state.cansat.lon], [state.base.lat, state.base.lon]);
  map.fitBounds(bounds.pad(0.4));
}

function addRelay(lat, lon) {
  const id = nextRelayId++;
  const defaultAnt = antennasFor('relay', state.band)[0];
  const relay = {
    id,
    lat, lon,
    h: state.hRelay,
    antId: defaultAnt.id,
    gainCustom: 2.0,
    azimuth: null, // null = auto-computed bearing toward next node
  };
  state.relays.push(relay);
  drawRelayOnMap(relay);
  recompute();
}

function drawRelayOnMap(relay) {
  const icon = L.divIcon({ className: 'relay-marker', iconSize: [14, 14], html: '' });
  const marker = L.marker([relay.lat, relay.lon], { icon, draggable: true });
  marker.bindPopup(buildRelayPopup(relay));
  marker.on('dragend', (e) => {
    const ll = e.target.getLatLng();
    relay.lat = ll.lat;
    relay.lon = ll.lng;
    marker.setPopupContent(buildRelayPopup(relay));
    recompute();
  });
  marker.addTo(map);
  relayMarkers[relay.id] = marker;
}

function buildRelayPopup(relay) {
  return `<strong>中継器 R${relay.id}</strong><br>${relay.lat.toFixed(5)}, ${relay.lon.toFixed(5)}<br>高さ: ${relay.h.toFixed(1)}m<br><button onclick="removeRelay(${relay.id})" style="margin-top:6px;font-size:10px;padding:2px 8px;">削除</button>`;
}

function removeRelay(id) {
  state.relays = state.relays.filter(r => r.id !== id);
  if (relayMarkers[id]) {
    map.removeLayer(relayMarkers[id]);
    delete relayMarkers[id];
  }
  recompute();
}
window.removeRelay = removeRelay;

function clearAllRelays() {
  state.relays.forEach(r => {
    if (relayMarkers[r.id]) map.removeLayer(relayMarkers[r.id]);
  });
  state.relays = [];
  relayMarkers = {};
  recompute();
}

// Order relays along the CanSat→Base axis by projection distance
function orderedRelays() {
  if (state.relays.length === 0) return [];
  const dxTotal = state.base.lon - state.cansat.lon;
  const dyTotal = state.base.lat - state.cansat.lat;
  const len2 = dxTotal*dxTotal + dyTotal*dyTotal;
  if (len2 < 1e-12) return [...state.relays];
  return [...state.relays].sort((a, b) => {
    const ta = ((a.lon - state.cansat.lon) * dxTotal + (a.lat - state.cansat.lat) * dyTotal) / len2;
    const tb = ((b.lon - state.cansat.lon) * dxTotal + (b.lat - state.cansat.lat) * dyTotal) / len2;
    return ta - tb;
  });
}

function updatePathLine() {
  if (pathLine) map.removeLayer(pathLine);
  const pts = [
    [state.cansat.lat, state.cansat.lon],
    ...orderedRelays().map(r => [r.lat, r.lon]),
    [state.base.lat, state.base.lon],
  ];
  pathLine = L.polyline(pts, { color: '#7fffb0', weight: 2, opacity: 0.7, dashArray: '4 4' }).addTo(map);
}

// ------------------- Compute hops -------------------
function computeHops() {
  const f_hz = BANDS[state.band].f_mhz * 1e6;
  const sens = LORA_SENS[state.bw][state.sf];
  const fade = state.includeFade ? 8 : 0;

  const ordered = orderedRelays();
  const nodes = [
    { type: 'cansat', lat: state.cansat.lat, lon: state.cansat.lon, h: state.hCansat,
      gain: antennaGain(state.txAntId, state.txGainCustom),
      ant: getAnt(state.txAntId), azimuth: null, label: 'CanSat' },
    ...ordered.map(r => ({
      type: 'relay', lat: r.lat, lon: r.lon, h: r.h,
      gain: antennaGain(r.antId, r.gainCustom),
      ant: getAnt(r.antId), azimuth: r.azimuth, label: `中継R${r.id}`, relay: r,
    })),
    { type: 'base', lat: state.base.lat, lon: state.base.lon, h: state.hBase,
      gain: antennaGain(state.rxAntId, state.rxGainCustom),
      ant: getAnt(state.rxAntId),
      azimuth: state.rxAzimuth !== null ? state.rxAzimuth
               : bearing(state.base.lat, state.base.lon, state.cansat.lat, state.cansat.lon),
      label: '地上局' },
  ];

  const hops = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i];
    const b = nodes[i + 1];
    const d_m = haversine(a.lat, a.lon, b.lat, b.lon);
    const tx_dbm = state.txPwr;
    const gamma_opts = (state.useTwoRay && state.gammaMode === 'fresnel')
      ? { pol: state.pol, ...GROUND_PRESETS[state.groundPreset] }
      : null;

    // Bearing of the link
    const brg_ab = bearing(a.lat, a.lon, b.lat, b.lon);
    const brg_ba = bearing(b.lat, b.lon, a.lat, a.lon);

    // TX pointing deviation (CanSat is effectively omni, no pointing loss from TX)
    const az_tx = (a.azimuth !== null) ? a.azimuth : brg_ab;
    const dev_tx = Math.abs(angle_diff(az_tx, brg_ab));

    // RX pointing deviation
    const az_rx = (b.azimuth !== null) ? b.azimuth : brg_ba;
    const dev_rx = Math.abs(angle_diff(az_rx, brg_ba));

    const m = compute_hop_metrics({
      d_m, h_a: a.h, h_b: b.h, f_hz,
      tx_dbm, g_tx: a.gain, l_tx: 1.0,
      g_rx: b.gain, l_rx: 1.5,
      sens_dbm: sens, use_tworay: state.useTwoRay, fade_db: fade,
      gamma_opts,
      hpbw_tx: a.ant.hpbw_deg, fb_tx: a.ant.fb_db, dev_tx,
      hpbw_rx: b.ant.hpbw_deg, fb_rx: b.ant.fb_db, dev_rx,
    });
    hops.push({
      label: `${a.label} → ${b.label}`,
      d_m, d_km: d_m / 1000,
      h_a: a.h, h_b: b.h,
      brg_ab, az_tx, az_rx, dev_tx, dev_rx,
      ...m, sens,
    });
  }
  return hops;
}

// ------------------- Render -------------------
function recompute() {
  const hops = computeHops();
  const worst = hops.reduce((w, h) => (w === null || h.margin < w.margin) ? h : w, null);
  const rb = lora_bitrate(state.sf, state.bw, state.cr);
  const toa = lora_toa(state.sf, state.bw, state.cr, state.payload);
  const sens = LORA_SENS[state.bw][state.sf];
  const eirp = state.txPwr + antennaGain(state.txAntId, state.txGainCustom) - 1.0;
  const tx_mw = dbm_to_mw(state.txPwr);

  // Top stats
  const vMargin = document.getElementById('v-margin');
  const sMargin = document.getElementById('stat-margin');
  if (worst) {
    vMargin.textContent = worst.margin.toFixed(1);
    sMargin.classList.remove('bad', 'warn', 'good');
    if (worst.margin < 0) sMargin.classList.add('bad');
    else if (worst.margin < state.marginTarget) sMargin.classList.add('warn');
    else sMargin.classList.add('good');
  } else {
    vMargin.textContent = '--';
  }

  document.getElementById('v-bitrate').textContent = Math.round(rb);
  document.getElementById('v-hopd').textContent = hops.length ? Math.max(...hops.map(h => h.d_km)).toFixed(2) : '--';
  document.getElementById('v-toa').textContent = Math.round(toa * 1000);

  // ARLISS check (100mW = 20dBm)
  const arlissCard = document.getElementById('stat-arliss');
  const vArliss = document.getElementById('v-arliss');
  arlissCard.classList.remove('bad', 'good');
  if (state.txPwr > 20) {
    arlissCard.classList.add('bad');
    vArliss.textContent = `超過 (+${(state.txPwr - 20).toFixed(0)}dB)`;
    document.querySelector('.slider-bar-wrap').classList.add('arliss-over');
  } else {
    arlissCard.classList.add('good');
    vArliss.textContent = `OK (${tx_mw.toFixed(0)} mW)`;
    document.querySelector('.slider-bar-wrap').classList.remove('arliss-over');
  }

  // Tx panel readouts
  document.getElementById('v-tx-pwr').textContent = state.txPwr;
  document.getElementById('v-tx-mw').textContent = tx_mw.toFixed(tx_mw < 10 ? 1 : 0);
  document.getElementById('v-eirp').textContent = eirp.toFixed(1);
  document.getElementById('v-h-cansat').textContent = state.hCansat.toFixed(2);
  document.getElementById('v-h-base').textContent = state.hBase.toFixed(1);
  document.getElementById('v-payload').textContent = state.payload;

  // LoRa info box
  document.getElementById('v-sens').textContent = sens.toFixed(1);
  document.getElementById('v-rb-info').textContent = Math.round(rb);
  document.getElementById('v-toa-info').textContent = Math.round(toa * 1000);

  // Margin target readout
  document.getElementById('v-margin-target').textContent = state.marginTarget;

  // Band note
  const b = BANDS[state.band];
  document.getElementById('band-note').textContent = `${b.note_jp} / ${b.note_us}`;

  // Hops table
  const tbody = document.getElementById('hops-tbody');
  tbody.innerHTML = hops.map(h => {
    let cls = 'good';
    if (h.margin < 0) cls = 'bad';
    else if (h.margin < state.marginTarget) cls = 'warn';
    const sign = h.margin >= 0 ? '+' : '';
    return `<tr class="${cls}">
      <td>${h.label}</td>
      <td>${h.d_km.toFixed(2)}</td>
      <td>${h.fspl.toFixed(1)}</td>
      <td>${h.tworay.toFixed(1)}</td>
      <td>${h.eirp.toFixed(1)}</td>
      <td>${h.prx.toFixed(1)}</td>
      <td>${h.sens.toFixed(1)}</td>
      <td class="margin">${sign}${h.margin.toFixed(1)}</td>
      <td>${(h.point_loss_tx + h.point_loss_rx).toFixed(1)}</td>
      <td>${h.F1.toFixed(1)}</td>
      <td>${h.bulge.toFixed(2)}</td>
    </tr>`;
  }).join('');

  // Verdict
  renderVerdict(hops, worst, rb);

  // Geometry SVG
  drawGeometry(hops);

  // Relay list
  renderRelayList();

  // Map path
  if (map) {
    updatePathLine();
    drawBeamLayers();
  }

  // Relay count
  document.getElementById('relay-count').textContent = state.relays.length;
}

function renderVerdict(hops, worst, rb) {
  let html = '';
  if (!worst) {
    document.getElementById('verdict-text').innerHTML = '区間を計算できませんでした。';
    return;
  }
  if (worst.margin < 0) {
    html = `<span class="verdict-bad">通信不可</span>: 最弱区間「${worst.label}」(${worst.d_km.toFixed(2)} km)で受信電力が感度を下回ります(${worst.margin.toFixed(1)} dB不足)。`;
  } else if (worst.margin < 3) {
    html = `<span class="verdict-warn">通信は理論上可能だが不安定</span>: マージン ${worst.margin.toFixed(1)} dB は微少なフェージングで途切れる水準です。`;
  } else if (worst.margin < state.marginTarget) {
    html = `<span class="verdict-warn">通信可能だが瞬断あり</span>: マージン ${worst.margin.toFixed(1)} dB。マルチパスや偏波ずれで一時的にパケットが欠落する可能性。ARQでの再送補完を前提に。`;
  } else if (worst.margin < state.marginTarget + 10) {
    html = `<span class="verdict-good">安定通信が期待できます</span>: マージン ${worst.margin.toFixed(1)} dB は十分な余裕です。`;
  } else {
    html = `<span class="verdict-good">十分なマージン</span>(${worst.margin.toFixed(1)} dB)。SFを下げてデータレートを上げる余地があります。`;
  }

  if (rb < 1000) {
    html += `<br><span class="verdict-warn">⚠ ビットレート ${Math.round(rb)} bps は要求 1 kbps を下回ります</span>。SFを下げる/BWを上げる必要があります。`;
  } else {
    html += `<br>ビットレート ${Math.round(rb)} bps は要求 1 kbps の ${(rb/1000).toFixed(1)}倍。`;
  }

  // Bottleneck info
  if (worst.margin < state.marginTarget + 5) {
    html += `<div class="bottleneck">
      <div class="bottleneck-label">BOTTLENECK</div>
      <div>制約区間: <span style="color:var(--phosphor)">${worst.label}</span> (${worst.d_km.toFixed(2)} km)</div>
      <div>距離での自由空間損失: ${worst.fspl.toFixed(1)} dB / 2波モデル: ${worst.tworay.toFixed(1)} dB</div>
      <div>F1ゾーン半径(中点): ${worst.F1.toFixed(1)} m / 地球バルジ: ${worst.bulge.toFixed(2)} m</div>
      <div>必要平均アンテナ高: ${worst.min_h.toFixed(2)} m (現状平均: ${((worst.h_a + worst.h_b)/2).toFixed(2)} m)</div>
    </div>`;
  }

  document.getElementById('verdict-text').innerHTML = html;
}

function renderRelayList() {
  const list = document.getElementById('relay-list');
  const empty = document.getElementById('relay-empty');
  if (state.relays.length === 0) {
    list.innerHTML = '';
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';
  list.innerHTML = orderedRelays().map(r => {
    const opts = antennasFor('relay', state.band);
    // Fallback: if current antId is no longer available in the selected band, reset to first
    if (!opts.find(a => a.id === r.antId)) r.antId = opts[0].id;
    const antOpts = opts.map(a => {
      const sel = a.id === r.antId ? ' selected' : '';
      const g = a.id === 'custom' ? '可変' : `${a.gain_dbi.toFixed(1)} dBi`;
      return `<option value="${a.id}"${sel}>${a.name} (${g})</option>`;
    }).join('');
    const curAnt = opts.find(a => a.id === r.antId) || opts[0];
    const showAz = curAnt.pattern === 'dir';
    const azLabel = r.azimuth !== null ? `${r.azimuth}°` : '自動';
    const azVal = r.azimuth !== null ? r.azimuth : 0;
    return `<div class="relay-card" data-id="${r.id}">
      <div class="relay-card-head">
        <span class="relay-card-title">中継器 R${r.id}</span>
        <span class="relay-card-coord">${r.lat.toFixed(5)}, ${r.lon.toFixed(5)}</span>
      </div>
      <div class="relay-card-grid">
        <div class="field">
          <label>アンテナ</label>
          <select onchange="updateRelayAnt(${r.id}, this.value)">${antOpts}</select>
        </div>
        <div class="field">
          <label>高さ ${r.h.toFixed(1)} m</label>
          <input type="range" min="0.3" max="6" step="0.1" value="${r.h}" oninput="updateRelayH(${r.id}, parseFloat(this.value))">
        </div>
      </div>
      ${showAz ? `<div class="field" style="margin-top:6px;">
        <label>指向方位: <span id="v-relay-az-${r.id}">${azLabel}</span></label>
        <div style="display:flex;gap:6px;align-items:center;">
          <button class="mini${r.azimuth === null ? ' active' : ''}" onclick="updateRelayAzimuth(${r.id},null)" style="flex:none;">自動</button>
          <input type="range" min="0" max="359" step="1" value="${azVal}" oninput="updateRelayAzimuth(${r.id},parseInt(this.value))" style="flex:1;">
        </div>
      </div>` : ''}
      <div style="margin-top: 6px; text-align: right;">
        <button class="mini danger" onclick="removeRelay(${r.id})">削除</button>
      </div>
    </div>`;
  }).join('');
}
window.updateRelayAnt = function(id, antId) {
  const r = state.relays.find(x => x.id === id);
  if (r) { r.antId = antId; recompute(); }
};
window.updateRelayH = function(id, h) {
  const r = state.relays.find(x => x.id === id);
  if (r) { r.h = h; recompute(); }
};
window.updateRelayAzimuth = function(id, az) {
  const r = state.relays.find(x => x.id === id);
  if (!r) return;
  r.azimuth = az;
  const label = document.getElementById(`v-relay-az-${id}`);
  if (label) label.textContent = az !== null ? az + '°' : '自動';
  updateBeamVisuals();
  recompute();
};

// ------------------- Geometry SVG -------------------
function drawGeometry(hops) {
  const svg = document.getElementById('geom');
  const W = 720, H = 220;
  const groundY = H - 36;
  const padding = 30;
  const innerW = W - 2 * padding;
  const N = hops.length + 1;
  const xs = Array.from({length: N}, (_, i) => padding + (innerW * i) / Math.max(N - 1, 1));
  // Heights: build from hops
  const heights = [];
  if (hops.length > 0) {
    heights.push(hops[0].h_a);
    hops.forEach(h => heights.push(h.h_b));
  }
  const maxH = Math.max(1, ...heights);
  const hScale = 70 / maxH;
  const ys = heights.map(h => groundY - h * hScale);

  const labels = ['CanSat'];
  for (let i = 0; i < hops.length - 1; i++) labels.push(`R${i+1}`);
  if (hops.length > 0) labels.push('Base');

  let svgContent = '';
  svgContent += `<defs>
    <linearGradient id="sky" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#0a1a14"/>
      <stop offset="1" stop-color="#1a2820"/>
    </linearGradient>
    <linearGradient id="ground" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#3a2a18"/>
      <stop offset="1" stop-color="#1a1208"/>
    </linearGradient>
  </defs>`;
  svgContent += `<rect width="${W}" height="${groundY}" fill="url(#sky)"/>`;
  svgContent += `<rect y="${groundY}" width="${W}" height="${H-groundY}" fill="url(#ground)"/>`;
  // Earth curvature hint
  svgContent += `<path d="M ${padding} ${groundY} Q ${W/2} ${groundY+5} ${W-padding} ${groundY}" fill="none" stroke="#ffb84d" stroke-width="0.5" stroke-dasharray="2 3" opacity="0.5"/>`;

  // Hops
  for (let i = 0; i < hops.length; i++) {
    const x1 = xs[i], x2 = xs[i+1], y1 = ys[i], y2 = ys[i+1];
    const hop = hops[i];
    const ok = hop.margin >= 0;
    const directColor = ok ? '#7fffb0' : '#f87171';

    // Reflected
    svgContent += `<path d="M ${x1} ${y1} L ${(x1+x2)/2} ${groundY} L ${x2} ${y2}" fill="none" stroke="#ffb84d" stroke-width="1" stroke-dasharray="3 3" opacity="0.6"/>`;
    // Direct
    svgContent += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${directColor}" stroke-width="1.5"/>`;
    // Fresnel
    const cx = (x1+x2)/2, cy = (y1+y2)/2;
    const rx = (x2-x1)/2;
    const ry = Math.min(35, hop.F1 * hScale * 1.0);
    svgContent += `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="#7fffb0" stroke-width="0.5" stroke-dasharray="1 2" opacity="0.3"/>`;
    // Distance label
    svgContent += `<text x="${(x1+x2)/2}" y="${groundY-3}" text-anchor="middle" font-size="9" fill="#6a8478" font-family="monospace">${hop.d_km.toFixed(1)}km · ${hop.margin >= 0 ? '+' : ''}${hop.margin.toFixed(1)}dB</text>`;
  }

  // Nodes
  for (let i = 0; i < N; i++) {
    svgContent += `<line x1="${xs[i]}" y1="${groundY}" x2="${xs[i]}" y2="${ys[i]}" stroke="#6a8478" stroke-width="1"/>`;
    svgContent += `<circle cx="${xs[i]}" cy="${ys[i]}" r="5" fill="#7fffb0" stroke="#0a0e0d" stroke-width="1.5"/>`;
    svgContent += `<text x="${xs[i]}" y="${ys[i]-10}" text-anchor="middle" font-size="10" fill="#7fffb0" font-family="monospace">${labels[i]}</text>`;
    svgContent += `<text x="${xs[i]}" y="${groundY+14}" text-anchor="middle" font-size="9" fill="#6a8478" font-family="monospace">h=${heights[i].toFixed(2)}m</text>`;
  }

  svg.innerHTML = svgContent;
}

// ------------------- Recommendation engine (rule-based) -------------------
function generateRecommendation() {
  const hops = computeHops();
  const worst = hops.reduce((w, h) => (w === null || h.margin < w.margin) ? h : w, null);
  const rb = lora_bitrate(state.sf, state.bw, state.cr);
  const toa = lora_toa(state.sf, state.bw, state.cr, state.payload);
  const sens = LORA_SENS[state.bw][state.sf];
  const issues = [];
  const wins = [];

  // 1. Margin checks
  if (worst && worst.margin < 0) {
    issues.push({ severity: 'high', text: `最弱区間「${worst.label}」のマージンが ${worst.margin.toFixed(1)} dB(感度未達)。SFを上げる(${state.sf}→${Math.min(12, state.sf+1)})、または中継器を追加してください。`});
  } else if (worst && worst.margin < state.marginTarget) {
    issues.push({ severity: 'medium', text: `最弱区間マージン ${worst.margin.toFixed(1)} dB は目標 ${state.marginTarget} dB を下回ります。`});
  } else if (worst) {
    wins.push(`全区間で目標マージン以上(最弱 ${worst.margin.toFixed(1)} dB)。`);
  }

  // 2. ARLISS rule
  if (state.txPwr > 20) {
    issues.push({ severity: 'high', text: `送信電力 ${state.txPwr} dBm (${dbm_to_mw(state.txPwr).toFixed(0)} mW) は ARLISS の 100mW 規定を超過しています。FCC認証品の最大100mWに収めてください。`});
  }

  // 3. Bitrate
  if (rb < 1000) {
    issues.push({ severity: 'medium', text: `LoRaビットレート ${Math.round(rb)} bps が要求 1 kbps を下回ります。SF=${state.sf}を下げる(${Math.max(7, state.sf-1)}試行)、または BW を ${state.bw < 500 ? state.bw * 2 : 500} kHz に上げてください(感度低下とのトレードオフ)。`});
  } else if (rb > 5000 && worst && worst.margin > 15) {
    wins.push(`ビットレートに余裕があります(${Math.round(rb)} bps)。SF を上げて感度に振ることも可能。`);
  }

  // 4. Latency vs ToA
  if (state.req.latency === 'realtime' && toa > 0.5) {
    issues.push({ severity: 'medium', text: `Time on Air ${(toa*1000).toFixed(0)} ms は1秒以内のリアルタイム要件に対し、往復ARQを考えると過大の可能性。SFを下げる/ペイロード分割を検討。`});
  }

  // 5. Antenna height vs Fresnel
  if (worst) {
    const avgH = (worst.h_a + worst.h_b) / 2;
    if (avgH < worst.min_h * 0.6) {
      issues.push({ severity: 'high', text: `区間「${worst.label}」: アンテナ平均高 ${avgH.toFixed(2)} m はフレネル第1ゾーン60%(${(worst.min_h*0.6).toFixed(2)} m)を下回ります。地球曲率も考慮するとアンテナ高を上げるか中継を入れるべきです。`});
    }
    if (avgH < worst.bulge) {
      issues.push({ severity: 'high', text: `区間「${worst.label}」: 地球曲率による見通し外。距離 ${worst.d_km.toFixed(1)} km で必要バルジクリアランス ${worst.bulge.toFixed(2)} m に対しアンテナ高不足。`});
    }
  }

  // 6. Number of relays
  const directDist = haversine(state.cansat.lat, state.cansat.lon, state.base.lat, state.base.lon) / 1000;
  if (state.relays.length === 0 && directDist > 15 && worst && worst.margin < state.marginTarget) {
    issues.push({ severity: 'medium', text: `直線距離 ${directDist.toFixed(1)} km で中継器なし。1〜2台の中継器を直線上に配置することでマージン改善が見込めます。`});
  }

  // 7. Band selection
  if (state.band === '2400' && directDist > 5) {
    issues.push({ severity: 'medium', text: `2.4GHz帯は ${directDist.toFixed(1)} km の長距離通信には不利(波長短く回折弱、Friis損失大)。920MHz帯への切替を推奨。`});
  }

  // 8. Power vs requirements
  if (state.req.power === 'tight' && state.txPwr > 17 && worst && worst.margin > state.marginTarget + 5) {
    wins.push(`電源制約厳しめでマージンに余裕あり。送信電力を ${state.txPwr-3} dBm に下げて消費電力50%減も可能。`);
  }

  // 9. Bidir
  if (state.req.bidir === 'bidir' && state.relays.length > 0) {
    wins.push(`双方向通信予定: 中継器は基地局からのコマンド転送も担うため、Half-Duplexタイミング設計を忘れずに。`);
  }

  // Render
  let html = '';
  if (issues.length === 0 && wins.length === 0) {
    html = '<div class="rec-section">特に問題は検出されませんでした。</div>';
  } else {
    if (issues.length > 0) {
      html += '<div class="rec-section"><div class="rec-h">▎要対応事項</div>';
      issues.forEach(iss => {
        html += `<div class="rec-issue severity-${iss.severity}">${iss.text}</div>`;
      });
      html += '</div>';
    }
    if (wins.length > 0) {
      html += '<div class="rec-section"><div class="rec-h">▎良好な点 / 最適化余地</div>';
      wins.forEach(w => {
        html += `<div class="rec-issue severity-low">${w}</div>`;
      });
      html += '</div>';
    }
  }

  // Suggested next config
  const sug = suggestConfig(hops, worst, rb);
  if (sug) {
    html += `<div class="rec-section"><div class="rec-h">▎推奨次手</div><div class="rec-issue">${sug}</div></div>`;
  }

  document.getElementById('rec-output').innerHTML = html;
}

function suggestConfig(hops, worst, rb) {
  if (!worst) return null;
  const directDist = haversine(state.cansat.lat, state.cansat.lon, state.base.lat, state.base.lon) / 1000;
  if (worst.margin < 0) {
    if (state.relays.length < 2 && directDist > 10) {
      return `中継器を ${Math.min(2, state.relays.length + 1)} 台、CanSat〜地上局の中間点付近に配置してください。各区間距離が短くなることで自由空間損失が大幅に減ります。`;
    }
    if (state.sf < 12) {
      return `SF を ${state.sf} → ${state.sf + 1} に上げてください。受信感度が約3dB改善します(ただしビットレートは半減)。`;
    }
    return '送信電力を上げる(ただしARLISS≤100mW)、もしくは基地局アンテナをより高利得の八木に変更してください。';
  }
  if (worst.margin > state.marginTarget + 10 && state.sf > 7) {
    return `マージンに大きな余裕があるため、SF=${state.sf} → ${state.sf - 1} に下げることでビットレートを倍増できます。要求1kbps以上を維持しながら省電力化も可能です。`;
  }
  return null;
}

// ------------------- LLM extension -------------------
async function generateLLMRecommendation() {
  const apiKey = document.getElementById('api-key').value.trim();
  if (!apiKey) {
    document.getElementById('llm-status').innerHTML = '<span style="color: var(--red)">APIキーを入力してください</span>';
    return;
  }
  if (!apiKey.startsWith('sk-ant-')) {
    document.getElementById('llm-status').innerHTML = '<span style="color: var(--red)">Anthropic APIキーは sk-ant- で始まります</span>';
    return;
  }

  document.getElementById('llm-status').innerHTML = '<span style="color: var(--phosphor)">⏳ LLM推奨を生成中...</span>';

  const hops = computeHops();
  const worst = hops.reduce((w, h) => (w === null || h.margin < w.margin) ? h : w, null);
  const rb = lora_bitrate(state.sf, state.bw, state.cr);
  const toa = lora_toa(state.sf, state.bw, state.cr, state.payload);
  const directDist = haversine(state.cansat.lat, state.cansat.lon, state.base.lat, state.base.lon) / 1000;

  const summary = {
    band: state.band + ' MHz',
    direct_distance_km: directDist.toFixed(2),
    n_relays: state.relays.length,
    tx_power_dbm: state.txPwr,
    cansat_antenna: getAnt(state.txAntId).name,
    base_antenna: getAnt(state.rxAntId).name,
    h_cansat_m: state.hCansat,
    h_base_m: state.hBase,
    sf: state.sf, bw_khz: state.bw, cr: `4/${4+state.cr}`,
    payload_bytes: state.payload,
    bitrate_bps: Math.round(rb),
    toa_ms: Math.round(toa * 1000),
    worst_margin_db: worst ? worst.margin.toFixed(1) : 'N/A',
    worst_hop: worst ? worst.label : 'N/A',
    worst_distance_km: worst ? worst.d_km.toFixed(2) : 'N/A',
    requirements: state.req,
  };

  const prompt = `あなたはCanSatの無線通信設計の専門家です。以下の現在の設計に対し、ARLISS 2025のCanSat大会(ブラックロック砂漠、ネバダ州、9月)で実用するための具体的な推奨を日本語で提供してください。

現在の設計:
${JSON.stringify(summary, null, 2)}

以下の観点で構造化された推奨を提供してください:
1. 最も優先すべき改善点(最大3つ、具体的な数値変更を含む)
2. 砂漠特有のリスクと対策(温度、フェージング、視程の良さによるマルチパスなど)
3. 法規制と運用上の注意(ARLISSルール、FCC Part 15、920MHz帯)
4. 万一通信が途切れた場合のフォールバック戦略

Markdownは使わず、簡潔な日本語のテキストで300-500文字程度にまとめてください。`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`API error ${response.status}: ${err.substring(0, 200)}`);
    }
    const data = await response.json();
    const text = data.content.filter(c => c.type === 'text').map(c => c.text).join('\n');

    document.getElementById('llm-status').innerHTML = '<span style="color: var(--green)">✓ 詳細推奨を上に追加しました</span>';
    const recOut = document.getElementById('rec-output');
    recOut.innerHTML += `<div class="rec-section" style="margin-top: 16px; border-top: 1px dashed var(--border); padding-top: 12px;">
      <div class="rec-h">▎LLM詳細推奨 (Claude Sonnet 4.6)</div>
      <div style="white-space: pre-wrap; font-size: 12px; line-height: 1.7;">${text.replace(/</g,'&lt;')}</div>
    </div>`;
  } catch (e) {
    document.getElementById('llm-status').innerHTML = `<span style="color: var(--red)">エラー: ${e.message}</span>`;
  }
}

// ------------------- Save / Load JSON -------------------
function saveConfig() {
  const cfg = {
    version: '0.2',
    saved_at: new Date().toISOString(),
    state: state,
  };
  const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cansat-link-config-${new Date().toISOString().slice(0,16).replace(/[:-]/g,'')}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Validate and sanitize a loaded config object.
// Returns { ok: true, warnings: [], state: sanitizedState } or throws on fatal errors.
function validateConfig(cfg) {
  if (typeof cfg !== 'object' || cfg === null) throw new Error('ファイルがJSONオブジェクトではありません');

  const ver = cfg.version;
  const SUPPORTED = ['0.2'];
  const warnings = [];
  if (ver === undefined) {
    warnings.push('version フィールドがありません。互換形式として読み込みます。');
  } else if (!SUPPORTED.includes(String(ver))) {
    warnings.push(`未知のバージョン "${ver}"。最新形式として読み込みます。`);
  }

  if (!cfg.state || typeof cfg.state !== 'object') throw new Error('state フィールドがありません');
  const s = cfg.state;

  // Clamp numeric fields to valid range; apply defaults for missing fields
  function clampNum(val, min, max, def) {
    const n = Number(val);
    if (!isFinite(n)) { warnings.push(`数値フィールドを ${def} にリセットしました`); return def; }
    return Math.min(max, Math.max(min, n));
  }
  function oneOf(val, allowed, def) {
    return allowed.includes(val) ? val : (warnings.push(`値 "${val}" は無効のため "${def}" にリセットしました`), def);
  }

  const band = oneOf(String(s.band), ['433','915','920','2400'], '920');
  const txPwr = clampNum(s.txPwr, 0, 30, 13);
  const txAntId = typeof s.txAntId === 'string' ? s.txAntId : 'whip-rfd900';
  const txGainCustom = clampNum(s.txGainCustom, -5, 30, 2.0);
  const rxAntId = typeof s.rxAntId === 'string' ? s.rxAntId : 'yagi-9el';
  const rxGainCustom = clampNum(s.rxGainCustom, -5, 30, 12.0);
  const hCansat = clampNum(s.hCansat, 0.05, 3, 0.3);
  const hBase = clampNum(s.hBase, 0.5, 10, 4.0);
  const hRelay = clampNum(s.hRelay, 0.3, 6, 2.0);
  const sf = clampNum(s.sf, 7, 12, 10);
  const bw = oneOf(Number(s.bw), [125, 250, 500], 125);
  const cr = clampNum(s.cr, 1, 4, 1);
  const payload = clampNum(s.payload, 1, 255, 32);
  const useTwoRay = typeof s.useTwoRay === 'boolean' ? s.useTwoRay : true;
  const gammaMode = oneOf(s.gammaMode, ['pec', 'fresnel'], 'fresnel');
  const groundPreset = oneOf(s.groundPreset, Object.keys(GROUND_PRESETS), 'dry_sand');
  const pol = oneOf(s.pol, ['V', 'H'], 'V');
  const rxAzimuth = (s.rxAzimuth === null || s.rxAzimuth === undefined)
    ? null : clampNum(s.rxAzimuth, 0, 359, null);
  const includeFade = typeof s.includeFade === 'boolean' ? s.includeFade : true;
  const marginTarget = clampNum(s.marginTarget, 0, 20, 10);

  // Validate relays array
  const rawRelays = Array.isArray(s.relays) ? s.relays : [];
  const relays = rawRelays
    .filter((r, i) => {
      if (typeof r !== 'object' || r === null) { warnings.push(`中継器[${i}] が不正: 無視します`); return false; }
      if (!isFinite(Number(r.lat)) || !isFinite(Number(r.lon))) { warnings.push(`中継器[${i}] の座標が不正: 無視します`); return false; }
      return true;
    })
    .slice(0, MAX_RELAYS)
    .map(r => ({
      lat: Number(r.lat),
      lon: Number(r.lon),
      h: clampNum(r.h, 0.3, 6, 2.0),
      antId: typeof r.antId === 'string' ? r.antId : 'whip-rfd900',
      gainCustom: clampNum(r.gainCustom, -5, 30, 2.0),
      azimuth: (r.azimuth === null || r.azimuth === undefined)
        ? null : clampNum(r.azimuth, 0, 359, null),
    }));

  if (rawRelays.length > MAX_RELAYS) {
    warnings.push(`中継器が ${MAX_RELAYS} 台を超えているため、最初の ${MAX_RELAYS} 台のみ読み込みました`);
  }

  const req = (typeof s.req === 'object' && s.req) ? s.req : {};
  const validatedReq = {
    duration: oneOf(req.duration, ['hours','day','multiday'], 'day'),
    latency: oneOf(req.latency, ['realtime','near','batch'], 'near'),
    bidir: oneOf(req.bidir, ['downlink','bidir'], 'bidir'),
    power: oneOf(req.power, ['tight','moderate','ample'], 'moderate'),
    notes: typeof req.notes === 'string' ? req.notes : '',
  };

  const sanitized = {
    band, txPwr, txAntId, txGainCustom, rxAntId, rxGainCustom,
    hCansat, hBase, hRelay, sf, bw, cr, payload,
    useTwoRay, gammaMode, groundPreset, pol, rxAzimuth, includeFade, marginTarget,
    cansat: { ...COORD_CANSAT },
    base: { ...COORD_BASE },
    relays,
    req: validatedReq,
  };

  return { ok: true, warnings, state: sanitized };
}

function loadConfig(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    let cfg;
    try {
      cfg = JSON.parse(e.target.result);
    } catch {
      showLoadError('JSONの解析に失敗しました。有効なJSONファイルを選択してください。');
      return;
    }

    let result;
    try {
      result = validateConfig(cfg);
    } catch (err) {
      showLoadError('読込失敗: ' + err.message);
      return;
    }

    // Apply validated state
    clearAllRelays();
    Object.assign(state, result.state);
    state.relays = [];
    result.state.relays.forEach(r => {
      const id = nextRelayId++;
      const relay = { id, lat: r.lat, lon: r.lon, h: r.h, antId: r.antId, gainCustom: r.gainCustom };
      state.relays.push(relay);
      drawRelayOnMap(relay);
    });
    reflectStateToUI();
    recompute();

    if (result.warnings.length > 0) {
      showLoadWarnings(result.warnings);
    }
  };
  reader.readAsText(file);
}

function showLoadError(msg) {
  const panel = document.getElementById('verdict-panel');
  const old = document.getElementById('load-error-banner');
  if (old) old.remove();
  const banner = document.createElement('div');
  banner.id = 'load-error-banner';
  banner.style.cssText = 'background:#1a0a0a;border:1px solid var(--red);color:var(--red);padding:10px 14px;font-size:12px;margin-bottom:8px;';
  banner.textContent = '⚠ ' + msg;
  panel.parentNode.insertBefore(banner, panel);
  setTimeout(() => banner.remove(), 8000);
}

function showLoadWarnings(warnings) {
  const panel = document.getElementById('verdict-panel');
  const old = document.getElementById('load-warn-banner');
  if (old) old.remove();
  const banner = document.createElement('div');
  banner.id = 'load-warn-banner';
  banner.style.cssText = 'background:#1a1200;border:1px solid var(--yellow);color:var(--yellow);padding:10px 14px;font-size:11px;margin-bottom:8px;';
  banner.innerHTML = '⚠ 設定読込時の注意: <ul style="margin:4px 0 0;padding-left:16px;">' +
    warnings.map(w => `<li>${w}</li>`).join('') + '</ul>';
  panel.parentNode.insertBefore(banner, panel);
  setTimeout(() => banner.remove(), 10000);
}

function updateTwoRayOptionsVisibility() {
  const twoRayOn = state.useTwoRay;
  document.getElementById('tworay-options').style.display = twoRayOn ? '' : 'none';
  document.getElementById('fresnel-options').style.display =
    (twoRayOn && state.gammaMode === 'fresnel') ? '' : 'none';
}

function updateBaseAzimuthVisibility() {
  const ant = getAnt(state.rxAntId);
  const isDir = ant.pattern === 'dir';
  document.getElementById('base-azimuth-field').style.display = isDir ? '' : 'none';
}

function updateBeamVisuals() {
  if (!map) return;
  drawBeamLayers();
}

let beamLayers = [];
function drawBeamLayers() {
  beamLayers.forEach(l => map.removeLayer(l));
  beamLayers = [];

  // Base station beam
  const baseAnt = getAnt(state.rxAntId);
  if (baseAnt.pattern === 'dir' && baseAnt.hpbw_deg < 360) {
    const az = state.rxAzimuth !== null ? state.rxAzimuth
               : bearing(state.base.lat, state.base.lon, state.cansat.lat, state.cansat.lon);
    const layer = makeBeamSector(state.base.lat, state.base.lon, az, baseAnt.hpbw_deg, '#ffb84d');
    layer.addTo(map);
    beamLayers.push(layer);
  }

  // Relay beams
  state.relays.forEach(r => {
    const ant = getAnt(r.antId);
    if (ant.pattern === 'dir' && ant.hpbw_deg < 360 && r.azimuth !== null) {
      const layer = makeBeamSector(r.lat, r.lon, r.azimuth, ant.hpbw_deg, '#60a5fa');
      layer.addTo(map);
      beamLayers.push(layer);
    }
  });
}

function makeBeamSector(lat, lon, az_deg, hpbw_deg, color) {
  const R = 15000; // visual radius in meters
  const steps = 20;
  const halfAngle = hpbw_deg / 2;
  const pts = [[lat, lon]];
  for (let i = 0; i <= steps; i++) {
    const angle = az_deg - halfAngle + (hpbw_deg * i / steps);
    const angleRad = angle * Math.PI / 180;
    const dlat = (R * Math.cos(angleRad)) / 111319;
    const dlon = (R * Math.sin(angleRad)) / (111319 * Math.cos(lat * Math.PI / 180));
    pts.push([lat + dlat, lon + dlon]);
  }
  pts.push([lat, lon]);
  return L.polygon(pts, { color, fillColor: color, fillOpacity: 0.08, weight: 1, opacity: 0.5 });
}

function reflectStateToUI() {
  document.getElementById('band').value = state.band;
  document.getElementById('tx-pwr').value = state.txPwr;
  document.getElementById('h-cansat').value = state.hCansat;
  document.getElementById('h-base').value = state.hBase;
  document.getElementById('payload').value = state.payload;
  document.getElementById('margin-target').value = state.marginTarget;
  document.getElementById('opt-tworay').checked = state.useTwoRay;
  document.getElementById('gamma-mode').value = state.gammaMode || 'fresnel';
  document.getElementById('ground-preset').value = state.groundPreset || 'dry_sand';
  document.querySelectorAll('#pol-tabs button').forEach(b => b.classList.toggle('active', b.dataset.v === (state.pol || 'V')));
  updateTwoRayOptionsVisibility();
  document.getElementById('opt-fade').checked = state.includeFade;
  document.querySelectorAll('#sf-tabs button').forEach(b => b.classList.toggle('active', parseInt(b.dataset.v) === state.sf));
  document.querySelectorAll('#bw-tabs button').forEach(b => b.classList.toggle('active', parseInt(b.dataset.v) === state.bw));
  document.querySelectorAll('#cr-tabs button').forEach(b => b.classList.toggle('active', parseInt(b.dataset.v) === state.cr));
  document.getElementById('req-duration').value = state.req.duration;
  document.getElementById('req-latency').value = state.req.latency;
  document.getElementById('req-bidir').value = state.req.bidir;
  document.getElementById('req-power').value = state.req.power;
  document.getElementById('req-notes').value = state.req.notes;
  rebuildAntennaSelects();
  document.getElementById('cansat-ant').value = state.txAntId;
  document.getElementById('base-ant').value = state.rxAntId;
  // Azimuth
  const azEl = document.getElementById('rx-azimuth');
  if (state.rxAzimuth !== null) {
    azEl.value = state.rxAzimuth;
    document.getElementById('v-rx-azimuth').textContent = state.rxAzimuth + '°';
  } else {
    document.getElementById('v-rx-azimuth').textContent = '自動';
  }
  updateBaseAzimuthVisibility();
}

function resetAll() {
  if (!confirm('すべての設定をリセットしますか?')) return;
  clearAllRelays();
  Object.assign(state, {
    band: '920', txPwr: 13, txAntId: 'whip-rfd900', txGainCustom: 2.0,
    rxAntId: 'yagi-9el', rxGainCustom: 12.0,
    hCansat: 0.3, hBase: 4.0, hRelay: 2.0,
    sf: 10, bw: 125, cr: 1, payload: 32,
    useTwoRay: true, gammaMode: 'fresnel', groundPreset: 'dry_sand', pol: 'V',
    rxAzimuth: null, includeFade: true, marginTarget: 10,
    cansat: { ...COORD_CANSAT }, base: { ...COORD_BASE },
    req: { duration: 'day', latency: 'near', bidir: 'bidir', power: 'moderate', notes: '' },
  });
  reflectStateToUI();
  recompute();
}

// ------------------- Wire UI -------------------
function bindAll() {
  document.getElementById('band').addEventListener('change', (e) => {
    state.band = e.target.value;
    rebuildAntennaSelects();
    recompute();
  });
  document.getElementById('cansat-ant').addEventListener('change', (e) => {
    state.txAntId = e.target.value;
    updateAntennaNotes();
    recompute();
  });
  document.getElementById('base-ant').addEventListener('change', (e) => {
    state.rxAntId = e.target.value;
    updateAntennaNotes();
    updateBaseAzimuthVisibility();
    recompute();
  });

  document.getElementById('tx-pwr').addEventListener('input', (e) => {
    state.txPwr = parseFloat(e.target.value);
    recompute();
  });
  document.getElementById('h-cansat').addEventListener('input', (e) => {
    state.hCansat = parseFloat(e.target.value);
    recompute();
  });
  document.getElementById('h-base').addEventListener('input', (e) => {
    state.hBase = parseFloat(e.target.value);
    recompute();
  });
  document.getElementById('rx-azimuth').addEventListener('input', (e) => {
    state.rxAzimuth = parseInt(e.target.value);
    document.getElementById('v-rx-azimuth').textContent = state.rxAzimuth + '°';
    updateBeamVisuals();
    recompute();
  });
  document.getElementById('btn-az-auto').addEventListener('click', () => {
    state.rxAzimuth = null;
    document.getElementById('v-rx-azimuth').textContent = '自動';
    updateBeamVisuals();
    recompute();
  });
  document.getElementById('payload').addEventListener('input', (e) => {
    state.payload = parseInt(e.target.value);
    recompute();
  });
  document.getElementById('margin-target').addEventListener('input', (e) => {
    state.marginTarget = parseInt(e.target.value);
    recompute();
  });
  document.getElementById('opt-tworay').addEventListener('change', (e) => {
    state.useTwoRay = e.target.checked;
    updateTwoRayOptionsVisibility();
    recompute();
  });
  document.getElementById('gamma-mode').addEventListener('change', (e) => {
    state.gammaMode = e.target.value;
    document.getElementById('fresnel-options').style.display = state.gammaMode === 'fresnel' ? '' : 'none';
    recompute();
  });
  document.getElementById('ground-preset').addEventListener('change', (e) => {
    state.groundPreset = e.target.value;
    recompute();
  });
  document.querySelectorAll('#pol-tabs button').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#pol-tabs button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      state.pol = b.dataset.v;
      recompute();
    });
  });
  document.getElementById('opt-fade').addEventListener('change', (e) => {
    state.includeFade = e.target.checked;
    recompute();
  });

  document.querySelectorAll('#sf-tabs button').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#sf-tabs button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      state.sf = parseInt(b.dataset.v);
      recompute();
    });
  });
  document.querySelectorAll('#bw-tabs button').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#bw-tabs button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      state.bw = parseInt(b.dataset.v);
      recompute();
    });
  });
  document.querySelectorAll('#cr-tabs button').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#cr-tabs button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      state.cr = parseInt(b.dataset.v);
      recompute();
    });
  });

  // Map controls
  document.getElementById('btn-add-relay').addEventListener('click', () => {
    if (state.relays.length >= MAX_RELAYS) {
      alert(`中継器は最大 ${MAX_RELAYS} 台までです`);
      return;
    }
    // Add relay at midpoint between cansat and base
    const lat = (state.cansat.lat + state.base.lat) / 2;
    const lon = (state.cansat.lon + state.base.lon) / 2;
    addRelay(lat, lon);
  });
  document.getElementById('btn-clear-relays').addEventListener('click', () => {
    if (state.relays.length === 0) return;
    if (confirm('中継器をすべて削除しますか?')) clearAllRelays();
  });

  // Save/load
  document.getElementById('btn-save').addEventListener('click', saveConfig);
  document.getElementById('file-load').addEventListener('change', (e) => {
    if (e.target.files[0]) loadConfig(e.target.files[0]);
    e.target.value = '';
  });
  document.getElementById('btn-reset').addEventListener('click', resetAll);

  // Requirements
  document.getElementById('req-duration').addEventListener('change', (e) => state.req.duration = e.target.value);
  document.getElementById('req-latency').addEventListener('change', (e) => state.req.latency = e.target.value);
  document.getElementById('req-bidir').addEventListener('change', (e) => state.req.bidir = e.target.value);
  document.getElementById('req-power').addEventListener('change', (e) => state.req.power = e.target.value);
  document.getElementById('req-notes').addEventListener('input', (e) => state.req.notes = e.target.value);

  document.getElementById('btn-rec').addEventListener('click', generateRecommendation);
  document.getElementById('btn-rec-llm').addEventListener('click', generateLLMRecommendation);
}

// ------------------- Init -------------------
document.addEventListener('DOMContentLoaded', () => {
  rebuildAntennaSelects();
  bindAll();
  updateTwoRayOptionsVisibility();
  updateBaseAzimuthVisibility();
  initMap();
  recompute();
});
