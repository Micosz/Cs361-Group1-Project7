# Version 2 Deployment

## Prerequisites

- สามารถเข้าถึง repository [`Micosz/Cs361-Group1-Project7`](https://github.com/Micosz/Cs361-Group1-Project7) ได้
- งาน V2 ที่จะเผยแพร่ผ่าน Pull Request, Review และ Merge เข้า `main` แล้ว
- มีผู้รับผิดชอบ Deployment และมีสิทธิ์เข้าถึงบริการ AWS ที่ใช้ในโครงการ
- มี AWS Amplify Hosting เชื่อมกับ repository และ branch `main`
- มี API Gateway และ Lambda สำหรับอ่านข้อมูลจาก DynamoDB โดยกำหนดสิทธิ์อ่านฐานข้อมูลให้ Lambda และตั้งค่า CORS ให้หน้าเว็บเรียก API ได้
- มีข้อมูลสาธารณะใน DynamoDB และตรวจสอบว่า API ส่งเฉพาะข้อมูลและ field ที่อนุญาตให้เผยแพร่
- มีไฟล์ `public/data/partner-data-backup.json` สำหรับแสดงข้อมูลสำรองเมื่อ API ไม่พร้อมใช้งาน

## Configuration

| รายการ | ค่าที่ใช้ใน V2 |
| --- | --- |
| Frontend Hosting | AWS Amplify Hosting |
| Backend Services | Amazon API Gateway + AWS Lambda + Amazon DynamoDB |
| Backend Region | `us-east-1` ตาม API endpoint และการตั้งค่าใน `migrate.js` |
| DynamoDB Table ในสคริปต์ Migration | `Partner` — ต้องตรวจว่าตรงกับตารางที่ Lambda ใช้งานจริง |
| Deployment Source Branch | `main` |
| Frontend Entry File | `public/index.html` |
| Frontend Build | Static HTML/CSS/JavaScript; ไม่มี build script ใน `package.json` |
| Amplify Build Command / Output Directory | `npm test` / `public` ตาม `amplify.yml` ใน repository; ตรวจ deployment log หลัง merge |
| Public URL | [https://main.d2q46seuxuluap.amplifyapp.com/](https://main.d2q46seuxuluap.amplifyapp.com/) |
| Public API URL | `https://eb49u61kph.execute-api.us-east-1.amazonaws.com/default/fetchPartnersData` |
| API Configuration | `API_URL` ใน `public/assets/script.js` |
| Backup Data | `public/data/partner-data-backup.json` |
| Deployed By | **รอยืนยันชื่อผู้รับผิดชอบ V2** |
| Deployment Date | **รอยืนยันวันที่เผยแพร่ V2** |
| Deployed Frontend Commit SHA | **รอยืนยัน commit จาก Amplify deployment ที่สำเร็จ** |

Commit SHA ด้านบนใช้ระบุ frontend ที่เผยแพร่ผ่าน Amplify ส่วน Lambda, API Gateway และ DynamoDB ต้องตรวจการตั้งค่าบน AWS แยกจาก frontend เพราะ repository นี้ไม่มี source code ของ Lambda หรือ Infrastructure as Code สำหรับสร้าง backend

## Deployment Workflow

1. สมาชิกทีมพัฒนางาน V2 บน branch ของแต่ละ Issue และเปิด Pull Request เข้า `main`
2. สมาชิกทีม Review โค้ดและทดสอบการเรียกข้อมูล การค้นหา การกรอง และรายละเอียดก่อน Merge
3. ผู้รับผิดชอบตรวจว่าข้อมูลสาธารณะใน DynamoDB พร้อมใช้งาน และ Lambda มีสิทธิ์อ่านตารางที่ถูกต้อง
4. ตรวจการเรียก API Gateway ให้ได้ response ในรูปแบบที่ frontend รองรับ พร้อมตรวจ CORS และขอบเขตข้อมูลที่เผยแพร่
5. ตรวจว่า `API_URL` ใน `public/assets/script.js` ชี้ไปยัง endpoint ที่ต้องการใช้งาน และไฟล์สำรองมีข้อมูลที่อนุญาตให้เผยแพร่
6. Merge งานที่ผ่านการตรวจเข้า `main` เพื่อให้ Amplify เริ่ม Deployment ตามการตั้งค่าที่เชื่อมกับ GitHub
7. เปิด Amplify Console ตรวจสถานะ deployment และ logs ให้สำเร็จ โดยใช้ build settings ที่เหมาะกับ static frontend
8. เปิด Public URL และตรวจสอบระบบตามรายการ Deployment Verification

การแก้ frontend เผยแพร่ผ่าน Amplify ส่วนการแก้ข้อมูลหลักทำผ่าน AWS Console และต้อง refresh หน้าเว็บเพื่ออ่าน snapshot ใหม่ หาก API ใช้ไม่ได้ เว็บไซต์อาจยังเปิดได้จากข้อมูลสำรอง จึงต้องตรวจ API แยกเพื่อยืนยันว่า backend ทำงานจริง
