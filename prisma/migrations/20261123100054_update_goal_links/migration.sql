-- CreateTable
CREATE TABLE "UpdateGoalLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "dailyUpdateId" TEXT NOT NULL,
    "objectiveId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UpdateGoalLink_dailyUpdateId_organizationId_fkey" FOREIGN KEY ("dailyUpdateId", "organizationId") REFERENCES "DailyUpdate" ("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UpdateGoalLink_objectiveId_organizationId_fkey" FOREIGN KEY ("objectiveId", "organizationId") REFERENCES "Objective" ("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "UpdateGoalLink_organizationId_objectiveId_idx" ON "UpdateGoalLink"("organizationId", "objectiveId");

-- CreateIndex
CREATE UNIQUE INDEX "UpdateGoalLink_dailyUpdateId_objectiveId_key" ON "UpdateGoalLink"("dailyUpdateId", "objectiveId");
