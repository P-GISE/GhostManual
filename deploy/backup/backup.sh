#!/bin/sh
set -eu
umask 077
: "${BACKUP_BUCKET:?Set the dedicated backup bucket}"
: "${RUNTIME_DIRECTORY:?Set a private tmpfs staging directory}"
file=$(mktemp "$RUNTIME_DIRECTORY/dump.XXXXXXXX")
trap 'rm -f -- "$file"' EXIT
trap 'exit 1' HUP INT TERM
fail() { echo "backup failed at $1" >&2; exit 1; }

docker exec ghostmanual-db-1 pg_dump -Fc -U ghostmanual -d ghostmanual >"$file" 2>/dev/null || fail pg_dump
[ -s "$file" ] || fail empty-dump
key="postgres/$(date -u +%Y%m%dT%H%M%SZ)-$(cat /proc/sys/kernel/random/uuid).dump"
hash=$(sha256sum "$file" | cut -d ' ' -f 1)
checksum=$(openssl dgst -sha256 -binary "$file" | openssl base64 -A)
[ "${#hash}" -eq 64 ] && [ "${#checksum}" -eq 44 ] || fail checksum
stored=$(aws s3api put-object --bucket "$BACKUP_BUCKET" --key "$key" --body "$file" \
    --if-none-match '*' --server-side-encryption AES256 --checksum-sha256 "$checksum" \
    --metadata "sha256=$hash" --query ChecksumSHA256 --output text 2>/dev/null) || fail s3-upload
[ "$stored" = "$checksum" ] || fail s3-checksum
printf 'backup OK key=%s bytes=%s sha256=%s\n' "$key" "$(stat -c %s "$file")" "$hash"
