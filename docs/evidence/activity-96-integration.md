# #96 Integration — 13 ต.ค. 69

คง ActivityRepository, validators, ฟอร์ม HTML และ tests ของเพื่อน
ย้ายเฉพาะ Activity JS ไป activity-workspace.js เพื่อไม่ชนตัวแปรของ Exchange
หน้าร่วมเปิดฟอร์มเดิมผ่าน activity-adapter.js และ durable adapter ใช้ ActivityRepository เตรียมข้อมูลก่อน transaction

เพิ่มการตรวจ role ตาม scope, pagination, retry key ตาม payload และปุ่มโหลดข้อมูลล่าสุดหลัง 409 โดยไม่ทับค่าที่กรอกทันที
ช่องว่างส่งค่าล้างได้ แต่เมื่อ API ยังไม่ยืนยันความสัมพันธ์ครบ ฟอร์มจะไม่ส่ง arrays เดิมทิ้งโดยไม่ตั้งใจ
การอ่าน/ตัวเลือกความสัมพันธ์ต่อใน #97 ไม่สร้างฟอร์ม Agreement ซ้ำ

Backend 176 tests และ npm test ทั้ง 10 ไฟล์ผ่าน รวมการเขียน/อ่านกลับ/แก้/มอบหมาย/ถอนผู้รับผิดชอบผ่าน shared transaction adapter
เป็น local AWS doubles ไม่ใช่ production deployment ดู workspace-83-86-integration.md สำหรับ config และข้อจำกัด AWS
