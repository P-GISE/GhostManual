#!/bin/bash
set -eu
cd "$(dirname "$0")"
dir=$(mktemp -d)
trap 'rm -rf -- "$dir"' EXIT
mkdir "$dir/bin" "$dir/stage"
export PATH="$dir/bin:$PATH" BACKUP_BUCKET=test-bucket RUNTIME_DIRECTORY="$dir/stage"
cat > "$dir/bin/docker" <<'MOCK'
#!/bin/sh
[ "$*" = 'exec ghostmanual-db-1 pg_dump -Fc -U ghostmanual -d ghostmanual' ] || exit 2
[ "$SCENARIO" = empty ] || printf 'synthetic dump'
[ "$SCENARIO" != dumpfail ]
MOCK
cat > "$dir/bin/aws" <<'MOCK'
#!/bin/bash
set -eu
[[ $1 == s3api && $2 == put-object ]]
shift 2
declare -A arg
while (( $# )); do arg[$1]=$2; shift 2; done
[[ ${arg[--bucket]} == test-bucket && ${arg[--key]} == postgres/*.dump ]]
[[ ${arg[--server-side-encryption]} == AES256 && ${arg[--if-none-match]} == '*' ]]
body=${arg[--body]}
[[ $(stat -c %a "$body") == 600 && $(cat "$body") == 'synthetic dump' ]]
[[ ${arg[--metadata]} == sha256="$(sha256sum "$body" | cut -d ' ' -f 1)" ]]
checksum=$(openssl dgst -sha256 -binary "$body" | openssl base64 -A)
[[ ${arg[--checksum-sha256]} == "$checksum" ]]
case $SCENARIO in
    success) echo "$checksum";;
    uploadfail) exit 1;;
    mismatch) echo wrong;;
    *) exit 2;;
esac
MOCK
chmod +x "$dir/bin/"*
for SCENARIO in success empty dumpfail uploadfail mismatch; do
    export SCENARIO
    if output=$(./backup.sh 2>&1); then
        [[ $SCENARIO == success && $output == 'backup OK key=postgres/'* ]]
    else
        case $SCENARIO:$output in
            'empty:backup failed at empty-dump'|'dumpfail:backup failed at pg_dump'|\
            'uploadfail:backup failed at s3-upload'|'mismatch:backup failed at s3-checksum') ;;
            *) exit 1;;
        esac
    fi
    [[ -z $(ls -A "$dir/stage") ]]
    echo "PASS $SCENARIO (exit status, log, clean staging)"
done
