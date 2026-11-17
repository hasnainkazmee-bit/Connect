"""Exact-SHA Colabb release. Run on the Connect host as the existing sunhub owner.

Prepare builds immutable app/jobs images without replacing running services.
Deploy backs up Postgres and configuration, applies additive migrations, switches
both services, checks origin health/UI/API, and rolls both images back on failure.
"""
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import time

BASE = Path('/opt/sunhub/connect')
RELEASES = Path('/opt/sunhub/connect-releases')
DB = 'connect-production-db-1'
CONTAINERS = {'app': 'connect-production-app-1', 'jobs': 'connect-production-jobs-1'}
NETWORK_MIGRATION = '042_network.sql'
NETWORK_TABLES = (
    'network_administrators', 'network_communities', 'network_members', 'network_invitations',
    'network_posts', 'network_files', 'network_post_files', 'network_drafts',
    'network_post_states', 'network_follows', 'network_comments', 'network_reports',
    'network_moderation_log', 'network_notification_preferences',
)
NETWORK_FUNCTIONS = (
    'network_can_read_community(uuid,uuid,boolean)',
    'network_can_read_post(uuid,uuid,boolean)',
    'network_notification_visible(text,uuid,uuid,boolean)',
)


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def output(args):
    return subprocess.check_output(args, text=True).strip()


def request(path, cookie=None):
    command = ['curl', '--fail', '--silent', '--show-error', '--max-time', '20']
    if cookie:
        command += ['-H', 'Cookie: ' + cookie]
    return output(command + ['http://127.0.0.1:14100' + path])


def health(path='health'):
    return json.loads(request('/api/' + path))


def check_network_schema():
    tables = ','.join("'" + name + "'" for name in NETWORK_TABLES)
    functions = ','.join("'" + name + "'" for name in NETWORK_FUNCTIONS)
    query = f"""SELECT json_build_object(
        'migrationApplied', EXISTS(SELECT 1 FROM public.schema_migrations WHERE name='{NETWORK_MIGRATION}'),
        'missingTables', ARRAY(SELECT name FROM unnest(ARRAY[{tables}]) AS name WHERE to_regclass('public.' || name) IS NULL),
        'missingFunctions', ARRAY(SELECT name FROM unnest(ARRAY[{functions}]) AS name WHERE to_regprocedure('public.' || name) IS NULL)
    )"""
    schema = json.loads(output(['docker', 'exec', DB, 'psql', '-X', '-U', 'connect', '-d', 'connect',
                                '-v', 'ON_ERROR_STOP=1', '-Atc', query]))
    if schema.get('migrationApplied') is not True:
        raise RuntimeError('Required Network migration 042_network.sql has not been applied.')
    if schema.get('missingTables') != [] or schema.get('missingFunctions') != []:
        raise RuntimeError('Network schema is incomplete: ' + json.dumps(schema, sort_keys=True))
    return {'networkMigration': NETWORK_MIGRATION, 'networkSchema': 'complete'}


def check_network_http():
    status = output(['curl', '--silent', '--show-error', '--max-time', '20', '--output', '/dev/null',
                     '--write-out', '%{http_code}', 'http://127.0.0.1:14100/api/network-v2/bootstrap'])
    if status != '401':
        raise RuntimeError('Guest Network bootstrap must return 401; received ' + status + '.')
    page = request('/network')
    assets = re.findall(r'(?:src|href)="(/assets/[^" ]+\.(?:js|css))"', page)
    if 'Colabb' not in page or not any(asset.endswith('.js') for asset in assets):
        raise RuntimeError('Colabb Network entry page is unavailable.')
    pending, visited, network_asset = list(assets), set(), None
    while pending:
        asset = pending.pop()
        if asset in visited:
            continue
        visited.add(asset)
        body = request(asset)
        if not body.strip() or re.match(r'\s*<(?:!doctype\s+html|html)\b', body, re.I):
            raise RuntimeError('Network static asset is missing or returned HTML: ' + asset)
        if asset.endswith('.js'):
            if '/network-v2' in body:
                network_asset = asset
            # Vite emits Network as a lazy module. Checking only index.html and
            # its main script would miss a missing/stale Network chunk.
            for child in re.findall(r'import\(\s*["\']((?:\./|/assets/)[^"\']+\.js)["\']\s*\)', body):
                child = '/assets/' + child[2:] if child.startswith('./') else child
                if re.fullmatch(r'/assets/[A-Za-z0-9_.-]+\.js', child):
                    pending.append(child)
    if network_asset is None:
        raise RuntimeError('The served Colabb assets do not include Network.')
    return {'networkGuestStatus': 401, 'networkAsset': network_asset}


