<div align="center">

<p><strong>CS361 · GROUP 1 · PROJECT 7</strong></p>

<h1>☁️ CSTU Hub</h1>

<h3>Program Collaboration &amp; Stakeholder Management System</h3>

<p>ระบบบริหารความร่วมมือและผู้มีส่วนได้ส่วนเสียของหลักสูตร</p>

<img src="https://readme-typing-svg.demolab.com/?font=Fira+Code&amp;size=18&amp;duration=2800&amp;pause=1400&amp;color=818CF8&amp;center=true&amp;vCenter=true&amp;width=680&amp;height=50&amp;lines=Discover+partners.;Explore+collaborations.;Keep+stakeholder+information+connected." alt="Discover partners. Explore collaborations. Keep stakeholder information connected." width="680">

<p>
  <img src="https://img.shields.io/badge/Project-Versioned-6366F1?style=for-the-badge" alt="Versioned project">
  <img src="https://img.shields.io/badge/Course-CS361-F59E0B?style=for-the-badge" alt="CS361 Cloud-Based Software Architecting">
</p>

<p>
  <a href="https://main.d2q46seuxuluap.amplifyapp.com/"><img src="https://img.shields.io/badge/Open_Website-18181B?style=for-the-badge&amp;logo=googlechrome&amp;logoColor=white" alt="Open website"></a>
  <a href="#project-versions"><img src="https://img.shields.io/badge/Project_Versions-18181B?style=for-the-badge&amp;logo=readthedocs&amp;logoColor=white" alt="Project versions"></a>
  <a href="https://github.com/Micosz/Cs361-Group1-Project7/issues"><img src="https://img.shields.io/badge/Project_Issues-18181B?style=for-the-badge&amp;logo=github&amp;logoColor=white" alt="Project issues"></a>
</p>

<p><a href="#overview">Overview</a> · <a href="#project-versions">Versions</a> · <a href="#architecture">Architecture</a> · <a href="#getting-started">Getting Started</a> · <a href="#documentation">Documentation</a> · <a href="#team">Team</a></p>

</div>

---

## Overview

**CSTU Hub** เป็นระบบกลางสำหรับค้นหาและติดตามข้อมูลคู่ความร่วมมือ กิจกรรม ข้อตกลง และผู้มีส่วนได้ส่วนเสียของหลักสูตร โดยพัฒนาต่อเนื่องผ่านหลายเวอร์ชัน แต่ละเวอร์ชันมีขอบเขต เทคโนโลยี และหลักฐานของตัวเอง

README นี้เป็นจุดเริ่มต้นของ repository ไม่ได้กำหนดว่าเวอร์ชันใดเป็นสถานะ production ปัจจุบัน รายละเอียดการออกแบบ ผลทดสอบ และการ deploy ให้ยึดเอกสารของเวอร์ชันและหลักฐาน ณ วันที่ระบุ

## Project versions

| เวอร์ชัน | ขอบเขตที่เอกสารบันทึกไว้ | เอกสารหลัก |
| --- | --- | --- |
| **V1 · Public Collaboration Profile** | หน้าเว็บข้อมูลสาธารณะ ใช้ข้อมูลแบบ static และ S3 Static Website Hosting | [Design](docs/design/v1-design.md) · [Hosting ADR](docs/architecture/v1/ADR-001-v1-hosting.md) · [Architecture diagram](docs/architecture/v1/v1-architecture-diagram.png) · [Evidence](docs/evidence/v1-evidence.md) |
| **V2 · Collaboration Repository** | ค้นหาและกรองข้อมูลสาธารณะ; เอกสารออกแบบเลือก Amplify, API Gateway, Lambda และ DynamoDB | [Hosting ADR](docs/architecture/v2/ADR-001-v2-hosting.md) · [Architecture diagram](docs/architecture/v2/v2-architecture-diagram.png) · [Evidence](docs/evidence/v2-evidence.md) |
| **V3 · Secure Collaboration Workspace** | เอกสารครอบคลุม identity/session, role และ scope permissions, ข้อมูลภายใน, เอกสารส่วนตัว และ workflow ความร่วมมือ; แยก design baseline ออกจากผลที่ตรวจแล้ว | [Design](docs/design/v3-design.md) · [Hosting ADR](docs/architecture/v3/ADR-001-v3-hosting.md) · [Architecture diagram](docs/architecture/v3/v3-architecture-diagram.png) · [API routes](docs/architecture/v3/v3-api-routes.md) · [Deployment guide](docs/deployment/v3-deployment.md) · [Evidence](docs/evidence/v3-evidence.md) |

