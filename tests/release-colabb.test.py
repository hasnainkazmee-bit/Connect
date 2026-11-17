"""Release gates using local fixtures; never invoke Docker, curl or a live host."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location('release_colabb', ROOT / 'tools/release-colabb.py')
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)


class NetworkReleaseChecks(unittest.TestCase):
    def test_schema_requires_recorded_migration_and_all_tables_and_acl_functions(self):
        state = {'migrationApplied': True, 'missingTables': [], 'missingFunctions': []}
        with patch.object(release, 'output', return_value=json.dumps(state)) as output:
            self.assertEqual(release.check_network_schema()['networkMigration'], '042_network.sql')
        command = output.call_args.args[0]
        self.assertEqual(command[:4], ['docker', 'exec', release.DB, 'psql'])
        self.assertIn('ON_ERROR_STOP=1', command)
        for name in ('042_network.sql', *release.NETWORK_TABLES, *release.NETWORK_FUNCTIONS):
            self.assertIn(name, command[-1])
        for invalid, message in [
            ({**state, 'migrationApplied': False}, 'has not been applied'),
            ({**state, 'missingTables': ['network_post_files']}, 'network_post_files'),
            ({**state, 'missingFunctions': ['network_can_read_post(uuid,uuid,boolean)']}, 'network_can_read_post'),
            ({'migrationApplied': True}, 'incomplete'),
        ]:
            with self.subTest(invalid=invalid), patch.object(release, 'output', return_value=json.dumps(invalid)):
                with self.assertRaisesRegex(RuntimeError, message):
                    release.check_network_schema()

    def network_assets(self):
        return {
            '/network': '<html><title>Colabb</title><script src="/assets/main.js"></script><link href="/assets/main.css"></html>',
            '/assets/main.js': 'const page=()=>import("./network.js");',
            '/assets/main.css': '.nw-root{display:block}',
            '/assets/network.js': 'const api="/network-v2"; const shared=()=>import("./main.js");',
        }

    def test_guest_gate_and_lazy_network_chunk_are_checked(self):
        assets = self.network_assets()
        with patch.object(release, 'output', return_value='401') as output, patch.object(release, 'request', side_effect=assets.__getitem__) as request:
            result = release.check_network_http()
        self.assertEqual(result, {'networkGuestStatus': 401, 'networkAsset': '/assets/network.js'})
        self.assertEqual([c.args[0] for c in request.call_args_list].count('/assets/main.js'), 1)
        self.assertIn('/assets/main.css', [c.args[0] for c in request.call_args_list])
        command = output.call_args.args[0]
        self.assertEqual(command[-1], 'http://127.0.0.1:14100/api/network-v2/bootstrap')
        self.assertNotIn('--fail', command)  # A required 401 is an expected HTTP response.
        self.assertNotIn('-H', command)  # The probe has no authenticated session.

    def test_guest_success_or_missing_upstream_cannot_pass(self):
        for status in ['200', '404', '502']:
            with self.subTest(status=status), patch.object(release, 'output', return_value=status), patch.object(release, 'request') as request:
                with self.assertRaisesRegex(RuntimeError, 'must return 401'):
                    release.check_network_http()
                request.assert_not_called()

    def test_missing_lazy_bundle_and_stale_frontend_cannot_pass(self):
        for replacement, message in [
            ('', 'static asset'),
            ('<!doctype html><html>Colabb fallback</html>', 'returned HTML'),
            ('const legacy=true;', 'do not include Network'),
        ]:
            assets = {**self.network_assets(), '/assets/network.js': replacement}
            with self.subTest(replacement=replacement), patch.object(release, 'output', return_value='401'), patch.object(release, 'request', side_effect=assets.__getitem__):
                with self.assertRaisesRegex(RuntimeError, message):
                    release.check_network_http()

    def test_valid_javascript_can_contain_literal_html(self):
        assets = self.network_assets()
        assets['/assets/main.js'] += 'const template="<!doctype html><html>Colabb</html>";'
        with patch.object(release, 'output', return_value='401'), patch.object(release, 'request', side_effect=assets.__getitem__):
            self.assertEqual(release.check_network_http()['networkAsset'], '/assets/network.js')

    def test_network_route_must_return_a_colabb_entry_document(self):
        with patch.object(release, 'output', return_value='401'), patch.object(release, 'request', return_value='<html>Colabb unavailable</html>'):
            with self.assertRaisesRegex(RuntimeError, 'entry page'):
                release.check_network_http()

    def test_existing_smoke_requires_network_checks(self):
        def response(path, cookie=None):
            if cookie:
                return '<img src="/assets/connect-icon.png">'
            return {
                '/': 'No one builds <img src="/brand/marks/lockup-primary.svg">',
                '/hire': 'Colabb',
                '/api/jobs/provider-taxonomy': '{"directoryCredentials":[]}',
                '/api/jobs/providers': '{"providers":[{"on_colabb":true}],"total":1}',
            }[path]
        with patch.object(release, 'request', side_effect=response), patch.object(release, 'check_network_http', side_effect=RuntimeError('Network unavailable')):
            with self.assertRaisesRegex(RuntimeError, 'Network unavailable'):
                release.smoke()

    def test_schema_failure_prevents_new_service_start_and_records_backup_boundary(self):
        previous, next_sha = 'a' * 40, 'b' * 40
        with tempfile.TemporaryDirectory() as directory:
            base, releases = Path(directory) / 'connect', Path(directory) / 'releases'
            base.mkdir()
            releases.mkdir()
            env = f'CONNECT_RELEASE={previous}\nCONNECT_WEB_UI=colabb\n'
            (base / '.env.production').write_text(env)
            (releases / f'colabb-{next_sha}.prepared.json').write_text(json.dumps({
                'sha': next_sha, 'previous': previous, 'app': 'app-image', 'jobs': 'jobs-image',
            }))
            def image_output(command):
                return 'app-image' if command[-1].startswith('connect-app:') else 'jobs-image'
            with contextlib.ExitStack() as stack:
                stack.enter_context(patch.object(release, 'BASE', base))
                stack.enter_context(patch.object(release, 'RELEASES', releases))
                stack.enter_context(patch.object(release, 'check_current'))
                stack.enter_context(patch.object(release, 'output', side_effect=image_output))
                stack.enter_context(patch.object(release, 'run'))
                composition = stack.enter_context(patch.object(release, 'composition'))
                stack.enter_context(patch.object(release, 'await_ready'))
                smoke = stack.enter_context(patch.object(release, 'smoke'))
                stack.enter_context(patch.object(release, 'check_network_schema', side_effect=RuntimeError('Network schema is incomplete')))
                stack.enter_context(patch.object(release.os, 'umask'))
                stack.enter_context(patch('sys.argv', ['release-colabb.py', 'deploy', next_sha, '--expected', previous]))
                stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
                with self.assertRaisesRegex(RuntimeError, 'schema is incomplete'):
                    release.main()
            operations = [call.args for call in composition.call_args_list]
            self.assertEqual(operations[0], (next_sha, 'run', '--rm', '--no-deps', 'app', 'node', 'apps/api/dist/migrate.js'))
            self.assertNotIn((next_sha, 'up', '-d', '--no-deps', 'jobs', 'app'), operations)
            self.assertIn((previous, 'up', '-d', '--no-deps', 'jobs', 'app'), operations)
            smoke.assert_not_called()
            self.assertEqual((base / '.env.production').read_text(), env)
            metadata = json.loads(next(releases.glob('colabb-backup-*/release.json')).read_text())
            self.assertIn('042_network.sql', metadata['database'])
            self.assertNotIn('041', metadata['database'])
            self.assertIn('Uploaded attachment bytes', metadata['excludedFromBackup'])
            self.assertIn('not backed up', metadata['excludedFromBackup'])
            self.assertIn('host only', metadata['backupScope'])


if __name__ == '__main__':
    unittest.main()
