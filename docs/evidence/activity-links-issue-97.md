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

## Integration — 13 ต.ค. 69

ต่อ plan_patch เข้ากับ durable Activity mutation และ transaction guards แล้ว
internal_links ใช้ trusted SessionContext/strong repository read ก่อนคืน labels/IDs;
เมื่อความสัมพันธ์เดิมอ่านไม่ได้ API ไม่คืน ID/ชื่อ และฟอร์มไม่ส่ง partial arrays ทับลิงก์เดิม
public_projection ใช้ public_links ซึ่งไม่อ่าน Agreements และคง activity_tags=[mou] ที่ตรวจรูปแบบแล้ว

ตัวเลือกใช้ protected lists ที่กรอง scopeId ฝั่ง server ก่อน count/pagination และฟอร์ม #96 เดิม
รายละเอียดกิจกรรมเปิด AgreementComponent เดิม ไม่มีฟอร์มข้อตกลงใหม่
เลือกถอด coHostPartnerIds/agreementIds ทั้งหมดได้โดยไม่ลบ records ต้นทาง

ตรวจรวม: backend 183 tests, npm test 10 ไฟล์, HTTP localhost smoke 3 tests และ git diff --check ผ่าน
เพิ่มเฉพาะ 2 integration tests สำคัญ: hidden references/unlink/no-delete และ scoped options/invalid refs/transaction race
แก้ fixtures ของ tests เดิมให้มี primary partner และไม่ใช้ primary ซ้ำเป็น co-host; คง assertions เรื่อง privacy/filters ไว้

เบราว์เซอร์ localhost ตรวจบันทึก History, สร้าง Agreement/Activity, เลือกข้อตกลงจาก options,
อ่านความสัมพันธ์กลับ, เปิด Agreement detail เดิม และถอดความสัมพันธ์จากฟอร์มแล้วอ่านกลับ
แก้การ refresh เมื่อ focus ให้ตรวจ Session โดยไม่ปิดรายละเอียด/ฟอร์มที่กำลังใช้งาน

ผลทั้งหมดเป็น local AWS doubles ยังไม่ได้ deploy/ตรวจ AWS HTTPS เพราะข้อจำกัดเดิมใน workspace-83-86-integration.md
Legacy primary IDs/co_hosts คง source เดิมและไม่เดา co-host IDs; การ migrate จริงยังต้องยืนยัน mapping/scope ตาม ADR
