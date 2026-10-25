"""Package committed Auth source for manual Lambda deployment; never calls AWS."""
import argparse
import ast
import base64
import hashlib
from pathlib import Path
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def git(*args):
    return subprocess.check_output(['git', '-C', str(ROOT), *args])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path, help='New ZIP outside the repository')
    args = parser.parse_args()
    output = args.output.expanduser().resolve()
    if output == ROOT or ROOT in output.parents:
        parser.error('Keep deployment artifacts outside the repository and public directory')
    if output.exists():
        parser.error('Output already exists; choose a new filename')
    changed = git('status', '--porcelain', '--untracked-files=all', '--', 'backend').decode().splitlines()
    if any(line.endswith('.py') for line in changed):
        parser.error('Commit or preserve backend changes first; packaging uses HEAD only')
    commit = git('rev-parse', 'HEAD').decode().strip()
    paths = git('ls-tree', '-r', '--name-only', 'HEAD', '--', 'backend').decode().splitlines()
    sources = {}
    for path in paths:
        if not path.endswith('.py') or path.startswith(('backend/tests/', 'backend/lambda/')):
            continue
        source = git('show', f'HEAD:{path}')
        ast.parse(source, filename=path)
        sources[path] = source
    if 'backend/lambda_function.py' not in sources:
        parser.error('Auth handler source missing')
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('xb') as stream:
        with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as archive:
            for path, source in sorted(sources.items()):
                archive.writestr(path, source)
            archive.writestr('SOURCE_COMMIT', commit + '\n')
    digest = base64.b64encode(hashlib.sha256(output.read_bytes()).digest()).decode()
    print(f'Source commit: {commit}\nPython files: {len(sources)}\nZIP: {output}\nCodeSha256: {digest}')
    print('Source only; uses boto3 supplied by the AWS Lambda Python runtime. No AWS changes made.')


if __name__ == '__main__':
    main()
