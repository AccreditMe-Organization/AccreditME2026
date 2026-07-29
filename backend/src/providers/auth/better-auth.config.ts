// Configures Better Auth's own instance — the credential-verification/
// password-hashing/MFA engine described in
// backend/Plans/step-09-user-management.md Section 1 ("Why Better Auth's Own
// Plugins, Not Hand-Rolled Equivalents"). This instance owns ONLY the
// /api/auth/* surface (via AuthController, Commit 3) — it never issues the
// session cookie the rest of the app checks. TenantGuard keeps validating its
// own hand-signed AccreditMe JWT exactly as before (see Section 12,
// Discussion 4).
//
// Better Auth's real base schema (user/session/account/verification) and the
// twoFactor plugin's own schema were read directly from the installed
// better-auth@1.6.22 package (@better-auth/core's getAuthTables() and
// plugins/two-factor/schema.mjs) before writing the Commit 1 migration — not
// hand-typed from documentation. Model names below (authUser, authSession,
// authAccount, authVerification, authTwoFactor) match the Prisma models added
// in that migration exactly, via each table's own modelName option.
//
// Password hashing: Better Auth's actual default is scrypt, NOT Argon2id
// (verified against node_modules/better-auth/dist/crypto/password.mjs) — the
// ticket's "Argon2id (not bcrypt)" requirement is satisfied here by an
// explicit custom hash/verify pair using the `argon2` package, not by
// Better Auth's default.
//
// HaveIBeenPwned check: verified against
// node_modules/better-auth/dist/plugins/haveibeenpwned/index.mjs — it wraps
// whichever `password.hash` is configured (our Argon2id function below),
// checking the k-anonymity range API BEFORE hashing. Requires outbound HTTPS
// to api.pwnedpasswords.com at runtime — unit tests must mock Better Auth's
// API rather than exercise real sign-up/reset flows (see auth.service.spec.ts).
//
// TOTP secret/backup codes at rest: the twoFactor plugin encrypts both
// automatically (XChaCha20-Poly1305, keyed from this config's own `secret`)
// before Prisma ever sees them — verified against
// node_modules/better-auth/dist/crypto/index.mjs. No custom encryption code
// needed (Section 12, Discussion 6 — resolved).

import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { haveIBeenPwned } from 'better-auth/plugins/haveibeenpwned';
import * as argon2 from 'argon2';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../../foundation/notification/notification.service';

export function createBetterAuthInstance(
  prisma: PrismaService,
  notificationService: NotificationService,
) {
  return betterAuth({
    // PrismaService exposes exactly the per-model getters (authUser,
    // authSession, authAccount, authVerification) the adapter looks up by
    // property name — no second PrismaClient/connection pool needed.
    database: prismaAdapter(prisma, { provider: 'postgresql' }),

    secret: process.env['BETTER_AUTH_SECRET'],

    emailAndPassword: {
      enabled: true,
      password: {
        hash: (password: string) => argon2.hash(password, { type: argon2.argon2id }),
        verify: ({ hash, password }: { hash: string; password: string }) =>
          argon2.verify(hash, password),
      },
      // Required — Better Auth's /request-password-reset throws
      // RESET_PASSWORD_DISABLED without this callback configured. data.user
      // here is Better Auth's own AuthUser row (namespaced email); resolve
      // the real AccreditMe User via the authUserId link before notifying,
      // since Notification.userId references User.id, not AuthUser.id.
      sendResetPassword: async (data: { user: { id: string }; url: string }) => {
        const appUser = await prisma.user.findFirst({
          where: { authUserId: data.user.id },
        });
        if (!appUser) return;

        await notificationService.create(
          {
            userId: appUser.id,
            titleEn: 'Reset your AccreditMe password',
            titleAr: 'إعادة تعيين كلمة مرور AccreditMe',
            bodyEn: `Click the link below to reset your password. This link expires in 1 hour.\n\n${data.url}`,
            bodyAr: `انقر على الرابط أدناه لإعادة تعيين كلمة المرور الخاصة بك. تنتهي صلاحية هذا الرابط خلال ساعة واحدة.\n\n${data.url}`,
            channel: 'EMAIL',
          },
          appUser.organizationId,
        );
      },
    },

    user: { modelName: 'authUser' },
    session: { modelName: 'authSession' },
    account: { modelName: 'authAccount' },
    verification: { modelName: 'authVerification' },

    advanced: {
      // Prisma's own @default(cuid()) generates every id — defer to it
      // rather than Better Auth's own default id scheme.
      database: { generateId: false },
    },

    plugins: [
      // Table name matches the AuthTwoFactor Prisma model from Commit 1.
      twoFactor({ twoFactorTable: 'authTwoFactor' }),
      haveIBeenPwned(),
    ],
  });
}

export type BetterAuthInstance = ReturnType<typeof createBetterAuthInstance>;
