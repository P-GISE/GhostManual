-- Pin temporary schemas last before entering owner-only move code.
ALTER FUNCTION move_personal_source(uuid, uuid, uuid) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION is_source_move(regclass, uuid, uuid) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION forbid_snapshot_update() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION validate_revision_question() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION workspace_file_bytes(uuid) SET search_path = pg_catalog, public, pg_temp;

CREATE FUNCTION move_personal_source_for_session(bearer text, source uuid, target uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  actor uuid;
  origin uuid;
BEGIN
  IF bearer IS NULL OR bearer !~ '^[A-Za-z0-9_-]{43}$' THEN
    RAISE EXCEPTION 'Live personal owner session required' USING ERRCODE = '28000';
  END IF;
  PERFORM pg_advisory_xact_lock(782402);
  SELECT se.workspace_id INTO origin FROM public.sessions se
    WHERE se.token_hash=encode(sha256(convert_to(bearer,'UTF8')),'hex');
  PERFORM id FROM public.workspaces WHERE id IN (origin,target) ORDER BY id FOR UPDATE;
  SELECT se.user_id INTO actor
    FROM public.sessions se
    JOIN public.workspaces w ON w.id=se.workspace_id
    JOIN public.users u ON u.id=se.user_id
    WHERE se.token_hash=encode(sha256(convert_to(bearer,'UTF8')),'hex')
      AND se.workspace_id=origin AND se.role='owner' AND se.expires_at>now()
      AND w.expires_at>now() AND w.team_name IS NULL AND w.user_id=se.user_id
      AND u.terms_agreed_at IS NOT NULL
    FOR SHARE OF se,u;
  IF actor IS NULL THEN
    RAISE EXCEPTION 'Live personal owner session required' USING ERRCODE = '28000';
  END IF;
  IF NOT EXISTS (SELECT FROM public.sources WHERE id=source AND workspace_id=origin) THEN
    RAISE EXCEPTION 'Source unavailable' USING ERRCODE = '22023';
  END IF;
  PERFORM public.move_personal_source(actor,source,target);
END $$;
REVOKE ALL ON FUNCTION move_personal_source_for_session(text, uuid, uuid) FROM PUBLIC;
