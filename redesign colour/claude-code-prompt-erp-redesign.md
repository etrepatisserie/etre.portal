# MASTER PROMPT: ÊTRE PATISSERIE ERP — UI/UX REDESIGN

Act as a Senior Product Designer, UI/UX Architect and Frontend Engineer specialising in premium enterprise SaaS platforms.

Run a full UI/UX redesign of my existing ERP system in this project (`~/Documents/testing-project`). It is a B2B wholesale ordering and ERP portal for Être Patisserie, which has two outlets (KL and Ipoh) run as two separate companies. Stack: React + Vite frontend, Express API, SQLite database. `WORKLOG.md` (or the work log in the project) records every feature built so far. Read it first.

## 1. Overall Design Direction

Turn the current interface into a sophisticated, premium, modern enterprise management platform.

Draw inspiration from:
- **Linear:** clean layouts, excellent spacing and intuitive navigation.
- **Stripe:** professional dashboard design, typography and data presentation.
- **Notion:** structured information hierarchy and simplicity.
- **Apple:** minimalist aesthetics, attention to detail and consistency.

The system should look like a professionally developed commercial product, not a generic admin dashboard.

## 2. Design Philosophy

- Clean, minimal and sophisticated.
- Easy to scan; complex business information made easy to digest.
- No unnecessary visual clutter. Usability comes before decoration.
- Consistent spacing, alignment and components, with a strong visual hierarchy.
- Cohesive across every portal and module.

## 3. Colour System

Define these as design tokens (CSS variables) in one place:

- Primary background: soft off-white `#F8F9FB`
- Main content background: white `#FFFFFF`
- Primary text: deep charcoal `#20242C`
- Secondary text: muted grey `#737B89`
- Borders and dividers: light grey `#E8EBF0`
- Primary accent: deep navy `#263B5A`
- Secondary accent: muted blue `#5478A5`

Semantic colours, used consistently:
- **Green:** successful, completed, approved, paid.
- **Amber:** pending, warning, requires attention.
- **Red:** failed, rejected, overdue, critical.
- **Blue:** informational, in progress.
- **Grey:** cancelled, inactive.

**Status colours.** Replace the current stage colours in `src/status.js` and the `.tone-*` styles with this mapping. Keep them defined in that one place:
- Orders: New order = amber · In production = blue · Ready for pickup / Out for delivery = muted navy (`#5478A5` tint) · Received = green · Cancelled = grey · Late — not dispatched = red
- Invoices / payments: Unpaid = amber · Slip uploaded (being verified) = blue · Paid = green · Rejected = red · Overdue = red
- Credit notes: To issue = amber · Issued = green · Declined = grey
- Supplier bills: To record = amber · Unpaid = blue · Overdue = red · Paid = green

Every status must still show an icon and a word, so nothing relies on colour alone. Charts must keep passing the existing colour-blind and contrast checks (the palette validator and `--series-*` tokens). Update the chart series colours to fit the new palette and re-run the validator.

Avoid heavy gradients, bright colours, heavy shadows and decorative elements.

## 4. Typography

Use Inter (or Manrope / Plus Jakarta Sans), with this hierarchy:
- Page title: 24–28px, semibold
- Section title: 16–18px, semibold
- Card title: 14–16px, medium
- Body text: 13–14px
- Supporting information: 12px
- Table headers: 12px, medium
- Important figures: 24–32px, semibold

Use tabular numbers for figures. Write currency as `RM 1,234.56`, and write dates in one consistent format across the whole app (e.g. `12 Nov 2026`).

## 5. Layout & Navigation

### Sidebar (replaces the current top menu bar)
- A clean left sidebar with minimalist, consistent icons. Clearly highlight the active page and use collapsible groups.
- Show the Être Patisserie logo and app name.
- **Show only the menu items for the signed-in role.** Build the menu from one list, as now, so new modules are easy to add.
- On phones, collapse it into a slide-out menu.

### Top bar
- Breadcrumbs, global search where it makes sense, the notification bell (keep the unread count and pop-up toasts), and the user menu.
- **Head office Admin:** the KL / Ipoh / Both outlet switch stays in the top bar.
- **Finance:** the KL / Ipoh / Both company tabs stay at the top of every finance page.
- Keep it compact.

### Main content
Use consistent margins and spacing, aligned cards and tables, and balanced pages with no oversized empty areas. Layouts must be responsive: **nothing may scroll sideways at phone width.**

## 6. The Four Portals

The system has four separate portals behind one sign-in page. Apply the same design language to all of them, but respect their differences:

