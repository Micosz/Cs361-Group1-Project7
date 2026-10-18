import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from backend.application import AuthApplication
from backend.auth.dynamo_accounts import DynamoAccounts
from backend.permissions.transactions import values

class SelectionUsersTests(unittest.TestCase):
    def app(self, role='coordinator', scope='cs'):
        self.calls=[]
        store=SimpleNamespace(selection_users=lambda scope,kind:self.calls.append((scope,kind)) or [{'id':'s','displayName':'Student'}])
        user=SimpleNamespace(permissions=lambda:([{'scopeId':scope,'role':role}],[]))
        context=SimpleNamespace(user=user)
        app=AuthApplication(None,None,SimpleNamespace(store=store),None,None)
        return app,context

    def event(self,kind='participant',scope='cs'):
        return dict(version='2.0',rawPath='/api/selection-users',queryStringParameters={'scopeId':scope,'kind':kind},requestContext={'http':{'method':'GET'}})

    def test_coordinator_participant_names_only_and_rechecks_session(self):
        app,context=self.app()
        with patch('backend.application.require_session',return_value=context) as auth:
            response=app.handle(self.event())
        self.assertEqual(200,response['statusCode'])
        self.assertEqual({'data':[{'id':'s','displayName':'Student'}]},json.loads(response['body']))
        self.assertEqual(2,auth.call_count)

    def test_student_other_scope_and_coordinator_staff_assignment_denied_before_scan(self):
        for role,scope,kind in [('student','cs','participant'),('coordinator','other','participant'),('coordinator','cs','responsible')]:
            app,context=self.app(role)
            with patch('backend.application.require_session',return_value=context):
                response=app.handle(self.event(kind,scope))
            self.assertEqual(403,response['statusCode'])
            self.assertEqual([],self.calls)

    def test_paginated_storage_excludes_inactive_unverified_wrong_scope_and_profiles(self):
        def row(key,**updates):
            return dict(id=key,displayName=key,active=True,identityVerified=True,grants=[dict(scopeId='cs',role='student',active=True)],email='private',**updates)
        rows=[row('ok'),row('wrong')];rows[1]['grants'][0]['scopeId']='other'
        rows+=[row('disabled'),row('unverified'),row('revoked')];rows[2]['active']=False;rows[3]['identityVerified']=False;rows[4]['grants'][0]['active']=False
        def scan(**kwargs):
            if 'ExclusiveStartKey' not in kwargs:return {'Items':[values(r) for r in rows[:2]],'LastEvaluatedKey':values({'id':'next'})}
            return {'Items':[values(r) for r in rows[2:]]}
        store=DynamoAccounts(SimpleNamespace(scan=scan),'users','identities','sessions')
        self.assertEqual([{'id':'ok','displayName':'ok'}],store.selection_users('cs','participant'))

    def test_public_partner_can_be_linked_without_management_read_or_edit(self):
        from backend.permissions.policy import can_reference, allowed_roles
        from backend.tests.test_permissions import context, row
        actor=context('coordinator')
        original=row('partner',key='original',name='Original',publication='public',responsibleUserIds=[])
        self.assertTrue(can_reference(actor,original,'c1'))
        self.assertFalse(allowed_roles(actor,'partner','read',original))
        self.assertFalse(allowed_roles(actor,'partner','update',original))
        self.assertFalse(can_reference(actor,{**original,'visibility':'private'},'c1'))
        self.assertFalse(can_reference(actor,{**original,'publication':'internal'},'c1'))
        self.assertFalse(can_reference(actor,original,'another-scope'))
        self.assertFalse(can_reference(context('student'),original,'c1'))

    def test_partner_picker_combines_assigned_private_and_public_original_minimal_names(self):
        from backend.tests.test_permissions import context, row
        actor=context('coordinator')
        records=[row('partner',key='old',name='Original',publication='public',responsibleUserIds=[]),
                 row('partner',key='assigned',name='Assigned'),
                 row('partner',key='hidden',name='Secret',responsibleUserIds=[]),
                 row('partner',key='other',name='Other',scope='other')]
        app=AuthApplication(None,None,None,None,None,SimpleNamespace(list=lambda *args:records))
        event=dict(version='2.0',rawPath='/api/selection-partners',queryStringParameters={'scopeId':'c1'},requestContext={'http':{'method':'GET'}})
        with patch('backend.application.require_session',return_value=actor):result=app.handle(event)
        self.assertEqual(200,result['statusCode'])
        self.assertEqual([{'id':'assigned','name':'Assigned'},{'id':'old','name':'Original'}],json.loads(result['body'])['data'])
