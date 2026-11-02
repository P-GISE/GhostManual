#!/bin/bash
# Run as root with AWS_REGION and BACKUP_BUCKET set; pass the journal key and digest.
set -eu
umask 077
: "${BACKUP_BUCKET:?Set the dedicated backup bucket}"
key=${1:?Pass the postgres/ object key}
hash=${2:?Pass its SHA-256 from the backup journal}
[[ $key == postgres/*.dump && $hash =~ ^[0-9a-f]{64}$ ]] || exit 2
dir=$(mktemp -d /run/ghostmanual-restore.XXXXXXXX)
container=
cleanup() {
    local status=$?
    trap - EXIT
    rm -f "$dir/archive" || status=1
    if [[ -n $container ]]; then docker rm -fv "$container" >/dev/null || status=1; fi
    rmdir "$dir" || status=1
    exit "$status"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

encryption=$(aws s3api get-object --bucket "$BACKUP_BUCKET" --key "$key" --checksum-mode ENABLED \
    --query ServerSideEncryption --output text "$dir/archive")
[[ $encryption == AES256 ]]
printf '%s  %s\n' "$hash" "$dir/archive" | sha256sum --check --status
image=${POSTGRES_IMAGE:-$(docker inspect --format '{{.Image}}' ghostmanual-db-1)}
container=$(docker run -d --network none --log-driver none --memory 256m --cpus 0.5 \
    --tmpfs /var/lib/postgresql:size=192m --env POSTGRES_USER=ghostmanual \
    --env POSTGRES_HOST_AUTH_METHOD=trust "$image" postgres -c listen_addresses='' \
    -c shared_buffers=16MB -c log_statement=none -c log_min_error_statement=panic)
for _ in {1..60}; do
    if docker exec "$container" sh -c '[ "$(cat /proc/1/comm)" = postgres ] && pg_isready -U ghostmanual -q'; then break; fi
    sleep 1
done
docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U ghostmanual -d ghostmanual \
    -c 'CREATE ROLE ghostmanual_app NOLOGIN' >/dev/null
# PostgreSQL errors can contain actual row values. Keep restore output out of operator logs.
docker exec -i "$container" pg_restore --single-transaction -U ghostmanual -d ghostmanual \
    <"$dir/archive" 2>/dev/null || { echo 'Isolated pg_restore failed' >&2; exit 1; }
tables=$(docker exec "$container" psql -XAt -U ghostmanual -d ghostmanual -c \
    "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename IN ('users','workspaces','source_files','source_revisions','manual_versions');")
[[ $tables == 5 ]]
printf 'restore OK key=%s sha256=%s SSE=%s required_tables=%s\n' "$key" "$hash" "$encryption" "$tables"
