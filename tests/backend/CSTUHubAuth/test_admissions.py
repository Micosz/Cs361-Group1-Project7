from concurrent.futures import ThreadPoolExecutor
import unittest

from support.admissions_fixture import Fixture, BASE, PROJECT, SECOND, OLD, ACTIVITY, NEXT, ORDINARY, iso


class AdmissionsTests(unittest.TestCase):
    def setUp(self):
        self.fx = Fixture()
        for user in ('coordinator', 'student-a', 'student-b', 'employee', 'multi'):
            self.fx.login(user, user)

    def call(self, who, path, method='GET', data=None, status=200, **kw):
        code, document = self.fx.request(who, '/api/' + path, method, data, **kw)
        self.assertEqual(code, status, document)
        return document.get('data', document.get('error'))

    def create(self, project=PROJECT, key='admissions-key-00001', **options):
        payload = self.fx.round_data(**options)
        return self.call(
            'coordinator', 'exchanges/' + project + '/admission-rounds', 'POST', payload, key=key
        )['id']

    def mine(self, id, who, method='GET', status=200):
        return self.call(
            who,
            'admission-rounds/' + id + '/mine',
            method,
            {'answer': 'งานวิจัยจำลอง'} if method == 'POST' else {},
            status,
        )

    def roster(self, id):
        return self.call('coordinator', 'admission-rounds/' + id + '/applications')['applications']

    def update(self, id, row, act, status=200, **fields):
        return self.call(
            'coordinator',
            'admission-rounds/' + id + '/applications/' + row['id'],
            'PATCH',
            dict(action=act, **fields),
            status,
            version=row['version'],
        )

    def test_ids_channels_and_publication_boundaries(self):
        rid = self.create()
        next_id = self.create(
            SECOND,
            activityId=NEXT,
            channel='official',
            needsConfirmation=False,
            confirmBy=None,
            title='รอบภายนอก (สมมติ)',
            officeName='กองวิเทศสัมพันธ์ (สมมติ)',
            officeUrl='https://example.org/fixture',
            question='',
        )
        self.assertNotEqual(rid, next_id)
        self.assertEqual(self.create(), rid)
        self.assertEqual(self.call('student-a', 'public/activities/' + ORDINARY + '/admission-rounds'), [])
        for offset, phase in [(59, 'scheduled'), (60, 'open'), (179, 'open'), (180, 'closed')]:
            self.fx.now = BASE + offset
            rows = self.call('guest', 'public/activities/' + ACTIVITY + '/admission-rounds')
            self.assertEqual([(r['id'], r['phase']) for r in rows], [(rid, phase)])
            self.assertNotIn('exchangeId', rows[0])
        self.fx.now = BASE + 65
        self.mine(next_id, 'student-a', 'POST', 409)
        self.assertEqual(
            self.call('guest', 'public/activities/' + NEXT + '/admission-rounds')[0]['officeName'],
            'กองวิเทศสัมพันธ์ (สมมติ)',
        )
        choices = self.call('coordinator', 'activities/' + ACTIVITY + '/admission-projects')
        self.assertIn(PROJECT, [p['id'] for p in choices])
        self.call('student-a', 'exchanges/' + PROJECT + '/admission-rounds', status=403)
        self.fx.db.rows[PROJECT]['responsibleUserIds'] = []
        self.call('coordinator', 'admission-rounds/' + rid + '/applications', status=404)
        self.assertEqual(
            self.call('coordinator', 'activities/' + ACTIVITY + '/admission-projects')[0].keys(),
            {'id', 'title'},
        )
        self.fx.db.rows[ACTIVITY]['publication'] = 'internal'
        self.assertEqual(self.call('guest', 'public/activities/' + ACTIVITY + '/admission-rounds'), [])
        self.mine(rid, 'student-b', 'POST', 404)

    def test_repeat_submissions_deadline_and_scope(self):
        rid = self.create()
        other = self.create(key='second-admission-key', title='รอบสอง')
        self.mine(rid, 'student-a', 'POST', 409)
        self.fx.now = BASE + 60
        with ThreadPoolExecutor(max_workers=4) as pool:
            answers = list(pool.map(lambda _: self.mine(rid, 'student-a', 'POST'), range(4)))
        self.assertEqual(len(self.roster(rid)), 1)
        self.assertEqual(len({a['submittedAt'] for a in answers}), 1)
        self.mine(other, 'student-a', 'POST')
        self.assertEqual(len(self.call('student-a', 'me/admission-applications')), 2)
        self.assertEqual(self.call('student-b', 'me/admission-applications'), [])
        self.mine(rid, 'student-b', status=404)
        self.fx.now = BASE + 180
        self.mine(rid, 'student-b', 'POST', 409)
        self.assertEqual(len(self.roster(rid)), 1)
        self.assertEqual(self.mine(rid, 'student-a', 'POST')['state'], 'submitted')
        self.assertEqual(self.call('student-a', 'me/exchanges'), [])
        self.mine(rid, 'employee', status=403)
        self.fx.db.accounts.rows[self.fx.ids['student-a']]['tuType'] = 'employee'
        self.mine(rid, 'student-a', status=403)

    def test_private_draft_notice_expiry_and_atomic_enrollment(self):
        rid = self.create(needsPartner=True)
        self.fx.now = BASE + 80
        for who in ['student-a', 'student-b']:
            self.mine(rid, who, 'POST')
        a, b = sorted(self.roster(rid), key=lambda r: r['studentName'])
        a = self.update(
            rid, a, 'information', request='สำเนาใน fixture', channel='ช่องทางสมมติ', dueAt=iso(BASE + 210)
        )
        self.assertEqual(self.mine(rid, 'student-a')['information']['channel'], 'ช่องทางสมมติ')
        self.assertNotIn('information', self.mine(rid, 'student-b'))
        a = self.update(rid, a, 'decide', decision='passed')
        b = self.update(rid, b, 'decide', decision='declined')
        for who in ['student-a', 'student-b']:
            view = self.mine(rid, who)
            self.assertEqual(view['state'], 'reviewing')
            self.assertNotIn('decision', view)
        self.update(rid, a, 'publish', 409)
        self.fx.now = BASE + 240
        self.update(rid, a, 'publish')
        self.update(rid, b, 'publish')
        a = self.update(rid, a, 'publish')
        self.assertEqual(self.mine(rid, 'student-b')['state'], 'declined')
        self.assertEqual(self.mine(rid, 'student-a')['state'], 'confirm')
        confirm = 'admission-rounds/' + rid + '/mine/confirm'
        self.call('student-b', confirm, 'PUT', {}, 409)
        self.assertEqual(self.call('student-a', confirm, 'PUT')['state'], 'awaitingPartner')
        self.assertEqual(self.call('student-a', 'me/exchanges'), [])
        self.call('student-a', 'me/exchanges/' + PROJECT + '/documents', status=404)
        self.call('student-a', 'documents/doc-' + PROJECT + '/content', status=404)
        self.fx.now = BASE + 419
        self.assertEqual(self.mine(rid, 'student-b')['state'], 'declined')
        self.fx.now = BASE + 420
        self.mine(rid, 'student-b', status=404)
        self.assertEqual(self.call('student-b', 'me/admission-applications'), [])
        self.assertEqual(len(self.call('guest', 'public/activities/' + ACTIVITY + '/admission-rounds')), 1)
        self.assertEqual(len(self.roster(rid)), 2)
        a = next(r for r in self.roster(rid) if r['decision'] == 'passed')
        self.update(rid, a, 'partnerAccepted')
        self.update(rid, a, 'partnerAccepted')
        self.assertEqual(self.call('student-a', confirm, 'PUT')['state'], 'enrolled')
        self.assertEqual([a['id'] for a in self.call('student-a', 'me/exchanges')], [PROJECT])
        self.assertEqual(
            self.call('student-a', 'me/exchanges/' + PROJECT + '/documents')[0]['id'], 'doc-' + PROJECT
        )
        self.assertEqual(self.call('student-b', 'me/exchanges'), [])
        self.call('student-b', 'documents/doc-' + PROJECT + '/content', status=404)
        self.call('student-a', 'documents/doc-' + PROJECT + '/content')
        self.call('multi', 'documents/doc-' + OLD + '/content')
        self.assertEqual(
            self.fx.db.rows[PROJECT]['participantUserIds'], [self.fx.ids['multi'], self.fx.ids['student-a']]
        )
        self.assertEqual(self.fx.db.rows[PROJECT]['status'], 'ongoing')
        self.assertIn(OLD, [x['id'] for x in self.call('multi', 'me/exchanges')])

    def test_internal_and_optional_confirmation_capacity_and_retry(self):
        for auto in (False, True):
            self.setUp()
            rid = self.create(
                capacity=1, needsConfirmation=not auto, confirmBy=None if auto else iso(BASE + 360)
            )
            self.fx.now = BASE + 60
            for who in ['student-a', 'student-b']:
                self.mine(rid, who, 'POST')
            a, b = [
                self.update(rid, r, 'decide', decision='passed')
                for r in sorted(self.roster(rid), key=lambda r: r['studentName'])
            ]
            self.fx.now = BASE + 240
            # A concurrent existing-project edit must be retained on retry.
            project = self.fx.db.rows[PROJECT]

            def concurrent_edit():
                project.update(version=project['version'] + 1, supportingInfo='แก้ไขก่อนบันทึก')

            self.fx.db.before_commit = concurrent_edit
            self.update(rid, a, 'publish')
            self.update(rid, b, 'publish', 409)
            if not auto:
                self.assertEqual(self.mine(rid, 'student-a')['state'], 'confirm')
                cmd = 'admission-rounds/' + rid + '/mine/confirm'
                with ThreadPoolExecutor(max_workers=2) as pool:
                    self.assertEqual(
                        [
                            v['state']
                            for v in pool.map(lambda _: self.call('student-a', cmd, 'PUT'), range(2))
                        ],
                        ['enrolled', 'enrolled'],
                    )
            self.assertEqual(self.mine(rid, 'student-a')['state'], 'enrolled')
            self.assertEqual(self.fx.db.rows[PROJECT]['supportingInfo'], 'แก้ไขก่อนบันทึก')
            self.assertEqual(
                self.fx.db.rows[PROJECT]['participantUserIds'].count(self.fx.ids['student-a']), 1
            )

    def test_confirmation_deadline_and_lost_response(self):
        rid = self.create()
        self.fx.now = BASE + 60
        self.mine(rid, 'student-a', 'POST')
        self.mine(rid, 'student-b', 'POST')
        a, b = [
            self.update(rid, r, 'decide', decision='passed')
            for r in sorted(self.roster(rid), key=lambda r: r['studentName'])
        ]
        self.fx.now = BASE + 240
        self.update(rid, a, 'publish')
        self.update(rid, b, 'publish')
        path = 'admission-rounds/' + rid + '/mine/confirm'
        apply = self.fx.db.transact_write_items

        def lost_reply(**kwargs):
            apply(**kwargs)
            self.fx.db.transact_write_items = apply
            raise TimeoutError('synthetic lost acknowledgement')

        self.fx.db.transact_write_items = lost_reply
        self.call('student-a', path, 'PUT', status=503)
        self.assertEqual(self.call('student-a', path, 'PUT')['state'], 'enrolled')
        self.fx.now = BASE + 600
        self.call('student-b', path, 'PUT', status=409)
        self.assertEqual(self.mine(rid, 'student-b')['state'], 'confirmationClosed')
        self.assertEqual(
            self.fx.db.rows[PROJECT]['participantUserIds'], [self.fx.ids['multi'], self.fx.ids['student-a']]
        )

    def test_canonical_activity_project_and_write_scope(self):
        r = self.create()
        self.fx.now = BASE + 60
        self.mine(r, 'student-a', 'POST')
        row = self.roster(r)[0]
        self.call('student-b', 'admission-rounds/' + r + '/applications', status=403)
        self.call(
            'student-b',
            'admission-rounds/' + r + '/applications/' + row['id'],
            'PATCH',
            {'action': 'publish'},
            403,
            version=row['version'],
        )
        self.fx.db.rows[PROJECT]['scopeId'] = 'different-curriculum'
        self.mine(r, 'student-a', status=404)
        self.assertEqual(self.call('student-a', 'me/admission-applications'), [])
        self.fx.db.rows[PROJECT]['scopeId'] = 'cs-demo'
        self.fx.db.rows[PROJECT]['responsibleUserIds'] = []
        self.update(r, row, 'decide', 404, decision='passed')
        self.fx.db.rows[PROJECT]['responsibleUserIds'] = [self.fx.ids['coordinator']]
        self.fx.db.rows[ACTIVITY]['partnerId'] = 'unrelated-partner'
        self.assertFalse(self.call('guest', 'public/activities/' + ACTIVITY + '/admission-rounds'))
        self.mine(r, 'student-b', 'POST', 404)

    def test_lost_submission_acknowledgement_and_partner_only_round(self):
        rid = self.create(needsConfirmation=False, confirmBy=None, needsPartner=True)
        self.fx.now = BASE + 60
        write = self.fx.db.transact_write_items

        def lose_first_reply(**kwargs):
            write(**kwargs)
            self.fx.db.transact_write_items = write
            raise TimeoutError('synthetic acknowledgement interrupted')

        self.fx.db.transact_write_items = lose_first_reply
        self.mine(rid, 'student-a', 'POST', 503)
        self.assertEqual(self.mine(rid, 'student-a', 'POST')['state'], 'submitted')
        self.assertEqual(len(self.call('student-a', 'me/admission-applications')), 1)
        self.assertEqual(len(self.roster(rid)), 1)
        row = self.update(rid, self.roster(rid)[0], 'decide', decision='passed')
        self.fx.now = BASE + 240
        row = self.update(rid, row, 'publish')
        self.assertEqual(self.mine(rid, 'student-a')['state'], 'awaitingPartner')
        self.call('student-a', 'me/exchanges/' + PROJECT + '/documents', status=404)
        self.update(rid, row, 'partnerAccepted')
        self.update(rid, row, 'partnerAccepted')
        self.assertEqual(self.mine(rid, 'student-a')['state'], 'enrolled')
        self.assertEqual(self.fx.db.rows[PROJECT]['participantUserIds'].count(self.fx.ids['student-a']), 1)
