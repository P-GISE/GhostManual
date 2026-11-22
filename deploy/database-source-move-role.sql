-- Run as migration owner after 010 and 011, when source moves are approved.
-- This grants only the session-authenticated entry point.
\set ON_ERROR_STOP on
BEGIN;
GRANT EXECUTE ON FUNCTION public.move_personal_source_for_session(text, uuid, uuid) TO ghostmanual_app;
COMMIT;
