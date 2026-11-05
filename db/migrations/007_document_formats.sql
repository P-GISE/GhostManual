ALTER TABLE sources DROP CONSTRAINT sources_file_type_check;
ALTER TABLE sources ADD CHECK (file_type IN ('xlsx','docx','hwpx','pptx','csv','hwp','doc','ppt','pdf'));
ALTER TABLE source_files ADD COLUMN file_type text NOT NULL DEFAULT 'xlsx';
ALTER TABLE source_files ALTER COLUMN compare_status DROP NOT NULL;
ALTER TABLE source_files DROP CONSTRAINT source_files_check1;
ALTER TABLE source_files ADD CHECK (
 (file_type='xlsx' AND compare_status IS NOT NULL AND ((compare_status='compared')=(snapshot IS NOT NULL))) OR
 (file_type IN ('docx','hwpx','pptx','csv','hwp','doc','ppt','pdf') AND compare_status IS NULL AND snapshot IS NULL AND ai_summary IS NULL));
CREATE FUNCTION validate_source_file_format() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM source_revisions r JOIN sources s ON s.id=r.source_id
 WHERE r.id=NEW.revision_id AND r.workspace_id=NEW.workspace_id AND s.file_type=NEW.file_type) THEN
 RAISE EXCEPTION 'File format must match source' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER valid_source_file_format BEFORE INSERT ON source_files FOR EACH ROW EXECUTE FUNCTION validate_source_file_format();
ALTER TABLE change_groups DROP CONSTRAINT change_groups_kind_check;
ALTER TABLE change_groups ADD CHECK (kind IN ('sheet_added','sheet_removed','formula_added','formula_changed','formula_removed','filter_changed','names_changed','size_changed','values_changed','block_added','block_removed','block_modified'));
CREATE TABLE document_results (
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL,
 revision_id uuid NOT NULL UNIQUE,
 status text NOT NULL CHECK(status IN ('ready','limited','failed','rejected')),
 reason text CHECK(char_length(reason)<=500),
 coverage jsonb NOT NULL CHECK(jsonb_typeof(coverage)='array'),
 snapshot jsonb,
 comparison jsonb NOT NULL,
 question_ids uuid[] NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,revision_id) REFERENCES source_files(workspace_id,revision_id) ON DELETE CASCADE,
 CHECK ((status='ready' AND snapshot IS NOT NULL) OR (status<>'ready')),
 CHECK (status IN ('ready','limited') OR snapshot IS NULL)
);
CREATE TRIGGER immutable_document_result BEFORE UPDATE ON document_results FOR EACH ROW EXECUTE FUNCTION forbid_snapshot_update();
CREATE TABLE document_jobs (
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL,
 revision_id uuid NOT NULL UNIQUE,
 session_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','ready','limited','failed','rejected')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 lease_token uuid,
 lease_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,revision_id) REFERENCES source_files(workspace_id,revision_id) ON DELETE CASCADE,
 CHECK((status='processing')=(lease_token IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE INDEX document_jobs_pending ON document_jobs(status,created_at);

CREATE FUNCTION validate_document_selection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM source_files WHERE revision_id=NEW.revision_id AND file_type='xlsx') OR
 NEW.question_ids IS DISTINCT FROM ARRAY(SELECT id FROM revision_questions WHERE revision_id=NEW.revision_id ORDER BY position) THEN
 RAISE EXCEPTION 'Invalid document selection' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER valid_document_selection BEFORE INSERT ON document_results FOR EACH ROW EXECUTE FUNCTION validate_document_selection();
CREATE FUNCTION prevent_selected_document_questions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM document_results WHERE revision_id=NEW.revision_id) THEN
 RAISE EXCEPTION 'Selected document question identities are frozen' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER frozen_document_questions BEFORE INSERT ON revision_questions FOR EACH ROW EXECUTE FUNCTION prevent_selected_document_questions();
