# สถานะการเปลี่ยนแปลง

ตรวจวันที่ 25 ตุลาคม 2026 บัญชี 781485979426 / ap-southeast-2

## ตรวจ/เปลี่ยนใน AWS แล้ว

- ตรวจ Block Public Access เปิดครบ, Bucket owner enforced และ SSE-S3
- บันทึกและอ่านกลับ CORS จำกัด origin เว็บ main และ bucket policy ปฏิเสธ HTTP แล้ว
- เปิด Versioning และอ่านกลับจากหน้า Properties ยืนยัน Enabled แล้ว
- เพิ่ม inline policy `CSTUHubPrivateDocumentVersionRead` ให้ `CSTUHubAuthExecutionRole` และอ่าน JSON กลับ ยืนยันมีเพียง GetObjectVersion เฉพาะ documents/staging/* และ documents/ready/* ใน bucket นี้
- เพิ่ม lifecycle สองกฎตาม lifecycle-rules.json และยืนยัน Enabled: staging 1 วัน/รุ่นเก่า 1 วัน, ready เฉพาะรุ่นเก่า 90 วัน ไม่มีการหมดอายุรุ่นปัจจุบัน คงกฎเดิม ExpireTemporaryMigrationArchive

## ยังไม่เปิดใช้งานจริง

- โค้ดอยู่ใน branch `codex/private-s3-uploads` / [PR #183](https://github.com/Micosz/Cs361-Group1-Project7/pull/183) ให้ทีมรีวิว ไม่ merge main เอง
- ยังไม่ deploy Lambda/frontend หรือเปิด DOCUMENT_DIRECT_UPLOAD_ENABLED
- Backend unit/mock 234 tests ผ่าน; browser helper 6 tests ผ่าน รวม simulated 23 MiB, การเขียนทับไฟล์และถอนสิทธิ์ระหว่างตรวจ
- ยังไม่ใช่หลักฐานว่าอัปโหลดไฟล์ใหญ่บนเว็บจริงผ่าน ต้องทดสอบหลัง deploy ตาม README
