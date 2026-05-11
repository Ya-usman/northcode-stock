-- ============================================================
-- Migration 031 : Add role_permissions JSONB column to shops
-- ============================================================
-- Allows owners to configure which features each role can access.
-- NULL = use app defaults (defined in use-role-permissions.ts).

ALTER TABLE shops ADD COLUMN IF NOT EXISTS role_permissions JSONB;
