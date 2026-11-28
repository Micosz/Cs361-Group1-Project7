"""Exchange admissions. Applications are private to their owner and project managers."""

from datetime import datetime, timezone
import re

from . import admission_rounds as rounds
from .admission_store import indexed, save
from .auth.require_session import require_session
from .auth.session_service import AuthError
from .http_api import headers, response
from .permissions.gateway import body
from .permissions.policy import allowed_roles, require_assignee

ROUTES = re.compile(
    r'/api/(?:public/activities/(?P<public>[^/]+)/admission-rounds'
    r'|activities/(?P<activity>[^/]+)/admission-projects'
    r'|exchanges/(?P<project>[^/]+)/admission-rounds'
    r'|me/(?P<personal>admission-applications)'
    r'|admission-rounds/(?P<round>round-[0-9a-f]{64})/'
    r'(?P<resource>mine(?:/confirm)?|applications)(?:/(?P<app>application-[0-9a-f]{64}))?)'
)


def missing():
    raise AuthError('NOT_FOUND', 404)


def method_is(actual, *expected):
    if actual not in expected:
        raise AuthError('METHOD_NOT_ALLOWED', 405)


def applicant(accounts, user, scope=None):
    if (
        not user
        or not user.active
        or not user.identity_verified
        or user.account_type != 'tu'
        or not any(
            g['role'] == 'student' and (scope is None or g['scopeId'] == scope) for g in user.permissions()[0]
        )
    ):
        raise AuthError('STUDENT_REQUIRED', 403)
    account = accounts.store.user(user.user_id)
    if not account or account.get('authProvider') != 'tu' or account.get('tuType') != 'student':
        raise AuthError('STUDENT_REQUIRED', 403)


def enrolled_student_count(repo, exchanges):
    """Count distinct completed admissions for projects already scoped by the report."""
    by_scope = {}
    for project in exchanges:
        by_scope.setdefault(project['scopeId'], set()).add(project['id'])
    students = set()
    for scope, projects in by_scope.items():
        for admission in indexed(repo, scope + '#' + rounds.ROUND, rounds.ROUND):
            if admission.get('scopeId') != scope or admission.get('exchangeId') not in projects:
                continue
            rid = admission['id']
            for row in indexed(repo, rid + '#' + rounds.APPLICATION, rounds.APPLICATION):
                if (row.get('scopeId') == scope and row.get('roundId') == rid
                        and row.get('enrolledAt') is not None and row.get('studentId')):
                    students.add(row['studentId'])
    return len(students)


def own_id(round_id, user_id):
    return rounds.identifier('application', round_id, user_id)


def own_view(row, admission, now):
    if not row:
        return None
    published = row.get('publishedAt') is not None
    if published and row['decision'] == 'declined' and now >= admission['noticeEndsAt']:
        return None
    view = {
        'roundId': admission['id'],
        'roundTitle': admission['title'],
        'activityId': admission['activityId'],
        'resultsAt': admission['resultsAt'],
        'noticeEndsAt': admission['noticeEndsAt'],
        'state': row['progress'],
        'submittedAt': row['submittedAt'],
    }
    if not published:
        if row['progress'] == 'information':
            view['information'] = row['information']
        return view
    view['publishedAt'] = row['publishedAt']
    if row['decision'] == 'declined':
        view['state'] = 'declined'
    elif row.get('enrolledAt') is not None:
        view.update(state='enrolled', exchangeId=admission['exchangeId'])
    elif admission['needsConfirmation'] and row.get('confirmedAt') is None:
        view.update(
            state='confirm' if now < admission['confirmBy'] else 'confirmationClosed',
            confirmBy=admission['confirmBy'],
        )
    else:
        view['state'] = 'awaitingPartner'
    return view


def roster_view(row):
    keys = (
        'id',
        'studentName',
        'answer',
        'submittedAt',
        'progress',
        'information',
        'decision',
        'decisionAt',
        'publishedAt',
        'confirmedAt',
        'partnerAcceptedAt',
        'enrolledAt',
        'version',
    )
    return {k: row[k] for k in keys if k in row}


