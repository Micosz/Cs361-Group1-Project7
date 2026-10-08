# Source ของ fetchPartnersData

ตำแหน่งนี้สงวนไว้สำหรับ **source จริงของ Lambda เดิม** ใน `us-east-1` ตาม #120

ยังไม่พบ source ใน repository และยังไม่ได้รับไฟล์จาก AWS จึงไม่มีการใส่ implementation สมมติหรือโค้ดทดแทน

ก่อน merge #120 ผู้รับผิดชอบต้องนำ source จาก Lambda Console → `fetchPartnersData` → Code หรือ deployment package ปัจจุบันมาใส่ที่นี่ พร้อมยืนยัน Runtime/Handler และ dependencies/layers เดิม ถ้าเป็น ESM ให้คง `.mjs` หรือ `package.json` ที่กำหนด type เดิม ห้ามเปลี่ยนเป็น `.js` โดยไม่มีเหตุผล

เก็บเฉพาะ source และ dependency manifests/lockfile ที่จำเป็น ห้ามเก็บ ZIP, node_modules, credentials, `.env`, AWS CLI configuration หรือไฟล์ชั่วคราว Workflow จะไม่ deploy หากไม่พบ handler file ตาม configuration จริงของ Lambda

ดู [คู่มือ CI/CD](../../../docs/deployment/lambda-cicd.md)
