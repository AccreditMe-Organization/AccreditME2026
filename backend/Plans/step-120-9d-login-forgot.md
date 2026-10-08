# ACC-120 slice 9d — Sign in and Forgot password on the shared auth layout

Plan written 8 Oct 2026 (CC-61), approved with the answers below in CC-62.
Frontend only, plus one backend comment. No database writes, no migrations.

## Scope

Sign in and Forgot password move onto the auth layout slice 9e built for Accept
invitation (`app-auth-layout`, `am-field`, `am-password-input` with the toggle
button inside the field, the language switch, `focusFirstInvalid()`).

ACC-139's work stays exactly as it is: there is no organisation field, and an
address that names no organisation shows `app-no-organisation-address`.

Wording is "Sign in" everywhere (page title, button, links).

## Design reference

`frontend/design-reference/AccreditMe Templates.dc.html`, Template 7 · third
screen, "Login — two organisation states, honest failures, and the MFA step".

Departures, all seven accepted (CC-62, answer 6):

1. No "Signing in to {organisation}" block or logo. It needs a lookup by slug,
   and ACC-139 decided there is none.
2. No "no organisation at this address" 404. That is the same lookup; an unknown
   slug gets the form, then `INVALID_CREDENTIALS`.
3. No typed-slug state B. ACC-139 removed it, and the bare address keeps its note.
4. No "Reset password" button on the locked banner. Password reset is not served.
5. The design's "won't extend the lock" is false for our backend: a password
   attempt made while locked extends the lock (`login-attempt.service.ts:102`).
   The copy says so on the password step only (see correction c).
6. No "Not you? Start again" control and no step line on the MFA step. That
   would be a behaviour change (answer 3).
7. No "Check your email … link valid 60 minutes" + resend timer. It is not true
   today; Forgot password says so instead (answer 1).

## Files

| File | Change |
| -- | -- |
| `frontend/src/app/core/http/refusal.ts` + spec | NEW. `refusalCode()`, moved from Accept invitation, plus `refusalBody()` for the details (`lockedUntil`, `retryAfterSeconds`, `attemptsRemaining`) |
| `frontend/src/app/foundation/auth/components/login/sign-in-refusal.ts` + spec | NEW. A pure function, error → what the screen says, one branch per code; plus `whenAt()` (round up to whole minutes, minimum 1) |
| `login.component.ts` + spec | on `app-auth-layout`, with `am-field`; email `autocomplete="username"`; `am-password-input` with `autocomplete="current-password"`; one message slot above Sign in; `focusFirstInvalid()`. The MFA step is restyled with NO behaviour change. The idle and invitation notices are kept, as is the no-organisation note |
| `forgot-password.component.ts` + spec | the email field and the POST are REMOVED. The page shows the title, the honest note and "Back to sign in". The route and the "Forgot password?" link on Sign in stay |
| `accept-invitation.component.ts` | imports the shared `refusalCode()`. No behaviour change |
| `assets/i18n/en.json`, `ar.json` | the keys below; obsolete keys removed |
| `SYSTEM-REFERENCE.md` §1.12 | what the client shows for each sign-in outcome |
| `backend/src/foundation/tenant/dto/update-tenant.dto.ts` | comment only (answer 5), its own `docs` commit |

The no-organisation note component and the auth layout are unchanged. The
backend endpoint `POST /auth/forgot-password` stays exactly as it is.

## Message table

`{{when}}` is the formatting layer's `relative()` — "in 14 minutes" /
«خلال 14 دقيقة», the genitive Arabic needs after the preposition. It is rounded
UP to whole minutes, minimum 1, so it never reads "in 0 minutes". When
`lockedUntil` or `retryAfterSeconds` is missing or unparsable, the no-time
variant is shown instead.