def checked_round(repo, rid):
    item = repo.get(rounds.ROUND, rid)
    if not item:
        missing()
    project = repo.get('exchange', item['exchangeId'])
    if not project or item['scopeId'] != project.get('scopeId'):
        missing()
    return item, project


def submit(repo, event, ctx, admission, project, current):
    payload = body(event)
    if set(payload) - {'answer'}:
        raise AuthError('INVALID_FIELDS', 422)
    if current:
        view = own_view(current, admission, int(repo.clock()))
        if view:
            return view
        raise AuthError('ROUND_CLOSED', 409)
    if admission['channel'] != 'department' or project.get('status') in {'completed', 'cancelled'}:
        raise AuthError('ROUND_CLOSED', 409)
    answer = rounds.text_field(payload.get('answer', ''), 1200, bool(admission['question']))
    if answer and not admission['question']:
        raise AuthError('INVALID_FIELDS', 422)
    activity = repo.get('activity', admission['activityId'])
    refs = rounds.public_references(repo, project, activity, admission['partnerId'])
    if not refs:
        missing()
    uid = ctx.user.user_id
    row = dict(
        id=own_id(admission['id'], uid),
        entityType=rounds.APPLICATION,
        scopeEntity=admission['id'] + '#' + rounds.APPLICATION,
        scopeId=admission['scopeId'],
        roundId=admission['id'],
        studentId=uid,
        studentName=ctx.user.display_name,
        progress='submitted',
        answer=answer,
        submittedAt=int(repo.clock()),
        version=1,
    )
    owner_link = dict(
        id=rounds.identifier('application-owner', row['id']),
        entityType=rounds.OWNER_LINK,
        scopeEntity=uid + '#' + rounds.OWNER_LINK,
        scopeId=admission['scopeId'],
        roundId=admission['id'],
        studentId=uid,
        version=1,
    )
    save(
        repo,
        event,
        ctx.user,
        admission['scopeId'],
        guards=[admission, project, *refs],
        changes=[(None, row), (None, owner_link)],
        window=(admission['opensAt'], admission['closesAt'], 'ROUND_CLOSED'),
    )
    return own_view(row, admission, int(repo.clock()))


def check_version(event, row):
    value = headers(event).get('if-match')
    if value is None:
        raise AuthError('PRECONDITION_REQUIRED', 428)
    if value != '"' + str(row['version']) + '"':
        raise AuthError('VERSION_CONFLICT', 409)


def progress_change(payload, row, admission, now):
    action = payload.get('action')
    fields = {'review': set(), 'information': {'request', 'channel', 'dueAt'}, 'decide': {'decision'}}
    if action not in fields or set(payload) != {'action'} | fields[action]:
        raise AuthError('INVALID_FIELDS', 422)
    if row.get('publishedAt') is not None:
        raise AuthError('RESULT_FINAL', 409)
    new = {k: v for k, v in row.items() if k not in {'information', 'decision', 'decisionAt', 'decidedBy'}}
    new['progress'] = 'reviewing'
    if action == 'information':
        deadline = rounds.timestamp(payload['dueAt'])
        if deadline <= now:
            raise AuthError('INVALID_DATES', 422)
        new.update(
            progress='information',
            information={
                'request': rounds.text_field(payload['request'], 700),
                'channel': rounds.text_field(payload['channel'], 300),
                'dueAt': deadline,
            },
        )
    if action == 'decide':
        if payload['decision'] not in ('passed', 'declined'):
            raise AuthError('INVALID_FIELDS', 422)
        new.update(decision=payload['decision'], decisionAt=now)
    return new


