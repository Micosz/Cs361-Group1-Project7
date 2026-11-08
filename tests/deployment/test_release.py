"""Offline release guards: isolated Git fixtures and mocked AWS CLI boundary."""
import base64
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[2]

class PackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.repo = self.base / 'repo'
        self.repo.mkdir()
        shutil.copytree(ROOT / 'scripts', self.repo / 'scripts')
        shutil.copytree(ROOT / 'backend/lambda/CSTUHubAuth', self.repo / 'backend/lambda/CSTUHubAuth', ignore=shutil.ignore_patterns('__pycache__', '.venv'))
        for path in ['tests/secret.py', 'public/index.html']:
            p=self.repo/path; p.parent.mkdir(parents=True, exist_ok=True); p.write_text('not deployed')
        for args in [('init',),('config','user.email','test@example.test'),('config','user.name','Test'),('add','.'),('commit','-m','fixture')]:
            subprocess.run(['git',*args],cwd=self.repo,check=True,capture_output=True)
        self.output=self.base/'auth.zip'
    def package(self, output=None):
        return subprocess.run([sys.executable,str(self.repo/'scripts/package-auth-lambda.py'),str(output or self.output)],capture_output=True,text=True)
    def test_package_identity_no_tests_and_importable_handler(self):
        self.assertEqual(self.package().returncode,0)
        with zipfile.ZipFile(self.output) as z:
            self.assertIsNone(z.testzip())
            self.assertIn('backend/lambda_function.py',z.namelist())
            self.assertFalse(any('tests/' in p or p.startswith('public/') for p in z.namelist()))
            sha=subprocess.check_output(['git','rev-parse','HEAD'],cwd=self.repo).decode().strip()
            self.assertEqual(z.read('SOURCE_COMMIT').decode().strip(),sha)
        env={**os.environ,'PYTHONPATH':str(self.output),'AWS_EC2_METADATA_DISABLED':'true'}
        result=subprocess.run([sys.executable,'-c','from backend.lambda_function import handler; assert callable(handler)'],cwd=self.base,env=env,capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)
        second=self.base/'second.zip'
        self.assertEqual(self.package(second).returncode,0)
        self.assertEqual(self.output.read_bytes(),second.read_bytes())
    def test_dirty_source_existing_output_and_repo_output_are_rejected(self):
        self.assertNotEqual(self.package(self.repo/'auth.zip').returncode,0)
        self.output.write_bytes(b'existing')
        self.assertNotEqual(self.package().returncode,0)
        self.assertEqual(self.output.read_bytes(),b'existing')
        self.output.unlink()
        with (self.repo/'backend/lambda/CSTUHubAuth/backend/lambda_function.py').open('a') as f: f.write('\n# uncommitted\n')
        self.assertNotEqual(self.package().returncode,0)
    def test_committed_invalid_syntax_is_rejected(self):
        p=self.repo/'backend/lambda/CSTUHubAuth/backend/broken.py';p.write_text('def broken(:')
        subprocess.run(['git','add','.'],cwd=self.repo,check=True,capture_output=True)
        subprocess.run(['git','commit','-m','invalid fixture'],cwd=self.repo,check=True,capture_output=True)
        self.assertNotEqual(self.package().returncode,0)

