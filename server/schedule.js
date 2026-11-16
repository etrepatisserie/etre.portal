// Order timeline rules, always in Malaysia time (MYT, UTC+8) regardless of the server's timezone.
//  - Orders are processed Mon–Fri. Cutoff 1:00 PM.
//  - After the cutoff, or on Sat/Sun (or a closure day), an order counts as the next working day.
//  - Earliest pickup/delivery = processing day + 2 (Day 1 order → Day 2 production → Day 3 fulfil).
//    Mon→Wed, Tue→Thu, Wed→Fri, Thu→Sat, Fri→Sun; Fri after 1 PM / Sat / Sun → Monday → Wed.
//  - Closure dates (from announcements) cannot be chosen, and are skipped as working days.
import db from './db.js';
import { getSettings } from './settings.js';

const MYT = 8 * 3600e3;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const addDays = (dateStr, n) => {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const weekday = (dateStr) => new Date(`${dateStr}T00:00:00Z`).getUTCDay();
export const dayName = (dateStr) => DAY_NAMES[weekday(dateStr)];
export const isWeekend = (dateStr) => [0, 6].includes(weekday(dateStr));
export const fmtDay = (dateStr) => new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

// "now" as MYT calendar date + minutes since midnight
export function mytNow(now = new Date()) {
  const d = new Date(now.getTime() + MYT);
  return { date: d.toISOString().slice(0, 10), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
}
export const todayMYT = (now = new Date()) => mytNow(now).date;
// a MYT wall-clock date+time → real Date (for seeding/tests)
export const mytDate = (dateStr, time = '00:00') => new Date(`${dateStr}T${time}:00+08:00`);

// ---------- closures (Admin → Closures; stored as 'closure' announcements so customers still see them) ----------
// Each closure blocks one or more of: production (no baking that day → no pickup/delivery the day after),
// delivery, collection (pickup). Closures made before this existed block delivery + collection only.
// Yearly closures repeat on the same dates every year.
const CLOSURE_SQL = `SELECT id, title, reason, closure_from, closure_to, blocks, repeat_yearly, outlet_id FROM announcements
  WHERE type = 'closure' AND closure_from IS NOT NULL AND (outlet_id IS NULL OR ? IS NULL OR outlet_id = ?)`;
const spanDates = (from, to) => { const out = []; for (let d = from; d <= (to || from); d = addDays(d, 1)) out.push(d); return out; };
const shiftYear = (d, y) => `${y}${d.slice(4)}`;

export async function closureRules(outletId = null, now = new Date()) {
  const year = Number(todayMYT(now).slice(0, 4));
  return (await db.prepare(CLOSURE_SQL).all(outletId, outletId)).map((a) => {
    let dates = spanDates(a.closure_from, a.closure_to);
    if (a.repeat_yearly) {
      const base = Number(a.closure_from.slice(0, 4));
      const all = [];
      for (let y = Math.min(base, year); y <= year + 1; y++) all.push(...spanDates(shiftYear(a.closure_from, y), shiftYear(a.closure_to || a.closure_from, y + (a.closure_to && a.closure_to.slice(0, 4) > a.closure_from.slice(0, 4) ? 1 : 0))));
      dates = all;
    }
    return { ...a, dates: new Set(dates), blocks: new Set(String(a.blocks || 'delivery,collection').split(',').map((x) => x.trim()).filter(Boolean)) };
  });
}

// Every date any closure covers (the office is closed → not a processing day; used by the cutoff rules)
export async function closureDates(outletId = null, now = new Date()) {
  const set = new Set();
  for (const r of await closureRules(outletId, now)) for (const d of r.dates) set.add(d);
  return set;
}

// Why a pickup / delivery date is blocked for this method (null = allowed)
export function closureReason(date, method, rules) {
  const need = method === 'pickup' ? 'collection' : 'delivery';
  for (const r of rules) {
    if (r.dates.has(date) && r.blocks.has(need)) return `${r.reason || r.title} — no ${method === 'pickup' ? 'collection' : 'delivery'}`;
    if (r.dates.has(addDays(date, -1)) && r.blocks.has('production')) return `${r.reason || r.title} — no production the day before`;
  }
  return null;
}

export function processingDay(now = new Date(), { cutoff = '13:00', closures = new Set() } = {}) {
  const { date, minutes } = mytNow(now);
  const [h, m] = cutoff.split(':').map(Number);
  let day = minutes >= h * 60 + m ? addDays(date, 1) : date;
  while (isWeekend(day) || closures.has(day)) day = addDays(day, 1);
  return day;
}

export const earliestFulfilDate = (procDay) => addDays(procDay, 2);
export const productionDateFor = (fulfilDate) => addDays(fulfilDate, -1);

// Everything the checkout needs: which dates are allowed and why
export async function orderWindow(now = new Date(), opts = {}) {
  const s = await getSettings();
  const cutoff = opts.cutoff || s.cutoff_time;
  // opts.closures (a plain Set of dates, used by tests) blocks those dates for every method, as before
  const rules = opts.closures ? [{ title: 'Closed', reason: 'Closed', dates: opts.closures, blocks: new Set(['delivery', 'collection']) }] : await closureRules(opts.outletId ?? null, now);
  const closures = opts.closures || new Set(rules.flatMap((r) => [...r.dates]));
  const maxDays = opts.maxDaysAhead ?? s.max_days_ahead;
  const { date: today, minutes } = mytNow(now);
  const proc = processingDay(now, { cutoff, closures });
  const earliest = earliestFulfilDate(proc);
  const last = addDays(today, maxDays);

  // allowed dates per method; `dates` = for the chosen method, or dates open for both when none is given
  const byMethod = { pickup: [], delivery: [] };
  const blockedInfo = [];
  for (let d = earliest; d <= last; d = addDays(d, 1)) {
    const why = { pickup: closureReason(d, 'pickup', rules), delivery: closureReason(d, 'delivery', rules) };
    for (const m of ['pickup', 'delivery']) if (!why[m]) byMethod[m].push(d);
    if (why.pickup || why.delivery) blockedInfo.push({ date: d, pickup: why.pickup, delivery: why.delivery });
  }
  const method = opts.method;
  const dates = method ? byMethod[method] : byMethod.pickup.filter((d) => byMethod.delivery.includes(d));
  const blocked = blockedInfo.filter((b) => (method ? b[method] : b.pickup || b.delivery)).map((b) => b.date);

  const [h, m] = cutoff.split(':').map(Number);
  const cutoffLabel = `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
  let why;
  if (proc === today) why = `Order before ${cutoffLabel} today and it is processed today (${fmtDay(today)}).`;
  else if (isWeekend(today)) why = `Our office is closed at weekends, so this order counts as ${dayName(proc)} (${fmtDay(proc)}).`;
  else if (minutes >= h * 60 + m) why = `It's past today's ${cutoffLabel} cutoff, so this order counts as ${dayName(proc)} (${fmtDay(proc)}).`;
  else why = `Today is a closure day, so this order counts as ${dayName(proc)} (${fmtDay(proc)}).`;

  return {
    now_myt: today,
    processing_day: proc,
    earliest,
    dates,
    by_method: byMethod,
    blocked_closures: blocked,
    blocked_info: blockedInfo,           // [{ date, pickup: reason|null, delivery: reason|null }]
    explanation: [
      why,
      `Earliest pickup/delivery: ${dayName(earliest)}, ${fmtDay(earliest)}.`,
      `Orders for Sunday–Tuesday close Friday ${cutoffLabel}.`,
      ...blockedInfo.map((b) => `${fmtDay(b.date)}: ${b.pickup && b.delivery && b.pickup === b.delivery ? b.pickup : [b.pickup && `pickup — ${b.pickup}`, b.delivery && `delivery — ${b.delivery}`].filter(Boolean).join('; ')}.`),
    ],
  };
}

// nearest allowed dates to a blocked one (shown at checkout)
export function nearestDates(dateStr, allowed, n = 2) {
  return [...allowed].sort((a, b) => Math.abs(Date.parse(a) - Date.parse(dateStr)) - Math.abs(Date.parse(b) - Date.parse(dateStr))).slice(0, n).sort();
}

export async function isAllowedFulfilDate(dateStr, now = new Date(), opts = {}) {
  return (await orderWindow(now, opts)).dates.includes(dateStr);
}
