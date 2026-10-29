CREATE TABLE users(id uuid PRIMARY KEY,email text UNIQUE NOT NULL CHECK(email=lower(email) AND char_length(email) BETWEEN 3 AND 254),name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 40),password_hash text,google_sub text UNIQUE,email_verified_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),CHECK(password_hash IS NOT NULL OR google_sub IS NOT NULL));
CREATE TABLE email_verifications(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,token_hash text UNIQUE NOT NULL,expires_at timestamptz NOT NULL,used_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE oauth_states(state_hash text PRIMARY KEY,verifier text NOT NULL,next_path text NOT NULL,expires_at timestamptz NOT NULL);
ALTER TABLE workspaces ADD COLUMN user_id uuid UNIQUE REFERENCES users ON DELETE CASCADE;
ALTER TABLE sessions ADD COLUMN user_id uuid REFERENCES users ON DELETE CASCADE;
ALTER TABLE shares ADD COLUMN link_token text UNIQUE;
CREATE INDEX email_verification_user ON email_verifications(user_id);
