"""Fixed GhostManual SSM entry. Install reviewed bytes and configuration before enabling."""
import contextlib
import gzip
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import sys
import tarfile
import tempfile
import zipfile
from urllib.parse import quote

REPO = 'P-GISE/GhostManual'
BRANCH = 'feat/ghostmanual-mvp'
LIB = Path('/usr/local/lib/ghostmanual-event')
STATE = Path('/var/lib/ghostmanual-deploy')
EVENT = STATE / 'event'
ORIGIN = Path('/opt/ghostmanual')
SHA = re.compile('[0-9a-f]{40}')
DIGEST = re.compile('sha256:[0-9a-f]{64}')
FILES = ('.env', 'compose.yaml', 'compose.no-logs.yaml')


class Refusal(Exception):
    pass


def check(value, reason):
    if not value:
        raise Refusal(reason)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def fingerprint(value):
    return digest(json.dumps(value, sort_keys=True, separators=(',', ':')).encode())


def verify_run(run, sha, run_id):
    expected = dict(id=run_id, head_sha=sha, head_branch=BRANCH, path='.github/workflows/ci.yml',
                    event='push', status='completed', conclusion='success', run_attempt=1)
    check(type(run['id']) is int and type(run['run_attempt']) is int
          and all(run.get(k) == v for k, v in expected.items())
          and all(run[k]['full_name'] == REPO for k in ('repository', 'head_repository')), 'noncanonical_run')


def select_artifact(page, sha, run_id):
    check(page['total_count'] == len(page['artifacts']) <= 100, 'artifact_pagination')
    selected = [a for a in page['artifacts'] if a['name'] == 'ghostmanual-event-image-' + sha]
    check(len(selected) == 1, 'missing_unique_artifact')
    item = selected[0]
    check(item['expired'] is False and type(item['id']) is int and item['id'] > 0
          and type(item['size_in_bytes']) is int and 0 < item['size_in_bytes'] < 1024**3
          and DIGEST.fullmatch(item['digest']), 'invalid_artifact')
    binding = item['workflow_run']
    check(binding['id'] == run_id and binding['head_sha'] == sha and binding['head_branch'] == BRANCH,
          'artifact_run_mismatch')
    return item


def protected_tree(tree):
    check(tree['truncated'] is False, 'truncated_tree')
    result = {}
    for item in tree['tree']:
        path = item['path']
        check(item['type'] in ('blob', 'tree'), 'unsupported_source')
        if item['type'] == 'blob' and (path.startswith(('.github/', 'deploy/', 'scripts/', 'db/'))
                or path.endswith('.sql') or 'compose' in Path(path).name.lower()
                or path in ('Dockerfile', '.dockerignore')):
            check(item['mode'] in ('100644', '100755') and SHA.fullmatch(item['sha']), 'untrusted_source')
            result[path] = item['sha']
    check(all(p in result for p in ('deploy/event/entry.py', 'scripts/deploy-poll.py',
                                     '.github/workflows/ci.yml', '.github/workflows/deploy-event.yml')),
          'missing_protected_source')
    return result


def canonical(api, sha, run_id, protected):
    check(api('commits/' + quote(BRANCH, safe=''))['sha'] == sha, 'superseded')
    verify_run(api('actions/runs/' + str(run_id)), sha, run_id)
    check(protected_tree(api('git/trees/' + sha + '?recursive=1')) == protected, 'protected_source_changed')
    return select_artifact(api(f'actions/runs/{run_id}/artifacts?per_page=100'), sha, run_id)


def forward_only(api, base, head):
    check(SHA.fullmatch(base) and SHA.fullmatch(head) and base != head, 'invalid_ancestry_request')
    graph = api(f'compare/{base}...{head}?per_page=1')
    check(graph['status'] == 'ahead' and graph['ahead_by'] > 0 and graph['behind_by'] == 0
          and graph['base_commit']['sha'] == graph['merge_base_commit']['sha'] == base, 'nonforward_release')


def verify_receipt(record, sha, run_id, artifact):
    check(record.get('source') == 'canonical_ci_artifact' and record.get('sha') == sha
          and all(type(record.get(k)) is int and record[k] == run_id
                  for k in ('requested_run_id', 'deployed_run_id', 'artifact_run_id'))
          and record.get('artifact_id') == artifact['id'] and record.get('artifact_digest') == artifact['digest']
          and DIGEST.fullmatch(record['image']), 'receipt_not_canonical')


