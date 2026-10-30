#!/usr/bin/env node
// Synthetic data for the kit lifecycle dashboard challenge.
// Usage: node challenge/generate.mjs [seed] [outDir]
// Default outDir is public/ (where the Vite app serves the CSVs).
// Same seed => identical files. Use a different seed for a hidden test set.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const seed = Number(process.argv[2] ?? 20261028);
const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.argv[3] ?? join(rootDir, 'public');

const N_ORDERS = 5000;
const START = Date.parse('2026-05-01T00:00:00Z');
const END = Date.parse('2026-10-15T00:00:00Z');
const AS_OF = Date.parse('2026-10-20T00:00:00Z');
const DAY = 86400000;
const HOUR = 3600000;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(seed);
const chance = (p) => rand() < p;

function pick(weights) {
  const entries = Object.entries(weights);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [k, w] of entries) if ((r -= w) <= 0) return k;
  return entries[entries.length - 1][0];
}

function normal() {
  const u = 1 - rand(), v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Log-normal duration in ms around a median number of days.
const days = (median, spread) => median * Math.exp(spread * normal()) * DAY;

const usedIds = new Set();
function id(prefix, len) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out;
  do {
    out = prefix + Array.from({ length: len }, () => chars[Math.floor(rand() * chars.length)]).join('');
  } while (usedIds.has(out));
  usedIds.add(out);
  return out;
}

const pad = (n) => String(n).padStart(2, '0');

function fmtOffset(ms, offsetMin) {
  const local = new Date(ms + offsetMin * 60000).toISOString().slice(0, 19);
  const sign = offsetMin < 0 ? '-' : '+';
  const abs = Math.abs(offsetMin);
  return `${local}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}
const fmtZ = (ms) => new Date(ms).toISOString().slice(0, 19) + 'Z';
const fmtNaive = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

const COUNTRIES = { US: 70, CA: 10, GB: 9, DE: 4, AU: 4, NL: 3 };
const OFFSETS = {
  US: [-240, -300, -360, -420],
  CA: [-240, -420],
  GB: [60, 0],
  DE: [120],
  AU: [600],
  NL: [120],
};

const orders = [];
const events = [];

function emit(order, kitId, type, ms, source) {
  events.push({ order_id: order.order_id, kit_id: kitId, event_type: type, ms, source });
}

// Simulates one physical kit. Returns early when time passes the export date.
function simulateKit(order, startMs, depth, stopAfter) {
  const kitId = id('kit_', 6);
  let t = startMs;
  const step = (type, ms, source) => {
    t = ms;
    if (t > AS_OF) return false;
    emit(order, kitId, type, t, source);
    return stopAfter !== type;
  };
  const replace = (afterMs) => {
    if (depth >= 3) return;
    const at = afterMs;
    if (at > AS_OF) return;
    emit(order, kitId, 'kit_replaced', at, 'system');
    simulateKit(order, at, depth + 1, null);
  };

  const shipDelay = depth === 0 ? days(1.2, 0.6) : days(2, 0.5);
  if (!step('kit_shipped', t + shipDelay * (chance(0.03) ? 5 : 1), 'system')) return;

  if (chance(0.01)) return replace(t + 15 * DAY);
  if (!step('kit_delivered', t + days(4, 0.35), 'carrier')) return;

  if (chance(0.09)) return;
  if (!step('sample_mailed', t + days(10, 0.9), 'carrier')) return;

  if (chance(0.01)) return replace(t + 25 * DAY);
  if (!step('sample_received', t + days(5, 0.4), 'lab')) return;

  const qcAt = t + days(3, 0.4) * (chance(0.03) ? 3.5 : 1);
  if (chance(0.05)) {
    if (!step('qc_failed', qcAt, 'lab')) return;
    return replace(t + days(1.5, 0.5));
  }
  if (!step('qc_passed', qcAt, 'lab')) return;

  if (!step('sequencing_complete', t + days(18, 0.3) * (chance(0.03) ? 2.5 : 1), 'lab')) return;
  step('report_ready', t + days(2, 0.5) * (chance(0.03) ? 4 : 1), 'system');
}

const REFUND_STOPS = ['kit_shipped', 'kit_delivered', 'sample_mailed', 'sample_received', null];

for (let i = 0; i < N_ORDERS; i++) {
  const createdMs = START + rand() * (END - START);
  const country = pick(COUNTRIES);
  const offsets = OFFSETS[country];
  const order = {
    order_id: id('ord_', 5),
    created_ms: createdMs,
    created_at: fmtOffset(createdMs, offsets[Math.floor(rand() * offsets.length)]),
    customer_id: id('cus_', 4),
    product: pick({ wgs_30x: 60, wgs_100x: 25, upload_only: 15 }),
    country,
    status: pick({ paid: 92, refunded: 4, cancelled: 4 }),
    is_test: chance(0.015),
  };
  orders.push(order);

  if (order.product === 'upload_only') continue;
  if (order.status === 'cancelled') {
    if (chance(0.2)) simulateKit(order, createdMs, 0, 'kit_shipped');
    continue;
  }
  const stopAfter = order.status === 'refunded' ? REFUND_STOPS[Math.floor(rand() * REFUND_STOPS.length)] : null;
  simulateKit(order, createdMs, 0, stopAfter);
}

// Missing carrier scans.
let rows = events.filter((e) => {
  if (e.event_type === 'sample_mailed' && chance(0.015)) return false;
  if (e.event_type === 'kit_delivered' && chance(0.01)) return false;
  return true;
});

// Duplicate rows (same kit, type, timestamp; new event_id).
const dupes = rows.filter(() => chance(0.02)).map((e) => ({ ...e }));
rows = rows.concat(dupes);

// Orphan events referencing orders that don't exist.
const ORPHAN_TYPES = ['kit_shipped', 'kit_delivered', 'sample_received', 'qc_passed'];
for (let i = 0; i < 40; i++) {
  rows.push({
    order_id: id('ord_', 5),
    kit_id: id('kit_', 6),
    event_type: ORPHAN_TYPES[Math.floor(rand() * ORPHAN_TYPES.length)],
    ms: START + rand() * (AS_OF - START),
    source: 'carrier',
  });
}

// Shuffle.
for (let i = rows.length - 1; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1));
  [rows[i], rows[j]] = [rows[j], rows[i]];
}

function fmtEvent(ms) {
  const r = rand();
  if (r < 0.01) return fmtNaive(ms);
  if (r < 0.15) return fmtOffset(ms, [-240, -300, 60][Math.floor(rand() * 3)]);
  return fmtZ(ms);
}

mkdirSync(outDir, { recursive: true });

const ordersCsv = [
  'order_id,created_at,customer_id,product,country,status,is_test',
  ...orders
    .sort((a, b) => a.created_ms - b.created_ms)
    .map((o) => [o.order_id, o.created_at, o.customer_id, o.product, o.country, o.status, o.is_test].join(',')),
].join('\n');

const eventsCsv = [
  'event_id,order_id,kit_id,event_type,occurred_at,source',
  ...rows.map((e) => [id('evt_', 8), e.order_id, e.kit_id, e.event_type, fmtEvent(e.ms), e.source].join(',')),
].join('\n');

writeFileSync(join(outDir, 'orders.csv'), ordersCsv + '\n');
writeFileSync(join(outDir, 'kit_events.csv'), eventsCsv + '\n');

console.log(`seed=${seed} orders=${orders.length} events=${rows.length} (dupes=${dupes.length}, orphans=40) -> ${outDir}`);
