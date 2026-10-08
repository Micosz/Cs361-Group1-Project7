# หลักฐานตรวจ #75 — 9 ตุลาคม 2026

## ตรวจในเครื่อง

- Node.js 24: `node --experimental-vm-modules tests/lambda-source.test.cjs` ผ่าน 8 tests ทั้งชุด (TU 5 กลุ่ม + data functions เดิม 3 กลุ่ม)
- TU fixtures ครอบคลุม student/employee, status false/string-true, type หาย/ไม่รู้จัก, malformed JSON/profile, Browser ส่ง role/type/userId, config หาย/URL ผิด, TU 401/403/400/5xx/429, network failure และ timeout ทั้ง fetch/body
- ตรวจ request headers/body, ไม่มี automatic retry, abort เมื่อ timeout, bounded Retry-After, ไม่มีค่า password/key/raw error ใน response/log ที่ทดสอบ
- `node --check backend/lambda/tuAuthLogin/index.mjs` และ `git diff --check` ผ่าน
- ใช้ packager เดิมกับ configuration สมมติ Node.js 24 / `index.handler` / Zip: ZIP root มีเพียง `index.mjs`, CRC และ source ตรงไฟล์ใน branch
- ตรวจ diff และไฟล์ที่เปลี่ยน ไม่ใส่ credentials จริง ไม่เปลี่ยน frontend, DynamoDB, IAM, API Gateway หรือ logic ของอีกสอง Lambdas

## ข้อจำกัดของหลักฐาน

ทั้งหมดเป็น local static/mock validation ไม่มีการส่งรหัสผ่านหรือ key ไป TU จริง ไม่มีการ deploy/invoke Lambda, ตรวจ channel permission, อ่านค่า environment จริง หรือยืนยัน quota ของบัญชีทีม ไม่มีผลทดสอบ student/employee จริงหรือ end-to-end #74 → #76 → #78

## งานที่เหลือก่อนใช้งานจริง

1. เพื่อน Review branch และยืนยัน endpoint/channel ใน TU Portal
2. ตั้ง `TU_AUTH_URL` และ `TU_APP_KEY` ฝั่ง Lambda; timeout มากกว่า 8 วินาที; ปิด auth body logging
3. เชื่อม account-linking/Session/local rate limit ตาม #74/#76/#78/#90 โดยไม่ใช้ profile/role จาก Browser เป็นหลักฐาน
4. หลัง deploy ที่ได้รับอนุมัติ ทดสอบบัญชี student/employee ที่อนุญาตและกรณีผิดพลาด เก็บเฉพาะ HTTP/code/ผลที่ปกปิดตัวตน ไม่แนบ password/key/raw profile

รายละเอียดและขั้นตอน: [คู่มือ #75](../deployment/tu-authentication.md)
