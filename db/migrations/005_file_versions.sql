ALTER TABLE sources
  ADD COLUMN kind text NOT NULL DEFAULT 'text' CHECK (kind IN ('text','file')),
  ADD COLUMN file_type text CHECK (file_type IN ('xlsx')),
  ADD CONSTRAINT sources_kind_file_type CHECK ((kind = 'file') = (file_type IS NOT NULL));

ALTER TABLE source_revisions DROP CONSTRAINT source_revisions_text_check;
ALTER TABLE source_revisions ADD CONSTRAINT source_revisions_text_check
  CHECK (char_length(text) BETWEEN 1 AND 20000);
ALTER TABLE source_revisions
  ADD COLUMN uploaded_by_name text CHECK (char_length(uploaded_by_name) BETWEEN 1 AND 40),
  ADD COLUMN uploaded_by_department text CHECK (char_length(uploaded_by_department) BETWEEN 1 AND 40);
ALTER TABLE users ADD COLUMN department text CHECK (char_length(department) BETWEEN 1 AND 40);

CREATE TABLE source_files(
  revision_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  file_name text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 255),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  content bytea NOT NULL,
  compare_status text NOT NULL CHECK (compare_status IN ('compared','limit_exceeded')),
  snapshot jsonb,
  ai_summary text CHECK (char_length(ai_summary) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, revision_id),
  FOREIGN KEY (workspace_id, revision_id) REFERENCES source_revisions(workspace_id, id) ON DELETE CASCADE,
  CHECK (size_bytes = octet_length(content)),
  CHECK ((compare_status = 'compared') = (snapshot IS NOT NULL)),
  CHECK (snapshot IS NULL OR COALESCE(
    jsonb_typeof(snapshot) = 'object' AND snapshot->'v' = '1'::jsonb
    AND jsonb_typeof(snapshot->'sheets') = 'array'
    AND jsonb_typeof(snapshot->'names') = 'array', false))
);
CREATE INDEX source_files_workspace ON source_files(workspace_id);
CREATE TRIGGER immutable_source_file BEFORE UPDATE ON source_files
  FOR EACH ROW EXECUTE FUNCTION forbid_snapshot_update();

CREATE TABLE change_groups(
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  kind text NOT NULL CHECK (kind IN ('sheet_added','sheet_removed','formula_added','formula_changed',
    'formula_removed','filter_changed','names_changed','size_changed','values_changed')),
  sheet text,
  range text,
  summary jsonb NOT NULL CHECK (jsonb_typeof(summary) = 'object'),
  UNIQUE (revision_id, position),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, revision_id) REFERENCES source_revisions(workspace_id, id) ON DELETE CASCADE
);
CREATE TRIGGER immutable_change_group BEFORE UPDATE ON change_groups
  FOR EACH ROW EXECUTE FUNCTION forbid_snapshot_update();

CREATE TABLE revision_questions(
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  position integer NOT NULL CHECK (position BETWEEN 0 AND 9),
  kind text NOT NULL CHECK (kind IN ('purpose','origin','change','other')),
  group_positions integer[] NOT NULL DEFAULT '{}',
  question text NOT NULL CHECK (char_length(question) BETWEEN 1 AND 500),
  answer text CHECK (char_length(answer) BETWEEN 1 AND 2000),
  skipped boolean NOT NULL DEFAULT false,
  answered_at timestamptz,
  source text NOT NULL DEFAULT 'rule' CHECK (source IN ('rule','ai')),
  UNIQUE (revision_id, position),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, revision_id) REFERENCES source_revisions(workspace_id, id) ON DELETE CASCADE,
  CHECK (NOT (skipped AND answer IS NOT NULL)),
  CHECK ((answer IS NOT NULL OR skipped) = (answered_at IS NOT NULL))
);

-- Array positions need an explicit same-revision check; an array cannot carry a foreign key.
CREATE FUNCTION validate_revision_question() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND
    ROW(NEW.id,NEW.workspace_id,NEW.revision_id,NEW.position,NEW.kind,NEW.group_positions,NEW.question,NEW.source)
    IS DISTINCT FROM
    ROW(OLD.id,OLD.workspace_id,OLD.revision_id,OLD.position,OLD.kind,OLD.group_positions,OLD.question,OLD.source)
  THEN
    RAISE EXCEPTION 'Question identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(NEW.group_positions) AS referenced(position)
    WHERE NOT EXISTS (
      SELECT 1 FROM change_groups g WHERE g.workspace_id=NEW.workspace_id
      AND g.revision_id=NEW.revision_id AND g.position=referenced.position
    )
  ) THEN
    RAISE EXCEPTION 'Question groups must belong to its revision' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER valid_revision_question BEFORE INSERT OR UPDATE ON revision_questions
  FOR EACH ROW EXECUTE FUNCTION validate_revision_question();

ALTER TABLE manual_versions ADD COLUMN history jsonb
  CHECK (history IS NULL OR COALESCE(
    jsonb_typeof(history) = 'object' AND history->'v' = '1'::jsonb
    AND jsonb_typeof(history->'revisions') = 'array', false));
