-- ============================================================
-- Migration 090 : Réglages d'alerte péremption par boutique
-- ============================================================
-- Même pattern que low_stock_threshold/notify_email_low_stock (001) et
-- notify_push_low_stock (045) — un cron d'alerte péremption (à venir)
-- s'appuiera sur ces colonnes pour savoir quand et comment notifier.

ALTER TABLE shops ADD COLUMN IF NOT EXISTS expiry_alert_days int DEFAULT 14;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS notify_email_expiry boolean DEFAULT true;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS notify_push_expiry boolean DEFAULT true;
