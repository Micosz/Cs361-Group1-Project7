# Stakeholder doughnut and Feedback Inbox summary — design QA

final result: passed

Reviewed on 2026-10-31. Local frontend review with fixture data; no deployment or production API integration claim.

## Visual evidence

- Selected image #4, without percentages: `docs/design/stakeholder-review/selected-design.jpg` (1680 × 936 px, JPEG conversion of the selected generated PNG without resizing).
- Desktop implementation: `docs/design/stakeholder-review/desktop.png` (1680 × 936 px, matching CSS viewport, DPR 1).
- Mobile implementation: `docs/design/stakeholder-review/mobile.png` (390 × 1100 px, matching CSS viewport, DPR 1); width also checked at 390 × 844.
- Feedback Inbox: `docs/design/stakeholder-review/feedback.png` (1280 × 720 px, matching actual CSS viewport, DPR 1). A requested 1224px laptop viewport resolved to 1280px in the browser; the report uses the observed size.
- State: executive Stakeholder tab, company 9 / university 6 / government 3 / research institute 2, total 20. These are local fixtures matching the mockup. Shipped code reads the existing protected API.
- Reference and revised desktop/mobile captures were opened together in one comparison input. The desktop panel width is 1592px in both reference and implementation. Compare panel content; tabs retain the existing product sizing rather than the oversized mockup tabs. No density scaling was needed.
- Full-resolution views make header, count cells, icons, chart center and Thai copy readable, so a separate crop was not necessary. Mobile is an adaptation of the desktop source, not a supplied mobile mockup.

## Findings and comparison history

1. Initial comparison found table separators inheriting cell borders (P2); removed those borders so the intended pale row dividers govern. The temporary component-only harness also put tabs below the panel; corrected only the harness's layout to reflect their normal position above the content.
2. Full-page capture produced corrupted narrow strips during browser viewport resizing. Rejected those captures and used stable viewport screenshots instead; this was a capture problem, not accepted as product evidence.
3. Reopened the reference alongside final desktop/mobile screenshots after these fixes. No actionable P0/P1/P2 findings remain. Header, total, table order, category colors, counts and doughnut match the selected direction; no percentages or percentage column appear.

## Required fidelity surfaces

- **Typography:** existing Noto Sans Thai / Leelawadee UI / system stack; large totals, strong category names, legible secondary units. Kept current product tab text sizes. Minor glyph-weight differences from generated imagery are accepted.
- **Spacing/layout:** crimson header above table-left/chart-right content; proportional chart and generous row spacing. At narrow widths the total moves to its own row and chart follows the table; no horizontal overflow at 1680, 1280 or 390px. Long names wrap rather than clip.
- **Colors:** crimson, gold, purple and blue categories; count and type labels convey meaning without relying solely on color. Uses the existing crimson/gold orbit art. Solid Chart.js segment colors intentionally avoid recreating the mockup's raster lighting effects.
- **Assets:** reuses `overview-orbit.webp` from the earlier summary; no extra production raster/dependency. Font Awesome icons match the categories; minor solid-versus-outline icon differences are P3 polish. Real Chart.js doughnut, not a rasterized chart. Header text remains editable UI.
- **Copy/content:** only type/count table columns, counts in chart center, no percentages. Overview Feedback pane removed; the existing Summary headline metric and CSV data remain. Inbox summary reads the same permission-scoped rows as its list, with filtered wording when any inbox filter is active.

## Functional checks

- Stakeholder university filter: total/table/chart update to 6; reset restores 20. Summary → Stakeholder navigation works with recreated charts.
- Empty Stakeholder result: total 0, neutral ring, explicit no-results copy.
- Inbox fixture paginated into two pages: loaded total 8 / improvement count 4. Student filter gives 4 / 2; additional keyword gives 1 / 1. Whitespace-only improvement values do not count.
- Inbox loading/failure: summary hidden; failed request shows the existing error message, without misleading zero totals.
- Fresh final overview and inbox browser tabs: no console errors/warnings. Earlier syntax errors were limited to the temporary fixture harness and corrected before review.
- Chart lifetime/cancellation and reduced-motion handling retained in shared helper. Text table/legends remain readable when a chart is unavailable. Reduced-motion behavior reviewed in code, not separately emulated in browser.
- Existing checks: `node --test tests/overview.test.cjs tests/feedback-inbox.test.cjs` — 6 passed. Updated existing tab/child-order expectations only; no new automated test files.
- Both changed JS files pass `node --check`. `npm run build` passes but only checks that login HTML exists. `git diff --check` passes.

