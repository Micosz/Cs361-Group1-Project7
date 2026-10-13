"""History API with the shared transaction adapter and explicit AWS doubles."""
import unittest
from backend.tests import test_workspace_storage as storage


class HistoryIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.flow=storage.WorkspaceStorageTests();self.flow.setUp()

    def test_write_read_order_update_and_deny(self):
        call=self.flow.call;base='/api/partners/partner-demo/history'
        for key,date in [('history-first-key-001','2026-10-01'),('history-second-key-02','2026-10-13')]:
            result,body=call(base,'POST',dict(occurredOn=date,kind='meeting',note='เหตุการณ์ภายใน'),key=key)
            self.assertEqual(201,result['statusCode'],body)
        result,body=call(base);self.assertEqual(['2026-10-13','2026-10-01'],[row['occurredOn'] for row in body['data']])
        row=body['data'][0]
        result,body=call(base+'/'+row['id'],'PATCH',{'note':'แก้ไขแล้ว'},version=1)
        self.assertEqual(200,result['statusCode'],body);self.assertEqual('แก้ไขแล้ว',body['data']['note'])
        self.assertEqual(422,call(base,'POST',dict(occurredOn='2026-02-30',kind='meeting',note='bad'),key='invalid-date-key-001')[0]['statusCode'])
        self.flow.actor='student-a';self.assertEqual(403,call(base)[0]['statusCode'])
        self.flow.actor='executive';self.assertEqual(403,call(base,'POST',dict(occurredOn='2026-10-13',kind='meeting',note='bad'))[0]['statusCode'])

    def test_reference_scope_and_parent_race(self):
        call=self.flow.call;base='/api/partners/partner-demo/history';agreement=self.flow.create_agreement()
        payload=dict(occurredOn='2026-10-13',kind='agreement',note='ลงนาม',referenceType='agreement',referenceId=agreement['id'])
        result,body=call(base,'POST',payload,key='history-reference-key-01');self.assertEqual(201,result['statusCode'],body)
        self.assertEqual(agreement['id'],body['data']['referenceId'])
        self.assertEqual(422,call(base,'POST',dict(payload,referenceId='missing'),key='history-missing-key-001')[0]['statusCode'])
        def change_parent():self.flow.repository.client.rows['partner-demo']['version']+=1
        self.flow.repository.client.before_commit=change_parent
        self.assertEqual(409,call(base,'POST',payload,key='history-race-key-0001')[0]['statusCode'])
