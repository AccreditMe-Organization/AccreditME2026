-- CreateEnum
CREATE TYPE "PasswordResetLinkEndReason" AS ENUM ('USED', 'REPLACED', 'VOID');

-- CreateTable
CREATE TABLE "PasswordResetLink" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "endReason" "PasswordResetLinkEndReason",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetLink_tokenHash_key" ON "PasswordResetLink"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetLink_organizationId_userId_endedAt_idx" ON "PasswordResetLink"("organizationId", "userId", "endedAt");

-- AddForeignKey
ALTER TABLE "PasswordResetLink" ADD CONSTRAINT "PasswordResetLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetLink" ADD CONSTRAINT "PasswordResetLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

