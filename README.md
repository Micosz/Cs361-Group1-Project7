<div align="center">

<p><strong>CS361 · GROUP 1 · PROJECT 7</strong></p>

<h1>☁️ CSTU Hub</h1>

<h3>Program Collaboration &amp; Stakeholder Management System</h3>

<p>ระบบบริหารความร่วมมือและผู้มีส่วนได้ส่วนเสียของหลักสูตร</p>

<img src="https://readme-typing-svg.demolab.com/?font=Fira+Code&amp;size=18&amp;duration=2800&amp;pause=1400&amp;color=818CF8&amp;center=true&amp;vCenter=true&amp;width=680&amp;height=50&amp;lines=V2+%C2%B7+Collaboration+Repository;Discover+partners.+Explore+collaborations.;From+static+JSON+to+AWS-powered+data." alt="V2 Collaboration Repository — Discover partners. Explore collaborations. From static JSON to AWS-powered data." width="680">

<p>
  <img src="https://img.shields.io/badge/Version-V2_Completed-6366F1?style=for-the-badge" alt="V2 completed">
  <img src="https://img.shields.io/badge/Access-Public_Read--Only-0EA5E9?style=for-the-badge" alt="Public read-only access">
  <img src="https://img.shields.io/badge/Course-CS361-F59E0B?style=for-the-badge" alt="CS361 Cloud-Based Software Architecting">
</p>

<p>
  <a href="https://main.d2q46seuxuluap.amplifyapp.com/"><img src="https://img.shields.io/badge/Open_Website-18181B?style=for-the-badge&amp;logo=googlechrome&amp;logoColor=white" alt="Open website"></a>
  <a href="#documentation"><img src="https://img.shields.io/badge/Read_the_Docs-18181B?style=for-the-badge&amp;logo=readthedocs&amp;logoColor=white" alt="Read the documentation"></a>
  <a href="https://github.com/Micosz/Cs361-Group1-Project7/issues"><img src="https://img.shields.io/badge/Project_Issues-18181B?style=for-the-badge&amp;logo=github&amp;logoColor=white" alt="Project issues"></a>
</p>

<p><a href="#overview">Overview</a> · <a href="#v2-highlights">V2 Highlights</a> · <a href="#architecture">Architecture</a> · <a href="#getting-started">Getting Started</a> · <a href="#documentation">Documentation</a> · <a href="#team">Team</a></p>

</div>

---

## Overview

ข้อมูลคู่ความร่วมมือ ข้อตกลง กิจกรรม และผู้ประสานงานของหลักสูตรมักกระจายอยู่ในหลายไฟล์หรือหลายระบบ ทำให้ค้นหาและติดตามความสัมพันธ์ระหว่างข้อมูลได้ยาก **CSTU Hub** จึงมีเป้าหมายรวบรวมข้อมูลเหล่านี้ไว้ในระบบกลาง เพื่อให้ค้นหา เรียกดู และต่อยอดการติดตามความร่วมมือได้สะดวกขึ้น

**V2 — Collaboration Repository** พัฒนาต่อจากหน้าเผยแพร่ข้อมูลสาธารณะของ V1 โดยย้ายแหล่งข้อมูลหลักไปยัง **Amazon DynamoDB** และให้หน้าเว็บเรียกข้อมูลผ่าน **API Gateway + Lambda** พร้อมเพิ่มการค้นหาและกรองตามประเภท ผู้ใช้ทั่วไปยังเข้าถึงได้โดยไม่ต้องเข้าสู่ระบบ ส่วนทีมจัดการข้อมูลผ่าน AWS Management Console

> **แนวคิดของ V2:** จัดเก็บข้อมูลอย่างเป็นระบบ เชื่อมโยงคู่ความร่วมมือกับกิจกรรม และค้นหาข้อมูลสาธารณะจากหน้าเว็บเดียว

## V2 Highlights