## Open questions and limits

No blocking design questions. AWS production, all browser engines and physical mobile devices were not tested. Unknown categories use a neutral icon/color; existing permission checks and backend are unchanged. No extra summary API request or new chart library is introduced.

## Implementation checklist

- [x] Match selected Stakeholder composition without percentages.
- [x] Move the Feedback summary line to the existing inbox and remove overview Feedback tab.
- [x] Preserve latest respondent/channel filters from main.
- [x] Inspect desktop/mobile rendering and representative interactions.
- [x] Bump CSS/JS asset query versions.
- [x] Keep prior QA reports below; new branch/PR awaits teammate review, without merge or deployment.

## Follow-up polish

Optional closer outline icons if the project later adopts a suitable icon family. No change is necessary for the selected flow.

---

## Historical reviews

The reports below describe their earlier snapshots. Their old Feedback-tab references are superseded by this change; earlier checks were not all repeated.

# Cooperation overview design QA

final result: passed

Reviewed on 2026-10-31. This is a local frontend review using fixture data, not a production deployment or an AWS/API integration test.

## Visual evidence

- Source visual truth: `docs/design/overview-review/selected-design.jpg` (2111 × 745 px), converted from the selected generated PNG without resizing.
- Implementation: `docs/design/overview-review/desktop.jpg` (1531 × 740 px; CSS viewport 1531 × 740).
- Mobile: `docs/design/overview-review/mobile.jpg` (390 × 1537 px full page; CSS viewport 390 × 844).
- Additional laptop check: CSS viewport 1224 × 768.
- Browser screenshots are 1 output pixel per CSS pixel. The source is a standalone component mockup; compare its component bounds with the implementation's summary/panels, excluding the existing outer container and local-fixture note. The component is approximately 1454 × 532 CSS px in the desktop capture. The source and implementation were opened together in the same comparison input; no pixel-perfect claim is made across these different sizes.
- State: executive summary with Stakeholders 20, Activities 17, Agreements 13, Exchanges 5, Feedback 8. Agreements: 8 active, 3 draft, 1 expired, 1 terminated. Exchanges: 2 ongoing, 1 completed, 1 draft, 1 cancelled. These are local fixture counts matching the selected mockup; production continues to read the protected `/overview` API.

## Comparison history

1. Initial review identified excessive legend-row height, the exchange center label crossing the ring, and the Feedback count overlapping the decorative glow (P2). Reduced count line height, split the ring label into two lines, and reserved space at the right of the desktop summary. Changed document/calendar/comment icons to regular Font Awesome variants.
2. Responsive review found the gold glow behind the agreement count on mobile (P2). Reduced decorative-image opacity only below a 700px component width. The revised mobile capture confirms readable numbers and no horizontal overflow.
3. Final comparison opened the selected source and revised desktop capture together. Both charts, status values, hierarchy and layout are intact. No remaining actionable P0/P1/P2 visual findings. The full component images made the labels, counts, icons and ring centers readable; no additional focused crop was necessary.

## Required fidelity surfaces

