# Private document storage

คู่มือนี้อธิบายระบบเอกสารส่วนตัว โดยเก็บไฟล์ตั้งค่า S3 ใน `deploy/s3/` และ IAM policy ใน `deploy/policies/lambda/` ไฟล์เหล่านี้ไม่มี secrets หรือเอกสารผู้ใช้ และยังไม่ sync กับ AWS อัตโนมัติ

- API/validation: `backend/lambda/CSTUHubAuth/backend/documents/direct_*.py`
- Browser upload: `public/assets/private-documents.js`
- Bucket หลัก: `cstuhub-private-documents-781485979426-ap-southeast-1` (Singapore)
- เก็บ bucket Sydney เดิมไว้สำหรับการย้อนกลับ ดู [V4 deployment](v4-deployment.md)

## การทำงาน

1. API ตรวจ session, CSRF และสิทธิ์ แล้วออก presigned POST อายุ 5 นาที ขนาดไฟล์และชนิดถูกกำหนดใน policy
2. Browser ส่งไฟล์ตรงเข้า `documents/staging/` โดยไม่ส่ง cookie/token ของเว็บไป S3
3. API อ่าน S3 version ที่แน่นอน ตรวจขนาด SHA-256 และรูปแบบไฟล์แบบ streaming แล้ว copy ไป `documents/ready/`
4. ตรวจสิทธิ์อีกครั้งก่อนบันทึก metadata ด้วย DynamoDB transaction ดาวน์โหลดผ่าน signed URL อายุ 120 วินาทีหลังตรวจสิทธิ์

รองรับ PDF/DOCX 50 MiB และ PNG/JPEG 10 MiB ค่าเริ่มต้น จำกัดการขอตั๋วใหม่ 20 ครั้ง/500 MiB ต่อผู้ใช้ต่อชั่วโมง ไม่ใช่เพดานพื้นที่เก็บรวม และ signed POST ใช้ซ้ำได้ระหว่างที่ยังไม่หมดอายุ

## ไฟล์ตั้งค่า

| ไฟล์ | หน้าที่ |
|---|---|
| [public-access-block.json](../../deploy/s3/public-access-block.json) | ปิด public access ทั้งสี่ค่า |
| [ownership-controls.json](../../deploy/s3/ownership-controls.json) | ปิด ACL ด้วย Bucket owner enforced |
| [encryption.json](../../deploy/s3/encryption.json) | เข้ารหัส SSE-S3 (AES256) |
| [versioning.json](../../deploy/s3/versioning.json) | เปิด Versioning เพื่อป้องกันเปลี่ยนไฟล์ระหว่างตรวจ |
| [cors.json](../../deploy/s3/cors.json) | อนุญาต origin เว็บ main ของ Singapore และ Sydney เดิมที่ระบุในไฟล์; AWS console ใช้ array ใน CORSRules |
| [bucket-policy-statements.json](../../deploy/s3/bucket-policy-statements.json) | ปฏิเสธ HTTP; รวมกับ policy เดิมก่อนใช้ ห้ามเขียนทับ statement อื่น |
| [runtime-version-read-policy.json](../../deploy/policies/lambda/runtime-version-read-policy.json) | เพิ่ม GetObjectVersion เฉพาะ prefix ใหม่ให้ execution role เดิม |
| [lifecycle-rules.json](../../deploy/s3/lifecycle-rules.json) | staging/รุ่นเก่า 1 วัน; ready รุ่นเก่า 90 วัน ไม่หมดอายุไฟล์ ready ปัจจุบัน |

Lifecycle ลบถาวร ต้องตรวจ scope ก่อนใช้ และรวม Rules เดิมที่ไม่เกี่ยวข้องไว้ด้วย Versioning ไม่ใช่ backup แยกบัญชี

## เปิดใช้งานหลังรีวิว

1. ตรวจ bucket settings ตามไฟล์ทั้งหมด และสิทธิ์ role เดิมสำหรับ Get/Put/DeleteObject, GetBucketPublicAccessBlock และ DynamoDB transaction ยังคงอยู่
2. Deploy โค้ดจาก `backend/lambda/CSTUHubAuth/` ไป Lambda CSTUHubAuth ตามวิธี deployment เดิม ห้ามรวม secret/config จริงเข้า ZIP ตั้ง timeout 90 วินาที และใช้ temporary storage อย่างน้อย 512 MiB
3. ตั้ง `DOCUMENT_DIRECT_UPLOAD_ENABLED=true` ใน Lambda เดิม คง DOCUMENT_BUCKET และค่าล็อกอินเดิม ไม่เปิด bucket เป็น public
4. Deploy frontend หลัง API พร้อม ถ้า config endpoint ตอบ 404 จะใช้ทางเดิม 3 MiB; ข้อผิดพลาดอื่นไม่ fallback เงียบ ๆ
5. ทดสอบผ่านปุ่มอัปโหลดจริงทั้ง PDF/DOCX/PNG/JPEG รวมไฟล์ 22 MiB ดาวน์โหลดกลับเทียบ SHA-256 และตรวจหลัง reload ทดสอบเกินเพดาน/สิทธิ์ไม่พอด้วย

API Gateway อาจหมดเวลาก่อนการตรวจไฟล์เสร็จ Browser จะอ่านสถานะตั๋วเพื่อตรวจผลซ้ำ หาก Lambda ถูกหยุดให้ลองใหม่หลัง lease 120 วินาที ไม่ใช่ระบบ worker เบื้องหลังถาวร

## ย้อนกลับและข้อจำกัด

- ปิด `DOCUMENT_DIRECT_UPLOAD_ENABLED` เพื่อหยุดอัปโหลดตรงใหม่ ไฟล์ direct ที่สำเร็จแล้วยังดาวน์โหลดผ่าน signed URL ได้ อย่าลบโค้ดรองรับไฟล์เหล่านี้
- อย่าปิด Versioning หรือลบ bucket/metadata เพื่อ rollback แก้ CORS/policy เฉพาะ statement ของงานนี้
- Signed download ที่ออกแล้วใช้ได้จนหมดอายุ แม้สิทธิ์ในเว็บเปลี่ยนไปแล้ว; อย่าเผยแพร่ URL หรือบันทึกลง log
- ตรวจ signature/โครงสร้าง DOCX และ checksum ไม่ใช่ antivirus ต้องเพิ่ม quarantine/scanner ถ้าต้องการตรวจมัลแวร์เต็มรูปแบบ
- candidate ที่ขาดการบันทึกอาจคงเหลือ ต้องตรวจ metadata ก่อนลบ orphan; lifecycle นี้ไม่ลบ ready ปัจจุบันอัตโนมัติ

## อ้างอิง

- [S3 security](https://docs.aws.amazon.com/AmazonS3/latest/userguide/security.html)
- [Security best practices](https://docs.aws.amazon.com/AmazonS3/latest/userguide/security-best-practices.html)
- [Presigned POST policy](https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-HTTPPOSTConstructPolicy.html)
- [Versioning](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html)

ผลตรวจเดิมวันที่ 25 ตุลาคม 2026 ของ Sydney อยู่ใน [บันทึกการทดสอบ S3 direct upload](../evidence/s3-direct-upload-2026-10-25.md) ไม่ใช่การยืนยันค่าปัจจุบันบน Singapore