| | ความสามารถ | การทำงานในเวอร์ชันนี้ |
| :---: | --- | --- |
| 🌐 | **Public browsing** | เรียกดูองค์กร คู่ความร่วมมือ และกิจกรรมที่กำหนดให้เผยแพร่ได้ |
| 🔎 | **Keyword search** | ค้นจากชื่อองค์กร (`name`) และชื่อกิจกรรม (`title`) พร้อมรายการแนะนำ โดยไม่แยกตัวพิมพ์ใหญ่/เล็ก |
| 🗂️ | **Type filters** | กรองประเภทองค์กรหรือกิจกรรมร่วมกับคำค้น และล้างตัวกรองได้ |
| 🔗 | **Connected details** | เปิดรายละเอียดใน modal และดูกิจกรรมที่สัมพันธ์กับองค์กร รวมถึงผู้ร่วมจัด (`co_hosts`) |
| ☁️ | **Dynamic data** | อ่านข้อมูลจาก API ที่เชื่อม DynamoDB และประกอบความสัมพันธ์ด้วย `partnerId` |
| ⚡ | **Search responsiveness** | ใช้ข้อมูลที่โหลดสำเร็จร่วมกันในหน้าเดียว และหน่วงการค้นหาระหว่างพิมพ์ 250 ms |
| 🛟 | **Backup data** | หาก API โหลดไม่สำเร็จ ใช้ไฟล์ข้อมูลสาธารณะสำรอง พร้อมแจ้งว่าข้อมูลอาจไม่ใช่ข้อมูลล่าสุด |
| 📱 | **Responsive interface** | รองรับการเรียกดูผ่านคอมพิวเตอร์และมือถือ |

<details>
<summary><strong>🔍 Search &amp; filter rules</strong></summary>

<br>

- คำค้นตรวจจาก **ชื่อองค์กรและชื่อกิจกรรม** ไม่รวม `summary`, `location`, `partnerName` หรือ `co_hosts`
- ตัวกรององค์กรมีบริษัท มหาวิทยาลัย หน่วยงานรัฐ และเครือข่ายสหกิจศึกษา
- ตัวกรองกิจกรรมมีฝึกงาน/สหกิจศึกษา กิจกรรมวิชาการ กิจกรรมทั่วไป/สัมมนา และงานวิจัย/แลกเปลี่ยน
- การ์ดและรายการแนะนำใช้กฎคำค้นและประเภทเดียวกัน รายการแนะนำแสดงสูงสุด 6 รายการ
- กด **Search** เพื่อค้นทันที; ล้างคำค้นเพื่อกลับไปดูรายการตามประเภทที่เลือกไว้
- ข้อมูลที่โหลดสำเร็จเก็บในหน่วยความจำของหน้าเว็บ การแก้ข้อมูลใน AWS Console ต้อง **refresh หน้าเว็บ** เพื่อโหลดข้อมูลใหม่

</details>

<details>
<summary><strong>🧭 V1 → V2</strong></summary>

<br>

| ด้าน | V1 — Public Collaboration Profile | V2 — Collaboration Repository |
| --- | --- | --- |
| แหล่งข้อมูลหลัก | Static JSON ใน repository | DynamoDB ผ่าน API |
| การเรียกดู | Browse และรายละเอียดข้อมูลสาธารณะ | Browse รายละเอียด การค้นหา และกรองตามประเภท |
| การแก้ข้อมูล | แก้ไฟล์ข้อมูลแล้วเผยแพร่ใหม่ | ทีมแก้ข้อมูลหลักผ่าน AWS Console |
| Frontend hosting | เริ่มต้นด้วย S3 Static Website Hosting | Amplify Hosting เชื่อมกับ GitHub |
| เมื่อ API ใช้ไม่ได้ | อ่านไฟล์ข้อมูลโดยตรง | ใช้ public JSON backup และแสดงคำแจ้งเตือน |
| สิทธิ์ผู้ใช้ทั่วไป | อ่านข้อมูลโดยไม่ต้องเข้าสู่ระบบ | อ่านข้อมูลโดยไม่ต้องเข้าสู่ระบบ |

</details>

## Architecture

**Frontend บน Amplify → API Gateway → Lambda → DynamoDB** แล้วส่งข้อมูลกลับมาให้หน้าเว็บแสดงผล หาก API โหลดไม่สำเร็จ frontend จะอ่านข้อมูลสำรองจาก `data/partner-data-backup.json`

