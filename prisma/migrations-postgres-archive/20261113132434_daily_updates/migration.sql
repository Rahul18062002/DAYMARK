-- CreateEnum
CREATE TYPE "UpdateStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'EDITED');

-- CreateEnum
CREATE TYPE "UpdateSource" AS ENUM ('DASHBOARD', 'SLACK', 'EMAIL', 'WHATSAPP', 'EXTERNAL_FORM');

-- CreateEnum
CREATE TYPE "UpdateSection" AS ENUM ('WORKED_ON', 'COMPLETED', 'PENDING', 'BLOCKER', 'NEXT_PRIORITY');

-- CreateEnum
CREATE TYPE "RevisionKind" AS ENUM ('SUBMITTED', 'EDITED');

-- CreateTable
CREATE TABLE "DailyUpdate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "updateDate" DATE NOT NULL,
    "status" "UpdateStatus" NOT NULL DEFAULT 'DRAFT',
    "source" "UpdateSource" NOT NULL DEFAULT 'DASHBOARD',
    "hasBlockers" BOOLEAN NOT NULL DEFAULT false,
    "firstSubmittedAt" TIMESTAMP(3),
    "submittedLate" BOOLEAN NOT NULL DEFAULT false,
    "lastEditedAt" TIMESTAMP(3),
    "revisionCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpdateItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "dailyUpdateId" TEXT NOT NULL,
    "section" "UpdateSection" NOT NULL,
    "position" INTEGER NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "UpdateItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpdateAttachment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "dailyUpdateId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT,

    CONSTRAINT "UpdateAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpdateRevision" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "dailyUpdateId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "kind" "RevisionKind" NOT NULL,
    "statusAtTime" "UpdateStatus" NOT NULL,
    "changedByUserId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UpdateRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyUpdate_organizationId_updateDate_idx" ON "DailyUpdate"("organizationId", "updateDate");

-- CreateIndex
CREATE INDEX "DailyUpdate_organizationId_membershipId_updateDate_idx" ON "DailyUpdate"("organizationId", "membershipId", "updateDate");

-- CreateIndex
CREATE INDEX "DailyUpdate_organizationId_updateDate_status_idx" ON "DailyUpdate"("organizationId", "updateDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DailyUpdate_membershipId_updateDate_key" ON "DailyUpdate"("membershipId", "updateDate");

-- CreateIndex
CREATE UNIQUE INDEX "DailyUpdate_id_organizationId_key" ON "DailyUpdate"("id", "organizationId");

-- CreateIndex
CREATE INDEX "UpdateItem_dailyUpdateId_section_position_idx" ON "UpdateItem"("dailyUpdateId", "section", "position");

-- CreateIndex
CREATE INDEX "UpdateItem_organizationId_section_idx" ON "UpdateItem"("organizationId", "section");

-- CreateIndex
CREATE INDEX "UpdateAttachment_dailyUpdateId_position_idx" ON "UpdateAttachment"("dailyUpdateId", "position");

-- CreateIndex
CREATE INDEX "UpdateRevision_organizationId_createdAt_idx" ON "UpdateRevision"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UpdateRevision_dailyUpdateId_revisionNumber_key" ON "UpdateRevision"("dailyUpdateId", "revisionNumber");

-- AddForeignKey
ALTER TABLE "DailyUpdate" ADD CONSTRAINT "DailyUpdate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyUpdate" ADD CONSTRAINT "DailyUpdate_membershipId_organizationId_fkey" FOREIGN KEY ("membershipId", "organizationId") REFERENCES "Membership"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpdateItem" ADD CONSTRAINT "UpdateItem_dailyUpdateId_organizationId_fkey" FOREIGN KEY ("dailyUpdateId", "organizationId") REFERENCES "DailyUpdate"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpdateAttachment" ADD CONSTRAINT "UpdateAttachment_dailyUpdateId_organizationId_fkey" FOREIGN KEY ("dailyUpdateId", "organizationId") REFERENCES "DailyUpdate"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpdateRevision" ADD CONSTRAINT "UpdateRevision_dailyUpdateId_organizationId_fkey" FOREIGN KEY ("dailyUpdateId", "organizationId") REFERENCES "DailyUpdate"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
