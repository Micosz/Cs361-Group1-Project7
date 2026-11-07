# สถานะการเปลี่ยนแปลง

ตรวจวันที่ 25 ตุลาคม 2026 บัญชี 781485979426 / ap-southeast-2

## ตรวจ/เปลี่ยนใน AWS แล้ว

- ตรวจ Block Public Access เปิดครบ, Bucket owner enforced และ SSE-S3
- บันทึกและอ่านกลับ CORS จำกัด origin เว็บ main และ bucket policy ปฏิเสธ HTTP แล้ว
- เปิด Versioning และอ่านกลับจากหน้า Properties ยืนยัน Enabled แล้ว
- เพิ่ม inline policy `CSTUHubPrivateDocumentVersionRead` ให้ `CSTUHubAuthExecutionRole` และอ่าน JSON กลับ ยืนยันมีเพียง GetObjectVersion เฉพาะ documents/staging/* และ documents/ready/* ใน bucket นี้
- เพิ่ม lifecycle สองกฎตาม lifecycle-rules.json และยืนยัน Enabled: staging 1 วัน/รุ่นเก่า 1 วัน, ready เฉพาะรุ่นเก่า 90 วัน ไม่มีการหมดอายุรุ่นปัจจุบัน คงกฎเดิม ExpireTemporaryMigrationArchive

## เปิดใช้งานและทดสอบจริงแล้ว

- เจ้าของงานอนุมัติ merge/deploy เพิ่มเติม; [PR #183](https://github.com/Micosz/Cs361-Group1-Project7/pull/183) รวม main เป็น `2e6836839026baef10dd1df0308c7f8849825b68`; Amplify main job 14 สำเร็จ
- Deploy Lambda CSTUHubAuth แล้ว เปิด `DOCUMENT_DIRECT_UPLOAD_ENABLED=true` และ timeout 90 วินาที โดยรักษา environment/dependency เดิม มี Lambda version 2 เป็นจุดก่อนเปลี่ยนสำหรับอ้างอิงย้อนกลับ
- ทดสอบขั้นต่ำตามคำขอ: เลือก PDF จริงขนาด 23,230,980 ไบต์ (22.2 MiB) จากปุ่มแนบไฟล์ใน Exchange ทดสอบ แบบสิทธิ์ภายใน เว็บแจ้งอัปโหลดเอกสารเรียบร้อย
- ดาวน์โหลดกลับผ่านลิงก์ในเว็บ ขนาดเท่าต้นฉบับและ SHA-256 ตรงกัน จึงยืนยันเส้นทาง upload → ตรวจไฟล์ → บันทึก → download จริงสำหรับ PDF นี้ได้
- Backend unit/mock 234 tests และ browser helper 6 tests ผ่านก่อน deploy; ไม่ทดสอบไฟล์ชนิดอื่นซ้ำในรอบ live นี้ตามคำขอให้ทดสอบเท่าที่จำเป็น

ไม่ใช้ผล PDF ครั้งเดียวแทนการรับรองทุกชนิดไฟล์ ทุกเครือข่าย หรือการสแกนมัลแวร์เต็มรูปแบบ
