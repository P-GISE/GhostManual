#!/usr/bin/env bash
# Run only on a disposable PG18 container labelled ghostmanual.role-test=true.
# The QA cluster uses local socket trust; this script never reads a password.
set -euo pipefail
container=${1:?specify the disposable container}
[[ $(docker inspect -f '{{index .Config.Labels "ghostmanual.role-test"}}' "$container") == true ]]
cd "$(dirname "$0")/../.."
sql() { docker exec -i "$container" psql -X -qAt -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U "$1" -d ghostmanual "${@:2}"; }
owner=ghostmanual
app=ghostmanual_app
[[ $(sql "$owner" -c "SELECT to_regclass('public.schema_migrations') IS NULL AND NOT EXISTS (SELECT FROM pg_roles WHERE rolname='$app')") == t ]]
sql "$owner" -c 'CREATE TABLE public.schema_migrations(name text PRIMARY KEY)'
for migration in db/migrations/*.sql; do sql "$owner" <"$migration"; done
# Same forbidden operation succeeds under the legacy runtime identity.
sql "$owner" -c 'BEGIN; CREATE TABLE public.qa_ddl(id int); ROLLBACK'
echo 'RED legacy runtime can CREATE TABLE'
sql "$owner" < deploy/database-runtime-role.sql
sql "$owner" -c 'CREATE TABLE public.qa_future(value int)'
deny() {
  local failure
  if failure=$(sql "$app" -c "$1" 2>&1); then echo "unexpectedly allowed: $1" >&2; exit 1; fi
  [[ $failure == *'42501:'* ]] || { echo "$failure" >&2; exit 1; }
  echo "DENIED 42501 $1"
}
sql "$app" <<'SQL'
SELECT 1 FROM public.schema_migrations;
INSERT INTO public.rate_counters VALUES ('role-test',1,now());
UPDATE public.rate_counters SET attempts=2 WHERE key='role-test';
DO $$ BEGIN IF (SELECT attempts FROM public.rate_counters WHERE key='role-test') IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'CRUD mismatch'; END IF; END $$;
DELETE FROM public.rate_counters WHERE key='role-test';
INSERT INTO public.qa_future VALUES (1);
UPDATE public.qa_future SET value=value+1;
SELECT value FROM public.qa_future;
DELETE FROM public.qa_future;
SQL
[[ $(sql "$owner" -c "SELECT NOT EXISTS (SELECT FROM public.rate_counters WHERE key='role-test') AND NOT EXISTS (SELECT FROM public.qa_future)") == t ]]
deny 'CREATE SCHEMA qa_schema'
deny 'CREATE TABLE public.qa_ddl(id int)'
deny 'CREATE FUNCTION public.qa_fn() RETURNS integer LANGUAGE sql AS $$SELECT 1$$'
deny 'ALTER TABLE public.qa_future ADD COLUMN extra int'
deny 'DROP TABLE public.qa_future'
deny 'TRUNCATE public.qa_future'
deny "INSERT INTO public.schema_migrations VALUES ('qa')"
deny 'DELETE FROM public.schema_migrations'
deny 'UPDATE public.schema_migrations SET name=name'
deny 'SET ROLE ghostmanual'
deny 'CREATE ROLE qa_admin'
[[ $(sql "$app" -c "SELECT rolcanlogin AND NOT (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls OR rolinherit) AND NOT EXISTS (SELECT FROM pg_auth_members WHERE member=r.oid) FROM pg_roles r WHERE rolname=current_user") == t ]]
echo 'PASS runtime DML, cleanup, future-table defaults, protected ledger and administrative boundaries'