| ส่วนประกอบ | หน้าที่ |
| --- | --- |
| **AWS Amplify Hosting** | เผยแพร่ frontend ผ่าน HTTPS และเชื่อมการ deploy กับ branch ที่ตั้งค่าไว้ใน GitHub |
| **Amazon API Gateway** | เป็นช่องทางเรียก Public API จากหน้าเว็บ |
| **AWS Lambda** | อ่านและประมวลผลข้อมูลจากฐานข้อมูลตามการตั้งค่าบน AWS |
| **Amazon DynamoDB** | จัดเก็บข้อมูลคู่ความร่วมมือและกิจกรรม โดยเชื่อมกิจกรรมกับองค์กรผ่าน `partnerId` |
| **AWS Management Console** | ให้สมาชิกทีมที่มีสิทธิ์จัดการข้อมูล โดย V2 ยังไม่มีหน้า Admin |
| **Public JSON backup** | เป็นข้อมูลสำรองสำหรับแสดงผลเมื่อ API ไม่พร้อมใช้งาน |

**เหตุผลในการเลือก:** การอ่านข้อมูลของ V2 ยังเรียบง่าย และรายการแต่ละประเภทมี field แตกต่างกัน DynamoDB จึงรองรับรูปแบบข้อมูลที่ทีมใช้อยู่ได้ ขณะที่ Lambda/API Gateway แยกหน้าเว็บออกจากการเข้าถึงฐานข้อมูลโดยตรง ส่วน Amplify ช่วยลดขั้นตอน upload frontend ด้วยตนเอง

**ข้อแลกเปลี่ยน:** ความสัมพันธ์ต้องประกอบใน application และการค้นหาปัจจุบันทำกับข้อมูลที่โหลดมาฝั่ง frontend หากข้อมูลเพิ่มขึ้นหรือจำเป็นต้องค้นหาความสัมพันธ์/ช่วงเวลาที่ซับซ้อนขึ้น ต้องทบทวนวิธี query, index และทางเลือกฐานข้อมูลอีกครั้ง

อ่านเหตุผลและทางเลือกเพิ่มเติมใน [ADR สำหรับ V2](docs/architecture/ADR-001-v2-hosting.md) และดู [แผนภาพสถาปัตยกรรม V2](docs/architecture/v2-architecture-diagram.png)

<details open>
<summary><strong>🛠️ Technology stack</strong></summary>

<br>

<table>
  <tr>
    <th align="left" width="50%">Frontend</th>
    <th align="left" width="50%">Cloud &amp; Data</th>
  </tr>
  <tr>
    <td valign="top">
      <img src="https://img.shields.io/badge/HTML5-E34F26?style=flat-square&amp;logo=html5&amp;logoColor=white" alt="HTML5">
      <img src="https://img.shields.io/badge/CSS3-1572B6?style=flat-square&amp;logo=css&amp;logoColor=white" alt="CSS3">
      <img src="https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&amp;logo=javascript&amp;logoColor=18181B" alt="JavaScript">
      <p>Vanilla HTML, CSS และ JavaScript<br>ใช้ Fetch API สำหรับเรียกข้อมูล</p>
    </td>
    <td valign="top">
      <img src="https://img.shields.io/badge/Amplify-FF9900?style=flat-square" alt="AWS Amplify Hosting">
      <img src="https://img.shields.io/badge/API_Gateway-8C4FFF?style=flat-square" alt="Amazon API Gateway">
      <img src="https://img.shields.io/badge/Lambda-FF9900?style=flat-square" alt="AWS Lambda">
      <img src="https://img.shields.io/badge/DynamoDB-4053D6?style=flat-square" alt="Amazon DynamoDB">
      <p>AWS SDK for JavaScript สำหรับสคริปต์ migration<br>GitHub Actions สำหรับอัปเดตข้อมูลสำรอง</p>
    </td>
  </tr>
</table>

**Development tools:** Git/GitHub · Node.js built-in test runner · Python HTTP server สำหรับเปิด frontend ในเครื่อง

</details>

## Scope & Next Steps

V2 เน้นการจัดเก็บ เรียกดู ค้นหา และกรอง **ข้อมูลสาธารณะ** ผู้ใช้ทั่วไปไม่สามารถเพิ่ม แก้ไข หรือลบข้อมูลผ่านเว็บไซต์ได้ Browser ไม่ต้องใช้ AWS credentials เพื่อเรียก Public API

