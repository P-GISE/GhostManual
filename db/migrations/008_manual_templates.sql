CREATE TABLE manual_templates (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
  status text NOT NULL DEFAULT 'reading' CHECK (status IN ('reading','review','ready','failed')),
  extraction jsonb,
  items jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(items) = 'array'),
  is_default boolean NOT NULL DEFAULT false CHECK (NOT is_default OR status = 'ready'),
  file_name text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 255),
  file_type text NOT NULL CHECK (file_type IN ('docx','hwpx')),
  content bytea NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 5242880),
  file_bytes bigint GENERATED ALWAYS AS (octet_length(content)) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,id),
  CHECK (jsonb_array_length(items) <= 30),
  CHECK (status <> 'ready' OR jsonb_array_length(items) >= 1)
);
CREATE UNIQUE INDEX manual_templates_default ON manual_templates(workspace_id) WHERE is_default;

CREATE TABLE manual_template_jobs (
  template_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  session_id uuid NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  lease_token uuid,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((lease_token IS NULL) = (lease_until IS NULL)),
  FOREIGN KEY (workspace_id, template_id) REFERENCES manual_templates(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX manual_template_jobs_pending ON manual_template_jobs(created_at);

CREATE FUNCTION workspace_file_bytes(target uuid) RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT (SELECT COALESCE(sum(size_bytes),0) FROM source_files WHERE workspace_id=target)
       + (SELECT COALESCE(sum(file_bytes),0) FROM manual_templates WHERE workspace_id=target);
$$;
