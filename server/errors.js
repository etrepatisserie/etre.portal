export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const round2 = (n) => Math.round(n * 100) / 100;
export const fmtMoney = (n) => `RM ${Number(n).toFixed(2)}`;
