"""#263: partner -> agreements -> activities/Exchanges read paths.

Dataset mirrors docs/evidence/v7-expected-results.md: one partner (P1) with two
agreements. MOU1 has activities A1-A3; MOA2 has Exchange X1. A second scope holds
look-alike rows that must never appear.
"""

import json
import unittest

from backend.auth.session_service import SessionContext, UserState
from backend.http_api import handle
from backend.agreements.repository import AgreementRepository
import test_sessions as session_helpers


def user(role, scope='c1', uid='u1'):
    grants = ({'role': role, 'scopeId': scope, 'active': True},) if role else ()
    return SessionContext(UserState(uid, True, 1, True, grants=grants), 2000).user


class AgreementLinkTests(unittest.TestCase):
    def setUp(self):
        session_helpers.SessionTests.setUp(self)
        self.known = {}
        original = self.users.get
        self.users.get = lambda key: (self.users.user if self.users.user and key == self.users.user.user_id
                                      else self.known.get(key) or original(key))
        self.repo = AgreementRepository(self.service, user_store=self.known)
        rows = [
            {'entityType': 'partner', 'id': 'P1', 'name': '[ทดสอบ V7] Partner', 'type': 'university',
             'responsibleUserIds': ['u1']},
            {'entityType': 'agreement', 'id': 'MOU1', 'title': '[ทดสอบ V7] MoU 1', 'agreementType': 'MoU',
             'status': 'active', 'startDate': '2026-10-01', 'endDate': '2027-09-30',
             'partnerIds': ['P1'], 'responsibleUserIds': ['coord']},
            {'entityType': 'agreement', 'id': 'MOA2', 'title': '[ทดสอบ V7] MoA 2', 'agreementType': 'MoA',
             'status': 'active', 'startDate': '2026-10-01', 'endDate': '2027-09-30',
             'partnerIds': ['P1'], 'responsibleUserIds': ['u1']},
            {'entityType': 'agreement', 'id': 'OTHER', 'title': 'Other partner MoU', 'agreementType': 'MoU',
             'status': 'active', 'partnerIds': ['P9'], 'responsibleUserIds': ['u1']},
            {'entityType': 'partner', 'id': 'P9', 'name': 'Other partner', 'type': 'company',
             'responsibleUserIds': ['u1']},
            {'entityType': 'activity', 'id': 'A1', 'title': 'A1', 'type': 'academic_activity',
             'partnerId': 'P1', 'periodDate': '2026-12-10', 'agreementIds': ['MOU1'],
             'responsibleUserIds': ['coord']},
            {'entityType': 'activity', 'id': 'A2', 'title': 'A2', 'type': 'event',
             'partnerId': 'P1', 'periodDate': '2027-02-15', 'agreementIds': ['MOU1'],
             'responsibleUserIds': ['u1']},
            {'entityType': 'activity', 'id': 'A3', 'title': 'A3', 'type': 'event',
             'partnerId': 'P1', 'periodDate': '2026-06-20', 'agreementIds': ['MOU1'],
             'responsibleUserIds': ['u1']},
            {'entityType': 'activity', 'id': 'A-free', 'title': 'No agreement', 'type': 'event',
             'partnerId': 'P1', 'periodDate': '2026-12-01', 'responsibleUserIds': ['u1']},
            {'entityType': 'exchange', 'id': 'X1', 'title': 'X1', 'status': 'ongoing',
             'startDate': '2027-01-05', 'endDate': '2027-03-20', 'partnerIds': ['P1'],
             'agreementId': 'MOA2', 'participantUserIds': ['s1', 's2'], 'responsibleUserIds': ['u1']},
        ]
        for row in rows:
            row.update(scopeId='c1', version=1, publication='internal')
            self.repo.rows[(row['entityType'], row['id'])] = row
        # Same IDs referenced from another scope must not leak through the filter.
        self.repo.rows[('activity', 'A-c2')] = {
            'entityType': 'activity', 'id': 'A-c2', 'title': 'Other scope', 'type': 'event',
            'partnerId': 'P1', 'periodDate': '2026-12-10', 'agreementIds': ['MOU1'],
            'scopeId': 'c2', 'version': 1, 'publication': 'internal', 'responsibleUserIds': ['u1']}
        self.repo.rows[('exchange', 'X-c2')] = {
            'entityType': 'exchange', 'id': 'X-c2', 'title': 'Other scope X', 'status': 'ongoing',
            'partnerIds': ['P1'], 'agreementId': 'MOU1', 'scopeId': 'c2', 'version': 1,
            'responsibleUserIds': ['u1']}
        self.login(user('staff'))

    def login(self, account):
        self.users.user = account
        self.known[account.user_id] = account
        self.issued = self.service._issue(account)

    def get(self, path, **query):
        event = {'version': '2.0', 'rawPath': path,
                 'requestContext': {'http': {'method': 'GET'}, 'requestId': 'req-links'},
                 'headers': {'origin': self.policy.origin}, 'cookies': [self.issued.cookie]}
        if query:
            event['queryStringParameters'] = query
        result = handle(event, self.service, self.repo)
        return result['statusCode'], json.loads(result['body'])

    def ids(self, path, **query):
        status, body = self.get(path, **query)
        self.assertEqual(200, status, body)
        return sorted(row['id'] for row in body['data'])

    def test_partner_lists_only_its_own_agreements_with_status_and_period(self):
        status, body = self.get('/api/agreements', partnerId='P1')
        self.assertEqual(200, status)
        self.assertEqual(['MOA2', 'MOU1'], sorted(row['id'] for row in body['data']))
        mou = next(row for row in body['data'] if row['id'] == 'MOU1')
        self.assertEqual(('active', '2026-10-01', '2027-09-30', ['coord']),
                         (mou['status'], mou['startDate'], mou['endDate'], mou['responsibleUserIds']))
        self.assertEqual(['OTHER'], self.ids('/api/agreements', partnerId='P9'))

    def test_each_agreement_shows_only_its_own_work(self):
        self.assertEqual(['A1', 'A2', 'A3'], self.ids('/api/activities', agreementId='MOU1'))
        self.assertEqual([], self.ids('/api/exchanges', agreementId='MOU1'))
        self.assertEqual([], self.ids('/api/activities', agreementId='MOA2'))
        self.assertEqual(['X1'], self.ids('/api/exchanges', agreementId='MOA2'))

    def test_relationship_filter_combines_with_period(self):
        self.assertEqual(['A1', 'A2'], self.ids('/api/activities', agreementId='MOU1',
                                                startDate='2026-11-01', endDate='2027-03-31'))

    def test_other_scope_rows_never_match(self):
        self.login(SessionContext(UserState('u1', True, 1, True, grants=(
            {'role': 'staff', 'scopeId': 'c1', 'active': True},
            {'role': 'staff', 'scopeId': 'c2', 'active': True})), 2000).user)
        # A-c2 and X-c2 point at MOU1, but MOU1 is not in c2, so the projection drops the link.
        self.assertEqual(['A1', 'A2', 'A3'], self.ids('/api/activities', agreementId='MOU1'))
        self.assertEqual([], self.ids('/api/exchanges', agreementId='MOU1'))

    def test_coordinator_sees_only_assigned_records_and_links(self):
        self.login(user('coordinator', uid='coord'))
        self.assertEqual(['MOU1'], self.ids('/api/agreements', partnerId='P1'))
        self.assertEqual(['A1'], self.ids('/api/activities', agreementId='MOU1'))
        self.assertEqual([], self.ids('/api/exchanges', agreementId='MOA2'))
        self.assertEqual(404, self.get('/api/agreements/MOA2')[0])

    def test_unauthorized_accounts_get_nothing(self):
        self.login(user('staff', scope='c2', uid='u-c2'))
        self.assertEqual([], self.ids('/api/agreements', partnerId='P1'))
        self.assertEqual([], self.ids('/api/activities', agreementId='MOU1'))
        self.assertEqual(404, self.get('/api/agreements/MOU1')[0])
        self.login(user('student', uid='s1'))
        # A participant student may read X1 but never its agreement link.
        self.assertEqual([], self.ids('/api/exchanges', agreementId='MOA2'))

    def test_invalid_relationship_filters_are_rejected(self):
        for path, query in [('/api/activities', {'agreementId': ''}),
                            ('/api/activities', {'agreementId': ' MOU1'}),
                            ('/api/exchanges', {'agreementId': 'x' * 201}),
                            ('/api/partners', {'agreementId': 'MOU1'}),
                            ('/api/activities', {'partnerId': 'P1'}),
                            ('/api/exchanges', {'partnerId': 'P1'})]:
            with self.subTest(path=path, query=query):
                self.assertEqual(422, self.get(path, **query)[0])


if __name__ == '__main__':
    unittest.main()
