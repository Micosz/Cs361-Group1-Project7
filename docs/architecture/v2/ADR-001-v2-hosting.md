## Architecture Decision for V2

### Requirements considered

V2 ต้องเปลี่ยนจากการอ่านข้อมูลในไฟล์ JSON มาเป็นฐานข้อมูลบน AWS, รองรับข้อมูล Stakeholder คู่ความร่วมมือ ผู้ประสานงาน MoU/MoA และกิจกรรม รวมถึงการค้นหาด้วยชื่อและกรองตามประเภทหรือช่วงเวลาที่ตกลง

ผู้ใช้ทั่วไปต้องเข้าถึงเฉพาะข้อมูลที่เผยแพร่ได้ ส่วนการจัดการข้อมูลยังใช้เครื่องมือที่จำกัดสิทธิ์สำหรับสมาชิกทีม โดย V2 ยังไม่สร้างหน้า Admin และระบบ Login

### Options considered

| ทางเลือก | ข้อดี | ข้อจำกัด |
| --- | --- | --- |
| Amazon RDS | รองรับความสัมพันธ์และ Query แบบ relational ได้ดี | ต้องจัดการ Database instance, connection และโครงสร้างตารางมากขึ้น มีความซับซ้อนเกินความจำเป็นสำหรับข้อมูลและขนาดระบบใน V2 |
| Amazon DynamoDB | เป็น Serverless Database ไม่ต้องดูแล Server เพิ่ม Field ได้ยืดหยุ่น และใช้ IAM ควบคุมสิทธิ์ได้ | ไม่เหมาะกับ Join และการค้นหาข้อความบางส่วนโดยตรง ต้องออกแบบความสัมพันธ์และวิธี Search/Filter เพิ่มเติม |
| Browser เชื่อม DynamoDB โดยตรง | มีองค์ประกอบน้อย | ต้องนำสิทธิ์ AWS มาไว้ฝั่ง Browser และเสี่ยงเปิดเผยข้อมูลภายใน จึงไม่เลือก |
| API Gateway + Lambda ระหว่างเว็บกับ DynamoDB | แยก Public API ออกจากฐานข้อมูล กรองเฉพาะข้อมูลเผยแพร่ได้ และไม่เปิด Credential ให้ Browser | เพิ่ม Service และจุดที่ต้องพัฒนา ทดสอบ และตรวจสอบ Error |

### Spacial Options considered
| ทางเลือก | ข้อดี | ข้อจำกัด |
| --- | --- | --- |
| AWS Amplify Hosting | เชื่อมต่อกับ GitHub และ Deploy Frontend อัตโนมัติเมื่อมีการอัปเดตบน Branch ที่กำหนด รองรับ HTTPS และช่วยลดขั้นตอนการ Deploy ด้วยตนเอง | ต้องตั้งค่าการเชื่อมต่อ Repository และ Build configuration เพิ่ม |
| Amazon S3 Static Website Hosting | ตั้งค่าไม่ซับซ้อน ค่าใช้จ่ายต่ำ และทีมมีประสบการณ์ใช้งานจาก V1 แล้ว | ต้อง Upload หรือ Deploy ไฟล์ใหม่ด้วยตนเองเมื่อ Frontend เปลี่ยนแปลง และ S3 Static Website Endpoint ไม่รองรับ HTTPS โดยตรง |

### Decision

ทีมเลือกใช้แนวทางดังนี้:

- มีการเปลี่ยนจาก S3 ไปใช้ AWS Amplify Hosting สำหรับ Deploy Frontend จาก GitHub เพราะเชื่อมกับ GitHub และ Deploy การเปลี่ยนแปลงของ Frontend อัตโนมัติ ลดขั้นตอน Manual Deployment แบบ S3 เดิม
- ใช้ Amazon API Gateway เป็น Public API ที่หน้าเว็บเรียกใช้ ช่วยไม่ให้ Browser ได้รับ AWS Credential หรือเชื่อมฐานข้อมูลโดยตรง
- ใช้ AWS Lambda สำหรับอ่านและประมวลผลข้อมูลจาก DynamoDB
- ใช้ Amazon DynamoDB เพราะเป็นฐานข้อมูลแบบ Serverless ไม่ต้องดูแล Database Server และรองรับข้อมูลหลายประเภทที่มี Field แตกต่างกันได้
- สมาชิกทีมเพิ่มและแก้ไขข้อมูลผ่าน AWS Management Console

### Trade-offs

- DynamoDB ไม่รองรับ Join แบบฐานข้อมูลเชิงสัมพันธ์ ทีมต้องออกแบบ Reference เช่น `partner_ids` และประกอบความสัมพันธ์ใน Application
- สามารถอ่านข้อมูลสาธารณะแล้วกรองใน Lambda หรือ Frontend ได้ แต่หากข้อมูลเพิ่มมากขึ้นต้องพิจารณา Index หรือ Search Service เพิ่ม
- การใช้ API Gateway และ Lambda เพิ่มความซับซ้อนจาก V1 และต้องจัดการกรณี API ล้มเหลว การตั้งค่า CORS และสิทธิ์ระหว่าง Service
- Amplify ทำให้ Deploy สะดวกและรองรับ HTTPS แต่เพิ่ม Service Cost และ Build Configuration จากการใช้ S3 Static Website โดยตรง

### Evidence

- Database setup and sample data: #38
- Authorized data-management test: #43
- Requirements and access boundary: #34
- Data fields and Search/Filter rules: #35
- Amplify deployment: [ใส่ URL หรือภาพหลักฐาน]
- Lambda/API Gateway test: [ใส่ลิงก์ Issue, ภาพ หรือผลทดสอบเมื่อทำเสร็จ]