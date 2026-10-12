# ACC-213 — Public website, step 3: scaffold website/ on a preview address

The prompt that started this ticket (CC-74), saved verbatim with its addendum.
The plan it refers to is `backend/Plans/website-plan-2026-10-10.md`, and the
accepted design is `frontend/design-reference/AccreditMe Website.dc.html`. Both
are committed alongside this file. Where the plan differs from CC-74, CC-74
wins.

---

## CC-74 — Public website, step 3: scaffold website/ on a preview address. Plan approved by Ahmad by sending this prompt.

Context: the plan is /mnt/project-files/website/website-plan-2026-10-10.md if you can read it; everything you need is here. www.accreditme.app will become a public one-page website (EN/AR) in its own Vercel project; tenants stay on {slug}.accreditme.app. This step is the scaffold only: no domain, DNS, Vercel, Railway or app changes. The page design is still being drawn, so build structure, not final copy.

0. Create a Linear ticket (team AccreditMe, Medium, Feature): "website: scaffold the public website on a preview address", related to ACC-130. Branch feature/ACC-<n>-website-scaffold from origin/dev. Save this prompt as backend/Plans/step-<n>-website-scaffold.md and commit it first.

1. website/ (its own package.json and lockfile, npm ci):
   - Astro, latest stable, exact version pinned; output: 'static'; no UI framework; TypeScript strict; build.inlineStylesheets: 'never'.
   - Pages: / (English) and /ar/ (Arabic: lang="ar" dir="rtl"), /privacy and /terms in both languages (placeholder, clearly marked DRAFT), and a 404 in both.
   - Language switch linking equivalent pages, with hreflang alternates and a canonical on https://www.accreditme.app.
   - Reuse the app's design tokens (colours, type scale, spacing, radius) and its self-hosted fonts (the Latin font and IBM Plex Sans Arabic). Copy the files into website/; don't load anything from the app. Note the source paths.
   - One page with the 12 sections from the plan as labelled placeholders: header, hero, the problem, what it does, how it works, AI that assists, security and data, who it's for, pricing, FAQ, final call to action with the demo form, footer. Neutral placeholder text marked DRAFT. No product claims, prices, customer names or testimonials.
   - Header "Sign in" box: the user types their organisation address and Continue goes to https://{slug}.accreditme.app/login. Validate in the browser: one DNS label, lowercase a-z 0-9 and hyphen, 1-63 characters, no leading or trailing hyphen, not reserved. Generate the reserved list at build time from backend/src/common/tenant/reserved-slugs.ts so it can't drift. Remember the last address in localStorage, wrapped in try/catch. English and Arabic error text.
   - Demo form: fields and validation only. Submit is disabled with a "Coming soon" note. No network call, no secret, no third-party script.

2. website/vercel.json:
   - framework astro, npm ci, npm run build, output dist.
   - ignoreCommand: build only on dev AND when website/ changed, e.g. [ "$VERCEL_GIT_COMMIT_REF" != "dev" ] || git diff --quiet HEAD^ HEAD -- .
   - Headers on every path:
     - an ENFORCED CSP: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'self'; object-src 'none';
     - HSTS as the app's; nosniff; X-Frame-Options DENY; Referrer-Policy and Permissions-Policy as the app's; COOP same-origin;
     - X-Robots-Tag: noindex, nofollow.
   - robots.txt with Disallow: / for now. The cut-over step flips both.
   - Immutable caching for hashed assets.
   - Sitemap set up with site https://www.accreditme.app.

3. Checks (add a website npm script `check` and run it):
   - astro check and build pass;
   - both languages' pages exist, and every built page has the right lang and dir;
   - the built HTML has no inline script tags, no style tags and no style attributes;
   - vercel.json carries the noindex and CSP headers;
   - the reserved list matches the backend file.
   Also tell me whether the app's GitHub CI runs on a website-only change and which checks are required, and whether the app's own Vercel project would also build on a website-only change. Don't change any workflow or the app's vercel.json.

4. Docs: one short CLAUDE.md section on website/, and a row in SYSTEM-REFERENCE §15.15 (website: preview only, not yet on www).

Rules: don't touch frontend/, backend/ (except reading reserved-slugs.ts and adding the Plans file), .github/, Railway, DNS or Vercel. No secrets. Don't sign in to the deployed API.

Then STOP and report: what was built, check results, the CI and Vercel answers, and anything that differs from this prompt. Ahmad types /ready-to-pr himself. After the merge I'll walk Ahmad through creating the second Vercel project (root directory website).

---

## Addendum to CC-74 — the design and the plan are in the repo folders

Ahmad has placed, uncommitted:
- frontend/design-reference/AccreditMe Website.dc.html, the accepted website design;
- frontend/design-reference/assets/, its 3 logo PNGs;
- backend/Plans/website-plan-2026-10-10.md, the website plan. Where it differs from CC-74, CC-74 wins.

In step 0, commit these three together with the CC-74 plan file, as the branch's first commit.

From the design, for this scaffold:
- Brand tokens: use the website's brand palette, NOT the app's colours. Charcoal #33393F, sky #7BC8E6, steel #4A80B5, lime #A2D83C; text inks ink-steel #3A6C9E, ink-steel-strong #2C5580, ink-sky #2A6A86, ink-lime #4D7A12; tints #EAF6FB, #EAF1F8, #F2F9E6, #EEF0F2. Never use sky or lime as text on white. Keep the app's type scale, spacing, radius and self-hosted fonts as CC-74 says.
- Logo: copy the three PNGs into website/public/. The horizontal lockup is the header logo, the reversed one goes on charcoal bands, and the mark is the favicon source. The wordmark stays in Latin letters on the Arabic pages.
- Structure: name the 12 placeholder sections in the design's order, and give each the design's background band (light tint, white or charcoal), so the page reads like the design in outline. Keep the copy as DRAFT placeholders: the design's text isn't final. The full page is built in a later step from this design file.
- Report which tokens and files you took from the design.
