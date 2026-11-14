-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "expiresAt" DATETIME NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" DATETIME,
    "refreshTokenExpiresAt" DATETIME,
    "scope" TEXT,
    "password" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "lastRequest" BIGINT NOT NULL
);

-- CreateTable
CREATE TABLE "RequestThrottle" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "count" INTEGER NOT NULL,
    "windowStart" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "plan" TEXT NOT NULL DEFAULT 'free',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "OrgSettings" (
    "organizationId" TEXT NOT NULL PRIMARY KEY,
    "updateCutoffTime" TEXT NOT NULL DEFAULT '18:00',
    "editWindowHours" INTEGER NOT NULL DEFAULT 24,
    "workingDays" TEXT NOT NULL DEFAULT '1,2,3,4,5',
    "aiEnabled" BOOLEAN NOT NULL DEFAULT true,
    "automationsManagerAccess" BOOLEAN NOT NULL DEFAULT false,
    "automationsIncludeBlockerText" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OrgSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Department_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "departmentId" TEXT,
    "name" TEXT NOT NULL,
    "managerId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Team_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Team_departmentId_organizationId_fkey" FOREIGN KEY ("departmentId", "organizationId") REFERENCES "Department" ("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Team_managerId_organizationId_fkey" FOREIGN KEY ("managerId", "organizationId") REFERENCES "Membership" ("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "jobTitle" TEXT,
    "departmentId" TEXT,
    "teamId" TEXT,
    "managerId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deactivatedAt" DATETIME,
    CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Membership_departmentId_organizationId_fkey" FOREIGN KEY ("departmentId", "organizationId") REFERENCES "Department" ("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Membership_teamId_organizationId_fkey" FOREIGN KEY ("teamId", "organizationId") REFERENCES "Team" ("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Membership_managerId_organizationId_fkey" FOREIGN KEY ("managerId", "organizationId") REFERENCES "Membership" ("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ManagerTeamAccess" (
    "organizationId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("membershipId", "teamId"),
    CONSTRAINT "ManagerTeamAccess_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ManagerTeamAccess_membershipId_organizationId_fkey" FOREIGN KEY ("membershipId", "organizationId") REFERENCES "Membership" ("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ManagerTeamAccess_teamId_organizationId_fkey" FOREIGN KEY ("teamId", "organizationId") REFERENCES "Team" ("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "departmentId" TEXT,
    "teamId" TEXT,
    "managerId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" DATETIME NOT NULL,
    "invitedById" TEXT NOT NULL,
    "acceptedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Invitation_invitedById_organizationId_fkey" FOREIGN KEY ("invitedById", "organizationId") REFERENCES "Membership" ("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DailyUpdate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "updateDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "source" TEXT NOT NULL DEFAULT 'DASHBOARD',
    "hasBlockers" BOOLEAN NOT NULL DEFAULT false,
    "firstSubmittedAt" DATETIME,
    "submittedLate" BOOLEAN NOT NULL DEFAULT false,
    "lastEditedAt" DATETIME,
    "revisionCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DailyUpdate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DailyUpdate_membershipId_organizationId_fkey" FOREIGN KEY ("membershipId", "organizationId") REFERENCES "Membership" ("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UpdateItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "dailyUpdateId" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    CONSTRAINT "UpdateItem_dailyUpdateId_organizationId_fkey" FOREIGN KEY ("dailyUpdateId", "organizationId") REFERENCES "DailyUpdate" ("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UpdateAttachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "dailyUpdateId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT,
    CONSTRAINT "UpdateAttachment_dailyUpdateId_organizationId_fkey" FOREIGN KEY ("dailyUpdateId", "organizationId") REFERENCES "DailyUpdate" ("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UpdateRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "dailyUpdateId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "statusAtTime" TEXT NOT NULL,
    "changedByUserId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UpdateRevision_dailyUpdateId_organizationId_fkey" FOREIGN KEY ("dailyUpdateId", "organizationId") REFERENCES "DailyUpdate" ("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AutomationFlow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "flowKey" TEXT NOT NULL,
    "urlEnc" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL,
    "eventType" TEXT,
    "lastSyncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AutomationFlow_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IntegrationEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "payload" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IntegrationEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IntegrationDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "integrationEventId" TEXT NOT NULL,
    "automationFlowId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" DATETIME,
    "lastHttpStatus" INTEGER,
    "lastError" TEXT,
    "deliveredAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "IntegrationDelivery_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "IntegrationDelivery_integrationEventId_organizationId_fkey" FOREIGN KEY ("integrationEventId", "organizationId") REFERENCES "IntegrationEvent" ("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "IntegrationDelivery_automationFlowId_organizationId_fkey" FOREIGN KEY ("automationFlowId", "organizationId") REFERENCES "AutomationFlow" ("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IntegrationAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationMs" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    CONSTRAINT "IntegrationAttempt_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "IntegrationAttempt_deliveryId_organizationId_fkey" FOREIGN KEY ("deliveryId", "organizationId") REFERENCES "IntegrationDelivery" ("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JobLock" (
    "name" TEXT NOT NULL PRIMARY KEY,
    "owner" TEXT NOT NULL,
    "lockedUntil" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE INDEX "Verification_identifier_idx" ON "Verification"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "RateLimit_key_key" ON "RateLimit"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Department_id_organizationId_key" ON "Department"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Department_organizationId_name_key" ON "Department"("organizationId", "name");

-- CreateIndex
CREATE INDEX "Team_organizationId_managerId_idx" ON "Team"("organizationId", "managerId");

-- CreateIndex
CREATE UNIQUE INDEX "Team_id_organizationId_key" ON "Team"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Team_organizationId_name_key" ON "Team"("organizationId", "name");

-- CreateIndex
CREATE INDEX "Membership_organizationId_status_idx" ON "Membership"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Membership_organizationId_teamId_idx" ON "Membership"("organizationId", "teamId");

-- CreateIndex
CREATE INDEX "Membership_organizationId_managerId_idx" ON "Membership"("organizationId", "managerId");

-- CreateIndex
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_organizationId_key" ON "Membership"("userId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_id_organizationId_key" ON "Membership"("id", "organizationId");

-- CreateIndex
CREATE INDEX "ManagerTeamAccess_organizationId_teamId_idx" ON "ManagerTeamAccess"("organizationId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_organizationId_status_idx" ON "Invitation"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Invitation_organizationId_email_idx" ON "Invitation"("organizationId", "email");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_entityType_entityId_idx" ON "AuditLog"("organizationId", "entityType", "entityId");

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

-- CreateIndex
CREATE INDEX "AutomationFlow_organizationId_eventType_status_idx" ON "AutomationFlow"("organizationId", "eventType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationFlow_organizationId_flowKey_key" ON "AutomationFlow"("organizationId", "flowKey");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationFlow_id_organizationId_key" ON "AutomationFlow"("id", "organizationId");

-- CreateIndex
CREATE INDEX "IntegrationEvent_organizationId_createdAt_idx" ON "IntegrationEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "IntegrationEvent_createdAt_idx" ON "IntegrationEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationEvent_organizationId_eventKey_key" ON "IntegrationEvent"("organizationId", "eventKey");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationEvent_id_organizationId_key" ON "IntegrationEvent"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationEvent_eventId_key" ON "IntegrationEvent"("eventId");

-- CreateIndex
CREATE INDEX "IntegrationDelivery_status_nextAttemptAt_idx" ON "IntegrationDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "IntegrationDelivery_organizationId_createdAt_idx" ON "IntegrationDelivery"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationDelivery_integrationEventId_automationFlowId_key" ON "IntegrationDelivery"("integrationEventId", "automationFlowId");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationDelivery_id_organizationId_key" ON "IntegrationDelivery"("id", "organizationId");

-- CreateIndex
CREATE INDEX "IntegrationAttempt_organizationId_startedAt_idx" ON "IntegrationAttempt"("organizationId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationAttempt_deliveryId_attemptNumber_key" ON "IntegrationAttempt"("deliveryId", "attemptNumber");
