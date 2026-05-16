-- Migration 050 — Audit logs
-- Traces les actions sensibles : suppression membre, modification permissions,
-- invitation, paiement, connexion échouée, etc.

CREATE TABLE IF NOT EXISTS audit_logs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     uuid        REFERENCES shops(id) ON DELETE SET NULL,
  actor_id    uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  actor_email text,
  action      text        NOT NULL,
  target_id   text,
  target_type text,
  metadata    jsonb       DEFAULT '{}',
  ip          text,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_shop_id   ON audit_logs(shop_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_id  ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action    ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created   ON audit_logs(created_at DESC);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Super admin voit tout
CREATE POLICY "audit_super_admin" ON audit_logs
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

-- Owner voit les logs de sa boutique
CREATE POLICY "audit_owner_read" ON audit_logs
  FOR SELECT USING (
    shop_id IN (
      SELECT sm.shop_id FROM shop_members sm
      WHERE sm.user_id = auth.uid() AND sm.role = 'owner' AND sm.is_active = true
    )
  );

-- Les routes API insèrent via service role (pas de policy INSERT pour les users)