การเข้าสู่ระบบ การกำหนดสิทธิ์หลายบทบาท หน้า Admin การจัดการเอกสารภายใน ข้อมูลส่วนบุคคล การสมัคร/แลกเปลี่ยนนักศึกษา และ Feedback workflow ยังไม่ใช่ความสามารถที่เปิดใช้ใน V2 โดย V3 จะต่อยอดไปสู่ **Secure Collaboration Workspace** ตามข้อกำหนดรายวิชา

**สถานะการค้นหาปัจจุบัน:** หน้าเว็บมี keyword search, type filters และช่วงวันที่เริ่มต้น–สิ้นสุด โดยรับปี พ.ศ. และเทียบกับ `period_date` แบบ ISO รวมวันขอบเขตทั้งสองด้าน องค์กรจะตรงเงื่อนไขเมื่อมีกิจกรรมสาธารณะในช่วงนั้น ส่วนการกรองตามสถานะและการ query ข้ามความสัมพันธ์ที่ซับซ้อนยังไม่มี UI

**หน้าเข้าสู่ระบบ:** `login.html` เป็น UI ต้นแบบ รับรหัสนักศึกษาและรหัสผ่าน แต่ยังไม่เชื่อมระบบยืนยันตัวตน ไม่ส่งหรือบันทึก credentials และจะแจ้งข้อจำกัดเมื่อกดเข้าสู่ระบบ

## Getting Started

### Run the frontend locally

ต้องมี Git และ Python 3 สำหรับเปิดเว็บผ่าน HTTP; Node.js ใช้สำหรับรันชุดทดสอบ

```bash
git clone https://github.com/Micosz/Cs361-Group1-Project7.git
cd Cs361-Group1-Project7
python3 -m http.server 8000 --directory public
```