- **Typography:** retains the site's existing Noto Sans Thai/font stack; clear white summary labels, prominent totals and readable Thai line breaks. The generated mockup has slightly different glyph shapes/weights, an accepted consequence of using the existing site font.
- **Spacing/layout:** paired metric columns over two panels (1.4:1 desktop ratio); headings and charts reflow at container breakpoints. Mobile stacks panels and puts each chart above its legend. Existing filters/header remain in their established layout.
- **Colors:** crimson/gold summary; green/yellow/pink/muted agreement statuses and blue/green/yellow/gray exchange statuses. Numbers and text accompany every color.
- **Image/assets:** a generated 14.4 KiB WebP orbit background provides the decoration. Font Awesome supplies UI icons. Actual Chart.js doughnuts render dynamic data. Minor orbital-line differences from the mockup are accepted; the image is decorative and contains no baked-in text.
- **Copy/content:** all five selected metrics are present for executive, with both status lists and totals. The unused Outcomes metric/tab and its CSV summary row are removed. Staff retains its existing role-specific tabs/metrics. No record-level outcome fields or backend storage were changed.

## Functional checks

- Filter by ongoing status: summary and charts updated to zero agreements and two exchanges; reset restored the original fixture values.
- Feedback tab remained usable; summary returns with newly created charts. Charts are destroyed when switching panes or disposing the overview.
- Empty agreement status renders a neutral ring, total 0 and an explanatory message.
- Simulated API failure renders the existing error message and disables CSV export.
- Staff fixture shows Summary/Feedback tabs, without the executive-only Stakeholder tab or Feedback headline metric.
- DOM width equalled viewport width at 1531, 1224 and 390 CSS px.
- Fresh browser console after the final changes: no errors/warnings. Earlier fixture syntax errors were fixed in the temporary local harness, which is not shipped.
- `node --check public/assets/overview.js`: passed.
- Existing `node --test tests/overview.test.cjs`: 3 passed; only existing expectations were updated. No new automated test files.
- `npm run build`: passed; this repository's command only checks the login HTML exists, so it is not a full integration check.
- `git diff --check`: passed.

## Motion, loading and limits

- Brief entrance/chart motion and a slow 4.5-second decorative drift; reduced-motion preference disables these animations by implementation. No perpetual background loop.
- Chart.js is self-hosted and loaded on demand for the summary. Text totals/legends remain available if the chart library fails.
- Browser checks used local fixture responses. Real authenticated data, physical mobile devices, all browser engines, and production CSV export were not re-tested. AWS deployment was intentionally omitted at the user's request; the PR awaits teammate review.

---

## Previous review: form feedback import

Preserved below from the base commit; its checks were performed in that earlier change, not repeated for this overview PR.

# Form feedback import — design QA

Reference: option 1 selected in the design discussion for #205 (split detail modal, horizontal form rows, expandable respondent answers).

**Result: passed for the local review scope; production deployment not tested.**

- Preserved the existing identity sidebar, orbit background, modal size and close control. Added a third tab; existing Details/Comments ordering remains unchanged.
- Used restrained rounded form rows, a red import action, import date/category/count, delete action and separate respondent blocks. Blank answers are omitted; four- and five-question fixtures render dynamically.
- Compared the reference and the rendered modal together. Deliberate differences: lightweight row borders, provenance line, preview controls and explicit source timestamps.
- Browser: real `public/index.html` with a temporary local API using synthetic records and the real permission/Dynamo adapter with existing local doubles. Activity and partner tab mounting, accordion, import cancellation and keyboard tab navigation checked.
- Browser file chooser: `.xlsx` → select columns → preview → save → expand confirmed; CSV containing the same selected answers rejected as duplicate. Thai text, multiline answers and blank-cell omission verified. Fixed Thai email-header exclusion during this check.
- Responsive: desktop 1224×707, narrow view and mobile 390×844 checked. Mobile document width stayed 390 px and dialog width 366 px; tabs scroll within the toolbar and close control remains separate.
- Existing checks after rebasing onto main `949bb25`: 58 backend checks and 11 frontend checks passed. Temporary import checks covered all three parent types, student/unassigned denial, exact response round-trip, retries, duplicate imports, stale-version deletion, concurrent reassignment and size rejection. No test files added to the repository.
- Source-only Lambda package built successfully. No AWS resources changed, no Google connection, no production data imported. Actual deployed API/WAF limits and both deployment statuses need a smoke check after merge.
