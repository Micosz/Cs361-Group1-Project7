# รวมงาน #83–#86 — 13 ต.ค. 69

คง AgreementRepository, ExchangeRepository, validators, ฟอร์มและ tests ของเพื่อน
เติมจุดต่อ Workspace และ adapter บันทึกถาวรโดยไม่แก้โค้ดโดยตรงบน main

## ผลที่ตรวจ

- Backend 160 tests รวม 4 integration tests สำคัญ: บันทึก/อ่านกลับข้าม adapter instance,
  retry ไม่สร้างซ้ำ, version เก่าถูกปฏิเสธ, เอกสาร participant, ถอนผู้เข้าร่วม,
  reference เปลี่ยนระหว่างเขียน, ถอนบทบาทระหว่าง upload และเก็บกวาดไฟล์ที่แนบไม่สำเร็จ
- npm test ผ่านทั้ง 8 ไฟล์เดิม/ฟอร์ม/เมนูร่วม; HTTP localhost smoke 3 tests ผ่าน
- เบราว์เซอร์ localhost: staff สร้าง Agreement, เปิดรายละเอียด, แนบ PDF และเห็น metadata อ่านกลับ;
  สร้าง Exchange ผ่านฟอร์มเดิมของเพื่อนและกลับหน้ารายการที่บันทึกแล้ว
- ทุกผลข้างต้นเป็น local/test doubles ของ AWS ไม่ใช่หลักฐาน deployment หรือ S3/DynamoDB จริง

## เปิดใช้บน AWS

Python handler เดิม `backend.lambda_function.handler` จะต่อ business adapter เมื่อกำหนด
`BUSINESS_TABLE`; ไม่ตั้งค่าแล้ว API business ยังตอบ 503 ตามเดิม ไม่ใช้ memory repository บน Lambda

1. ใช้ตาราง business แยกจาก auth tables: partition key `id` String,
   GSI `scope-entity-id` (หรือชื่อใน `BUSINESS_SCOPE_INDEX`) มี partition key `scopeEntity` String
   และ sort key `id` String, projection KEYS_ONLY; เปิด TTL `ttl` สำหรับ retry records
2. กำหนด `BUSINESS_TABLE`, `BUSINESS_SCOPE_INDEX`, `DOCUMENT_BUCKET` ใน Lambda เดิม
   ร่วมกับ config auth/session ที่มีอยู่; tables และ bucket ต้องอยู่ region เดียวกับ client
3. Bucket ต้องเปิด BlockPublicAcls, IgnorePublicAcls, BlockPublicPolicy,
   RestrictPublicBuckets ทั้งหมด และไม่เผยแพร่ URL สาธารณะ
4. Service role ต้องมี DynamoDB GetItem/Query (รวม index)/TransactWriteItems
   ใน business/user/session tables และ S3 GetBucketPublicAccessBlock/GetObject/PutObject/DeleteObject
   เฉพาะ bucket/prefix documents; ไม่ส่ง credentials ไป browser
5. Package Python backend พร้อม dependencies ใน backend/requirements.txt ลง Lambda auth ตัวเดิม
   workflow Node Lambda เดิมไม่ได้ deploy Python backend นี้ ไม่เปิด deployment อัตโนมัติแทนทีม
6. หากย้าย Partner/Activity จาก V2 ให้ใช้ mapping ที่ยืนยัน scope/ID/visibility/เจ้าของตาม
   docs/design/v3/architecture-migration.md; ไม่เดาผู้รับผิดชอบจากชื่อและไม่ overwrite V2
7. ตรวจ same-origin API route, create → detail → edit → status → upload → download,
   student A/B, executive read-only และ logout บน HTTPS จริงก่อนปิด acceptance Issues

GSI ใช้หาผู้สมัครรายการเท่านั้น ทุก record อ่านซ้ำแบบ strongly consistent ก่อนตรวจสิทธิ์;
รายการที่เพิ่งสร้างอาจรอ GSI ตาม eventual consistency แต่ detail อ่านตรงด้วย id ได้ทันที
การเขียนตรวจ user/session/target/parent/reference versions พร้อม transaction;
ถ้าจำนวน checks เกิน 100 จะปฏิเสธ 422 TOO_MANY_REFERENCES ก่อนเขียน

ไฟล์จำกัด 3 MiB ให้พอดี Lambda buffered request/response ที่ต้องมี base64 และ envelope
(เปลี่ยนจากเป้าหมาย 10 MiB ใน ADR เดิม; ยังไม่ได้ใช้ Lambda response streaming จริง):
[AWS Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html).
ดาวน์โหลดผ่าน authenticated API ทุกครั้งและบังคับ attachment; ไม่มี presigned/public URL
คำขอใหม่หลังถอนสิทธิ์ถูกตรวจใหม่ แต่ bytes ที่เริ่มส่งแล้วเรียกกลับไม่ได้

S3 และ DynamoDB ไม่ใช่ transaction เดียวกัน: upload ก่อน commit metadata และลบ object
เมื่อ commit ล้มเหลวแน่ชัด หาก timeout ต้องอ่าน metadata ยืนยันก่อนลบ;
กรณี process หยุด/การลบล้มเหลว ให้ผู้ดูแลเทียบ objectKey กับ metadata แล้วเก็บกวาดเฉพาะ
objects ที่ไม่มี metadata และอายุมากกว่า 24 ชั่วโมง ห้ามลบไฟล์ที่มี record พร้อมใช้งาน

## ทดลองในเครื่อง

```bash
python -m pip install -r backend/requirements.txt
python tools/mock-auth/server.py --workspace --port 8765
```

เปิด http://127.0.0.1:8765/login.html บัญชี staff/coordinator/student-a/student-b/executive
ใช้รหัสผ่าน `mock`; Partner จำลองใช้ `partner-demo` ข้อมูลทั้งหมดจำลองและ reset เมื่อ restart
บัญชี/ไฟล์จริงไม่ใช้ในเครื่องทดสอบนี้

## ข้อจำกัดที่ตรวจพบในรอบนี้

เครื่องไม่มี AWS credentials และ repository variable `LAMBDA_DEPLOYMENT_PAUSED=true`
จึงยังไม่ได้ตั้ง resources/config, deploy Python Lambda หรือยืนยัน production acceptance
ให้คง Issues ที่เกี่ยวข้องเปิดจนผ่านขั้นตอน AWS/HTTPS ข้างต้น
