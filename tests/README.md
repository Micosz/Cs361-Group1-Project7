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
