# Backend functions

Each deployable Lambda has its own directory under `lambda/`.

| Directory | Runtime / purpose |
| --- | --- |
| [CSTUHubAuth](lambda/CSTUHubAuth/) | Python application: sessions, permissions and business APIs |
| [tuAuthLogin](lambda/tuAuthLogin/) | Node.js TU authentication adapter |
| [fetchPartnersData](lambda/fetchPartnersData/) | Node.js partner data endpoint |
| [getPublicPartners](lambda/getPublicPartners/) | Node.js public partner endpoint |

CSTUHubAuth retains a nested `backend/` Python package so imports and the AWS handler
`backend.lambda_function.handler` stay unchanged. The packager strips the function
directory prefix and includes `backend/` at the ZIP root, excluding tests.

From the repository root, run Python tests with Python 3.12+:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/lambda/CSTUHubAuth/requirements.txt
.venv/bin/python tests/run-backend.py
```

Deploy packaging is still run from the repository root:

```sh
python3 scripts/package-auth-lambda.py /tmp/auth-release.zip
```

The package command reads committed source. GitHub Actions currently deploys only
CSTUHubAuth; the other three functions retain their separate release procedures.
