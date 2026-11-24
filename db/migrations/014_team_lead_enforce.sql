LOCK TABLE workspaces IN ACCESS EXCLUSIVE MODE;
LOCK TABLE workspace_members IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT FROM workspaces w WHERE w.team_name IS NOT NULL
      AND NOT EXISTS (
        SELECT FROM workspace_members m
        WHERE m.workspace_id=w.id AND m.role='admin'
      )
  ) THEN
    RAISE EXCEPTION 'A team has no existing administrator' USING ERRCODE='23514';
  END IF;
  IF EXISTS (
    SELECT FROM workspaces w
    WHERE (w.team_name IS NULL AND w.lead_user_id IS NOT NULL)
      OR (w.team_name IS NOT NULL AND w.lead_user_id IS NOT NULL
        AND NOT EXISTS (
          SELECT FROM workspace_members m WHERE m.workspace_id=w.id
            AND m.user_id=w.lead_user_id AND m.role='admin'
        ))
  ) THEN
    RAISE EXCEPTION 'An existing lead identity is invalid' USING ERRCODE='23514';
  END IF;
END $$;

UPDATE workspaces w
SET lead_user_id=(
  SELECT m.user_id FROM workspace_members m
  WHERE m.workspace_id=w.id AND m.role='admin'
  ORDER BY m.joined_at,m.user_id LIMIT 1
)
WHERE w.team_name IS NOT NULL AND w.lead_user_id IS NULL;

ALTER TABLE workspaces
  ADD CONSTRAINT personal_workspace_no_lead
    CHECK (team_name IS NOT NULL OR lead_user_id IS NULL),
  ADD CONSTRAINT team_lead_membership_fk
    FOREIGN KEY (id,lead_user_id)
    REFERENCES workspace_members(workspace_id,user_id)
    ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION lock_team_lead_workspace() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE targets uuid[] := ARRAY[]::uuid[];
BEGIN
  IF TG_OP <> 'INSERT' THEN targets := array_append(targets,OLD.workspace_id); END IF;
  IF TG_OP <> 'DELETE' THEN targets := array_append(targets,NEW.workspace_id); END IF;
  PERFORM id FROM public.workspaces WHERE id=ANY(targets) ORDER BY id FOR UPDATE;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER team_lead_member_lock
  BEFORE INSERT OR UPDATE OR DELETE ON workspace_members
  FOR EACH ROW EXECUTE FUNCTION lock_team_lead_workspace();

CREATE FUNCTION validate_team_lead_state() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE targets uuid[] := ARRAY[]::uuid[];
workspace record;
BEGIN
  IF TG_TABLE_NAME = 'workspaces' THEN
    IF TG_OP <> 'INSERT' THEN targets := array_append(targets,OLD.id); END IF;
    IF TG_OP <> 'DELETE' THEN targets := array_append(targets,NEW.id); END IF;
  ELSE
    IF TG_OP <> 'INSERT' THEN targets := array_append(targets,OLD.workspace_id); END IF;
    IF TG_OP <> 'DELETE' THEN targets := array_append(targets,NEW.workspace_id); END IF;
  END IF;
  FOR workspace IN
    SELECT id,team_name,lead_user_id FROM public.workspaces WHERE id=ANY(targets) ORDER BY id
  LOOP
    IF workspace.team_name IS NOT NULL AND (
      workspace.lead_user_id IS NULL OR NOT EXISTS (
        SELECT FROM public.workspace_members m
        WHERE m.workspace_id=workspace.id AND m.user_id=workspace.lead_user_id AND m.role='admin'
      )
    ) THEN
      RAISE EXCEPTION 'A live team requires an administrator lead'
        USING ERRCODE='23514', CONSTRAINT='team_lead_admin_required';
    END IF;
  END LOOP;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER team_lead_workspace_valid
  AFTER INSERT OR UPDATE OR DELETE ON workspaces
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_team_lead_state();

CREATE CONSTRAINT TRIGGER team_lead_membership_valid
  AFTER INSERT OR UPDATE OR DELETE ON workspace_members
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_team_lead_state();
