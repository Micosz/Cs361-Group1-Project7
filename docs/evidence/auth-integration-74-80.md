# หลักฐานการตรวจการรวม #74–#80

ตรวจบน branch `codex/auth-integration` โดยรวมประวัติทั้งเจ็ด branches และแก้สัญญาที่ไม่ตรงกันก่อนเสนอ merge เข้า main

## ตรวจแล้วในเครื่อง

- `python3 -m unittest discover -s backend/tests -q`: 70 tests ผ่าน รวม test integration ใหม่ 7 กลุ่มที่ใช้ provider/store จำลอง
- `npm test`: frontend ทั้ง 4 test files ผ่าน รวม auth client checks 3 กลุ่ม
- `python3 -m unittest discover -s .github/scripts -p 'test_*.py' -q`: 15 tests ผ่าน
- `node --experimental-vm-modules --test tests/lambda-source.test.cjs`: 8 tests ผ่าน
- Browser localhost: หน้า Browse แสดงข้อมูลสำรองได้, ลิงก์ Login เปิดฟอร์มได้, ส่งค่า placeholder แล้วแสดงข้อความยังไม่เปิดระบบยืนยันตัวตนตามเดิม ไม่มีการส่งบัญชี TU จริง
- Browser พบคำเตือน API ข้อมูลคู่ความร่วมมือตอบ HTTP 500 แล้วใช้ข้อมูลสำรอง เป็นเส้นทาง fallback เดิม ไม่ใช่การทดสอบว่า AWS API ปกติ
- Integration จำลองครอบคลุม Login→User/IdentityLink→Session→Logout, การ Login ซ้ำไม่คืนสิทธิ์, การแข่งขันสร้างบัญชี, employee provisional, Origin/CSRF/rate limit, scoped role management และ Session เก่าถูกปฏิเสธหลัง authzVersion เปลี่ยน

## ยังไม่ได้ยืนยัน

ไม่ได้ deploy Python API, เปลี่ยน AWS, เรียก TU ด้วยบัญชีจริง หรือทดสอบ cookie/routing บน Amplify จริง ระบบใหม่ปิดไว้ด้วย frontend config และ backend environment gate และพัก automatic Lambda deployment ระหว่างเตรียม #81

ขั้นตอนและไฟล์หลัก: [auth-integration.md](../deployment/auth-integration.md) การผ่าน CI เป็นหลักฐานระดับ source/mock เท่านั้น งาน deployment และ acceptance บน AWS ยังต้องตรวจใน #81
