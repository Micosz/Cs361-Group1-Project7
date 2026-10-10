# ผลตรวจส่วนแยกของ #97 — 9 ตุลาคม 2026

Branch: `97-Activity-Links` จาก main `2fc1d29`

## ผลที่ตรวจแล้ว

`python3 -m unittest discover -s backend/tests -p 'test_activity_links.py' -v` ผ่าน 5 tests:

1. แผน link/read/unlink หลาย partner และ agreement=[] โดยไม่แก้ input หรือลบ partner/agreement
2. ไม่รับ IDs ซ้ำ/ว่าง/หาย/ผิดประเภท/ผิด scope/ไม่มีสิทธิ์ รวม relationship patch ที่ส่ง server-owned fields
3. ตรวจสิทธิ์ target/public-facing edits และซ่อน unreadable agreement labels
4. Public ไม่มี agreement IDs/ชื่อ/count และไม่เรียกอ่าน agreement เลย; primary ไม่เผยแพร่ถูกตัดออก; dependency failure ไม่กลายเป็น empty success
5. ตรวจ partnerId และ co_hosts ของกิจกรรมใน public/data/partner-data-backup.json ทุกตัว: คง primary ID เก็บชื่อเป็น legacyCoHostNames ไม่เดา ID และไม่เปลี่ยน snapshot

ตัวอย่างก่อน/หลังและการเชื่อมต่ออยู่ใน [คู่มือ](../../backend/relationships/README.th.md)

`git diff --check` ผ่าน; ไม่มี dependencies หรือ credentials ใหม่

## ขอบเขตหลักฐาน

Tests ใช้ storage/policy doubles ไม่มี HTTP route จริง ไม่มี #79 runtime integration ไม่มี form/detail UI ใหม่ ไม่มี AWS/DynamoDB transaction หรือ migration/deployment ไม่ได้ใช้ CloudShell เพราะส่วนที่ทำเป็นโมดูลไม่แตะ infrastructure

ยังต้องให้ #94/#96/#98 ต่อ candidate options/form/storage และ #79 ต่อ permission/projection/transaction checks ตามคู่มือ ก่อนตรวจ Acceptance Criteria แบบ end-to-end หรือปิด Issue
