"""Node release safety and committed ZIP packaging, without AWS or TU requests."""
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile
from unittest.mock import patch
import test_release as release_tests

ROOT = release_tests.ROOT


class NodeReleaseTests(release_tests.ReleaseTests):
    # Exercise the same release regression suite against a Node target.
    def setUp(self):
        super().setUp()
        self.function = 'fetchPartnersData'
        self.before.update(FunctionArn=f'arn:aws:lambda:{self.module.REGION}:{self.module.ACCOUNT}:function:{self.function}', Runtime='nodejs24.x', Handler='index.handler')
        self.make_zip()
    def make_zip(self, sha=None, handler=True):
        with zipfile.ZipFile(self.zip, 'w') as z:
            z.writestr('SOURCE_COMMIT', sha or self.sha)
            z.writestr('SOURCE_FUNCTION', 'fetchPartnersData')
            if handler: z.writestr('index.mjs', 'export const handler = async () => ({});')
    def run_release(self, **kwargs):
        original = self.module.argparse.ArgumentParser.parse_args
        def parse(parser, *args, **options):
            result = original(parser, *args, **options)
            result.function = self.function
            result.preflight = getattr(self, 'preflight', False)
            return result
        with patch.object(self.module.argparse.ArgumentParser, 'parse_args', parse):
            return super().run_release(**kwargs)
    def test_wrong_function_artifact_is_rejected_before_aws(self):
        self.function = 'tuAuthLogin'
        with self.assertRaisesRegex(RuntimeError, 'different function'): self.run_release()
        self.assertEqual(self.calls, [])
    def test_preflight_is_read_only(self):
        self.preflight = True
        calls = self.run_release()
        self.assertEqual([c[1] for c in calls], ['get-caller-identity', 'get-function-configuration'])
    def test_wrong_runtime_is_rejected(self):
        with self.assertRaises(RuntimeError): self.run_release(before={**self.before, 'Runtime':'nodejs22.x'})
        self.assertFalse(any(c[1]=='update-function-code' for c in self.calls))


class NodePackageTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.base=Path(self.temp.name); self.repo=self.base/'repo'; self.repo.mkdir()
        (self.repo/'scripts').mkdir()
        shutil.copy(ROOT/'scripts/package-node-lambda.py', self.repo/'scripts')
        self.source=self.repo/'backend/lambda/tuAuthLogin'; self.source.mkdir(parents=True)
        (self.source/'index.mjs').write_text('export const handler = async () => ({});')
        (self.source/'README.md').write_text('not runtime')
        for args in [('init',),('config','user.email','test@example.test'),('config','user.name','Test'),('add','.'),('commit','-m','fixture')]:
            subprocess.run(['git',*args],cwd=self.repo,check=True,capture_output=True)
        self.output=self.base/'tuAuthLogin.zip'
    def package(self, output=None):
        return subprocess.run([sys.executable,str(self.repo/'scripts/package-node-lambda.py'),'tuAuthLogin',str(output or self.output)],capture_output=True,text=True)
    def test_zip_layout_identity_import_and_determinism(self):
        result=self.package(); self.assertEqual(result.returncode,0,result.stderr)
        extracted=self.base/'extracted'
        with zipfile.ZipFile(self.output) as z:
            self.assertEqual(set(z.namelist()), {'index.mjs','SOURCE_COMMIT','SOURCE_FUNCTION'})
            self.assertIsNone(z.testzip()); self.assertEqual(z.read('SOURCE_FUNCTION').decode().strip(),'tuAuthLogin')
            self.assertEqual(z.read('SOURCE_COMMIT').decode().strip(),subprocess.check_output(['git','rev-parse','HEAD'],cwd=self.repo).decode().strip())
            z.extractall(extracted)
        result=subprocess.run(['node','--input-type=module','-e',"const m=await import('./index.mjs'); if(typeof m.handler!=='function') throw Error('handler');"],cwd=extracted,capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)
        second=self.base/'second.zip'; self.assertEqual(self.package(second).returncode,0)
        self.assertEqual(self.output.read_bytes(),second.read_bytes())
    def test_dirty_source_existing_output_and_repo_output_are_rejected(self):
        self.assertNotEqual(self.package(self.repo/'bad.zip').returncode,0)
        self.output.write_bytes(b'keep'); self.assertNotEqual(self.package().returncode,0)
        self.assertEqual(self.output.read_bytes(),b'keep'); self.output.unlink()
        (self.source/'untracked.mjs').write_text('export default 1;')
        self.assertNotEqual(self.package().returncode,0)
    def test_committed_syntax_error_or_missing_handler_rejects(self):
        for source in ['export const handler = ;', 'export const notHandler=1;']:
            (self.source/'index.mjs').write_text(source)
            subprocess.run(['git','add','.'],cwd=self.repo,check=True,capture_output=True)
            subprocess.run(['git','commit','-m','invalid fixture'],cwd=self.repo,check=True,capture_output=True)
            self.assertNotEqual(self.package().returncode,0)
            self.assertFalse(self.output.exists())
