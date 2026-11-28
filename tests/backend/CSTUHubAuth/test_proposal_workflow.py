"""Round-trip #287 through the actual HTTP handler with independent, synthetic TU sessions."""
import base64
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import unittest

from backend.proposal_workflow import stamp
from support.admissions_fixture import BASE, PARTNER, Fixture
from support.mock_auth import SCOPE

PDF_DIR = Path(__file__).resolve().parents[2] / 'proposals' / 'fixtures'
OWNER = 'coordinator'
EXEC = 'executive'
STAFF = 'staff'
VOLUNTEER = 'multi'


class ProposalWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.fx = Fixture()
        outside = self.fx.app.sessions.users.rows[self.fx.ids['manager']]
        outside['grants'] = [dict(role='executive', scopeId='other-demo', active=True)]
        self.login()
        self.sequence = 0

    def login(self):
        for label in (OWNER, STAFF, EXEC, VOLUNTEER, 'student-a', 'manager'):
            self.fx.login(label, label)

    def call(self, who, path='', method='GET', data=None, status=200, **kwargs):
        code, result = self.fx.request(who, '/api/proposals' + path, method, data, **kwargs)
        self.assertEqual(code, status, (method, path, result))
        return result.get('data', result)

    def payload(self, kind='mou', source='board', **changes):
        data = dict(kind=kind, source=source, scopeId=SCOPE, title='ห้องเรียนชุมชน (สมมติ)',
                    summary='ประสานวิทยากรศิษย์เก่าจัดห้องเรียนทดลอง ยังอยู่ระหว่างหารือ',
                    stage='contacted', partnerType='person', partner='วิทยากรลานดาว (สมมติ)',
                    hostSelf=False)
        if source == 'board':
            data.update(self.call(OWNER, '/deadline?days=1'))
        return dict(data, **changes)

    def create(self, kind='mou', source='board', **changes):
        self.sequence += 1
        return self.call(OWNER, method='POST', data=self.payload(kind, source, **changes), status=201,
                         key='proposal-fixture-' + str(self.sequence))

    def detail(self, who, row, status=200):
        return self.call(who, '/' + row['id'], status=status)

    def update(self, who, row, suffix, method, payload, status=200):
        return self.call(who, '/' + row['id'] + '/' + suffix, method, payload, status, version=row['version'])

    def action(self, who, row, name, revision=None, note=None, status=200):
        data = dict(action=name)
        if name != 'inform':
            data['revision'] = revision
        if note is not None:
            data['note'] = note
        return self.update(who, row, 'workflow', 'POST', data, status)

    def upload(self, who, row, number, purpose='draft', status=201):
        name = f'mou-demo-v{number}.pdf'
        contents = (PDF_DIR / name).read_bytes()
        return self.update(who, row, 'files/' + purpose, 'POST',
                           dict(fileName=name, contentType='application/pdf',
                                fileBase64=base64.b64encode(contents).decode()), status)

    def read_file(self, who, entry, status=200):
        result = self.call(who, entry['url'].removeprefix('/api/proposals'), status=status)
        if status == 200:
            self.assertIn('attachment', result['headers']['content-disposition'])
            self.assertEqual(result['headers']['content-type'], 'application/pdf')
            self.assertEqual(result['headers']['cache-control'], 'no-store')
            return base64.b64decode(result['bodyBase64'])

    def offer(self, who, row, join=True, note='', status=200):
        return self.call(who, '/' + row['id'] + '/interest', 'PUT', dict(interested=join, note=note), status)

    def test_creation_types_details_partner_preview_and_replay(self):
        for kind in ('activity', 'exchange', 'mou'):
            with self.subTest(kind=kind):
                row = self.create(kind)
                self.assertEqual((row['kind'], row['stage'], row['status']), (kind, 'contacted', 'open'))
                self.assertEqual(row['creator'], 'ผู้ประสานงาน')
                self.assertEqual((row['files'], row['supportLink']), ([], ''))
                self.assertEqual(row['closesAt'], stamp(BASE + 86400))
                self.call(OWNER, method='POST', data=self.payload(kind, summary=' '), status=422,
                          key='test-empty-details-' + kind)
        payload = self.payload(partnerType='existing', partnerId=PARTNER, supportLink='https://example.org/demo')
        del payload['partner']
        self.fx.now += 20
        row = self.call(OWNER, method='POST', data=payload, status=201)
        self.assertEqual(row['partner'], 'มหาวิทยาลัยลำน้ำ (สมมติ)')
        self.assertEqual(row['closesAt'], stamp(BASE + 86400))
        row = self.call(OWNER, '/' + row['id'], 'PATCH', {'stage': 'planning'}, version=row['version'])
        self.assertEqual(row['stage'], 'planning')
        replay = self.call(OWNER, method='POST', data=payload, status=201)
        self.assertEqual((replay['id'], replay['stage']), (row['id'], 'planning'))
        self.call(OWNER, method='POST', data=dict(payload, title='ต่างกัน'), status=409)
        self.assertEqual(len(self.call(OWNER)), 4)

    def test_board_access_guest_student_other_scope_and_existing_partner(self):
        row = self.create()
        for who, status in [('guest', 401), ('student-a', 403), ('manager', 404)]:
            self.detail(who, row, status)
            self.call(who, status=status if who != 'manager' else 200)
        self.assertEqual(self.call('manager'), [])
        payload = self.payload(partnerType='existing', partnerId='unknown-partner')
        del payload['partner']
        self.call(OWNER, method='POST', data=payload, status=422)
        self.assertNotIn('requestHash', row)
        self.call(OWNER, method='POST', data=self.payload(kind='activity', source='direct'), status=422)
        other = self.call(STAFF, '/deadline?days=1')
        self.call(OWNER, method='POST', data=dict(self.payload(), **other), status=422)
        self.call(OWNER, '/deadline?days=0', status=422)

    def test_concurrent_volunteers_optional_note_edit_withdraw_and_separate_host(self):
        row = self.create('activity')
        with ThreadPoolExecutor(max_workers=2) as pool:
            offers = [pool.submit(self.offer, STAFF, row, True, 'ช่วยเตรียมห้อง (สมมติ)'),
                      pool.submit(self.offer, VOLUNTEER, row)]
            for result in offers:
                result.result()
        row = self.detail(OWNER, row)
        self.assertEqual((row['interestCount'], row['notedCount'], len(row['participants'])), (2, 1, 2))
        self.assertNotIn('hostId', row)
        self.assertEqual(len(self.detail(EXEC, row)['participants']), 2)
        self.assertEqual(len(self.detail(VOLUNTEER, row)['participants']), 1)
        row = self.update(STAFF, row, 'host', 'PUT', {})
        self.assertTrue(next(p['isHost'] for p in row['participants'] if p['mine']))
        self.assertEqual(row['hostId'], self.fx.ids[STAFF])
        self.update(VOLUNTEER, row, 'host', 'PUT', {}, 409)
        row = self.offer(STAFF, row, True, 'แก้บันทึกแล้ว')
        self.assertEqual((row['myNote'], row['notedCount']), ('แก้บันทึกแล้ว', 1))
        row = self.offer(STAFF, row, False)
        self.assertEqual((row['interestCount'], row['notedCount'], row['hostId']), (1, 0, self.fx.ids[STAFF]))
        self.assertNotIn('volunteerUserIds', row)
        self.assertEqual(self.offer(STAFF, row, False)['version'], row['version'])
        row = self.detail(OWNER, row)
        self.assertEqual(row['status'], 'open')
        self.fx.now = BASE + 86400 - 1
        self.login()
        self.assertEqual(self.offer(STAFF, row)['interestCount'], 2)
        self.fx.now += 1
        self.offer(VOLUNTEER, row, False, status=409)
        closed = self.detail(OWNER, row)
        self.assertEqual(closed['status'], 'closed')
        self.assertEqual((closed['closedAt'], len(closed['participants'])), (row['closesAt'], 2))

    def test_direct_v1_return_v2_approve_scoped_contents_cross_account_and_history(self):
        direct = self.create(source='direct')
        self.assertNotIn(direct['id'], {row['id'] for row in self.call(EXEC)})
        self.detail(EXEC, direct, 404)
        self.detail(STAFF, direct, 404)
        v1 = self.upload(OWNER, direct, 1)
        saved_again = self.upload(OWNER, direct, 1)
        self.assertEqual((saved_again['version'], len(saved_again['files'])), (v1['version'], 1))
        file1 = v1['files'][0]
        submitted = self.action(OWNER, v1, 'submit', 1)
        self.assertEqual((submitted['status'], submitted['submittedRevision']), ('review', 1))
        self.assertEqual(self.read_file(EXEC, file1), (PDF_DIR / 'mou-demo-v1.pdf').read_bytes())
        for who, code in [('guest', 401), ('student-a', 403), ('manager', 404), (STAFF, 404)]:
            self.read_file(who, file1, code)
        self.action(OWNER, submitted, 'approve', 1, status=403)
        self.action(EXEC, submitted, 'return', 1, status=422)
        reason = 'ขอระบุในข้อ 3 ว่าใครส่งผลกิจกรรม ส่งให้ใคร และภายในกี่วัน'
        returned = self.action(EXEC, submitted, 'return', 1, reason)
        self.login()
        returned = self.detail(OWNER, returned)
        self.assertEqual((returned['status'], returned['history'][-1]['note']), ('changes', reason))
        self.action(OWNER, returned, 'submit', 1, 'สรุปเดิม', 409)
        v2 = self.upload(OWNER, returned, 2)
        self.action(OWNER, v2, 'submit', 2, status=422)
        note = 'แก้ข้อ 3 ให้เจ้าภาพส่งสรุปแก่ผู้ประสานงานทั้งสองฝ่ายภายใน 14 วันหลังจบกิจกรรม'
        resubmitted = self.action(OWNER, v2, 'submit', 2, note)
        self.action(EXEC, resubmitted, 'approve', 1, status=409)
        file2 = resubmitted['files'][1]
        self.assertEqual(self.read_file(EXEC, file2), (PDF_DIR / 'mou-demo-v2.pdf').read_bytes())
        self.fx.now += 60
        signed_next = self.action(EXEC, resubmitted, 'approve', 2)
        self.assertEqual((signed_next['status'], signed_next['approvedRevision']), ('signing', 2))
        self.assertNotIn('signed', signed_next)
        self.login()
        saved = self.detail(OWNER, signed_next)
        decisions = [(e['action'], e['revision'], e['actorId'], e['at'], e['note'])
                     for e in saved['history'] if e['action'] in ('return', 'approve')]
        self.assertEqual(decisions, [('return', 1, self.fx.ids[EXEC], stamp(BASE), reason),
                                     ('approve', 2, self.fx.ids[EXEC], stamp(BASE + 60), '')])
        self.assertEqual(self.read_file(OWNER, file1), (PDF_DIR / 'mou-demo-v1.pdf').read_bytes())

    def test_deadline_three_mou_cases_and_two_other_kinds_including_repeated_observation(self):
        empty, manual, auto = self.create(), self.create(), self.create()
        manual, auto = self.upload(OWNER, manual, 1), self.upload(OWNER, auto, 1)
        auto = self.action(OWNER, auto, 'auto', 1)
        auto = self.upload(OWNER, auto, 2)
        self.assertEqual((auto['autoRevision'], auto['interestCount']), (1, 0))
        self.action(OWNER, manual, 'submit', 1, status=409)
        activity, exchange = self.create('activity'), self.create('exchange')
        self.action(OWNER, activity, 'auto', 1, status=409)
        self.fx.now = BASE + 86400
        self.login()
        with ThreadPoolExecutor(max_workers=2) as pool:
            reads = [pool.submit(self.detail, who, auto) for who in (STAFF, EXEC)]
            for result in reads:
                self.assertEqual(result.result()['status'], 'review')
        first = {r['id']: r for r in self.call(OWNER)}
        second = {r['id']: r for r in self.call(OWNER)}
        self.assertEqual(first, second)
        for row in (empty, manual, activity, exchange):
            self.assertEqual(first[row['id']]['status'], 'closed')
            self.assertNotIn('submittedRevision', first[row['id']])
        closed_auto = first[auto['id']]
        self.assertEqual((closed_auto['submittedRevision'], closed_auto['submittedAt']), (1, auto['closesAt']))
        self.assertEqual((closed_auto['history'], closed_auto['files']), ([], []))
        self.assertTrue(first[empty['id']]['awaitingDraft'])
        self.assertFalse(first[manual['id']]['awaitingDraft'])
        audit = self.detail(OWNER, auto)['history']
        self.assertEqual([h['action'] for h in audit].count('auto-submit'), 1)
        self.assertEqual([f['revision'] for f in self.detail(EXEC, auto)['files']], [1])
        self.read_file(EXEC, auto['files'][1], 404)
        self.assertEqual(self.read_file(OWNER, auto['files'][1]), (PDF_DIR / 'mou-demo-v2.pdf').read_bytes())
        self.assertEqual(self.action(OWNER, first[manual['id']], 'submit', 1)['status'], 'review')
        self.assertEqual(self.detail(STAFF, auto)['files'], [])

    def test_resubmission_uses_a_file_attached_in_response_to_this_return(self):
        staged = self.upload(OWNER, self.upload(OWNER, self.create(source='direct'), 1), 2)
        sent = self.action(OWNER, staged, 'submit', 1)
        returned = self.action(EXEC, sent, 'return', 1, 'เพิ่มรายละเอียดการติดตามผล (สมมติ)')
        owner = self.detail(OWNER, returned)
        self.assertEqual(owner['resubmitAfterRevision'], 2)
        self.action(OWNER, owner, 'submit', 2, 'ยังไม่ได้แนบใหม่', 409)
        uploaded = self.upload(OWNER, owner, 2)
        self.assertEqual(uploaded['files'][-1]['revision'], 3)
        self.assertEqual(self.action(OWNER, uploaded, 'submit', 3, 'แก้ตามข้อเสนอแนะ')['status'], 'review')

    def test_support_files_open_only_to_internal_scope_and_inform_does_not_send(self):
        row = self.create('exchange')
        row = self.upload(OWNER, row, 1, 'support')
        self.assertEqual(self.read_file(STAFF, row['files'][0]), (PDF_DIR / 'mou-demo-v1.pdf').read_bytes())
        self.read_file('student-a', row['files'][0], 403)
        self.read_file('manager', row['files'][0], 404)
        self.action(STAFF, row, 'inform', status=403)
        row = self.action(OWNER, row, 'inform')
        self.assertEqual((row['status'], row['informedAt']), ('open', stamp(BASE)))
        replay = self.action(OWNER, row, 'inform')
        self.assertEqual(row['version'], replay['version'])
        self.assertNotIn('submittedAt', self.detail(EXEC, row))
        self.action(OWNER, row, 'submit', 1, status=409)

    def test_cancel_auto_and_compare_and_swap_failures_preserve_latest_reviewed_file(self):
        row = self.upload(OWNER, self.create(), 1)
        automatic = self.action(OWNER, row, 'auto', 1)
        self.action(OWNER, row, 'auto', None, status=409)
        manual = self.action(OWNER, automatic, 'auto', None)
        self.assertIsNone(manual['autoRevision'])
        objects = self.fx.app.repository.documents.client.rows
        keys = set(objects)
        def changed():
            self.fx.db.rows[row['id']]['version'] += 1
        self.fx.db.before_commit = changed
        self.upload(OWNER, manual, 2, status=409)
        self.assertEqual(set(objects), keys)
        self.fx.now = BASE + 86400
        self.login()
        self.assertEqual(self.detail(OWNER, row)['status'], 'closed')
        self.assertEqual(self.read_file(OWNER, row['files'][0]), (PDF_DIR / 'mou-demo-v1.pdf').read_bytes())

    def test_legacy_record_stays_readable_without_inventing_new_fields_or_queue_transitions(self):
        old = self.call(OWNER, method='POST', data=dict(scopeId=SCOPE, title='ข้อเสนอเดิม', partner='คู่เดิม',
                        summary='รายละเอียดเดิม', deadline=stamp(BASE)[:10]), status=201)
        self.fx.now += 86400
        self.login()
        record = self.detail(EXEC, old)
        self.assertTrue(record['legacy'])
        self.assertEqual((record['title'], record['status']), ('ข้อเสนอเดิม', 'closed'))
        self.assertNotIn('kind', record)
        self.assertNotIn('submittedRevision', record)
        self.assertEqual([entry['id'] for entry in self.call(OWNER)], [old['id']])

    def test_legacy_members_remain_intact_and_new_offers_have_no_500_person_cutoff(self):
        row = self.call(OWNER, method='POST', data=dict(scopeId=SCOPE, title='รายการเดิม (สมมติ)',
                        partner='คู่เดิม', summary='ข้อเสนอเดิม', deadline=stamp(BASE)[:10]), status=201)
        stored = self.fx.db.rows[row['id']]
        original = {f'fixture-{i}': f'ผู้สนใจสมมติ {i}' for i in range(499)}
        original[self.fx.ids[VOLUNTEER]] = {'name': 'ผู้ช่วยเดิม (สมมติ)', 'note': 'ข้อความเดิม'}
        stored['members'] = original.copy()
        self.assertEqual(self.detail(OWNER, row)['interestCount'], 500)
        joined = self.offer(STAFF, row, note='ผู้ช่วยใหม่')
        self.assertEqual((joined['interestCount'], joined['notedCount']), (501, 2))
        self.assertEqual(len(joined['participants']), 1)
        changed = self.offer(VOLUNTEER, row, note='แก้สิ่งที่ช่วย')
        self.assertEqual((changed['interestCount'], changed['myNote']), (501, 'แก้สิ่งที่ช่วย'))
        self.offer(VOLUNTEER, row, False)
        current = self.detail(OWNER, row)
        self.assertEqual((current['interestCount'], current['notedCount'], len(current['participants'])),
                         (500, 1, 500))
        self.assertEqual(self.fx.db.rows[row['id']]['members'], original)
        # A later login may rejoin, while old source members and their historical names stay intact.
        self.login()
        self.assertEqual(self.offer(VOLUNTEER, row)['interestCount'], 501)
        self.assertEqual(self.detail(OWNER, row)['status'], 'open')

    def test_cross_account_roster_reads_two_primary_pages_for_65_helpers(self):
        row = self.create('activity')
        accounts = self.fx.app.sessions.users.rows
        template = accounts[self.fx.ids[STAFF]]
        for i in range(65):
            uid = 'fixture-roster-' + str(i)
            accounts[uid] = dict(template, id=uid, subjectKey=uid, displayName='ผู้ช่วยสมมติ ' + str(i))
            self.fx.ids[uid] = uid
            self.fx.login(uid, uid)
            self.offer(uid, row, note='ช่วยเตรียมงาน' if i % 2 == 0 else '')
        page_reads = []
        original_get = self.fx.app.repository.get
        def counting_get(kind, key):
            if kind == 'proposalInterestPage':
                page_reads.append(key)
            return original_get(kind, key)
        self.fx.app.repository.get = counting_get
        result = self.detail(OWNER, row)
        self.assertEqual((result['interestCount'], result['notedCount'], len(result['participants'])),
                         (65, 33, 65))
        self.assertEqual(len(set(page_reads)), 2)
        self.assertEqual(len(page_reads), 2)
        self.offer('fixture-roster-0', row, False)
        self.assertEqual(self.detail(OWNER, row)['interestCount'], 64)