def backup_metadata(previous, next_sha):
    return {
        'previous': previous,
        'next': next_sha,
        'database': 'additive migration 042_network.sql; previous schema and data are retained',
        'backupScope': 'This Connect Postgres database and protected app configuration on this host only',
        'excludedFromBackup': 'Uploaded attachment bytes and off-host copies; the existing upload volume is preserved, not backed up by this script',
    }


def composition(sha, *args, ui='colabb'):
    return run(['docker', 'compose', '-p', 'connect-production', '--project-directory', str(BASE),
                '--env-file', str(BASE / '.env.production'), '-f', str(BASE / 'compose.production.yaml'), *args],
               env={**os.environ, 'CONNECT_RELEASE': sha, 'CONNECT_WEB_UI': ui})


def check_current(expected):
    if health().get('release') != expected:
        raise RuntimeError('Live release changed; refusing to replace it.')
    if output(['git', '-C', str(BASE), 'rev-parse', 'HEAD']) != expected:
        raise RuntimeError('Production checkout does not match the expected release.')
    if output(['git', '-C', str(BASE), 'status', '--porcelain']):
        raise RuntimeError('Production checkout contains local changes; preserving them.')
    for service, container in CONTAINERS.items():
        actual = output(['docker', 'inspect', '--format', '{{.Config.Image}}', container])
        if actual != 'connect-' + service + ':' + expected:
            raise RuntimeError('Unexpected running image: ' + actual)


def await_ready(sha):
    for _ in range(60):
        try:
            if health().get('release') == sha and health('ready').get('status') == 'ok':
                return
        except Exception:
            pass
        time.sleep(2)
    raise RuntimeError('New release did not become ready.')


