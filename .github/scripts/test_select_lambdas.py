"""Selection tests do not authenticate to AWS or deploy anything."""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('selector', Path(__file__).with_name('select-lambdas.py'))
selector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(selector)


class SelectionTests(unittest.TestCase):
    def test_single_function_changes_only_select_that_function(self):
        for name in selector.FUNCTIONS:
            self.assertEqual([name], selector.select([f'backend/lambda/{name}/index.mjs']))

    def test_multiple_functions_and_shared_tool_changes(self):
        self.assertEqual(['getPublicPartners', 'tuAuthLogin'], selector.select([
            'backend/lambda/getPublicPartners/index.cjs', 'backend/lambda/tuAuthLogin/index.mjs']))
        for path in selector.SHARED:
            self.assertEqual(list(selector.FUNCTIONS), selector.select([path]))

    def test_frontend_docs_tests_and_unknown_functions_do_not_deploy(self):
        for path in ('public/index.html', 'docs/deployment/lambda-cicd.md',
                     'tests/lambda-source.test.cjs', 'backend/lambda/unknown/index.js',
                     '.github/scripts/test_select_lambdas.py', 'backend/lambda/tuAuthLoginOther/index.mjs'):
            self.assertEqual([], selector.select([path]))

    def test_full_push_range_includes_changes_before_last_commit_and_deletions(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def git(*args):
                return subprocess.check_output(['git', *args], cwd=root).decode().strip()
            git('init', '-q')
            git('config', 'user.name', 'Fixture')
            git('config', 'user.email', 'fixture@example.invalid')
            file = root / 'backend/lambda/getPublicPartners/index.cjs'
            file.parent.mkdir(parents=True)
            file.write_text('fixture')
            git('add', '.')
            git('commit', '-qm', 'base')
            before = git('rev-parse', 'HEAD')
            file.unlink()
            git('add', '-A')
            git('commit', '-qm', 'delete handler')
            (root / 'README.md').write_text('docs-only last commit')
            git('add', '.')
            git('commit', '-qm', 'docs')
            after = git('rev-parse', 'HEAD')
            self.assertEqual(['getPublicPartners'], selector.select(selector.changed_paths(before, after, root)))
            self.assertEqual(['getPublicPartners'], selector.select(selector.changed_paths('0' * 40, before, root)))

    def test_invalid_commit_range_fails_closed(self):
        with self.assertRaises(ValueError):
            selector.changed_paths('--help', 'a' * 40)


if __name__ == '__main__':
    unittest.main()
