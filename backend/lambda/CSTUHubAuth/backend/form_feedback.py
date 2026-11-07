"""Internal form feedback: one atomic, bounded batch containing individual responses.

Only selected columns reach this boundary. No workbook, formula evaluation, AI,
or external Forms connection is used. The parent owns scope and authorization.
"""
from datetime import datetime, timezone
import hashlib
import json

from .auth.session_service import AuthError
from .permissions.policy import require_record

MAX_BATCH_BYTES = 200 * 1024
MAX_RESPONSES = 1000
MAX_COLUMNS = 100


def text(value, limit, required=False):
    if not isinstance(value, str) or len(value) > limit or '\x00' in value:
        raise AuthError('INVALID_FORM_IMPORT', 422)
    if required and not value.strip():
        raise AuthError('INVALID_FORM_IMPORT', 422)
    return value


def normalize(payload):
    if set(payload) != {'formName', 'sourceType', 'fileName', 'sheetName', 'columns', 'rows'}:
        raise AuthError('INVALID_FORM_IMPORT', 422)
    if payload['sourceType'] not in ('partner', 'participant', 'other'):
        raise AuthError('INVALID_FORM_IMPORT', 422)
    columns, rows = payload['columns'], payload['rows']
    if (not isinstance(columns, list) or not 1 <= len(columns) <= MAX_COLUMNS
            or not isinstance(rows, list) or not 1 <= len(rows) <= MAX_RESPONSES):
        raise AuthError('INVALID_FORM_IMPORT', 422)
    columns = [text(column, 500, True) for column in columns]
    normalized, seen = [], set()
    for row in rows:
        if not isinstance(row, dict) or set(row) != {'sourceRow', 'answers', 'respondedAt'}:
            raise AuthError('INVALID_FORM_IMPORT', 422)
        number, answers = row['sourceRow'], row['answers']
        if (type(number) is not int or not 2 <= number <= 2001 or number in seen
                or not isinstance(answers, list) or len(answers) != len(columns)):
            raise AuthError('INVALID_FORM_IMPORT', 422)
        seen.add(number)
        answers = [text(answer, 10000) for answer in answers]
        if not any(answer.strip() for answer in answers):
            raise AuthError('INVALID_FORM_IMPORT', 422)
        normalized.append(dict(sourceRow=number, answers=answers,
                               respondedAt=text(row['respondedAt'], 200)))
    result = dict(formName=text(payload['formName'], 200, True),
                  sourceType=payload['sourceType'], fileName=text(payload['fileName'], 255, True),
                  sheetName=text(payload['sheetName'], 100, True), columns=columns, rows=normalized)
    # Conservative UTF-8 JSON bound leaves room below DynamoDB's item-size limit.
    if len(json.dumps(result, ensure_ascii=False, separators=(',', ':')).encode('utf-8')) > MAX_BATCH_BYTES:
        raise AuthError('FORM_IMPORT_TOO_LARGE', 422)
    return result


def form_record(context, payload, parent, now):
    candidate = dict(entityType='formFeedback', scopeId=parent['scopeId'],
                     parentType=parent['entityType'], parentId=parent['id'])
    require_record(context, 'formFeedback', 'create', candidate, parent)
    data = normalize(payload)
    # Filename, title, source label and Excel row positions are not identity:
    # renaming a file or re-uploading with another retry key cannot duplicate it.
    content = [data['columns'], [[r['answers'], r['respondedAt']] for r in data['rows']]]
    fingerprint = hashlib.sha256(json.dumps(content, ensure_ascii=False,
                                            separators=(',', ':')).encode()).hexdigest()
    identity = [parent['scopeId'], parent['entityType'], parent['id'], fingerprint]
    key = hashlib.sha256(json.dumps(identity, separators=(',', ':')).encode()).hexdigest()
    timestamp = datetime.fromtimestamp(now, timezone.utc).isoformat()
    return dict(candidate, **data, id='form-' + key, version=1, createdAt=timestamp,
                updatedAt=timestamp, createdBy=context.user.user_id,
                importedByName=context.user.display_name, responseCount=len(data['rows']),
                origin='form_import', contentHash=fingerprint)
