#!/bin/bash
set -eu
cd "$(dirname "$0")"
sandbox=$(mktemp -d)
trap 'rm -rf -- "$sandbox"' EXIT
export sandbox BACKUP_BUCKET=test-bucket POSTGRES_IMAGE=test-image
mkdir "$sandbox/bin"
# Redirect the drill's root-only /run directory so this regression runs unprivileged.
cat > "$sandbox/bin/mktemp" <<'MOCK'
#!/bin/bash
set -eu
[[ $* == '-d /run/ghostmanual-restore.XXXXXXXX' ]]
mkdir "$sandbox/stage"
echo "$sandbox/stage"
MOCK
cat > "$sandbox/bin/aws" <<'MOCK'
#!/bin/bash
set -eu
[[ $1 == s3api && $2 == get-object && ${!#} == "$sandbox/stage/archive" ]]
printf fixture > "${!#}"
echo AES256
MOCK
cat > "$sandbox/bin/docker" <<'MOCK'
#!/bin/bash
set -eu
case "$*" in
    run\ *) echo test-container ;;
    'exec test-container sh '*|'exec test-container psql -X '*) ;;
    'exec -i test-container pg_restore '*) [[ $(cat) == fixture ]] ;;
    'exec test-container psql -XAt '*) echo 5 ;;
    'rm -fv test-container')
        if [[ ! -e $sandbox/stage/archive ]]; then touch "$sandbox/archive-removed-first"; fi
        exit 42 ;;
    *) exit 2 ;;
esac
MOCK
chmod +x "$sandbox/bin/"*
export PATH="$sandbox/bin:$PATH"
hash=$(printf fixture | sha256sum | cut -d ' ' -f 1)
if ./restore-drill.sh postgres/test.dump "$hash" >"$sandbox/log" 2>&1; then
    echo 'Expected container cleanup failure to fail the drill' >&2
    exit 1
fi
[[ -f $sandbox/archive-removed-first && ! -e $sandbox/stage ]]
echo 'PASS docker rm failure: archive removed before teardown, exit nonzero, staging removed'
