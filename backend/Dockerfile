FROM node:22-alpine AS builder
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY backend/ .
RUN npx prisma generate
RUN npm run build

FROM node:22-alpine AS production
WORKDIR /app
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/generated ./generated
COPY --from=builder /app/prisma ./prisma
# REQUIRED BY THE PRE-DEPLOY MIGRATION (ACC-127), not by the running app.
# schema.prisma's datasource block is bare `provider = "postgresql"` with no
# url — Prisma 7 takes both the schema path and the connection string from
# prisma.config.ts, so without this line `prisma migrate deploy` resolves
# neither and the pre-deploy step fails. The config prefers DIRECT_URL over
# DATABASE_URL, which is what a migration wants: it holds a session advisory
# lock, and that belongs on a direct connection rather than a pooled one.
COPY --from=builder /app/prisma.config.ts ./
# The pre-deploy migration step itself. Railway invokes it by name
# (`sh scripts/pre-deploy.sh`) rather than carrying the script inline, because
# `preDeployCommand` accepts at most ONE command — an inline argv array is
# rejected at apply time — and because the safety mechanism should be as
# readable and testable as any other file in the repository.
COPY --from=builder /app/scripts ./scripts
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["node", "dist/src/main.js"]
