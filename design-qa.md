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
