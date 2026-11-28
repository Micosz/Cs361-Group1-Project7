"""Voluntary offers, counts and the accepted host are scoped to one proposal."""
from .admission_store import save
from .auth.session_service import AuthError
from .proposal_workflow import advance, object_id, require, stamp, text_value
from . import proposals as legacy

KIND = 'proposalInterest'
PAGE_KIND = 'proposalInterestPage'
# Bounded DynamoDB items, even when every volunteer writes a 500-character Thai note.
PAGE_SIZE = 64


def stored_page(repo, row, number):
    key = object_id('proposal-roster', row['id'], str(number))
    page = repo.get(PAGE_KIND, key)
    if page:
        require(page.get('parentId') == row['id'] and page.get('scopeId') == row['scopeId']
                and page.get('number') == number, 'PROPOSAL_UNAVAILABLE', 503)
    return key, page


def location(repo, row, uid):
    key = object_id('proposal-interest', row['id'], uid)
    pointer = repo.get(KIND, key)
    if pointer:
        require(pointer.get('parentId') == row['id'] and pointer.get('scopeId') == row['scopeId']
                and pointer.get('userId') == uid, 'PROPOSAL_UNAVAILABLE', 503)
    return key, pointer


def original_people(row):
    return {uid: legacy.original_member(uid, stored) for uid, stored in row.get('members', {}).items()}


def counts(row):
    if 'interestCount' in row:
        return row['interestCount'], row['notedCount']
    people = original_people(row)
    return len(people), sum(bool(p['note']) for p in people.values())


def own_offer(repo, row, uid):
    _, pointer = location(repo, row, uid)
    if not pointer:
        return legacy.original_member(uid, row.get('members', {}).get(uid))
    _, page = stored_page(repo, row, pointer['page'])
    require(page and uid in page['people'], 'PROPOSAL_UNAVAILABLE', 503)
    return page['people'][uid]


def participants(repo, row, uid, full):
    if full:
        people = original_people(row)
        # An offer and the page count are committed together. A different account can read
        # an accepted offer immediately without waiting for secondary index propagation.
        for number in range((row.get('offerSlots', 0) + PAGE_SIZE - 1) // PAGE_SIZE):
            _, page = stored_page(repo, row, number)
            require(page, 'PROPOSAL_UNAVAILABLE', 503)
            people.update(page['people'])
        own = people.get(uid)
    else:
        own = own_offer(repo, row, uid) if row.get('offerSlots') else legacy.original_member(uid, row.get('members', {}).get(uid))
        people = {uid: own} if own else {}
    listing = sorted((dict(name=p['name'], note=p['note'], mine=p['userId'] == uid,
                           isHost=p['userId'] == row.get('hostId'))
                      for p in people.values() if p['interested']), key=lambda p: p['name'])
    return own, listing


def interest(event, repo, ctx, row, payload):
    require({'interested'} <= set(payload) <= {'interested', 'note'} and type(payload['interested']) is bool)
    join = payload['interested']
    note = text_value(payload.get('note', ''), 500, False) if join else ''
    uid = ctx.user.user_id
    for _ in range(3):
        original = 'kind' not in row
        if original:
            closes = legacy.closes_epoch(row)
        else:
            require(row.get('source') == 'board' and row['status'] == 'open', 'PROPOSAL_CLOSED', 409)
            closes = row['closesEpoch']
        require(repo.clock() < closes, 'PROPOSAL_CLOSED', 409)

        key, pointer = location(repo, row, uid)
        slots = row.get('offerSlots', 0)
        number = pointer['page'] if pointer else slots // PAGE_SIZE
        page_key, page = stored_page(repo, row, number)
        people = dict(page['people']) if page else {}
        if pointer:
            require(uid in people, 'PROPOSAL_UNAVAILABLE', 503)
        previous = people.get(uid) or legacy.original_member(uid, row.get('members', {}).get(uid))
        before = bool(previous and previous['interested'])
        if before == join and (not join or previous['note'] == note):
            return row

        total, noted = counts(row)
        new = dict(row, version=row.get('version', 0) + 1, updatedAt=stamp(repo.clock()),
                   interestCount=total + int(join) - int(before),
                   notedCount=noted + int(bool(note)) - int(bool(before and previous['note'])))
        changes = []
        if not pointer:
            changes.append((None, dict(id=key, entityType=KIND, parentId=row['id'], scopeId=row['scopeId'],
                                       version=1, userId=uid, page=number)))
            new['offerSlots'] = slots + 1
        people[uid] = dict(userId=uid, name=ctx.user.display_name, interested=join, note=note)
        updated = dict(id=page_key, entityType=PAGE_KIND, parentId=row['id'], scopeId=row['scopeId'],
                       number=number, version=page['version'] + 1 if page else 1, people=people)
        changes.append((page, updated))
        try:
            if original:
                legacy.save_interest(event, repo, ctx, row, new, changes)
            else:
                save(repo, event, ctx.user, row['scopeId'], guards=[], changes=[(row, new), *changes],
                     window=(0, closes, 'PROPOSAL_CLOSED'))
            return new
        except AuthError as exc:
            if exc.code != 'VERSION_CONFLICT':
                raise
            row = repo.get('proposal', row['id'])
            require(row and row['scopeId'] == new['scopeId'], 'NOT_FOUND', 404)
    raise AuthError('VERSION_CONFLICT', 409)


def accept_host(event, repo, ctx, row, payload):
    require(not payload)
    require(row['source'] == 'board' and row['status'] == 'open'
            and repo.clock() < row['closesEpoch'], 'PROPOSAL_CLOSED', 409)
    uid = ctx.user.user_id
    if row.get('hostId') == uid:
        return row
    require(not row.get('hostId'), 'HOST_ASSIGNED', 409)
    if uid != row['createdBy']:
        own = own_offer(repo, row, uid)
        require(own and own['interested'], 'INTEREST_REQUIRED', 409)
    new = advance(row, 'host', row['status'], ctx.user, stamp(repo.clock()),
                  hostId=uid, hostName=ctx.user.display_name)
    # Every interest change also increments this proposal's version.
    save(repo, event, ctx.user, row['scopeId'], guards=[], changes=[(row, new)],
         window=(0, row['closesEpoch'], 'PROPOSAL_CLOSED'))
    return new
