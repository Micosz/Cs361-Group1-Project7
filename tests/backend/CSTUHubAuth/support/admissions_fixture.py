"""Synthetic TU users and an isolated recording DynamoDB double for the admissions journeys."""

import json
import hashlib
from pathlib import Path
from datetime import datetime, timezone
from urllib.parse import parse_qsl, urlsplit

from backend.auth.session_service import COOKIE_NAME
from backend.permissions.transactions import values
from support.mock_auth import SCOPE, make_app

BASE = 1927792800  # Fixture clock only.
PROJECT, SECOND, OLD = 'project-water', 'project-forest', 'project-original'
ACTIVITY, NEXT, ORDINARY = 'act-water', 'act-forest', 'act-ordinary'
PARTNER = 'campus-demo'


def iso(t):
    return datetime.fromtimestamp(t, timezone.utc).isoformat()


class Fixture:
    def __init__(self):
        self.app, users = make_app(8765, writable=True)
        self.ids = {u['username']: u['id'] for u in users}
        self.now = BASE
        self.app.sessions.clock = self.app.repository.clock = lambda: self.now
        self.db = self.app.repository.client
        self.db.rows.clear()
        self.cookies = {}
        self.catalog = []

        def add(row):
            row.update(scopeId=SCOPE, scopeEntity=SCOPE + '#' + row['entityType'], version=1, schemaVersion=3)
            self.db.rows[row['id']] = row
            return row

        org = add(
            dict(
                id=PARTNER,
                entityType='partner',
                name='มหาวิทยาลัยลำน้ำ (สมมติ)',
                type='university',
                publication='public',
            )
        )
        self.catalog.append(dict(id=org['id'], name=org['name'], type='university', visibility='public'))
        for key, title in [
            (ACTIVITY, 'แลกเปลี่ยนลุ่มน้ำ (สมมติ)'),
            (NEXT, 'แลกเปลี่ยนป่าชุมชน (สมมติ)'),
            (ORDINARY, 'สัมมนาทั่วไป (สมมติ)'),
        ]:
            add(
                dict(
                    id=key,
                    entityType='activity',
                    title=title,
                    type='academic_activity',
                    publication='public',
                    partnerId=PARTNER,
                    coHostPartnerIds=[],
                    responsibleUserIds=[self.ids['coordinator']],
                )
            )
            self.catalog.append(
                dict(
                    id=key,
                    title=title,
                    type='academic_activity',
                    visibility='public',
                    partnerId=PARTNER,
                    summary='กิจกรรมสำหรับทดสอบด้วยข้อมูลสมมติ',
                )
            )
        guide = (
            Path(__file__).resolve().parents[3] / 'exchange-admissions' / 'participant-guide.pdf'
        ).read_bytes()
        for key, title in [
            (PROJECT, 'โครงการลุ่มน้ำ (สมมติ)'),
            (SECOND, 'โครงการป่าชุมชน (สมมติ)'),
            (OLD, 'โครงการเดิม (สมมติ)'),
        ]:
            add(
                dict(
                    id=key,
                    entityType='exchange',
                    title=title,
                    partnerIds=[PARTNER],
                    status='ongoing',
                    responsibleUserIds=[self.ids['coordinator']],
                    participantUserIds=[self.ids['multi']],
                    supportingInfoForParticipant='กำหนดการสำหรับผู้เข้าร่วม (สมมติ)',
                )
            )
            document = add(
                dict(
                    id='doc-' + key,
                    entityType='document',
                    parentType='exchange',
                    parentId=key,
                    displayName='คู่มือผู้เข้าร่วม (สมมติ)',
                    audience='participants',
                    containsPersonal=False,
                    mime='application/pdf',
                    size=len(guide),
                    hash=hashlib.sha256(guide).hexdigest(),
                    objectKey='fixture-documents/' + key + '.pdf',
                    uploadState='ready',
                )
            )
            self.app.repository.documents.put(document, guide)

        def scan(**kwargs):
            rows = list(self.db.rows.values())
            kinds = kwargs.get('ExpressionAttributeValues', {})
            if ':kind' in kinds:
                rows = [r for r in rows if r.get('entityType') == kinds[':kind']['S']]
            return {'Items': [values(r) for r in rows]}

        self.db.scan = scan

    def round_data(self, **change):
        data = dict(
            activityId=ACTIVITY,
            partnerId=PARTNER,
            title='รอบลุ่มน้ำ (สมมติ)',
            eligibility='นักศึกษาในหลักสูตรตามประกาศสมมติ',
            capacity=2,
            channel='department',
            opensAt=iso(BASE + 60),
            closesAt=iso(BASE + 180),
            resultsAt=iso(BASE + 240),
            noticeEndsAt=iso(BASE + 420),
            confirmBy=iso(BASE + 600),
            needsConfirmation=True,
            needsPartner=False,
            question='หัวข้อที่สนใจศึกษา',
        )
        return dict(data, **change)

    def login(self, label, username):
        user = self.app.sessions.users.get(self.ids[username])
        self.cookies[label] = self.app.sessions._issue(user).token

    def request(
        self,
        client,
        path,
        method='GET',
        payload=None,
        version=None,
        key='fixture-key-00000001',
        request_headers=None,
    ):
        parsed = urlsplit(path)
        token = self.cookies.get(client)
        if request_headers is None:
            # API-level tests send the CSRF proof of their own synthetic session.
            csrf = self.app.sessions.state(token)['csrfToken'] if token else ''
            request_headers = {'x-csrf-token': csrf, 'idempotency-key': key}
        hdr = {**request_headers, 'origin': self.app.sessions.policy.origin}
        if version is not None:
            hdr['if-match'] = '"' + str(version) + '"'
        event = dict(
            version='2.0',
            rawPath=parsed.path,
            requestContext={'http': {'method': method, 'sourceIp': '127.0.0.1'}},
            queryStringParameters=dict(parse_qsl(parsed.query)),
            headers=hdr,
            cookies=[COOKIE_NAME + '=' + token] if token else [],
            body=json.dumps(payload or {}),
        )
        reply = self.app.handle(event)
        for cookie in reply.get('cookies', []):
            head = cookie.split(';')[0]
            if head.startswith(COOKIE_NAME + '='):
                self.cookies[client] = head.split('=', 1)[1]
        if reply.get('isBase64Encoded'):
            data = {'bodyBase64': reply['body'], 'headers': reply['headers']}
        else:
            data = json.loads(reply['body']) if reply.get('body') else {}
        return reply['statusCode'], data
