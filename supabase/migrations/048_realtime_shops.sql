-- Enable Realtime on the shops table so clients can receive live updates
-- when the owner modifies role_permissions (or any other shop field).
ALTER PUBLICATION supabase_realtime ADD TABLE shops;
