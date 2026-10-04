import type { TransformFnParams } from 'class-transformer';

// ACC-160 — the storage rule for an OPTIONAL bilingual name, written once.
//
// Use as `@Transform(trimToNull)` beside `@IsOptional()`. A string is trimmed,
// and a string that is empty after trimming becomes NULL. Anything that is not
// a string passes through untouched, so `@IsString()` still refuses it by name.
//
// WHY NULL AND NOT ''. Arabic fields are never mandatory in this product, so
// "no Arabic name" is an ordinary state, and it must have exactly ONE stored
// form. Storing '' beside NULL gives every reader two falsy values that mean
// the same thing, which is how fallbacks that disagree get written — one site
// checks `=== null`, another checks truthiness, and a blank cell appears on one
// screen and not the other.
//
// WHY REFUSING '' IS WRONG TOO. A form's own clear-the-field path sends ''. A
// DTO that 400s on it makes the ordinary act of removing an Arabic name fail.
//
// WHY THIS IS SAFE ON AN UPDATE DTO. Built with `PartialType`, an update DTO
// inherits this transform and `@IsOptional()` together (measured for the
// validators in ACC-160's plan; the transform is pinned by the DTO specs). An
// OMITTED field never reaches a transform and stays undefined, which Prisma
// ignores — so an unrelated update cannot clear the name. Only a field that
// was SENT, and sent empty, becomes NULL.
//
// Runs BEFORE validation (class-transformer, then class-validator), so a value
// that is all whitespace is NULL by the time `@MaxLength` and `@IsString` look
// at it, and `@IsOptional()` lets the NULL through.
export function trimToNull({ value }: TransformFnParams): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
