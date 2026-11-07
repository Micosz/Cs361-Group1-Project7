"""Peer Activity domain is used by the durable shared adapter, with AWS doubles."""
import unittest
from backend.tests import test_workspace_storage as storage


class ActivityStorageTests(unittest.TestCase):
    def test_create_update_assignment_and_stale_request(self):
        flow=storage.WorkspaceStorageTests();flow.setUp();call=flow.call
        payload=dict(title='กิจกรรมทดสอบ',type='event',summary='ทดสอบ',scopeId='cs-demo',partnerId='partner-demo',responsibleUserIds=[flow.ids['coordinator']])
        result,body=call('/api/activities','POST',payload);self.assertEqual(201,result['statusCode'],body)
        record=body['data'];flow.actor='coordinator'
        self.assertEqual(200,call('/api/activities/'+record['id'])[0]['statusCode'])
        result,body=call('/api/activities/'+record['id'],'PATCH',dict(title='แก้แล้ว'),version=1)
        self.assertEqual(200,result['statusCode'],body)
        self.assertEqual(409,call('/api/activities/'+record['id'],'PATCH',dict(title='เก่า'),version=1)[0]['statusCode'])
        flow.actor='staff'
        self.assertEqual(200,call('/api/activities/'+record['id'],'PATCH',dict(responsibleUserIds=[flow.ids['staff']]),version=2)[0]['statusCode'])
        flow.actor='coordinator';self.assertEqual(404,call('/api/activities/'+record['id'])[0]['statusCode'])
