"""Bind a fresh S1 inventory and canonical first release without approving either."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import entry


def api(path):
    result = subprocess.run(['gh', 'api', 'repos/' + entry.REPO + '/' + path], capture_output=True, timeout=90)
    entry.check(result.returncode == 0, 'github_read_failed')
    return json.loads(result.stdout)


def main(runtime_path, model_path, sha, run_id, out):
    entry.check(entry.SHA.fullmatch(sha) and run_id.isascii() and run_id.isdecimal() and str(int(run_id)) == run_id
                and int(run_id) > 0, 'invalid_request')
    rt = json.loads(Path(runtime_path).read_text(encoding='utf-8-sig'))
    previous = rt['receipt']
    app = rt['containers']['ghostmanual-app-1']
    model = json.loads(Path(model_path).read_text(encoding='utf-8-sig'))
    config_hashes = {name: rt['files']['/opt/ghostmanual/' + name]['sha256'] for name in entry.FILES}
    entry.check(model['read_only'] is True and model['baseline_app_id'] == app['id']
                and model['baseline_image'] == app['image'] and model['baseline_sha'] == app['revision']
                and set(model['source_files']) == set(entry.FILES)
                and all(model['source_files'][name] == {key: rt['files']['/opt/ghostmanual/' + name][key]
                        for key in ('sha256', 'uid', 'gid', 'mode', 'inode', 'device')} for name in entry.FILES)
                and entry.DIGEST.fullmatch('sha256:' + model['model_sha256']), 'independent_model_mismatch')
    entry.check(rt['read_only'] is True and not any(rt['state_markers'].values())
                and not rt['files']['/usr/local/libexec/ghostmanual-event-entry']['exists']
                and previous.get('run_id') is None and previous.get('sha') == app['revision']
                == 'ef5d1b6745f88d55be98f645cd397a1e5cf1317a'
                and previous.get('image') == app['image']
                == 'sha256:f1af35d6a80cd6eb917a482e12cd359268e1f9dd4c22e36bbad92ffc0f88386e'
                and app['running'] and not app['oom'] and app['restarts'] == 0, 'manual_baseline_changed')
    tree = entry.protected_tree(api('git/trees/' + sha + '?recursive=1'))
    artifact = entry.canonical(api, sha, int(run_id), tree)
    sources = {'entry.py': 'deploy/event/entry.py', 'deploy-poll.py': 'scripts/deploy-poll.py',
               'install.py': 'deploy/event/install.py'}
    hashes = {}
    for name, repo_path in sources.items():
        raw = subprocess.check_output(['git', 'show', sha + ':' + repo_path])
        blob = hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()
        entry.check(tree[repo_path] == blob, 'git_source_mismatch')
        hashes[name] = entry.digest(raw)
    lock = rt['files'][str('/var/lib/ghostmanual-deploy/deploy.lock')]
    cfg = dict(approved=False, semantic_review=False, first_sha=sha, first_run_id=int(run_id),
               first_artifact=artifact, protected_tree=tree, module_hashes=hashes,
               lock_identity=[lock['device'], lock['inode']], initial=dict(sha=app['revision'], image=app['image'],
               app_id=app['id'], source='manual_server_build'),
               legacy_receipt_sha256=rt['files']['/var/lib/ghostmanual-deploy/deployed.json']['sha256'],
               config_hashes=config_hashes, model_sha256=model['model_sha256'])
    with Path(out).open('x', encoding='utf-8') as stream:
        json.dump(cfg, stream, indent=2)
    print(json.dumps(dict(prepared=True, approved=False, sha=sha, run_id=int(run_id), artifact_id=artifact['id'])))


if __name__ == '__main__':
    main(*sys.argv[1:])