def change(app, event, ctx, admission, project, row, action, payload):
    repo, now = app.repository, int(app.repository.clock())
    if not row or row.get('roundId') != admission['id'] or row.get('scopeId') != admission['scopeId']:
        missing()
    student_action = action == 'confirm'
    if student_action:
        if not own_view(row, admission, now):
            missing()
        if set(payload):
            raise AuthError('INVALID_FIELDS', 422)
    elif action in ('publish', 'partnerAccepted') and set(payload) != {'action'}:
        raise AuthError('INVALID_FIELDS', 422)
    already = {
        'publish': 'publishedAt',
        'confirm': 'confirmedAt',
        'partnerAccepted': 'partnerAcceptedAt',
    }.get(action)
    if already and row.get(already) is not None:
        return own_view(row, admission, now) if student_action else roster_view(row)
    if not student_action:
        check_version(event, row)
    next_row, window = row.copy(), None
    changes, guards = [], [admission, project]
    if action in ('review', 'information', 'decide'):
        next_row = progress_change(payload, row, admission, now)
        if action == 'decide':
            next_row['decidedBy'] = ctx.user.user_id
    elif action == 'publish':
        if row.get('decision') not in ('passed', 'declined'):
            raise AuthError('NO_DRAFT', 409)
        window = (admission['resultsAt'], admission['noticeEndsAt'], 'PUBLICATION_CLOSED')
        next_row.update(publishedAt=now, publishedBy=ctx.user.user_id)
        if row['decision'] == 'passed':
            if admission['accepted'] >= admission['capacity']:
                raise AuthError('ROUND_FULL', 409)
            changes.append(
                (
                    admission,
                    dict(admission, accepted=admission['accepted'] + 1, version=admission['version'] + 1),
                )
            )
    elif action in ('confirm', 'partnerAccepted'):
        if row.get('publishedAt') is None or row['decision'] != 'passed':
            raise AuthError('RESULT_UNAVAILABLE', 409)
        if action == 'confirm':
            if not admission['needsConfirmation']:
                raise AuthError('CONFIRMATION_NOT_REQUIRED', 409)
            window = (row['publishedAt'], admission['confirmBy'], 'CONFIRMATION_CLOSED')
            next_row['confirmedAt'] = now
        else:
            if not admission['needsPartner'] or (
                admission['needsConfirmation'] and not row.get('confirmedAt')
            ):
                raise AuthError('PARTNER_NOT_READY', 409)
            next_row.update(partnerAcceptedAt=now, partnerAcceptedBy=ctx.user.user_id)
    else:
        raise AuthError('INVALID_FIELDS', 422)
    enrollee = None
    ready = (
        next_row.get('publishedAt') is not None
        and next_row.get('decision') == 'passed'
        and (not admission['needsConfirmation'] or next_row.get('confirmedAt') is not None)
        and (not admission['needsPartner'] or next_row.get('partnerAcceptedAt') is not None)
    )
    if ready:
        if project.get('status') in ('completed', 'cancelled'):
            raise AuthError('PROJECT_CLOSED', 409)
        uid = row['studentId']
        enrollee = app.sessions.users.get(uid)
        applicant(app.accounts, enrollee, admission['scopeId'])
        require_assignee(enrollee, admission['scopeId'], participant=True)
        participants = project.get('participantUserIds', [])
        if uid not in participants:
            if len(participants) >= 200:
                raise AuthError('PROJECT_FULL', 409)
            stamp = datetime.fromtimestamp(now, timezone.utc).isoformat()
            changes.append(
                (
                    project,
                    dict(
                        project,
                        participantUserIds=[*participants, uid],
                        version=project['version'] + 1,
                        updatedAt=stamp,
                        updatedBy=ctx.user.user_id,
                    ),
                )
            )
        next_row['enrolledAt'] = now
    next_row['version'] += 1
    changes.append((row, next_row))
    save(
        repo,
        event,
        ctx.user,
        admission['scopeId'],
        guards=guards,
        changes=changes,
        window=window,
        enrollee=enrollee,
    )
    return own_view(next_row, admission, int(repo.clock())) if student_action else roster_view(next_row)


