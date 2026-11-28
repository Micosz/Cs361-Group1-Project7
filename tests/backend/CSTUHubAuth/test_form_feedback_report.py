"""End-to-end backend tests for #264: file feedback linkage to report, MoU counts, and duplicate re-import."""
import csv
import io
import json
from pathlib import Path
import unittest

import test_workspace_storage as storage_tests

FIXTURES = Path(__file__).resolve().parents[2] / 'fixtures' / 'v7-feedback'


def load_csv_payload(filename, form_name, source_type):
    raw = (FIXTURES / filename).read_text(encoding='utf-8-sig')
    matrix = list(csv.reader(io.StringIO(raw)))
    header = matrix[0]
    # Select non-PII, non-timestamp columns (indices 2, 3, 4), matching form-feedback.js defaults.
    selected = [2, 3, 4]
    columns = [header[i] for i in selected]
    rows = []
    for idx, source in enumerate(matrix[1:]):
        answers = [source[i] if i < len(source) else '' for i in selected]
        if not any(a.strip() for a in answers):
            continue
        rows.append({
            'sourceRow': idx + 2,
            'answers': answers,
            'respondedAt': source[0] if source else '',
        })
    return {
        'formName': form_name,
        'sourceType': source_type,
        'fileName': filename,
        'sheetName': 'CSV',
        'columns': columns,
        'rows': rows,
    }


