"""Feedback API tests through durable adapter + explicit local DynamoDB doubles."""
import json
import unittest

from backend.tests import test_workspace_storage as storage_tests
from backend.business.dynamo_repository import DynamoBusinessRepository


class FeedbackTests(unittest.TestCase):
    setUp = storage_tests.WorkspaceStorageTests.setUp
    call = storage_tests.WorkspaceStorageTests.call

    def parent(self, kind='exchange', assigned=True, key_suffix='', **extra):
        self.actor = 'staff'
        payload = dict(title='Feedback parent', scopeId='cs-demo',
                       responsibleUserIds=[self.ids['coordinator']] if assigned else [self.ids['staff']])
        if kind == 'activity':
            payload.update(type='event', summary='Demo', partnerId='partner-demo')
        else:
            payload['partnerIds'] = ['partner-demo']
        payload.update(extra)
        response, body = self.call('/api/' + ('activities' if kind == 'activity' else 'exchanges'),
                                   'POST', payload, key='parent-create-' + kind + str(assigned) + key_suffix)
        self.assertEqual(201, response['statusCode'], body)
        return body['data']

    def base(self, parent):
        return '/api/' + ('activities' if parent['entityType'] == 'activity' else 'exchanges') + '/' + parent['id'] + '/feedback'

    def create(self, base, **changes):
        data = dict(occurredOn='2026-10-18', sourceType='participant', comment='<b>Literal feedback</b>',
                    improvement='Improve timing', respondentName='Private test identity')
        data.update(changes)
        return self.call(base, 'POST', data)

    def test_both_parents_create_edit_restart_idempotency_and_private_projection(self):
        for kind in ('activity', 'exchange'):
            parent = self.parent(kind)
            base = self.base(parent)
            self.actor = 'coordinator'
            response, body = self.create(base)
            self.assertEqual(201, response['statusCode'], body)
            row = body['data']
            self.assertEqual('Private test identity', row['respondentName'])
            self.assertEqual(row['id'], self.create(base)[1]['data']['id'])
            response, body = self.call(base + '/' + row['id'], 'PATCH', {'comment': 'Updated'}, version=1)
            self.assertEqual(200, response['statusCode'], body)
            self.assertEqual(2, body['data']['version'])
            self.assertEqual(409, self.call(base + '/' + row['id'], 'PATCH', {'comment': 'Stale'}, version=1)[0]['statusCode'])
            self.app.repository = DynamoBusinessRepository(self.repository.client, 'business', self.app.sessions,
                'users', 'sessions', self.repository.documents)
            self.actor = 'executive'
            response, body = self.call(base)
            self.assertEqual(200, response['statusCode'], body)
            self.assertEqual('Updated', body['data'][0]['comment'])
            self.assertEqual('Private test identity', body['data'][0]['respondentName'])
            self.assertEqual('cs-demo', body['data'][0]['scopeId'])
            self.assertFalse(body['data'][0]['canEdit'])
            for field in ('createdBy', 'updatedBy'):
                self.assertNotIn(field, body['data'][0])
            self.assertEqual(404, self.call(base + '/' + row['id'], 'PATCH', {'comment': 'No'}, version=2)[0]['statusCode'])
            exec_created = self.call(base, 'POST', dict(occurredOn='2026-10-19', sourceType='partner', comment='Exec feedback'), key='exec-fb-create-' + kind)
            self.assertEqual(201, exec_created[0]['statusCode'], exec_created[1])

    def test_unassigned_coordinator_reads_but_cannot_write_and_non_participants_denied(self):
        parent = self.parent(assigned=False)
        base = self.base(parent)
        self.actor = 'coordinator'
        self.assertEqual(200, self.call(base)[0]['statusCode'])
        self.assertIn(self.create(base)[0]['statusCode'], (403, 404))
        for actor in ('student-a', 'student-b', 'employee'):
            self.actor = actor
            self.assertIn(self.call(base)[0]['statusCode'], (403, 404))
            self.assertIn(self.create(base)[0]['statusCode'], (403, 404))
        self.actor = 'staff'
        self.assertEqual(201, self.create(base)[0]['statusCode'])

    def test_parent_mismatch_cross_scope_and_wrong_parent_type(self):
        first = self.parent()
        base = self.base(first)
        response, body = self.create(base)
        row = body['data']
        other = self.parent(assigned=False)
        self.assertEqual(404, self.call(self.base(other) + '/' + row['id'])[0]['statusCode'])
        self.repository.client.rows[first['id']]['scopeId'] = 'other-scope'
        self.assertEqual(404, self.call(base)[0]['statusCode'])
        self.assertEqual(404, self.call('/api/partners/partner-demo/feedback')[0]['statusCode'])

    def test_validation_and_server_field_injection(self):
        base = self.base(self.parent())
        for changes in ({'comment': ''}, {'occurredOn': '2026-02-30'}, {'sourceType': 'bad'}, {'sourceType': []},
                        {'improvement': 'x' * 10001}, {'respondentName': []}):
            self.assertEqual(422, self.create(base, **changes)[0]['statusCode'], changes)
        self.assertEqual(403, self.create(base, scopeId='other')[0]['statusCode'])
        self.assertEqual(403, self.create(base, parentId='other')[0]['statusCode'])

    def test_parent_reassignment_race_is_atomic(self):
        parent = self.parent()
        base = self.base(parent)
        self.actor = 'coordinator'
        def reassign():
            self.repository.client.rows[parent['id']]['responsibleUserIds'] = []
            self.repository.client.rows[parent['id']]['version'] += 1
        self.repository.client.before_commit = reassign
        self.assertEqual(409, self.create(base)[0]['statusCode'])
        self.assertFalse(any(row.get('entityType') == 'feedback' for row in self.repository.client.rows.values()))
        self.assertEqual(404, self.create(base)[0]['statusCode'])

    def test_staff_can_edit_only_feedback_they_created_and_inbox_is_scoped(self):
        parent = self.parent()
        base = self.base(parent)
        own_response, own_body = self.create(base, comment='Staff own feedback')
        self.assertEqual(201, own_response['statusCode'], own_body)
        own = own_body['data']
        self.actor = 'coordinator'
        other_response, other_body = self.create(base, comment='Coordinator feedback')
        self.assertEqual(201, other_response['statusCode'], other_body)
        other = other_body['data']

        self.actor = 'staff'
        self.assertEqual(200, self.call(base + '/' + own['id'], 'PATCH', {'comment':'Staff edited'}, version=1)[0]['statusCode'])
        self.assertIn(self.call(base + '/' + other['id'], 'PATCH', {'comment':'Staff must not edit'}, version=1)[0]['statusCode'], (403, 404))
        response, body = self.call('/api/feedback?limit=100')
        self.assertEqual(200, response['statusCode'], body)
        indexed = {row['id']:row for row in body['data']}
        self.assertEqual('Feedback parent', indexed[own['id']]['parentTitle'])
        self.assertTrue(indexed[own['id']]['canEdit'])
        self.assertFalse(indexed[other['id']]['canEdit'])
        self.assertNotIn('respondentName', indexed[own['id']])

        self.actor = 'executive'
        response, body = self.call('/api/feedback?parentType=exchange&limit=100')
        self.assertEqual(200, response['statusCode'], body)
        self.assertEqual({own['id'], other['id']}, {row['id'] for row in body['data']})
        self.assertTrue(all(row['canEdit'] is False and 'respondentName' not in row for row in body['data']))
        self.assertIn(self.call(base + '/' + own['id'], 'PATCH', {'comment': 'Exec must not edit others'}, version=2)[0]['statusCode'], (403, 404))
        exec_fb_res, exec_fb_body = self.create(base, comment='Exec own feedback', respondentName='Exec internal')
        self.assertEqual(201, exec_fb_res['statusCode'], exec_fb_body)
        exec_own = exec_fb_body['data']
        self.assertTrue(exec_own['canEdit'])
        self.assertEqual('Exec internal', exec_own['respondentName'])
        self.assertEqual(200, self.call(base + '/' + exec_own['id'], 'PATCH', {'comment': 'Exec edited own'}, version=1)[0]['statusCode'])
        inbox_after = {row['id']: row for row in self.call('/api/feedback?parentType=exchange&limit=100')[1]['data']}
        self.assertTrue(inbox_after[exec_own['id']]['canEdit'])
        self.assertNotIn('respondentName', inbox_after[exec_own['id']])
        self.assertEqual(422, self.call('/api/feedback?parentType=partner')[0]['statusCode'])

        self.actor = 'coordinator'
        self.assertIn(self.call('/api/feedback')[0]['statusCode'], (403, 404))
        self.actor = 'student-a'
        self.assertIn(self.call('/api/feedback')[0]['statusCode'], (403, 404))

    def test_student_feedback_on_participating_exchange_and_public_activity(self):
        exchange = self.parent('exchange', key_suffix='-stu-ex',
                               participantUserIds=[self.ids['student-a'], self.ids['student-b']])
        ex_base = self.base(exchange)
        staff_row = self.create(ex_base, comment='Staff note', respondentName='Staff private')[1]['data']

        self.actor = 'student-a'
        list_res, list_body = self.call(ex_base)
        self.assertEqual(200, list_res['statusCode'], list_body)
        self.assertTrue(list_body['canCreate'])
        self.assertFalse(list_body['data'][0]['canEdit'])
        for field in ('respondentName', 'createdBy', 'updatedBy', 'scopeId'):
            self.assertNotIn(field, list_body['data'][0])

        create_res, create_body = self.create(ex_base, comment='Student A feedback',
                                              respondentName='Student optional internal')
        self.assertEqual(201, create_res['statusCode'], create_body)
        own = create_body['data']
        self.assertTrue(own['canEdit'])
        self.assertNotIn('respondentName', own)

        patch_res, patch_body = self.call(ex_base + '/' + own['id'], 'PATCH',
                                          {'comment': 'Student A updated'}, version=1)
        self.assertEqual(200, patch_res['statusCode'], patch_body)
        self.assertEqual('Student A updated', patch_body['data']['comment'])
        self.assertEqual('Student optional internal', self.repository.client.rows[own['id']]['respondentName'])
        self.assertEqual(404, self.call(ex_base + '/' + staff_row['id'], 'PATCH',
                                        {'comment': 'Not mine'}, version=1)[0]['statusCode'])

        self.actor = 'student-b'
        other_list_res, other_list = self.call(ex_base)
        self.assertEqual(200, other_list_res['statusCode'], other_list)
        by_id = {row['id']: row for row in other_list['data']}
        self.assertFalse(by_id[own['id']]['canEdit'])
        self.assertEqual(404, self.call(ex_base + '/' + own['id'], 'PATCH',
                                        {'comment': 'Student B hijack'}, version=2)[0]['statusCode'])

        internal_activity = self.parent('activity', key_suffix='-act-int', publication='internal')
        self.actor = 'student-a'
        self.assertEqual(404, self.call('/api/activities/' + internal_activity['id'])[0]['statusCode'])
        self.assertEqual(404, self.call(self.base(internal_activity))[0]['statusCode'])
        self.assertEqual(404, self.create(self.base(internal_activity))[0]['statusCode'])

        public_activity = self.parent('activity', key_suffix='-act-pub',
                                      publication='public', outcomeSummary='Internal outcome')
        act_base = self.base(public_activity)
        self.actor = 'student-a'
        act_res, act_body = self.call('/api/activities/' + public_activity['id'])
        self.assertEqual(200, act_res['statusCode'], act_body)
        for field in ('outcomeSummary', 'scopeId', 'responsibleUserIds'):
            self.assertNotIn(field, act_body['data'])
        act_fb_res, act_fb_body = self.create(act_base, comment='Public activity student feedback')
        self.assertEqual(201, act_fb_res['statusCode'], act_fb_body)
        self.assertTrue(act_fb_body['data']['canEdit'])
        self.assertEqual(200, self.call(act_base + '/' + act_fb_body['data']['id'], 'PATCH',
                                        {'comment': 'Public activity student edited'}, version=1)[0]['statusCode'])
        self.actor = 'executive'
        exec_list = self.call(act_base)[1]
        self.assertTrue(exec_list['canCreate'])

    def test_anonymous_and_wrong_methods_denied(self):
        base = self.base(self.parent())
        event = dict(version='2.0', rawPath=base, requestContext={'http': {'method': 'GET'}})
        self.assertEqual(401, self.app.handle(event)['statusCode'])
        self.assertEqual(405, self.call(base, 'DELETE')[0]['statusCode'])
