-- Keep ordinary writes under immediate FK checks and immutable snapshot guards.
ALTER TABLE change_groups ALTER CONSTRAINT change_groups_workspace_id_revision_id_fkey DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE document_jobs ALTER CONSTRAINT document_jobs_workspace_id_revision_id_fkey DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE document_results ALTER CONSTRAINT document_results_workspace_id_revision_id_fkey DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE manual_versions ALTER CONSTRAINT manual_versions_workspace_id_manual_id_fkey DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE manual_versions ALTER CONSTRAINT manual_versions_workspace_id_source_revision_id_fkey DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE manuals ALTER CONSTRAINT manuals_workspace_id_source_id_fkey DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE manuals ALTER CONSTRAINT manuals_workspace_id_source_revision_id_fkey DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE revision_questions ALTER CONSTRAINT revision_questions_workspace_id_revision_id_fkey DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE shares ALTER CONSTRAINT shares_workspace_id_manual_id_fkey DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE source_files ALTER CONSTRAINT source_files_workspace_id_revision_id_fkey DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE source_revisions ALTER CONSTRAINT source_revisions_workspace_id_source_id_fkey DEFERRABLE INITIALLY IMMEDIATE;

-- The application role cannot impersonate the table owner or execute the move.
CREATE FUNCTION is_source_move(regclass, uuid, uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT current_user = pg_get_userbyid(relowner)
    AND COALESCE(current_setting('ghostmanual.source_move', true), '') = $2::text || ':' || $3::text
    AND $2 <> $3
  FROM pg_class WHERE oid = $1
$$;

CREATE OR REPLACE FUNCTION forbid_snapshot_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF is_source_move(TG_RELID, OLD.workspace_id, NEW.workspace_id)
     AND (to_jsonb(NEW) - 'workspace_id') = (to_jsonb(OLD) - 'workspace_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Snapshots are immutable';
END $$;

CREATE OR REPLACE FUNCTION validate_revision_question() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND
    ROW(NEW.id,NEW.workspace_id,NEW.revision_id,NEW.position,NEW.kind,NEW.group_positions,NEW.question,NEW.source)
    IS DISTINCT FROM
    ROW(OLD.id,OLD.workspace_id,OLD.revision_id,OLD.position,OLD.kind,OLD.group_positions,OLD.question,OLD.source)
    AND NOT (
      is_source_move(TG_RELID, OLD.workspace_id, NEW.workspace_id)
      AND (to_jsonb(NEW) - 'workspace_id') = (to_jsonb(OLD) - 'workspace_id')
    )
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

CREATE FUNCTION move_personal_source(actor uuid, source uuid, target uuid) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  origin uuid;
  revisions uuid[];
  manual uuid;
  questions uuid[];
  readers uuid[];
  move_flag text := COALESCE(current_setting('ghostmanual.source_move', true), '');
BEGIN
  SELECT workspace_id INTO origin FROM sources WHERE id = source;
  IF origin IS NULL OR target IS NULL OR origin = target THEN
    RAISE EXCEPTION 'Invalid source or destination' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(782402);
  PERFORM id FROM workspaces WHERE id IN (origin, target) ORDER BY id FOR UPDATE;

  IF NOT EXISTS (SELECT FROM workspaces WHERE id=origin AND user_id=actor AND team_name IS NULL AND expires_at>now())
    OR NOT EXISTS (
      SELECT FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id
      JOIN users u ON u.id=m.user_id
      WHERE w.id=target AND w.team_name IS NOT NULL AND w.expires_at>now()
        AND m.user_id=actor AND u.terms_agreed_at IS NOT NULL FOR SHARE OF m,u
    ) THEN
    RAISE EXCEPTION 'Source owner or team membership required' USING ERRCODE = '42501';
  END IF;
  PERFORM id FROM sources WHERE id=source AND workspace_id=origin FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source changed during move' USING ERRCODE = '40001';
  END IF;
  SELECT ARRAY(SELECT id FROM source_revisions WHERE source_id=source) INTO revisions;
  SELECT id INTO manual FROM manuals WHERE source_id=source AND workspace_id=origin FOR UPDATE;
  IF workspace_file_bytes(target) + (
    SELECT COALESCE(sum(size_bytes),0) FROM source_files WHERE revision_id=ANY(revisions)
  ) > 104857600 THEN
    RAISE EXCEPTION 'Destination storage limit exceeded' USING ERRCODE = '23514';
  END IF;
  PERFORM id FROM document_jobs WHERE revision_id=ANY(revisions) ORDER BY id FOR UPDATE;
  IF EXISTS (SELECT FROM document_jobs WHERE revision_id=ANY(revisions) AND status IN ('queued','processing'))
    OR EXISTS (SELECT FROM operation_requests WHERE workspace_id=origin AND status='processing') THEN
    RAISE EXCEPTION 'Source workspace has pending work' USING ERRCODE = '55000';
  END IF;

  -- Prevent a new Reader session from being attached to a share during the move.
  PERFORM id FROM shares WHERE manual_id=manual FOR UPDATE;
  SELECT ARRAY(SELECT se.id FROM sessions se JOIN shares sh ON sh.id=se.share_id
    WHERE sh.manual_id=manual AND se.workspace_id=origin) INTO readers;
  SELECT ARRAY(
    SELECT q.id FROM question_runs q WHERE q.workspace_id=origin AND (
      q.session_id=ANY(readers)
      OR EXISTS (SELECT FROM evidence e WHERE e.question_id=q.id AND e.source_id=source)
      OR EXISTS (
        SELECT FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(q.result->'evidence')='array' THEN q.result->'evidence' ELSE '[]'::jsonb END
          || CASE WHEN jsonb_typeof(q.result->'searchResults')='array' THEN q.result->'searchResults' ELSE '[]'::jsonb END
        ) item WHERE item->>'sourceId'=source::text OR item->>'manualId'=manual::text
      )
    )
  ) INTO questions;
  DELETE FROM operation_requests o WHERE o.workspace_id=origin AND (
    o.session_id=ANY(readers) OR o.result->>'manualId'=manual::text
      OR EXISTS (SELECT FROM unnest(questions) AS q(id) WHERE q.id::text=o.result->>'id')
  );
  DELETE FROM question_runs WHERE id=ANY(questions);
  DELETE FROM sessions WHERE id=ANY(readers);

  SET CONSTRAINTS
    change_groups_workspace_id_revision_id_fkey,
    document_jobs_workspace_id_revision_id_fkey,
    document_results_workspace_id_revision_id_fkey,
    manual_versions_workspace_id_manual_id_fkey,
    manual_versions_workspace_id_source_revision_id_fkey,
    manuals_workspace_id_source_id_fkey,
    manuals_workspace_id_source_revision_id_fkey,
    revision_questions_workspace_id_revision_id_fkey,
    shares_workspace_id_manual_id_fkey,
    source_files_workspace_id_revision_id_fkey,
    source_revisions_workspace_id_source_id_fkey DEFERRED;
  PERFORM set_config('ghostmanual.source_move', origin::text || ':' || target::text, true);
  UPDATE sources SET workspace_id=target WHERE id=source;
  UPDATE source_revisions SET workspace_id=target WHERE id=ANY(revisions);
  UPDATE source_files SET workspace_id=target WHERE revision_id=ANY(revisions);
  UPDATE change_groups SET workspace_id=target WHERE revision_id=ANY(revisions);
  UPDATE revision_questions SET workspace_id=target WHERE revision_id=ANY(revisions);
  UPDATE document_results SET workspace_id=target WHERE revision_id=ANY(revisions);
  UPDATE document_jobs SET workspace_id=target WHERE revision_id=ANY(revisions);
  UPDATE manuals SET workspace_id=target WHERE id=manual;
  UPDATE manual_versions SET workspace_id=target WHERE manual_id=manual;
  UPDATE shares SET workspace_id=target WHERE manual_id=manual;
  PERFORM set_config('ghostmanual.source_move', move_flag, true);
  SET CONSTRAINTS
    change_groups_workspace_id_revision_id_fkey,
    document_jobs_workspace_id_revision_id_fkey,
    document_results_workspace_id_revision_id_fkey,
    manual_versions_workspace_id_manual_id_fkey,
    manual_versions_workspace_id_source_revision_id_fkey,
    manuals_workspace_id_source_id_fkey,
    manuals_workspace_id_source_revision_id_fkey,
    revision_questions_workspace_id_revision_id_fkey,
    shares_workspace_id_manual_id_fkey,
    source_files_workspace_id_revision_id_fkey,
    source_revisions_workspace_id_source_id_fkey IMMEDIATE;
END $$;

REVOKE ALL ON FUNCTION move_personal_source(uuid, uuid, uuid) FROM PUBLIC;