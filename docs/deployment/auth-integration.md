# การรวมระบบยืนยันตัวตน #74–#80 และสิ่งที่ต้องตั้งค่าใน #81

## สถานะหลังรวมโค้ด

รวม source ของ #74–#80 พร้อมตัวเชื่อมที่ใช้สัญญาข้อมูลเดียวกันแล้ว ยังไม่เปิดระบบใหม่บน AWS ตามข้อตกลงของทีม

- `public/assets/auth-config.js` มี `enabled: false` หน้า Browse/Search และ Login เดิมจึงยังทำงานแบบเดิม
- Backend ต้องตั้ง `AUTH_V3_ENABLED=true` จึงเปิด orchestration ใหม่ การเปลี่ยน frontend เพียงอย่างเดียวไม่เปิด backend
- ตั้ง GitHub repository variable `LAMBDA_DEPLOYMENT_PAUSED=true` ก่อน merge เพื่อพัก workflow deploy ทั้งสาม Lambda จนเตรียม AWS ใน #81 เสร็จ CI ตรวจโค้ดยังทำงานตามปกติ
- Python backend ยังไม่มี workflow deploy ของตัวเอง ต้องเตรียมแพ็กเกจ/ทรัพยากรใน #81

## Flow และไฟล์ที่ทีมต้องใช้

1. `public/assets/login.js` เรียก `auth-client.js` เพื่อขอ anonymous Session/CSRF แล้วส่ง username/password ไป `POST /api/auth/login` บน origin เดียวกับเว็บ
2. `backend/application.py` ตรวจ Origin, CSRF และ rate limit ก่อนตรวจบัญชี TU
3. `backend/auth/tu_provider.py` เรียก Lambda `tuAuthLogin` ผ่าน AWS IAM แบบ RequestResponse ฝั่ง server โดยใช้ implementation #75 ใน `backend/lambda/tuAuthLogin/index.mjs` ซึ่งตรวจ `status === true` จาก TU API แล้วคืน `success: true` พร้อม profile
4. `backend/auth/accounts.py` ผูกบัญชีจาก profile ที่ server ตรวจแล้ว สร้าง User และ IdentityLink พร้อมกันด้วย DynamoDB transaction
5. `backend/auth/session_service.py` หมุน Session และออก HttpOnly Secure cookie; browser ไม่เก็บ token, บทบาท หรือรหัสผ่านใน localStorage
6. `backend/auth/roles.py` ตรวจ scoped capability `manageRoles` ก่อนเปลี่ยนบทบาท เพิ่ม `authzVersion` พร้อมบันทึกข้อมูล ทำให้ Session เก่าถูกปฏิเสธเมื่อใช้ครั้งถัดไป
7. `public/workspace.html` และ `assets/workspace.js` เป็น landing ตามบทบาทและหน้าจอจัดการบทบาท ยังไม่ใช่การสร้างระบบธุรกิจของ issues อื่น

แทนที่ `api/authHandler.js`, `api/roleHandler.js` และ `scripts/setFirstAdmin.js` ด้วย Python adapters ข้างต้น เนื่องจาก implementation เดิมใช้ schema และวิธีตรวจสิทธิ์ไม่ตรงกับ #78/#79 ใช้ `scripts/bootstrap_role_manager.py` สำหรับผู้ดูแลคนแรกแทน (dry run เป็นค่าเริ่มต้น)

## สัญญาข้อมูล

ใช้ตารางแยกกัน ไม่มีการสร้างตารางหรือย้ายข้อมูลอัตโนมัติ:

| Environment variable | Partition key / การใช้งาน |
| --- | --- |
| `USER_TABLE` | `id` String; UUID, displayName, active, identityVerified, authzVersion, tuType, subjectKey, grants, capabilities |
| `IDENTITY_TABLE` | `subjectKey` String; provider=tu, userId, verification=verified หรือ provisional |
| `SESSION_TABLE` | `tokenHash` String; schema/TTL ตามเอกสาร #78 |
| `LOGIN_RATE_TABLE` | `key` String; attempts, TTL `expiresAt` |

`subjectKey` ใช้ HMAC-SHA256 ของ TU username ตรงตามที่ provider ยืนยัน ไม่จับคู่ด้วยชื่อ/email และไม่บันทึก username ดิบ เปลี่ยน `IDENTITY_HMAC_SECRET` ไม่ได้โดยไม่วางแผนย้าย mapping เพราะจะกลายเป็นคนละบัญชี

