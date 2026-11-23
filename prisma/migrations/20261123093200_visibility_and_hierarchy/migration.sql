-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Membership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "jobTitle" TEXT,
    "departmentId" TEXT,
    "teamId" TEXT,
    "managerId" TEXT,
    "level" INTEGER,
    "mentorId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deactivatedAt" DATETIME,
    CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Membership_departmentId_organizationId_fkey" FOREIGN KEY ("departmentId", "organizationId") REFERENCES "Department" ("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Membership_teamId_organizationId_fkey" FOREIGN KEY ("teamId", "organizationId") REFERENCES "Team" ("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Membership_managerId_organizationId_fkey" FOREIGN KEY ("managerId", "organizationId") REFERENCES "Membership" ("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Membership_mentorId_organizationId_fkey" FOREIGN KEY ("mentorId", "organizationId") REFERENCES "Membership" ("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Membership" ("createdAt", "deactivatedAt", "departmentId", "id", "jobTitle", "managerId", "organizationId", "role", "status", "teamId", "updatedAt", "userId") SELECT "createdAt", "deactivatedAt", "departmentId", "id", "jobTitle", "managerId", "organizationId", "role", "status", "teamId", "updatedAt", "userId" FROM "Membership";
DROP TABLE "Membership";
ALTER TABLE "new_Membership" RENAME TO "Membership";
CREATE INDEX "Membership_organizationId_status_idx" ON "Membership"("organizationId", "status");
CREATE INDEX "Membership_organizationId_teamId_idx" ON "Membership"("organizationId", "teamId");
CREATE INDEX "Membership_organizationId_managerId_idx" ON "Membership"("organizationId", "managerId");
CREATE INDEX "Membership_organizationId_mentorId_idx" ON "Membership"("organizationId", "mentorId");
CREATE INDEX "Membership_organizationId_departmentId_idx" ON "Membership"("organizationId", "departmentId");
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");
CREATE UNIQUE INDEX "Membership_userId_organizationId_key" ON "Membership"("userId", "organizationId");
CREATE UNIQUE INDEX "Membership_id_organizationId_key" ON "Membership"("id", "organizationId");
CREATE TABLE "new_OrgSettings" (
    "organizationId" TEXT NOT NULL PRIMARY KEY,
    "updateCutoffTime" TEXT NOT NULL DEFAULT '18:00',
    "editWindowHours" INTEGER NOT NULL DEFAULT 24,
    "workingDays" TEXT NOT NULL DEFAULT '1,2,3,4,5',
    "aiEnabled" BOOLEAN NOT NULL DEFAULT true,
    "visibilityScope" TEXT NOT NULL DEFAULT 'OWN',
    "peersSeeBlockers" BOOLEAN NOT NULL DEFAULT false,
    "automationsManagerAccess" BOOLEAN NOT NULL DEFAULT false,
    "automationsIncludeBlockerText" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OrgSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_OrgSettings" ("aiEnabled", "automationsIncludeBlockerText", "automationsManagerAccess", "editWindowHours", "organizationId", "updateCutoffTime", "updatedAt", "workingDays") SELECT "aiEnabled", "automationsIncludeBlockerText", "automationsManagerAccess", "editWindowHours", "organizationId", "updateCutoffTime", "updatedAt", "workingDays" FROM "OrgSettings";
DROP TABLE "OrgSettings";
ALTER TABLE "new_OrgSettings" RENAME TO "OrgSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