| Situation | Look | English | Arabic |
| -- | -- | -- | -- |
| Title, button | | Sign in | تسجيل الدخول |
| Back link | | Back to sign in | العودة إلى تسجيل الدخول |
| `INVALID_CREDENTIALS` | error | Email or password is incorrect. Check both and try again. | البريد الإلكتروني أو كلمة المرور غير صحيحة. تحقّق منهما وأعد المحاولة. |
| `ACCOUNT_LOCKED`, password step | warn | This account is locked after too many unsuccessful attempts. You can try again {{when}}. Each attempt before then extends the lock. | تم قفل هذا الحساب بعد محاولات كثيرة غير ناجحة. يمكنك المحاولة مجددًا {{when}}، وكل محاولة قبل ذلك تمدّد القفل. |
| … no time | warn | This account is locked after too many unsuccessful attempts. Try again later. Each attempt before the lock lifts extends it. | تم قفل هذا الحساب بعد محاولات كثيرة غير ناجحة. أعد المحاولة لاحقًا، وكل محاولة قبل رفع القفل تمدّده. |
| `ACCOUNT_LOCKED`, MFA step | warn | This account is locked after too many unsuccessful attempts. You can try again {{when}}. | تم قفل هذا الحساب بعد محاولات كثيرة غير ناجحة. يمكنك المحاولة مجددًا {{when}}. |
| … no time | warn | This account is locked after too many unsuccessful attempts. Try again later. | تم قفل هذا الحساب بعد محاولات كثيرة غير ناجحة. أعد المحاولة لاحقًا. |
| `ACCOUNT_INACTIVE` | neutral | This account isn't active. Your password was correct, but the account has been deactivated or not yet activated. Your administrator can restore it. | هذا الحساب غير نشط. كلمة المرور صحيحة، لكن الحساب أُوقف أو لم يُفعَّل بعد. يمكن لمسؤول النظام إعادة تفعيله. |
| `ORGANIZATION_UNAVAILABLE` | neutral | Your organisation's access to AccreditMe isn't available right now. Contact your administrator. | وصول مؤسستك إلى النظام غير متاح حاليًا. تواصل مع مسؤول النظام. |
| `RATE_LIMITED` | warn | Too many sign-in attempts from this network. Try again {{when}}. | محاولات تسجيل دخول كثيرة جدًا من هذه الشبكة. أعد المحاولة {{when}}. |
| … no time | warn | Too many sign-in attempts from this network. Try again later. | محاولات تسجيل دخول كثيرة جدًا من هذه الشبكة. أعد المحاولة لاحقًا. |
| `MFA_INVALID` (on the code field) | error | That code didn't work. Enter the code showing in your app now. | لم ينجح هذا الرمز. أدخل الرمز الظاهر في تطبيقك الآن. |
| `MFA_INVALID`, 1–2 left (plural, not at 3+) | warn | one: 1 attempt left for this sign-in. · other: {{count}} attempts left for this sign-in. | zero: لا محاولات متبقية لتسجيل الدخول هذا. · one: محاولة واحدة متبقية لتسجيل الدخول هذا. · two: محاولتان متبقيتان لتسجيل الدخول هذا. · few: {{count}} محاولات متبقية لتسجيل الدخول هذا. · many: {{count}} محاولة متبقية لتسجيل الدخول هذا. · other: {{count}} محاولة متبقية لتسجيل الدخول هذا. |
| `MFA_EXPIRED` | warn | This sign-in timed out. Reload the page and sign in again. | انتهت مهلة تسجيل الدخول هذا. أعد تحميل الصفحة وسجّل الدخول مجددًا. |
| Status 0 or 5xx | info | AccreditMe didn't respond, so your sign-in didn't go through. Try again in a moment. | لم يستجب النظام، فلم يكتمل تسجيل الدخول. أعد المحاولة بعد قليل. |
| Anything else | error | Something went wrong. Try again. | حدث خطأ. أعد المحاولة. |
| Forgot password, title | | Forgot password | نسيت كلمة المرور |
| Forgot password, note | info | Password reset by email isn't available yet. Ask your organisation's administrator for help signing in. | إعادة تعيين كلمة المرور عبر البريد غير متاحة بعد. اطلب المساعدة من مسؤول النظام في مؤسستك. |
| Code hint | | The 6-digit code from your authenticator app. | الرمز المكوّن من 6 أرقام من تطبيق المصادقة. |
| Email, required / invalid | | Enter your email. / Enter a valid email address. | أدخل بريدك الإلكتروني. / أدخل بريدًا إلكترونيًا صحيحًا. |
| Password, required | | Enter your password. | أدخل كلمة المرور. |
| Code, required / length | | Enter the 6-digit code. | أدخل الرمز المكوّن من 6 أرقام. |

On the MFA step, `ACCOUNT_INACTIVE` and `ORGANIZATION_UNAVAILABLE` use the same
rows as the password step.

**Wider wording (answer 4)**, English only — the Arabic does not change:

- `auth.login`: "Log In" → "Sign in"
- `auth.logout`: "Sign Out" → "Sign out"
- `user.lastLogin`: "Last Login" → "Last sign-in"
- `platform.suspendConfirm`: "…unable to log in…" → "…unable to sign in…"

Removed as unread: `auth.loginFailed`, `auth.errorInvalidCredentials`,
`auth.errorMfaRequired`, `auth.forgotPasswordSent`.

## Tests

- **`sign-in-refusal.spec`, one spec per row:**
  - each code → its key, its look, and its details;
  - `ACCOUNT_LOCKED` 14 minutes ahead → "in 14 minutes" / «خلال 14 دقيقة»;
  - 30 seconds ahead → "in 1 minute";
  - already passed → "in 1 minute";
  - missing → the no-time key; malformed → the no-time key;
  - the MFA step's lock uses the key without "extends";
  - `RATE_LIMITED` with 60, missing and `'soon'`;
  - `MFA_INVALID` with 1 and 2 left (shown) and 3 (not shown);
  - `MFA_EXPIRED`;
  - status 0, 500 and 503 → unreachable;
  - an unknown code, and a 401 with no code → generic.
