-- Migration 056 — Permission de suppression de produits par membre
-- Le owner peut activer/désactiver cette permission individuellement
-- pour chaque membre de son équipe.
ALTER TABLE shop_members ADD COLUMN IF NOT EXISTS can_delete_products boolean NOT NULL DEFAULT false;
