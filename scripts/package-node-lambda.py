"""Build a Node Lambda ZIP from committed source and lockfile; never calls AWS."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
FUNCTIONS = {'tuAuthLogin': 'index.mjs', 'fetchPartnersData': 'index.mjs', 'getPublicPartners': 'index.cjs'}


def git(*args):
    return subprocess.check_output(['git', '-C', str(ROOT), *args])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('function', choices=FUNCTIONS)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    output = args.output.expanduser().resolve()
    if output == ROOT or ROOT in output.parents or output.exists():
        parser.error('Choose a new ZIP outside the repository')
    source_root = f'backend/lambda/{args.function}/'
    inputs = [source_root, 'package.json', 'package-lock.json']
    if git('status', '--porcelain', '--untracked-files=all', '--', *inputs).strip():
        parser.error('Commit or preserve source/lockfile changes first; packaging uses HEAD only')
    commit = git('rev-parse', 'HEAD').decode().strip()
    entry = FUNCTIONS[args.function]
    with tempfile.TemporaryDirectory(prefix='cstu-node-package-') as temporary:
        build = Path(temporary)
        # Explicitly allow source modules; never bundle README, tests, credentials or local files.
        tracked = git('ls-tree', '-r', '--name-only', 'HEAD', '--', source_root).decode().splitlines()
        for path in tracked:
            relative = Path(path.removeprefix(source_root))
            if relative.suffix not in ('.js', '.mjs', '.cjs') or 'tests' in relative.parts:
                continue
            target = build / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(git('show', f'HEAD:{path}'))
            subprocess.run(['node', '--check', str(target)], check=True, capture_output=True)
        if not (build / entry).is_file():
            raise RuntimeError('Handler entry is missing')
        if args.function != 'tuAuthLogin':
            # npm ci enforces the committed lockfile; dev dependencies and install scripts stay out.
            for name in ('package.json', 'package-lock.json'):
                (build / name).write_bytes(git('show', f'HEAD:{name}'))
            subprocess.run(['npm', 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'],
                           cwd=build, check=True, capture_output=True, timeout=180)
        env = {**os.environ, 'AWS_EC2_METADATA_DISABLED': 'true', 'AWS_REGION': 'ap-southeast-1'}
        subprocess.run(['node', '--input-type=module', '-e',
                        "const m = await import(" + json.dumps((build / entry).as_uri()) + "); if(typeof m.handler !== 'function') throw Error('Missing handler export');"],
                       cwd=build, env=env, check=True, capture_output=True, timeout=30)
        (build / 'SOURCE_COMMIT').write_text(commit + '\n')
        (build / 'SOURCE_FUNCTION').write_text(args.function + '\n')
        output.parent.mkdir(parents=True, exist_ok=True)
        with output.open('xb') as stream, zipfile.ZipFile(stream, 'w') as archive:
            for path in sorted(build.rglob('*')):
                if path.is_symlink():
                    raise RuntimeError('Symlinks are not supported in deployment packages')
                if not path.is_file():
                    continue
                relative = path.relative_to(build).as_posix()
                info = zipfile.ZipInfo(relative, date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.create_system = 3
                info.external_attr = 0o100644 << 16
                archive.writestr(info, path.read_bytes())
    print(f'Packaged {args.function} from {commit}: {output}')
    print(f'SHA256: {hashlib.sha256(output.read_bytes()).hexdigest()}')


if __name__ == '__main__':
    main()
