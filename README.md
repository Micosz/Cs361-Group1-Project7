# CS361 Group 1 - Project 7

## Project Overview

**Project Definition:** โครงการนี้มีเป้าหมายสร้างระบบกลางสำหรับบริหารข้อมูลคู่ความร่วมมือและผู้มีส่วนได้ส่วนเสียของหลักสูตร เนื่องจากปัจจุบันข้อมูลคู่ความร่วมมือ เอกสาร ข้อตกลง กิจกรรม และผู้ประสานงานมักกระจายอยู่ในหลายไฟล์หรือหลายระบบ ทำให้ติดตามสถานะหรือระยะเวลาของข้อตกลงที่เกิดขึ้นได้ยาก

**Project Vision:** โปรเจ็คต้องการรวบรวมข้อมูลดังกล่าวไว้ในระบบเดียว เพื่อให้ข้อมูลค้นหาและติดตามได้ง่ายขึ้น ไม่จำเป็นต้องค้นหาจากหลายแหล่ง

## Version 1 Scope
ทำระบบให้ผู้ใช้ทั่วไปสามารถเข้าถึงข้อมูลคู่ความร่วมมือ ความร่วมมือ หรือกิจกรรมบางส่วนที่กำหนดให้เผยแพร่ได้ โดยยังไม่จำเป็นต้องเข้าสู่ระบบ

## Version 1 Boundary

V1 ครอบคลุมเฉพาะหน้า Browse หน้ารายละเอียด และข้อมูลแบบ Static JSON ที่ใช้แสดงบนเว็บไซต์ ผู้ใช้สามารถอ่านข้อมูลได้ เเต่จะต้องไม่สามารถเพิ่ม แก้ไข หรือลบข้อมูลผ่านระบบได้

ระบบ Login และ Role, หน้า Admin, Database, ระบบค้นหาและกรองข้อมูล, Feedback, ข้อมูลส่วนบุคคล รวมถึงการจัดการเอกสารหรือรายละเอียด MoU/MoA ภายในหลักสูตรยังไม่อยู่ในขอบเขตของ V1

## Deployment

ระบบ V1 Deploy ด้วย Amazon S3 Static Website Hosting และสามารถกดได้โดยไม่ต้องเข้าสู่ระบบ

[![Live Website](https://img.shields.io/badge/Live_Website-Open-2ea44f?style=for-the-badge&logo=amazons3&logoColor=white)](http://cs361-group1-project7.s3-website-us-east-1.amazonaws.com)

## Documentation

เอกสารประกอบโครงการทั้งหมดอยู่ในโฟลเดอร์ [`docs/`](docs/) โดยแบ่งตามประเภทดังนี้

| ตำแหน่ง | รายละเอียด |
| --- | --- |
| [`docs/architecture/ADR-001-v1-hosting.md`](docs/architecture/ADR-001-v1-hosting.md) | บันทึกเหตุผลและข้อพิจารณาในการเลือก AWS Services สำหรับ V1 |
| [`docs/architecture/v1-architecture-diagram.png`](docs/architecture/v1-architecture-diagram.png) | แผนภาพแสดงโครงสร้างและส่วนประกอบของระบบ V1 |
| [`docs/data/v1-data.md`](docs/data/v1-data.md) | อธิบายโครงสร้างข้อมูล ชนิดข้อมูลใน `partners.json` |
| [`docs/design/v1-design.md`](docs/design/v1-design.md) | อธิบายการออกแบบหน้าหลัก ส่วนประกอบ ลำดับการใช้งาน และ เงื่อนไขการทำ Responsive Design |
| [`docs/deployment/v1-deployment.md`](docs/deployment/v1-deployment.md) | ระบุการตั้งค่า ขั้นตอน Deploy ระบบขึ้น AWS Services |
| [`docs/evidence/v1/v1-evidence.md`](docs/evidence/v1/v1-evidence.md) | ใช้รวบรวมหลักฐานการพัฒนา ทดสอบ และเผยแพร่ระบบสำหรับ V1 |
| [`docs/ai-usage/v1-ai-usage-declaration.md`](docs/ai-usage/v1-ai-usage-declaration.md) | ใช้บันทึกการใช้ AI หรือเครื่องมือค้นหาของสมาชิกแต่ละคน |

## Team Members

6709650235 นายชนกานต์ คงรัชตภิญโญ<br>
6709650623 นายวุฒิกร บุญทวี<br>
6709650656 นายศุภวิชญ์ ไม้จัตุรัส<br>
6709650698 นายสุทธิพจน์ สุวรรณสุทธิ์
