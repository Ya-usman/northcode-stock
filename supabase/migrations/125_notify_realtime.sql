-- Active le temps réel sur admin_notifications — nécessaire pour que la
-- cloche de notifications côté boutique (owner) reçoive les nouveaux
-- messages du support sans recharger la page. Même mécanisme que
-- 048_realtime_shops.sql.
ALTER PUBLICATION supabase_realtime ADD TABLE admin_notifications;
