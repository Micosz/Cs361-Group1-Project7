#!/usr/bin/env python3
"""Select allowlisted Lambda jobs from the complete GitHub push commit range."""

import json
import os
from pathlib import Path
import re
import subprocess

FUNCTIONS = ('fetchPartnersData', 'getPublicPartners', 'tuAuthLogin')
SHARED = {'.github/scripts/package-lambda.py', '.github/scripts/select-lambdas.py',
          '.github/workflows/deploy-lambda.yml'}


def select(paths):
    if SHARED.intersection(paths):
        return list(FUNCTIONS)
    return [name for name in FUNCTIONS
            if any(path.startswith(f'backend/lambda/{name}/') for path in paths)]


def changed_paths(before, after, root=Path('.')):
    if not all(re.fullmatch(r'[0-9a-f]{40}', sha or '') for sha in (before, after)):
        raise ValueError('Invalid push commit range')
    command = (['git', 'ls-tree', '-r', '--name-only', '-z', after] if before == '0' * 40
               else ['git', 'diff', '--name-only', '-z', before, after, '--'])
    return subprocess.check_output(command, cwd=root).decode().strip('\0').split('\0')


def main():
    event = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text())
    if event.get('ref') != 'refs/heads/main' or event.get('deleted'):
        raise SystemExit('Deployment selection requires a main push')
    names = select(changed_paths(event.get('before'), event.get('after')))
    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        output.write('matrix=' + json.dumps({'function': names}, separators=(',', ':')) + '\n')
        output.write('has-changes=' + str(bool(names)).lower() + '\n')
    print('Selected functions:', ', '.join(names) if names else 'none')


if __name__ == '__main__':
    main()
