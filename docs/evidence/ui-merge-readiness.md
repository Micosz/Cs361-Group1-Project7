# UI merge readiness — 2026-10-08

Target: `main`; source: `UI-Desgin`. Reviewed main: `5a6f5c9`.

## Integration

Merged main into the UI branch to resolve conflicts in README.md, assets/script.js,
index.html, package.json and tests/search.test.js. Retained the UI presentation,
Buddhist date ranges and prototype login. Retained main's API timeout, shared
backup loading, explicit-public filtering, backup workflow/data and deployment
documentation. No backend, API URL, database configuration or dependencies changed.

## Automated verification

43 cases pass: search/cache/filter/modal/data integration (30), Buddhist date
presentation (9), local-only login (4). Both API/backup failures can retry; successful
backup loading retains date filters, public-only visibility and primary/co-host
relationships. JavaScript syntax, local HTML asset references and conflict-marker
checks pass. The checks use DOM/fetch mocks; they do not verify AWS or a browser.

## Manual acceptance still required

- Desktop and mobile layout, native two-scene scrolling and hero CTA destination.
- Card pointer/keyboard interactions, modal motion and reduced-motion presentation.
- Browser console/network errors and current live API/deployment behavior.
- Login background asset readability on the deployment host. Earlier S3 image
  requests returned 403; repository inclusion does not verify host permissions.

No fresh browser verification was performed for this integration. See design-qa.md
for the earlier preview limitation. Login remains a UI prototype without authentication;
valid submit reports that authentication is unavailable and sends no credentials.

## Suggested pull request

Title: Upgrade CSTUHub UI, scroll presentation and Buddhist date-range filters

Body:

Refresh the public portal with responsive university branding, two-scene native
scroll presentation, interactive partner cards and refined navigation. Add
Buddhist-calendar start/end filters and a white/red prototype login page; remove
the signup action and footer as requested.

Preserve main's API caching, backup loading, explicit-public visibility, and
partner/co-host relationships. No framework or dependency changes.

Validation: 43 automated cases pass, JavaScript syntax and local asset references
checked. Browser layout/motion acceptance remains pending. Login authentication
is intentionally not connected; verify the login artwork is accessible after deployment.
