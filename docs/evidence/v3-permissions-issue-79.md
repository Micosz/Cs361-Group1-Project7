# หลักฐานตัวตรวจสิทธิ์ #79

วันที่ 8 ตุลาคม 2026; baseline V3-B1; branch `79-permissions` ต่อจาก `78-session` commit `8f920db` ผลนี้เป็น local tests ด้วยข้อมูลจำลอง ไม่ใช่ Production/AWS/TU

## ผลตรวจ

- Python 3.14.7: `python3 -m unittest discover -s backend/tests -q` ผ่าน 63 tests (เดิม #78 จำนวน 33 และ #79 จำนวน 30; policy matrix ตรวจหลายชุดย่อยภายใน test)
- `npm test` ผ่าน 44 tests ครบ 3 ไฟล์ของ frontend เดิม
- `git diff --check` ผ่าน
- CI กำหนด Python 3.12; ผล CI จริงให้ดู checks ใน draft PR ไม่อนุมานจาก local tests

## กรณีที่ยืนยันใน local

| กลุ่ม | ผลที่ตรวจ |
| --- | --- |
| Session | missing/anonymous/tampered/expired/revoked ถูกปฏิเสธ ไม่มี fallback |
| Role/action | matrix ทุก business resource; no-role และ provisional ไม่มีสิทธิ์; executive/student ไม่มี write |
| Scope/record | บัญชี A/B, คนละหลักสูตร, createdBy ไม่ให้สิทธิ์, legacy ไม่มี owner ไม่เปิดสิทธิ์, mixed roles ไม่ยืม scope |
| Fields | role/server-owned/assignment/publication injection, unknown fields, coordinator แก้ public display fields ไม่ได้ |
| HTTP | list/detail/create/update/status ทุก business group, contact/history parent tamper, document upload/read/content, My Exchange หลายบทบาทยังใช้ participant projection |
| Data boundary | student/executive ไม่มี personal IDs/notes, metadata ไม่คืน objectKey/hash, raw nested objects ไม่หลุด, public flags ขัดกันและ orphan/internal partner ถูกตัด |
| Search/count/page | authorization/projection ก่อน q/count/page, ค้น internalNote ไม่เจอ, cursor ต่าง Session/query ใช้ไม่ได้ |
| Mutation | CSRF/Origin/If-Match/idempotency key ต้องผ่านก่อน side effect; test-only repository จำลอง role withdrawal/logout/assignment race แล้วไม่เขียน |
| DynamoDB | ตรวจโครงสร้าง user/session/parent checks และ target condition ไม่ได้ส่ง transaction ไป AWS |
| Errors | dependency ล้มเหลวให้ 503 ไม่มี secret จาก exception ใน response |

## ข้อจำกัดของหลักฐาน

Test-only repository อยู่ใน `backend/tests/test_permissions.py` เท่านั้น เพื่อทดสอบขอบเขต HTTP และจำลอง transaction races ไม่ใช่ implementation storage จริง ไม่ยืนยัน atomic guarantees ของ DynamoDB ที่ deploy อยู่ และไม่ได้ทดสอบ validation/transition/idempotency replay/file bytes ที่เป็นหน้าที่ feature adapters

Public projection ถูกทดสอบเป็นฟังก์ชัน ยังไม่ได้เชื่อม public Lambda/backup workflow เดิม API ธุรกิจที่ deploy อยู่จึงยังไม่ได้รับการรับรองจากงานนี้ ต้องทำ integration ตาม [คู่มือ #79](../../backend/permissions/README.th.md) และตรวจ HTTPS/Production ก่อนปิด issue
