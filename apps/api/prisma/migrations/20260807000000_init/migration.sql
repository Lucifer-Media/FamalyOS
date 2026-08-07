-- Family OS — Итерация 1: начальная миграция
-- CreateEnum
CREATE TYPE "RecordStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'VOID');
CREATE TYPE "ConfidentialityLevel" AS ENUM ('STANDARD', 'SENSITIVE', 'STRICTLY_CONFIDENTIAL');
CREATE TYPE "FamilyRole" AS ENUM ('OWNER', 'PARTNER', 'ADULT', 'CHILD', 'RELATIVE', 'GUEST', 'LIMITED');
CREATE TYPE "MembershipStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'LEFT');
CREATE TYPE "PermissionResource" AS ENUM ('GENERAL', 'DOCUMENTS', 'FINANCE', 'MEDICAL', 'CONFIDENTIAL', 'INTEGRATIONS', 'USERS', 'KNOWLEDGE_BASE', 'FILES');
CREATE TYPE "PermissionAction" AS ENUM ('VIEW', 'CREATE', 'EDIT', 'ARCHIVE', 'MANAGE');
CREATE TYPE "EntityVersionAction" AS ENUM ('CREATE', 'UPDATE', 'ARCHIVE', 'UNARCHIVE', 'VOID', 'REVERT');
CREATE TYPE "StorageBackend" AS ENUM ('LOCAL', 'S3_COMPATIBLE');

-- CreateTable family_spaces
CREATE TABLE "family_spaces" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseCurrency" TEXT NOT NULL DEFAULT 'RUB',
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "family_spaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable users
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "twoFactorSecret" TEXT,
    "twoFactorRecoveryCodes" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateTable sessions
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateTable login_attempts
CREATE TABLE "login_attempts" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "userId" TEXT,
    "success" BOOLEAN NOT NULL,
    "reason" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "login_attempts_email_createdAt_idx" ON "login_attempts"("email", "createdAt");