class FormFeedbackReportTests(unittest.TestCase):
    setUp = storage_tests.WorkspaceStorageTests.setUp
    call = storage_tests.WorkspaceStorageTests.call

    def setup_v7_partner_and_agreements(self):
        self.actor = 'staff'
        res, body = self.call('/api/partners', 'POST', dict(
            name='สถาบันพันธมิตรเทคโนโลยีดิจิทัล (สมมติ)',
            type='university',
            summary='คู่ความร่วมมือตัวอย่างสำหรับทดสอบ #263-#266',
            location='กรุงเทพมหานคร',
            scopeId='cs-demo',
            publication='public',
            responsibleUserIds=[self.ids['coordinator'], self.ids['staff']],
        ), key='v7-partner-create-264')
        self.assertEqual(201, res['statusCode'], body)
        partner = body['data']

        res, body = self.call('/api/agreements', 'POST', dict(
            title='MoU ฉบับที่ 1 — ความร่วมมือทางวิชาการและกิจกรรม AI',
            agreementType='MoU',
            scopeId='cs-demo',
            partnerIds=[partner['id']],
            startDate='2026-06-01',
            endDate='2027-05-31',
            responsibleUserIds=[self.ids['coordinator']],
        ), key='v7-mou1-create-264')
        self.assertEqual(201, res['statusCode'], body)
        mou1 = body['data']

        res, body = self.call('/api/agreements', 'POST', dict(
            title='MoA ฉบับที่ 2 — โครงการแลกเปลี่ยนวิจัยนักศึกษา',
            agreementType='MoA',
            scopeId='cs-demo',
            partnerIds=[partner['id']],
            startDate='2026-06-01',
            endDate='2027-05-31',
            responsibleUserIds=[self.ids['staff']],
        ), key='v7-mou2-create-264')
        self.assertEqual(201, res['statusCode'], body)
        mou2 = body['data']

        res, body = self.call('/api/activities', 'POST', dict(
            title='อบรมเชิงปฏิบัติการ AI ร่วมกับพันธมิตร',
            type='academic_activity',
            summary='กิจกรรมภายใต้ MoU ฉบับที่ 1',
            scopeId='cs-demo',
            partnerId=partner['id'],
            agreementIds=[mou1['id']],
            periodDate='2026-09-15',
            responsibleUserIds=[self.ids['coordinator']],
        ), key='v7-activity-create-264')
        self.assertEqual(201, res['statusCode'], body)
        activity = body['data']

        res, body = self.call('/api/exchanges', 'POST', dict(
            title='โครงการแลกเปลี่ยนวิจัยภาคฤดูร้อน',
            scopeId='cs-demo',
            partnerIds=[partner['id']],
            agreementId=mou2['id'],
            startDate='2026-10-01',
            endDate='2026-10-31',
            responsibleUserIds=[self.ids['staff']],
            participantUserIds=[self.ids['student-a']],
        ), key='v7-exchange-create-264')
        self.assertEqual(201, res['statusCode'], body)
        exchange = body['data']

        return partner, mou1, mou2, activity, exchange

    def test_import_traceability_permissions_unspecified_agreement_and_duplicate_reimport(self):
        partner, mou1, mou2, activity, exchange = self.setup_v7_partner_and_agreements()

        act_payload = load_csv_payload(
            'v7-activity-mou1-feedback.csv',
            'แบบประเมินกิจกรรม AI Workshop',
            'participant',
        )
        ex_payload = load_csv_payload(
            'v7-exchange-mou2-feedback.csv',
            'แบบประเมินโครงการแลกเปลี่ยนวิจัย',
            'participant',
        )
        legacy_payload = load_csv_payload(
            'v7-legacy-partner-only-feedback.csv',
            'ผลตอบรับย้อนหลังระดับองค์กรคู่ความร่วมมือ',
            'partner',
        )

        # 1st import across all three targets using existing form-feedback endpoints.
        self.actor = 'coordinator'
        act_res, act_body = self.call(
            f'/api/activities/{activity["id"]}/form-feedback',
            'POST', act_payload, key='import-1-activity-264',
        )
        self.assertEqual(201, act_res['statusCode'], act_body)
        act_batch = act_body['data']
        self.assertEqual(3, act_batch['responseCount'])
        self.assertEqual('linked', act_batch['agreementStatus'])
        self.assertEqual([mou1['id']], [a['id'] for a in act_batch['relatedAgreements']])

        self.actor = 'staff'
        ex_res, ex_body = self.call(
            f'/api/exchanges/{exchange["id"]}/form-feedback',
            'POST', ex_payload, key='import-1-exchange-264',
        )
        self.assertEqual(201, ex_res['statusCode'], ex_body)
        ex_batch = ex_body['data']
        self.assertEqual(2, ex_batch['responseCount'])
        self.assertEqual('linked', ex_batch['agreementStatus'])
        self.assertEqual([mou2['id']], [a['id'] for a in ex_batch['relatedAgreements']])

        leg_res, leg_body = self.call(
            f'/api/partners/{partner["id"]}/form-feedback',
            'POST', legacy_payload, key='import-1-partner-legacy-264',
        )
        self.assertEqual(201, leg_res['statusCode'], leg_body)
        leg_batch = leg_body['data']
        self.assertEqual(3, leg_batch['responseCount'])
        self.assertEqual('unspecified', leg_batch['agreementStatus'])
        self.assertEqual('ยังไม่ระบุข้อตกลง', leg_batch['agreementLabel'])
        self.assertEqual([], leg_batch['relatedAgreements'])

        # Snapshot counts after 1st import from Overview report and Inbox.
        self.actor = 'executive'
        ov1_res, ov1_body = self.call('/api/overview')
        self.assertEqual(200, ov1_res['statusCode'], ov1_body)
        ff1 = ov1_body['data']['formFeedback']
        by_agr_1 = {row['id']: row for row in ff1['byAgreement']}

        self.assertEqual(3, ff1['batchCount'])
        self.assertEqual(8, ff1['responseCount'])
        # Partner-only feedback shows "ยังไม่ระบุข้อตกลง" and NEVER increases MoU 1 or MoU 2 counts.
        self.assertEqual(1, by_agr_1[mou1['id']]['batchCount'])
        self.assertEqual(3, by_agr_1[mou1['id']]['responseCount'])
        self.assertEqual(1, by_agr_1[mou2['id']]['batchCount'])
        self.assertEqual(2, by_agr_1[mou2['id']]['responseCount'])
        self.assertEqual(
            {'label': 'ยังไม่ระบุข้อตกลง', 'batchCount': 1, 'responseCount': 3, 'commentCount': 0},
            ff1['unspecifiedAgreement'],
        )
        # Personal email column from CSV was excluded; no private fields leak in overview.
        self.assertNotIn('@example.invalid', json.dumps(ov1_body, ensure_ascii=False))
        self.assertNotIn('responsibleUserIds', json.dumps(ov1_body, ensure_ascii=False))

        # Agreement-specific filter on Overview isolates each MoU without partner-only feedback.
        mou1_ov = self.call(f'/api/overview?agreementId={mou1["id"]}')[1]['data']['formFeedback']
        self.assertEqual(3, mou1_ov['responseCount'])
        self.assertEqual(0, mou1_ov['unspecifiedAgreement']['responseCount'])
        mou2_ov = self.call(f'/api/overview?agreementId={mou2["id"]}')[1]['data']['formFeedback']
        self.assertEqual(2, mou2_ov['responseCount'])
        self.assertEqual(0, mou2_ov['unspecifiedAgreement']['responseCount'])

        # Traceability from report back to source batch & related work according to permissions:
        batches_by_id = {b['id']: b for b in ff1['batches']}
        self.assertEqual('v7-activity-mou1-feedback.csv', batches_by_id[act_batch['id']]['fileName'])
        self.assertEqual('ยังไม่ระบุข้อตกลง', batches_by_id[leg_batch['id']]['agreementLabel'])

        # Executive & Staff can follow report links to source answers and related work/MoU.
        src_res, src_body = self.call(f'/api/exchanges/{exchange["id"]}/form-feedback/{ex_batch["id"]}')
        self.assertEqual(200, src_res['statusCode'], src_body)
        self.assertEqual('v7-exchange-mou2-feedback.csv', src_body['data']['fileName'])
        self.assertEqual(2, len(src_body['data']['rows']))
        self.assertEqual(200, self.call(f'/api/exchanges/{exchange["id"]}')[0]['statusCode'])
        self.assertEqual(200, self.call(f'/api/agreements/{mou2["id"]}')[0]['statusCode'])

        # Coordinator permissions: can trace all 3 batches in shared inbox & read source answers,
        # can open assigned Activity & MoU 1, but CANNOT open unassigned Exchange or MoU 2 (nor leak MoU 2 title).
        self.actor = 'coordinator'
        self.assertEqual(403, self.call('/api/overview')[0]['statusCode'])
        inbox_res, inbox_body = self.call('/api/form-feedback?limit=20')
        self.assertEqual(200, inbox_res['statusCode'], inbox_body)
        inbox_by_id = {b['id']: b for b in inbox_body['data']}
        self.assertEqual(3, len(inbox_by_id))
        self.assertTrue(inbox_by_id[act_batch['id']]['canReadParent'])
        self.assertEqual([mou1['id']], [a['id'] for a in inbox_by_id[act_batch['id']]['relatedAgreements']])
        self.assertFalse(inbox_by_id[ex_batch['id']]['canReadParent'])
        self.assertEqual([], inbox_by_id[ex_batch['id']]['relatedAgreements'])
        self.assertNotIn(mou2['title'], json.dumps(inbox_body, ensure_ascii=False))
        self.assertEqual('ยังไม่ระบุข้อตกลง', inbox_by_id[leg_batch['id']]['agreementLabel'])
        # Shared inbox search finds "ยังไม่ระบุข้อตกลง" and source filename.
        unspec_search = self.call('/api/form-feedback?q=ยังไม่ระบุข้อตกลง')[1]
        self.assertEqual([leg_batch['id']], [r['id'] for r in unspec_search['data']])
        # Coordinator can still read source answers of ex_batch via shared read (#206), but parent Exchange & MoU 2 return 404.
        self.assertEqual(200, self.call(f'/api/exchanges/{exchange["id"]}/form-feedback/{ex_batch["id"]}')[0]['statusCode'])
        self.assertEqual(200, self.call(f'/api/activities/{activity["id"]}')[0]['statusCode'])
        self.assertEqual(200, self.call(f'/api/agreements/{mou1["id"]}')[0]['statusCode'])
        self.assertEqual(404, self.call(f'/api/exchanges/{exchange["id"]}')[0]['statusCode'])
        self.assertEqual(404, self.call(f'/api/agreements/{mou2["id"]}')[0]['statusCode'])

        # Student & unroled employee are denied internal form feedback and overview.
        for denied_actor in ('student-a', 'employee'):
            self.actor = denied_actor
            self.assertEqual(403, self.call('/api/overview')[0]['statusCode'])
            self.assertIn(self.call('/api/form-feedback')[0]['statusCode'], (403, 404))
            self.assertIn(self.call(f'/api/activities/{activity["id"]}/form-feedback/{act_batch["id"]}')[0]['statusCode'], (403, 404))

        # 2nd import of the exact same files (both same retry key AND fresh import / renamed file):
        self.actor = 'coordinator'
        retry_same_key = self.call(
            f'/api/activities/{activity["id"]}/form-feedback',
            'POST', act_payload, key='import-1-activity-264',
        )
        self.assertEqual(201, retry_same_key[0]['statusCode'])
        self.assertEqual(act_batch['id'], retry_same_key[1]['data']['id'])

        dup_act = self.call(
            f'/api/activities/{activity["id"]}/form-feedback',
            'POST', dict(act_payload, fileName='copy-of-' + act_payload['fileName']),
            key='import-2-activity-264',
        )
        self.assertEqual(409, dup_act[0]['statusCode'], dup_act[1])
        self.assertEqual('DUPLICATE_FORM_IMPORT', dup_act[1]['error']['code'])

        self.actor = 'staff'
        dup_ex = self.call(
            f'/api/exchanges/{exchange["id"]}/form-feedback',
            'POST', ex_payload, key='import-2-exchange-264',
        )
        self.assertEqual(409, dup_ex[0]['statusCode'], dup_ex[1])
        self.assertEqual('DUPLICATE_FORM_IMPORT', dup_ex[1]['error']['code'])

        dup_leg = self.call(
            f'/api/partners/{partner["id"]}/form-feedback',
            'POST', legacy_payload, key='import-2-partner-legacy-264',
        )
        self.assertEqual(409, dup_leg[0]['statusCode'], dup_leg[1])
        self.assertEqual('DUPLICATE_FORM_IMPORT', dup_leg[1]['error']['code'])

        # Compare counts after 1st import vs after 2nd import: MUST BE IDENTICAL.
        self.actor = 'executive'
        ov2_res, ov2_body = self.call('/api/overview')
        self.assertEqual(200, ov2_res['statusCode'], ov2_body)
        ff2 = ov2_body['data']['formFeedback']
        by_agr_2 = {row['id']: row for row in ff2['byAgreement']}

        first_totals = {
            'batchCount': ff1['batchCount'],
            'responseCount': ff1['responseCount'],
            'mou1Responses': by_agr_1[mou1['id']]['responseCount'],
            'mou2Responses': by_agr_1[mou2['id']]['responseCount'],
            'unspecifiedResponses': ff1['unspecifiedAgreement']['responseCount'],
        }
        second_totals = {
            'batchCount': ff2['batchCount'],
            'responseCount': ff2['responseCount'],
            'mou1Responses': by_agr_2[mou1['id']]['responseCount'],
            'mou2Responses': by_agr_2[mou2['id']]['responseCount'],
            'unspecifiedResponses': ff2['unspecifiedAgreement']['responseCount'],
        }
        self.assertEqual({'batchCount': 3, 'responseCount': 8, 'mou1Responses': 3, 'mou2Responses': 2, 'unspecifiedResponses': 3}, first_totals)
        self.assertEqual(first_totals, second_totals)


if __name__ == '__main__':
    unittest.main()
