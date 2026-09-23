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

echo "[pre-deploy] OK"