- **`refusal.spec`:** the code and details read from a real `HttpErrorResponse`;
  non-objects and wrong types → null.
- **Login spec:**
  - It sits in `app-auth-layout`, with `am-field`.
  - The email field has `autocomplete="username"`; the password field is an
    `am-password-input` with `autocomplete="current-password"`.
  - The title and button use Sign in.
  - An empty submit reveals the errors and focuses Email.
  - Each refusal renders in the slot above the button and replaces the last one.
  - `MFA_INVALID` sits on the code field, with the attempts line at 1–2.
  - The MFA step posts the same code as before.
  - The idle and invitation notices are kept; the no-organisation note is kept.
- **Forgot spec:** no email field; the page makes NO HTTP request (asserted with
  `HttpTestingController.verify()`, no `AuthService` call); it never says "check
  your inbox"; "Back to sign in" goes to `/login`.
- **Accept invitation's existing specs** pass unchanged on the shared helper.
- **Mutations, each must go red:**
  - swap each code's key, one mutation per code;
  - drop the lock's `when`;
  - drop the rate limit's `when`;
  - drop the minimum-1-minute rounding;
  - give the MFA step the password step's lock key;
  - move the attempts threshold to ≤3;
  - map status 0 to `INVALID_CREDENTIALS`;
  - remove each autocomplete;
  - remove `focusFirstInvalid()`;
  - put "Log In" back;
  - make Forgot send a request again;
  - put "check your inbox" back on Forgot.

## Browser check (Ahmad runs it)

1. `http://al-nakheel.localhost:4200/login` in English, then ع: the card, the
   "Sign in" title, the eye button inside the password field, right-to-left order.
2. Submit empty: the errors appear and focus goes to Email.
3. Sign in as Hessa, reload, sign out; back on "Sign in".
4. A wrong password at `nosuch.localhost:4200`, with any email: "Email or
   password is incorrect…". On a real account, never more than 2 wrong tries.
5. Optional rate limit: 61 quick logins at `nosuch`, then Sign in → "Too many
   sign-in attempts… in 1 minute". That is the local backend's in-memory
   counter, so nothing is written.
6. DevTools set to Offline, then Sign in: "AccreditMe didn't respond…".
7. Forgot password: the note and "Back to sign in", with no field and no
   request (DevTools Network stays empty).
8. Lock, inactive, organisation unavailable and MFA are checked by specs only.

## Shared database

The code touches none of it. The browser check makes only the usual sign-in
writes: a `LoginAttempt` row per attempt (one per wrong try), and the
`RefreshToken` and last-login updates on success. Forgot password no longer
sends a request, so it writes nothing.

## Review answers (CC-62)

1. **Forgot password: stop sending the request.** Remove the email field and the
   POST. The page shows the title "Forgot password", the honest note and "Back
   to sign in". The route and the "Forgot password?" link stay; the backend
   endpoint stays. Spec: no HTTP request, never "check your inbox".
2. **Lock time: relative**, rounded up to whole minutes, minimum 1. Missing or
   unparsable → the same message without the time ("Try again later."). Specs
   for 30 seconds ahead, missing, and malformed.
3. **MFA "Start again": left out.** `MFA_EXPIRED` keeps "Reload the page and sign
   in again."
4. **Wider wording: yes to all three** (`platform.suspendConfirm`,
   `user.lastLogin`, `auth.logout`); the Arabic does not change.
5. **PR #127:** after 9d merges, comment that 9d replaced it, then close it. 9d
   adds its own docs commit fixing the `update-tenant.dto.ts` logo comment to say
   what is true on `dev` today.
6. **Design departures: all seven accepted.**

Message corrections:

- **a. MFA attempts** — `attemptsRemaining` is min(5 per challenge − used,
  10 per user − failures) (`two-factor-challenge.ts:138`). At 0 the person
  usually signs in again rather than meeting a lock, so the text is "…attempts
  left for this sign-in". Threshold kept: shown at 1–2, not at 3.
- **b. Status 0 / 5xx** — "AccreditMe didn't respond, so your sign-in didn't go
  through. Try again in a moment."
- **c. The lock-extension sentence** — proven for the password step
  (`login-attempt.service.ts:102`). Checked for the MFA step in Better Auth
  1.6.22: `assertTwoFactorNotLocked()` runs BEFORE the code is checked or a
  failure counted (`plugins/two-factor/totp/index.mjs:137` against `:147` and
  `:154`), and throws while `lockedUntil` is in the future. So a code tried
  during an MFA lock does NOT move `twoFactor.lockedUntil`, and the MFA step
  uses its own key, without the sentence.
- **d. `ORGANIZATION_UNAVAILABLE`** — "isn't available right now", not "paused",
  which does not fit a cancelled organisation.

Mutations added: "drop the minimum-1-minute rounding", "Forgot sends a request
again".
