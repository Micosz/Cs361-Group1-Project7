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

    def test_count_enrolled_once_across_projects_and_rounds_and_exclude_pending_partner(self):
        from backend.admissions import enrolled_student_count
        scope = 'cs-demo'
        store = self.repository.client.rows
        for key, project_id, states in [
            ('round-one', 'project-one', [('one', True), ('two', True), ('waiting', False)]),
            ('round-two', 'project-two', [('one', True), ('three', True)]),
            ('round-other', 'unselected', [('other', True)])]:
            store[key] = dict(id=key, entityType='exchangeRound', scopeId=scope,
                              scopeEntity=scope + '#exchangeRound', exchangeId=project_id)
            for uid, enrolled in states:
                aid = key + uid
                row = dict(id=aid, entityType='exchangeApplication', roundId=key, scopeId=scope,
                           scopeEntity=key + '#exchangeApplication', studentId=uid, confirmedAt=10)
                if enrolled:
                    row['enrolledAt'] = 20
                store[aid] = row
        projects = [dict(id=key, scopeId=scope) for key in ['project-one', 'project-two']]
        self.assertEqual(2, enrolled_student_count(self.repository, projects[:1]))
        self.assertEqual(3, enrolled_student_count(self.repository, projects))
        self.assertEqual(0, enrolled_student_count(self.repository, []))

    def test_overview_agreement_status_filter_aligns_totals_breakdown_and_batches(self):
        partner, mou1, mou2, activity, exchange = self.setup_v7_partner_and_agreements()

        # Activate MoU 1 ("มีผล") while leaving MoA 2 in "draft" ("ร่าง").
        self.actor = 'staff'
        st_res, st_body = self.call(
            f'/api/agreements/{mou1["id"]}/status',
            'POST', {'to': 'active'}, version=mou1['version'],
        )
        self.assertEqual(200, st_res['statusCode'], st_body)

        act_payload = load_csv_payload(
            'v7-activity-mou1-feedback.csv',
            'แบบประเมินกิจกรรม AI Workshop',
            'participant',
        )
        self.actor = 'coordinator'
        act_res, act_body = self.call(
            f'/api/activities/{activity["id"]}/form-feedback',
            'POST', act_payload, key='status-filter-activity-264',
        )
        self.assertEqual(201, act_res['statusCode'], act_body)

        # Executive filters by "expired" ("หมดอายุ"): 0 total, 0 breakdown, no source file in batches.
        self.actor = 'executive'
        exp_res, exp_body = self.call('/api/overview?status=expired')
        self.assertEqual(200, exp_res['statusCode'], exp_body)
        exp_ff = exp_body['data']['formFeedback']
        self.assertEqual(0, exp_ff['batchCount'])
        self.assertEqual(0, exp_ff['responseCount'])
        self.assertEqual([], exp_ff['byAgreement'])
        self.assertEqual(0, exp_ff['unspecifiedAgreement']['responseCount'])
        self.assertEqual([], exp_ff['batches'])
        self.assertEqual({}, exp_ff['bySource'])

        # Executive filters by "active" ("มีผล"): file returns and totals/breakdown all equal 3.
        act_ov_res, act_ov_body = self.call('/api/overview?status=active')
        self.assertEqual(200, act_ov_res['statusCode'], act_ov_body)
        act_ff = act_ov_body['data']['formFeedback']
        self.assertEqual(1, act_ff['batchCount'])
        self.assertEqual(3, act_ff['responseCount'])
        self.assertEqual([mou1['id']], [row['id'] for row in act_ff['byAgreement']])
        self.assertEqual(3, act_ff['byAgreement'][0]['responseCount'])
        self.assertEqual(0, act_ff['unspecifiedAgreement']['responseCount'])
        self.assertEqual(1, len(act_ff['batches']))
        self.assertEqual('v7-activity-mou1-feedback.csv', act_ff['batches'][0]['fileName'])
        self.assertEqual({'participant': 3}, act_ff['bySource'])

        # Also verify Exchange feedback under an active MoA appears under status=active and disappears under status=expired.
        self.actor = 'staff'
        st2_res, st2_body = self.call(
            f'/api/agreements/{mou2["id"]}/status',
            'POST', {'to': 'active'}, version=mou2['version'],
        )
        self.assertEqual(200, st2_res['statusCode'], st2_body)
        upd_ex_res, upd_ex_body = self.call(
            f'/api/exchanges/{exchange["id"]}',
            'PATCH', {'endDate': '2027-03-31'}, version=exchange['version'],
        )
        self.assertEqual(200, upd_ex_res['statusCode'], upd_ex_body)
        ex_st_res, ex_st_body = self.call(
            f'/api/exchanges/{exchange["id"]}/status',
            'POST', {'to': 'ongoing'}, version=upd_ex_body['data']['version'],
        )
        self.assertEqual(200, ex_st_res['statusCode'], ex_st_body)
        ex_payload = load_csv_payload(
            'v7-exchange-mou2-feedback.csv',
            'แบบประเมินโครงการแลกเปลี่ยนวิจัย',
            'participant',
        )
        ex_res, ex_body = self.call(
            f'/api/exchanges/{exchange["id"]}/form-feedback',
            'POST', ex_payload, key='status-filter-exchange-264',
        )
        self.assertEqual(201, ex_res['statusCode'], ex_body)

        self.actor = 'executive'
        both_active = self.call('/api/overview?status=active')[1]['data']['formFeedback']
        self.assertEqual(2, both_active['batchCount'])
        self.assertEqual(5, both_active['responseCount'])
        by_agr = {row['id']: row['responseCount'] for row in both_active['byAgreement']}
        self.assertEqual({mou1['id']: 3, mou2['id']: 2}, by_agr)
        self.assertEqual(2, len(both_active['batches']))
        ongoing = self.call('/api/overview?status=ongoing')[1]['data']
        self.assertEqual(1, ongoing['exchanges']['count'])
        self.assertEqual(2, ongoing['formFeedback']['responseCount'])
        self.assertEqual([mou2['id']], [row['id'] for row in ongoing['formFeedback']['byAgreement']])
        self.assertEqual([ex_body['data']['id']],
                         [row['id'] for row in ongoing['formFeedback']['batches']])
        self.assertEqual(0, self.call('/api/overview?status=completed')[1]['data']['formFeedback']['responseCount'])
        both_expired = self.call('/api/overview?status=expired')[1]['data']['formFeedback']
        self.assertEqual(0, both_expired['batchCount'])
        self.assertEqual(0, both_expired['responseCount'])
        self.assertEqual([], both_expired['batches'])


if __name__ == '__main__':
    unittest.main()
