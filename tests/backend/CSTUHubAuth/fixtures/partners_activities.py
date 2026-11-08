"""Small fresh fixtures for #94-#97. Not a migration/seed command or live users."""
from backend.auth.session_service import SessionContext, UserState


def context(role='staff', scope='cs-demo', user='u-staff'):
    grants = () if role is None else ({'role': role, 'scopeId': scope, 'active': True},)
    return SessionContext(UserState(user, True, 1, True, grants=grants), 2000)


def records():
    def row(entity_type, key, **fields):
        return dict(id=key, entityType=entity_type, schemaVersion=3, scopeId='cs-demo',
                    version=1, createdAt='2026-10-11T00:00:00Z',
                    updatedAt='2026-10-11T00:00:00Z', createdBy='u-staff',
                    updatedBy='u-staff', **fields)
    return [
        row('partner', 'p-public', name='Demo Public Partner', type='university',
            summary='Synthetic public description', location='Bangkok',
            responsibleUserIds=['u-coordinator'], publication='public'),
        row('partner', 'p-internal', name='Demo Internal Partner', type='company',
            summary='Synthetic internal description', location='Bangkok',
            responsibleUserIds=['u-coordinator'], publication='internal'),
        row('activity', 'a-demo', title='Demo Activity', type='event', summary='Synthetic',
            partnerId='p-public', coHostPartnerIds=['p-internal'], agreementIds=['g-demo'],
            periodDate='2026-10-11', responsibleUserIds=['u-coordinator'], publication='internal'),
        row('contact', 'c-demo', partnerId='p-internal', name='Demo External Contact',
            email='contact@example.invalid'),
        row('history', 'h-demo', partnerId='p-internal', occurredOn='2026-10-11',
            kind='activity', note='Synthetic event', referenceType='activity',
            referenceId='a-demo', recordedBy='u-coordinator'),
        row('agreement', 'g-demo', title='Demo Agreement', agreementType='MoU',
            partnerIds=['p-public'], responsibleUserIds=['u-coordinator'], status='draft'),
    ]
