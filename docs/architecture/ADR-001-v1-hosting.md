# ADR-001: Version 1 Hosting

## Context and Constraint

V1 ต้องรองรับให้ผู้ใช้ทั่วไปสามารถเข้าถึงข้อมูลคู่ความร่วมมือ ความร่วมมือ และกิจกรรมที่ได้รับอนุมัติให้เผยแพร่ได้โดยไม่ต้องเข้าสู่ระบบ ระบบจึงต้องมี Frontend และ Static Public Data โดยไม่เพิ่ม Database ระบบ Login หรือ Backend ที่ V1 ยังไม่ได้ต้องการ เเละเนื่องจากระบบภายใต้ข้อจำกัดของ AWS Learner Lab จึงเลือกแนวทางที่ตั้งค่าได้ไม่ซับซ้อน ใช้บริการเท่าที่จำเป็น และสามารถเก็บหลักฐานการ Build และ Deployment ได้ชัดเจน

## Options Consider

| ทางเลือก | รองรับ V1 | ความเรียบง่าย | ความพร้อมใน Learner Lab | การ Deploy | รองรับอนาคต | รวม |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| Amazon S3 Static Website Hosting | 5 | 5 | 5 | 4 | 3 | **22/25** |
| AWS Amplify Hosting | 5 | 4 | 2 | 4 | 4 | **19/25** |
| Amazon S3 ร่วมกับ Amazon CloudFront | 5 | 2 | 2 | 2 | 5 | **16/25** |

## Decision

ทีมเลือกใช้ Amazon S3 Static Website Hosting สำหรับ V1 โดย Build Frontend และจัดเก็บไฟล์ไว้ใน S3 Bucket จากนั้นเปิดใช้งานให้ผู้ใช้เข้าถึงผ่าน URL ได้ ข้อมูลที่นำขึ้นระบบต้องเป็นข้อมูลที่ผ่านการอนุมัติให้เผยแพร่แล้วเท่านั้น การ Deploy ใน V1 จะดำเนินการตามขั้นตอนที่บันทึกไว้ใน `docs/deployment/v1-deployment.md`

## Trade-offs

แนวทางนี้ทำให้ Architecture ของ V1 เรียบง่าย เเต่อาจจะไม่รองรับ HTTPS โดยตรง หากระบบจำเป็นต้องใช้ก็อาจจะต้องพิจารณาทางเลือกอื่นๆ

## Supporting Evidence