## Architecture

สถาปัตยกรรมเปลี่ยนไปตามโจทย์ของแต่ละเวอร์ชัน ตารางนี้ชี้ไปยังเอกสารที่บันทึกการออกแบบไว้ ไม่ได้ยืนยันว่า AWS resources ทุกชิ้นยังมีอยู่หรือกำลังให้บริการอยู่

| เวอร์ชัน | ภาพรวมที่บันทึกไว้ |
| --- | --- |
| V1 | Browser → static website บน Amazon S3 → ไฟล์ข้อมูลสาธารณะ |
| V2 | Browser → AWS Amplify → API Gateway → Lambda → DynamoDB; มี public JSON backup ตามเอกสารรุ่นนั้น |
| V3 | ดู design, API routes และ diagram ของ V3; เอกสารแยกส่วนที่เป็น baseline ออกจากผลตรวจ implementation/deployment |

เริ่มจาก [สารบัญ Architecture](docs/architecture/README.md) เพื่อเทียบ ADR และ diagram โดยรุ่น

## Getting Started

ต้องมี Python 3 สำหรับเปิด frontend แบบ static และ Node.js สำหรับ build/test:

```bash
git clone https://github.com/Micosz/Cs361-Group1-Project7.git
cd Cs361-Group1-Project7
npm test
python3 -m http.server 8000 --directory public
```

เปิด [http://localhost:8000](http://localhost:8000) ใน browser คำสั่ง `npm test` จะ build route สำหรับหน้า Login ผ่าน `pretest` ก่อนทดสอบ; static server ไม่ได้เปิด API, authentication หรือ AWS resources ในเครื่อง

## Documentation

- [เลือกเอกสารตามงานและเวอร์ชัน](docs/README.md)
- [คู่มือข้อมูลและแหล่งข้อมูล](docs/data/data-guide.md)
- [คู่มือ deploy workflow ใน repository](docs/deployment/v3-deployment.md) — คู่มือนี้รวม workflow ที่บันทึกไว้ใน V3; ตรวจ build/deployment และ AWS environment จริงแยกก่อนสรุปสถานะเว็บ
- [หลักฐาน V1](docs/evidence/v1-evidence.md) · [V2](docs/evidence/v2-evidence.md) · [V3](docs/evidence/v3-evidence.md)

## Team

**Group 1 · Thammasat University · CS361 Cloud-Based Software Architecting**

| Student ID | Team member |
| --- | --- |
| 6709650235 | นายชนกานต์ คงรัชตภิญโญ |
| 6709650623 | นายวุฒิกร บุญทวี |
| 6709650656 | นายศุภวิชญ์ ไม้จัตุรัส |
| 6709650698 | นายสุทธิพจน์ สุวรรณสุทธิ์ |

---


## Frontend directory and deployment

ไฟล์ที่เผยแพร่บนเว็บไซต์ทั้งหมดอยู่ใน `public/`: หน้า HTML, `assets/`, `resources/`,
`login/` และ JSON สำรองใน `data/` เพิ่มหน้าเว็บหรือ assets ใหม่ในโฟลเดอร์นี้ได้โดยไม่ต้องเพิ่มรายการคัดลอกไฟล์
URL บนเว็บเหมือนเดิม เช่น `/login/` และ `/assets/login.css` ไม่ต้องมี `/public/` ใน URL

หน้า Login แก้ HTML ที่ `public/login.html` จุดเดียว ส่วน CSS/JS อยู่ที่ `public/assets/login.css` และ `public/assets/login.js`
หน้า `/login/` ใช้ไฟล์ `public/login/index.html` ที่เก็บใน Git พร้อม `<base href="../">`
เพื่อให้ assets และลิงก์กลับหน้าหลักทำงานเหมือน `/login.html`; ให้แก้ไฟล์นี้ควบคู่กับ `public/login.html`
และตรวจความตรงกันด้วย `npm test` ส่วน `npm run build` ตรวจว่าไฟล์ route มีอยู่

`npm test` เรียก build ผ่าน `pretest` ก่อนทดสอบเสมอ; Amplify เรียก `npm run build` โดยตรงตาม `amplify.yml`
ไฟล์ทดสอบยังรันเองได้ด้วย `npm test`; Amplify เผยแพร่ `public/` โดยตรง ไม่สร้าง `dist/`
ไฟล์ทดสอบ, ข้อมูลต้นฉบับ `data/partners.json` และ docs อยู่นอก `public/` และไม่ถูกส่งขึ้นเว็บไซต์
