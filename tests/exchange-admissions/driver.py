"""Playwright transport for the production Lambda with the repository's offline AWS/TU doubles."""

import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(root / 'backend/lambda/CSTUHubAuth'), str(root / 'tests/backend/CSTUHubAuth')]
from support.admissions_fixture import BASE, Fixture

fixture = Fixture()
for line in sys.stdin:
    cmd = json.loads(line)
    try:
        if cmd['op'] == 'clock':
            fixture.now = BASE + cmd['offset']
            result = fixture.now
        elif cmd['op'] == 'login':
            fixture.login(cmd['client'], cmd['user'])
            result = True
        elif cmd['op'] == 'catalog':
            result = fixture.catalog
        elif cmd['op'] == 'request':
            result = fixture.request(
                cmd['client'],
                cmd['path'],
                cmd['method'],
                cmd.get('body'),
                request_headers=cmd.get('headers', {}),
            )
        else:
            raise ValueError('unknown fixture command')
        print(json.dumps({'id': cmd['id'], 'result': result}), flush=True)
    except Exception as err:
        print(json.dumps({'id': cmd['id'], 'error': repr(err)}), flush=True)
