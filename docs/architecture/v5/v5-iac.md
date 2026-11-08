# CSTUHub V5 · สถาปัตยกรรมใน Singapore

เปิด [ภาพแก้ไขได้](v5-iac.drawio) ใน diagrams.net ดู [ขอบเขตและ configuration](../../design/v5-design.md) หรือ [ขั้นตอนทดลอง](../../deployment/v5-trial.md) ประกอบ

1. ใน production เบราว์เซอร์โหลดหน้าเว็บจาก Amplify ใช้ rewrite ไป HTTP API จากนั้น API เรียก Lambda เพื่ออ่าน catalog, ดูแล session หรือเข้าถึง DynamoDB และ S3 ตามสิทธิ์
2. GitHub Actions บน `main` ใช้ OIDC deploy ZIP ไปยัง Lambda production ทั้งสี่ตัว หลังตรวจ preflight และสำรองโค้ดเดิม สิทธิ์ของ role สำหรับ #247 แสดงเป็นการเปลี่ยนแปลงที่รอทบทวน
3. ในชุดทดลอง Amplify, API, Lambda, DynamoDB และ S3 ใช้ชื่อและข้อมูลแยก CloudFormation รับ ZIP แบบ versioned กับ secret ทดลอง และผู้ปฏิบัติงานทบทวน Change Set ก่อน execute
4. หลังทดสอบ create และ update ให้ลบ stack จาก Frontend ย้อนกลับไป Data แล้วตรวจตารางถาวรและ bucket ที่ retain ส่วน Secrets Manager ของชุดทดลองอยู่ในขั้นตอนเตรียม/เก็บกวาดแยก

เส้นทึบแสดงทางของคำขอหรือข้อมูล เส้นประแสดงการส่งโค้ดหรือ configuration ภาพสรุปขอบเขตของ V5 และการเปรียบเทียบ production ที่ตรวจวันที่ 8 พ.ย. 2026 ผลการสร้างชุดทดลองต้องอ้างจากหลักฐาน CloudFormation และ smoke test แยกต่างหาก
