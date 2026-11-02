-- One-time provisioning after migrations, as ghostmanual in its dedicated database.
-- A pre-existing role name is an error. Set its password privately after commit.
\set ON_ERROR_STOP on
BEGIN;
DO $$
BEGIN
  IF current_database() <> 'ghostmanual' OR current_user <> 'ghostmanual' THEN
    RAISE EXCEPTION 'Connect to ghostmanual as migration owner ghostmanual';
  END IF;
END $$;

CREATE ROLE ghostmanual_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS NOINHERIT;
GRANT CONNECT ON DATABASE ghostmanual TO ghostmanual_app;
GRANT USAGE ON SCHEMA public TO ghostmanual_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ghostmanual_app;
REVOKE INSERT, UPDATE, DELETE ON public.schema_migrations FROM ghostmanual_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ghostmanual IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ghostmanual_app;

-- Refuse legacy PUBLIC CREATE grants instead of changing other database users.
DO $$
BEGIN
  IF has_database_privilege('ghostmanual_app', current_database(), 'CREATE')
     OR has_schema_privilege('ghostmanual_app', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'Unexpected inherited CREATE privilege; review database/schema ACLs';
  END IF;
END $$;
COMMIT;
