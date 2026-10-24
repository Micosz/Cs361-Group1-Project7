# สถานะการเปลี่ยนแปลง

ตรวจวันที่ 25 ตุลาคม 2026 บัญชี 781485979426 / ap-southeast-2

## ตรวจ/เปลี่ยนใน AWS แล้ว

- ตรวจ Block Public Access เปิดครบ, Bucket owner enforced และ SSE-S3
- บันทึกและอ่านกลับ CORS จำกัด origin เว็บ main และ bucket policy ปฏิเสธ HTTP แล้ว
- เปิด Versioning และอ่านกลับจากหน้า Properties ยืนยัน Enabled แล้ว

## ยังไม่เปิดใช้งานจริง

- โค้ดอยู่ใน branch `codex/private-s3-uploads` เพื่อเปิด PR ให้ทีมรีวิว ไม่ merge main เอง
- ยังไม่ deploy Lambda/frontend หรือเปิด DOCUMENT_DIRECT_UPLOAD_ENABLED
- GetObjectVersion และ lifecycle รออนุมัติ/ดำเนินการและอ่านค่ากลับ ต้องรักษา lifecycle เดิม ExpireTemporaryMigrationArchive
- Backend unit/mock 234 tests ผ่าน; browser helper 6 tests ผ่าน รวม simulated 23 MiB, การเขียนทับไฟล์และถอนสิทธิ์ระหว่างตรวจ
- ยังไม่ใช่หลักฐานว่าอัปโหลดไฟล์ใหญ่บนเว็บจริงผ่าน ต้องทดสอบหลัง deploy ตาม README
