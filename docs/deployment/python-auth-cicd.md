# Config deploy Python CSTUHubAuth

`.github/workflows/deploy-python-auth.yml` ทดสอบ backend บน PR/push main และสั่งรันเองได้
เฉพาะ main จึง deploy โดยใช้ Secrets Learner Lab เดิมทั้งสามตัว และเคารพ
`LAMBDA_DEPLOYMENT_PAUSED=true` รวมถึงการสั่งรันเอง ค่า pause ไม่ถูกเปลี่ยนโดย workflow นี้

## ก่อนเปิด deploy

- ตั้ง repository variable `CSTUHUB_API_ORIGIN` เป็น origin HTTPS ของเว็บจริง ไม่มี path หรือ slash ท้าย
  ต้องตรงกับ `SESSION_ORIGIN` ใน Lambda และมี same-origin `/api/*` routing ไป CSTUHubAuth
- Function เดิมต้องเป็น Python 3.12, Zip, handler `backend.lambda_function.handler`, ไม่มี layers
  รองรับ x86_64/arm64 ตาม architecture เดิม ไม่เปลี่ยน runtime, role, environment หรือ API routing
- ตั้ง auth environment และตารางตาม [auth integration](auth-integration.md) พร้อม `AUTH_V3_ENABLED=true`
- เตรียม `BUSINESS_TABLE`, GSI และ `DOCUMENT_BUCKET` ตาม
  [workspace storage](../evidence/v3-evidence.md#workspace-83-86-integration-เปิดใช้บน-aws)
  ก่อนเปิด deployment: business PK `id` String, GSI `scopeEntity` String + `id` String,
  projection KEYS_ONLY, TTL `ttl`; session TTL ใช้ `ttl`, login rate TTL ใช้ `expiresAt`
  bucket region us-east-1 และเปิด public access blocks ทั้งสี่
- Role ของ workflow ต้องอ่าน Lambda config, DynamoDB DescribeTable/DescribeTimeToLive,
  S3 GetBucketLocation/GetBucketPublicAccessBlock และอัปเดต code ของ CSTUHubAuth ได้
  Execution role ของ Lambda ต้องมีสิทธิ์ business/document เดิมตามคู่มือ storage ด้วย
  การตรวจ schema ไม่ยืนยันสิทธิ์อ่านเขียนของ execution role
- Credentials ต้องยังไม่หมดอายุ ไม่สร้าง IAM user/role/OIDC ใหม่ และไม่สร้างตาราง/bucket อัตโนมัติ

เมื่อทรัพยากร/config พร้อม ให้ผู้ดูแลเปลี่ยน `LAMBDA_DEPLOYMENT_PAUSED` เป็น `false`
แล้วสั่ง workflow นี้จาก main ล่าสุด (การเปลี่ยน variable อย่างเดียวไม่ trigger run)
**ค่า pause นี้ใช้ร่วมกับ Node workflow** จึงเปิด deploy Node ใน push ที่ตรง path ด้วย

## สิ่งที่ workflow ตรวจ

ทดสอบ backend → ตรวจว่า commit ยังเป็น main ล่าสุดและอ่าน config แบบไม่แสดง secrets →
แพ็ก dependencies ทั้งชุดตาม Python/architecture เดิม พร้อม tracked Python source ใน `backend/`
โดยไม่รวม tests, Node source, bytecode หรือไฟล์ตั้งค่าลับ → ตรวจตาราง/index/TTL/private bucket →
ตรวจ ZIP CRC/ขนาด → update `$LATEST` ด้วย RevisionId → ตรวจ checksum →
ตรวจ HTTPS `/api/auth/session` ไม่ตาม redirect ต้องเป็น anonymous JSON/no-store มี CSRF และ Secure HttpOnly cookie

Session smoke สร้าง anonymous session หนึ่งรายการซึ่งหมดอายุตาม TTL ไม่ส่งบัญชี TU/password
ไม่ใช่ acceptance ของ login, CRUD, upload/download หรือการตรวจสิทธิ์ทุกบทบาท
หาก API ใช้ alias/published version ต้องจัด release routing แยกก่อนอ้างว่า API ใช้ code ใหม่
checksum ของ `$LATEST` และ session smoke เพียงอย่างเดียวไม่ยืนยันว่า alias ชี้ commit นี้

หากขั้นตอนหลัง update ล้มเหลว code อาจเปลี่ยนแล้ว ให้ตรวจ AWS/API ก่อน rerun ไม่มี automatic rollback
workflow ปฏิเสธ rerun commit เก่าหาก main เดินหน้าไปแล้ว Configuration JSON และ ZIP อยู่เฉพาะ runner temp
และลบในขั้นตอนท้าย ไม่อัปโหลดเป็น artifacts

อ้างอิงรูปแบบ ZIP/dependencies/architecture: [AWS Python packaging](https://docs.aws.amazon.com/lambda/latest/dg/python-package.html)
