# Work Log

A record of each completed task — newest first.

---

## 2026-11-14 · Task 24 — Deposit payments in Payment Verification

**Request:** "allow finance to record deposit payment in payment verification".

**Result**
- **Full or deposit:** when verifying a slip that covers **one invoice**, Finance chooses **Full payment** or **Deposit (part payment)**, then records the amount received and the payment date.
- **What a deposit does:**
  - it must be less than what's still owed (otherwise Finance is told to verify it as the full payment);
  - the invoice stays open with the remaining balance, and the customer can upload another slip for the rest;
  - verifying the rest as a full payment marks the invoice Paid.
- **"Amount still owed" now subtracts deposits everywhere:** the order block (a COD customer stays blocked until fully paid), aging, collection, the Finance dashboard, the cash-cycle receivables (by payment date), the slip's expected amount, and the Finance and customer invoice lists (shown as "deposit received · still owed").
- **Records:** `payment_slips.kind = 'deposit'`, the audit log (`deposit_verified`), and a customer notification ("Deposit received … balance still owed").
- **Bug fixed while checking:** the verify button always sent "full", because a parameter name hid the choice.
- **Tests:** 2 new; 72/72 pass. The browser check confirmed the deposit is recorded, the balance stays open, and the list shows it.

---

## 2026-11-14 · Task 23 — Order-to-cash Phase 3: Bukku integration (built switched off)