def smoke():
    home = request('/')
    if 'No one builds' not in home or '/brand/marks/lockup-primary.svg' not in home:
        raise RuntimeError('Default Colabb landing page did not render.')
    if '/assets/connect-icon.png' not in request('/', 'connect_web_ui=connect'):
        raise RuntimeError('Preserved Connect interface did not render.')
    if 'No one builds' not in request('/hire') and 'Colabb' not in request('/hire'):
        raise RuntimeError('Colabb marketing page is unavailable.')
    taxonomy = json.loads(request('/api/jobs/provider-taxonomy'))
    if not isinstance(taxonomy.get('directoryCredentials'), list):
        raise RuntimeError('Updated certification API is unavailable.')
    providers = json.loads(request('/api/jobs/providers'))
    if not providers.get('providers') or 'on_colabb' not in providers['providers'][0]:
        raise RuntimeError('Provider identity contract is unavailable.')
    for asset in re.findall(r'(?:src|href)="(/assets/[^" ]+\.(?:js|css))"', home):
        request(asset)
    return {'providerCount': providers.get('total'), 'certificationChoices': len(taxonomy['directoryCredentials']),
            **check_network_http()}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['prepare', 'deploy'])
    parser.add_argument('sha')
    parser.add_argument('--expected', required=True)
    parser.add_argument('--bundle')
    args = parser.parse_args()
    if not all(re.fullmatch('[a-f0-9]{40}', s) for s in [args.sha, args.expected]):
        raise RuntimeError('Exact commit SHAs are required.')
    os.umask(0o077)
    RELEASES.mkdir(exist_ok=True)
    with (RELEASES / '.colabb-release.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        check_current(args.expected)
        source = RELEASES / ('colabb-' + args.sha)
        prepared = RELEASES / ('colabb-' + args.sha + '.prepared.json')
        if args.mode == 'prepare':
            if not args.bundle:
                raise RuntimeError('A reviewed source bundle is required.')
            run(['git', '-C', str(BASE), 'fetch', '--no-tags', args.bundle, 'main'])
            if output(['git', '-C', str(BASE), 'rev-parse', 'FETCH_HEAD']) != args.sha:
                raise RuntimeError('Bundle does not match reviewed SHA.')
            if not source.exists():
                run(['git', '-C', str(BASE), 'worktree', 'add', '--detach', str(source), args.sha])
            if output(['git', '-C', str(source), 'rev-parse', 'HEAD']) != args.sha or output(['git', '-C', str(source), 'status', '--porcelain']):
                raise RuntimeError('Build source is not the clean reviewed commit.')
            run(['docker', 'build', '--build-arg', 'CONNECT_RELEASE=' + args.sha, '-t', 'connect-app:' + args.sha, str(source)])
            run(['docker', 'build', '-f', str(source / 'Dockerfile.jobs'), '-t', 'connect-jobs:' + args.sha, str(source)])
            runtime = """import fs from 'node:fs';import {createRequire} from 'node:module';
if(process.getuid()===0)throw Error('Root runtime');
function readTree(p){for(const e of fs.readdirSync(p,{withFileTypes:true})){const f=p+'/'+e.name;e.isDirectory()?readTree(f):fs.readFileSync(f)}}
for(const p of ['apps/api/dist','apps/api/migrations','apps/web/dist','apps/colabb/dist'])readTree('/app/'+p);
if(!fs.readFileSync('/app/apps/colabb/dist/marketing-home.html','utf8').includes('No one builds'))throw Error('Missing marketing snapshot');
const require=createRequire('/app/apps/api/dist/server.js');for(const d of Object.keys(JSON.parse(fs.readFileSync('/app/apps/api/package.json','utf8')).dependencies)){await import(require.resolve(d))}
console.log('Both frontends, migrations and API dependencies are readable by the runtime user.');"""
            run(['docker', 'run', '--rm', '--entrypoint', 'node', 'connect-app:' + args.sha, '--input-type=module', '-e', runtime])
            run(['docker', 'run', '--rm', '--entrypoint', 'sh', 'connect-jobs:' + args.sha, '-c', 'test -x /usr/local/bin/connect-jobs && test "$(id -u)" -ne 0'])
            prepared.write_text(json.dumps({'sha': args.sha, 'previous': args.expected, 'app': output(['docker', 'image', 'inspect', '--format', '{{.Id}}', 'connect-app:' + args.sha]), 'jobs': output(['docker', 'image', 'inspect', '--format', '{{.Id}}', 'connect-jobs:' + args.sha])}, indent=2))
            print(json.dumps({'prepared': args.sha, 'liveReleaseUnchanged': health().get('release')}, indent=2))
            return
        metadata = json.loads(prepared.read_text())
        if metadata['sha'] != args.sha or metadata['previous'] != args.expected:
            raise RuntimeError('Prepared release mismatch.')
        for service in ['app', 'jobs']:
            if output(['docker', 'image', 'inspect', '--format', '{{.Id}}', 'connect-' + service + ':' + args.sha]) != metadata[service]:
                raise RuntimeError('Prepared image changed.')
        backup = RELEASES / ('colabb-backup-' + time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()))
        backup.mkdir(mode=0o700)
        env_path = BASE / '.env.production'
        env_text = env_path.read_text()
        (backup / 'env.production').write_text(env_text)
        with (backup / 'database.dump').open('wb') as handle:
            run(['docker', 'exec', DB, 'pg_dump', '-U', 'connect', '-d', 'connect', '--format=custom'], stdout=handle)
        with (backup / 'database.dump').open('rb') as handle:
            run(['docker', 'exec', '-i', DB, 'pg_restore', '--list'], stdin=handle, stdout=subprocess.DEVNULL)
        (backup / 'release.json').write_text(json.dumps(backup_metadata(args.expected, args.sha), indent=2))
        changed = False
        try:
            run(['git', '-C', str(BASE), 'checkout', '--detach', args.sha])
            changed = True
            composition(args.sha, 'run', '--rm', '--no-deps', 'app', 'node', 'apps/api/dist/migrate.js')
            network_schema = check_network_schema()
            composition(args.sha, 'up', '-d', '--no-deps', 'jobs', 'app')
            await_ready(args.sha)
            result = {**network_schema, **smoke()}
            updated = env_text
            for key, value in [('CONNECT_RELEASE', args.sha), ('CONNECT_WEB_UI', 'colabb')]:
                pattern = r'^' + key + r'=.*$'
                updated = re.sub(pattern, key + '=' + value, updated, flags=re.M) if re.search(pattern, updated, re.M) else updated.rstrip() + '\n' + key + '=' + value + '\n'
            temporary = BASE / '.env.production.colabb-tmp'
            temporary.write_text(updated)
            os.chmod(temporary, 0o600)
            os.replace(temporary, env_path)
            result.update({'deployed': args.sha, 'previous': args.expected, 'backup': str(backup), 'status': 'healthy'})
            (backup / 'result.json').write_text(json.dumps(result, indent=2))
            print(json.dumps(result, indent=2), flush=True)
        except Exception:
            if changed:
                print('Restoring both previous service images. Additive data remains preserved.', flush=True)
                temporary = BASE / '.env.production.colabb-restore'
                temporary.write_text(env_text)
                os.chmod(temporary, 0o600)
                os.replace(temporary, env_path)
                run(['git', '-C', str(BASE), 'checkout', '--detach', args.expected])
                old_ui = re.search(r'^CONNECT_WEB_UI=(.*)$', env_text, re.M)
                composition(args.expected, 'up', '-d', '--no-deps', 'jobs', 'app', ui=old_ui.group(1) if old_ui else 'connect')
                await_ready(args.expected)
            raise


if __name__ == '__main__':
    main()
