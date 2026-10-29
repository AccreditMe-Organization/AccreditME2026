# AccreditMe public website: plan and lane split

**Date:** 10 Oct 2026 · **Status:** PARTLY BUILT — merged as #161 (e4cc4d8), 12 Oct: the website scaffold on its preview address (ACC-213). Not started: the cut-over of the apex and `www` to the website. When written: plan only, nothing built or changed

## What is true today (checked)

- `accreditme.app` and `www.accreditme.app` are both served by the **app's** Vercel project. `www` 308-redirects to the apex (lane A's propagation check, 08:57Z).
- The apex is not used for anything real. The app treats the apex and `www` as "no organisation" and shows only a note saying "open your organisation's address" (`frontend/src/app/core/tenant/tenant-host.ts`, `no-organisation-address.component.ts`). So moving them to a website loses nothing.
- `www`, `app`, `login`, `signin`, `blog`, `docs`, `help`, `status` and more are already reserved: no tenant can take them (`backend/src/common/tenant/reserved-slugs.ts`).
- Every email link already goes to the tenant's own address, `https://{slug}.accreditme.app/…` (`backend/src/common/config/app-url.config.ts`). Nothing emailed points at the apex.
- `FRONTEND_URL` (= `https://accreditme.app`) is only used as one exact CORS origin. The website won't call the API in its first version, so it can stay as it is.
- **There is no self-serve sign-up.** Organisations are created by you in the platform area; Trial is a non-public plan; plans have a "public (shown on sign-up pricing)" flag but no sign-up flow exists.

## Who serves which address (target)

| Address | Served by | Notes |
| -- | -- | -- |
| `www.accreditme.app` | **Website** (new Vercel project) | The canonical public address |
| `accreditme.app` | Website project | 308 redirect to `www` (the reverse of today) |
| `{slug}.accreditme.app` | App (unchanged) | Each organisation's sign-in and app |
| `platform.accreditme.app` | App (unchanged) | Your platform admin sign-in |
| `api.accreditme.app` | Railway (unchanged) | |

Lane A must confirm in Vercel that `www` and the apex, assigned to the website project, win over the app project's `*.accreditme.app` wildcard. Vercel normally prefers the exact domain, but it is checked, not assumed.

## Where the buttons lead

- **Sign in:** a small "Go to your organisation" box on the website: type your organisation's address (`al-nakheel`), press Continue, and land on `https://al-nakheel.accreditme.app/login`. The box checks the format and the reserved list in the browser and remembers the last address on that device. A wrong address lands on the app's "no organisation at this address" page (lane A to confirm it exists).
- **Sign up (Ahmad, 10 Oct 09:56):** self-serve, on the plans the platform admin defines.
  - **Free trial:** 14 days on the chosen plan, no card, limited users and staff. The organisation is created when the admin confirms their email.
  - **Buy a plan:** pay by card through Stripe Checkout, monthly or annual; the organisation is activated when the payment succeeds. Designed and built in the frontend now; switched on when the Stripe account exists. Until then the page offers the trial only.
  - **Enterprise and custom deployment:** "Talk to us" opens the demo request form, sent to Ahmad's inbox through Resend.

## The plans today (checked)

- **Data model** (`backend/prisma/schema.prisma:432`): `Plan` has English and Arabic names, monthly and annual price, max full users and staff (empty = unlimited), storage GB, AI credits a month, active, **public** ("false = custom/negotiated, hidden from self-service pricing") and display order. `PlanModule` gives each plan an access level per module.
- **Intended plans** (`CLAUDE.md:1534`): Starter (10 users, 100 staff, 10 GB; Standards, Documents, Quality Improvement), Professional (50 users, 500 staff, 100 GB; all modules), Enterprise (unlimited, 1 TB, custom contract, not public). Every plan has a 14-day free trial with no card. Add-ons: extra seats, extra staff per 100, extra storage per 10 GB.
- **Not built yet:** no public plans endpoint (only `GET platform/plans`, platform admin only), no sign-up endpoint, no Stripe code anywhere, and `trialEndsAt` exists on the organisation but is never set.
- **No change needed for the website to call the API:** CORS already allows any `https://{one label}.accreditme.app`, so `https://www.accreditme.app` is allowed (`backend/src/common/config/cors.config.ts`).
- **Mismatch to settle:** the accepted platform drawings use a different module list (Committees, Meetings, Documents, Standards, Incidents, CAPA, Gap analysis, Audit) from CLAUDE.md's. The website shows module names from the plans' data, so it needs one module list with English and Arabic names.

