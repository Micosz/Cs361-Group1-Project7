#!/usr/bin/env python3
"""Package only one allowlisted Lambda tracked source; no AWS calls or secrets."""

import argparse
import json
from pathlib import Path
import subprocess
import sys
import zipfile

FUNCTIONS = ('fetchPartnersData', 'getPublicPartners', 'tuAuthLogin')
SOURCE_ROOT = Path('backend/lambda')
SOURCE = SOURCE_ROOT / FUNCTIONS[0]
EXTENSIONS = ('.js', '.mjs', '.cjs')


def fail(message):
    raise ValueError(message)


def handler_files(config):
    runtime, handler = config.get('Runtime', ''), config.get('Handler', '')
    if config.get('PackageType') != 'Zip':
        fail('Existing Lambda must use a Zip package; container migration is out of scope')
    if not runtime.startswith('nodejs') or not runtime.endswith('.x'):
        fail('This packager supports Node.js only; confirm actual runtime/source before merge')
    module, separator, export = handler.rpartition('.')
    if not separator or not module or not export.isidentifier():
        fail('Invalid existing Lambda Handler')
    path = Path(module)
    if path.is_absolute() or '..' in path.parts or '\\' in module:
        fail('Invalid handler module path')
    return [module + ext for ext in EXTENSIONS]


def package(root, config, output, function='fetchPartnersData'):
    root, output = root.resolve(), output.resolve()
    if function not in FUNCTIONS:
        fail('Function is not in the deployment allowlist')
    source_path = SOURCE_ROOT / function
    source = root / source_path
    if source.resolve() != source or source in output.parents:
        fail('Source must be a real directory; ZIP output must be outside source')
    candidates = handler_files(config)
    tracked = subprocess.check_output(
        ['git', 'ls-files', '-z', '--', source_path.as_posix()], cwd=root,
    ).decode().split('\0')
    files = {}
    for name in filter(None, tracked):
        relative = Path(name).relative_to(source_path)
        if relative.name.lower() == 'readme.md':
            continue
        if (any(part.startswith('.') for part in relative.parts)
                or any(part in {'node_modules', 'tests', '__pycache__'} for part in relative.parts)
                or relative.suffix.lower() in {'.zip', '.pem', '.key', '.log'}):
            fail('Tracked source contains an excluded file; inspect source before packaging')
        full = root / name
        if full.is_symlink() or not full.is_file() or source.resolve() not in full.resolve().parents:
            fail('Source contains a missing, symbolic, or out-of-directory file')
        files[relative.as_posix()] = full
    matching_handlers = [name for name in candidates if name in files]
    if not matching_handlers:
        fail('Actual Lambda handler source is missing; import the existing source before deployment')
    if len(matching_handlers) != 1:
        fail('Ambiguous handler files; keep exactly one module for the configured Handler')
    if 'package.json' in files:
        if 'package-lock.json' not in files:
            fail('package.json requires a committed package-lock.json for npm ci')
        manifest = json.loads(files['package.json'].read_text())
        if manifest.get('dependencies') and not (source / 'node_modules').is_dir():
            fail('Production dependencies are missing; run npm ci --omit=dev --ignore-scripts')
    modules = source / 'node_modules'
    if modules.exists():
        if 'package.json' not in files or modules.is_symlink():
            fail('Unexpected node_modules; use only locked Lambda dependencies')
        for full in modules.rglob('*'):
            if full.is_symlink():
                fail('Symbolic dependency files are not supported; review packaging explicitly')
            if full.suffix == '.node':
                fail('Native dependencies require packaging for the existing Lambda architecture')
            if full.is_file():
                files[full.relative_to(source).as_posix()] = full
    if not files:
        fail('Empty deployment package')
    total = sum(p.stat().st_size for p in files.values())
    if total > 250 * 1024 * 1024:
        fail('Package exceeds the Lambda uncompressed size limit')
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, full in sorted(files.items()):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.external_attr = 0o100644 << 16
            archive.writestr(info, full.read_bytes(), compress_type=zipfile.ZIP_DEFLATED)
    if output.stat().st_size > 50 * 1024 * 1024:
        fail('ZIP exceeds direct-upload limit; S3 deployment is out of scope')
    with zipfile.ZipFile(output) as archive:
        names = archive.namelist()
        if not any(name in names for name in candidates) or archive.testzip() is not None:
            fail('ZIP validation failed')
    print(f'Validated ZIP root and CRC: {len(files)} files')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--function', required=True, choices=FUNCTIONS)
    parser.add_argument('--config', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    try:
        package(Path.cwd(), json.loads(args.config.read_text()), args.output, args.function)
    except (ValueError, OSError, subprocess.CalledProcessError, json.JSONDecodeError) as error:
        print(f'Packaging failed: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
