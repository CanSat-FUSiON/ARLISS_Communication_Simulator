// data.js — antenna presets, band info, LoRa sensitivity table

const BANDS = {
  '433': {
    f_mhz: 433,
    label: '433 MHz',
    note_jp: '日本: アマチュア無線(免許要)',
    note_us: '米国: Part 15 ISM(免許不要)',
    jp_max_dbm: null,
    us_max_dbm: 30,
  },
  '915': {
    f_mhz: 915,
    label: '915 MHz',
    note_jp: '日本: 使用不可(MICS等の例外あり)',
    note_us: '米国: Part 15 ISM(最大1W/30dBm、免許不要)',
    jp_max_dbm: null,
    us_max_dbm: 30,
  },
  '920': {
    f_mhz: 920,
    label: '920 MHz',
    note_jp: '日本: ARIB STD-T108(最大20mW/13dBm、免許不要)',
    note_us: '米国: Part 15 ISM内(902-928MHz)・FCC認証品なら可',
    jp_max_dbm: 13,
    us_max_dbm: 30,
  },
  '2400': {
    f_mhz: 2400,
    label: '2.4 GHz',
    note_jp: '日本: ISM(免許不要)',
    note_us: '米国: Part 15 ISM(免許不要)',
    jp_max_dbm: 20,
    us_max_dbm: 30,
  },
};

// LoRa SX127x sensitivity table [bw_khz][sf] = dBm
const LORA_SENS = {
  125: { 7: -123, 8: -126, 9: -129, 10: -132, 11: -134.5, 12: -137 },
  250: { 7: -120, 8: -123, 9: -125, 10: -128, 11: -130.5, 12: -133 },
  500: { 7: -116, 8: -119, 9: -122, 10: -125, 11: -128, 12: -130 },
};

// Antenna presets — representative commercial products
// gain_dbi: realistic in-band gain
// pattern: "omni" or "dir"
// hpbw_deg: half-power beamwidth (full width, degrees). 360 for omni.
// fb_db: front-to-back ratio (dB). 0 for omni.
const ANTENNAS = [
  // CanSat-side / portable
  { id: 'whip-quarter',    name: 'λ/4 ホイップ (汎用)',        gain_dbi: 2.0,  hpbw_deg: 360, fb_db: 0,  pattern: 'omni', bands: ['433','915','920','2400'], note: '一般的なスタブ。CanSat実装向け',       cansat_ok: true,  base_ok: false, relay_ok: true,  price_jpy: 500 },
  { id: 'whip-rfd900',     name: 'RFD900 純正ホイップ',         gain_dbi: 2.1,  hpbw_deg: 360, fb_db: 0,  pattern: 'omni', bands: ['915','920'],             note: '900MHz帯CanSat定番',                  cansat_ok: true,  base_ok: false, relay_ok: true,  price_jpy: 2500 },
  { id: 'patch-laird-mini',name: 'Laird ミニパッチ 902-928',   gain_dbi: 6.5,  hpbw_deg: 65,  fb_db: 15, pattern: 'dir',  bands: ['915','920'],             note: '小型パッチ、半値角約65°',              cansat_ok: true,  base_ok: false, relay_ok: true,  price_jpy: 6000 },
  { id: 'rubber-duck',     name: 'ラバーダックアンテナ',         gain_dbi: 1.0,  hpbw_deg: 360, fb_db: 0,  pattern: 'omni', bands: ['433','915','920','2400'], note: '簡易・短い・低利得',                   cansat_ok: true,  base_ok: false, relay_ok: true,  price_jpy: 300 },
  { id: 'dipole-half',     name: 'λ/2 ダイポール',             gain_dbi: 2.15, hpbw_deg: 360, fb_db: 0,  pattern: 'omni', bands: ['433','915','920','2400'], note: '基準アンテナ、自作可',                  cansat_ok: true,  base_ok: true,  relay_ok: true,  price_jpy: 1500 },

  // Base / fixed
  { id: 'gp-comet-gp1',   name: 'コメット GP-1 (430MHz GP)',  gain_dbi: 4.5,  hpbw_deg: 360, fb_db: 0,  pattern: 'omni', bands: ['433'],                   note: 'グランドプレーン、基地局向け',           cansat_ok: false, base_ok: true,  relay_ok: true,  price_jpy: 12000 },
  { id: 'collinear-915',  name: '900MHz帯 コリニア (8dBi)',   gain_dbi: 8.0,  hpbw_deg: 360, fb_db: 0,  pattern: 'omni', bands: ['915','920'],             note: '長尺コリニア、無指向高利得',              cansat_ok: false, base_ok: true,  relay_ok: true,  price_jpy: 18000 },
  { id: 'yagi-5el',       name: '八木 5素子 (900MHz)',        gain_dbi: 9.0,  hpbw_deg: 60,  fb_db: 15, pattern: 'dir',  bands: ['915','920'],             note: '指向性、半値角約60°',                   cansat_ok: false, base_ok: true,  relay_ok: true,  price_jpy: 15000 },
  { id: 'yagi-9el',       name: '八木 9素子 (900MHz)',        gain_dbi: 12.5, hpbw_deg: 45,  fb_db: 20, pattern: 'dir',  bands: ['915','920'],             note: '高利得指向性、半値角約45°',              cansat_ok: false, base_ok: true,  relay_ok: true,  price_jpy: 22000 },
  { id: 'yagi-13el',      name: '八木 13素子 (900MHz)',       gain_dbi: 14.5, hpbw_deg: 35,  fb_db: 25, pattern: 'dir',  bands: ['915','920'],             note: '長尺八木、ピンポイント運用',              cansat_ok: false, base_ok: true,  relay_ok: false, price_jpy: 35000 },
  { id: 'yagi-2el-433',   name: '八木 5素子 (433MHz)',        gain_dbi: 8.5,  hpbw_deg: 65,  fb_db: 15, pattern: 'dir',  bands: ['433'],                   note: '指向性、UHF',                          cansat_ok: false, base_ok: true,  relay_ok: true,  price_jpy: 12000 },
  { id: 'panel-24',       name: 'パネルアンテナ (2.4GHz, 14dBi)', gain_dbi: 14.0, hpbw_deg: 30, fb_db: 20, pattern: 'dir', bands: ['2400'],                note: '半値角約30°',                          cansat_ok: false, base_ok: true,  relay_ok: true,  price_jpy: 8000 },
  { id: 'omni-24',        name: '2.4GHz オムニ (8dBi)',       gain_dbi: 8.0,  hpbw_deg: 360, fb_db: 0,  pattern: 'omni', bands: ['2400'],                   note: '無指向',                               cansat_ok: false, base_ok: true,  relay_ok: true,  price_jpy: 6000 },
  { id: 'custom',         name: 'カスタム指定',                 gain_dbi: null, hpbw_deg: 360, fb_db: 0,  pattern: 'omni', bands: ['433','915','920','2400'], note: '利得を手入力',                          cansat_ok: true,  base_ok: true,  relay_ok: true,  price_jpy: 0 },
];

// Default coordinates per requirements
const COORD_CANSAT = { lat: 40.900522, lon: -119.07909722 };
const COORD_BASE   = { lat: 40.654113159604734, lon: -119.3529299890043 };
const MAX_RELAYS = 10;