เปิด [http://localhost:8000](http://localhost:8000) หน้าเว็บเป็น static frontend จึงไม่มีขั้นตอน build และไม่จำเป็นต้องติดตั้ง npm dependencies เพื่อเปิดหน้าเว็บ

การโหลดข้อมูลจะลองเรียก API จริงก่อน หาก API ไม่พร้อมใช้งานจะลองอ่านไฟล์สำรองใน repository การรันในเครื่องไม่ได้สร้างบริการ AWS ขึ้นมาใหม่

### Configuration

| ค่า | ตำแหน่ง | หมายเหตุ |
| --- | --- | --- |
| `API_URL` | [`public/assets/script.js`](public/assets/script.js) | Endpoint สำหรับโหลดข้อมูลหลัก |
| Public backup | [`public/data/partner-data-backup.json`](public/data/partner-data-backup.json) | Snapshot สำรอง ไม่ได้รับประกันว่าเป็นข้อมูลล่าสุด |
| Region / table | [`migrate.js`](migrate.js) | สคริปต์ migration ใช้ `us-east-1` และตาราง `Partner` |

<details>
<summary><strong>🧪 Tests &amp; data maintenance</strong></summary>

<br>

**ชุดทดสอบ frontend** ใช้ Node.js built-ins และ mock API/DOM/timers รันได้ด้วย:

```bash
npm test
```

ดูรายละเอียดกรณีค้นหา cache การกรอง และการจัดลำดับผลลัพธ์ใน [`tests/search.test.js`](tests/search.test.js) และ [บันทึกการตรวจสอบ search](docs/evidence/v2-search-verification.md) บันทึกนี้เป็นผลตรวจวันที่ 3 ตุลาคม 2026 ก่อนเพิ่ม JSON backup จึงไม่ได้ยืนยันพฤติกรรม fallback ของโค้ดปัจจุบันหรือสถานะ deployment ล่าสุด

**อัปเดตข้อมูลสำรอง:** ผู้ดูแลที่มีสิทธิ์สามารถรัน workflow **Update public data backup** ผ่าน GitHub Actions ได้ด้วยตนเอง workflow จะอ่าน API ตรวจรูปแบบข้อมูล สถานะ public และ ID ซ้ำ ก่อน commit ไฟล์สำรองที่เปลี่ยนแปลงเข้า `main` โดยไม่มี schedule อัตโนมัติ

**Migration:** `migrate.js` ใช้ย้ายข้อมูลจาก `data/partners.json` เข้า DynamoDB และต้องมี AWS credentials พร้อมสิทธิ์เขียนตาราง ใช้เฉพาะเมื่อต้องการนำเข้าข้อมูลจริง เพราะสคริปต์ใช้ `PutCommand` ซึ่งแทนที่ item ที่มี key เดิมได้; การเปิด frontend ไม่ต้องรันสคริปต์นี้

</details>

## Documentation

### V3 · Design baseline

[เริ่มอ่าน V3-B1: Scope, Permissions, TU Login/Session, Data, API และ Architecture/Migration](docs/design/v3/README.md) — เอกสารออกแบบสำหรับ #72 และ 5 sub-issues; ยังไม่ใช่ implementation หรือผลยืนยันบริการจริง

### 📘 V2 · เวอร์ชันปัจจุบัน

เริ่มจากภาพรวมระบบ แล้วอ่านเหตุผลการออกแบบและผลทดสอบเพิ่มเติม

| อ่านเรื่องอะไร | เปิดเอกสาร |
| --- | --- |
| ระบบเชื่อมต่อกันอย่างไร | [แผนภาพสถาปัตยกรรม](docs/architecture/v2-architecture-diagram.png) |
| ทำไมเลือกบริการ AWS เหล่านี้ | [เหตุผลการออกแบบ · ADR](docs/architecture/ADR-001-v2-hosting.md) |
| ตรวจสอบการค้นหาอย่างไร | [บันทึกผลทดสอบ Search](docs/evidence/v2-search-verification.md) |

<sub>บันทึกผลทดสอบ Search เป็นหลักฐานก่อนเพิ่มระบบข้อมูลสำรอง</sub>

<details>
<summary><strong>📂 V1 · เอกสารเวอร์ชันแรก — กดเพื่อเปิด</strong></summary>

<br>

เก็บไว้สำหรับดูแนวทางเริ่มต้นและพัฒนาการของโครงการ

| หมวด | เปิดเอกสาร |
| --- | --- |
| สถาปัตยกรรม | [เหตุผลการเลือก Hosting](docs/architecture/ADR-001-v1-hosting.md) · [แผนภาพระบบ](docs/architecture/v1-architecture-diagram.png) |
| ข้อมูลและหน้าจอ | [โครงสร้างข้อมูล JSON](docs/data/v1-data.md) · [การออกแบบหน้าเว็บ](docs/design/v1-design.md) |
| การเผยแพร่และหลักฐาน | [ขั้นตอน Deploy บน S3](docs/deployment/v1-deployment.md) · [หลักฐานส่งมอบ V1](docs/evidence/v1-evidence.md) |
| การใช้ AI | [AI Usage Declaration](docs/ai-usage/v1-ai-usage-declaration.md) |

</details>

<details>
<summary><strong>ℹ️ ขอบเขตไฟล์ใน repository</strong></summary>

<br>

Repository นี้มี frontend, สคริปต์ migration และ workflow อัปเดตข้อมูลสำรอง ส่วน source code ของ Lambda และการตั้งค่า API Gateway/DynamoDB ไม่ได้รวมอยู่ใน repo นี้

</details>

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
รัน `npm run build` ก่อนเปิดเว็บในเครื่อง: คำสั่งนี้สร้าง `public/login/index.html` สำหรับ URL `/login/`
โดยอัตโนมัติพร้อม `<base href="../">` เพื่อให้ assets และลิงก์กลับหน้าหลักทำงานเหมือน `/login.html`
ไฟล์ที่สร้างถูก ignore ใน Git ห้ามแก้โดยตรง เพราะจะถูกเขียนทับเมื่อ build

`npm test` เรียก build ผ่าน `pretest` ก่อนทดสอบเสมอ จึงใช้คำสั่ง build เดิมของ Amplify ได้
`amplify.yml` ยังคงเผยแพร่ `public/` โดยตรง ไม่สร้าง `dist/` และไม่ต้องแก้ค่าใน AWS Amplify
หากมี changes จาก branch เก่าที่แก้ `public/login/index.html` ให้ย้าย changes นั้นมา `public/login.html` แล้ว build ใหม่
ไฟล์ migration, ข้อมูลต้นฉบับ `data/partners.json`, tests และ docs อยู่นอก `public/` และไม่ถูกส่งขึ้นเว็บไซต์