## Pricing and sign-up, how it works

- **Pricing on the page is live:** the website reads the public, active plans from a new public endpoint each time the page loads, so a change Ahmad makes in the platform area appears at once. If the API can't answer, the section shows "See plans and prices" with the demo form instead of stale numbers.
- **Sign-up flow** (on the website, `www.accreditme.app/signup`):
  1. Choose a plan and monthly or annual (from the pricing section).
  2. Your organisation: name (English, Arabic optional), address with a live "available" check (`name.accreditme.app`), country.
  3. You: name, work email, phone. Bot check (Cloudflare Turnstile) and accept the terms.
  4. Trial: "Check your email". Paid: Stripe Checkout, then "Check your email".
  5. The email link creates (or activates) the organisation and opens the existing first-admin invitation at `https://{slug}.accreditme.app`, where they set a password. Everything after that is the existing app.
- **Trial limits (confirmed 10 Oct):** the chosen plan's modules, with smaller caps that the platform admin sets once for all trials (example: 5 full users, 25 staff, 2 GB, 100 AI credits). A trial that ends without paying is suspended and its data kept (as decided in the billing design).
- **Address hold:** an unconfirmed sign-up holds its address for 24 hours, then releases it, so nobody can squat names.

## How it's built (defaults)

- A **separate Vercel project** from a new `website/` folder in the same repo, so the lanes already have it checked out, and the app's 4,000-test CI doesn't run for copy changes.
- **Static and pre-rendered** (Astro or plain HTML/CSS), not the Angular app: fast first load and good for search engines.
- **English and Arabic (RTL)** from day one, using the same design system tokens and fonts as the app, so moving from the website into the app feels like one product.
- Its own security headers (copied from the app's `vercel.json`, adjusted), a sitemap, Open Graph images for link previews, and privacy-friendly analytics (Vercel Web Analytics, no cookie banner needed).
- One page plus the minimum legal pages: **Privacy policy** and **Terms of service**. Healthcare buyers and tender documents ask for both.

## Direction for the content (Ahmad, 10 Oct 15:50, after the first drawing)

- **Sell value, not features:** added value, ROI and industry examples on every section. Facts quoted from outside sources carry their source; ROI figures are worked examples with their assumptions stated ("a 400-bed hospital spending N hours a month on evidence collection…"), never invented customer results.
- **Design that tells the story:** not rigid; colour carries meaning along the quality cycle (for example, risk and findings in warm tones moving to improvement and compliance in calm ones), within the app's design system tokens so the jump into the app still feels like one product.
- **AccreditMe is the complete platform.** Every module appears in what AccreditMe offers and in the full quality cycle, whether built yet or not. In the story sections no module is labelled "Coming soon". Availability shows only where someone buys: the pricing and plan comparison, read from the plans' data (default; this supersedes the 10:01 "Coming soon everywhere" default only for the story sections).
- **Written for several personas:** C-level (cost, risk, reputation, one view of readiness), board member (oversight and assurance), quality manager (the daily cycle and accreditation readiness), audit officer (audits, findings, evidence trail), risk officer (risk register, incidents, CAPA), policy and procedures manager (document control, versions, approvals, acknowledgement), business excellence manager (KPIs, improvement projects, excellence models), and others as they come. Each persona gets its own short block or tab: their problem, what AccreditMe does for them, the value in their terms.
- **Industry examples:** healthcare first (hospitals, clinics), then education and other regulated sectors, each with a concrete scenario.

## Sections of the page (for the design brief)

1. Header: logo, section links, language switch (EN/عربي), **Sign in**, **Start free trial**, **Request a demo**
2. Hero: a value promise (outcome, not feature), one supporting fact, both buttons, a real product screenshot
3. The cost of the problem: quality and accreditation spread over spreadsheets, email and paper, with sourced facts
4. The full quality cycle: every module placed on one cycle (plan → document → do → measure → audit → find → correct → improve), told as one story with colour carrying it
5. For each persona: a selector or row of cards, each with problem, solution and value in that person's language
6. Value and ROI: worked examples with stated assumptions, and hours, cost and risk avoided
7. Industry examples: healthcare first, then others
8. AI that assists: suggests, a person approves, recorded
9. Security and data: own address per organisation, Arabic and English, files in AccreditMe's cloud or the customer's own SharePoint or S3, never used to train AI (the page does not say where AccreditMe is hosted)
10. Pricing: live from the public plans, with trial and buy buttons; Enterprise → demo form
11. FAQ
12. Final call to action and the demo form
13. Footer: contact, legal pages, social links, © [Company name]

No testimonials or customer logos until there are real ones with permission.

## Order of work, alongside what is in flight

| # | Who | What | When |
| -- | -- | -- | -- |
| 1 | **Ahmad** | Gather the content pack: logo files, company legal name and address, contact email and phone, tagline, social links | Now |
| 2 | **Design thread** | One brief: the one-page website (EN/AR, mobile), the pricing section fed by the plans, the sign-up flow (trial and paid, with Stripe Checkout drawn as the hand-off), the email-confirmation and "address taken" states, the Sign in box, and the Enterprise demo form. Plus a small addition to the accepted platform drawings: the trial limits setting | Now. The design thread is free |
| 3 | **Lane A** | Scaffold `website/` and a second Vercel project on a preview address only (no domain change), with headers, the language switch and the demo form wired to Resend | Now, while it waits on lane B before CC-73 |
| 4 | **Lane B** | The backend: a public plans endpoint; address check; sign-up with email confirmation that creates a trial organisation and sends the existing first-admin invitation; trial end date and automatic suspension; rate limits and the bot check. Stripe Checkout and its webhook are designed in, behind a switch, and finished when the account exists | After the file viewer (ACC-189) |
| 5 | **Lane A** | Build the page and the sign-up screens from the accepted drawing, against lane B's endpoints, on the preview address | After 2, alongside 4 |
| 6 | **Ahmad** | Approve the copy in both languages; take screenshots from al-nakheel after step 8 (first real sign-ins); get the privacy policy and terms reviewed; open the Stripe account when ready | In parallel |
| 7 | **Lane A + Ahmad** | The cut-over: move `www` and the apex to the website project, apex → `www`, confirm tenants and platform still work | After 5, with Ahmad's approval. After CC-73 and the email secrets fix |
| 8 | **Lane B** | Switch on paid sign-up once Stripe exists (part of the billing build) | Later |

Lane A owns Vercel, the domain and the website. Lane B owns the sign-up and billing backend, because it creates organisations and touches plans and money.

## Decisions

Answered by Ahmad (10 Oct 09:56): self-serve sign-up to the defined plans; trial with no card; card payment designed now and switched on with Stripe; demo form for Enterprise and custom deployment; prices come from the platform admin. Canonical address: `www`, as asked.

Confirmed by Ahmad (10 Oct 10:01):
1. **Trial limits:** the chosen plan's modules with smaller caps set once by the platform admin (example 5 users, 25 staff, 2 GB, 100 AI credits).
2. **Modules not built yet** show "Coming soon" in pricing until they go live; the story sections present every module as part of the platform (refined 15:50).

Still open:
3. **Company details** (not decided yet, 10 Oct): design and build use a marked placeholder "[Company name]". Needed before the cut-over (privacy policy and terms name the company) and before opening Stripe (the account belongs to a registered business, and Stripe works only in some countries).
