"""Playwright JSON-RPC backend driver for #264 browser verification (offline AWS doubles only)."""

import json
import sys
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / 'backend/lambda/CSTUHubAuth'), str(ROOT / 'tests/backend/CSTUHubAuth')]

from backend.auth.session_service import COOKIE_NAME
from backend.permissions.transactions import values
from support.mock_auth import SCOPE, make_app

BASE_CLOCK = 1790000000  # 2026-09-21T13:33:20Z


class V7FeedbackFixture:
    def __init__(self):
        self.app, users = make_app(4173, writable=True)
        self.ids = {u['username']: u['id'] for u in users}
        self.now = BASE_CLOCK
        self.app.sessions.clock = self.app.repository.clock = lambda: self.now
        self.db = self.app.repository.client
        self.db.rows.clear()
        self.cookies = {}
        self.catalog = []

        def add(row):
            row.update(
                scopeId=SCOPE,
                scopeEntity=SCOPE + '#' + row['entityType'],
                version=1,
                schemaVersion=3,
                createdAt='2026-09-01T09:00:00+00:00',
                updatedAt='2026-09-01T09:00:00+00:00',
            )
            self.db.rows[row['id']] = row
            return row

        partner = add(dict(
            id='partner-v7-demo',
            entityType='partner',
            name='สถาบันพันธมิตรเทคโนโลยีดิจิทัล (สมมติ)',
            type='university',
            summary='คู่ความร่วมมือตัวอย่างสำหรับทดสอบความเชื่อมโยงผลตอบรับและข้อตกลง (#264)',
            fullDescription='องค์กรคู่ความร่วมมือจำลองที่มีข้อตกลง 2 ฉบับ สำหรับทดสอบกิจกรรม โครงการแลกเปลี่ยน และผลตอบรับย้อนหลัง',
            location='กรุงเทพมหานคร',
            publication='public',
            visibility='public',
            access_level='public',
            responsibleUserIds=[self.ids['coordinator'], self.ids['staff']],
        ))
        self.catalog.append(dict(
            id=partner['id'],
            name=partner['name'],
            type='university',
            summary=partner['summary'],
            full_description=partner['fullDescription'],
            location=partner['location'],
            visibility='public',
            access_level='public',
        ))

        mou1 = add(dict(
            id='mou-v7-1',
            entityType='agreement',
            title='MoU ฉบับที่ 1 — ความร่วมมือทางวิชาการและกิจกรรม AI',
            agreementType='MoU',
            partnerIds=[partner['id']],
            status='active',
            startDate='2026-06-01',
            endDate='2027-05-31',
            publication='internal',
            responsibleUserIds=[self.ids['coordinator']],
        ))

        moa2 = add(dict(
            id='moa-v7-2',
            entityType='agreement',
            title='MoA ฉบับที่ 2 — โครงการแลกเปลี่ยนวิจัยนักศึกษา',
            agreementType='MoA',
            partnerIds=[partner['id']],
            status='active',
            startDate='2026-06-01',
            endDate='2027-05-31',
            publication='internal',
            responsibleUserIds=[self.ids['staff']],
        ))

        act = add(dict(
            id='act-v7-mou1',
            entityType='activity',
            title='อบรมเชิงปฏิบัติการ AI ร่วมกับพันธมิตร',
            type='academic_activity',
            summary='กิจกรรมเชิงปฏิบัติการภายใต้ข้อตกลง MoU ฉบับที่ 1',
            fullDescription='กิจกรรมร่วมสอนและฝึกปฏิบัติโจทย์ AI ภายใต้ MoU ฉบับที่ 1',
            partnerId=partner['id'],
            coHostPartnerIds=[],
            agreementIds=[mou1['id']],
            periodDate='2026-09-15',
            publication='public',
            visibility='public',
            access_level='public',
            responsibleUserIds=[self.ids['coordinator']],
        ))
        self.catalog.append(dict(
            id=act['id'],
            title=act['title'],
            type=act['type'],
            partnerId=partner['id'],
            partnerName=partner['name'],
            period_date=act['periodDate'],
            summary=act['summary'],
            full_description=act['fullDescription'],
            visibility='public',
            access_level='public',
        ))

        add(dict(
            id='ex-v7-moa2',
            entityType='exchange',
            title='โครงการแลกเปลี่ยนวิจัยภาคฤดูร้อน',
            partnerIds=[partner['id']],
            agreementId=moa2['id'],
            status='ongoing',
            startDate='2026-10-01',
            endDate='2026-10-31',
            supportingInfo='ข้อมูลภายในโครงการแลกเปลี่ยนภายใต้ MoA ฉบับที่ 2 (สมมติ)',
            supportingInfoForParticipant='กำหนดการสำหรับนักศึกษาผู้เข้าร่วมแลกเปลี่ยน (สมมติ)',
            responsibleUserIds=[self.ids['staff']],
            participantUserIds=[self.ids['student-a']],
        ))

        def scan(**kwargs):
            rows = list(self.db.rows.values())
            kinds = kwargs.get('ExpressionAttributeValues', {})
            if ':kind' in kinds:
                rows = [r for r in rows if r.get('entityType') == kinds[':kind']['S']]
            return {'Items': [values(r) for r in rows]}

        self.db.scan = scan

    def seed_term(self):
        """Synthetic term from docs/evidence/v7-expected-results.md, isolated per test."""
        self.now = 1805587200  # 2027-03-21 UTC, when Staff imports the responses.
        rows = self.db.rows
        base = rows['act-v7-mou1']
        base['periodDate'] = '2026-12-10'
        for key, title, day in [('act-term-talk', 'เวทีแลกเปลี่ยนผลงาน', '2027-02-15'),
                                ('act-outside-term', 'กิจกรรมก่อนเปิดเทอม', '2026-06-20')]:
            rows[key] = dict(base, id=key, title=title, periodDate=day)
        exchange = rows['ex-v7-moa2']
        exchange.update(startDate='2027-01-05', endDate='2027-03-20')
        for rid, students in [('round-term', [('student-a', True), ('student-b', True), ('student-pending', False)]),
                              ('round-repeat', [('student-a', True)])]:
            rows[rid] = dict(id=rid, scopeId=SCOPE, scopeEntity=SCOPE + '#exchangeRound', entityType='exchangeRound',
                             exchangeId=exchange['id'], version=1)
            for student, enrolled in students:
                key = rid + '-' + student
                rows[key] = dict(id=key, scopeId=SCOPE, scopeEntity=rid + '#exchangeApplication',
                                 entityType='exchangeApplication', roundId=rid, studentId=student, version=1,
                                 decision='passed', publishedAt=1798502400, studentName='ชื่อผู้สมัครจำลองสำหรับตรวจการแสดงผล')
                if enrolled:
                    rows[key].update(confirmedAt=1798588800, partnerAcceptedAt=1798675200, enrolledAt=1798675200)
        for key, kind, parent, day, topic in [
            ('comment-term', 'activity', base['id'], '2026-12-11', 'ส่งกำหนดการอบรมให้ผู้เข้าร่วมล่วงหน้า'),
            ('comment-partner', 'partner', 'partner-v7-demo', '2027-01-10', 'นัดทบทวนความร่วมมือประจำปี')]:
            rows[key] = dict(id=key, scopeId=SCOPE, scopeEntity=SCOPE + '#feedback', entityType='feedback',
                             parentType=kind, parentId=parent, occurredOn=day, sourceType='partner', version=1,
                             comment='ความคิดเห็นจากชุดสาธิต', improvement=topic,
                             respondentName='ชื่อผู้ตอบจำลองสำหรับตรวจการแสดงผล')
        return True

    def login(self, client, username):
        user = self.app.sessions.users.get(self.ids[username])
        self.cookies[client] = self.app.sessions._issue(user).token
        return True

    def request(self, client, path, method='GET', body=None, request_headers=None):
        parsed = urlsplit(path)
        token = self.cookies.get(client)
        hdr = {k.lower(): v for k, v in (request_headers or {}).items()}
        hdr['origin'] = self.app.sessions.policy.origin
        raw_body = body if isinstance(body, str) else json.dumps(body or {}, ensure_ascii=False)
        event = dict(
            version='2.0',
            rawPath=parsed.path,
            requestContext={'http': {'method': method, 'sourceIp': '127.0.0.1'}},
            queryStringParameters=dict(parse_qsl(parsed.query)),
            headers=hdr,
            cookies=[COOKIE_NAME + '=' + token] if token else [],
            body=raw_body,
        )
        reply = self.app.handle(event)
        for cookie in reply.get('cookies', []):
            head = cookie.split(';')[0]
            if head.startswith(COOKIE_NAME + '='):
                val = head.split('=', 1)[1]
                if val:
                    self.cookies[client] = val
                else:
                    self.cookies.pop(client, None)
        if reply.get('isBase64Encoded'):
            data = {'bodyBase64': reply['body'], 'headers': reply['headers']}
        else:
            data = json.loads(reply['body']) if reply.get('body') else {}
        return [reply['statusCode'], data]


fixture = V7FeedbackFixture()
for line in sys.stdin:
    if not line.strip():
        continue
    cmd = json.loads(line)
    try:
        op = cmd['op']
        if op == 'login':
            res = fixture.login(cmd['client'], cmd['user'])
        elif op == 'seed_term':
            res = fixture.seed_term()
        elif op == 'catalog':
            res = fixture.catalog
        elif op == 'clock':
            fixture.now = BASE_CLOCK + int(cmd.get('offset', 0))
            res = fixture.now
        elif op == 'request':
            res = fixture.request(
                cmd['client'],
                cmd['path'],
                cmd['method'],
                cmd.get('body'),
                cmd.get('headers'),
            )
        else:
            raise ValueError('Unknown op: ' + str(op))
        print(json.dumps({'id': cmd['id'], 'result': res}, ensure_ascii=False), flush=True)
    except Exception as err:
        print(json.dumps({'id': cmd['id'], 'error': repr(err)}), flush=True)