**Built** (`server/bukku.js`): one Bukku company per outlet. Credentials come only from the server's `.env` (`BUKKU_ENABLED`, `BUKKU_BASE_URL`, `BUKKU_KL_TOKEN/SUBDOMAIN`, `BUKKU_IPH_TOKEN/SUBDOMAIN`, documented in `.env.example`); they're never sent to the browser or put in git.
- **Confirmed from Bukku's docs:** the auth headers (`Authorization: Bearer` and `Company-Subdomain`) and `POST /sales/invoices`.
- **Not yet confirmed:** the invoice field names and the response shape. They're isolated in `toBukkuInvoice()` / `fromBukkuResponse()`; check them against the docs with a test company before turning it on.
- **Issuing:** Finance → Issue invoice → "Create in Bukku" (disabled until Bukku is switched on and set up). The portal keeps its own INV record and stores the Bukku number.
- **Failures:** the error is recorded, Finance gets an alert, and the invoice is kept with "Bukku failed". The order isn't affected: it was already approved and with the kitchen. Finance can **Retry** from Invoices, or **upload the file** instead.
- **No duplicates:** an invoice is claimed before sending, and a sent invoice is never sent again.
- **Activity:** Finance → Invoices → Bukku activity shows whether each company is connected and every call made (`integration_log`).
- **Per-company default:** the invoice method can be set to Bukku in Settings.
- **Tests:** 3 new in `bukku.test.js`, against a fake Bukku server (switched off by default; sends to the right company with the right headers; retry doesn't duplicate; failure is logged, alerts Finance and leaves the order with the kitchen; the upload fallback works). 70/70 pass.
- **Needed from the user:** for KL and Ipoh, the API token, the company subdomain and a test account; a copy of the "Sales → Invoices" section of the docs; how debtor codes, SKUs, the SST tax code and the delivery fee are set up in Bukku; and whose invoice number is official.

---

## 2026-11-14 · Task 22 — Order-to-cash Phase 2: finance & documents

**Built**
- **Payment verification:** Finance records the **amount received** and the **payment date** (both required; no future dates).
  - The amount is prefilled with what's still owed after credit notes.
  - A different amount shows a clear mismatch warning. Finance can still mark the invoices paid; the difference is kept on the slip and in the audit log. There are no partial payments.
  - The invoice's paid date is now the payment date.
  - The page shows what was received and when.
- **Manual invoice upload:**
  - Finance enters the number printed on the uploaded invoice (`external_number`, required), its date and due date, and its amount.
  - An amount that differs from the order total shows a warning.
  - Who uploaded it and when are recorded.
- **Replacing documents** (`document_versions`, `server/billing.js` `uploadDocument`):
  - an uploaded invoice can be replaced only by Finance, with a reason;
  - DOs can be uploaded by Admin (order page) or Finance (Invoices → Files…); one DO per order, and replacing it needs a reason;
  - every earlier file stays in the history.

  Customers can download the DO; the kitchen can't.
- **Per-company methods** (Settings → Invoices & delivery orders): invoices generated, uploaded or created in Bukku; DOs generated or uploaded. With uploaded DOs, the DO appears once someone uploads it. The issue page starts with the company's default.
- **Collection** (Finance → Reports → Collection), alongside Aging:
  - per company: due today, due within 7 days, overdue 1–7, 8–14 and more than 14 days;
  - follow-up notes per customer (date, contact, promised payment date, remarks) and the customer's payment history (amount received and payment date).
- **Tests:** 67/67 pass, including 5 new ones in `finance-docs.test.js`. Existing verify calls now send the amount and date.
- **Browser check (temporary database):** the mismatch warning, Collection and notes, the documents panel and the upload fields all work, with no console errors and no sideways scroll on a phone.

---

## 2026-11-13 · Task 21 — Admin order approval (order-to-cash Phase 1, first part)

**Request:** the approval process wasn't showing. It had never been built: only the audit had been done. The user then asked for every phase of `claude-code-prompt-order-to-cash.md` to be processed.

**Built**, using the audit's recommended answers to questions A and B:
- **Statuses:** customer orders start as `Pending`, shown as "Awaiting approval". No table rebuild was needed.
- **Rejection:** Admin can reject with a required reason. The order is stored as Cancelled with `rejected_at`, `rejected_by` and `reject_reason` (new columns), and shows as "Rejected".
- **New endpoints:** `POST /api/admin/sales-orders/:id/approve` and `/reject`.
- **Alerts:**
  - The kitchen and Finance invoice alerts, and the "Order confirmed" email, are now sent on approval, not when the order is placed.
  - Rejecting an order that came with a COD slip sends Finance a refund alert.
- **Rules:**
  - Customers can cancel only while the order awaits approval.
  - Phone orders entered by Admin are approved on entry.
  - The kitchen and Finance never see unapproved orders.
  - Order history now records who did each action (`delivery_events.user_id`).
- **Screens:**
  - Admin: an "Orders awaiting approval" card (red when production is today or tomorrow), an Awaiting approval tab with Approve / Reject on each row, a Rejected filter, and Approve / Adjust / Reject on the order page with a warning if the customer has outstanding payment.
  - Customer: "waiting for approval", "Approved", and "Rejected" with the reason.
  - The progress bar and legend have a new first stage.
- **Tests:** 57/57 pass. Two new tests cover approval and rejection plus phone orders; the cancel test was rewritten; other tests now approve their orders first.
- **Browser check on a temporary database:** the full approve and reject flows work, with no console errors and no sideways scroll on a phone.

**Rest of Phase 1 (2026-11-14)**
- **Add-on orders:** at checkout a customer can mark an order as an add-on to an earlier open order (`sales_orders.addon_of`). It gets its own number, approval, invoice and DO. The two orders link to each other, and the add-on is flagged in the Admin list and for the kitchen.
- **Audit trail** (`audit_log`, `server/audit.js`): records who placed, approved, rejected, adjusted, cancelled or dispatched an order, with old and new values; closure changes; and overrides granted or revoked. Shown on the Admin order page, with names in the order history.
- **Closures** (Admin → Closures; still stored as closure announcements, so customers keep seeing them):
  - each closure has an outlet (KL, Ipoh or both), a date range, what it blocks (production / delivery / collection), a reason and an optional yearly repeat;
  - checkout shows dates per pickup or delivery, with the reason; the server refuses a closed date and suggests the nearest open ones;
  - a production closure also blocks the next day's pickup and delivery;
  - closures made before this keep exactly their old effect (delivery + collection);
  - open orders on closed dates are flagged, never moved.
- **Overdue notice:** the checkout notice now shows the total outstanding, each invoice with its due date, how to pay, and when ordering reopens.
- **Finance override** (Finance → Blocked Accounts, `block_overrides`):
  - requires a reason, and lasts until a date (up to 14 days) or for one order;
  - can be ended early; it's shown on the customer's record and audited;
  - without one, a blocked customer can't place an order and Admin can't approve one.

  The user first asked for no override, then asked to follow the prompt, so it's built as the prompt says.
- **Tests:** 62/62 pass, including 4 new ones in `order-control.test.js` and a blocked-approval test.
- **Browser check (temporary database):** closures, checkout, the blocked notice and overrides all work, with no console errors and no sideways scroll on a phone.
- **Still to do:** Phases 2–5.

---

## 2026-11-13 · Task 20 — Mock entries to try the portal

**Request:** "give me some mock entries to try out the portal".

**Result**
- **New command `npm run mock:scenarios`** (`server/mock-scenarios.js`). It adds one of each "live" situation on top of the existing mock history, only for the 4 test-login customers. Every record is numbered MOCK-… and listed in `mock_records`, so `npm run mock:clear` removes it all. Running it twice adds nothing.
- **What it adds:** 10 orders, as follows:
  - a new COD order with its slip (Finance invoices and verifies it; the kitchen prints the sheet);
  - a later-date order whose quantity Admin adjusted;
  - an order with its sheet printed, ready to start;
  - an order in production for delivery today;
  - a late order whose pickup date has passed;
  - an order out for delivery with a tracking link;
  - an order ready for pickup;
  - a received order with an open complaint;
  - a complaint already turned into a credit note request;
  - a cancelled order.

  Plus a slip from an overdue customer to verify, a credit-term request, and bell notifications for each portal.
- **Applied to the live database** after a backup.
- **Checked:**
  - On database copies: clearing a copy with the scenarios leaves it identical to clearing one without them.
  - A new test in `server/tests/mock.test.js` confirms the same; 55/55 tests pass.
  - In the browser, every portal's to-do cards show the new work, and the kitchen still sees no money.
- **Not committed** (no commit was requested).

---

## 2026-11-13 · Task 19 — UI/UX redesign (`redesign colour/claude-code-prompt-erp-redesign.md`)

**Request:** a full redesign in phases, after an audit and an approved plan. The user's decisions:
- anonymise customer names in the docs, then commit;
- install Inter locally;
- page search only (⌘K);
- add a Settings page.

**Commits (each phase can be rolled back):** c7a1ef9 starting point · eb9b645 design system · 88ff3ac shell · a8fcc54 dashboards · 68fa92a modules + Settings · 01e8c5e PDFs & emails · d74ec4e accessibility.

**What changed**
- **Design system** (`src/styles/system.css`):
  - Tokens for colour, semantic status tones, type, spacing, radius and shadows.
  - Inter is self-hosted (`@fontsource/inter`). Figures use tabular digits.
  - Grey text is `#606876`, not the spec's `#737B89`, which failed 4.5:1 contrast.
  - Chart series `#3F6FB5` / `#C4731C` / `#2A9D7C` passed the colour-blind validator.
- **Status colours** (`status.js`), per the prompt:
  - New = amber · In production = blue · Ready / Out = navy · Received = green · Cancelled = grey · Late = red.
  - Unpaid = amber · Slip uploaded = blue · Paid = green · Rejected / Overdue = red.
  - Credit note: To issue = amber · Issued = green · Declined = grey.
- **Dates:** one format everywhere, "12 Nov 2026" (with the weekday for pickup and production days), in Malaysia time, using fixed month names.
- **Shell:**
  - Left sidebar with folding groups (each role sees only its own menu), breadcrumbs, ⌘K / Ctrl-K page search, user menu and a phone slide-out menu.
  - The Finance company tabs are now a tab bar. New sign-in page.
  - Placeholder "Ê" logo (`components/Logo.jsx`) until the real logo file is supplied.
- **Dashboards:** new to-do cards, KPI rows with clear comparison labels, dated headers and loading skeletons.
- **Modules:**
  - On phones, every table turns into labelled cards (`src/tableLabels.js`). Phones also get 16px inputs and buttons about 42px tall.
  - Action results appear as toasts (errors also stay on the page).
  - Confirm dialogs replace the browser pop-ups, with an optional reason field. They now also guard rejecting a slip and declining a credit note.
- **Settings (new)** at Admin → Settings, with API `/api/admin/settings` and 3 new tests:
  - Head office edits each outlet's company, bank and pickup / delivery details plus the ordering rules. Placeholder fields are flagged.
  - SST is read-only. Outlet admins see their own outlet read-only.
- **PDFs** (invoice, DO, credit note, kitchen summary): embedded Inter, navy accent, repeated table headers, and a page-numbered footer with the issuing company's details.
- **Emails:** table-based, inline styles, 600px, a fallback link under the button, and a company footer. Wording and triggers are unchanged.
- **Bugs fixed along the way:**
  - duplicate product options on Stock Movements in Both view;
  - no "Credit note issued" filter in the Email Outbox;
  - raw dates on the purchase order pages;
  - a long fulfilment line overlapping the old invoice PDF table.

**Checked**
- **Tests, build and lint:** 54/54 tests pass and the build passes. Lint has 28 warnings against 29 before the redesign, and none are new.
- **PDFs:** old and new versions rendered from the same demo data for KL and Ipoh. Every amount, document number and quantity is identical. The DO and kitchen summary show no prices.
- **Walkthrough,** on a temporary demo database (never the live one):
  1. A COD customer orders with a slip.
  2. Admin adjusts a quantity.
  3. Finance issues the invoice and verifies the slip.
  4. The kitchen prints and starts production, with no money anywhere.
  5. Admin marks the order ready.
  6. The customer receives it and reports a problem.
  7. Admin requests a credit note and Finance issues it.
  8. The KL / Ipoh / Both switches work.
- **Emails:** all 8 templates previewed in the Outbox.
- **Page sweeps:** 43 pages at 375, 820 and 1280px, with no sideways scroll and no console errors.
- **Accessibility:** the axe scan is clean on 18 key pages.

**To confirm**
- The official logo file.
- The real KL company address and SST numbers, and the KL / Ipoh pickup addresses and time slots. These are still placeholders and are flagged in Settings.
- The customer Info page still says the cut-off is 1 PM. Update its wording if the cut-off changes in Settings.

---

## 2026-11-13 · Task 18 — Icons (Lucide)

**Request:** add icons throughout the ERP, using one set only (Lucide), always with a text label, with the mapping kept in one file. This is a visual change only.

**Result**
- **One icon set:** `lucide-react` 1.72.0 was added. Every emoji and symbol that was used as an icon (🔔 🛒 📍 🧾 🖨 ▶ ✓ ✕ ⌂ ➜ ▤ ⬇ 🎉 …) has been replaced. The ◆ brand mark and the ☐ tick boxes on the printed kitchen sheet stay as they are.
- **One mapping file:** `src/icons.js`, next to `status.js`. It holds the menu and module icons (`NAV`), status icons (`STATUS_ICON`), notification icons (`NOTIFY_ICON`), announcement icons and common actions (`ACTION`). The new component `src/components/Icon.jsx` draws them, all with the same stroke.
  - Sizes: 14 in badges, 16 in tables, 18 in the menu and buttons, 24 on to-do cards and empty states.
- **Where icons appear:**
  - top menu and sub-menu items; status badges; the order progress bar (the stage icon, or a tick once done); the process legend;
  - every to-do card (Admin, Finance, Kitchen); the "Next step" boxes; empty states (inbox, tick for "all done", magnifier for "no match");
  - main buttons: New / Add, Print, Download / Excel, Issue invoice, Mark as paid, Credit note, Replacement, Start production, Ready for pickup / Out for delivery;
  - search boxes; the outlet switch (building); the cart; Pickup / Delivery at checkout; the calendar; the notification list and toasts; announcements.
- **Icon-only buttons** (bell, menu, close, remove line, calendar arrows) all have a tooltip and an `aria-label`.
- **Icon colour** follows the text or status colour.
- **Layout fixes needed for the icons:**
  - The top menu is tighter on narrow laptops, with icons on sub-menus only below 1280px, so nothing scrolls sideways from 901px up.
  - On phones, "Sign out" moved into the ☰ menu. The ☰ button used to be pushed off-screen on the Kitchen and Admin bars. Phone menu rows are now 46px tall.
- **Not changed:** business logic, the API, data, PDFs and emails. The kitchen still shows no money.
- **Checked:**
  - 51/51 tests pass (including the kitchen no-money test), the build passes, and lint shows no new warnings.
  - Browser check of the main pages for all four portals at desktop and phone width: no sideways scroll, no unlabeled icon-only buttons, no console errors.
  - The top bar was measured at 901–1440px wide for Admin, Finance and Kitchen.

---

## 2026-11-13 · Task 17 — Calendar date picker + Ipoh bank account

**Request:** "change date selection in customer portal to calendar style date selection. for ipoh's payment method is through Etre Patisserie Sdn Bhd 20809800044129 (RHB)".

**Result**
- **Calendar at checkout:** the customer portal's date dropdown is replaced by a month calendar (`src/components/DateCalendar.jsx`).
  - Weeks start on Monday. Customers can only click dates that are open for their order; other days are greyed out, and outlet closure days are struck through in red. Today is underlined.
  - The chosen date is written out in full under the calendar. When the window crosses into the next month, ‹ › buttons appear.
  - The "Why these dates?" note and the time-slot choice are unchanged.
- **Ipoh bank account:** RHB Bank · ETRE PATISSERIE SDN BHD · 20809800044129, replacing the placeholder.
  - Set in `server/outlets.js`. On start-up, any outlet detail still marked `[PLACEHOLDER]` is filled in once the real value is known, so the live database updated itself.
  - It shows everywhere Ipoh's bank is used: checkout (COD), Payments page, invoice PDFs and emails.
  - Ipoh invoice PDFs already generated with the placeholder are cleared, so they are re-made with the RHB details the next time they are opened.
- README bank lines updated.
- **Checked:** 51/51 tests pass, the build passes and lint is clean for the new files. In a browser, as the Ipoh test customer, picking a date works and checkout shows the RHB account, on desktop and phone with no page errors.

---

## 2026-11-13 · Task 16 — Lighter colour tones

**Request:** "use lighter colour tones for erp".

**Result**
- The dark top menu bars are now soft pastel bars with dark text. Each portal keeps its own colour: Admin light blue, Customer mint, Finance lilac, Kitchen apricot. The active menu item is underlined in that colour.
- The page background, borders and login screen are lighter. The selected filter chip is now light blue instead of black, and chart tooltips are a softer slate.
- The main button blue is slightly lighter (#2f6fe0) but still readable: white text on it has 4.7:1 contrast. Muted text is still at least 4.5:1 on the page.
- **Where:** one "Light colour theme" block at the end of `src/index.css`, which overrides the earlier colours. The previous stylesheet is backed up in the session scratchpad.
- **Checked:** screenshots of the login, Admin, Customer, Finance and Kitchen pages, plus the phone menu (no sideways scroll, no page errors). The build passes.

---

## 2026-11-12 · Task 15 — Cash conversion cycle + Payables (supplier bills)

**Request:** "add feature with cash conversion cycle in finance". The user chose **"Track it in portal"**: supplier bills are recorded in the portal, and inventory days come from stock data. Nothing is typed in by hand.

**Result**
- **New: Finance → Reports → Cash Conversion Cycle** (`/finance/cash-cycle`). It is worked out per company (never summed), follows the KL / Ipoh / Both tabs and has a 3 / 6 / 12-month range.
  - **Headline:** CCC in days, with a plain-language meaning (negative = customers pay you before you pay suppliers).
  - **The three parts**, each with the figures behind it:
    - **DIO** (days inventory) = average stock value ÷ stock used × days. Stock is valued at ingredient and packaging unit cost; used = opening + received − closing.
    - **DSO** (days to collect) = average owed by customers ÷ sales × days, after credit notes.
    - **DPO** (days to pay suppliers) = average owed to suppliers ÷ purchases (supplier bills) × days.
  - **Missing data:** when a part can't be worked out, it says "Not enough data" and what is needed, instead of showing 0.
  - **"Cycle by month" chart:** DIO, DSO and DPO as three series, with CCC written under each month. The tooltip explains gaps. There is a table view and a "How it is worked out" note.
  - **History:** stock on a past date is worked out from today's stock and the movements since. Opening stock entered at go-live counts as already on hand.
- **New: Finance → Payables** (`/finance/payables`):
  - **Receiving a PO:** when Admin marks a purchase order Received, its received date is saved and Finance gets a "Record supplier bill" alert.
  - **Tabs:** Bills to record / Unpaid / Paid.
  - **Recording a bill:** supplier invoice number, bill date, term (on receipt / 7 / 14 / 30 / 45 / 60 days) and amount (defaults to the PO total).
  - **Paying a bill:** mark paid with a date and bank reference. Paid bills show "on time" or "late".
  - **Totals per company:** unpaid, overdue, due in 7 days, bills to record. In "Both", each company has its own row.
  - **Finance dashboard:** to-dos "Supplier bills to record" and "Supplier bills overdue".
- **Data:** new `supplier_bills` table and `purchase_orders.received_at` column, added without data loss.
- **Mock data:** the generator now also makes ~13 weeks of mock purchasing per outlet:
  - weekly ingredient usage, and a fortnightly MOCK-PO restock that adds back exactly what was used, so stock levels don't change;
  - MOCK-BILL supplier bills (dairy on 14 days, others 30): mostly paid around the due date, one Ipoh bill overdue, and the latest delivery waiting for its bill.
  - `npm run mock:clear` removes it all. The new `npm run mock:purchasing` adds only this part to existing mock data.
  - **Live database:** I backed it up first, to the scratchpad (`erp-before-task15.db`), then ran `mock:purchasing` on it: 42 POs and 36 bills added; existing mock orders untouched.
  - **Live result (6 months):** KL CCC 35 days (DIO 56 + DSO 1 − DPO 23); Ipoh 48 days (57 + 12 − 22).
- **Chart parts:**
  - `--series-3` (aqua) added for the third series; blue / orange / aqua passes the colour-blind checks. Aqua is light on white, which is allowed because the chart has a legend, tooltips and a table view.
  - The grouped chart now shows "no data" instead of 0.

**Checks**
- **Tests:** 51/51 pass.
  - New `payables.test.js`: receive → alert → record (checks number, future date, term, one bill per PO) → overdue → pay (checks dates, already paid); access limited to Finance; CCC = DIO + DSO − DPO; stock used → DIO; bill → DPO.
  - `mock.test.js` extension: mock POs and bills exist, CCC works for both companies, stock levels unchanged, everything removed.
- Build passes; lint shows no new warnings.
- Browser check on the dev server: both companies, tooltips, recording form, phone width, no console errors.

**To confirm**
- DIO counts ingredients and packaging only. Finished products have no cost and there are no recipes, so stock "used" only appears through stock adjustments and stocktakes. For a realistic DIO, Admin should record ingredient usage regularly, or I can add recipes so production deducts ingredients.
- Unit costs are today's ingredient costs (no cost history).
- Supplier payments are only recorded here. They aren't linked to a bank account or to Bukku.

---

## 2026-11-12 · Task 14 — Finance statistics (graphs and analytics)

**Request:** "show statistic for finance account in graphs and analytics"

**Result**
- **New page:** **Finance → Reports → Statistics (graphs)** (`/finance/statistics`). It follows the KL / Ipoh / Both company tabs and has a 3 / 6 / 12-month range. In "Both", each company has its own section, one after the other; figures are never added together.
- **Headline figures per company:**
  - invoiced (count and average invoice);
  - collected;
  - outstanding now (amount overdue);
  - average days to pay and % paid on time (credit-term customers);
  - credit notes and SST invoiced.
- **Charts per company.** Every chart has a Chart / Table toggle and a hover tooltip.
  - Invoiced vs collected by month (two series with a legend; the current month is shown lighter as month to date).
  - Outstanding by age (after credit notes).
  - Who owes the most.
  - Average days to pay by month.
  - % paid on time by month.
  - Top customers.
  - Sales by payment term.
  - Credit notes by month (only shown when there are any).
- **Chart parts:**
  - New `GroupedColumnChart` in `components/charts.jsx`.
  - Second series colour `--series-2` (orange), checked with the palette validator: blue/orange passes every colour-blind and contrast check.
  - `ColumnChart` now shows "No data" for months with no data instead of RM 0.
- **API:** `GET /finance/statistics?months=3|6|12` returns `companies[]` with totals, monthly figures, aging, top and outstanding customers, and sales by term. Finance only.

**Checks**
- 48/48 tests pass, including a new test: per company, monthly figures add up to the total, the KL tab matches the KL section in Both, and admin is refused.
- Build passes; lint shows no new warnings.
- Browser check on the dev server (read-only, mock data): both companies, KL with 12 months, tooltip, phone width with no horizontal scroll, no console errors.

**To confirm**
- KL has only one test customer (COD), so its payment-speed charts are empty until credit-term customers pay.

---

## 2026-11-12 · Task 13 — Separate "to dispatch today" from "yet to dispatch"

**Request:** "separate orders that is yet to dispatch and to dispatch today"

**Result**
- **How orders are split:** orders not dispatched yet (new, with the kitchen, or in production) are grouped by their pickup / delivery date in Malaysia time.
  - **To dispatch today:** the date is today, plus **late** orders whose date has passed. Late orders are flagged "Late — not dispatched".
  - **Yet to dispatch:** dates after today, earliest first.
- **Admin dashboard:** the old "Orders to dispatch" card is replaced by two cards: **To dispatch today** (the hint says how many are late) and **Yet to dispatch**.
- **Sales → Sales Orders:** new **To dispatch today** and **Yet to dispatch** tabs with counts, next to Open / All / Cancelled. Rows show "Today", the time slot, and a late flag; both tabs sort by date.
- **API:** `/admin/sales-orders?status=DispatchToday|DispatchLater` and dashboard counts `dispatchToday`, `dispatchLate`, `dispatchLater`. These follow the outlet switch.

**Checks**
- 47/47 tests pass, including a new `dispatch.test.js`: an order moves later → today → late, the counts match the lists, and it leaves both once dispatched.
- Build passes; lint shows no new warnings.
- Browser check on a separate temp database: both dashboard cards and both tabs work, no console errors, no horizontal scroll on phone.

**To confirm**
- Tomorrow's orders that are already in production appear under "Yet to dispatch", but the Dispatch button still works if you hand them over early.

---

## 2026-11-12 · Task 12 — Complaints → credit note or replacement; Finance credit notes; dashboard bar removed

**Request:** "remove where every order is bar in admin accounts, allow Credit note function in finance account, admin solve the problem offer CN or replacement for all complaint, cn alert goes to finance to be issued"

**Result**
- **Admin dashboard:** the "Where every order is" bar is removed. The complaints to-do card is now "Customer complaints — offer a credit note or a replacement". The Sales Orders page keeps its status filter bar.
- **Admin → Sales → Complaints** (was "Discrepancies"): the free-text "Resolve" box is gone. Every complaint has two buttons:
  - **Offer credit note:** quantity (defaults to what the customer reported) and reason, with a live amount including SST. "Send to Finance" sends Finance an alert, adds to its to-do count and shows the request in its list. The complaint shows "With Finance", then the CN number and PDF once issued.
  - **Send replacement:** quantity, pickup or delivery, date and slot from the outlet's normal order window. This creates an RM 0 order straight to the kitchen; the customer and the kitchen are notified and Finance never invoices it. Complaints about a replacement order can only get another replacement.
- **Finance → Invoices → Credit Notes** (new), with tabs To issue / Issued / Declined / All:
  - **Issue:** Finance can change the quantity and reason first. This assigns `CN-{KL|IPH}-YYYY-####`, then emails the customer, notifies the customer and Admin, and generates a PDF.
  - **Decline:** a reason is required. The complaint goes back to Admin to resolve again; the reason is never shown to the customer.
  - **Its own credit note:** **+ New credit note**, or the **CN** link on any invoice. Pick the items and quantities, add a reason, and it is issued immediately.
  - **Before an invoice exists:** a credit note can't be issued; the page shows an "Issue invoice" button.
  - The finance dashboard has a "Credit notes to issue" to-do.
- **Money:**
  - Each invoice now has an amount still owed (total − issued credit notes), used by aging (screen and downloads), the order block, dashboard outstanding and overdue, the monthly report and the customer's amount to pay.
  - A credit can't exceed what was ordered or the invoice total.
  - A fully credited unpaid invoice is settled.
  - A credit on a paid invoice is marked "Refund or offset (invoice already paid)".
  - The monthly report adds credit notes, net SST and a "credit notes" Excel sheet per company.
- **Customer:** the Payments page shows credit notes (with PDF) and amounts after credit; the order page shows credit notes and replacement links.
- **Data:** a new `credit_notes` table; new columns `sales_orders.replacement_for` and `discrepancies.action` / `replacement_so_id`, added without data loss. Credit notes and replacements on MOCK orders get `MOCK-` numbers and are removed by `npm run mock:clear`.
- **Fix found while testing:** the admin dashboard's low-stock list gave React a duplicate-key warning when both outlets are shown. Each row now carries an outlet tag.

**Checks**
- **Tests:** 46/46 pass. A new `complaints.test.js` covers request → alert → issue → balance / aging / customer / PDF access / report; decline → reopen → replacement (RM 0, kitchen yes, invoice no); waiting for the invoice; Finance's own credit note; quantity and total caps; full credit settles; role checks.
- Build passes; lint shows no new warnings.
- Mock clear-up checked: MOCK-CN / MOCK-SO-R numbers, everything removed, no foreign-key problems.
- **Browser walkthrough on a separate temp database (live data untouched):** 13/13 checks passed, no console errors, no horizontal scroll on phone.

**To confirm**
- Credit notes cover goods only (with SST), not the delivery fee. Say if Finance should be able to credit the delivery fee.
- Refunds for already-paid invoices are only marked. There is no "refund paid" step or automatic offset against the next invoice yet.
- Complaints still come only from "Mark as received". There is no separate complaint form after receipt.

---

## 2026-11-12 · Task 11 — Delivery goes to the registered business address by default

**Request:** "if customer choose delivery address automatically assume that it is delivered to registered business address. unless remarked otherwise."

**Result**
- **Checkout:** choosing Delivery now shows *Deliver to · registered business address* with the customer's address on file. The customer no longer types an address or ticks the area box.
- **Different address:** an optional *Deliver to a different address for this order* checkbox opens a text box and the delivery-area tick. The registered address is then shown struck through.
- **No address on file:** customers without a registered address go straight to the address box.
- **Server (`createOrder`):** an empty address, or one matching the registered address, uses the registered address and skips the area check. A different address requires the area confirmation. Delivery with no address at all is refused.
- **Which address:** "registered address" = the customer's delivery address on file, falling back to the billing address. For all 16 real customers the two are the same.
- **Staff order form:** the address is prefilled with the registered address, with the billing address as fallback, plus a note to change it only if the customer asked.
- **API:** the customer profile now includes `registered_address`.

**Checks**
- 43/43 tests pass, including a new test for the default address, the different-address area check and the saved address.
- Build passes; lint shows no new warnings.
- Browser check as Test customer C: the default view and the different-address view both look right, with no console errors. No orders were placed for real customers.

**To confirm**
- A different address written only in the free-text *note* is not detected automatically. Customers should use the checkbox, and staff should still read the notes.

---

## 2026-11-11 · Task 10 — One finance login for both companies + mock finance data

**Request:** "separate KL's finance and Ipoh finance under 1 portal account but separated filters and reports. create mock up data in the accounts". The user chose:
- **Mock data on the 4 real test logins.** It is tagged and can be removed with one command.
- **One finance login:** finance.ipoh@ is removed.

**Result — finance**
- **One login:** `finance@demo.test` is the only finance account. The `finance.ipoh@` login was removed from the seed, the live database, the sign-in page and the README.
- **Company tabs:** **KL / Ipoh / Both companies** tabs sit at the top of every finance page and replace the menu-bar outlet dropdown for Finance.
  - Each tab is labelled with the company name.
  - Switching reloads the page's data without a full page refresh.
  - Lists, the customer filter, payment slips, terms, reports and downloads all follow the tab.
- **Dashboard:** in Both, each company gets its own to-do cards and month figures side by side. KL and Ipoh numbers are never added together.
- **New Reports → Monthly Report** (`/finance/reports`), per company:
  - month picker (last 12 months);
  - invoiced amount (count, subtotal, delivery, **SST**, total), collected in the month, outstanding today and overdue;
  - a by-customer table and a 6-month chart with a table view;
  - the list of invoices issued.
  - Excel download (`/finance/reports/download`) with summary and invoice sheets for each company.
- **Aging Report:** split into one section per company. The Excel download has "KL by customer / KL invoices / IPH …" sheets, and the CSV gains a Company column. File names say which company (or `kl-and-ipoh`).
- **API:** `/finance/dashboard` now also returns `companies[]` with per-company figures. "This month" now uses Malaysia time.

**Result — mock data** (`server/mock-finance.js`)
- **Covers** the 4 real customers with a `@demo.test` login and about 3 months of history: 67 orders, 64 invoices and 59 slips on the live database.
  - **Test customer A** (KL, COD): orders every 3–5 days, all paid. One slip was rejected and then re-sent. The latest slip is still waiting to be checked, and today's order with its slip still needs an invoice.
  - **Test customer B** (Ipoh, COD): all paid. One order is in production and today's order still needs an invoice.
  - **Test customer C** (Ipoh, 15-day): a late payer with one invoice 1–30 days overdue and one 31–60 days overdue.
  - **Test customer D** (Ipoh, 30-day): pays on time. Several invoices are not yet due, one slip covering 2 invoices is waiting, one order is out for delivery and one still needs an invoice.
- **Numbering:** every document is MOCK-SO / MOCK-INV / MOCK-DO, so the real SO-/INV- numbering still starts at 0001. Slip PDFs say "MOCK … not a real transaction".
- **Removal:** all mock rows are listed in a new `mock_records` table. `npm run mock:clear` removes them, plus anything created on top of mock orders (invoices, slips, stock movements, notifications, emails, files on disk).
- **Re-creating:** `npm run mock:finance` (re)creates the same set. A fresh database creates it automatically; `SEED_MOCK=0` skips it.
- **Real customers are untouched:** no customer details are changed, and customers without a test login get nothing.

**Checks**
- `npm test`: 42/42 pass. New tests cover:
  - **single finance login:** company figures add up to the total, and the X-Outlet tab narrows the dashboard;
  - **reports:** per-company invoices, SST and 6-month trend; the KL Excel download has only KL sheets; the aging Excel has sheets per company;
  - **mock data:** MOCK- numbering, only test-login customers, every invoice/slip state present, real numbering still at 0001, and clear → empty (including files on disk) → recreate gives the same counts.
- Build OK. Lint: no new warnings.
- **Headless browser:** 13 checks pass with no console errors.
  - Tabs switch Dashboard, Invoices, Reports and Aging between KL, Ipoh and Both.
  - Payment slips and orders to invoice show both companies.
  - No horizontal scroll at phone width.
  - The 4 customer test logins still work.

**To confirm**
- Ipoh's SST registration number is still a placeholder: it shows as "[PLACEHOLDER]" in the report header.
- KL has only one test-login customer, so the KL books are small. Add `"demo_login"` to more KL customers (e.g. a credit-term one) in `customers.json`, then run `npm run import:customers && npm run mock:finance`.
- The real customers' account start dates are still set to today, so credit-term eligibility doesn't match the mock history.
- Run `npm run mock:clear` before real use.

---

## 2026-11-11 · Task 9 — Test logins for real customers

**Request:** "create a few demo account using real customer data".

**Result**
- **4 real customers now have a portal test login** (password `customer123`). I picked customers without data problems, covering both outlets and every payment term:

  | Customer | Outlet | Term | Login |
  |---|---|---|---|
  | Test customer A | KL | COD | (test login A) |
  | Test customer B | Ipoh | COD | (test login B) |
  | Test customer C | Ipoh | 15-day | (test login C) |
  | Test customer D | Ipoh | 30-day | (test login D) |

  KL has no clean credit-term customer: the only one is the inter-company ETRE PATISSERIE debtor, so I didn't pick it.
- **No invented data:** these logins come with no orders, invoices or slips.
- **Where they're set:** a `"demo_login"` field on the customer in the git-ignored `server/data/customers.json`, so real names stay out of the code.
  - `importCustomers()` creates the login if the customer has none yet. It runs on a fresh database and with `npm run import:customers`.
- **Sign-in page:** a "Customer test accounts" section loads them from the new `GET /api/public/demo-accounts`. That endpoint returns customer logins ending in `@demo.test` and returns nothing when `NODE_ENV=production`.
- **Changed files:** `server/customers-import.js`, `server/import-customers.js`, `server/app.js`, `src/pages/Login.jsx`, `server/tests/clean-start.test.js`, `server/tests/outlets.test.js`, `README.md`, and `server/data/customers.json` (git-ignored).

**Checks**
- `npm test`: 38/38 pass. The tests check that the only automatic logins are `@demo.test` test logins, that each one signs in, and that each sees no orders.
- Build OK.
- **Live database:** 4 logins created, 0 orders.
- **Headless browser:** each account signs in by clicking its row on the sign-in page. Home, Shop (with the right outlet), My Orders, Payments and Info load with no errors.

**To confirm**
- Orders placed with these logins are real orders. They go to that outlet's kitchen and Finance, so warn staff when you test, or run `npm run reset-db` afterwards.
- Want a different or extra customer, e.g. a KL credit-term one? Add a `demo_login` field to that customer in `customers.json`.
- Remove or change the shared password before real customers use the system.

---

## 2026-11-11 · Task 8 — Real customers only (clean start)

**Request:** "use real customer data from /Users/annlee/Documents/testing-project". The user chose **"Real customers only"**: remove the demo customers and all their mock history, start clean with the 16 real customers, and keep the staff logins.

**Result**
- **The database starts clean by default.** It contains:
  - the 2 outlets;
  - the 7 staff logins;
  - the 16 real customers (10 KL, 6 Ipoh), with no orders and no portal logins;
  - the 44 catalog products;
  - the shared suppliers;
  - ingredients with **opening stock** per outlet (Ipoh at 60% of KL).
- **Removed from a fresh database:** demo customers, orders, invoices, DOs, payment slips, emails, notifications, discrepancies, credit-term requests, purchase orders, announcements and stock history.
- **Demo data is still available on request:** `npm run reset-db && SEED_DEMO=1 npm run dev` brings back the 7 "(demo)" customers and their 6 months of history. The tests turn it on automatically, so nothing that was built is lost.
- **Real customers get no invented data:** the demo-only step that stamped a fake "term updated by Finance" date now applies only to demo customers.
- **Login page:** shows staff test accounts only. Customer logins come from Admin → Customers → **Create login**.
- **Customers page:** the Real/Demo filter only appears when demo customers exist.
- **Changed files:** `server/seed.js`, `server/tests/helpers.js`, new `server/tests/clean-start.test.js`, `src/pages/Login.jsx`, `src/pages/admin/Customers.jsx`, `README.md`.

**Checks**
- `npm test`: 38/38 pass, including 2 new clean-start tests (no demo customers, empty order/invoice/slip/email/PO/announcement tables, only opening-stock movements).
- Build OK. Lint: no new warnings (2 older ones remain).
- **Live database after `npm run reset-db`:** 16 customers (KL 10 / IPH 6), 0 demo, 0 orders, 0 invoices, 0 slips, 0 emails, 7 users.
- **Headless browser:** 15 Admin / Finance / Ipoh-kitchen pages load with no errors on the empty database.

**To confirm**
- Before anyone orders, give each real customer a portal login (Admin → Customers → Create login), then share the details.
- The Task 7 data questions are still open: Debtor 1 is in both debtor lists, Debtor 2's Ipoh address, the inter-company debtor, missing phones/addresses, credit limits not enforced, and account start dates set to today. The start date affects when credit-term requests are allowed.
- Ingredient opening stock levels are placeholders. Enter real counts with Admin → Stock → Adjust.
- Staff logins still use the `@demo.test` emails and simple passwords. Replace them before going live.
- Ipoh bank details are still placeholders.

---

## 2026-11-11 · Task 7 — Two outlets (KL & Ipoh) + real customer data

**Request:** "I currently have 2 outlets, Ipoh and KL — how do I separate both?" The user answered:
- **Separate companies** (own name, bank, SST no. and invoice numbering).
- **Each outlet bakes** its own orders.
- **Customers have a fixed home outlet.**
- **Staff see their own outlet only.**

Then: "feed in real customer data" from `Real customer data/` (two debtor reports from the accounting system).

**Result — outlets**
- **Outlets:** a new `outlets` table holds each outlet's company, registration no., SST no., bank, pickup address and slots, and delivery area.
  - **KL:** ETRE PATISSERIE KL SDN BHD (202301018733 / 1512655-A).
  - **Ipoh:** ETRE PATISSERIE SDN BHD (1375339-U), 30-Jalan Lee Kwee Foh, Taman Canning, 31400 Ipoh. The company names, registration numbers and Ipoh address came from the debtor reports.
- **Per-outlet numbering:** SO-KL / SO-IPH, INV-KL / INV-IPH, DO-, PO-.
- **Each outlet's own company on documents:** invoices, delivery orders, emails and checkout bank details use the issuing outlet's company and bank.
- **Each outlet has its own kitchen:** separate production plan, stock (new `product_stock` table), ingredients, purchase orders and low-stock alerts. The catalog, prices and suppliers stay shared.
- **Customers have a home outlet:** it decides their pickup address and slots, delivery area, closures (announcements can be KL, Ipoh or both), announcements, bank account, kitchen and invoicing company.
- **Staff limited to their outlet, enforced in the API:** outlet staff (`staff@` / `admin.ipoh@`, `finance.ipoh@`, `kitchen@` / `kitchen.ipoh@`) only see and act on their outlet. Records from the other outlet return "not found". Notifications only go to that outlet's staff and head office.
- **Head office** (`admin@`, `finance@`) sees both outlets, with a **KL / Ipoh / Both switch** in the menu bar and outlet tags on every list.
  - Forms ask head office which outlet a new customer or PO belongs to; announcements can target KL, Ipoh or both.
  - Changing stock requires picking an outlet first.
- **Payment terms extended to match your real customers:** COD, 14, 15 and 30 days. Finance picks any of these per customer, and invoice due dates follow the term.

**Result — real customer data**
- **Extracted, not committed:** the data from the two PDFs went into `server/data/customers.json`. That file and the `Real customer data/` folder are **git-ignored**.
  - Re-import any time with `npm run import:customers` (matches on debtor code).
- **16 real customers** (10 KL, 6 Ipoh). Fields: debtor code, name, registration no., billing and delivery address, contact, phones, email, term, credit limit.
  - New fields were added for registration no., billing address, second phone and credit limit.
  - Invoices now show "Bill to" with the registration no. and billing address.
- **No invented history:** real customers get no orders or invoices, and no portal logins. **Admin → Customers → Create login** sets one up per customer when they're ready.
  - Demo customers stay for trying the system, marked "(demo)", with two new Ipoh demo customers.
- **Customers list:** real / demo filter, debtor code, registration no., term, credit limit, login status, and highlighted "No phone" / "No address".

**Checks run**
- `npm test`: **36 of 36 pass**, including a new outlet test file:
  - Ipoh admin, finance and kitchen can't see or act on KL orders, invoices, documents, customers or stock (and the reverse).
  - The outlet header can't widen an outlet user's view, but head office can switch.
  - Numbering is per outlet.
  - Notifications only reach the right outlet.
  - Bank, delivery area, closures and announcements are per outlet; the KL closure doesn't block Ipoh dates.
  - Stock adjustments affect one outlet only.
  - Net 30 due dates are correct.
  - Real customers have no orders or logins; creating a login is limited to the right outlet; the customer then sees the Ipoh portal.
- Production build and lint: no errors.
- **Browser walkthrough:**
  - The full order flow still passes.
  - The head office switch works: Both shows 16 real customers; Ipoh shows only Ipoh customers.
  - The Ipoh admin sees only SO-IPH orders.
  - No console errors.
  - **Fixed:** the menu bar overflowed at phone width once the outlet chip was added.
- The demo database was reset afterwards.

**To confirm**
1. **Debtor 1** appears in **both** debtor lists. It's imported once, with **Ipoh** as its home outlet. Should KL also be able to sell to it?
2. **Debtor 2** is in the **KL** list but has an **Ipoh** address. Kept under KL as listed: KL or Ipoh?
3. **ETRE PATISSERIE SDN BHD (300-E001)**, your Ipoh company, is a KL debtor on Net 30, so it's inter-company. Imported as a KL customer. Should it be ordering through the portal, or excluded?
4. **Missing details:** one hotel debtor has no address or phone, and several others have no phone. One debtor's address is cut off or has a typo. Kept exactly as in the reports.
5. **Account start dates** for real customers aren't in the reports, so they're set to today. This affects when COD customers can request a credit term (2 months).
6. **Credit limits** (RM30,000 each) are stored and shown but **not enforced** yet. Should orders be blocked above the limit?
7. **Placeholders:** **Ipoh's bank** name and account no., SST numbers for both companies, the KL company address, pickup addresses / slots and Ipoh's delivery area.
8. **Debtor codes for new customers:** they get CUS-### unless you type a code. Do you want new codes to follow your 300-X### pattern?
9. Open items from Task 6 are unchanged (COD repeat orders while a slip waits, the cancellation rule).

---

## 2026-11-11 · Task 6 — Direct ordering: no admin confirmation, COD slip at checkout

**Request:**
- Improve the UX/UI and make it easy to understand.
- No admin confirmation: customer orders go straight to the kitchen, and Finance is alerted to issue the invoice.
- COD customers must submit their payment slip when ordering.
- Finance can filter by customer company, using a drop-down or by typing the name.
- Customer Purchase History summarises all invoice numbers, with only one "Pay & upload slip" button.
- Suggested selling prices and storage guidelines move under Info.

**Result**
- **New flow:** Customer places the order → it goes **straight to the Central Kitchen** (status "New order"), and **Finance is alerted** ("Issue invoice: SO-…") at the same moment → the kitchen prints the sheet and starts (no waiting for the invoice) → Admin dispatches → the customer confirms receipt.
  - The invoice and payment are now a **separate track** and no longer a stage of the order.
  - The admin confirm step and its endpoint are removed.
  - Admin's job is now: adjust quantities if something is short (before the kitchen starts), dispatch, send tracking links, and resolve problems. If an unpaid invoice was already issued, it is updated automatically when quantities change.
- **COD slip at checkout:** COD customers see step 4 "Pay & attach your slip", with the exact total and bank details. The order can't be placed without the slip (also enforced in the API).
  - When Finance issues the invoice, the slip is attached to it automatically (invoice shows "Slip Uploaded"), and Finance then verifies it.
  - Orders entered by Admin (phone orders) don't need a slip.
- **Cancelling:** customers can cancel until the kitchen starts, and the API refuses after that. Admin can cancel until dispatch. Any invoice is voided, and Finance is told if a COD slip needs refunding.
- **Finance:**
  - A type-or-pick **customer filter** (type part of the company name, or choose from the drop-down) on Orders to Invoice, Invoices, Payment Verification, Payment Terms and the Aging Report. The Excel/CSV download follows the filter.
  - Orders to Invoice now lists every new order, with a "COD slip attached" marker.
  - Slips that arrived with an order show "Issue the invoice for SO-… first" with a one-click button.
- **Customer:**
  - **Purchase History** now starts with a single **Invoices** summary: every invoice to pay as a chip (number + amount), the total, and **one "Pay & upload slip" button**. It also shows which invoices are being verified and how many are paid. Beside it is a **To receive** card.
  - The Payments page preselects all outstanding invoices, so it's one transfer, one slip and one button.
- **Info menu:**
  - New **Suggested Selling Prices** page: wholesale vs suggested retail price for all 44 products, grouped by category.
  - Storage and heating notes and shelf life live only on the Storage Guide / Heating Guidelines pages.
  - Product cards are now just photo, name, price, minimum order and Add.
  - The Ordering Process page is rewritten for the new flow.
- **Clearer screens:** a 4-stage process legend: **New order (blue) → In production (teal) → Ready / Out (rose) → Received (green)**. The progress bars, kitchen pages ("1. Print sheet → 2. Start production"), Next-step boxes and dashboards were updated to match. The Statistics status chart also used the old Task 2 statuses; it's fixed too.
- **Mock data:** rebuilt for the new flow. COD history slips arrive with the order. Current examples include a COD order whose slip is waiting for its invoice, new orders not yet invoiced, and orders in production.

**Checks run**
- `npm test`: **27 of 27 pass**. New tests:
  - COD orders need a slip; 14-day orders don't.
  - Orders go straight to the kitchen; Finance is notified; the confirm endpoint is gone; the kitchen can start before the invoice.
  - A slip sent with the order is attached at invoicing and keeps the customer blocked until verified.
  - An unpaid COD invoice from a phone order blocks the customer.
  - Customers can cancel only until the kitchen starts.
  - An adjustment updates an unpaid invoice.
  - The aging download respects the customer filter.
  - All earlier security and pricing tests still pass.
- Production build and lint: no errors.
- **Browser walkthrough** of the full flow on all four portals passes every check, with no console errors and no horizontal scroll at phone width:
  - **Customer:** COD checkout requires the slip; there are no retail prices on cards; the order is placed straight to the kitchen.
  - **Admin:** has no confirm step and adjusts a short item.
  - **Finance:** types "little" to filter, sees the COD slip, issues the invoice, and verifies the slip.
  - **Customer:** Purchase History shows the one-box invoice summary.
  - **Kitchen:** prints and starts without waiting for the invoice.
  - **Admin:** dispatches and sends the link.
  - **Customer:** sees Suggested Selling Prices under Info and marks the order received.
- The demo database was reset afterwards.

**To confirm**
1. **COD + "slip still being verified":** a COD customer who just paid by slip can't place a *second* order until Finance verifies it (your earlier rule: an unverified slip counts as unpaid). With COD now paying upfront, do you want same-day repeat orders allowed while a slip is waiting?
2. **Cancellation:** customers can now cancel until the kitchen starts (there's no "Pending" stage any more). OK, or should online cancellation be removed?
3. **Quantity changes after invoicing:** an unpaid, system-generated invoice is updated automatically. A paid or uploaded invoice blocks the change, and Finance has to step in.
4. **COD invoice due date** is now the invoice date (because COD pays when ordering).
5. The open items from Tasks 3–5 are unchanged.

---

## 2026-11-11 · Task 5 — Clearer, more direct workflow screens

**Request:** Make the processes more direct and straightforward: cleaner visuals, direct instructions, and clearer colours to tell Pending, Confirmed and Processing apart.

**Result**
- **One colour per order stage, used everywhere** (badges, progress bar, coloured left edge on every list row, dashboard and kitchen cards):
  - Orders: **Pending = amber** · **Confirmed = blue** · **Invoiced = violet** · **Processing = teal** · **Ready for pickup / Out for delivery = rose** · **Received = green** · **Cancelled = grey**.
  - Payments: Unpaid = light red · Slip uploaded = amber · Paid = green · Rejected = solid red.
  - Every status still shows an icon and words, so nothing relies on colour alone. Defined once in `src/status.js`.
- **"Next step" box at the top of every order page**, saying what happens next, who does it, and the one button to press:
  - **Admin:** "Check the quantities, then confirm" with Confirm / Adjust. "Finance is issuing the invoice" (waiting). For delivery orders, "Book the driver, send the tracking link, then mark out for delivery", with the link box inside. "Customer reported a problem — resolve it".
  - **Customer:** "We're reviewing your order" (with Cancel), "Pay invoice INV-… — RM…, by …" with Pay & upload slip, "Collect your order on …", "Your order is on the way" with Track, then "Completed".
  - **Finance:** "Issue the invoice — RM…, due …" with the generate/upload choice and one button.
  - **Kitchen:** "Step 1 of 2 — print the production sheet" → "Step 2 of 2 — start production" → "In production".
- **Progress bar** shows who acts at each stage (Admin / Finance / Kitchen / Customer, or friendly wording for customers), with the current stage in its colour.
- **Fewer clicks:**
  - Admin: Confirm and Ready / Out-for-delivery buttons sit right on the order list rows.
  - Finance: Issue invoice is one click from the Orders to Invoice list.
  - Kitchen: "1. Print sheet" (opens the sheet and prints it) and "2. Start production" are on the list rows.
- **To-do cards** on the Admin, Finance and Kitchen home pages: a big number, what to do, one link. The process legend (stages 1 to 6 with counts and who acts next) doubles as a filter.
- **Admin order list** now opens on **open orders** (all orders one click away) instead of 125 rows.
- **Customer:**
  - Purchase History starts with **"Needs your action"** (pay, collect, confirm receipt).
  - Checkout is four numbered steps: Choose items → Pickup or delivery → Date & time → Check & place order.
  - The button shows the total, and a line says exactly what's missing if it can't be pressed yet.
  - Date rules sit behind "Why these dates?".
  - Announcements are one line each with "Read more", closures first.
  - Product cards use compact chips (Min. order · Retail · Keeps …).
- **Fixed along the way:**
  - The notification pop-up title was invisible (white on white).
  - The stage counts stretched into bars, and stages with zero orders showed no number.
  - Order numbers wrapped in tables.
  - Two kitchen to-do cards used the wrong colours.
  - The progress-bar labels collided on phones.

**Checks run:**
- `npm test`: 24 of 24 pass. The API is unchanged apart from a combined "Ready / Out" list filter and the kitchen list now showing the soonest orders first.
- Production build and lint: no errors.
- Browser walkthrough of the full flow across all four portals passes every check with no console errors. It now also covers the new wording, the kitchen's two-step box and the customer's "Needs your action" list.
- I reviewed screenshots of the main screens. The demo database was reset afterwards.

**To confirm**
1. **Colours:** are the stage colours right for your team? They are in one file (`src/status.js` + the `.tone-*` styles), so they're easy to change.
2. **One-click confirm from the list:** Admin can confirm a Pending order without opening it. Keep it, or require opening the order (to check quantities) first?
3. The open items from Task 4's "To confirm" list are unchanged.

---

## 2026-11-10 · Task 4 — B2B ordering workflow: payments, invoicing, delivery, central kitchen

**Request:** Build on Tasks 1–3 without breaking them:
- Add Finance and Central Kitchen roles; Central Kitchen must never see prices, invoices or payments.
- New order flow (Pending → Confirmed → Invoiced → Processing → Ready / Out for Delivery → Received), with payment status tracked separately.
- B2B customer portal: product images, no stock levels, announcements, info pages, pickup/delivery checkout with a delivery fee, cancel only while Pending, Mark as Received with discrepancy reporting, invoice and DO documents.
- Order timeline with a 1 PM cutoff and Mon–Fri processing.
- COD and 14-day payment terms, bank-transfer slips, and an unpaid-invoice order block.
- SST 6% shown everywhere totals appear.
- Admin quantity adjustment and delivery links; Finance and Kitchen portals; email with an outbox; file uploads; mock data; tests; a browser walkthrough.

**Decisions:** Proposed a plan with a "To confirm" list. The user approved it and said to follow Claude's recommendations, which means:
- **Order block:** COD customers are blocked by any unpaid invoice, including Slip Uploaded. 14-day customers are blocked only by an *overdue* invoice.
- **Strict flow:** the kitchen can plan Confirmed orders but can only start production once the order is invoiced.
- **Stock:** finished goods are made to order. Orders no longer check finished-goods stock or create automatic holds. The kitchen records production (which adds stock), and dispatch deducts it. Manual holds and adjustments are kept.
- **Due dates:** COD invoices fall due on the pickup/delivery date; 14-day invoices 14 days after issue.
- **Production date** = pickup/delivery date − 1. Closure dates are also skipped as working days.
- **Booking window:** customers can book up to 30 days ahead.
- **Cancelling:** Admin can cancel up to Invoiced, which voids the invoice.
- **Payments:** no partial payments. A discrepancy still marks the order Received and leaves an open issue for Admin.
- **Admin and money:** Admin sees invoice and payment status read-only.
- **Statistics:** revenue is the product subtotal before SST.
- **Email:** development emails go to the Outbox and the console only.

**Result**
- **Safety:** the project is now a git repository, with a baseline commit of Tasks 1–3 and a database backup in `backups/`.
- **Roles:** Admin, Finance (`finance@demo.test` / `finance123`), Central Kitchen (`kitchen@demo.test` / `kitchen123`) and Customer, each with its own portal and menu colour, all behind the same sign-in page.
- **Kitchen API, no money data:** kitchen data is built from a fixed list of allowed fields. Kitchen users are refused (403) on admin, finance, customer, invoice and slip endpoints. Kitchen notifications are written without amounts.
- **Order flow:** every status change records a history event and sends a bell notification (toast) to the right people, plus email where the task asked for it.
- **Customer portal:**
  - Product photos with an ivory and gold placeholder; no stock figures (only "currently unavailable").
  - Announcement banner (notices, closures, price changes).
  - Info pages: Ordering Process & Timeline (with the cutoff table), Storage Guide, Heating Guidelines. Per-product storage and heating notes are marked [PLACEHOLDER].
  - Checkout: pickup or delivery; delivery requires ticking a KL / Klang Valley confirmation. Only allowed dates are offered, with the reason shown. Time slots.
  - Totals: Subtotal / Delivery (RM25 or FREE, with "add RMxx more for free delivery") / SST 6% / Total.
  - Bank details on checkout, the payments page and invoices.
  - Order block message listing the outstanding INV numbers and amounts, with an upload link.
  - Cancel only while Pending (button hidden, and the API refuses it after confirmation).
  - Mark as Received with a "matches DO" tick, or a discrepancy report (item, quantity, note, optional photo).
  - Invoice and DO downloads; payment slip upload covering one or more invoices.
  - Account page with the "Request 14-day Credit Term" button after 2 months.
- **Order timeline:** 1 PM MYT cutoff; Mon–Fri processing; earliest date = processing day + 2. Closures from announcements are blocked. Every row of the table is implemented and tested.
- **Admin:**
  - Orders to Confirm; quantity adjustment with a reason, change history, recalculated delivery fee and SST, and an email showing original vs adjusted.
  - Confirm, dispatch (Ready for Pickup / Out for Delivery), GoGet / Lalamove links (in-app notice and email).
  - Discrepancies page, Announcements (create / edit / expire / delete, closure dates), Product Images (upload, plus an "available to order" switch), Email Outbox with a preview.
  - Dashboard updated for the new flow.
- **Finance:**
  - Dashboard; Orders to Invoice → INV-YYYY-#### and DO-YYYY-####, either a generated branded PDF or an uploaded soft copy.
  - Invoices list; Payment Verification with the slip shown beside the invoice, Mark as Paid / Reject with a reason.
  - Payment Terms (customer list with term, account age, outstanding and overdue amounts, plus approve/reject requests and manual changes).
  - Aging Report by customer and bucket, downloadable as Excel or CSV.
- **Central Kitchen:**
  - Orders (Confirmed and later, no prices); a printable PO / production sheet, where printing unlocks "Mark as Processing".
  - Production Plan (total per product per production date, with quantities still awaiting release shown separately).
  - Production Records (finished goods produced, ingredients used, both linked to stock).
  - Summary Report, downloadable as Excel or PDF.
- **Email:** Nodemailer with settings in `.env` (`EMAIL_MODE=log` by default). Branded white, ivory and soft-gold templates for: quantity adjusted, order confirmed, invoice issued, payment verified / rejected, delivery link, and credit-term result.
- **Files:** stored in `server/uploads/`. JPG, PNG, WEBP or PDF only, max 10 MB, and the file contents are checked against the type. Customers can only open their own files.
- **SST settings:** SST 6%, the RM25 fee, the RM500 threshold, the cutoff, bank details, pickup address and time slots are stored in the `settings` table.
- **Mock data:** 6 months of history simulated with the real timeline rules, plus at least one order in every status. Five customers, each in a different payment situation. Paid, Slip Uploaded, Unpaid, Rejected and overdue invoices; a slip that covers two invoices; Pending, Approved and Rejected term requests; adjusted orders; open and resolved discrepancies; 4 announcements; ~30 logged emails.

**Checks run**
- `npm test`: **24 of 24 pass**. They cover:
  - Kitchen responses contain no price, invoice or payment keys or text, and kitchen users get 403 on other areas.
  - Ordering is blocked by an unpaid or Slip Uploaded invoice and unblocked after verification; a rejected slip keeps the customer blocked.
  - Cancel is refused once confirmed.
  - Delivery fee is RM25 below RM500 and free at exactly RM500.
  - SST is 6% on subtotal + fee, correct to 2 decimals.
  - Every row of the timeline table, including Fri → Sun/Mon/Tue and Fri after 1 PM / weekend → Wed, plus closures.
  - The credit-term request is only available after 2 months.
  - Customers can't reach each other's orders, invoices or files.
  - Upload limits are enforced.
  - The full flow works through the API.
  - Notifications go to the right roles.
  - The Excel, CSV and PDF downloads work.
- **Regression:** Task 1–3 features still work: purchasing (receiving a PO adds stock), stock adjustments and holds, statistics, products and catalog re-import, adding customers.
- **Browser walkthrough** (headless Chrome, all four portals, real Sign out between users, no console errors):
  - Customer places an order (banner, placeholders, fee hint, SST and date rules all shown) → Admin adjusts and confirms → the Cancel button disappears.
  - Finance issues the invoice → the customer is blocked, uploads a slip, and stays blocked → Finance marks it Paid.
  - Kitchen sees no prices, prints and marks Processing, then records production → Admin marks Out for Delivery and adds a Lalamove link.
  - Customer sees the link and the documents and marks the order Received. No horizontal scrolling at phone width.
- **Fixed during the checks:**
  - The progress step labels overlapped on phones.
  - Accented letters (é) dropped from mock slip PDFs.
  - A test false positive on the kitchen field `total_qty` (renamed `units`).

**Notes**
- The browser walkthrough uses `puppeteer-core`, installed in a temporary folder outside the project, not as a project dependency.
- Task 4 changes have **not been committed** to git; only the Task 1–3 baseline is. The demo database was rebuilt (old one in `backups/erp-before-task4.db`).

**To confirm**
1. **Order block for 14-day customers.** I followed the recommendation: they are blocked only by *overdue* invoices. Your brief said *any* unpaid invoice. Switching is a one-line change in `blockingInvoices` (`server/sales.js`).
2. **Pickup outlet address and time slots, delivery time slots, company address, company registration no. and SST registration no.** These are all [PLACEHOLDER] in settings and appear on invoices and in checkout.
3. **Storage and heating notes** for all 44 products, and the general text on the Storage Guide and Heating Guidelines pages ([PLACEHOLDER]).
4. **Product photos:** none yet; placeholders are shown. Upload them in Admin → Product Images or via `catalog.json`.
5. **Real SMTP details** to switch `EMAIL_MODE=smtp`. Which sender address should customers see?
6. **SST on the invoice:** the layout is a "Tax Invoice" with SST 6% on goods + delivery, as you specified. Please confirm with your accountant that 6% (rather than another rate) applies to bakery goods and delivery.
7. **COD due date** = pickup/delivery date, and **14-day** = invoice date + 14 days.
8. **Production date** = the day before pickup/delivery. Does the kitchen also bake on Saturdays (needed for Sunday orders)?
9. **Customers can book up to 30 days ahead**, and **pickup/delivery is allowed on Saturdays and Sundays** (as the timeline table implies).
10. **No partial payments.** A verified slip marks all its invoices fully paid.
11. **Finished-goods stock** is now driven by kitchen production records, and dispatch is refused if production wasn't recorded. Is that strict enough, or too strict for daily use?
12. **Remaining Task 3 items:** the 21 generated SKUs and the MOQ = 1 assumptions.

---

## 2026-11-10 · Task 3 — Imported the wholesale catalog

**Request:** Study `catalog/Wholesale CATALOG.pdf` and insert its data into the system.

**Result:** All 44 catalog products are in the system. Every product's name, price and MOQ was checked against the catalog data and matches.

| Category | Items | Wholesale price (before SST) |
|---|---|---|
| Viennoiserie (VIN) | 13 | RM 3.00 – 8.00 |
| Sandwiches (SND) | 3 | RM 11.00 – 12.00 |
| Petit Gâteau (PTG) | 7 | RM 11.00 – 110.00 |
| Whole Cakes (FULLC) | 5 | RM 99.00 – 165.00 |
| Sourdough | 4 | RM 9.00 – 10.00 |
| Bagels & Breads | 12 | RM 3.00 – 10.00 |

**What changed**
- New product fields: size, MOQ, recommended RSP, shelf life. They're shown on customer product cards.
- MOQ is enforced when an order is placed (e.g. ordering 2 croissants is refused because the minimum is 5).
- The currency is now RM, labelled "excl. SST".
- The Lescure butter note is shown on the Viennoiserie category.
- Earlier sample items (flour, butter, boxes) became ingredients and packaging: bought via purchase orders, never shown to customers.
- The database was rebuilt so the mock order history uses the real catalog products. Customers and orders are still fictional.
- The catalog's source of truth is `server/data/catalog.json`. To update it, edit the file and run `npm run import:catalog` (or use Admin → Products → **Re-import catalog**). Import matches on SKU and never changes stock levels.

**To confirm: values that were assumed, not taken from the PDF (24 products flagged in catalog.json)**
1. 21 SKUs were generated for whole cakes, sourdough and bagels/breads, e.g. `C-TIR-001`, `S-BWS-001`, `B-OBG-001`.
2. MOQ was set to 1 for 3 sandwiches and 4 sourdoughs (none stated).
3. Page 4 categories were named "Sourdough" (`SDG`) and "Bagels & Breads" (`BRD`).
4. Spelling was corrected: "Matche" → "Matcha", "fozen" → "frozen".
5. SST is not calculated yet. The rate is needed.

**Not imported:** product photos (they aren't labelled in the PDF), and real stock quantities and reorder levels (current numbers are placeholders).

**Checks run:** 44 of 44 products match the catalog data. No stock balance goes negative, no mock order line is below MOQ, and customers can't see or order ingredients. Re-running the import updated all 44 products and added no duplicates.

---

## 2026-11-10 · Task 2 — Customer & admin portals with login

**Request:** A system with a customer portal and an admin portal, each user with their own login, filled with mock data.
- Customer: stock purchase, purchase history, delivery status.
- Admin: dashboard, sales, statistics, add new customer, stock tracking / adjustment / on hold, notifications.

**Result**
- **Login:** one sign-in page sends each user to their own portal. Passwords are stored hashed. Customers can't open admin pages, and each customer sees only their own orders.
- **Customer portal** (`/portal`):
  - **Stock Purchase:** catalog with live available quantities, a cart, and checkout.
  - **Purchase History:** order list and order detail, cancel while Pending, and "Buy again".
  - **Delivery Status:** progress stepper with carrier and tracking number.
- **Admin portal** (`/admin`):
  - **Dashboard:** KPIs, fulfilment pipeline, recent orders, stock alerts.
  - **Sales:** order list, order detail with the Confirm → Packed → Shipped → Delivered steps (shipping records carrier and tracking), New Sale form.
  - **Customers:** customer list, plus **Add New Customer**, which creates the customer record and their portal login in one step.
  - **Stock:** Stock Tracking (on hand / on hold / available), Stock Adjustment (reason required), Stock on Hold (manual holds and release), Stock Movements log.
  - **Statistics:** revenue and orders per month, top products, top customers, orders by status. Each chart has a table view.
  - **Purchasing:** the module from Task 1 is now under Admin. Receiving a PO adds stock.
- **Notifications:** a bell with unread count, a pop-up toast when something new arrives, and a full notifications page. Admins are notified of new orders, low stock and new customers. Customers are notified of each status change on their orders.
- **Stock rules:** available = on hand − on hold. Placing an order puts the stock on hold, shipping deducts it from on hand, and cancelling releases the hold.
- **Mock data:** 2 admins, 4 customers, about 6 months of orders, purchase orders, holds and notifications.

**Demo logins:** `admin@demo.test` / `admin123` · `staff@demo.test` / `staff123` · `harbor@`, `maple@`, `cafe@`, `littleoven@demo.test` / `customer123`

**Checks run:** API smoke tests passed: login and role access, order → hold → ship → stock deducted, customers isolated from each other's orders, validation errors, new customer can log in, and PO receipt adds stock. The production build succeeds. The chart color was checked with the palette validator and passed.
**Not verified:** pages were not checked in a browser (the headless-Chrome screenshot step was declined).

---

## 2026-11-10 · Task 1 — ERP prototype with purchase orders

**Request:** A prototype web portal using SQLite, React and Vite, where users can create purchase orders, with a menu bar, as the base for an ERP. Install Node.js if missing.

**Result**
- Node.js wasn't installed. Installed Node.js v22 LTS (npm 10) via Homebrew.
- Stack: React + Vite frontend, Express API, SQLite database (`server/erp.db`).
- Top menu bar with dropdowns, built from one list so new ERP modules are easy to add. Unbuilt modules show a "soon" placeholder.
- Purchase orders: create with supplier, dates, tax and line items. Totals update live. PO numbers are generated automatically (`PO-YYYY-0001`).
- PO approval steps: Draft → Submitted → Approved → Received, and Cancel is allowed before Received. Only drafts can be edited or deleted.
- PO list with search and status filter, a printable detail page, and supplier and product pages.

**Checks run:** API tested end to end (create, view, status changes, invalid changes rejected, validation). The production build succeeds.

---

**How to run:** `cd ~/Documents/testing-project && npm run dev` → http://localhost:5173
