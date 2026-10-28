CREATE TABLE password_resets(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,token_hash text UNIQUE NOT NULL,expires_at timestamptz NOT NULL,used_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX password_reset_user ON password_resets(user_id);
