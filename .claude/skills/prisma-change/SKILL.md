---
name: prisma-change
description: Mandatory process for any change to schema.prisma in AccreditMe. Invoke manually with /prisma-change before touching the schema.
disable-model-invocation: true
allowed-tools: Bash(npx prisma migrate *) Bash(npx prisma generate) Bash(npx prisma studio) Bash(npx prisma migrate status) Bash(git add prisma/*) Bash(git commit *) Bash(git status *) Read Glob Grep
---

# AccreditMe — Prisma Schema Change Process

Read this skill completely before making any change to schema.prisma.
Schema changes are the highest-risk operation in this codebase.
A bad migration on production data cannot always be reversed.
Every step below is mandatory — no exceptions.

---

## The Five Golden Rules

1. Schema changes are ALWAYS their own isolated commit — never mixed with feature code
2. Never edit a migration file after it has been created by Prisma
3. Never run `prisma migrate reset` on any environment with real data
4. Every new table that holds tenant data MUST have an `organizationId` field
5. The AuditLog table NEVER receives UPDATE or DELETE — append only, forever

---

## Step 1 — Plan Before Touching the Schema

Before opening schema.prisma, answer these questions:

- What table(s) are being added, modified, or removed?
- What relationships are being created?
- Does each new table hold tenant-specific data? If yes — `organizationId` is mandatory
- Does any existing data need to be migrated? If yes — plan a separate data script
- What is the migration name? (lowercase, hyphenated, descriptive)

Do not open schema.prisma until all questions are answered.

---

## Step 2 — Check Current Migration Status

```bash
cd backend && npx prisma migrate status
```

Confirm no pending or failed migrations exist before proceeding.
If any migration is in a failed state — resolve it before continuing.

---

## Step 3 — Edit schema.prisma Only

Make only the schema change. Nothing else in this step.

### Mandatory fields for every new tenant-scoped model:
```prisma
model ExampleModel {
  id             String   @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id])
  createdBy      String
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([organizationId])
  @@index([organizationId, createdAt])
}
```

### Check before proceeding:
- Does this model hold tenant data? → `organizationId` present ✓
- Are indexes defined? → `@@index([organizationId])` present ✓
- Is the AuditLog table untouched? ✓

---

## Step 4 — Generate and Review the Migration

```bash
cd backend && npx prisma migrate dev --name "clear-description-of-change"
```

### Migration naming rules:
- Lowercase, hyphen-separated, descriptive
- Examples:
  - `add-meetings-table`
  - `add-organization-id-to-documents`
  - `add-workflow-stage-sla-fields`
  - `add-audit-log-table`

After generation — OPEN the migration file and read it.
Confirm it does exactly what was planned in Step 1.

If the migration file looks wrong:
1. Do NOT proceed
2. Roll back: delete the migration file from prisma/migrations/
3. Fix the schema
4. Regenerate

---

## Step 5 — Regenerate the Prisma Client

```bash
cd backend && npx prisma generate
```

This must run after every schema change.
Skipping this means TypeScript types will be out of sync with the database.

---

## Step 6 — Verify in Prisma Studio

```bash
cd backend && npx prisma studio
```

Open in browser. Verify:
- New table exists with correct columns
- Relationships are correctly defined
- `organizationId` is present on all tenant-scoped tables
- No unintended changes to existing tables
- AuditLog table is unchanged

Do not proceed to commit until visual verification is complete.

---

## Step 7 — Commit the Migration

Commit ONLY the schema file and migration files together.
Nothing else belongs in this commit.

```bash
git add backend/prisma/schema.prisma
git add backend/prisma/migrations/
git commit -m "chore(prisma): migrate - {description} [ACC-XX]"
```

Examples:
```
chore(prisma): migrate - add meetings and agenda tables [ACC-18]
chore(prisma): migrate - add organization-id to committees [ACC-19]
chore(prisma): migrate - add workflow stage sla fields [ACC-23]
```

---

## Step 8 — Update Seed Data If Needed

If the schema change requires new system lookup values, default workflow stages,
or any other seed data — update `backend/prisma/seed.ts` and commit separately:

```bash
git commit -m "chore(prisma): seed - add {description} [ACC-XX]"
```

---

## Dangerous Commands — Reference Card

```bash
# SAFE — creates migration and applies to dev DB
npx prisma migrate dev --name "description"

# SAFE — check migration status
npx prisma migrate status

# SAFE — applies pending migrations (use for staging/production)
npx prisma migrate deploy

# SAFE — view data in browser
npx prisma studio

# SAFE — regenerate client after schema change
npx prisma generate

# DANGEROUS — resets entire DB and reruns all migrations
# ONLY on local dev with no data you care about
# NEVER on staging or production
npx prisma migrate reset

# DANGEROUS — pushes schema without creating a migration file
# Never use this — always use migrate dev instead
npx prisma db push
```

---

## AuditLog Table — Permanent Rules

The AuditLog table is append-only. These operations are permanently forbidden:
- UPDATE any row
- DELETE any row
- TRUNCATE the table
- DROP the table

Prisma middleware enforces this at runtime.
If a correction is needed — add a new entry noting the correction.
Never attempt to modify existing audit log entries.

---

## Data Migration (When Existing Rows Need Updating)

If you need to transform existing data alongside a schema change:

1. Create the schema migration with Prisma (Step 4 above)
2. Write a separate script in `backend/src/scripts/` to transform the data
3. Test the script on a local DB copy first
4. Run on staging, verify results, then run on production
5. Never put data transformation logic inside the migration SQL file

Commit the data script separately:
```bash
git commit -m "chore(prisma): data migration script - {description} [ACC-XX]"
```

---

## Rollback Strategy

Prisma does not support automatic rollback of applied migrations.
If a migration causes a problem in production:

1. Do NOT run migrate reset — this destroys data
2. Write a new migration that reverses the change
3. Apply the reversal migration with `npx prisma migrate deploy`
4. Fix the underlying issue
5. Re-migrate correctly

Prevention through Steps 1 and 6 (planning and visual verification)
is the only reliable strategy. There is no easy undo.
