/**
 * A tenant's own email provider settings — ACC-181.
 *
 * Stored encrypted in `Organization.emailConfig` (the column is unchanged, so
 * there is no migration) as
 *
 *   { provider, [provider]: { ...that provider's fields }, secretsSetAt }
 *
 * Only the chosen provider's block is kept: switching provider never carries
 * the old provider's secret. `secretsSetAt` holds, per secret field, when it was
 * last set (D2), so the screen can say "set 29 Sep" without the value.
 *
 * SECRETS ARE WRITE-ONLY. GET answers each one "set" or null; a save that omits
 * a secret, or sends it empty, keeps the stored one (common/config/
 * write-only-secrets.ts), and the audit trail names fields, never values.
 *
 * NOTHING SENDS MAIL WITH THESE YET: email still goes out through AccreditMe's
 * own Resend delivery (CLAUDE.md, Email Provider), and the screen says so.
 */

export const EMAIL_PROVIDERS = ['resend', 'smtp', 'office365', 'sendgrid', 'ses'] as const;
export type EmailProvider = (typeof EMAIL_PROVIDERS)[number];

/** SMTP encryption, with the port each one implies (the screen's default). */
export const SMTP_ENCRYPTIONS = ['STARTTLS', 'SSL_TLS', 'NONE'] as const;
export type SmtpEncryption = (typeof SMTP_ENCRYPTIONS)[number];

interface FieldSpec {
  required: boolean;
  secret: boolean;
}

const field = (required: boolean, secret = false): FieldSpec => ({ required, secret });

/**
 * Every provider's fields, from the drawing (Settings Screens, section 1).
 * Each provider sends from `fromAddress`, labelled per provider: sender
 * address, sender mailbox (Office 365), sender verified identity (SES).
 *
 * SMTP's username and password are optional AS A PAIR (D5): both or neither,
 * checked by `missingEmailFields`.
 */
export const EMAIL_PROVIDER_FIELDS: Readonly<Record<EmailProvider, Readonly<Record<string, FieldSpec>>>> = {
  resend: { apiKey: field(true, true), fromAddress: field(true), fromName: field(false) },
  smtp: {
    host: field(true),
    port: field(true),
    encryption: field(true),
    username: field(false),
    password: field(false, true),
    fromAddress: field(true),
    fromName: field(false),
  },
  office365: { tenantId: field(true), clientId: field(true), clientSecret: field(true, true), fromAddress: field(true) },
  sendgrid: { apiKey: field(true, true), fromAddress: field(true), fromName: field(false) },
  ses: { region: field(true), accessKeyId: field(true), secretAccessKey: field(true, true), fromAddress: field(true) },
};

export function secretFieldsOf(provider: EmailProvider): string[] {
  return Object.entries(EMAIL_PROVIDER_FIELDS[provider])
    .filter(([, spec]) => spec.secret)
    .map(([name]) => name);
}

export type EmailSettingsBlock = Record<string, string | number>;

export interface IStoredEmailConfig {
  provider: EmailProvider;
  settings: EmailSettingsBlock;
  /** ISO timestamp per secret field name. */
  secretsSetAt: Record<string, string>;
}

const isProvider = (value: unknown): value is EmailProvider =>
  typeof value === 'string' && (EMAIL_PROVIDERS as readonly string[]).includes(value);

const hasValue = (value: unknown): boolean => value !== undefined && value !== null && value !== '';

/** Only this provider's own fields, without empty ones. */
export function keepKnownFields(provider: EmailProvider, block: Record<string, unknown>): EmailSettingsBlock {
  const known = EMAIL_PROVIDER_FIELDS[provider];
  const out: EmailSettingsBlock = {};
  for (const [name, value] of Object.entries(block)) {
    if (name in known && hasValue(value) && (typeof value === 'string' || typeof value === 'number')) out[name] = value;
  }
  return out;
}

/**
 * The stored config from its decrypted JSON, or null for none.
 *
 * A LEGACY blob, `{ emailProvider, config }` — what the JSON-editor screen this
 * replaces wrote — is read for its provider only, with no settings: its
 * untyped values are not trusted, and every secret must be entered again.
 * Measured before this shipped, no organisation had one.
 */
export function readEmailConfig(json: unknown): IStoredEmailConfig | null {
  if (!json || typeof json !== 'object') return null;
  const obj = json as Record<string, unknown>;
  if (isProvider(obj['provider'])) {
    const provider = obj['provider'];
    const block = obj[provider];
    const setAt = obj['secretsSetAt'];
    return {
      provider,
      settings: keepKnownFields(provider, block && typeof block === 'object' ? (block as Record<string, unknown>) : {}),
      secretsSetAt:
        setAt && typeof setAt === 'object'
          ? Object.fromEntries(Object.entries(setAt as Record<string, unknown>).filter(([, v]) => typeof v === 'string')) as Record<string, string>
          : {},
    };
  }
  if (isProvider(obj['emailProvider'])) {
    return { provider: obj['emailProvider'], settings: {}, secretsSetAt: {} };
  }
  return null;
}

/** The object encrypted into the column. */
export function writeEmailConfig(config: IStoredEmailConfig): Record<string, unknown> {
  return { provider: config.provider, [config.provider]: config.settings, secretsSetAt: config.secretsSetAt };
}

/**
 * The required fields this block lacks, by name. SMTP's username and password
 * go together (D5): one without the other names the other as missing.
 */
export function missingEmailFields(provider: EmailProvider, block: EmailSettingsBlock): string[] {
  const missing = Object.entries(EMAIL_PROVIDER_FIELDS[provider])
    .filter(([name, spec]) => spec.required && !hasValue(block[name]))
    .map(([name]) => name);
  if (provider === 'smtp') {
    const user = hasValue(block['username']);
    const pass = hasValue(block['password']);
    if (user && !pass) missing.push('password');
    if (pass && !user) missing.push('username');
  }
  return missing;
}

export interface IMaskedEmailConfig {
  provider: EmailProvider | null;
  /** The chosen provider's fields. Each SECRET reads 'set' or null — never its value. */
  settings: Record<string, string | number | null> | null;
  /** When each secret was last set (ISO), or null. */
  secretsSetAt: Record<string, string | null>;
  /** The platform's own sender (RESEND_FROM_EMAIL), or null when unset (D7). */
  defaultSender: string | null;
}

/** What GET returns: no secret value, ever. */
export function maskEmailConfig(config: IStoredEmailConfig | null, defaultSender: string | null): IMaskedEmailConfig {
  if (!config) return { provider: null, settings: null, secretsSetAt: {}, defaultSender };
  const settings: Record<string, string | number | null> = {};
  const secretsSetAt: Record<string, string | null> = {};
  for (const [name, spec] of Object.entries(EMAIL_PROVIDER_FIELDS[config.provider])) {
    const value = config.settings[name];
    if (spec.secret) {
      settings[name] = hasValue(value) ? 'set' : null;
      secretsSetAt[name] = hasValue(value) ? (config.secretsSetAt[name] ?? null) : null;
    } else {
      settings[name] = hasValue(value) ? value! : null;
    }
  }
  return { provider: config.provider, settings, secretsSetAt, defaultSender };
}