1. **Customer portal** (B2B cafés, hotels, restaurants). This is customer-facing, so keep it simple and calm, not enterprise-heavy. Focus on ordering, paying and tracking. Keep the 4-step checkout, the "Needs your action" list, the single "Pay & upload slip" button and the Info pages.
2. **Admin portal** (outlet admin and head office).
3. **Finance portal** (one login for both companies).
4. **Central Kitchen portal.** **It must never show prices, invoices, payments or any money amounts**, including on dashboards, KPI cards, charts, tooltips and notifications. Do not add revenue or money KPI cards to the kitchen. Kitchen data comes from a fixed list of allowed fields on the API, so do not change the API to add fields. The existing tests check this and must keep passing.

## 7. Modules to Redesign

Apply the design system to these existing modules only. **Do not create HR, Payroll or any other module that doesn't exist.**

- **Customer:** Shop, Checkout, Purchase History, Order detail, Payments, Account, Info (Ordering Process & Timeline, Storage Guide, Heating Guidelines, Suggested Selling Prices)
- **Admin:**
  - Dashboard
  - Sales Orders (Open / To dispatch today / Yet to dispatch / All / Cancelled)
  - New Sale, Dispatch, Complaints (credit note or replacement)
  - Customers, Announcements, Products & Images
  - Stock (tracking, adjustments, holds, movements), Purchasing (POs, suppliers)
  - Email Outbox, Notifications
- **Finance:**
  - Dashboard, Orders to Invoice, Invoices, Payment Verification
  - Credit Notes, Payment Terms, Payables (supplier bills)
  - Reports: Aging, Monthly Report, Statistics (graphs), Cash Conversion Cycle
- **Central Kitchen:** Orders, Production Plan, Production Records, Summary Report
- **Settings**

## 8. Dashboards & Data Presentation

Dashboards should show useful, actionable information, not decoration.

- **Keep the to-do cards:** a big number, what to do, and one link. They are the core of every dashboard (e.g. To dispatch today, Yet to dispatch, Customer complaints, Orders to invoice, Slips to verify, Credit notes to issue, Supplier bills to record or overdue, Low stock).
- **KPI cards:** a clear title, a large figure, and a comparison with the previous period where relevant, with a subtle trend indicator. Don't put too many metrics on one screen. Money KPIs appear only on Admin and Finance.
- **KL and Ipoh figures are never added together.** In "Both", each company keeps its own section or column. Keep this rule exactly as it is.
- **Keep every chart's Chart / Table toggle and hover tooltip.** Months with no data show "No data", not RM 0, and the current month is labelled "month to date". Missing data shows "Not enough data", not 0.

## 9. Keep the Existing Workflow UX

These are core to how the team works. Restyle them, but do not remove them:
- **The "Next step" box** at the top of every order page: what happens next, who does it, and the one button to press.
- **The order progress bar** showing who acts at each stage.
- **Quick-action buttons on list rows:** Kitchen "1. Print sheet" / "2. Start production", Finance "Issue invoice", Admin dispatch.
- **The type-or-pick customer filter** on Finance lists, and downloads that follow the filter.
- **The process legend** that doubles as a status filter.

## 10. Tables

- Clear column hierarchy, comfortable row spacing, readable sizes, subtle row dividers and hover states.
- Status badges, search, filtering, sorting and pagination where lists are long.
- Clear, helpful empty states.
- **Right-align money and quantities**, with consistent RM and date formatting.
- No heavy borders and nothing cramped. Tables stay usable with lots of rows and on phones (use horizontal scroll inside the table container or stacked rows, never page-level sideways scroll).

## 11. Forms & Data Entry

- Clean, consistent inputs, related fields grouped, clear labels, helpful placeholders, and required vs optional marked.
- Clear validation errors next to the field.
- Consistent dropdowns and date pickers. The checkout date picker must still offer only allowed dates, with the "Why these dates?" explanation.
- Long forms split into sections. Primary and secondary actions look clearly different.

## 12. Components

Build one reusable set and use it everywhere: primary, secondary and destructive buttons; dropdowns; modals; confirmation dialogs; cards; tabs; tooltips; status badges; toasts and notifications; inputs.

- Consistent heights, padding and interaction states.
- Border radius around 8–12px, not playful.

## 13. Interaction

- Loading states and skeletons where they help. Success and error toasts after every action.
- Confirmation before destructive actions (cancel order, void, decline, delete, reject slip).
- Consistent hover and focus states, keyboard accessibility and visible focus rings.
- Fewer clicks: keep frequent actions within one click.

## 14. PDF Documents & Email Templates

Redesign these to match the new design system.

