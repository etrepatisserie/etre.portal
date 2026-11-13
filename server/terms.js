// Payment terms. COD = pay when ordering; NETxx = invoice due xx days after the invoice date.
export const TERMS = {
  COD: { days: 0, label: 'COD' },
  NET14: { days: 14, label: '14 days' },
  NET15: { days: 15, label: '15 days' },
  NET30: { days: 30, label: '30 days' },
};
export const termDays = (t) => TERMS[t]?.days ?? 0;
export const isCredit = (t) => termDays(t) > 0;
export const termLabel = (t) => TERMS[t]?.label || t;
