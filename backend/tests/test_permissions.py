import copy
from dataclasses import replace
import json
import unittest

from backend.auth.session_service import AuthError, SessionContext, UserState
from backend.permissions.policy import (require_record, validate_fields,
                                       require_assignee, require_reference,
                                       require_role_management)
from backend.permissions.projections import project, public_projection
from backend.permissions.gateway import PermissionGateway, public_records, WriteConditions
from backend.permissions.transactions import transaction_checks, target_condition
from backend.http_api import handle
from backend.tests import test_sessions as session_helpers
from backend.auth.session_service import token_hash


def context(role='staff', scope='c1', user='u1', extra=()):
    gs = ({'role': role, 'scopeId': scope, 'active': True},) if role else ()
    return SessionContext(UserState(user, True, 1, True, grants=gs + extra), 2000)


def row(kind='exchange', key='e1', scope='c1', **fields):
    return dict(id=key, entityType=kind, scopeId=scope, version=1,
                responsibleUserIds=['u1'], participantUserIds=['u1'],
                title='Demo', publication='internal', **fields)


class PolicyTests(unittest.TestCase):
    def deny(self, status, fn):
        with self.assertRaises(AuthError) as caught:
            fn()
        self.assertEqual(status, caught.exception.status)

    def test_all_business_resources_role_action_matrix(self):
        for kind in ('partner', 'activity', 'agreement', 'exchange'):
            for role in ('staff', 'coordinator', 'executive', 'student', None):
                for action in ('read', 'update', 'status', 'delete'):
                    with self.subTest(kind=kind, role=role, action=action):
                        allowed = (action == 'read' and (role in {'staff', 'coordinator', 'executive'}
                                   or role == 'student' and kind == 'exchange')
                                   or action == 'update' and role in {'staff', 'coordinator'}
                                   or action == 'status' and kind in {'agreement', 'exchange'}
                                   and role in {'staff', 'coordinator'})
                        if allowed:
                            require_record(context(role), kind, action, row(kind))
                        else:
                            self.deny(403, lambda: require_record(context(role), kind, action, row(kind)))

    def test_same_role_cannot_cross_scope_or_guess_missing_record(self):
        for role in ('staff', 'coordinator', 'executive', 'student'):
            for record in (row(scope='c2'), None):
                self.deny(404, lambda: require_record(context(role), 'exchange', 'read', record))

    def test_cross_user_and_created_by_do_not_grant_access(self):
        r = row(createdBy='u2')
        for role in ('student', 'coordinator'):
            self.deny(404, lambda: require_record(context(role, user='u2'), 'exchange', 'read', r))

    def test_roles_do_not_borrow_scope(self):
        c = context('executive', extra=({'role': 'staff', 'scopeId': 'c2', 'active': True},))
        self.deny(404, lambda: require_record(c, 'exchange', 'update', row()))
        self.deny(404, lambda: validate_fields(c, 'partner', 'create', {'scopeId': 'c1'}))

    def test_legacy_owner_missing_is_not_global_access(self):
        r = row()
        del r['responsibleUserIds']
        del r['participantUserIds']
        for role in ('coordinator', 'student'):
            self.deny(404, lambda: require_record(context(role), 'exchange', 'read', r))
        require_record(context(), 'exchange', 'update', r)
        del r['scopeId']
        self.deny(404, lambda: require_record(context(), 'exchange', 'read', r))

    def test_malformed_assignment_cannot_use_substring_match(self):
        r = row()
        r['responsibleUserIds'] = 'u100'
        self.deny(404, lambda: require_record(context('coordinator'), 'exchange', 'update', r))

    def test_no_role_unverified_inactive_grants_fail_closed(self):
        for c in (context(None), replace(context(), user=replace(context().user, identity_verified=False)),
                  context('staff', extra=({'role': 'staff', 'scopeId': 'c2', 'active': False},))):
            r = row(scope='c2')
            self.deny(403 if not c.user.permissions()[0] else 404,
                      lambda: require_record(c, 'exchange', 'read', r))

    def test_mass_assignment_unknown_and_server_fields(self):
        for field in ('scopeId', 'createdBy', 'id', 'version', 'role', 'grants', 'status', 'authzVersion'):
            self.deny(403, lambda: validate_fields(context(), 'exchange', 'update', {field: 'x'}, row()))
        self.deny(422, lambda: validate_fields(context(), 'exchange', 'update', {'typo': 'x'}, row()))

    def test_coordinator_cannot_change_responsibility_or_publication(self):
        for field in ('responsibleUserIds', 'publication'):
            self.deny(403, lambda: validate_fields(context('coordinator'), 'partner', 'update', {field: []}, row('partner')))
        r = row('partner')
        r['publication'] = 'public'
        self.deny(403, lambda: validate_fields(context('coordinator'), 'partner', 'update', {'name': 'changed'}, r))
        validate_fields(context(), 'partner', 'update', {'name': 'changed'}, r)

    def test_coordinator_creation_assigns_self_and_draft(self):
        for kind in ('activity', 'agreement', 'exchange'):
            result = validate_fields(context('coordinator'), kind, 'create', {'scopeId': 'c1', 'title': 'new'})
            self.assertEqual(['u1'], result['responsibleUserIds'])
            if kind != 'activity':
                self.assertEqual('draft', result['status'])
        self.deny(403, lambda: validate_fields(context('coordinator'), 'partner', 'create', {'scopeId': 'c1'}))

    def test_children_require_matching_parent_scope_and_link(self):
        p = row('partner', 'p1')
        for kind in ('contact', 'history'):
            child = row(kind, 'h1', partnerId='p1')
            require_record(context('coordinator'), kind, 'create', child, p)
            for change in ({'partnerId': 'p2'}, {'scopeId': 'c2'}, {'entityType': 'exchange'}):
                self.deny(404, lambda: require_record(context(), kind, 'read', dict(child, **change), p))
        self.deny(403, lambda: require_record(context('executive'), 'contact', 'read', row('contact', partnerId='p1'), p))

    def test_document_audience_matrix_and_object_key_not_returned(self):
        for parent_kind in ('agreement', 'exchange'):
            p = row(parent_kind)
            for audience, personal in (('internal', False), ('participants', False), ('participants', True)):
                d = row('document', 'd1', parentId='e1', parentType=parent_kind,
                        audience=audience, containsPersonal=personal, objectKey='SECRET', hash='SECRET')
                valid = parent_kind == 'exchange' or audience == 'internal'
                for role in ('staff', 'coordinator', 'student', 'executive'):
                    allowed = valid and (role in {'staff', 'coordinator'}
                              or role == 'student' and audience == 'participants'
                              or role == 'executive' and audience == 'internal' and not personal)
                    if allowed:
                        self.assertNotIn('SECRET', json.dumps(project(context(role), 'document', d, p)))
                    else:
                        self.deny(404, lambda: project(context(role), 'document', d, p))
        d['audience'], d['containsPersonal'] = 'internal', True
        self.deny(404, lambda: project(context(), 'document', d, p))

    def test_student_and_executive_projection_no_personal_or_embedded_data(self):
        r = row(supportingInfo='PRIVATE', supportingInfoForParticipant='for student',
                objectKey='PRIVATE', documents=[{'secret': 'PRIVATE'}],
                partners=[{'email': 'PRIVATE'}], internalNote='PRIVATE')
        r['participantUserIds'].append('u2')
        for role in ('student', 'executive'):
            data = project(context(role), 'exchange', r)
            self.assertNotIn('PRIVATE', json.dumps(data))
            self.assertNotIn('participantUserIds', data)
        self.assertIn('supportingInfoForParticipant', project(context('student'), 'exchange', r))
        r['title'] = {'password': 'PRIVATE'}
        self.assertNotIn('title', project(context(), 'exchange', r))

    def test_references_and_target_users_must_be_verified_in_same_scope(self):
        require_reference(context(), row('partner'), 'c1')
        for r in (None, row('partner', scope='c2')):
            self.deny(422, lambda: require_reference(context(), r, 'c1'))
        require_assignee(context('student').user, 'c1', participant=True)
        for u in (None, context('executive').user, context('staff', scope='c2').user,
                  replace(context().user, identity_verified=False)):
            self.deny(422, lambda: require_assignee(u, 'c1'))

    def test_role_manager_has_no_business_permission_and_cannot_self_promote(self):
        c = replace(context(None), user=replace(context(None).user, capabilities=(
            {'name': 'manageRoles', 'scopeId': 'c1', 'active': True},)))
        require_role_management(c, 'c1', 'u2')
        self.deny(403, lambda: require_role_management(c, 'c1', 'u1'))
        self.deny(403, lambda: require_role_management(c, 'c2', 'u2'))
        self.deny(403, lambda: require_record(c, 'exchange', 'read', row()))

    def test_public_projection_and_count_exclude_internal_or_orphan_relations(self):
        p = row('partner', 'p1', name='Visible', contacts=[{'email': 'PRIVATE'}])
        p['publication'] = 'public'
        internal = dict(p, id='p2', name='Hidden', publication='internal')
        activity = row('activity', 'a1', partnerId='p1', coHostPartnerIds=['p1', 'p2'])
        activity['publication'] = 'public'
        data = public_projection('activity', activity, {'p1': p, 'p2': internal})
        self.assertEqual(['Visible'], data['co_hosts'])
        self.assertNotIn('Hidden', json.dumps(data))
        self.assertIsNone(public_projection('activity', dict(activity, partnerId='p2'), {'p2': internal}))
        result = public_records('partner', [p, internal], predicate=lambda d: d.get('name') == 'Visible')
        self.assertEqual(1, result['count'])
        self.assertNotIn('PRIVATE', json.dumps(result))
        self.assertIsNone(public_projection('partner', dict(p, access_level='internal')))
        self.assertIsNotNone(public_projection('partner', {'id': 'legacy', 'access_level': 'public'}))


