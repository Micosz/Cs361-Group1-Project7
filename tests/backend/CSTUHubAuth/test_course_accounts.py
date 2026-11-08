"""Three course account checks; no external calls or real passwords."""
import json
from types import SimpleNamespace
import unittest
from backend.auth.course_accounts import CourseProvider, CourseAccounts, password_digest
from backend.auth.session_service import AuthError
from backend.auth.session_store import DynamoUserReader


class CourseAccountTests(unittest.TestCase):
    def setUp(self):
        self.calls=[]
        self.tu=SimpleNamespace(authenticate=lambda *args: self.calls.append(args) or {'type':'student'})
        self.entry=dict(username='course.staff',userId='00000000-0000-0000-0000-000000000001',salt='ab'*16,
                        passwordHash=password_digest('test-only-password','ab'*16))
        self.config=json.dumps([self.entry])

    def test_secret_password_reserved_namespace_and_disabled_mode(self):
        provider=CourseProvider(self.tu,True,self.config)
        self.assertEqual(provider.authenticate('course.staff','test-only-password')['userId'],self.entry['userId'])
        for name,password in [('course.staff','wrong'),('course.missing','test-only-password')]:
            with self.assertRaises(AuthError): provider.authenticate(name,password)
        with self.assertRaises(AuthError): CourseProvider(self.tu).authenticate('course.staff','test-only-password')
        simple = dict(self.entry, username='studenta', passwordHash=password_digest('studenta',self.entry['salt']))
        self.assertEqual(CourseProvider(self.tu,True,json.dumps([simple])).authenticate('studenta','studenta')['userId'],self.entry['userId'])
        with self.assertRaises(AuthError): provider.authenticate('studenta','wrong')
        with self.assertRaises(AuthError): CourseProvider(self.tu).authenticate('studenta','studenta')
        self.assertEqual(self.calls,[])
        self.assertEqual(provider.authenticate('tu-user','tu-pass'),{'type':'student'})
        self.assertEqual(len(self.calls),1)

    def test_coordinator_aliases_and_student_b_use_course_auth_only(self):
        entries = [dict(self.entry, username=name) for name in ('coordinatora', 'coordinatorb', 'studentb')]
        provider = CourseProvider(self.tu, True, json.dumps(entries))
        for entry in entries:
            self.assertEqual(provider.authenticate(entry['username'], 'test-only-password')['userId'], entry['userId'])
            with self.assertRaises(AuthError):
                provider.authenticate(entry['username'], 'wrong')
            with self.assertRaises(AuthError):
                CourseProvider(self.tu).authenticate(entry['username'], 'wrong')
        self.assertEqual([], self.calls)

    def test_current_roles_never_restored_and_wrong_identity_rejected(self):
        row=dict(id=self.entry['userId'],authProvider='course-test',identityVerified=True,active=True,grants=[])
        accounts=CourseAccounts(SimpleNamespace(link=lambda _:self.fail('Must not use TU mapping')),
                                SimpleNamespace(user=lambda _:row))
        profile=CourseProvider(self.tu,True,self.config).authenticate('course.staff','test-only-password')
        self.assertEqual(accounts.link(profile)['grants'],[])
        row['active']=False
        with self.assertRaises(AuthError): accounts.link(profile)
        row.update(active=True,authProvider='tu')
        with self.assertRaises(AuthError): accounts.link(profile)

    def test_disabling_flag_rejects_existing_course_sessions_user_lookup(self):
        row=dict(id=self.entry['userId'],active=True,identityVerified=True,authzVersion=1,authProvider='course-test')
        table=SimpleNamespace(get_item=lambda **_: {'Item':row})
        self.assertIsNone(DynamoUserReader(table).get(row['id']))
        demo_user = DynamoUserReader(table,allow_course_tests=True).get(row['id'])
        self.assertEqual(demo_user.user_id,row['id'])
        self.assertEqual(demo_user.account_type,'demo')
        row['authProvider']='tu'
        self.assertEqual(DynamoUserReader(table).get(row['id']).account_type,'tu')