class ReleaseTests(unittest.TestCase):
    def setUp(self):
        spec=importlib.util.spec_from_file_location('release',ROOT/'deploy/deploy-auth.py')
        self.module=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.module)
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.zip=Path(self.temp.name)/'auth.zip';self.sha='a'*40
        self.make_zip()
        self.before=dict(FunctionArn=self.module.ARN,Runtime='python3.12',Handler='backend.lambda_function.handler',PackageType='Zip',State='Active',LastUpdateStatus='Successful',CodeSha256='old',RevisionId='r1',Environment={'Variables':{'SYNTHETIC':'unchanged'}})
    def make_zip(self,sha=None,handler=True):
        with zipfile.ZipFile(self.zip,'w') as z:
            z.writestr('SOURCE_COMMIT',sha or self.sha)
            if handler:z.writestr('backend/lambda_function.py','def handler(event, context): return {}')
    def run_release(self, account=None, remote=None, before=None, race=False, wrong_hash=False):
        before=before or self.before;calls=[];configs=0
        digest=base64.b64encode(hashlib.sha256(self.zip.read_bytes()).digest()).decode()
        def aws(service,*args):
            nonlocal configs
            calls.append((service,*args));action=args[0]
            if service=='sts':return {'Account':account or self.module.ACCOUNT}
            if action=='get-function-configuration':
                configs+=1; c=copy.deepcopy(before)
                if race and configs==2:c['CodeSha256']='other'
                if configs==3:c['CodeSha256']='wrong' if wrong_hash else digest
                return c
            if action=='list-versions-by-function':return {'Versions':[]}
            if action=='publish-version':return {'Version':'7'}
            if action in ('update-function-code','wait'):return {}
            raise AssertionError((service,args))
        self.calls=calls
        with patch.object(self.module,'aws',side_effect=aws),patch.object(self.module.subprocess,'check_output',return_value=(remote or self.sha)+' refs/heads/main\n'),patch.object(sys,'argv',['deploy',str(self.zip),self.sha]),patch.object(self.module,'summary'):
            self.module.main()
        return calls
    def test_aws_failure_reports_only_allowlisted_error_code(self):
        for prefix in ("", "aws: [ERROR]: "):
            stderr = (f"{prefix}An error occurred (AccessDeniedException) when calling the "
                      "GetFunctionConfiguration operation: private-message")
            result = subprocess.CompletedProcess([], 254, stdout="private-output", stderr=stderr)
            with self.subTest(prefix=prefix), patch.object(self.module.subprocess, 'run', return_value=result):
                with self.assertRaises(RuntimeError) as error:
                    self.module.configuration()
                self.assertEqual(str(error.exception),
                                 "AWS lambda get-function-configuration failed; AccessDeniedException; exit 254")

    def test_success_backs_up_before_revision_guarded_update(self):
        calls=self.run_release();actions=[x[1] for x in calls]
        self.assertLess(actions.index('publish-version'),actions.index('update-function-code'))
        update=next(x for x in calls if x[1]=='update-function-code')
        self.assertIn('--revision-id',update);self.assertIn('--publish',update)
        self.assertNotIn('update-function-configuration',actions)
    def test_wrong_account_stale_main_and_invalid_configuration_never_update(self):
        for kwargs in [{'account':'wrong'},{'remote':'b'*40},{'before':{**self.before,'Handler':'wrong.handler'}},{'before':{**self.before,'State':'Pending'}}]:
            with self.subTest(kwargs=kwargs),self.assertRaises(RuntimeError):self.run_release(**kwargs)
            self.assertFalse(any(x[1]=='update-function-code' for x in self.calls))
    def test_bad_commit_or_missing_handler_rejects_before_aws(self):
        for sha,handler in [('b'*40,True),(self.sha,False)]:
            self.make_zip(sha,handler)
            with self.assertRaises(RuntimeError):self.run_release()
            self.assertEqual(self.calls,[])
    def test_race_stops_update_and_postdeploy_hash_mismatch_fails(self):
        with self.assertRaisesRegex(RuntimeError,'changed during backup'):self.run_release(race=True)
        self.assertFalse(any(x[1]=='update-function-code' for x in self.calls))
        with self.assertRaisesRegex(RuntimeError,'verification failed'):self.run_release(wrong_hash=True)
    def test_identical_artifact_is_noop(self):
        digest=base64.b64encode(hashlib.sha256(self.zip.read_bytes()).digest()).decode()
        calls=self.run_release(before={**self.before,'CodeSha256':digest})
        self.assertFalse(any(x[1] in ('publish-version','update-function-code') for x in calls))
