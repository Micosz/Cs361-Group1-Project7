"""Feedback API tests through durable adapter + explicit local DynamoDB doubles."""
import json
import unittest

from backend.tests import test_workspace_storage as storage_tests
from backend.business.dynamo_repository import DynamoBusinessRepository


class FeedbackTests(unittest.TestCase):
    setUp = storage_tests.WorkspaceStorageTests.setUp
    call = storage_tests.WorkspaceStorageTests.call

    def parent(self, kind='exchange', assigned=True):
        self.actor = 'staff'
        payload = dict(title='Feedback parent', scopeId='cs-demo',
                       responsibleUserIds=[self.ids['coordinator']] if assigned else [self.ids['staff']])
        if kind == 'activity':
            payload.update(type='event', summary='Demo', partnerId='partner-demo')
        else:
            payload['partnerIds'] = ['partner-demo']
        response, body = self.call('/api/' + ('activities' if kind == 'activity' else 'exchanges'),
                                   'POST', payload, key='parent-create-' + kind + str(assigned))
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
            for field in ('respondentName', 'createdBy', 'updatedBy', 'scopeId'):
                self.assertNotIn(field, body['data'][0])
            self.assertNotIn('Private test identity', json.dumps(body))
            self.assertEqual(403, self.create(base)[0]['statusCode'])
            self.assertEqual(403, self.call(base + '/' + row['id'], 'PATCH', {'comment': 'No'}, version=2)[0]['statusCode'])

    def test_unassigned_coordinator_and_students_denied_even_for_exchange_participants(self):
        parent = self.parent(assigned=False)
        base = self.base(parent)
        for actor in ('coordinator', 'student-a', 'student-b', 'employee'):
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
        self.actor = 'coordinator'
        self.assertIn(self.call(base + '/' + own['id'], 'PATCH', {'comment':'Coordinator must not edit others'}, version=2)[0]['statusCode'], (403, 404))
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
        self.assertEqual(422, self.call('/api/feedback?parentType=partner')[0]['statusCode'])

        self.actor = 'coordinator'
        self.assertIn(self.call('/api/feedback')[0]['statusCode'], (403, 404))

    def test_anonymous_and_wrong_methods_denied(self):
        base = self.base(self.parent())
        event = dict(version='2.0', rawPath=base, requestContext={'http': {'method': 'GET'}})
        self.assertEqual(401, self.app.handle(event)['statusCode'])
        self.assertEqual(405, self.call(base, 'DELETE')[0]['statusCode'])