def sync(folder):
    fd = os.open(folder, os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def fence(path, record):
    with path.open('x', encoding='utf-8') as output:
        json.dump(record, output)
        output.flush()
        os.fsync(output.fileno())
    if os.name != 'nt':
        sync(path.parent)


def trusted_file(path, mode=0o600):
    for parent in path.parents:
        info = parent.lstat()
        check(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022, 'unsafe_parent')
    info = path.lstat()
    check(stat.S_ISREG(info.st_mode) and info.st_uid == info.st_gid == 0 and info.st_nlink == 1
          and stat.S_IMODE(info.st_mode) == mode, 'unsafe_file')
    return path.read_bytes()


def modules():
    cfg = json.loads(trusted_file(LIB / 'review.json'))
    check(cfg['approved'] is True and cfg['semantic_review'] is True, 'explicit_review_required')
    for filename in ('entry.py', 'deploy-poll.py'):
        check(digest(trusted_file(LIB / filename)) == cfg['module_hashes'][filename], 'source_changed')
    spec = importlib.util.spec_from_file_location('ghost_legacy', LIB / 'deploy-poll.py')
    legacy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(legacy)
    return cfg, legacy


def legacy_guard(legacy):
    path = Path('/usr/local/libexec/ghostmanual-deploy-poll')
    check(digest(trusted_file(path, 0o750)) == '2c4cba730c7a2be1310b058712eb73323f4041ac890877d20c6d89048327dda8',
          'legacy_source_changed')
    unit = legacy.command(['systemctl', 'show', 'ghostmanual-deploy.service', '--property=ExecStart', '--value'])
    check(unit.count('argv[]=') == 1 and 'argv[]=/usr/bin/python3 ' + str(path) + ' ;' in unit,
          'legacy_exec_changed')


def read_origin(name, expected):
    # The source directory belongs to the operator. Bind only reviewed regular-file bytes.
    parent = os.open(ORIGIN, os.O_NOFOLLOW | os.O_DIRECTORY)
    try:
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        with os.fdopen(fd, 'rb') as stream:
            info = os.fstat(stream.fileno())
            check(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size <= 1024**2, 'source_file_type')
            if name == '.env':
                check(info.st_uid == info.st_gid == 0 and stat.S_IMODE(info.st_mode) == 0o600, 'unsafe_env')
            data = stream.read(1024**2 + 1)
            check(digest(data) == expected, 'operating_configuration_changed')
            return data
    finally:
        os.close(parent)


def config_guard(cfg):
    for name in FILES:
        expected = cfg['config_hashes'][name]
        read_origin(name, expected)
        check(digest(trusted_file(LIB / 'config' / name)) == expected, 'snapshot_changed')
    check(digest(trusted_file(STATE / 'deployed.json')) == cfg['legacy_receipt_sha256'], 'legacy_receipt_changed')
    check(not any(os.path.lexists(STATE / n) for n in ('failed-sha', 'in-progress', 'import-in-progress',
                                                      'recovery-required')), 'legacy_recovery_required')


def scan_archive(source, wanted):
    meta, sizes = {}, {}
    total = 0
    with gzip.open(source, 'rb') as stream:
        while True:
            header = stream.read(512)
            check(len(header) == 512, 'tar_truncated')
            if header == bytes(512):
                check(stream.read(512) == bytes(512), 'tar_end')
                trailer = stream.read(1024**2 + 1)
                check(len(trailer) <= 1024**2 and not trailer.strip(bytes(1)), 'tar_trailer')
                return meta, sizes
            item = tarfile.TarInfo.frombuf(header, 'utf-8', 'strict')
            check(item.type in (tarfile.REGTYPE, tarfile.AREGTYPE, tarfile.DIRTYPE), 'tar_extension_rejected')
            check(len(sizes) < 4096 and item.name not in sizes and item.size >= 0, 'archive_duplicates')
            total += item.size
            check(total <= 3 * 1024**3, 'archive_limit')
            is_blob = re.fullmatch('blobs/sha256/[0-9a-f]{64}', item.name)
            if item.isdir():
                check(item.name in ('blobs', 'blobs/sha256') and not item.size, 'archive_directory')
            else:
                check(is_blob or item.name in ('index.json', 'manifest.json', 'oci-layout', 'repositories'),
                      'archive_member')
            if item.name in wanted:
                check(item.isreg() and item.size <= 1024**2, 'metadata_limit')
            sizes[item.name] = item.size
            remaining = item.size
            hasher = hashlib.sha256()
            chunks = []
            while remaining:
                chunk = stream.read(min(remaining, 1024**2))
                check(chunk, 'tar_truncated')
                remaining -= len(chunk)
                if is_blob:
                    hasher.update(chunk)
                if item.name in wanted:
                    chunks.append(chunk)
            if is_blob:
                check(hasher.hexdigest() == item.name.split('/')[-1], 'archive_blob_integrity')
            padding = (-item.size) % 512
            check(stream.read(padding) == bytes(padding), 'tar_padding')
            if item.name in wanted:
                meta[item.name] = b''.join(chunks)


def image_info(source, sha):
    tag = 'ghostmanual:' + sha
    meta, sizes = scan_archive(source, {'index.json', 'manifest.json', 'oci-layout', 'repositories'})
    check(json.loads(meta['oci-layout']) == {'imageLayoutVersion': '1.0.0'}, 'unsupported_archive')
    index = json.loads(meta['index.json'])
    check(index['schemaVersion'] == 2 and len(index['manifests']) == 1, 'single_manifest_required')
    desc = index['manifests'][0]
    annotations = desc['annotations']
    check(desc['mediaType'] == 'application/vnd.oci.image.manifest.v1+json'
          and annotations.get('io.containerd.image.name') == 'docker.io/library/' + tag
          and annotations.get('org.opencontainers.image.ref.name') == sha, 'oci_tag_mismatch')
    legacy = json.loads(meta['manifest.json'])
    check(len(legacy) == 1 and legacy[0]['RepoTags'] == [tag]
          and re.fullmatch('blobs/sha256/[0-9a-f]{64}', legacy[0]['Config'])
          and DIGEST.fullmatch(desc['digest']), 'archive_config_mismatch')
    manifest_path = 'blobs/sha256/' + desc['digest'][7:]
    files, second_sizes = scan_archive(source, {manifest_path, legacy[0]['Config']})
    check(sizes == second_sizes and sizes[manifest_path] == desc['size'], 'archive_metadata_changed')
    manifest = json.loads(files[manifest_path])
    conf = manifest['config']
    check(DIGEST.fullmatch(conf['digest']) and legacy[0]['Config'] == 'blobs/sha256/' + conf['digest'][7:]
          and sizes[legacy[0]['Config']] == conf['size'], 'archive_config_mismatch')
    config = json.loads(files[legacy[0]['Config']])
    check(config['os'] == 'linux' and config['architecture'] == 'amd64'
          and config['config']['User'] == 'node' and config['config']['Cmd'] == ['node', 'server.js']
          and config['config']['Labels']['org.opencontainers.image.revision'] == sha, 'archive_revision')
    paths = []
    for layer in manifest['layers']:
        check(DIGEST.fullmatch(layer['digest']), 'layer_digest')
        name = 'blobs/sha256/' + layer['digest'][7:]
        check(sizes[name] == layer['size'], 'layer_size')
        paths.append(name)
    check(paths and paths == legacy[0]['Layers'], 'layer_graph')
    if 'repositories' in meta:
        repositories = json.loads(meta['repositories'])
        check(set(repositories) == {'ghostmanual'} and set(repositories['ghostmanual']) == {sha}, 'archive_tags')
    return desc['digest']


def normalized_others(legacy):
    names = legacy.command(['docker', 'ps', '-a', '--format', '{{.Names}}']).splitlines()
    others = {}
    for name in names:
        if name == legacy.APP:
            continue
        row = legacy.inspect(name)
        row.pop('ExecIDs', None)
        row['State'].get('Health', {}).pop('Log', None)
        row['Mounts'] = sorted(row['Mounts'], key=lambda mount: mount['Destination'])
        others[name] = row
    check(others['ghostmanual-db-1']['State']['Health']['Status'] == 'healthy', 'database_unhealthy')
    units = legacy.command(['systemctl', 'list-units', '--all', '--no-legend', '--plain', 'cloudflared*.service'])
    tunnels = {line.split()[0]: legacy.command(['systemctl', 'show', line.split()[0],
               '--property=ActiveState,SubState,MainPID,ExecMainStartTimestampMonotonic'])
               for line in units.splitlines() if line.strip()}
    return fingerprint([others, tunnels])


def compose(legacy, image, *args, root=None):
    check(DIGEST.fullmatch(image), 'invalid_image')
    root = root or LIB / 'config'
    return legacy.command(['/usr/bin/env', '-i', 'PATH=/usr/sbin:/usr/bin:/sbin:/bin', 'HOME=/root',
                           'GHOSTMANUAL_IMAGE=' + image, '/usr/bin/docker', 'compose', '--project-directory',
                           str(root), '-p', 'ghostmanual', '--env-file', str(root / '.env'),
                           '-f', str(root / 'compose.yaml'), '-f', str(root / 'compose.no-logs.yaml'), *args])


def config_matches(legacy, row, cfg, root=None):
    model = json.loads(compose(legacy, row['Image'], 'config', '--format', 'json', root=root))
    app = model['services']['app']
    check(model['name'] == 'ghostmanual' and set(model['services']) == {'app', 'db'}
          and app['image'] == row['Image'] and not app.get('volumes') and not row['Mounts']
          and app.get('logging', {}).get('driver') == 'none', 'compose_boundary')
    app['image'] = '<verified-image>'
    check(fingerprint(model) == cfg['model_sha256'], 'rendered_compose_changed')
    db = legacy.inspect('ghostmanual-db-1')
    mounts = db['Mounts']
    check(len(mounts) == 1 and mounts[0].get('Type') == 'volume'
          and mounts[0].get('Name') == model['volumes']['database']['name'] == 'ghostmanual_database'
          and mounts[0].get('Destination') == '/var/lib/postgresql' and mounts[0].get('RW') is True
          and set(db['NetworkSettings']['Networks']) == set(row['NetworkSettings']['Networks'])
          == {model['networks']['default']['name']} == {'ghostmanual_default'}, 'database_or_network_changed')
    injected = app['environment']
    current = dict(item.split('=', 1) for item in row['Config']['Env'])
    image_env = dict(item.split('=', 1) for item in legacy.inspect(row['Image'])['Config']['Env'])
    check(current == (image_env | injected), 'runtime_environment_differs')
    return fingerprint(injected)


def load_image(legacy, sha, artifact, recheck):
    check(shutil.disk_usage(EVENT).free >= 2 * 1024**3, 'insufficient_disk')
    with tempfile.TemporaryDirectory(dir=EVENT) as folder:
        archive = Path(folder) / 'artifact.zip'
        with archive.open('xb') as stream:
            legacy.api('actions/artifacts/' + str(artifact['id']) + '/zip', output=stream)
        with archive.open('rb') as stream:
            check(archive.stat().st_size == artifact['size_in_bytes']
                  and 'sha256:' + hashlib.file_digest(stream, 'sha256').hexdigest() == artifact['digest'],
                  'artifact_bytes_changed')
        path = Path(folder) / 'image.tar.gz'
        with zipfile.ZipFile(archive) as package:
            entries = package.infolist()
            check(len(entries) == 1 and entries[0].filename == 'ghostmanual-image.tar.gz'
                  and 0 < entries[0].file_size <= 1536 * 1024**2, 'artifact_contents')
            with package.open(entries[0]) as source, path.open('xb') as target:
                shutil.copyfileobj(source, target)
        image = image_info(path, sha)
        recheck()
        backend = json.loads(legacy.command(['docker', 'info', '--format', '{{json .DriverStatus}}']))
        check(['driver-type', 'io.containerd.snapshotter.v1'] in backend, 'unsupported_docker_backend')
        marker = EVENT / 'import-in-progress'
        fence(marker, {'sha': sha, 'image': image})
        legacy.command(['docker', 'load', '--input', str(path)], timeout=300)
        row = legacy.inspect('ghostmanual:' + sha)
        check(row['Id'] == image and row['Config']['Labels']['org.opencontainers.image.revision'] == sha,
              'loaded_image_mismatch')
        legacy.command(['docker', 'run', '--rm', '--pull', 'never', '--network', 'none', '--read-only', '--entrypoint', 'node',
                        image, '--check', '/app/server.js'])
        marker.unlink()
        sync(EVENT)
        return image


def runtime(legacy, previous):
    row = legacy.inspect(legacy.APP)
    check(row['Image'] == previous['image'] and row['Id'] == previous['app_id']
          and row['Config']['Labels']['org.opencontainers.image.revision'] == previous['sha']
          and row['State']['Running'] and not row['State']['OOMKilled'], 'runtime_mismatch')
    return row


def app_boundary(row):
    networks = {name: network['NetworkID'] for name, network in row['NetworkSettings']['Networks'].items()}
    return fingerprint([row['HostConfig'], row['Mounts'], networks])


def perform(legacy, cfg, sha, run_id):
    check(not any(os.path.lexists(EVENT / n) for n in ('in-progress', 'import-in-progress')), 'reconcile_fence')
    config_guard(cfg)
    legacy_guard(legacy)
    receipt = EVENT / 'deployed.json'
    previous = json.loads(trusted_file(receipt)) if os.path.lexists(receipt) else cfg['initial']
    row = runtime(legacy, previous)
    boundary = app_boundary(row)
    injected = config_matches(legacy, row, cfg)
    baseline = normalized_others(legacy)
    artifact = canonical(legacy.api, sha, run_id, cfg['protected_tree'])

    def check_again():
        check(canonical(legacy.api, sha, run_id, cfg['protected_tree']) == artifact, 'artifact_changed')
        config_guard(cfg)
        runtime(legacy, previous)
        check(normalized_others(legacy) == baseline, 'unrelated_service_changed')

    def healthy(image):
        with open(os.devnull, 'w') as quiet, contextlib.redirect_stdout(quiet):
            legacy.health(image)

    if previous['sha'] == sha:
        verify_receipt(previous, sha, run_id, artifact)
        healthy(previous['image'])
        return previous | {'status': 'already_deployed'}
    forward_only(legacy.api, previous['sha'], sha)
    healthy(previous['image'])
    image = load_image(legacy, sha, artifact, check_again)
    check_again()
    fence(EVENT / 'in-progress', {'previous': previous, 'sha': sha, 'run_id': run_id})

    def switch(image_id):
        compose(legacy, image_id, 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', 'app')

    def preserved(image_id):
        config_guard(cfg)
        current = legacy.inspect(legacy.APP)
        check(current['Image'] == image_id and app_boundary(current) == boundary
              and config_matches(legacy, current, cfg) == injected
              and normalized_others(legacy) == baseline, 'post_switch_boundary')
        return current

    result = dict(status='verified', source='canonical_ci_artifact', sha=sha, image=image,
                  previous_sha=previous['sha'], previous_image=previous['image'], requested_run_id=run_id,
                  deployed_run_id=run_id, artifact_run_id=run_id, artifact_id=artifact['id'],
                  artifact_digest=artifact['digest'])
    try:
        switch(image)
        healthy(image)
        result['app_id'] = preserved(image)['Id']
    except BaseException:
        signal.alarm(240)
        switch(previous['image'])
        healthy(previous['image'])
        preserved(previous['image'])
        raise
    # A commit failure leaves the reconciliation fence and the exact previous receipt intact or visible.
    legacy.atomic_write(receipt, json.dumps(result) + '\n')
    sync(EVENT)
    (EVENT / 'in-progress').unlink()
    sync(EVENT)
    return result


def main(args):
    import fcntl
    check(len(args) == 2 and SHA.fullmatch(args[0]) and re.fullmatch('[1-9][0-9]{0,19}', args[1]), 'invalid_request')
    check(os.geteuid() == 0 and Path(__file__).resolve() == LIB / 'entry.py', 'fixed_root_entry')
    os.umask(0o077)
    cfg, legacy = modules()
    for sig in (signal.SIGALRM, signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(sig, legacy.interrupted)
    signal.alarm(1400)
    trusted_file(STATE / 'deploy.lock')
    fd = os.open(STATE / 'deploy.lock', os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as lock:
        info = os.fstat(lock.fileno())
        check([info.st_dev, info.st_ino] == cfg['lock_identity'], 'lock_identity')
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print(json.dumps({'reason': 'lock_timeout'}))
            return 75
        print(json.dumps(perform(legacy, cfg, args[0], int(args[1]))))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main(sys.argv[1:]))
    except Exception as exc:
        print(json.dumps({'reason': str(exc) if isinstance(exc, Refusal) else type(exc).__name__}))
        raise SystemExit(1)
