"""Local packaging tests use synthetic files in /tmp, never a real Lambda source."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('packager', Path(__file__).with_name('package-lambda.py'))
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)


class PackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'repo'
        self.root.mkdir()
        self.source = self.root / packager.SOURCE
        self.source.mkdir(parents=True)
        subprocess.run(['git', 'init', '-q', str(self.root)], check=True)
        self.config = {'Runtime': 'nodejs22.x', 'Handler': 'index.handler', 'PackageType': 'Zip'}
        self.output = Path(self.temp.name) / 'lambda.zip'

    def track(self, name, text):
        file = self.source / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(text)
        subprocess.run(['git', 'add', str(file)], cwd=self.root, check=True)

    def package(self):
        packager.package(self.root, self.config, self.output)

    def test_zip_root_matches_handler_and_excludes_untracked_and_frontend(self):
        self.track('index.mjs', 'export const handler = async () => null;\n')
        self.track('README.md', 'fixture only')
        (self.root / 'public').mkdir()
        (self.root / 'public' / 'index.html').write_text('frontend')
        (self.source / 'local-only.txt').write_text('not tracked')
        self.package()
        with zipfile.ZipFile(self.output) as archive:
            self.assertEqual(['index.mjs'], archive.namelist())
            self.assertIsNone(archive.testzip())
            self.assertEqual((self.source / 'index.mjs').read_bytes(), archive.read('index.mjs'))

    def test_missing_actual_source_fails_without_placeholder_zip(self):
        self.track('README.md', 'source pending')
        with self.assertRaisesRegex(ValueError, 'source is missing'):
            self.package()
        self.assertFalse(self.output.exists())

    def test_existing_commonjs_package_semantics_are_preserved(self):
        self.track('index.js', 'exports.handler = async () => null;\n')
        self.track('package.json', json.dumps({'type': 'commonjs'}))
        self.track('package-lock.json', '{}')
        self.package()
        with zipfile.ZipFile(self.output) as archive:
            self.assertIn('index.js', archive.namelist())
            self.assertEqual('commonjs', json.loads(archive.read('package.json'))['type'])

    def test_container_unknown_runtime_and_handler_path_traversal_fail(self):
        self.track('index.js', 'exports.handler = async () => null;\n')
        for change in ({'PackageType': 'Image'}, {'Runtime': 'python3.12'},
                       {'Handler': '../index.handler'}, {'Handler': 'index'}):
            config = dict(self.config, **change)
            with self.subTest(change=change), self.assertRaises(ValueError):
                packager.package(self.root, config, self.output)

    def test_dependency_manifest_requires_lockfile_and_installed_dependencies(self):
        self.track('index.js', 'exports.handler = async () => null;\n')
        self.track('package.json', json.dumps({'dependencies': {'fixture': '1.0.0'}}))
        with self.assertRaisesRegex(ValueError, 'package-lock'):
            self.package()
        self.track('package-lock.json', '{}')
        with self.assertRaisesRegex(ValueError, 'dependencies are missing'):
            self.package()
        dep = self.source / 'node_modules' / 'fixture'
        dep.mkdir(parents=True)
        (dep / 'index.js').write_text('module.exports = {};')
        self.package()
        with zipfile.ZipFile(self.output) as archive:
            self.assertIn('node_modules/fixture/index.js', archive.namelist())

    def test_tracked_dotenv_and_zip_are_rejected(self):
        self.track('index.js', 'exports.handler = async () => null;\n')
        for name in ('.env', 'generated.zip'):
            self.track(name, 'fixture')
            with self.assertRaisesRegex(ValueError, 'excluded file'):
                self.package()
            subprocess.run(['git', 'rm', '--cached', '-q', name], cwd=self.source, check=True)

    def test_selected_function_is_isolated_from_other_function_sources(self):
        self.track('index.mjs', 'export const handler = async () => null;')
        other = self.root / 'backend/lambda/getPublicPartners/index.cjs'
        other.parent.mkdir(parents=True)
        other.write_text('exports.handler = async () => "other-fixture";')
        subprocess.run(['git', 'add', str(other)], cwd=self.root, check=True)
        packager.package(self.root, self.config, self.output, 'getPublicPartners')
        with zipfile.ZipFile(self.output) as archive:
            self.assertEqual(['index.cjs'], archive.namelist())
            self.assertEqual(other.read_bytes(), archive.read('index.cjs'))

    def test_ambiguous_handler_module_files_fail_closed(self):
        self.track('index.mjs', 'export const handler = async () => null;')
        self.track('index.cjs', 'exports.handler = async () => null;')
        with self.assertRaisesRegex(ValueError, 'Ambiguous'):
            self.package()

    def test_unknown_function_is_never_packaged(self):
        with self.assertRaisesRegex(ValueError, 'allowlist'):
            packager.package(self.root, self.config, self.output, 'unknownFunction')

    def test_symlink_and_native_dependencies_fail_closed(self):
        self.track('index.js', 'exports.handler = async () => null;\n')
        self.track('package.json', '{"dependencies":{"fixture":"1.0.0"}}')
        self.track('package-lock.json', '{}')
        dep = self.source / 'node_modules' / 'fixture'
        dep.mkdir(parents=True)
        (dep / 'outside.js').symlink_to(self.source / 'index.js')
        with self.assertRaisesRegex(ValueError, 'Symbolic'):
            self.package()
        (dep / 'outside.js').unlink()
        (dep / 'native.node').write_bytes(b'fixture')
        with self.assertRaisesRegex(ValueError, 'Native'):
            self.package()


if __name__ == '__main__':
    unittest.main()
