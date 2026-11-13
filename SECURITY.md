# Security & data-integrity review (order-to-cash, Phase 5)

Reviewed 14 Nov 2026. "Fixed" items are in the code and covered by tests (`server/tests/security.test.js` and the
other test files). "To decide" items need a choice or a production set-up, so they are listed rather than changed.

## Login & sessions
| Finding | Status |
|---|---|
| Passwords are hashed with scrypt and a random salt; compared in constant time. | OK |
| Sessions never expired. | **Fixed:** a session ends 30 days after sign-in, or after 7 days unused. Expired ones are removed. |
| No limit on wrong passwords (guessing). | **Fixed:** 5 failures for an email (or 20 from one network address) in 15 minutes → wait before trying again. |
| The sign-in token is kept in the browser's localStorage. If a page were ever compromised by injected script, the token could be read. | To decide: moving to an HttpOnly cookie means a CSRF guard as well. Low risk today (no user-written HTML is rendered). |
| No password rules or reset flow; Admin creates customer logins and shares the password. | To decide: a minimum length and a "change password" page. |
| No two-step sign-in for staff. | To decide (recommended for Finance before going live). |

## Roles, outlets and customer isolation
| Finding | Status |
|---|---|
| Every API area checks the role (`requireRole`), and every query is limited to the user's outlet (`req.outletId`, `assertOutlet`). Customers only see their own orders, invoices, slips and files. | OK |
| All endpoints added in this project follow the same rules. | **Tested:** approval, closures, overrides, collection, documents, Bukku, kitchen calendar / summary / complete, failed delivery, attention dots. |
| The kitchen never receives money data — every kitchen response is built from an allowed-field list. | **Tested** on all kitchen endpoints, including the new calendar, summary and completion. |
| The API accepted calls from any website (CORS `*`). | **Fixed:** only the portal's own address (`APP_URL`, plus `CORS_ORIGINS` if needed). |

## Files
| Finding | Status |
|---|---|
| Uploads: only JPG / PNG / WebP / PDF, max 10 MB, content checked against the type (magic bytes), random file names. | OK |
| File access: owner customer, or Admin / Finance of the same outlet; the kitchen can't open invoices, DOs or slips. | OK |
| Replaced invoice / DO files are kept and listed in the history (nothing is deleted). | OK (by design) |
| Files are stored on the server's disk next to the database. | To decide: include `server/uploads` in the off-site backup (the backup command copies it). |

## Credentials & secrets
| Finding | Status |
|---|---|
| SMTP and Bukku credentials are read from `.env` on the server only; `.env` is git-ignored; nothing is sent to the browser. | OK (Bukku token tested: never appears in any response) |
| The test-account list on the sign-in page is switched off when `NODE_ENV=production`. | OK — remember to set it when going live. |

## Audit trail
| Finding | Status |
|---|---|
| Order events didn't record who acted. | **Fixed:** `delivery_events.user_id` + `audit_log` with old/new values for orders (placed, approved, rejected, adjusted, cancelled, dispatched, delivery failed, production completed), payment slips (verified / deposit / rejected), invoices & documents, overrides, closures and outlet settings. |
| Settings changes to company / bank details were not audited. | **Fixed** (outlet settings). |

## Backup & restore
| Finding | Status |
|---|---|
| No backup command; `npm run reset-db` deleted the database without a copy. | **Fixed:** `npm run backup` (safe while running; database + uploads into `backups/`, newest 30 kept); `npm run restore -- <file> --yes` (stop the server first; the current database is saved before restoring); `reset-db` now makes a backup first. |
| Backups are on the same computer. | To decide: copy `backups/` off-site daily (e.g. cloud drive), and test a restore monthly. |

## Going live checklist (not code changes)
- Serve the portal over HTTPS only; set `APP_URL` to the real address and `NODE_ENV=production`.
- Replace the remaining `[PLACEHOLDER]` company details in Settings.
- Switch Bukku on only after testing with a Bukku test company (see `server/bukku.js`).
