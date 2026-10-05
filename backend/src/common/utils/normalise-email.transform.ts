import type { TransformFnParams } from 'class-transformer';

// ACC-120 slice 9b — the one spelling of a sign-in email, written once.
//
// Use as `@Transform(normaliseEmail)` on every DTO that takes an email a person
// TYPES to identify themselves (sign-in, forgot password). A string is trimmed
// and lower-cased; anything else passes through untouched, so `@IsEmail()`
// still refuses it by name. Runs before validation.
//
// WHY THIS IS A SECURITY FIX, NOT TIDINESS. Better Auth lower-cases the email
// before it looks the account up (AuthService.namespacedEmail()), so
// `Hessa@…`, `HESSA@…` and `hessa@…` all authenticate as the same person. The
// lockout, though, counted failures per email EXACTLY AS TYPED — so every
// capitalisation got its own five attempts, and an address with n letters had
// 2^n counters. Normalising here gives the lockout and the authenticator one
// key between them.
export function normaliseEmail({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}
