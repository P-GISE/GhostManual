ALTER TABLE workspaces ADD COLUMN team_name text
  CHECK (char_length(team_name) BETWEEN 1 AND 40);
ALTER TABLE workspaces ADD CONSTRAINT team_workspace_identity
  CHECK (team_name IS NULL OR (user_id IS NULL AND expires_at = 'infinity'::timestamptz));

CREATE TABLE workspace_members (
  workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin','member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id,user_id)
);
CREATE INDEX workspace_members_user ON workspace_members(user_id);

CREATE TABLE workspace_invites (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  email text NOT NULL CHECK (email=lower(email) AND char_length(email) BETWEEN 3 AND 254),
  token_hash text UNIQUE NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by uuid REFERENCES users ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX workspace_invites_open ON workspace_invites(workspace_id,email)
  WHERE accepted_at IS NULL;

ALTER TABLE sources ADD COLUMN created_by uuid REFERENCES users ON DELETE SET NULL;
UPDATE sources s SET created_by=w.user_id FROM workspaces w WHERE w.id=s.workspace_id;
ALTER TABLE manual_templates ADD COLUMN created_by uuid REFERENCES users ON DELETE SET NULL;
UPDATE manual_templates t SET created_by=w.user_id FROM workspaces w WHERE w.id=t.workspace_id;
ALTER TABLE manual_versions ADD COLUMN published_by_name text
  CHECK (char_length(published_by_name) BETWEEN 1 AND 40);
