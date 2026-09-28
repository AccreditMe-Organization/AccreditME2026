#!/bin/sh
# ACC-127 — database migrations run as part of deployment, under a time cap.
#
# Railway runs this as the service's pre-deploy command, before any new
# container is promoted. A non-zero exit here fails the deployment and the
# PREVIOUS container keeps serving, which is the property that makes running
# migrations at deploy time safe: a bad migration costs a red deployment, not
# an outage.
#
# THE CAP LIVES HERE, NOT IN RAILWAY'S SETTINGS, AND MUST STAY HERE.
# Railway has a real `preDeployTimeoutSeconds` service setting, and it is the
# wrong home: the IaC authoring format cannot express it, while the imported
# graph does carry it, so every `railway config apply` plans `600 -> null`.
# Measured, not feared. Keeping it there would mean re-setting it by hand
# after every release with no signal if forgotten — the exact silent failure
# ACC-127 exists to remove.
#
# Why a cap at all: Railway's default is NO limit — a pre-deploy command runs
# until it exits. `prisma migrate deploy` takes a Postgres advisory lock, so a
# hung migration would hold both the deployment and the lock.
#
# `-k 30` guards a different failure from the lock: if prisma ignores TERM the
# process outlives the cap and the deployment hangs anyway. The lock itself is
# safe — it is SESSION-scoped and dies with the process. Proved against this
# database through Supabase's pooler: a holder was hard-killed with no unlock
# and no graceful close, and a separate session went from HELD to FREE. So a
# retry never blocks behind a lock whose owner is gone.
#
# prisma.config.ts supplies both the schema path and the connection string —
# schema.prisma's datasource block has no url — so backend/Dockerfile must
# COPY it into the image. Without that this script cannot resolve either.

set -u

CAP_SECONDS=600
KILL_GRACE=30

# ACC-145 — the seed step gets its OWN cap, deliberately smaller than the
# migration's. It is ~87 find-then-write round trips against the global lookup
# rows, not a schema change: if it has not finished in two minutes it is hung or
# the database is unreachable, and waiting the migration's ten would just delay
# the same red deployment.
#
# It is capped at all for the reason in this file's header: Railway's default is
# NO limit, so an uncapped step hangs the deployment until someone notices.
# Adding one after the migrate step would have reintroduced exactly what ACC-127
# removed, on the same line of the same file.
SEED_CAP_SECONDS=120

echo "[pre-deploy] prisma migrate deploy (cap ${CAP_SECONDS}s)"

timeout -k "$KILL_GRACE" "$CAP_SECONDS" node_modules/.bin/prisma migrate deploy
code=$?

# 124 is timeout's own exit code; 137 and 143 are KILL and TERM seen through
# the shell. Name the cap in the log — whoever meets this at 2am should be told
# what happened, not left to infer it from a bare non-zero exit.
if [ "$code" -eq 124 ] || [ "$code" -eq 137 ] || [ "$code" -eq 143 ]; then
  echo "[pre-deploy] ABORTED: migration exceeded the ${CAP_SECONDS}s cap and was terminated (exit ${code})."
  echo "[pre-deploy] The advisory lock is session-scoped and was released with the process,"
  echo "[pre-deploy] so a retry will not block behind it. Investigate a slow or blocked"
  echo "[pre-deploy] migration before redeploying."
  exit "$code"
fi

if [ "$code" -ne 0 ]; then
  echo "[pre-deploy] FAILED: prisma migrate deploy exited ${code}"
  exit "$code"
fi

# ACC-145 — the GLOBAL SYSTEM lookup rows, seeded with no tenant.
#
# Until this step, LookupService.seedSystemData() had exactly one non-test
# caller: TenantService.bootstrap(). So on a database with zero tenants the
# global lookups did not exist, and the only thing that created them was
# creating a tenant. ACC-141 makes the root unit's type a required field chosen
# from those values, which turns that into a deadlock: the picker is empty, the
# required field blocks submission, and the tenant creation that would seed them
# is the thing blocked.
#
# HERE RATHER THAN A STARTUP HOOK, because pre-deploy runs once per DEPLOYMENT
# and not once per replica. seedSystemData() is find-then-create per row, so two
# replicas racing it collide on @@unique([key, organizationId]) and one crashes
# at boot. This placement removes the race instead of locking against it.
#
# AFTER the migration, not before: the rows it writes need the schema the
# migration may have just changed.
echo "[pre-deploy] seed system lookups (cap ${SEED_CAP_SECONDS}s)"

# The COMPILED entry point, run with plain node — not `npm run`, and not
# ts-node. ts-node is a devDependency; it is in the production image today only
# because the Dockerfile copies node_modules from a builder that ran a plain
# `npm ci`, and slimming that image with `--omit=dev` would break this step and
# fail the deployment. Calling node directly also matches how the migration
# above invokes node_modules/.bin/prisma rather than going through npm.
timeout -k "$KILL_GRACE" "$SEED_CAP_SECONDS" node dist/src/foundation/lookup/seed-system-lookups.cli.js
seed_code=$?

if [ "$seed_code" -eq 124 ] || [ "$seed_code" -eq 137 ] || [ "$seed_code" -eq 143 ]; then
  echo "[pre-deploy] ABORTED: system lookup seeding exceeded the ${SEED_CAP_SECONDS}s cap and was terminated (exit ${seed_code})."
  echo "[pre-deploy] The step is idempotent and takes no advisory lock, so a retry is safe"
  echo "[pre-deploy] and will not block. Check database reachability before redeploying."
  exit "$seed_code"
fi

if [ "$seed_code" -ne 0 ]; then
  echo "[pre-deploy] FAILED: system lookup seeding exited ${seed_code}"
  echo "[pre-deploy] The deployment is stopped deliberately. Without these rows a fresh"
  echo "[pre-deploy] database cannot create its first tenant (ACC-145)."
  exit "$seed_code"
fi

echo "[pre-deploy] OK"
