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

// Dates blocked by closure announcements for this outlet (announcements with no outlet apply to both)
export function closureDates(outletId = null) {
  const set = new Set();
  for (const a of db.prepare("SELECT closure_from, closure_to FROM announcements WHERE type = 'closure' AND closure_from IS NOT NULL AND (outlet_id IS NULL OR ? IS NULL OR outlet_id = ?)").all(outletId, outletId)) {
    for (let d = a.closure_from; d <= (a.closure_to || a.closure_from); d = addDays(d, 1)) set.add(d);
  }
  return set;
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
export function orderWindow(now = new Date(), opts = {}) {
  const s = getSettings();
  const cutoff = opts.cutoff || s.cutoff_time;
  const closures = opts.closures || closureDates(opts.outletId ?? null);
  const maxDays = opts.maxDaysAhead ?? s.max_days_ahead;
  const { date: today, minutes } = mytNow(now);
  const proc = processingDay(now, { cutoff, closures });
  const earliest = earliestFulfilDate(proc);
  const last = addDays(today, maxDays);

  const dates = [];
  const blocked = [];
  for (let d = earliest; d <= last; d = addDays(d, 1)) {
    if (closures.has(d)) blocked.push(d); else dates.push(d);
  }

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
    blocked_closures: blocked,
    explanation: [
      why,
      `Earliest pickup/delivery: ${dayName(earliest)}, ${fmtDay(earliest)}.`,
      `Orders for Sunday–Tuesday close Friday ${cutoffLabel}.`,
      ...(blocked.length ? [`Closed (no pickup/delivery): ${blocked.map(fmtDay).join(', ')}.`] : []),
    ],
  };
}

export function isAllowedFulfilDate(dateStr, now = new Date(), opts = {}) {
  return orderWindow(now, opts).dates.includes(dateStr);
}
