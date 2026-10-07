# CSTUHub login design QA

final result: blocked

## Source and implementation
- Selected visual truth: `/tmp/codex-clipboard-34f931f7-8d2c-49d0-b9ab-b176dfcf5099.png` (1175 × 935 pixels).
- Live reference: https://visuvate.com/contact, inspected with the in-app browser at desktop viewport, including scrolling the Let’s Connect form.
- Implementation: `login.html`, served at http://127.0.0.1:8780/login.html.
- Implementation screenshot: unavailable.
- Implementation CSS viewport and screenshot density: not captured; normalization/comparison not performed.
- Intended state (latest user revision): predominantly white login, larger form and Thai login heading, two empty credential fields, crimson action and a clearly visible red/gold optical background. Page-level scrolling is disabled; inner scrolling is reserved for short-height/keyboard/zoom accessibility.
- Intentional adaptations: CSTUHub branding, student ID/password only, university red/yellow, local-only unavailable-auth state. No backend authentication was added.

## Evidence and blocker
- Source attachment and generated background were opened visually.
- Reference was inspected at the top and after scrolling; its heading, translucent panels, italic display typography and diagonal light treatment informed the adaptation.
- Local preview initially returned ERR_CONNECTION_REFUSED. The loopback-only preview service was then started.
- Attempting to select the failed preview tab was blocked by Browser Use URL policy on the browser-generated data-URL error page. No alternate browser, hostname, automation interface or rendering workaround was used.
- Browser capture, full-view paired comparison, focused comparisons, mobile inspection, runtime motion inspection and console-error verification remain blocked. A running preview server and passing automated tests do not establish visual QA.

## Required fidelity surfaces
- Fonts/typography: Noto Sans Thai and Cormorant Garamond italic are implemented with fallbacks; the Thai login heading is enlarged from 24px to 32–48px at typical viewports. Rendered font loading, shaping, clipping and heading fit are unverified.
- Spacing/layout rhythm: centered display heading, wide form/compact aside, mobile single-column form are implemented; actual viewport fit remains unverified.
- Colors/tokens: #C3002F action/brand/focus, white surfaces, dark readable text and red/gold raster artwork are implemented; rendered contrast is unverified.
- Image quality: updated white-background red/gold optical raster is supplied at 1536 × 1024, at full opacity; composition was inspected independently, but actual browser crop behind the UI is unverified.
- Copy/content: Thai login copy and exactly two credential inputs are implemented; submit explicitly reports that authentication is not connected.

## Nonvisual verification
- Existing search/date tests: 37 passing.
- Login tests (latest revision): local-only submit handling, invalid form behavior, pagehide/BFCache lifecycle, two-input markup, removed copy and homepage navigation. 4 passing. Scroll choreography and its obsolete tests were removed at the user request.
- JavaScript syntax and git diff whitespace checks pass.
- No actual browser form, mobile layout or reduced-motion browser session was verified.

## Findings and next verification
- [P1] Visual acceptance evidence is missing. Capture the local login at desktop and mobile widths, compare beside the selected reference accounting for the requested two-field/brand adaptations, and verify entry/scroll motion, keyboard focus, back navigation, local submit feedback and console errors.
- Comparison history: no implementation comparison was possible; no visual pass is claimed. Latest user revision supersedes the original dark palette and scroll choreography. White theme, larger UI, two copy removals, fixed page and a new white-background raster are implemented; browser acceptance remains pending.
- Focused comparison is required for Thai labels, input sizing and heading wrapping once capture is available.

## Background visibility correction
- User supplied `/tmp/codex-clipboard-0e2e2175-27a6-4b16-a904-bfdea0b4ea32.png` showing a white login without optical artwork.
- The image file exists and opens correctly locally; the exact browser failure cause is unconfirmed.
- The raster now paints directly as the body background, rather than in a fixed positioned image layer. HTML preloads the same exact resource URL; the unnecessary image query string is removed.
- Form/heading entry motion is retained; decorative image entry animation is removed.
- Runtime visual acceptance remains blocked because the available browser tab is a failed connection page, not the user’s current login view. No successful post-fix browser screenshot is claimed.
