"""Loopback-only browser fixture. Serve the real work page and AuthApplication with in-memory AWS ports."""

import argparse
import base64
import json
import ssl
import subprocess
import sys
from datetime import datetime, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import parse_qsl, urlsplit

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "backend/lambda/CSTUHubAuth"), str(ROOT / "tests/backend/CSTUHubAuth")]
from backend.auth.dynamo_accounts import DynamoAccounts
from backend.permissions.transactions import values
from support import mock_auth

START = int(datetime(2027, 5, 10, 3, tzinfo=timezone.utc).timestamp())
ACCOUNTS = [
    ("coordinator", "อาจารย์ผู้เสนอ (สมมติ)", "employee", ["coordinator"]),
    ("staff", "เจ้าหน้าที่หลักสูตร (สมมติ)", "employee", ["staff"]),
    ("helper", "อาจารย์ผู้ร่วมงาน (สมมติ)", "employee", ["coordinator"]),
    ("executive", "ผู้พิจารณาหลักสูตร (สมมติ)", "employee", ["executive"]),
    ("student-a", "นักศึกษาทดสอบ (สมมติ)", "student", ["student"]),
    ("other-scope", "เจ้าหน้าที่ต่างหลักสูตร (สมมติ)", "employee", ["staff"]),
]


class Fixture:
    def __init__(self, port):
        fixture_names = {row[0] for row in ACCOUNTS}
        mock_auth.CATALOG = [row for row in mock_auth.CATALOG if row[0] not in fixture_names] + ACCOUNTS
        self.app, users = mock_auth.make_app(port, writable=True)
        self.now = START
        self.app.repository.clock = self.app.sessions.clock = lambda: self.now
        user_store = self.app.accounts.store
        by_username = {u["username"]: u["id"] for u in users}
        user_store.rows[by_username["other-scope"]]["grants"][0]["scopeId"] = "another-course"
        db = self.app.repository.client
        db.rows.clear()
        partner = dict(id="partner-demo", entityType="partner", scopeId=mock_auth.SCOPE,
                       scopeEntity=mock_auth.SCOPE + "#partner", version=1, schemaVersion=3,
                       name="ศูนย์การเรียนรู้ลานดาว (สมมติ)", type="university", publication="public",
                       responsibleUserIds=[by_username["coordinator"], by_username["staff"], by_username["helper"]])
        db.rows[partner["id"]] = partner
        agreement = dict(id="agreement-demo", entityType="agreement", scopeId=mock_auth.SCOPE,
                         scopeEntity=mock_auth.SCOPE + "#agreement", version=1, schemaVersion=3,
                         title="ทะเบียนห้องเรียนชุมชนเดิม (สมมติ)", agreementType="MoU",
                         partnerIds=[partner["id"]], status="draft", startDate="2027-06-01", endDate="2027-11-15",
                         responsibleUserIds=[by_username["coordinator"]], publication="internal")
        db.rows[agreement["id"]] = agreement
        self.catalog = [dict(id=partner["id"], name=partner["name"], type="university", visibility="public")]

        def scan(TableName, **kwargs):
            rows = user_store.rows.values() if TableName == "users" else db.rows.values()
            kind = kwargs.get("ExpressionAttributeValues", {}).get(":kind", {}).get("S")
            return {"Items": [values(row) for row in rows if not kind or row.get("entityType") == kind]}

        db.scan = scan
        directory = DynamoAccounts(db, "users", "identities", "sessions")
        user_store.selection_users = directory.selection_users
        user_store.role_targets = directory.role_targets


class Handler(SimpleHTTPRequestHandler):
    def handle(self):
        try:
            super().handle()
        except (BrokenPipeError, ConnectionResetError, ssl.SSLEOFError):
            # Reloading/navigating aborts outstanding requests in Chromium.
            pass

    def log_message(self, *args):
        pass

    def reply(self, status, content, headers=None, cookies=()):
        self.send_response(status)
        for key, value in (headers or {"Content-Type": "application/json"}).items():
            self.send_header(key, value)
        for cookie in cookies:
            self.send_header("Set-Cookie", cookie)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def dispatch(self):
        uri = urlsplit(self.path)
        raw = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        if uri.path == "/__fixture/clock" and self.command == "POST":
            self.server.fixture.now = START + int(json.loads(raw)["offset"])
            return self.reply(200, json.dumps(self.server.fixture.now).encode())
        if uri.path == "/__fixture/reset" and self.command == "POST":
            self.server.fixture = Fixture(self.server.server_port)
            return self.reply(200, b"true")
        if uri.path == "/fetchPartnersData":
            return self.reply(200, json.dumps(self.server.fixture.catalog).encode())
        if not uri.path.startswith("/api/"):
            if self.command == "GET":
                return super().do_GET()
            return self.send_error(404)
        binary = self.headers.get("Content-Type", "").startswith("multipart/")
        event = dict(version="2.0", rawPath=uri.path, queryStringParameters=dict(parse_qsl(uri.query)),
                     requestContext={"http": {"method": self.command, "sourceIp": "127.0.0.1"}},
                     headers={k.lower(): v for k, v in self.headers.items()}, isBase64Encoded=binary,
                     body=base64.b64encode(raw).decode() if binary else raw.decode())
        result = self.server.fixture.app.handle(event)
        content = result.get("body", "")
        content = base64.b64decode(content) if result.get("isBase64Encoded") else content.encode()
        return self.reply(result["statusCode"], content, result["headers"], result.get("cookies", []))

    do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = dispatch


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=4178)
    args = parser.parse_args()
    with TemporaryDirectory() as tmp, ThreadingHTTPServer(
        ("127.0.0.1", args.port), partial(Handler, directory=str(ROOT / "public"))
    ) as server:
        cert, key = (str(Path(tmp) / name) for name in ("cert.pem", "key.pem"))
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                        "-keyout", key, "-out", cert, "-subj", "/CN=127.0.0.1",
                        "-addext", "subjectAltName=IP:127.0.0.1"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        ssl_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ssl_ctx.load_cert_chain(cert, key)
        server.socket = ssl_ctx.wrap_socket(server.socket, server_side=True)
        server.fixture = Fixture(args.port)
        server.serve_forever()