นักศึกษาได้รับ student grant เฉพาะ `STUDENT_SCOPE_ID` ตอนสร้างบัญชีครั้งแรก การ Login ซ้ำไม่คืนสิทธิ์ที่ถูกถอนหรือเปิดบัญชีที่ถูกปิด พนักงานเริ่มด้วย identity แบบ provisional และไม่มีบทบาท ผู้ดูแลต้องยืนยันตัวบุคคลก่อนมอบบทบาท การเป็น staff/executive ไม่ให้สิทธิ์จัดการบทบาทอัตโนมัติ และผู้ดูแลเพิ่มสิทธิ์ให้ตัวเองผ่าน API ไม่ได้

## ขั้นตอนที่เหลือใน #81

1. ตรวจ `tuAuthLogin` #75 บน AWS ว่า runtime/handler ถูกต้องและตั้ง `TU_APP_KEY` แล้ว ใช้ endpoint มหาวิทยาลัยเดิมตามเอกสาร `tu-authentication.md` ไม่ต้องให้ browser ถือ key
2. เตรียมตารางตาม schema ข้างต้นและตรวจข้อมูลเดิมก่อนย้าย ตารางแบบ PK/SK จากตัวอย่าง #76/#77 เดิมใช้ตรง ๆ ไม่ได้
3. แพ็ก Python 3.12+ พร้อม `backend/` และ dependencies ใน `backend/requirements.txt`; handler `backend.lambda_function.handler` แพ็กแยกจาก Node Lambda deployment เดิม
4. ตั้ง `AWS_REGION=us-east-1`, `SESSION_ORIGIN` เป็น origin HTTPS จริงแบบไม่มี path, `SESSION_CSRF_SECRET` และ `IDENTITY_HMAC_SECRET` เป็น base64 ของ random bytes อย่างน้อย 32 bytes, ชื่อตารางทั้งสี่, `STUDENT_SCOPE_ID` ที่ทีมยืนยัน และ `AUTH_V3_ENABLED=true` ห้าม commit ค่าลับ
5. ตรวจ execution role ที่ Learner Lab อนุญาตให้ใช้ มีสิทธิ์ invoke เฉพาะ `tuAuthLogin` และอ่าน/เขียน/transaction ตารางที่จำเป็น ไม่สร้าง IAM user/OIDC ใหม่
6. ตั้ง API Gateway payload v2.0 และ routing `/api/*` บน origin เดียวกับเว็บเพื่อให้ `__Host-cstuhub` cookie ใช้งานได้ ทดสอบ response/no-store/Origin/CSRF จริงก่อนเปิด frontend
7. ผู้ดูแลใช้ AWS CLI credentials ของ Lab และ environment ชื่อตาราง เรียก `python scripts/bootstrap_role_manager.py --help` แล้ว dry run ด้วย `--user-id` และ `--scope-id`; ตรวจตัวบุคคลและค่อยใช้ `--apply` (บัญชี provisional ต้องมี `--confirm-identity`) สคริปต์ให้ capability ตาม scope ไม่ได้เพิ่ม business role
8. ทดสอบบัญชีนักศึกษา/พนักงานจริง, Session, Logout, มอบ/ถอนบทบาท, แยก scope และการปฏิเสธสิทธิ์ตาม #81 ธุรกิจ #79 ยังตอบ 503 หากยังไม่มี repository adapter ของ feature นั้น
9. เปิด frontend ด้วย `enabled: true` หลังทดสอบผ่าน แล้วค่อยตั้ง `LAMBDA_DEPLOYMENT_PAUSED=false` เมื่อพร้อมให้ main deploy Node Lambda อีกครั้ง ถ้ารอบที่ถูกพักมี source เปลี่ยน ต้อง deploy เวอร์ชันที่ตรวจแล้วโดยตรงหรือรัน workflow ที่รองรับใหม่ ตรวจ workflow trigger ก่อนใช้งาน

AWS Academy credentials มีอายุจำกัด ต้องเปลี่ยน Secrets `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` เมื่อหมดอายุ การรวม source และ mock tests ไม่ใช่หลักฐานว่า deploy จริงหรือ Login TU จริงสำเร็จ
