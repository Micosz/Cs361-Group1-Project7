"""Shared API/storage integration with explicit local AWS doubles, not deployment proof."""
import base64
import importlib.util
import json
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit
import unittest

from backend.auth.session_service import COOKIE_NAME
from backend.business.dynamo_repository import DynamoBusinessRepository

spec = importlib.util.spec_from_file_location('workspace_server', Path(__file__).parents[2] / 'tools/mock-auth/server.py')
local = importlib.util.module_from_spec(spec); spec.loader.exec_module(local)


class WorkspaceStorageTests(unittest.TestCase):
    def setUp(self):
        self.app, catalog = local.make_app(8765, writable=True)
        self.ids = {entry['username']: entry['id'] for entry in catalog}
        self.repository = self.app.repository
        self.actor = 'staff'

    def call(self, path, method='GET', data=None, version=None, key='workspace-submission-0001'):
        service = self.app.sessions
        issued = service._issue(service.users.get(self.ids[self.actor]))
        headers = {'origin': service.policy.origin, 'x-csrf-token': issued.csrf_token, 'idempotency-key': key}
        if version:
            headers['if-match'] = '"' + str(version) + '"'
        parsed = urlsplit(path)
        result = self.app.handle(dict(version='2.0', rawPath=parsed.path,
            requestContext={'http': {'method': method}}, headers=headers,
            cookies=[COOKIE_NAME + '=' + issued.token], body=json.dumps(data or {}),
            queryStringParameters=dict(parse_qsl(parsed.query))))
        return result, json.loads(result['body']) if not result.get('isBase64Encoded') else base64.b64decode(result['body'])

    def create_agreement(self):
        result, body = self.call('/api/agreements', 'POST', dict(title='ข้อตกลงทดสอบ', agreementType='MoU',
            scopeId='cs-demo', partnerIds=['partner-demo']))
        self.assertEqual(201, result['statusCode'], body)
        return body['data']

    def test_create_read_update_restart_retry_and_stale_version(self):
        row = self.create_agreement()
        self.app.repository = DynamoBusinessRepository(self.repository.client, 'business', self.app.sessions,
            'users', 'sessions', self.repository.documents)
        again = self.create_agreement()
        self.assertEqual(row['id'], again['id'])
        result, body = self.call('/api/agreements/' + row['id'], 'PATCH', {'title': 'แก้ไขแล้ว'}, version=1)
        self.assertEqual(200, result['statusCode'], body)
        self.assertEqual('แก้ไขแล้ว', body['data']['title'])
        result, _ = self.call('/api/agreements/' + row['id'], 'PATCH', {'title': 'คำขอเก่า'}, version=1)
        self.assertEqual(409, result['statusCode'])
        self.actor = 'student-a'
        self.assertEqual(404, self.call('/api/agreements/' + row['id'])[0]['statusCode'])

    def test_contact_delete_is_atomic_in_dynamo_adapter(self):
        result, body = self.call('/api/partners/partner-demo/contacts', 'POST',
            {'name': 'Delete through Dynamo'}, key='dynamo-contact-delete-create')
        self.assertEqual(201, result['statusCode'], body)
        contact = body['data']
        self.app.repository = DynamoBusinessRepository(self.repository.client, 'business', self.app.sessions,
            'users', 'sessions', self.repository.documents, partner_table='Partner')

        result, body = self.call('/api/partners/partner-demo/contacts/' + contact['id'], 'DELETE',
                                 version=contact['version'])
        self.assertEqual(200, result['statusCode'], body)
        self.assertEqual({'id': contact['id'], 'deleted': True}, body['data'])
        delete = next(item['Delete'] for item in self.repository.client.transactions[-1] if 'Delete' in item)
        self.assertEqual('business', delete['TableName'])
        self.assertIn('partnerId', delete['ExpressionAttributeNames'].values())
        self.assertEqual(404, self.call('/api/partners/partner-demo/contacts/' + contact['id'])[0]['statusCode'])

    def test_private_upload_stream_participant_and_revocation(self):
        data = dict(title='แลกเปลี่ยนทดสอบ', scopeId='cs-demo', partnerIds=['partner-demo'],
                    participantUserIds=[self.ids['student-a']], outcomeSummary='Test project outcome')
        result, body = self.call('/api/exchanges', 'POST', data)
        self.assertEqual(201, result['statusCode'], body)
        exchange = body['data']
        self.assertEqual('Test project outcome', exchange['outcomeSummary'])
        content = b'%PDF-1.4 integration fixture'
        upload = dict(fileName='a.pdf', contentType='application/pdf', fileBase64=base64.b64encode(content).decode(),
                      audience='participants', containsPersonal=True)
        result, body = self.call('/api/exchanges/' + exchange['id'] + '/documents', 'POST', upload)
        self.assertEqual(201, result['statusCode'], body)
        document = body['data']
        self.assertNotIn('objectKey', document)
        self.actor = 'student-a'
        student_result, student_body = self.call('/api/exchanges/' + exchange['id'])
        self.assertEqual(200, student_result['statusCode'], student_body)
        self.assertNotIn('outcomeSummary', student_body['data'])
        result, raw = self.call('/api/documents/' + document['id'] + '/content')
        self.assertEqual(200, result['statusCode']); self.assertEqual(content, raw)
        self.actor = 'student-b'
        self.assertEqual(404, self.call('/api/documents/' + document['id'] + '/content')[0]['statusCode'])
        self.actor = 'staff'
        self.assertEqual(200, self.call('/api/exchanges/' + exchange['id'], 'PATCH', {'participantUserIds': []}, version=1)[0]['statusCode'])
        self.actor = 'student-a'
        self.assertEqual(404, self.call('/api/documents/' + document['id'] + '/content')[0]['statusCode'])

    def image_fixture(self, mime='image/png'):
        result, body = self.call('/api/exchanges', 'POST', dict(
            title='Image removal fixture', scopeId='cs-demo', partnerIds=['partner-demo'],
            responsibleUserIds=[self.ids['coordinator']], participantUserIds=[self.ids['student-a']]))
        self.assertEqual(201, result['statusCode'], body)
        exchange = body['data']
        raw = b'\x89PNG\r\n\x1a\n fixture' if mime == 'image/png' else b'%PDF-1.4 fixture'
        result, body = self.call('/api/exchanges/' + exchange['id'] + '/documents', 'POST', dict(
            fileName='image.png' if mime == 'image/png' else 'file.pdf', contentType=mime,
            fileBase64=base64.b64encode(raw).decode(), audience='participants', containsPersonal=False))
        self.assertEqual(201, result['statusCode'], body)
        return exchange, body['data']

    def test_image_delete_removes_listing_metadata_and_content_with_version_guard(self):
        exchange, document = self.image_fixture()
        path = '/api/documents/' + document['id']
        self.assertEqual(428, self.call(path, 'DELETE')[0]['statusCode'])
        self.assertEqual(409, self.call(path, 'DELETE', version=9)[0]['statusCode'])
        self.assertEqual(200, self.call(path + '/content')[0]['statusCode'])
        self.actor = 'coordinator'
        result, body = self.call(path, 'DELETE', version=document['version'])
        self.assertEqual(200, result['statusCode'], body)
        self.assertEqual({'id': document['id'], 'deleted': True}, body['data'])
        self.assertEqual(404, self.call(path)[0]['statusCode'])
        self.assertEqual(404, self.call(path + '/content')[0]['statusCode'])
        result, body = self.call('/api/exchanges/' + exchange['id'] + '/documents')
        self.assertEqual([], body['data'])
        self.assertEqual('deleted', self.repository.client.rows[document['id']]['uploadState'])

    def test_image_delete_requires_assigned_editor_and_rechecks_parent_at_commit(self):
        exchange, document = self.image_fixture()
        path = '/api/documents/' + document['id']
        for actor in ['student-a', 'executive', 'employee']:
            self.actor = actor
            self.assertEqual(403, self.call(path, 'DELETE', version=1)[0]['statusCode'])
        self.actor = 'coordinator'
        def reassign():
            self.repository.client.rows[exchange['id']]['responsibleUserIds'] = []
            self.repository.client.rows[exchange['id']]['version'] += 1
        self.repository.client.before_commit = reassign
        self.assertEqual(409, self.call(path, 'DELETE', version=1)[0]['statusCode'])
        self.assertEqual('ready', self.repository.client.rows[document['id']]['uploadState'])
        self.assertEqual(404, self.call(path, 'DELETE', version=1)[0]['statusCode'])
        self.actor = 'staff'
        self.assertEqual(200, self.call(path, 'DELETE', version=1)[0]['statusCode'])

    def test_image_delete_does_not_delete_other_document_types(self):
        _, document = self.image_fixture('application/pdf')
        self.assertEqual(404, self.call('/api/documents/' + document['id'], 'DELETE', version=1)[0]['statusCode'])
        self.assertEqual(200, self.call('/api/documents/' + document['id'] + '/content')[0]['statusCode'])

    def test_reference_race_and_failed_upload_cleanup(self):
        def change_reference():
            self.repository.client.rows['partner-demo']['version'] += 1
        self.repository.client.before_commit = change_reference
        result, _ = self.call('/api/agreements', 'POST', dict(title='Race', agreementType='MoU', scopeId='cs-demo', partnerIds=['partner-demo']))
        self.assertEqual(409, result['statusCode'])
        row = self.create_agreement()
        def revoke_actor():
            self.app.sessions.users.rows[self.ids['staff']]['authzVersion'] += 1
        self.repository.client.before_commit = revoke_actor
        payload = dict(fileName='a.pdf', contentType='application/pdf', fileBase64=base64.b64encode(b'%PDF-test').decode())
        result, _ = self.call('/api/agreements/' + row['id'] + '/documents', 'POST', payload)
        self.assertEqual(409, result['statusCode'])
        self.assertFalse(self.repository.documents.client.rows)

    def test_overview_is_role_scoped_filtered_and_summarizes_feedback_without_identity(self):
        self.create_agreement()
        result, body = self.call('/api/activities', 'POST', dict(title='Outcome activity', type='event',
            summary='Activity summary', outcomeSummary='Students completed a joint project',
            partnerId='partner-demo', scopeId='cs-demo', periodDate='2026-10-18'), key='overview-activity-create-0001')
        self.assertEqual(201, result['statusCode'], body)
        activity = body['data']
        result, body = self.call('/api/activities/' + activity['id'] + '/feedback', 'POST', dict(
            occurredOn='2026-10-18', sourceType='partner', comment='Useful collaboration',
            improvement='Schedule the workshop earlier', respondentName='Private respondent'),
            key='overview-feedback-create-0001')
        self.assertEqual(201, result['statusCode'], body)

        result, body = self.call('/api/overview')
        self.assertEqual(200, result['statusCode'], body)
        self.assertEqual('staff', body['data']['role'])
        self.assertEqual({'count': 1, 'statuses': {'draft': 1}}, body['data']['agreements'])
        self.assertEqual(1, body['data']['activities']['outcomesRecorded'])
        self.assertEqual(1, body['data']['outcomes']['count'])
        self.assertEqual(1, body['data']['feedback']['count'])
        self.assertNotIn('Private respondent', json.dumps(body))
        filtered = self.call('/api/overview?activityType=event&startDate=2026-10-18&endDate=2026-10-18')
        self.assertEqual(200, filtered[0]['statusCode'], filtered[1])
        self.assertEqual(1, filtered[1]['data']['activities']['count'])
        self.assertEqual(422, self.call('/api/overview?stakeholderType=unknown')[0]['statusCode'])
        self.assertEqual(404, self.call('/api/overview?scopeId=outside-scope')[0]['statusCode'])
        self.assertEqual(422, self.call('/api/overview?unknown=value')[0]['statusCode'])

        self.actor = 'executive'
        result, body = self.call('/api/overview')
        self.assertEqual(200, result['statusCode'], body)
        self.assertEqual('executive', body['data']['role'])
        self.assertEqual({'count': 1, 'statuses': {'draft': 1}}, body['data']['agreements'])
        self.assertNotIn('responsibleUserIds', json.dumps(body))
        self.assertNotIn('respondentName', json.dumps(body))


    def test_existing_partner_table_keeps_fields_and_checks_cross_table_references(self):
        self.repository.partner_table = 'Partner'
        original_query=self.repository.client.query
        def original_table_query(**kwargs):
            if kwargs.get('TableName')=='Partner':
                from backend.auth.dynamo_accounts import decode
                from backend.permissions.transactions import values
                key=decode(kwargs['ExpressionAttributeValues'])[':id']
                row=self.repository.client.rows.get(key)
                return {'Items':[values(row)] if row else []}
            return original_query(**kwargs)
        self.repository.client.query=original_table_query

        self.repository.client.rows['partner-demo'].update(source_urls=['https://example.test/source'], full_description='Original source')
        result, body = self.call('/api/partners/partner-demo','PATCH',{'summary':'Edited summary'},version=1)
        self.assertEqual(200,result['statusCode'],body)
        saved=self.repository.client.rows['partner-demo']
        self.assertEqual(['https://example.test/source'],saved['source_urls'])
        self.assertEqual('Original source',saved['full_description'])
        self.assertEqual('Partner',self.repository.client.transactions[-1][-1]['Put']['TableName'])
        self.assertEqual({'id','type'},set(self.repository._key('partner',saved)))
        result, body = self.call('/api/activities','POST',dict(scopeId='cs-demo',title='Event in original table',
            type='event',summary='Test',partnerId='partner-demo',publication='public'),key='original-table-activity')
        self.assertEqual(201,result['statusCode'],body)
        row=self.repository.client.rows[body['data']['id']]
        self.assertEqual('public',row['visibility'])
        self.assertEqual('public',row['access_level'])
        self.assertTrue(any(item.get('Put',{}).get('TableName')=='Partner' for item in self.repository.client.transactions[-1]))
        agreement=self.create_agreement()
        transaction=self.repository.client.transactions[-1]
        self.assertTrue(any(item.get('ConditionCheck',{}).get('TableName')=='Partner' for item in transaction))
        self.assertTrue(all('type' in item['ConditionCheck']['Key'] for item in transaction if item.get('ConditionCheck',{}).get('TableName')=='Partner'))
        self.assertTrue(any(item.get('Put',{}).get('TableName')=='business' for item in transaction))
        self.assertEqual('agreement',self.repository.get('agreement',agreement['id'])['entityType'])

    def test_partner_scan_and_contact_parent_check_use_original_table(self):
        from backend.permissions.transactions import values
        self.repository.partner_table='Partner'
        original_query=self.repository.client.query
        def original_table_query(**kwargs):
            if kwargs.get('TableName')=='Partner':
                from backend.auth.dynamo_accounts import decode
                from backend.permissions.transactions import values
                key=decode(kwargs['ExpressionAttributeValues'])[':id']
                row=self.repository.client.rows.get(key)
                return {'Items':[values(row)] if row else []}
            return original_query(**kwargs)
        self.repository.client.query=original_table_query

        scans=[]
        def scan(**kwargs):
            scans.append(kwargs)
            return {'Items':[values({'id':'partner-demo'})]}
        self.repository.client.scan=scan
        result, body=self.call('/api/partners')
        self.assertEqual(200,result['statusCode'],body)
        self.assertEqual('Partner',scans[0]['TableName'])
        self.assertTrue(scans[0]['ConsistentRead'])
        self.assertIn('partner-demo',[row['id'] for row in body['data']])
        result, body=self.call('/api/partners/partner-demo/contacts','POST',{'name':'Test contact'},key='original-table-contact')
        self.assertEqual(201,result['statusCode'],body)
        transaction=self.repository.client.transactions[-1]
        self.assertTrue(any(item.get('ConditionCheck',{}).get('TableName')=='Partner' for item in transaction))
        self.assertTrue(all('type' in item['ConditionCheck']['Key'] for item in transaction if item.get('ConditionCheck',{}).get('TableName')=='Partner'))
        self.assertTrue(any(item.get('Put',{}).get('TableName')=='business' for item in transaction))

    def test_anonymous_public_mou_summary_and_unpublish(self):
        from backend.permissions.transactions import values
        self.repository.client.scan = lambda **kwargs: {'Items': [values(row) for row in self.repository.client.rows.values()]}
        private = self.create_agreement()
        result, body = self.call('/api/agreements', 'POST', dict(title='Public safe MoU',
            agreementType='MoU', scopeId='cs-demo', partnerIds=['partner-demo'],
            publication='public', internalNote='SECRET', renewalNote='SECRET'), key='public-mou-test-1')
        self.assertEqual(201, result['statusCode'], body)
        public = body['data']
        def anonymous(path, method='GET', query=None):
            return self.app.handle(dict(version='2.0', rawPath=path,
                requestContext={'http':{'method':method}}, queryStringParameters=query))
        for path in ['/api/public/agreements', '/api/public/agreements/'+public['id']]:
            response = anonymous(path)
            self.assertEqual(200, response['statusCode'], response)
            self.assertNotIn('SECRET', response['body'])
            self.assertNotIn('responsibleUserIds', response['body'])
            self.assertNotIn('scopeId', response['body'])
        listing = json.loads(anonymous('/api/public/agreements')['body'])
        self.assertEqual([public['id']], [r['id'] for r in listing['data']])
        self.assertEqual(404, anonymous('/api/public/agreements/'+private['id'])['statusCode'])
        self.assertEqual(405, anonymous('/api/public/agreements/'+public['id'], 'PATCH')['statusCode'])
        self.assertEqual(404, anonymous('/api/public/agreements/'+public['id']+'/documents')['statusCode'])
        self.assertEqual(422, anonymous('/api/public/agreements', query={'startDate':'invalid'})['statusCode'])
        self.assertEqual(0, json.loads(anonymous('/api/public/agreements', query={'q':'SECRET'})['body'])['count'])
        result, body = self.call('/api/agreements/'+public['id'], 'PATCH',
            {'publication':'internal'}, version=public['version'])
        self.assertEqual(200, result['statusCode'], body)
        self.assertEqual(404, anonymous('/api/public/agreements/'+public['id'])['statusCode'])
        self.assertEqual([], json.loads(anonymous('/api/public/agreements')['body'])['data'])
