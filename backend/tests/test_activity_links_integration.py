"""Relationship helpers connected to the real gateway and transaction adapter, with AWS doubles."""
import copy
import json
import unittest
from backend.tests import test_workspace_storage as storage


class ActivityLinksIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.flow=storage.WorkspaceStorageTests();self.flow.setUp()
        partner=copy.deepcopy(self.flow.repository.client.rows['partner-demo'])
        partner.update(id='partner-other',name='ผู้จัดร่วมทดสอบ')
        self.flow.repository.client.rows[partner['id']]=partner

    def test_read_hidden_agreement_unlink_without_delete_and_reassignment(self):
        call=self.flow.call;agreement=self.flow.create_agreement()
        payload=dict(title='กิจกรรมเชื่อมโยง',type='event',summary='ทดสอบ',scopeId='cs-demo',
            partnerId='partner-demo',coHostPartnerIds=['partner-other'],agreementIds=[agreement['id']],
            responsibleUserIds=[self.flow.ids['coordinator']])
        result,body=call('/api/activities','POST',payload);self.assertEqual(201,result['statusCode'],body)
        row=body['data'];self.assertEqual(agreement['id'],row['relationships']['agreements'][0]['id'])
        self.assertTrue(row['relationshipsComplete'])
        self.flow.actor='coordinator'
        result,body=call('/api/activities/'+row['id']);self.assertEqual(200,result['statusCode'],body)
        self.assertFalse(body['data']['relationshipsComplete'])
        self.assertNotIn(agreement['id'],json.dumps(body))
        self.assertNotIn(agreement['title'],json.dumps(body))
        result,body=call('/api/activities/'+row['id'],'PATCH',{'agreementIds':[]},version=1)
        self.assertEqual(200,result['statusCode'],body);self.assertEqual([],body['data']['agreementIds'])
        self.assertIsNotNone(self.flow.repository.get('agreement',agreement['id']))
        self.flow.actor='staff'
        self.assertEqual(200,call('/api/activities/'+row['id'],'PATCH',{'coHostPartnerIds':[]},version=2)[0]['statusCode'])
        self.assertIsNotNone(self.flow.repository.get('partner','partner-other'))

    def test_scoped_options_invalid_references_and_transaction_race(self):
        call=self.flow.call
        partner=self.flow.repository.client.rows['partner-other']
        partner.update(scopeId='other-scope',scopeEntity='other-scope#partner')
        # Test helper carries query parameters separately from rawPath, like API Gateway.
        original=self.flow.app.handle
        def scoped(event):
            event['queryStringParameters']={'scopeId':'cs-demo'}
            return original(event)
        self.flow.app.handle=scoped
        result,body=call('/api/partners');self.assertEqual(200,result['statusCode'],body)
        self.assertEqual(['partner-demo'],[r['id'] for r in body['data']]);self.assertEqual(1,body['count'])
        self.flow.app.handle=original
        payload=dict(title='Test',type='event',summary='test',scopeId='cs-demo',partnerId='partner-demo')
        self.assertEqual(422,call('/api/activities','POST',dict(payload,coHostPartnerIds=['partner-other']))[0]['statusCode'])
        self.assertEqual(422,call('/api/activities','POST',dict(payload,coHostPartnerIds=['partner-demo']))[0]['statusCode'])
        result,body=call('/api/activities','POST',payload,key='valid-activity-key-01');self.assertEqual(201,result['statusCode'],body)
        row=body['data']
        def change_reference():self.flow.repository.client.rows['partner-demo']['version']+=1
        self.flow.repository.client.before_commit=change_reference
        result,_=call('/api/activities/'+row['id'],'PATCH',{'partnerId':'partner-demo'},version=1)
        self.assertEqual(409,result['statusCode'])
