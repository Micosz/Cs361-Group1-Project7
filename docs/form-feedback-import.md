# นำเข้าผลตอบรับจากแบบฟอร์ม — #205

ในรายละเอียดคู่ความร่วมมือ กิจกรรม หรือการแลกเปลี่ยน มีแท็บ **ผลตอบรับจากแบบฟอร์ม** ตามแบบที่ 1: แถบชื่อฟอร์ม วันที่นำเข้า ประเภทผู้ตอบ จำนวนคำตอบ กดขยายอ่านรายคน และลบทั้งชุดหลังยืนยันได้

## วิธีใช้

1. กด **นำเข้าแบบฟอร์ม** แล้วเลือก `.xlsx` หรือ CSV แบบ UTF-8 ที่ดาวน์โหลดจาก Google Forms (ไม่ต้องเปิด Excel)
2. ตั้งชื่อฟอร์ม เลือกคู่ความร่วมมือ/ผู้เข้าร่วม/อื่น ๆ เลือกชีต แถวหัวคำถาม และคอลัมน์เวลาตอบถ้ามี
3. เลือกคอลัมน์ที่จะเก็บ ระบบเว้นหัวคอลัมน์ที่ดูเป็นชื่อ/อีเมล/ข้อมูลส่วนบุคคลไว้ก่อน แต่ต้องตรวจเองอีกครั้ง
4. ดูตัวอย่างและจำนวนแถวก่อนยืนยัน: หนึ่งแถวเป็นหนึ่งผู้ตอบ คำถามแสดงตามคอลัมน์ที่เลือก เว้นคำตอบว่าง และข้ามแถวที่ไม่มีคำตอบที่เลือกเลย

อ่านข้อมูลตรงจากเซลล์ ไม่ใช้ AI ไม่คำนวณสูตรใหม่ และไม่เดาความหมายคำถาม ค่าจากสูตรใช้ค่าที่บันทึกไว้ในไฟล์ หากไม่มีค่าจะเป็นช่องว่าง เวลาตอบเก็บเป็นข้อความตามไฟล์โดยไม่เดารูปแบบวัน/เดือน

## ข้อมูลและสิทธิ์

- ไฟล์ต้นฉบับอ่านในเครื่องผ่าน Web Worker; ส่งเฉพาะคอลัมน์และคำตอบที่เลือก ไม่อัปโหลด workbook ไป S3
- เก็บชุดคำตอบเป็น `entityType=formFeedback` ใน Business table เดิม (`BUSINESS_TABLE`): ชื่อฟอร์ม ไฟล์/ชีต ผู้และเวลานำเข้า ประเภทผู้ตอบ หัวคำถาม คำตอบ เวลาตอบ และเลขแถวต้นฉบับ
- แต่ละชุดบันทึกเป็นรายการเดียวแบบ atomic พร้อมตรวจ session, user, parent/version; ล้มเหลวแล้วไม่มีคำตอบครึ่งชุด
- อ่านแบบฟอร์มได้สำหรับ coordinator/staff/executive ใน scope เดียวกัน แม้ไม่ได้รับผิดชอบรายการ (#206) สิทธิ์นำเข้าและลบยังเป็นกติกาเดิม นักศึกษา/บุคคลทั่วไปอ่านไม่ได้ ประเภทผู้ตอบไม่ได้เพิ่มสิทธิ์
- หน้ารวม Feedback แยกความคิดเห็นบนเว็บ/รายการเดิมออกจากแบบฟอร์มนำเข้า ยังไม่นำคำตอบต่างแบบฟอร์มไปนับคะแนนรวม
- กันชุดซ้ำในรายการหลักเดียวกันจากหัวคำถาม คำตอบ และเวลาตอบตามลำดับ แม้เปลี่ยนชื่อไฟล์/ชื่อฟอร์ม/ประเภทผู้ตอบ; ไม่ตรวจซ้ำบางแถวระหว่างไฟล์คนละชุด
- ลบทั้งชุดต้องยืนยันและใช้ version ปัจจุบัน ไฟล์ต้นฉบับของผู้ใช้ไม่ถูกลบ

## ขอบเขตและการนำขึ้นระบบ

- ไฟล์ไม่เกิน 5 MiB, 30 ชีต, 2,000 แถวข้อมูล/100 คอลัมน์ต่อชีต; นำเข้าครั้งละไม่เกิน 1,000 คำตอบ และ JSON ที่เลือกไม่เกิน 200 KiB เพื่อให้พอดีกับ DynamoDB item เดียว หากเกินจะปฏิเสธและแจ้งให้แบ่งไฟล์ ไม่ตัดข้อมูลทิ้ง
- API: `GET/POST /api/{partners|activities|exchanges}/{id}/form-feedback`, `GET/DELETE .../form-feedback/{batchId}`; ใช้ CSRF, Idempotency-Key, If-Match และ `no-store` ตามระบบเดิม
- ต้องปล่อย frontend และ `CSTUHubAuth` จาก commit เดียวกัน ใช้ตาราง/index และสิทธิ์ DynamoDB เดิม ไม่มี Google OAuth หรือบริการ AWS ใหม่
- PR นี้ตรวจด้วยข้อมูลจำลองในเครื่อง ยังไม่ได้ deploy หรือยืนยันกับ AWS จริง หลัง merge ให้ตรวจสถานะ deploy ทั้งสองส่วนและลองไฟล์จริงหนึ่งชุด (รวมข้อจำกัด request body ของ WAF/API ที่ใช้งานอยู่)
- ย้อนกลับด้วย revert commit และ deploy ทั้งสองส่วนใหม่ ข้อมูล `formFeedback` ที่นำเข้าแล้วจะยังอยู่ใน Business table แต่ UI เก่าจะไม่แสดง

## Shared feedback archive — #206

- The Feedback inbox separates web/legacy comments from internal form imports. Search imports by form name, related work, or importer. Lists load 20 batches per page; answers load on expansion through the existing nested endpoint.
- `GET /api/form-feedback` returns authorized metadata and parentTitle, without rows/columns. Only coordinator/staff/executive grants in the same scope participate in the inbox.
- Those roles can read imported feedback even without assignment. Import/delete permissions remain unchanged; shared read does not grant access to the parent record, other private documents, or writes.
- Internal feedback here is `formFeedback`. Existing `feedback` student rules remain unchanged; imported answers never enter the public comments endpoint.
- Reassignment preserves stored imports and provenance. Every answer expansion rechecks authorization; logout/account changes clear rendered answers.
- Deploy frontend and backend together. This change has only been checked locally with synthetic data, not production.
- Local checks: unassigned coordinator read succeeds while import/delete/parent read fail; students, revoked roles, and cross-scope reads fail. No new test files added.
