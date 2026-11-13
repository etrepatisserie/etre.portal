export class HttpError extends Error {
  // details: extra JSON sent to the client, e.g. { invoices: [...] } for a blocked order
  constructor(status, message, details = null) { super(message); this.status = status; this.details = details; }
}
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const fmtMoney = (n) => `RM ${Number(n).toFixed(2)}`;