def dispatch(app, event, route, ctx, method):
    repo = app.repository
    now = int(repo.clock())
    if route['public']:
        method_is(method, 'GET')
        return rounds.for_activity(repo, route['public'], now)
    if route['project']:
        project = rounds.manager(repo, ctx, route['project'])
        method_is(method, 'GET', 'POST')
        if method == 'GET':
            return rounds.for_manager(repo, ctx, project, now)
        return rounds.create(repo, event, ctx, project)
    if route['activity']:
        method_is(method, 'GET')
        activity = repo.get('activity', route['activity'])
        if not activity:
            missing()
        return [
            {'id': p['id'], 'title': p['title']}
            for p in repo.list('exchange', ctx)
            if allowed_roles(ctx, 'exchange', 'update', p)
            and p.get('status') not in {'completed', 'cancelled'}
            and rounds.linked_partners(repo, p, activity)
        ]
    if route['personal']:
        method_is(method, 'GET')
        applicant(app.accounts, ctx.user)
        scopes = {g['scopeId'] for g in ctx.user.permissions()[0] if g['role'] == 'student'}
        uid = ctx.user.user_id
        pairs = []
        for item in indexed(repo, uid + '#' + rounds.OWNER_LINK, rounds.OWNER_LINK):
            if item['studentId'] != uid or item['scopeId'] not in scopes:
                continue
            admission = repo.get(rounds.ROUND, item['roundId'])
            if not admission or admission['scopeId'] != item['scopeId']:
                continue
            project = repo.get('exchange', admission['exchangeId'])
            if project and project['scopeId'] == admission['scopeId']:
                pairs.append((admission, repo.get(rounds.APPLICATION, own_id(admission['id'], uid))))
        now = int(repo.clock())
        return sorted(
            (v for r, a in pairs if (v := own_view(a, r, now))), key=lambda v: v['submittedAt'], reverse=True
        )
    admission, project = checked_round(repo, route['round'])
    if route['resource'].startswith('mine'):
        if route['app']:
            missing()
        applicant(app.accounts, ctx.user, admission['scopeId'])
        row = repo.get(rounds.APPLICATION, own_id(admission['id'], ctx.user.user_id))
        if route['resource'] == 'mine/confirm':
            method_is(method, 'PUT')
            return change(app, event, ctx, admission, project, row, 'confirm', body(event))
        method_is(method, 'GET', 'POST')
        if method == 'POST':
            return submit(repo, event, ctx, admission, project, row)
        view = own_view(row, admission, int(repo.clock()))
        if not view:
            missing()
        return view
    rounds.manager(repo, ctx, project['id'])
    if not route['app']:
        method_is(method, 'GET')
        rows = indexed(repo, admission['id'] + '#' + rounds.APPLICATION, rounds.APPLICATION)
        return {
            'round': {k: admission[k] for k in (*rounds.PUBLIC_FIELDS, 'accepted')},
            'applications': [
                roster_view(a)
                for a in sorted(rows, key=lambda a: (a['submittedAt'], a['id']))
                if a['roundId'] == admission['id'] and a['scopeId'] == admission['scopeId']
            ],
        }
    method_is(method, 'PATCH')
    payload = body(event)
    if not isinstance(payload.get('action'), str) or payload['action'] == 'confirm':
        raise AuthError('INVALID_FIELDS', 422)
    row = repo.get(rounds.APPLICATION, route['app'])
    return change(app, event, ctx, admission, project, row, payload['action'], payload)


def handle(app, event, route):
    if not app.repository:
        raise AuthError('PERMISSION_UNAVAILABLE', 503)
    if event.get('queryStringParameters'):
        raise AuthError('INVALID_QUERY', 422)
    method = event.get('requestContext', {}).get('http', {}).get('method')
    # A competing writer can change a shared project/round; authorize again on every retry.
    for attempt in range(3):
        ctx = None if route['public'] else require_session(event, app.sessions)
        try:
            data = dispatch(app, event, route, ctx, method)
        except AuthError as exc:
            if exc.code == 'VERSION_CONFLICT' and attempt < 2:
                continue
            raise
        if ctx:
            require_session(event, app.sessions)
        server_time = app.repository.clock()
        if route['personal']:
            data = [v for v in data if v['state'] != 'declined' or server_time < v['noticeEndsAt']]
        elif (
            route['resource'] in ('mine', 'mine/confirm')
            and data.get('state') == 'declined'
            and server_time >= data['noticeEndsAt']
        ):
            missing()
        return response(200, {'data': data, 'serverTime': server_time})
