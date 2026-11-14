-- CreateEnum
CREATE TYPE "IntegrationEventType" AS ENUM ('UPDATE_SUBMITTED', 'UPDATE_BLOCKER_REPORTED', 'UPDATE_MISSING');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "AttemptOutcome" AS ENUM ('SUCCESS', 'RETRYABLE_ERROR', 'PERMANENT_ERROR');

-- AlterTable
ALTER TABLE "OrgSettings" ADD COLUMN     "automationsIncludeBlockerText" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "automationsManagerAccess" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "AutomationFlow" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "flowKey" TEXT NOT NULL,
    "urlEnc" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL,
    "eventType" "IntegrationEventType",
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationFlow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "type" "IntegrationEventType" NOT NULL,
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationDelivery" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "integrationEventId" TEXT NOT NULL,
    "automationFlowId" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),
    "lastHttpStatus" INTEGER,
    "lastError" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationAttempt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationMs" INTEGER NOT NULL,
    "outcome" "AttemptOutcome" NOT NULL,
    "httpStatus" INTEGER,
    "errorCode" TEXT,
    "errorMessage" TEXT,

    CONSTRAINT "IntegrationAttempt_pkey" PRIMARY KEY ("id")
);

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

-- AddForeignKey
ALTER TABLE "AutomationFlow" ADD CONSTRAINT "AutomationFlow_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationEvent" ADD CONSTRAINT "IntegrationEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationDelivery" ADD CONSTRAINT "IntegrationDelivery_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationDelivery" ADD CONSTRAINT "IntegrationDelivery_integrationEventId_organizationId_fkey" FOREIGN KEY ("integrationEventId", "organizationId") REFERENCES "IntegrationEvent"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationDelivery" ADD CONSTRAINT "IntegrationDelivery_automationFlowId_organizationId_fkey" FOREIGN KEY ("automationFlowId", "organizationId") REFERENCES "AutomationFlow"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationAttempt" ADD CONSTRAINT "IntegrationAttempt_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationAttempt" ADD CONSTRAINT "IntegrationAttempt_deliveryId_organizationId_fkey" FOREIGN KEY ("deliveryId", "organizationId") REFERENCES "IntegrationDelivery"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
