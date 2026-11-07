# S3 configuration references

These JSON files describe private document bucket settings. They do not automatically sync with AWS and are not yet an IaC stack.

See the [setup guide](../../docs/deployment/private-document-storage.md) for each file and application steps. The Lambda [version-read policy](../policies/lambda/runtime-version-read-policy.json) is stored with runtime IAM policies.

The settings target Singapore; the [25 October evidence](../../docs/evidence/s3-direct-upload-2026-10-25.md) records earlier Sydney checks, not current Singapore verification. Preserve unrelated bucket-policy statements and lifecycle rules when applying configuration.
