-- CreateTable
CREATE TABLE "Objective" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "departmentId" TEXT,
    "teamId" TEXT,
    "parentId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "periodStart" TEXT NOT NULL,
    "periodEnd" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Objective_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Objective_ownerId_organizationId_fkey" FOREIGN KEY ("ownerId", "organizationId") REFERENCES "Membership" ("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Objective_departmentId_organizationId_fkey" FOREIGN KEY ("departmentId", "organizationId") REFERENCES "Department" ("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Objective_teamId_organizationId_fkey" FOREIGN KEY ("teamId", "organizationId") REFERENCES "Team" ("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Objective_parentId_organizationId_fkey" FOREIGN KEY ("parentId", "organizationId") REFERENCES "Objective" ("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Objective_createdById_organizationId_fkey" FOREIGN KEY ("createdById", "organizationId") REFERENCES "Membership" ("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KeyResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "objectiveId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'NUMBER',
    "startValue" REAL NOT NULL DEFAULT 0,
    "targetValue" REAL NOT NULL,
    "currentValue" REAL NOT NULL DEFAULT 0,
    "unit" TEXT,
    "isKpi" BOOLEAN NOT NULL DEFAULT false,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "confidence" TEXT NOT NULL DEFAULT 'ON_TRACK',
    "lastCheckInAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "KeyResult_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "KeyResult_objectiveId_organizationId_fkey" FOREIGN KEY ("objectiveId", "organizationId") REFERENCES "Objective" ("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "KeyResult_ownerId_organizationId_fkey" FOREIGN KEY ("ownerId", "organizationId") REFERENCES "Membership" ("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KeyResultCheckIn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "keyResultId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "value" REAL NOT NULL,
    "confidence" TEXT NOT NULL,
    "comment" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KeyResultCheckIn_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "KeyResultCheckIn_keyResultId_organizationId_fkey" FOREIGN KEY ("keyResultId", "organizationId") REFERENCES "KeyResult" ("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "KeyResultCheckIn_authorId_organizationId_fkey" FOREIGN KEY ("authorId", "organizationId") REFERENCES "Membership" ("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "objectiveId" TEXT NOT NULL,
    "keyResultId" TEXT,
    "assigneeId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'TODO',
    "dueDate" TEXT,
    "doneAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkTask_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkTask_objectiveId_organizationId_fkey" FOREIGN KEY ("objectiveId", "organizationId") REFERENCES "Objective" ("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkTask_keyResultId_organizationId_fkey" FOREIGN KEY ("keyResultId", "organizationId") REFERENCES "KeyResult" ("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WorkTask_assigneeId_organizationId_fkey" FOREIGN KEY ("assigneeId", "organizationId") REFERENCES "Membership" ("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WorkTask_createdById_organizationId_fkey" FOREIGN KEY ("createdById", "organizationId") REFERENCES "Membership" ("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Objective_organizationId_periodStart_periodEnd_idx" ON "Objective"("organizationId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "Objective_organizationId_ownerId_idx" ON "Objective"("organizationId", "ownerId");

-- CreateIndex
CREATE INDEX "Objective_organizationId_parentId_idx" ON "Objective"("organizationId", "parentId");

-- CreateIndex
CREATE INDEX "Objective_organizationId_level_idx" ON "Objective"("organizationId", "level");

-- CreateIndex
CREATE UNIQUE INDEX "Objective_id_organizationId_key" ON "Objective"("id", "organizationId");

-- CreateIndex
CREATE INDEX "KeyResult_organizationId_objectiveId_idx" ON "KeyResult"("organizationId", "objectiveId");

-- CreateIndex
CREATE INDEX "KeyResult_organizationId_ownerId_idx" ON "KeyResult"("organizationId", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "KeyResult_id_organizationId_key" ON "KeyResult"("id", "organizationId");

-- CreateIndex
CREATE INDEX "KeyResultCheckIn_keyResultId_createdAt_idx" ON "KeyResultCheckIn"("keyResultId", "createdAt");

-- CreateIndex
CREATE INDEX "KeyResultCheckIn_organizationId_createdAt_idx" ON "KeyResultCheckIn"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkTask_organizationId_objectiveId_idx" ON "WorkTask"("organizationId", "objectiveId");

-- CreateIndex
CREATE INDEX "WorkTask_organizationId_assigneeId_status_idx" ON "WorkTask"("organizationId", "assigneeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WorkTask_id_organizationId_key" ON "WorkTask"("id", "organizationId");
