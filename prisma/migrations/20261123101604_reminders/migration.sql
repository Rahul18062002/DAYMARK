-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_OrgSettings" (
    "organizationId" TEXT NOT NULL PRIMARY KEY,
    "updateCutoffTime" TEXT NOT NULL DEFAULT '18:00',
    "editWindowHours" INTEGER NOT NULL DEFAULT 24,
    "workingDays" TEXT NOT NULL DEFAULT '1,2,3,4,5',
    "aiEnabled" BOOLEAN NOT NULL DEFAULT true,
    "visibilityScope" TEXT NOT NULL DEFAULT 'OWN',
    "peersSeeBlockers" BOOLEAN NOT NULL DEFAULT false,
    "reminderEnabled" BOOLEAN NOT NULL DEFAULT false,
    "reminderTime" TEXT NOT NULL DEFAULT '16:00',
    "automationsManagerAccess" BOOLEAN NOT NULL DEFAULT false,
    "automationsIncludeBlockerText" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OrgSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_OrgSettings" ("aiEnabled", "automationsIncludeBlockerText", "automationsManagerAccess", "editWindowHours", "organizationId", "peersSeeBlockers", "updateCutoffTime", "updatedAt", "visibilityScope", "workingDays") SELECT "aiEnabled", "automationsIncludeBlockerText", "automationsManagerAccess", "editWindowHours", "organizationId", "peersSeeBlockers", "updateCutoffTime", "updatedAt", "visibilityScope", "workingDays" FROM "OrgSettings";
DROP TABLE "OrgSettings";
ALTER TABLE "new_OrgSettings" RENAME TO "OrgSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
