"""Internal proposal routes. Authentication, scope and file access are checked per request."""
from datetime import datetime
import re

from . import proposal_files, proposal_interests as offers, proposal_workflow as flow, proposals as legacy
from .admissions import check_version
from .auth.require_session import require_session
from .auth.session_service import AuthError
from .http_api import response
from .permissions.gateway import body
from .permissions.policy import matching_roles

ROUTES = re.compile(
    r'/api/proposals(?:/(?P<deadline>deadline)|/(?P<id>proposal-[a-f0-9]{64})'
    r'(?:/(?P<action>interest|host|workflow|destination|signing)'
    r'|/files/(?P<file>draft|support|evidence|proposal-file-[a-f0-9]{64}))?)?'
)
FIELDS = ('id', 'scopeId', 'version', 'kind', 'status', 'stage', 'source', 'title', 'summary',
          'partner', 'partnerType', 'partnerId', 'createdBy', 'creator', 'createdAt', 'updatedAt',
          'openDays', 'deadline', 'closesAt', 'closedAt', 'hostId', 'hostName', 'supportLink',
          'interestCount', 'notedCount', 'submittedAt', 'submittedRevision', 'approvedRevision',
          'autoRevision', 'informedAt')
LEGACY_FIELDS = {'title', 'partner', 'summary', 'scopeId', 'deadline'}


def method_is(actual, *choices):
    flow.require(actual in choices, 'METHOD_NOT_ALLOWED', 405)


def present(repo, ctx, row, detail=True):
    uid = ctx.user.user_id
    owner = flow.is_owner(ctx, row)
    reviewer = 'executive' in matching_roles(ctx, row)
    original = 'kind' not in row
    view = {k: row[k] for k in FIELDS if k in row}
    board = original or row['source'] == 'board'
    own, participants = offers.participants(repo, row, uid, detail and (owner or reviewer)) if board else (None, [])
    total, noted = offers.counts(row)
    view.update(isOwner=owner, isReviewer=reviewer and not owner, canSeeParticipants=owner or reviewer,
                mine=bool(own and own['interested']), myNote=own['note'] if own and own['interested'] else '',
                participants=participants, interested=[p['name'] for p in participants],
                interestCount=total, notedCount=noted, hasDestination=bool(row.get('destination')))
    if original:
        end = legacy.closes_epoch(row)
        view.update(legacy=True, version=row.get('version'), closesAt=flow.stamp(end),
                    status='open' if repo.clock() < end else 'closed', history=[], files=[])
        return view
    view['awaitingDraft'] = (row['kind'] == 'mou' and row['status'] == 'closed'
                             and not any(f['purpose'] == 'draft' for f in row['files']))
    view['files'], view['history'] = [], []
    if owner and row['status'] == 'changes':
        view['resubmitAfterRevision'] = row['resubmitAfterRevision']
    if detail:
        submitted = flow.submitted_revisions(row)
        view['files'] = [f for f in row['files'] if flow.file_visible(ctx, row, f, submitted)]
        for entry in row['history']:
            if not (owner or reviewer) and entry['action'] not in ('create', 'close', 'host', 'inform'):
                continue
            if not owner and entry['action'] == 'file-draft' and entry.get('revision') not in submitted:
                continue
            view['history'].append(entry)
    if row.get('signed') and flow.may_record_evidence(ctx, row):
        view['signed'] = row['signed']
    if row.get('destination') or row['status'] == 'signing':
        from .proposal_destinations import visible_destination, can_sign
        destination = visible_destination(repo, ctx, row) if row.get('destination') else None
        if destination:
            view['destination'] = destination
        if row['status'] == 'signing':
            view['canSign'] = can_sign(repo, ctx, row)
    return view


def handle(event, sessions, repo, route):
    ctx = require_session(event, sessions)
    scopes = {g['scopeId'] for g in ctx.user.permissions()[0] if g['role'] in flow.INTERNAL}
    flow.require(scopes, 'FORBIDDEN', 403)
    flow.require(repo, 'PERMISSION_UNAVAILABLE', 503)
    method = event['requestContext']['http']['method']
    query = event.get('queryStringParameters') or {}
    if route['deadline']:
        method_is(method, 'GET')
        flow.require(set(query) == {'days'} and isinstance(query['days'], str)
                     and re.fullmatch(r'[1-9][0-9]{0,2}', query['days']), 'INVALID_QUERY', 422)
        return response(200, {'data': flow.preview(sessions, ctx.user, int(query['days']), int(repo.clock()))})
    flow.require(not query, 'INVALID_QUERY', 422)
    code = 200
    if not route['id']:
        method_is(method, 'GET', 'POST')
        if method == 'GET':
            rows = [flow.reconcile(event, repo, ctx, r) for r in repo.list('proposal', ctx)
                    if flow.visible(ctx, r)]
            rows.sort(key=lambda r: (r['createdAt'], r['id']), reverse=True)
            data = [present(repo, ctx, r, False) for r in rows]
        else:
            payload = body(event)
            if set(payload) == LEGACY_FIELDS:
                now = datetime.fromtimestamp(repo.clock(), legacy.BANGKOK)
                row = legacy.create(event, repo, ctx.user, scopes, now)
            else:
                row = flow.create(event, sessions, repo, ctx, payload)
            data = present(repo, ctx, row)
            code = 201
    else:
        row = repo.get('proposal', route['id'])
        flow.require(flow.visible(ctx, row), 'NOT_FOUND', 404)
        row = flow.reconcile(event, repo, ctx, row)
        action, file = route['action'], route['file']
        if 'kind' not in row:
            if action == 'interest' and method == 'PUT':
                row = offers.interest(event, repo, ctx, row, body(event))
            else:
                flow.require(not action and not file and method == 'GET', 'METHOD_NOT_ALLOWED', 405)
        elif file and file.startswith('proposal-file-'):
            method_is(method, 'GET')
            result = proposal_files.content(repo, ctx, row, file)
            require_session(event, sessions)
            return result
        elif file:
            method_is(method, 'POST')
            row, code = proposal_files.upload(event, repo, ctx, row, file), 201
        elif action == 'interest':
            method_is(method, 'PUT')
            row = offers.interest(event, repo, ctx, row, body(event))
        elif action in ('host', 'workflow'):
            method_is(method, 'PUT' if action == 'host' else 'POST')
            check_version(event, row)
            fn = offers.accept_host if action == 'host' else flow.workflow
            row = fn(event, repo, ctx, row, body(event))
        elif action in ('destination', 'signing'):
            from .proposal_destinations import handle_destination
            result = handle_destination(event, repo, ctx, row, action, method)
            if method == 'GET':
                require_session(event, sessions)
                return response(200, {'data': result})
            row = result
        else:
            method_is(method, 'GET', 'PATCH')
            if method == 'PATCH':
                check_version(event, row)
                row = flow.edit(event, repo, ctx, row, body(event))
        data = present(repo, ctx, row)
    require_session(event, sessions)
    return response(code, {'data': data})
