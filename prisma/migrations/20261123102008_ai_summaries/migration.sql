-- AlterTable
ALTER TABLE "OrgSettings" ADD COLUMN "aiConsentAt" DATETIME;

-- CreateTable
CREATE TABLE "AiSummary" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subjectId" TEXT,
    "teamId" TEXT,
    "departmentId" TEXT,
    "updateId" TEXT,
    "periodStart" TEXT NOT NULL,
    "periodEnd" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "sourceCount" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'GENERATED',
    "reviewedById" TEXT,
    "reviewedAt" DATETIME,
    "reviewNote" TEXT,
    "editedAt" DATETIME,
    "generatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AiSummary_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AiSummary_subjectId_organizationId_fkey" FOREIGN KEY ("subjectId", "organizationId") REFERENCES "Membership" ("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AiSummary_teamId_organizationId_fkey" FOREIGN KEY ("teamId", "organizationId") REFERENCES "Team" ("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AiSummary_departmentId_organizationId_fkey" FOREIGN KEY ("departmentId", "organizationId") REFERENCES "Department" ("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AiSummary_updateId_organizationId_fkey" FOREIGN KEY ("updateId", "organizationId") REFERENCES "DailyUpdate" ("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AiSummary_reviewedById_organizationId_fkey" FOREIGN KEY ("reviewedById", "organizationId") REFERENCES "Membership" ("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AiSummary_organizationId_kind_periodStart_idx" ON "AiSummary"("organizationId", "kind", "periodStart");

-- CreateIndex
CREATE INDEX "AiSummary_organizationId_status_idx" ON "AiSummary"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AiSummary_id_organizationId_key" ON "AiSummary"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "AiSummary_organizationId_kind_scopeKey_periodStart_key" ON "AiSummary"("organizationId", "kind", "scopeKey", "periodStart");