### PDF documents
Covers: tax invoices, delivery orders (DO), credit notes, the kitchen production sheet / PO, Kitchen Summary Report PDF.
- Clean, premium layout: logo, clear document title and number, generous spacing, and the Inter typeface (embed it so it prints correctly). Navy is used only as a subtle accent.
- **Print-friendly:** A4, readable in black and white, no dark backgrounds, sensible margins, and repeated table headers on multi-page documents.
- **Use the issuing outlet's own company details:** company name, registration no., SST no., address and bank account (KL or Ipoh). Keep the per-outlet numbering (INV-KL / INV-IPH, DO-, CN-).
- **Keep every legal and financial detail exactly as it is now:**
  - "Tax Invoice" title, Bill to with the customer's registration no. and billing address, delivery address, invoice and due dates, and payment term.
  - Line items with SKU, quantity, unit price and amount (right-aligned), then Subtotal / Delivery / SST 6% / Total.
  - Credit notes show the invoice they credit, the reason, the items and the amount with SST.
  - Bank details for payment.
- **The DO and the kitchen production sheet must show no prices or money amounts.**
- Accented letters (é in "Être") must render correctly.
- Leave the existing mock slip PDFs and their "MOCK … not a real transaction" marking as they are.

### Email templates
Covers: quantity adjusted (original vs adjusted), invoice issued, payment verified, payment rejected (with reason), delivery / tracking link, credit-term result, credit note issued, and any other email that exists.
- Same design language: logo header, clean white layout, navy accent, a clear headline, a short message, one primary button (e.g. "View order", "Pay invoice", "Track delivery"), and a simple footer with the outlet's company details.
- **Built for email clients:** inline styles and table-based layout, a system font fallback after Inter, about 600px wide, mobile-friendly, and readable without images. Include a plain-text version.
- Use the issuing outlet's company name and details.
- Keep every email's content and trigger exactly as it is now. Only the design changes.
- Check each one in the Email Outbox preview.

## 15. Technical Rules — Read Before Changing Anything

Before making changes:
1. Read the work log and inspect the whole codebase.
2. Identify the styling approach, component structure, routing and page structure.
3. List the reusable components that already exist (e.g. `components/charts.jsx`, `src/status.js`).
4. Understand how pages call the API.
5. List the current design inconsistencies and usability problems.

**Preserve all of these:**
- All business logic, database schemas, API endpoints and their responses.
- Authentication, roles and permissions, including outlet restrictions (outlet staff see only their outlet) and the kitchen's no-money rule.
- Every existing workflow and feature: order flow, COD slips, credit notes, replacements, payables, reports, downloads (Excel / CSV / PDF), emails and notifications.
- **Existing data, including the existing sample (MOCK-) data. Keep it exactly as it is and do not add any new mock data.**

**Also:**
- Do not remove or disable any functionality to make the design cleaner. This is a frontend restyle; avoid backend changes unless a page truly needs one, and tell me first if it does.
- Use git: commit before you start and after each phase, so any phase can be rolled back.

## 16. Implementation Approach

Work in phases, and check each one before moving on:

1. **Audit:** the current UI/UX problems, by portal.
2. **Design system:** tokens (colours, status colours, typography, spacing, radius, shadows) and the core components.
3. **App shell:** sidebar, top bar, outlet switch and company tabs, mobile menu, sign-in page.
4. **Dashboards:** Admin, Finance, Kitchen, and the customer home page.
5. **All modules:** apply the system page by page (lists, detail pages, forms, reports).
6. **Documents and emails:** redesign the PDFs and email templates. Generate a sample of each PDF for both KL and Ipoh, and preview every email in the Outbox. Compare the figures against the old versions so no amount, SST or detail has changed.
7. **Review:** responsiveness (phone width, no sideways scroll), accessibility, colour-blind checks on charts, and console errors.
8. **Regression:** run `npm test` (all tests must pass), the build and lint. Then do a browser walkthrough of the full flow on all four portals, on a **separate temporary database**, never the live one: customer orders → Finance invoices and verifies → Kitchen prints and produces (no money visible) → Admin dispatches → customer receives. Also check a complaint → credit note and the KL / Ipoh / Both switching.

Do not attempt a risky, unreviewed rewrite of the whole app. Make changes step by step.

Then update the work log with what changed, what was checked and anything to confirm.

## 17. Expected Outcome

A premium, professionally designed platform that is visually sophisticated, easy to navigate, highly readable, consistent across all four portals and every document and email, efficient for daily operations and scalable as the ERP grows.

**First, finish the audit (Phase 1) and present your proposed design direction and implementation plan. Wait for my approval before changing the codebase.**
