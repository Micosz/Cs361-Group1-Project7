# Version 1 Deployment

## Prerequisites

- สามารถใช้ Github เพื่อเข้าถึง `https://github.com/Micosz/Cs361-Group1-Project7` ได้
- งาน Phase แรกจาก Branch `Data`, `Detail` และ `Main_Menu` ผ่าน Pull Request และ Merge เข้า `main` แล้ว
- มีผู้รับผิดชอบการ Deployment และสามารถเข้าถึง AWS Learner Lab ได้
- มี Amazon S3 Bucket สำหรับใช้เป็น Static Website

## Configuration

| รายการ | ค่าที่ใช้ใน V1 |
| --- | --- |
| AWS Service | Amazon S3 Static Website Hosting |
| AWS Region | `us-east-1` |
| S3 Bucket Name | `cs361-group1-project7` |
| Deployment Source Branch | `main` |
| Index Document | `index.html` |
| Public URL | `http://cs361-group1-project7.s3-website-us-east-1.amazonaws.com` |
| Deployed By | `ชนกานต์ คงัรชตภิญโญ` |
| Deployment Date | `สิงหาคม/30/26` |
| Deployed Commit SHA | [`a1b2c3d`](https://github.com/Micosz/Cs361-Group1-Project7/commit/a1b2c3d4e5f678901234567890abcdef12345678) |

## Deployment Workflow

1. สมาชิกทีมพัฒนางาน Phase แรกบน Branch `Data`, `Detail` และ `Main_Menu`
2. เจ้าของแต่ละ Branch Push งานและเปิด Pull Request เข้า `main`
3. สมาชิกทีม Review โค้ด ทดสอบงานของแต่ละส่วน
4. หลังจาก Merge ให้ทดสอบระบบรวมจาก `main` เพื่อยืนยันว่าทำงานร่วมกันได้
5. ผู้รับผิดชอบ Deployment Checkout และ Pull โค้ดล่าสุดจาก `main`
6. ติดตั้ง Dependency และ Build Frontend ด้วยคำสั่งที่ระบุใน Configuration
7. ตรวจสอบว่า Build สำเร็จ และไฟล์ `index.html` อยู่ที่ระดับบนสุดของ Build Output Directory
8. เปิด AWS Learner Lab และเข้าสู่ Amazon S3 Bucket ที่กำหนด
9. Upload เนื้อหาทั้งหมดภายใน Build Output Directory ไปยังระดับบนสุดของ Bucket โดยไม่ครอบด้วยโฟลเดอร์ Build Output อีกชั้นหนึ่ง
10. เปิด Static Website Endpoint และตรวจสอบเว็บไซต์ผ่าน Public URL
11. บันทึกชื่อผู้ Deploy, วันที่ Deploy, Public URL และ Commit SHA ที่นำไป Deploy ลงใน Configuration

## Deployment Verification

หลัง Deployment ให้เปิด Public URL ในหน้าต่าง Incognito และตรวจสอบว่าผู้ใช้ทั่วไปสามารถเข้าถึงเว็บไซต์ได้โดยไม่ต้อง Login ผู้ใช้ต้องเปิดหน้ารายละเอียดได้ ข้อมูล JSON, Logo และรูปภาพต้องโหลดได้ครบ และการ Refresh หน้าที่เปิดอยู่ต้องไม่ทำให้เกิดหน้าผิดพลาด