-- CreateTable people
CREATE TABLE "people" (
    "id" TEXT NOT NULL,
    "familySpaceId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "birthDate" TIMESTAMP(3),
    "gender" TEXT,
    "citizenship" TEXT,
    "contacts" JSONB,
    "addresses" JSONB,
    "notes" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "confidentialityLevel" "ConfidentialityLevel" NOT NULL DEFAULT 'STANDARD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "people_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "people_familySpaceId_idx" ON "people"("familySpaceId");

-- CreateTable memberships
CREATE TABLE "memberships" (
    "id" TEXT NOT NULL,
    "familySpaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "role" "FamilyRole" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "invitedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "memberships_familySpaceId_userId_key" ON "memberships"("familySpaceId", "userId");
CREATE INDEX "memberships_familySpaceId_idx" ON "memberships"("familySpaceId");

-- CreateTable membership_permission_overrides
CREATE TABLE "membership_permission_overrides" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "familySpaceId" TEXT NOT NULL,
    "resource" "PermissionResource" NOT NULL,
    "action" "PermissionAction" NOT NULL,
    "allowed" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,
    CONSTRAINT "membership_permission_overrides_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "mpo_membershipId_resource_action_key" ON "membership_permission_overrides"("membershipId", "resource", "action");

-- CreateTable invitations
CREATE TABLE "invitations" (
    "id" TEXT NOT NULL,
    "familySpaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "FamilyRole" NOT NULL,
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "invitedByUserId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "invitations_token_key" ON "invitations"("token");

-- CreateTable entities
CREATE TABLE "entities" (
    "id" TEXT NOT NULL,
    "familySpaceId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "confidentialityLevel" "ConfidentialityLevel" NOT NULL DEFAULT 'STANDARD',
    "ownerPersonId" TEXT,
    "attributes" JSONB NOT NULL,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "searchText" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "entities_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "entities_familySpaceId_entityType_idx" ON "entities"("familySpaceId", "entityType");
CREATE INDEX "entities_familySpaceId_status_idx" ON "entities"("familySpaceId", "status");
-- Полнотекстовый поиск (russian) по названию + содержимому
CREATE INDEX "entities_search_text_fts_idx" ON "entities" USING GIN (to_tsvector('russian', coalesce("searchText", '')));

-- CreateTable entity_versions
CREATE TABLE "entity_versions" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "action" "EntityVersionAction" NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changeSummary" TEXT,
    "revertedFromVersion" INTEGER,
    "changedByUserId" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "entity_versions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "entity_versions_entityId_versionNumber_key" ON "entity_versions"("entityId", "versionNumber");
CREATE INDEX "entity_versions_entityId_idx" ON "entity_versions"("entityId");

-- CreateTable entity_links
CREATE TABLE "entity_links" (
    "id" TEXT NOT NULL,
    "sourceEntityId" TEXT NOT NULL,
    "targetEntityId" TEXT NOT NULL,
    "linkType" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,
    CONSTRAINT "entity_links_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "entity_links_source_target_type_key" ON "entity_links"("sourceEntityId", "targetEntityId", "linkType");
CREATE INDEX "entity_links_sourceEntityId_idx" ON "entity_links"("sourceEntityId");
CREATE INDEX "entity_links_targetEntityId_idx" ON "entity_links"("targetEntityId");

-- CreateTable files
CREATE TABLE "files" (
    "id" TEXT NOT NULL,
    "familySpaceId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "storageBackend" "StorageBackend" NOT NULL DEFAULT 'LOCAL',
    "storageKey" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "confidentialityLevel" "ConfidentialityLevel" NOT NULL DEFAULT 'STANDARD',
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "files_familySpaceId_idx" ON "files"("familySpaceId");

-- CreateTable file_versions
CREATE TABLE "file_versions" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "changeNote" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "file_versions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "file_versions_fileId_versionNumber_key" ON "file_versions"("fileId", "versionNumber");

-- CreateTable entity_files
CREATE TABLE "entity_files" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "relationRole" TEXT NOT NULL DEFAULT 'attachment',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "entity_files_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "entity_files_entityId_fileId_relationRole_key" ON "entity_files"("entityId", "fileId", "relationRole");

-- CreateTable audit_logs
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "familySpaceId" TEXT,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT,
    "resourceId" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "audit_logs_familySpaceId_createdAt_idx" ON "audit_logs"("familySpaceId", "createdAt");
CREATE INDEX "audit_logs_actorUserId_createdAt_idx" ON "audit_logs"("actorUserId", "createdAt");

-- AddForeignKeys
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "login_attempts" ADD CONSTRAINT "login_attempts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "people" ADD CONSTRAINT "people_familySpaceId_fkey" FOREIGN KEY ("familySpaceId") REFERENCES "family_spaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_familySpaceId_fkey" FOREIGN KEY ("familySpaceId") REFERENCES "family_spaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "membership_permission_overrides" ADD CONSTRAINT "mpo_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "membership_permission_overrides" ADD CONSTRAINT "mpo_familySpaceId_fkey" FOREIGN KEY ("familySpaceId") REFERENCES "family_spaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_familySpaceId_fkey" FOREIGN KEY ("familySpaceId") REFERENCES "family_spaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "entities" ADD CONSTRAINT "entities_familySpaceId_fkey" FOREIGN KEY ("familySpaceId") REFERENCES "family_spaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "entities" ADD CONSTRAINT "entities_ownerPersonId_fkey" FOREIGN KEY ("ownerPersonId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "entity_versions" ADD CONSTRAINT "entity_versions_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "entity_versions" ADD CONSTRAINT "entity_versions_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "entity_links" ADD CONSTRAINT "entity_links_sourceEntityId_fkey" FOREIGN KEY ("sourceEntityId") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "entity_links" ADD CONSTRAINT "entity_links_targetEntityId_fkey" FOREIGN KEY ("targetEntityId") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "files" ADD CONSTRAINT "files_familySpaceId_fkey" FOREIGN KEY ("familySpaceId") REFERENCES "family_spaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "files" ADD CONSTRAINT "files_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "entity_files" ADD CONSTRAINT "entity_files_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "entity_files" ADD CONSTRAINT "entity_files_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_familySpaceId_fkey" FOREIGN KEY ("familySpaceId") REFERENCES "family_spaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
