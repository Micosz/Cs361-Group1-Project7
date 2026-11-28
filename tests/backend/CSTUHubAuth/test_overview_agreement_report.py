"""#265: Overview answers, per agreement and period, how many activities, how many
students confirmed an Exchange place, and which Feedback to follow up.

Runs through the real Dynamo repository adapter (in-memory client) so admission
rounds/applications are read the same way production reads them. Dataset mirrors
docs/evidence/v7-expected-results.md.
"""

import json
import unittest

from backend.auth.session_service import COOKIE_NAME
from support.mock_auth import SCOPE, make_app

PERIOD = {'startDate': '2026-11-01', 'endDate': '2027-03-31'}


class OverviewAgreementReportTests(unittest.TestCase):
    def setUp(self):
        self.app, users = make_app(8766, writable=True)
        self.ids = {u['username']: u['id'] for u in users}
        self.db = self.app.repository.client
        self.db.rows.clear()
        staff = self.ids['staff']

        def add(row, scope=SCOPE, partition=None):
            row.update(scopeId=scope, version=1, schemaVersion=3)
            row['scopeEntity'] = partition or scope + '#' + row['entityType']
            self.db.rows[row['id']] = row
            return row

        add(dict(id='P1', entityType='partner', name='[V7] Partner', type='university',
                 publication='internal', responsibleUserIds=[staff]))
        for key, kind in (('MOU1', 'MoU'), ('MOA2', 'MoA')):
            add(dict(id=key, entityType='agreement', title='[V7] ' + key, agreementType=kind,
                     status='active', startDate='2026-10-01', endDate='2027-09-30',
                     partnerIds=['P1'], responsibleUserIds=[staff], publication='internal'))
        for key, day in (('A1', '2026-12-10'), ('A2', '2027-02-15'), ('A3', '2026-06-20')):
            add(dict(id=key, entityType='activity', title='[V7] ' + key, type='event', partnerId='P1',
                     periodDate=day, agreementIds=['MOU1'], responsibleUserIds=[staff], publication='internal'))
        add(dict(id='X1', entityType='exchange', title='[V7] X1', status='ongoing', partnerIds=['P1'],
                 agreementId='MOA2', startDate='2027-01-05', endDate='2027-03-20',
                 responsibleUserIds=[staff], participantUserIds=['s1', 's2']))
        # Another scope's Exchange claims MOA2; it must never add students to MOA2.
        add(dict(id='X-other', entityType='exchange', title='other scope', status='ongoing', partnerIds=['P1'],
                 agreementId='MOA2', startDate='2027-01-05', endDate='2027-03-20',
                 responsibleUserIds=[staff]), scope='other-scope')

        def round_(key, exchange, needs_confirmation=True, scope=SCOPE):
            return add(dict(id=key, entityType='exchangeRound', exchangeId=exchange, activityId='A1',
                            needsConfirmation=needs_confirmation, needsPartner=True), scope=scope,
                       partition=scope + '#exchangeRound')

        def application(round_key, student, scope=SCOPE, **state):
            return add(dict(id='app-' + round_key + '-' + student, entityType='exchangeApplication',
                            roundId=round_key, studentId=student, progress='reviewing', **state),
                       scope=scope, partition=round_key + '#exchangeApplication')

        round_('R1', 'X1')
        published = dict(publishedAt=1, decision='passed')
        # S1 and S2 confirmed (S2 also partner-accepted and enrolled), S3 passed but not confirmed.
        application('R1', 's1', confirmedAt=2, **published)
        application('R1', 's2', confirmedAt=2, partnerAcceptedAt=3, enrolledAt=3, **published)
        application('R1', 's3', **published)
        application('R1', 's4', publishedAt=1, decision='declined')   # declined
        application('R1', 's5', decision='passed')                     # result not published
        # A second round that needs no confirmation: passed + published counts, s1 is not double-counted.
        round_('R2', 'X1', needs_confirmation=False)
        application('R2', 's1', **published)
        application('R2', 's6', **published)
        # Other scope round for the foreign Exchange.
        round_('R-other', 'X-other', scope='other-scope')
        application('R-other', 's9', scope='other-scope', confirmedAt=2, **published)

        add(dict(id='F1', entityType='feedback', parentType='activity', parentId='A1', occurredOn='2026-12-11',
                 sourceType='participant', comment='ดี', improvement='เพิ่มเวลา', origin='internal',
                 createdBy=staff))
        add(dict(id='F3', entityType='feedback', parentType='partner', parentId='P1', occurredOn='2027-01-10',
                 sourceType='partner', comment='เก่า', origin='internal', createdBy=staff))
        add(dict(id='FF2', entityType='formFeedback', parentType='exchange', parentId='X1', formName='ฟอร์ม X1',
                 sourceType='participant', fileName='x1.csv', sheetName='Sheet1', responseCount=3,
                 createdAt='2027-03-21T00:00:00+00:00', createdBy=staff, importedByName='staff'))
        self.login('staff')

    def login(self, username):
        user = self.app.sessions.users.get(self.ids[username])
        self.token = self.app.sessions._issue(user).token

    def overview(self, **query):
        event = dict(version='2.0', rawPath='/api/overview',
                     requestContext={'http': {'method': 'GET', 'sourceIp': '127.0.0.1'}},
                     queryStringParameters=query, headers={'origin': self.app.sessions.policy.origin},
                     cookies=[COOKIE_NAME + '=' + self.token])
        reply = self.app.handle(event)
        return reply['statusCode'], json.loads(reply['body'])

    def summary(self, body, key):
        return next(row for row in body['data']['agreementSummary'] if row['id'] == key)

    def test_mou1_in_period_has_two_activities_and_no_students(self):
        status, body = self.overview(agreementId='MOU1', **PERIOD)
        self.assertEqual(200, status, body)
        data = body['data']
        self.assertEqual(2, data['activities']['count'])
        self.assertEqual(0, data['exchanges']['count'])
        self.assertEqual(0, data['exchanges']['confirmedStudents'])
        self.assertEqual(['MOU1'], [row['id'] for row in data['agreementSummary']])
        mou = self.summary(body, 'MOU1')
        self.assertEqual((2, 0, 0, 1), (mou['activityCount'], mou['exchangeCount'],
                                        mou['confirmedStudents'], mou['commentCount']))

    def test_moa2_counts_confirmed_students_only(self):
        status, body = self.overview(agreementId='MOA2', **PERIOD)
        self.assertEqual(200, status, body)
        data = body['data']
        self.assertEqual(0, data['activities']['count'])
        self.assertEqual(1, data['exchanges']['count'])
        # s1 (confirmed, also in R2), s2 (confirmed), s6 (no confirmation needed). Not s3/s4/s5/s9.
        self.assertEqual(3, data['exchanges']['confirmedStudents'])
        self.assertEqual(1, data['exchanges']['awaitingConfirmation'])
        moa = self.summary(body, 'MOA2')
        self.assertEqual((0, 1, 3, 1), (moa['activityCount'], moa['exchangeCount'],
                                        moa['confirmedStudents'], moa['awaitingConfirmation']))
        self.assertEqual((1, 3, 0), (moa['batchCount'], moa['responseCount'], moa['commentCount']))

    def test_changing_agreement_never_mixes_results(self):
        _, mou = self.overview(agreementId='MOU1', **PERIOD)
        _, moa = self.overview(agreementId='MOA2', **PERIOD)
        self.assertEqual(['MOU1'], [r['id'] for r in mou['data']['agreementSummary']])
        self.assertEqual(['MOA2'], [r['id'] for r in moa['data']['agreementSummary']])
        self.assertEqual(0, mou['data']['formFeedback']['responseCount'])
        self.assertEqual(0, moa['data']['feedback']['count'])

    def test_without_period_mou1_includes_out_of_period_activity(self):
        _, body = self.overview(agreementId='MOU1')
        self.assertEqual(3, self.summary(body, 'MOU1')['activityCount'])

    def test_partner_only_feedback_is_unspecified_and_never_added_to_an_agreement(self):
        _, body = self.overview(**PERIOD)
        data = body['data']
        self.assertEqual(1, data['formFeedback']['unspecifiedAgreement']['commentCount'])
        self.assertEqual(1, self.summary(body, 'MOU1')['commentCount'])
        self.assertEqual(0, self.summary(body, 'MOA2')['commentCount'])
        self.assertEqual(3, data['exchanges']['confirmedStudents'])

    def test_report_never_exposes_student_identities(self):
        _, body = self.overview(agreementId='MOA2', **PERIOD)
        text = json.dumps(body)
        for student in ('s1', 's2', 's3', 's6', 's9'):
            self.assertNotIn('"' + student + '"', text)

    def test_roles_without_overview_access_are_refused(self):
        for username in ('coordinator', 'student-a'):
            with self.subTest(username=username):
                self.login(username)
                self.assertEqual(403, self.overview(agreementId='MOA2')[0])


if __name__ == '__main__':
    unittest.main()
