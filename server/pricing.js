// Order totals: Subtotal → Delivery fee (RM25, free at subtotal ≥ RM500) → SST on (subtotal + fee) → Total
import { getSettings } from './settings.js';

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export async function computeTotals(subtotal, method, s) {
  s ??= await getSettings();
  const sub = round2(subtotal);
  const threshold = Number(s.free_delivery_threshold);
  const freeDelivery = method !== 'delivery' || sub >= threshold;
  const deliveryFee = method === 'delivery' && !freeDelivery ? round2(s.delivery_fee) : 0;
  const sstRate = Number(s.sst_rate);
  const sstAmount = round2((sub + deliveryFee) * sstRate);
  return {
    subtotal: sub,
    delivery_fee: deliveryFee,
    free_delivery: method === 'delivery' && freeDelivery,
    amount_to_free_delivery: method === 'delivery' && !freeDelivery ? round2(threshold - sub) : 0,
    sst_rate: sstRate,
    sst_amount: sstAmount,
    total: round2(sub + deliveryFee + sstAmount),
  };
}

export const linesSubtotal = (lines) => round2(lines.reduce((a, l) => a + round2(l.quantity * l.unit_price), 0));
