-- Admin page (OPS-ADMIN 1): per-account admin flag, AI permission and storage limit, plus a change log.
ALTER TABLE users ADD COLUMN is_admin boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN ai_allowed boolean NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN storage_limit_bytes bigint
  CHECK (storage_limit_bytes BETWEEN 1048576 AND 1073741824);
CREATE TABLE admin_events(
  id uuid PRIMARY KEY,
  admin_user_id uuid REFERENCES users ON DELETE SET NULL,
  target_user_id uuid REFERENCES users ON DELETE CASCADE,
  change jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_events_created ON admin_events(created_at DESC);
