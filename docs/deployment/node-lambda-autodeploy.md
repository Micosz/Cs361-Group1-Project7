# Four-Lambda automatic deployment

The `AutoDeploymentLambda` branch extends the existing Auth release pipeline to `tuAuthLogin`, `fetchPartnersData`, and `getPublicPartners`. It does not create infrastructure or change Lambda environment variables, execution roles, API routes, aliases, tables or buckets.

## One-time AWS setup before merging

The existing GitHub role is intentionally still named `CSTUHubGitHubAuthDeployRole`. Its trust policy remains restricted to main. Apply the updated [code-only IAM policy](../../deploy/policies/github/github-auth-deploy.json) to that role with an authorized AWS administrator. Committing JSON does not apply it. If using an inline policy, replace the existing code-deployment policy, using its actual policy name; do not remove unrelated permissions. The new resource list contains only the four named function ARNs in account `781485979426`, Singapore (`ap-southeast-1`). No wildcard, IAM administration, secret-reading or configuration-write permission is added.

Verify each Node target exists with `Runtime=nodejs24.x`, `Handler=index.handler`, `PackageType=Zip`, `State=Active`, and `LastUpdateStatus=Successful`. Node 24 is a release contract based on the repository baseline, **not a live AWS observation**. If a target differs, inspect it and update the reviewed release contract/build/tests together; this workflow never changes the runtime to force deployment through.

Read only the needed metadata (do not export secret environment values):

```sh
aws sts get-caller-identity
aws lambda get-function-configuration --function-name tuAuthLogin --region ap-southeast-1 \
  --query '{FunctionArn:FunctionArn,Runtime:Runtime,Handler:Handler,PackageType:PackageType,State:State,LastUpdateStatus:LastUpdateStatus}'
```

Repeat the second command for both catalog Lambdas. Also confirm the API integrations and the Auth-to-TU invocation use the intended unqualified function. This code-only workflow updates `$LATEST` and publishes a version; an API pinned to a version/alias will not automatically follow it.

Local AWS credentials were unavailable when implementing this branch. IAM application, target configuration and live deployment remain unverified. The prior Auth main release succeeded; that does not establish access to the other three functions.

## Pipeline and artifacts

1. PRs and pushes to main/SetupTest/AutoDeploymentLambda run code and browser tests without AWS credentials.
2. Only after both pass, package Auth and three Node ZIPs from committed HEAD. Artifact names include the Git SHA; retention is seven days.
3. Node packaging puts `index.mjs` or `index.cjs` at the ZIP root with `SOURCE_COMMIT` and `SOURCE_FUNCTION`. It syntax-checks all bundled project modules and imports the entry to verify a callable handler without invoking it.
4. Catalog packages install production dependencies from the committed root package-lock using `npm ci --omit=dev --ignore-scripts`. They bundle AWS SDK v3, so they do not depend on an unspecified SDK version supplied by Lambda. tuAuthLogin uses built-in Node APIs and needs no node_modules.
5. The deploy job runs only on main (push or manual dispatch). It checks every artifact and target before any update, then releases TU, both catalog functions and Auth in order. The existing concurrency group is kept so old Auth and new releases cannot overlap.
6. For each target it rechecks current main and AWS account/runtime/handler, records or creates a matching backup version, updates with RevisionId and `--publish`, waits, and verifies the deployed hash and unchanged configuration.

The preflight is read-only and validates target/artifact identity, not every IAM write permission. A failure stops later updates; a four-function release is **not atomic**. Earlier successful function updates remain in place. Version backup is not automatic rollback or a business-level smoke test. Follow the [V4 rollback procedure](v4-deployment.md), substituting the specific function name and recorded backup version; do not restore an alias that the application does not use.

## Manual packaging / verification

From a clean committed checkout, with Node 24 and Python 3.12:

```sh
python scripts/package-node-lambda.py tuAuthLogin /tmp/tuAuthLogin.zip
python scripts/package-node-lambda.py fetchPartnersData /tmp/fetchPartnersData.zip
python scripts/package-node-lambda.py getPublicPartners /tmp/getPublicPartners.zip
python deploy/deploy-auth.py /tmp/tuAuthLogin.zip "$(git rev-parse HEAD)" --function tuAuthLogin --preflight
```

Output paths must be new and outside the repository. Packaging rejects dirty source/lockfile inputs, invalid syntax and missing handler exports. It never reads `.env` files or copies the local workspace's node_modules. Npm package downloads require network access; use `npm_config_cache` to choose a writable cache when needed.

`deploy/deploy-auth.py` retains its historical filename and default Auth target for compatibility. `--function` only accepts the four allowlisted names; the default Auth command stays unchanged. All releases use the same guarded implementation.

## Tests

`npm run test:deployment` adds Node ZIP layout, commit/function identity, deterministic output, extracted handler import, dirty-input rejection and invalid-source tests. It also applies the shared backup/race/account/commit/hash regression tests to a Node target, checks read-only preflight and rejects wrong-function artifacts and runtime mismatches. CI additionally builds the real three ZIPs with locked SDK dependencies, not just test fixtures.
