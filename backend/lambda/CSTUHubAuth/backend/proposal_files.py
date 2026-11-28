"""Immutable internal attachments. Each read checks the actual proposal and file."""
from hashlib import sha256

from .admission_store import save
from .auth.session_service import AuthError
from .documents.uploads import parse_upload
from .http_api import headers
from .proposal_workflow import (advance, file_visible, is_owner, may_record_evidence,
                                object_id, require, stamp, text_value)


def content(repo, ctx, row, key):
    entry = next((f for f in row['files'] if f['id'] == key), None)
    require(entry and file_visible(ctx, row, entry), 'NOT_FOUND', 404)
    document = repo.get('proposalFile', key)
    require(document and document.get('parentId') == row['id'] and document.get('parentType') == 'proposal'
            and document.get('scopeId') == row['scopeId'] and document.get('purpose') == entry['purpose']
            and document.get('revision') == entry.get('revision'), 'NOT_FOUND', 404)
    require(repo.documents is not None, 'DOCUMENT_UNAVAILABLE', 503)
    return repo.documents.content(document)


def upload(event, repo, ctx, row, purpose):
    require(repo.documents is not None, 'DOCUMENT_UNAVAILABLE', 503)
    if purpose == 'evidence':
        require(may_record_evidence(ctx, row), 'FORBIDDEN', 403)
        require(row['kind'] == 'mou' and row['status'] == 'signing', 'INVALID_TRANSITION', 409)
    else:
        require(is_owner(ctx, row), 'FORBIDDEN', 403)
        require(row['status'] in ('draft', 'open', 'closed', 'changes'), 'INVALID_TRANSITION', 409)
        if purpose == 'draft':
            require(row['kind'] == 'mou', 'INVALID_TRANSITION', 409)
    fields, upload = parse_upload(event)
    require(fields.get('audience') == 'internal' and fields.get('containsPersonal') is False)
    metadata, raw = upload['metadata'], upload['bytes']
    name = text_value(fields['displayName'], 200)
    require(not any(ord(c) < 32 or ord(c) == 127 for c in name))
    if purpose == 'draft':
        require(metadata['contentType'] == 'application/pdf', 'PDF_REQUIRED', 422)
    checksum = sha256(raw).hexdigest()
    supplied_version = headers(event).get('if-match')
    require(supplied_version is not None, 'PRECONDITION_REQUIRED', 428)
    key = object_id('proposal-file', row['id'], ctx.user.user_id, purpose, supplied_version, name, checksum)
    if any(f['id'] == key for f in row['files']):
        return row  # Exact retry after a lost upload response.
    require(supplied_version == '"' + str(row['version']) + '"', 'VERSION_CONFLICT', 409)
    at = stamp(repo.clock())
    doc = dict(id=key, scopeId=row['scopeId'], entityType='proposalFile', parentType='proposal',
               parentId=row['id'], version=1, purpose=purpose, uploadState='ready', uploadedAt=at,
               uploadedBy=ctx.user.user_id, displayName=name, size=metadata['fileSize'],
               mime=metadata['contentType'], hash=checksum, objectKey=metadata['storageKey'])
    if purpose == 'draft':
        doc['revision'] = max((f['revision'] for f in row['files'] if f['purpose'] == 'draft'),
                              default=0) + 1
    link = {k: doc[k] for k in ('id', 'purpose', 'displayName', 'revision') if k in doc}
    link['url'] = '/api/proposals/' + row['id'] + '/files/' + key
    new = advance(row, 'file-' + purpose, row['status'], ctx.user, at, revision=doc.get('revision'),
                  files=[*row['files'], link])
    window = (0, row['closesEpoch'], 'PROPOSAL_CLOSED') if row['status'] == 'open' else None
    repo.documents.put(doc, raw)
    try:
        save(repo, event, ctx.user, row['scopeId'], guards=[], changes=[(row, new), (None, doc)], window=window)
    except AuthError:
        # A cancelled transaction never references this attempt's random storage key.
        # Do not delete on an ambiguous transport failure; a committed file must stay readable.
        repo.documents.delete(doc)
        stored = repo.get('proposal', row['id'])
        if stored and any(f['id'] == key for f in stored['files']):
            return stored
        raise
    return new
