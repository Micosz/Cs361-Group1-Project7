"""Release allowlisted Lambda code; uses AWS CLI, never logs runtime secrets."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import zipfile

ACCOUNT = "781485979426"
REGION = "ap-southeast-1"
FUNCTION = "CSTUHubAuth"
ARN = f"arn:aws:lambda:{REGION}:{ACCOUNT}:function:{FUNCTION}"

NODE_FUNCTIONS = {
    'tuAuthLogin': 'index.mjs',
    'fetchPartnersData': 'index.mjs',
    'getPublicPartners': 'index.cjs',
}


def aws(service, *args):
    result = subprocess.run(
        ["aws", service, *args, "--region", REGION, "--output", "json"],
        capture_output=True, text=True, check=False, timeout=330,
    )
    if result.returncode:
        # AWS errors may contain configuration values; inspect AWS separately.
        raise RuntimeError(f"AWS {service} {args[0]} failed; exit {result.returncode}")
    return json.loads(result.stdout) if result.stdout.strip() else {}


def configuration(function=FUNCTION):
    return aws("lambda", "get-function-configuration", "--function-name", function)


def summary(message):
    print(message)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as stream:
            stream.write(message + "\n\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("zip", type=Path)
    parser.add_argument("commit")
    parser.add_argument('--function', choices=[FUNCTION, *NODE_FUNCTIONS], default=FUNCTION)
    parser.add_argument('--preflight', action='store_true', help='Validate artifact and AWS target without writes')
    args = parser.parse_args()
    function = args.function
    node = function in NODE_FUNCTIONS
    arn = f"arn:aws:lambda:{REGION}:{ACCOUNT}:function:{function}"
    runtime = 'nodejs24.x' if node else 'python3.12'
    handler = 'index.handler' if node else 'backend.lambda_function.handler'
    entry = NODE_FUNCTIONS[function] if node else 'backend/lambda_function.py'
    if not re.fullmatch(r"[0-9a-f]{40}", args.commit):
        raise RuntimeError("Expected a full commit SHA")
    with zipfile.ZipFile(args.zip) as archive:
        if archive.testzip() is not None:
            raise RuntimeError("ZIP integrity check failed")
        if archive.read("SOURCE_COMMIT").decode().strip() != args.commit:
            raise RuntimeError("Artifact does not match release commit")
        if entry not in archive.namelist():
            raise RuntimeError("Lambda handler missing")
        if node and archive.read('SOURCE_FUNCTION').decode().strip() != function:
            raise RuntimeError('Artifact belongs to a different function')
    # Never allow an old queued run to overwrite a newer main release.
    remote = subprocess.check_output(
        ["git", "ls-remote", "origin", "refs/heads/main"], text=True, timeout=30,
    ).split()
    if not remote or remote[0] != args.commit:
        raise RuntimeError("Main moved; release the current main commit instead")
    if aws("sts", "get-caller-identity")["Account"] != ACCOUNT:
        raise RuntimeError("Unexpected AWS account")
    before = configuration(function)
    if (before["FunctionArn"] != arn or before["Runtime"] != runtime
            or before["Handler"] != handler
            or before.get("PackageType") != "Zip"
            or before.get("State") != "Active"
            or before.get("LastUpdateStatus") != "Successful"):
        raise RuntimeError("Unexpected Lambda configuration or update in progress")
    if args.preflight:
        summary(f"Preflight passed: {function}; no AWS changes made.")
        return
    digest = base64.b64encode(hashlib.sha256(args.zip.read_bytes()).digest()).decode()
    if before["CodeSha256"] == digest:
        summary(f"{function} already has commit {args.commit}; no update.")
        return
    stable = ("Runtime", "Handler", "Role", "Environment", "MemorySize", "Timeout",
              "VpcConfig", "Layers", "Architectures", "KMSKeyArn", "DeadLetterConfig",
              "TracingConfig", "EphemeralStorage", "FileSystemConfigs", "SnapStart",
              "LoggingConfig")
    versions = aws("lambda", "list-versions-by-function", "--function-name", function)
    backups = [version for version in versions["Versions"]
               if version["Version"] != "$LATEST"
               and version["CodeSha256"] == before["CodeSha256"]
               and all(before.get(key) == version.get(key) for key in stable)]
    backup = max(backups, key=lambda version: int(version["Version"])) if backups else aws(
        "lambda", "publish-version", "--function-name", function,
        "--code-sha256", before["CodeSha256"], "--revision-id", before["RevisionId"],
        "--description", f"Before GitHub release {args.commit}")
    summary(f"Rollback backup: {function} version {backup['Version']}.")
    current = configuration(function)
    if (current["CodeSha256"] != before["CodeSha256"]
            or any(before.get(key) != current.get(key) for key in stable)):
        raise RuntimeError("Lambda changed during backup; release stopped")
    # No UpdateFunctionConfiguration, IAM, DynamoDB, S3 or API changes.
    aws("lambda", "update-function-code", "--function-name", function,
        "--revision-id", current["RevisionId"],
        "--zip-file", f"fileb://{args.zip.resolve()}",
        "--publish")
    aws("lambda", "wait", "function-updated", "--function-name", function)
    after = configuration(function)
    if (after["CodeSha256"] != digest or after["LastUpdateStatus"] != "Successful"
            or any(before.get(key) != after.get(key) for key in stable)):
        raise RuntimeError("Deployment verification failed; inspect Lambda and backup version")
    summary(f"Deployed {function} commit {args.commit}; CodeSha256 {digest}.")
    summary("Code identity/configuration verified. Application behavior requires manual review.")


if __name__ == "__main__":
    main()
