# Tests

รวมชุดทดสอบทั้งหมดไว้ที่นี่ โดยแยกตามส่วนของระบบ และคงเคสเดิมไว้

| ตำแหน่ง | ขอบเขต |
| --- | --- |
| `frontend/` | Node.js tests ของหน้าเว็บ ฟอร์ม สิทธิ์ใน UI เอกสาร Feedback และ public catalog |
| `backend/CSTUHubAuth/` | Python tests ของ auth/session, permissions, business APIs และ storage adapters |
| `backend/CSTUHubAuth/fixtures/` | ข้อมูลจำลองสำหรับ backend |
| `backend/CSTUHubAuth/support/` | ตัวช่วยจำลอง auth และ storage |
| `run-backend.py` | ตั้ง import path และค้นหา Python tests |

## เตรียมและรันจาก root ของ repository

ใช้ Node.js 24 และ Python 3.12+ พร้อม dependencies ของ backend:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/lambda/CSTUHubAuth/requirements.txt
source .venv/bin/activate
npm test
```

- `npm test`: รัน frontend และ backend ทั้งคู่ แม้ชุดแรกไม่ผ่าน; จบด้วย exit code ที่ไม่ใช่ศูนย์หากชุดใดไม่ผ่าน
- `npm run test:frontend`: รันเฉพาะ frontend
- `npm run test:backend`: รันเฉพาะ backend
- หากไม่ได้ activate venv ใช้ `PYTHON=.venv/bin/python npm test` (macOS/Linux)
- เลือก backend เฉพาะไฟล์: `.venv/bin/python tests/run-backend.py -p test_activity_links.py -v`
- เลือก frontend เฉพาะไฟล์จาก root: `node --test tests/frontend/public-data.test.cjs`

Python runner จัด path ให้ production package `backend` ชี้ไปที่ `backend/lambda/CSTUHubAuth/backend/` และ test helpers ชี้ไปที่ชุดทดสอบ ไม่ต้องคัดลอก source เข้ามาใน tests

## สถานะตอนย้ายโครงสร้าง — 8 พฤศจิกายน 2026

เทียบก่อนและหลังย้าย: frontend 35 เคส ผ่าน 27 ไม่ผ่าน 8; backend 238 เคส ผ่าน 236 ไม่ผ่าน 2 ไม่มีเคสหายหรือ failure เพิ่ม

- Frontend failures เดิม: Feedback Inbox 3 เคส, Feedback 2 เคส, partner create permission/menu 1 เคส และ executive role/menu 2 เคส
- Backend failures เดิมใน `test_feedback.py`: `test_parent_mismatch_cross_scope_and_wrong_parent_type` และ `test_staff_can_edit_only_feedback_they_created_and_inbox_is_scoped`
- คง assertions เดิมไว้ ต้องตรวจเทียบข้อกำหนดก่อนตัดสินว่าแก้ implementation หรือความคาดหวังของ test

ชุดนี้ใช้ mocks/stubs ไม่ใช่การยืนยันระบบบน AWS จริง GitHub Actions ปัจจุบันยังตรวจ syntax/แพ็ก/deploy เท่านั้น ยังไม่ได้รันชุดทดสอบเหล่านี้

## การเพิ่ม tests

เพิ่ม frontend เป็น `frontend/*.test.cjs` และ Auth backend เป็น `backend/CSTUHubAuth/test_*.py` ได้เลย runner จะค้นหาให้ ส่วน Lambda ตัวอื่น, deployment และ browser E2E ค่อยเพิ่มหมวดและคำสั่งเมื่อมีชุดจริง ไม่สร้างโฟลเดอร์ว่างหรือกล่าวอ้างว่าครอบคลุมแล้ว

Tests อยู่นอก `public/` และนอก source root ที่ packager ใช้ จึงไม่ถูกส่งเป็นเว็บหรือโค้ด Lambda หลักฐานคำสั่งเก่าใน `docs/evidence/` คงไว้เป็นประวัติ; ใช้คำสั่งในหน้านี้สำหรับโครงสร้างปัจจุบัน

## SetupTest — รอบที่ 1: การนำทาง Feedback จากหน้าสาธารณะ

แก้เคสแรกใน `frontend/feedback-inbox.test.cjs` ให้ตรงกับการแยกหน้าตามบทบาท: Executive บนหน้าสาธารณะเห็นลิงก์ `work.html` แทน Menu เดิม ตรวจว่าลิงก์นี้ถูกต้องและไม่แสดงปุ่ม Menu เก่า พร้อมคงการตรวจลิงก์ Feedback เดิม การแสดง Inbox และปุ่มกลับ Information Board ครบ ไม่แก้ production code

ผลตรวจ 8 พฤศจิกายน 2026: เคสนี้ผ่าน; frontend รวม 35 เคส ผ่าน 28 ไม่ผ่าน 7 (เคสอื่นเดิม) ส่วน backend ไม่เปลี่ยนและไม่ได้รันซ้ำในรอบนี้ ผล baseline ด้านบนยังเป็นประวัติก่อนแก้

## SetupTest — full test pipeline

The historical baseline above is retained for comparison. Current commands:

| Command | Scope |
| --- | --- |
| `npm test` | Frontend (35), Auth Python (238), three Node Lambdas (9), deployment (8) |
| `npm run test:backend` | All four Lambda suites |
| `npm run test:lambda` | Three Node Lambda handlers |
| `npm run test:deployment` | Real isolated Git/ZIP packaging and mocked AWS release guards |
| `npm run test:e2e` | Chromium browser workflows against local production HTML/JS |
| `npm run test:ci` | All code suites followed by browser workflows |

First install `npm ci`, the Python requirements above, and `npx playwright install chromium` (Linux CI uses `--with-deps`). `PYTHON` can select your virtual environment. Playwright builds `work.html` and starts its own loopback-only server. Browser API responses are deterministic fixtures; all external browser requests are blocked. These tests do not log in to TU, write AWS data or establish that live infrastructure is configured correctly.

Browser checks cover catalog search/detail, invalid and successful login, CSRF submission, credential storage, internal navigation for coordinator/staff/executive, anonymous/student redirects and session-failure recovery. Python suites cover business CRUD, scope/role enforcement, documents and storage with fakes. Node suites execute production handlers with fake DynamoDB/TU boundaries, including pagination, private/retired record exclusion, provider failures and timeout.

ZIP checks use a temporary Git repository, package committed Python source, import `backend.lambda_function.handler` from the ZIP, compare deterministic output, and reject dirty/invalid source or unsafe output paths. Release tests cover commit/handler identity, account/runtime/state, current main, backup-before-update, revision races, no-op and deployed hash mismatch. Only CSTUHubAuth currently has a deployment packager; the other three handlers are tested from source, not deployed ZIPs.

CI runs on every PR and pushes to `main`/`SetupTest`. Both code and browser jobs must pass before packaging; production Auth deployment additionally requires main and a non-PR event. Test jobs have no AWS credentials. Amplify preBuild runs frontend and Node Lambda tests before building. Full merge enforcement still requires repository branch protection to mark CI checks required; this change does not modify repository rules or enable deployment of the other three Lambdas.

Updated old UI assertions follow separate public/work pages and the shared public Feedback component. API assertions reflect partner Feedback and scoped coordinator Inbox support while retaining cross-scope/author restrictions. A real regression found by the new tests was fixed: getPublicPartners now reads every DynamoDB scan page, handles absent Items, and excludes retired records.
