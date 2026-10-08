# บัญชีทดสอบเข้าผ่านหน้า Login ปกติ — #81

สำหรับงานวิชา: มี username/password แยกตาม role ให้กรอกใน `login.html` ปกติ ไม่มีหน้าเลือก role บนเว็บออนไลน์ และไม่ต้องมีบัญชี TU สำหรับบัญชีชุดนี้

## สิ่งที่เพิ่ม

- ชื่อบัญชี `course.student-a`, `course.student-b`, `course.coordinator`, `course.staff`, `course.executive`, `course.employee`, `course.manager`, `course.multi`
- `course.employee` ไม่มี role; `course.manager` มี scoped manageRoles แต่ไม่มีสิทธิ์ธุรกิจอัตโนมัติ; `course.multi` มี student + coordinator
- ตรวจ PBKDF2-SHA256 (600,000 รอบ, salt แยกบัญชี) ฝั่ง backend รหัสผ่านสุ่มแยกบัญชี ไม่มีรหัสจริงหรือ hashes ใน source/public/PR
- Prefix `course.` สงวนสำหรับบัญชีทดสอบ รหัสผิด/บัญชีหาย/ปิดโหมดไม่ส่งรหัสผ่านต่อไป TU ส่วนชื่อ TU ปกติยังใช้ adapter #75
- ใช้ User/grants/authzVersion จากฐานข้อมูลปัจจุบันและสร้าง Session ผ่าน flow เดิม มี Origin/CSRF/rate limit ก่อนตรวจรหัส บัญชีทดสอบไม่ได้ข้ามตัวตรวจ API #79
- Login ซ้ำไม่เพิ่ม role คืนและไม่เปิดบัญชีที่ถูกปิด การมอบ/ถอนสิทธิ์ #77 ใช้กับ IdentityLink provider `course-test` ได้
- `COURSE_TEST_ENABLED` ไม่ใช่ `true` ปิดทั้ง Login และการยืนยัน Session ของบัญชีทดสอบเมื่อมี request ครั้งถัดไป บัญชี TU ปกติไม่ถูกปิดไปด้วย

## สร้างบัญชี (ยังไม่เปลี่ยน AWS)

```sh
python3 scripts/course_test_accounts.py --scope cs-demo
```

`cs-demo` เป็นขอบเขตทดสอบของชุดนี้ ต้องตรงกับ scope ของข้อมูลที่จะให้บัญชีทดสอบใช้งาน ไม่ได้ให้สิทธิ์ครอบคลุมทุก scope

สร้างไฟล์ส่วนตัวสิทธิ์ 0600 ใน `.course-test/` (gitignored):

- `accounts.tsv`: username/password สำหรับผู้รับผิดชอบส่งให้ผู้ทดลอง
- `manifest.json`: User/IdentityLink เริ่มต้น
- `lambda-env.json`: config ของ password hashes ฝั่ง Lambda

คำสั่งไม่แสดงรหัสผ่าน ไม่ทับไฟล์เดิม และไม่เรียก AWS รันซ้ำควรใช้ชุดเดิม ไม่สุ่ม user IDs ใหม่โดยไม่วางแผนเปลี่ยน configuration

## เปิดบนเว็บออนไลน์

ต้องตั้ง Python API และ same-origin routing ตาม [auth-integration.md](auth-integration.md) ก่อน การ merge source อย่างเดียวไม่ทำให้ Login ใช้งานได้

1. Start/Resume Learner Lab และตรวจว่า session มีสิทธิ์ใช้งานจริง
2. เตรียมตาราง User/IdentityLink/Session/LoginRate และ Python Lambda ของ #81
3. ใช้ชุดไฟล์ private ที่สร้างแล้ว ตั้ง `USER_TABLE`, `IDENTITY_TABLE`, region แล้วใช้ `python3 scripts/course_test_accounts.py --apply` ผ่าน AWS credentials ที่มีสิทธิ์ สคริปต์สร้างเฉพาะ test records แบบ conditional transaction ไม่สร้างตาราง และไม่ทับสิทธิ์/สถานะของบัญชีที่เคยมีแล้ว
4. ตั้ง `COURSE_TEST_ENABLED=true` และ `COURSE_TEST_ACCOUNTS` จาก `lambda-env.json` บน Python Lambda พร้อมคง environment เดิมทุกค่า ตรวจขนาดรวม environment ตามข้อจำกัด Lambda ห้ามใช้ไฟล์นี้แทน environment ทั้งหมดโดยตรง
5. ตั้ง API Gateway v2 และ `/api/*` บน origin HTTPS เดียวกับเว็บ ตรวจ cookie/CSRF แล้วค่อยเปิด frontend auth config
6. กรอกบัญชีจาก `accounts.tsv` ผ่าน Login เดิม ตรวจ Session, role, scope และ Logout บนระบบจริง
7. ปิดโหมดด้วย `COURSE_TEST_ENABLED=false` เมื่อไม่ใช้แล้ว หากต้องการปิดเฉพาะบัญชี ให้ตั้ง active=false และเพิ่ม authzVersion ตามขั้นตอนดูแลผู้ใช้

รหัสผ่านชุดนี้เป็นบัญชีทดสอบที่มีสิทธิ์จริงตาม grants ในตารางที่ตั้ง จึงไม่ควรใช้ค่าเดียวกันทุก role หรือฝัง password list ใน frontend เมนูธุรกิจที่ยังไม่มีและ API ที่ยังไม่ต่อไม่ได้ถูกสร้างขึ้นจากการมีบัญชีทดสอบ

## ผลตรวจและสถานะ AWS

- เพิ่ม 3 checks: ตรวจรหัส/ปิดโหมด/ไม่ส่ง test password ไป TU, ใช้สิทธิ์ปัจจุบันไม่คืน grant, และปิดการตรวจผู้ใช้ของ Session ทดสอบเมื่อ flag ปิด
- ชุด backend รวม 73 tests ผ่านในเครื่อง พร้อมตรวจ private passwords ทั้ง 8 บัญชีโดยไม่พิมพ์ค่า
- หลัง Resume Lab ใช้ credentials ชุดใหม่ provision ตารางและ deploy `CSTUHubAuth` แล้ว ใช้ LabRole เดิม ไม่สร้าง IAM user/OIDC
- API Gateway `eb49u61kph` เพิ่มเฉพาะ `ANY /api/{proxy+}` → Python Lambda บน stage `default`; handler รองรับ named-stage prefix
- Amplify เพิ่ม `/api/<*>` → `https://eb49u61kph.execute-api.us-east-1.amazonaws.com/default/api/<*>` แบบ rewrite 200 พร้อมคงกฎเดิม หน้าเว็บจึงใช้ origin เดียวกับ Session API
- ทดสอบผ่าน `https://main.d2q46seuxuluap.amplifyapp.com/api/*` จริงครบทั้ง 8 บัญชี: Login 200, Session 200, Logout 200, หลัง Logout กลับเป็น anonymous; cookie Secure/HttpOnly และ Cache-Control no-store; anonymous browsers คนละชุดได้ CSRF ต่างกัน
- อัปเดต source `tuAuthLogin` จาก #75 โดยคง TU_APP_KEY/runtime เดิม และตรวจ invalid input ได้ 400 ไม่ได้ทดสอบบัญชี TU จริง
- เปิด `public/assets/auth-config.js` หลัง API ผ่านแล้ว การใช้บัญชีทดสอบนี้ไม่ถือว่า #81 ผ่านทุกเกณฑ์: TU จริง, business API adapters และหน้าธุรกิจอื่นยังต้องทำต่อ
