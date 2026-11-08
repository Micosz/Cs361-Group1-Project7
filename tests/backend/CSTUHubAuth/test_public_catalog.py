"""Published catalog uses the public allowlist, independently of login roles."""
import json
import unittest
from types import SimpleNamespace
from backend.application import AuthApplication
from backend.business.dynamo_repository import DynamoBusinessRepository
from backend.permissions.transactions import values


class PublicCatalogTests(unittest.TestCase):
    def test_public_catalog_hides_private_rows_and_editor_fields(self):
        rows = [
            dict(id='visible', entityType='partner', name='Public', publication='public',
                 responsibleUserIds=['secret-user'], scopeId='private-scope', version=3,
                 businessRecord=True, legacySource=False, objectKey='secret-object-key',
                 authToken='secret-token'),
            dict(id='demo', entityType='partner', name='QA Staff demo', publication='public',
                 legacySource=True, businessRecord=False),
            dict(id='hidden', entityType='partner', name='Private', publication='internal'),
            dict(id='conflict', entityType='partner', name='Conflict', publication='public', visibility='private'),
            dict(id='news', entityType='activity', title='Public event', publication='public',
                 partnerId='visible', scopeId='private-scope', responsibleUserIds=['secret-user']),
            dict(id='hidden-host', entityType='activity', title='Hidden host', publication='public', partnerId='hidden'),
            dict(id='contact', entityType='contact', name='Private contact', publication='public'),
        ]
        calls = []
        def scan(**query):
            calls.append(query)
            if 'ExclusiveStartKey' not in query:
                return {'Items':[values(row) for row in rows[:3]], 'LastEvaluatedKey':values({'id':'cursor'})}
            return {'Items':[values(row) for row in rows[3:]]}
        repository = DynamoBusinessRepository(SimpleNamespace(scan=scan), 'business', None, 'users', 'sessions')
        result = repository.public_catalog()
        self.assertEqual({'visible','demo','news'}, {row['id'] for row in result})
        self.assertTrue(all(row['visibility']=='public' for row in result))
        response_fields = set().union(*(row.keys() for row in result))
        self.assertFalse({'responsibleUserIds','scopeId','version','businessRecord',
                          'legacySource','objectKey','authToken'} & response_fields)
        self.assertEqual(2,len(calls))
        self.assertTrue(all(call['ConsistentRead'] for call in calls))

    def test_public_route_needs_no_session_and_rejects_writes(self):
        app = AuthApplication(None,None,None,None,None,SimpleNamespace(public_catalog=lambda:[{'id':'public'}]))
        event = dict(version='2.0',rawPath='/api/public/records',requestContext={'http':{'method':'GET'}})
        result=app.handle(event)
        self.assertEqual(200,result['statusCode'])
        self.assertEqual([{'id':'public'}],json.loads(result['body']))
        event['requestContext']['http']['method']='POST'
        self.assertEqual(405,app.handle(event)['statusCode'])
        event['requestContext']['http']['method']='GET'
        event['queryStringParameters']={'scopeId':'private'}
        self.assertEqual(422,app.handle(event)['statusCode'])


    def test_original_composite_key_resolves_active_source_without_deleting_retired_copy(self):
        from backend.auth.session_service import AuthError
        rows=[dict(id='same',type='academic_activity',entityType='activity',source_state='retired'),
              dict(id='same',type='event',entityType='activity',source_state='active')]
        calls=[]
        def query(**kwargs):
            calls.append(kwargs)
            return {'Items':[values(row) for row in rows]}
        repository=DynamoBusinessRepository(SimpleNamespace(query=query),'business',None,'users','sessions',partner_table='CSTUHub-Partner')
        self.assertEqual('event',repository.get('activity','same')['type'])
        self.assertEqual('CSTUHub-Partner',calls[0]['TableName'])
        self.assertTrue(calls[0]['ConsistentRead'])
        rows[0]['source_state']='active'
        with self.assertRaises(AuthError):repository.get('activity','same')