class Repository:
    """Test-only adapter; no production persistence or real users."""
    def __init__(self, service, rows):
        self.service = service
        self.rows = {(r['entityType'], r['id']): copy.deepcopy(r) for r in rows}
        self.writes = 0
        self.streams = 0
        self.before_write = None

    def get(self, kind, key):
        return copy.deepcopy(self.rows.get((kind, key)))

    def list(self, kind, context, parent):
        return [copy.deepcopy(r) for (k, _), r in self.rows.items() if k == kind]

    def mutate(self, kind, action, payload, record, parent, conditions, idempotency, upload=None):
        if self.before_write:
            self.before_write()
        # Simulate one atomic transaction, including races after HTTP auth.
        user = self.service.users.user
        session = self.service.store.get(conditions.session_hash)
        if not user or user.authz_version != conditions.authz_version or not session:
            raise AuthError('SESSION_REVOKED')
        for previous in (record, parent):
            if previous and self.get(previous['entityType'], previous['id'])['version'] != previous['version']:
                raise AuthError('VERSION_CONFLICT', 409)
        self.writes += 1
        saved = dict(record or row(kind, 'new', scope=conditions.scope_id), **payload)
        if parent:
            saved['scopeId'] = parent['scopeId']
            if kind == 'document':
                saved.update(parentType=parent['entityType'], parentId=parent['id'], uploadState='pending')
            else:
                saved['partnerId'] = parent['id']
        saved['version'] += 1
        self.rows[(kind, saved['id'])] = saved
        return copy.deepcopy(saved)

    def parse_upload(self, event):
        return json.loads(event['body']), b'test-file'

    def content(self, document, disposition):
        self.streams += 1
        return {'statusCode': 200, 'headers': {'content-type': 'application/pdf'}, 'body': 'test-bytes'}


