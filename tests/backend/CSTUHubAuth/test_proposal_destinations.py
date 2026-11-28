"""Synthetic HTTP journeys through the real proposal, activity, exchange and agreement writers."""

import base64
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
import unittest
from unittest.mock import patch

from support.admissions_fixture import Fixture, PARTNER
from support.mock_auth import SCOPE


class ProposalDestinationTests(unittest.TestCase):
    def setUp(self):
        self.f = Fixture()
        for name in ('coordinator', 'staff', 'executive', 'multi', 'student-a'):
            self.f.login(name, name)
        self.number = 0

    def call(self, actor, path, method='GET', payload=None, version=None, expected=200):
        self.number += 1
        status, result = self.f.request(actor, path, method, payload, version, key=f'proposal-fixture-{self.number:04d}')
        self.assertEqual(expected, status, result)
        return result.get('data', result)

    def post(self, kind, owner='coordinator', person=False, host=True):
        direct = kind == 'mou'
        data = dict(scopeId=SCOPE, kind=kind, source='direct' if direct else 'board', stage='contacted',
                    title='ห้องเรียนข้อมูลสมมติ', summary='เสนออบรมร่วมกับวิทยากร ติดต่อเบื้องต้นแล้ว',
                    hostSelf=host)
        if person:
            data.update(partnerType='person', partner='ศิษย์เก่าวิทยากร (สมมติ)')
        else:
            data.update(partnerType='existing', partnerId=PARTNER)
        if not direct:
            data.update(self.call(owner, '/api/proposals/deadline?days=1'))
        row = self.call(owner, '/api/proposals', 'POST', data, expected=201)
        self.path = '/api/proposals/' + row['id']
        return row

    def close(self, actor):
        self.f.now += 86400
        for name in list(self.f.cookies):
            self.f.login(name, name)
        return self.call(actor, self.path)

    def upload(self, actor, row, purpose):
        path = Path(__file__).resolve().parents[2] / 'proposals' / 'fixtures' / 'mou-demo-v1.pdf'
        payload = dict(fileName='fixture.pdf', displayName='เอกสารตัวอย่าง', contentType='application/pdf',
                       fileBase64=base64.b64encode(path.read_bytes()).decode(), audience='internal', containsPersonal=False)
        return self.call(actor, self.path + '/files/' + purpose, 'POST', payload, row['version'], 201)

    def approved(self):
        row = self.upload('coordinator', self.post('mou'), 'draft')
        row = self.call('coordinator', self.path + '/workflow', 'POST',
                        {'action': 'submit', 'revision': 1}, row['version'])
        self.call('executive', row['files'][0]['url'])
        row = self.call('executive', self.path + '/workflow', 'POST',
                        {'action': 'approve', 'revision': 1}, row['version'])
        self.assertEqual('signing', row['status'])
        self.assertNotIn('signed', row)
        self.assertNotIn('destination', row)
        return row

    def evidence(self, row):
        row = self.upload('coordinator', row, 'evidence')
        evidence = next(f['id'] for f in row['files'] if f['purpose'] == 'evidence')
        data = dict(revision=1, evidenceId=evidence, signedOn='2031-02-10',
                    startDate='2031-06-01', endDate='2031-11-30')
        return row, data

    def test_person_speaker_host_previews_and_creates_internal_activity_once(self):
        row = self.post('activity', person=True, host=False)
        self.call('multi', self.path + '/interest', 'PUT', {'interested': True})
        latest = self.call('multi', self.path)
        self.call('multi', self.path + '/host', 'PUT', {}, latest['version'])
        row = self.close('multi')
        preview = self.call('multi', self.path + '/destination')
        self.assertEqual(row['partner'], preview['partnerName'])
        self.assertEqual('', preview['partnerId'])
        self.assertIn(PARTNER, [p['id'] for p in preview['partners']])
        self.assertEqual(row['hostName'], preview['hostName'])
        self.assertFalse(self.call('coordinator', self.path + '/destination')['canCreate'])
        request = dict(mode='create', title=row['title'], partnerId=PARTNER, activityType='academic_activity')
        saved = self.call('multi', self.path + '/destination', 'POST', request, row['version'])
        replay = self.call('multi', self.path + '/destination', 'POST', request, row['version'])
        self.assertEqual(saved['destination'], replay['destination'])
        dest = self.call('multi', '/api/activities/' + saved['destination']['id'])
        self.assertEqual((row['id'], PARTNER, 'internal', [self.f.ids['multi']]),
                         (dest['proposalId'], dest['partnerId'], dest['publication'], dest['responsibleUserIds']))
        self.assertEqual(1, sum(r.get('proposalId') == row['id'] for r in self.f.db.rows.values()))
        # The board owner is a different, unassigned coordinator for this internal activity.
        self.assertNotIn('destination', self.call('coordinator', self.path))

    def test_exchange_double_confirmation_is_atomic_and_never_enrolls_its_helpers(self):
        row = self.post('exchange', owner='staff')
        self.call('multi', self.path + '/interest', 'PUT', {'interested': True, 'note': 'ช่วยจัดกิจกรรม'})
        self.assertFalse(self.call('staff', self.path + '/destination')['canCreate'])
        row = self.close('staff')
        before = {r['id'] for r in self.f.db.rows.values() if r['entityType'] == 'exchange'}
        request = dict(mode='create', title=row['title'], partnerId=PARTNER)
        self.f.login('second-browser', 'staff')
        original = self.f.app.repository.mutate
        arrived = Barrier(2)

        def rendezvous(*args, **kwargs):
            arrived.wait(timeout=5)
            return original(*args, **kwargs)

        with patch.object(self.f.app.repository, 'mutate', side_effect=rendezvous):
            with ThreadPoolExecutor(2) as pool:
                results = list(pool.map(lambda who: self.f.request(
                    who, self.path + '/destination', 'POST', request, row['version']), ('staff', 'second-browser')))
        self.assertEqual([200, 200], [status for status, _ in results], results)
        first, second = (result['data']['destination'] for _, result in results)
        self.assertEqual(first['id'], second['id'])
        record = self.call('staff', '/api/exchanges/' + first['id'])
        self.assertEqual(('draft', row['id']), (record['status'], record['proposalId']))
        self.assertEqual([], record.get('participantUserIds', []))
        self.assertEqual(1, len({r['id'] for r in self.f.db.rows.values() if r['entityType'] == 'exchange'} - before))
        self.assertFalse(any(r['entityType'] in {'admissionRound', 'application'} for r in self.f.db.rows.values()))

    def test_signature_uses_separate_evidence_and_approved_revision_then_creates_private_agreement(self):
        row, signature = self.evidence(self.approved())
        draft = next(f['id'] for f in row['files'] if f['purpose'] == 'draft')
        self.call('coordinator', self.path + '/signing', 'POST', dict(signature, evidenceId=draft), row['version'], 422)
        self.call('coordinator', self.path + '/signing', 'POST', dict(signature, revision=2), row['version'], 409)
        signed = self.call('coordinator', self.path + '/signing', 'POST', signature, row['version'])
        replay = self.call('coordinator', self.path + '/signing', 'POST', signature, row['version'])
        self.assertEqual(signed['version'], replay['version'])
        self.assertEqual(signed['signed'], self.call('executive', self.path)['signed'])
        self.assertEqual(1, sum(h['action'] == 'sign' for h in signed['history']))
        created = self.call('coordinator', self.path + '/destination', 'POST',
                            dict(mode='create', title=row['title'], partnerId=PARTNER), signed['version'])
        reference = created['destination']
        agreement = self.call('executive', '/api/agreements/' + reference['id'])
        self.assertEqual(('draft', 'internal', signature['startDate'], signature['endDate'], row['id']),
                         (agreement['status'], agreement['publication'], agreement['startDate'],
                          agreement['endDate'], agreement['proposalId']))
        self.assertNotIn('proposalId', self.call('staff', '/api/agreements/' + reference['id']))
        self.call('student-a', '/api/agreements/' + reference['id'], expected=404)

    def test_link_then_sign_checks_the_existing_register_version_and_existing_dates(self):
        row = self.approved()
        original = self.call('staff', '/api/agreements', 'POST', dict(
            scopeId=SCOPE, title='ทะเบียนข้อตกลงสมมติ', agreementType='MoU', partnerIds=[PARTNER],
            responsibleUserIds=[self.f.ids['coordinator']], publication='public',
            startDate='2031-01-01', endDate='2031-10-31'), expected=201)
        path = '/api/agreements/' + original['id']
        candidates = self.call('coordinator', self.path + '/destination')['agreements']
        self.assertIn(original['id'], [item['id'] for item in candidates])
        request = dict(mode='link', agreementId=original['id'], agreementVersion=original['version'])
        linked = self.call('coordinator', self.path + '/destination', 'POST', request, row['version'])
        self.assertEqual(original['id'], linked['destination']['id'])
        row, signature = self.evidence(linked)
        stale = dict(signature, agreementVersion=original['version'])
        self.call('coordinator', self.path + '/signing', 'POST', stale, row['version'], 409)
        signature['agreementVersion'] = row['destination']['version']
        reply = self.call('coordinator', self.path + '/signing', 'POST', signature, row['version'], 409)
        self.assertIn('AGREEMENT_DATES_CONFIRMATION_REQUIRED', str(reply))
        self.assertEqual(original['endDate'], self.call('staff', path)['endDate'])
        signature['confirmDates'] = True
        signed = self.call('coordinator', self.path + '/signing', 'POST', signature, row['version'])
        self.assertEqual('signed', signed['status'])
        after = self.call('coordinator', path)
        self.assertEqual((original['id'], original['publication'], original['status'], signature['endDate']),
                         (after['id'], after['publication'], after['status'], after['endDate']))
        self.assertEqual(row['id'], after['proposalId'])
        # A private direct submission is not discoverable via a public agreement.
        self.assertNotIn('proposalId', self.call('student-a', path))
        self.assertNotIn('proposalId', self.call('staff', path))
        self.assertNotIn('proposalId', self.call(None, '/api/public/agreements/' + original['id']))