# Reuse setup helpers without inheriting/re-running the #78 test methods.
class GatewayTests(unittest.TestCase):
    setUp = session_helpers.SessionTests.setUp
    login = session_helpers.SessionTests.login

    def setUp(self):
        session_helpers.SessionTests.setUp(self)
        self.users.user = context().user
        self.issued = self.login()
        self.repo = Repository(self.service, [row(), row(key='e2', scope='c2')])

    def event(self, path='/api/exchanges/e1', method='GET', payload=None, **hs):
        return {'version': '2.0', 'rawPath': path,
                'requestContext': {'http': {'method': method}, 'requestId': 'test-request'},
                'headers': {'origin': self.policy.origin, 'x-csrf-token': self.issued.csrf_token,
                            'if-match': '"1"', 'idempotency-key': 'test-key-123456789', **hs},
                'cookies': [self.issued.cookie], 'body': json.dumps(payload or {})}

    def call(self, event):
        return handle(event, self.service, self.repo)

    def assert_status(self, status, event):
        result = self.call(event)
        self.assertEqual(status, result['statusCode'], result)
        self.assertEqual('no-store', result['headers']['cache-control'])
        return json.loads(result['body'])

    def test_authenticated_http_read_and_write(self):
        self.assert_status(200, self.event())
        self.assert_status(200, self.event(method='PATCH', payload={'title': 'updated'}))
        self.assertEqual('updated', self.repo.get('exchange', 'e1')['title'])
        self.assertEqual(1, self.repo.writes)

    def test_cross_scope_id_and_role_injection_cannot_mutate(self):
        self.assert_status(404, self.event('/api/exchanges/e2', 'PATCH', {'title': 'bad'}))
        self.assert_status(403, self.event(method='PATCH', payload={'role': 'staff'}))
        self.assertEqual(0, self.repo.writes)

    def test_count_excludes_unauthorized_rows(self):
        result = self.assert_status(200, self.event('/api/exchanges'))
        self.assertEqual(1, result['count'])
        self.assertEqual(['e1'], [r['id'] for r in result['data']])

    def test_no_role_missing_anonymous_tampered_expired_revoked(self):
        event = self.event()
        event['cookies'] = []
        self.assert_status(401, event)
        event['cookies'] = ['__Host-cstuhub=broken']
        self.assert_status(401, event)
        event['cookies'] = [self.service.create_anonymous().cookie]
        self.assert_status(401, event)
        self.users.user = context(None).user
        self.assert_status(403, self.event())
        self.users.user = replace(context().user, authz_version=2)
        self.assert_status(401, self.event())
        self.issued = self.login()
        self.now += 80
        self.assert_status(401, self.event())

    def test_csrf_origin_if_match_and_idempotency_before_side_effect(self):
        self.assert_status(403, self.event(method='PATCH', payload={'title': 'bad'}, **{'x-csrf-token': ''}))
        self.assert_status(403, self.event(method='PATCH', payload={'title': 'bad'}, origin='https://evil.test'))
        e = self.event(method='PATCH', payload={'title': 'bad'})
        del e['headers']['if-match']
        self.assert_status(428, e)
        self.assert_status(409, self.event(method='PATCH', payload={'title': 'bad'}, **{'if-match': '"2"'}))
        self.assert_status(422, self.event('/api/exchanges', 'POST', {'scopeId': 'c1'}, **{'idempotency-key': ''}))
        self.assertEqual(0, self.repo.writes)

    def test_role_withdrawal_logout_and_assignment_races_deny_commit(self):
        for race, expected in (
            (lambda: setattr(self.users, 'user', replace(self.users.user, authz_version=2)), 401),
            (lambda: self.service.store.delete(token_hash(self.issued.token)), 401),
            (lambda: self.repo.rows[('exchange', 'e1')].update(version=2, responsibleUserIds=['u2']), 409),
        ):
            self.setUp()
            self.repo.before_write = race
            self.assert_status(expected, self.event(method='PATCH', payload={'title': 'bad'}))
            self.assertEqual(0, self.repo.writes)

    def test_document_ready_parent_audience_and_private_stream(self):
        d = row('document', 'd1', parentType='exchange', parentId='e1', audience='participants',
                containsPersonal=True, uploadState='ready', objectKey='SECRET')
        self.repo.rows[('document', 'd1')] = d
        self.users.user = context('student').user
        result = self.call(self.event('/api/documents/d1/content'))
        self.assertEqual(200, result['statusCode'])
        self.assertEqual('no-store', result['headers']['cache-control'])
        self.repo.rows[('document', 'd1')]['uploadState'] = 'pending'
        self.assert_status(404, self.event('/api/documents/d1/content'))
        self.users.user = context('executive').user
        self.assert_status(404, self.event('/api/documents/d1'))
        self.assertEqual(1, self.repo.streams)

    def test_my_exchange_and_nested_parent_id_tamper(self):
        self.users.user = context('student').user
        self.assert_status(200, self.event('/api/me/exchanges/e1'))
        self.assert_status(404, self.event('/api/me/exchanges/e2'))
        self.assert_status(405, self.event('/api/me/exchanges/e1', 'PATCH', {'title': 'bad'}))
        self.users.user = context().user
        self.repo.rows[('partner', 'p1')] = row('partner', 'p1')
        self.repo.rows[('contact', 'c')] = row('contact', 'c', partnerId='other')
        self.assert_status(404, self.event('/api/partners/p1/contacts/c'))

    def test_unknown_routes_methods_query_duplicate_body_and_dependency_fail_closed(self):
        self.assert_status(404, self.event('/api/unknown'))
        self.assert_status(405, self.event(method='DELETE'))
        e = self.event('/api/exchanges')
        e['queryStringParameters'] = {'userId': 'u2'}
        self.assert_status(422, e)
        e = self.event(method='PATCH')
        e['body'] = '{"title":"a","title":"b"}'
        self.assert_status(400, e)
        result = handle(self.event(), self.service)
        self.assertEqual(503, result['statusCode'])
        def unavailable(*args):
            raise RuntimeError('SECRET')
        self.repo.get = unavailable
        result = self.call(self.event())
        self.assertEqual(503, result['statusCode'])
        self.assertNotIn('SECRET', result['body'])

    def test_direct_routes_for_all_business_create_update_and_status(self):
        for collection, kind in (('partners', 'partner'), ('activities', 'activity'),
                                 ('agreements', 'agreement'), ('exchanges', 'exchange')):
            self.repo.rows[(kind, 'r1')] = row(kind, 'r1')
            self.assert_status(200, self.event('/api/' + collection + '/r1'))
            payload = {'name': 'new'} if kind == 'partner' else {'title': 'new'}
            self.assert_status(201, self.event('/api/' + collection, 'POST', dict(payload, scopeId='c1')))
            self.assert_status(200, self.event('/api/' + collection + '/r1', 'PATCH', payload))
            self.users.user = context('executive').user
            self.assert_status(403, self.event('/api/' + collection, 'POST', dict(payload, scopeId='c1')))
            self.users.user = context().user
        self.assert_status(200, self.event('/api/exchanges/r1/status', 'POST', {'to': 'ongoing'}, **{'if-match': '"2"'}))

    def test_nested_creates_and_upload_guard(self):
        self.repo.rows[('partner', 'p1')] = row('partner', 'p1')
        self.assert_status(201, self.event('/api/partners/p1/contacts', 'POST', {'name': 'demo'}))
        self.assert_status(201, self.event('/api/partners/p1/history', 'POST', {'note': 'demo'}))
        payload = {'displayName': 'demo.pdf', 'audience': 'participants', 'containsPersonal': True}
        self.assert_status(201, self.event('/api/exchanges/e1/documents', 'POST', payload))
        self.users.user = context('student').user
        before = self.repo.writes
        self.assert_status(403, self.event('/api/exchanges/e1/documents', 'POST', payload))
        self.assertEqual(before, self.repo.writes)

    def test_my_exchange_mixed_roles_still_uses_participant_projection(self):
        self.users.user = context('student', extra=({'role': 'staff', 'scopeId': 'c1', 'active': True},)).user
        self.repo.rows[('exchange', 'e1')]['supportingInfo'] = 'PRIVATE'
        result = self.assert_status(200, self.event('/api/me/exchanges/e1'))
        self.assertNotIn('PRIVATE', json.dumps(result))
        self.repo.rows[('exchange', 'e1')]['participantUserIds'] = ['u2']
        self.assert_status(404, self.event('/api/me/exchanges/e1'))

    def test_search_and_cursor_bound_to_authorized_projection_and_session(self):
        self.repo.rows[('exchange', 'e3')] = row(key='e3')
        e = self.event('/api/exchanges')
        e['queryStringParameters'] = {'limit': '1', 'q': 'Demo'}
        first = self.assert_status(200, e)
        self.assertEqual(2, first['count'])
        self.assertEqual(1, len(first['data']))
        cursor = first['page']['nextCursor']
        self.assertIsNotNone(cursor)
        e['queryStringParameters']['cursor'] = cursor
        second = self.assert_status(200, e)
        self.assertNotEqual(first['data'][0]['id'], second['data'][0]['id'])
        self.assertIsNone(second['page']['nextCursor'])
        e['queryStringParameters']['q'] = 'Hidden'
        self.assert_status(422, e)
        e['queryStringParameters']['q'] = 'Demo'
        self.issued = self.login()
        e['cookies'] = [self.issued.cookie]
        self.assert_status(422, e)
        e['queryStringParameters'] = {'q': 'PRIVATE'}
        self.repo.rows[('exchange', 'e1')]['internalNote'] = 'PRIVATE'
        self.assertEqual(0, self.assert_status(200, e)['count'])

    def test_dynamo_transaction_checks_include_auth_session_parent_and_target(self):
        c = WriteConditions('u1', 7, 'hash', 'e1', 2, 'p1', 3, 'c1')
        checks = transaction_checks(c, user_table='Users', session_table='Sessions', business_table='Records', now=1000)
        self.assertEqual(3, len(checks))
        self.assertEqual({'N': '7'}, checks[0]['ConditionCheck']['ExpressionAttributeValues'][':v'])
        self.assertIn('attribute_not_exists', checks[1]['ConditionCheck']['ConditionExpression'])
        self.assertEqual({'N': '3'}, checks[2]['ConditionCheck']['ExpressionAttributeValues'][':v'])
        self.assertEqual({'N': '2'}, target_condition(c)['ExpressionAttributeValues'][':v'])
