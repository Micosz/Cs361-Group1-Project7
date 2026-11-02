# คู่มือข้อมูล CSTUHub

ปรับปรุงวันที่ 3 พฤศจิกายน 2026 · อ้างอิงโครงสร้างจาก `main` commit `b4e8970`

เอกสารนี้อธิบายโครงสร้างข้อมูล ความสัมพันธ์ สิทธิ์การเข้าถึง และการจัดเก็บข้อมูลของ CSTUHub ครอบคลุมคู่ความร่วมมือ กิจกรรม ข้อตกลง การแลกเปลี่ยน Feedback และเอกสารแนบ ค่าการใช้งานจริงขึ้นอยู่กับ configuration ของระบบ

## 1. แหล่งจัดเก็บข้อมูล

| แหล่งเก็บ | ข้อมูลและหน้าที่ |
| --- | --- |
| `data/partners.json` | ชุดข้อมูลสาธารณะต้นทางแบบซ้อน: หน่วยงานแต่ละแห่งมี `collaborations` ของตนเอง |
| `data/source-handoff.json` | บันทึกที่มา ข้อจำกัด และข้อมูลที่เตรียมส่งต่อ ไม่ถูกโหลดเป็นระเบียนใช้งานโดยอัตโนมัติ |
| `public/data/partner-data-backup.json` | ชุดสาธารณะแบบแบนสำหรับ fallback ของหน้าเว็บ ไม่ใช่ backup ของข้อมูลธุรกิจทั้งหมด |
| DynamoDB: `PARTNER_TABLE` | Partner และ Activity; เมื่อกำหนดตารางแยก ใช้ key `(id, type)` เช่น `CSTUHub-Partner` |
| DynamoDB: `BUSINESS_TABLE` | Agreement, Exchange, Contact, History, Feedback, Form Feedback, metadata เอกสาร และระเบียนประกอบการทำงาน เช่น upload ticket และ idempotency |
| DynamoDB: ตารางบัญชี | ผู้ใช้ การเชื่อมตัวตน Session และการจำกัดคำขอ แยกจากข้อมูลธุรกิจ |
| S3: `DOCUMENT_BUCKET` | เนื้อไฟล์เอกสารส่วนตัว ส่วนชื่อไฟล์ สิทธิ์ และความสัมพันธ์กับรายการอยู่ใน DynamoDB |
| `public/resources/` | รูปและโลโก้ที่เผยแพร่ได้ ไม่ใช้เก็บเอกสารส่วนตัว |

ตารางตาม deployment configuration ได้แก่ `CSTUHub-Partner`, `CSTUHub-Business`, `CSTUHub-Users`, `CSTUHub-IdentityLinks`, `CSTUHub-Sessions` และ `CSTUHub-LoginRate` โดย Lambda เลือกตารางผ่าน environment variables การย้าย Region หรือ migration ต้องใช้ชื่อตารางตาม configuration ปลายทาง

หากไม่ได้กำหนด `PARTNER_TABLE` ตัว adapter จะเก็บ Partner/Activity ใน `BUSINESS_TABLE`

## 2. ความสัมพันธ์ของข้อมูล

| รายการ | ความสัมพันธ์ |
| --- | --- |
| Partner / Stakeholder | องค์กรหรือคู่ความร่วมมือ เป็นเจ้าของ Contact และ History |
| Activity | มีหน่วยงานหลัก `partnerId` หนึ่งแห่ง; เชื่อมผู้ร่วมจัดผ่าน `coHostPartnerIds` และข้อตกลงผ่าน `agreementIds` |
| Agreement | ข้อตกลง MoU/MoA เชื่อมหนึ่งหรือหลายองค์กรผ่าน `partnerIds` |
| Exchange | เชื่อมองค์กรผ่าน `partnerIds`, ข้อตกลงผ่าน `agreementId` เมื่อมี และผู้เข้าร่วมผ่าน `participantUserIds` |
| Feedback / Form Feedback | ผูกกับ Partner, Activity หรือ Exchange ผ่าน `parentType` และ `parentId` |
| Document | ผูกกับ Agreement หรือ Exchange เท่านั้นในเส้นทางเอกสารปัจจุบัน |

การมีชื่อองค์กรในเครือข่ายหรือข่าวกิจกรรมไม่ได้แปลว่ามี MoU รายฉบับ และการเชื่อมองค์กรกับกิจกรรมไม่ได้ให้สิทธิ์แก้ไขหรืออ่านข้อมูลภายในขององค์กรนั้นโดยอัตโนมัติ Backend ตรวจ reference และ `scopeId` ก่อนบันทึก

## 3. ฟิลด์ร่วมและหลักการบันทึก

| ฟิลด์ | ความหมาย |
| --- | --- |
| `id` | รหัสถาวรของรายการ ไม่ใช้ชื่อที่แสดงเป็นรหัสอ้างอิง |
| `entityType` | ชนิดระเบียน เช่น `partner`, `activity`, `agreement`, `exchange`, `feedback`, `formFeedback`, `document` |
| `scopeId` | ขอบเขตข้อมูลที่ใช้ตรวจสิทธิ์; รายการลูกสืบทอดจากรายการแม่ |
| `scopeEntity` | ค่าประกอบ `<scopeId>#<entityType>` สำหรับค้นผ่านดัชนีใน Business table |
| `version` | รุ่นข้อมูลสำหรับป้องกันการเขียนทับงานที่ถูกแก้ไขไปแล้ว |
| `schemaVersion` | รุ่นโครงสร้างข้อมูล เช่น schema 3 ในระเบียนที่ผ่านการย้ายโครงสร้าง |
| `createdAt`, `updatedAt` | เวลา ISO 8601 ที่ระบบบันทึก |
| `createdBy`, `updatedBy` | ผู้ดำเนินการตามเส้นทางบันทึก; ไม่เปิดเผยเป็นข้อมูลสาธารณะโดยอัตโนมัติ |
| `responsibleUserIds` | ผู้รับผิดชอบรายการธุรกิจ ใช้ประกอบสิทธิ์ของผู้ประสานงาน |
| `publication` | `internal` หรือ `public` สำหรับ Partner, Activity และ Agreement |

ชื่อฟิลด์และตัวพิมพ์เล็ก–ใหญ่ต้องตรงตาม API ฟิลด์ที่ระบบสร้าง เช่น `id`, `version`, `objectKey` และข้อมูลสิทธิ์ ไม่ใช่ค่าที่ผู้ใช้ส่งเพิ่มเองได้ การแก้ไขใช้ `If-Match` ตาม version และการสร้างในเส้นทางที่กำหนดใช้ `Idempotency-Key` เพื่อป้องกันรายการซ้ำจากการส่งคำขอเดิม

การเขียนข้อมูลใช้ transaction ตรวจผู้ใช้ Session รายการเป้าหมาย รายการแม่ และ reference ที่เกี่ยวข้องร่วมกับการบันทึก ส่วนดัชนี `scope-entity-id` ใช้ค้นหารหัสรายการ ก่อนอ่านข้อมูลล่าสุดแบบ consistent read และตรวจสิทธิ์อีกครั้ง

## 4. พจนานุกรมข้อมูลธุรกิจ

ฟิลด์หลักของ API แบ่งตามชนิดระเบียนดังนี้ การรับค่าแต่ละฟิลด์ขึ้นอยู่กับ validation และสิทธิ์ของผู้บันทึก

### Partner / Stakeholder

| ฟิลด์ | ชนิด / เงื่อนไข |
| --- | --- |
| `name` | String; ต้องมี; ไม่เกิน 200 ตัวอักษร |
| `type` | `company`, `university`, `government`, `research_institute`, `internship` |
| `summary` | String; ต้องมี; ไม่เกิน 2,000 ตัวอักษร |
| `location` | String; ต้องมี; domain validator จำกัด 200 ตัวอักษร |
| `fullDescription` | String; รายละเอียดเพิ่มเติม ไม่เกิน 20,000 ตัวอักษร |
| `websiteUrl` | URL แบบ HTTP/HTTPS หรือข้อความว่าง; ไม่รับ user/password ใน URL |
| `logoPath` | รูปสาธารณะตามรูปแบบ `resources/<ชื่อไฟล์>.jpg/jpeg/png/webp` หรือข้อความว่าง |
| `scopeId`, `responsibleUserIds`, `publication` | ขอบเขต ผู้รับผิดชอบ และการเผยแพร่ตามสิทธิ์ผู้บันทึก |

### Activity

| ฟิลด์ | ชนิด / เงื่อนไข |
| --- | --- |
| `title`, `summary` | String; ต้องมี; สูงสุด 200 และ 2,000 ตัวอักษรตามลำดับ |
| `type` | `academic_activity`, `event`, `research`; API สร้างกิจกรรมปัจจุบันไม่รับ `internship` |
| `partnerId` | รหัสองค์กรหลักที่อ้างอิงได้ ต้องมี |
| `coHostPartnerIds` | Array ของรหัสผู้ร่วมจัด ไม่ซ้ำ ไม่รวมองค์กรหลัก สูงสุด 19 แห่ง |
| `agreementIds` | Array ของรหัสข้อตกลง ไม่ซ้ำ สูงสุด 20 รายการ |
| `periodText` | ข้อความช่วงเวลา สูงสุด 2,000 ตัวอักษร |
| `periodDate` | วันแบบ `YYYY-MM-DD` หรือ `null` เมื่อไม่ระบุ |
| `fullDescription`, `imagePath` | รายละเอียดและรูปประกอบสาธารณะ |
| `outcomeSummary` | สรุปผลลัพธ์ สูงสุด 10,000 ตัวอักษร; ยังมีใน model แม้บางหน้าจะไม่แสดงส่วนผลลัพธ์ |
| `scopeId`, `responsibleUserIds`, `publication` | ขอบเขต ผู้รับผิดชอบ และการเผยแพร่ |

### Agreement

| ฟิลด์ | ชนิด / เงื่อนไข |
| --- | --- |
| `title`, `agreementType` | ชื่อข้อตกลงและประเภท `MoU` / `MoA`; ต้องมี |
| `partnerIds` | Array ขององค์กร 1–20 แห่ง ไม่ซ้ำ |
| `startDate`, `endDate`, `renewalDueOn` | วันเริ่ม วันสิ้นสุด และกำหนดต่ออายุแบบ `YYYY-MM-DD`; วันเริ่มต้องไม่เกินวันสิ้นสุดเมื่อระบุทั้งคู่ |
| `renewalNote`, `internalNote` | หมายเหตุการต่ออายุและข้อมูลภายใน สูงสุดฟิลด์ละ 20,000 ตัวอักษร |
| `status` | `draft`, `active`, `expired`, `terminated`; เริ่มต้นเป็น `draft` และเปลี่ยนผ่านคำขอสถานะ |
| `scopeId`, `responsibleUserIds`, `publication` | ขอบเขต ผู้รับผิดชอบ และการเผยแพร่ |

การเปลี่ยนสถานะใช้คำขอเฉพาะและตรวจเงื่อนไข เช่น วันที่และเหตุผล สถานะที่บันทึกแยกจากวันสิ้นสุดของข้อตกลง

### Exchange

| ฟิลด์ | ชนิด / เงื่อนไข |
| --- | --- |
| `title`, `partnerIds` | ชื่อและองค์กรที่เกี่ยวข้อง; ต้องมีองค์กร 1–20 แห่ง ไม่ซ้ำ |
| `agreementId` | ข้อตกลงที่เกี่ยวข้องเมื่อมี |
| `participantUserIds` | Array สูงสุด 200 รหัส ไม่ซ้ำ; ผู้เข้าร่วมต้องผ่านการตรวจบัญชีและสิทธิ์ student ใน scope เดียวกัน |
| `startDate`, `endDate` | ช่วงวันแบบ `YYYY-MM-DD`; ตรวจลำดับวัน |
| `supportingInfo` | ข้อมูลประกอบภายใน |
| `supportingInfoForParticipant` | ข้อมูลที่อนุญาตให้ผู้เข้าร่วมเห็น |
| `outcomeSummary` | สรุปผลลัพธ์ของการแลกเปลี่ยน |
| `status` | `draft`, `ongoing`, `completed`, `cancelled` |
| `scopeId`, `responsibleUserIds` | ขอบเขตและผู้รับผิดชอบ |

### Contact และ History

| รายการ | ฟิลด์หลัก |
| --- | --- |
| Contact | `partnerId`, `name` (ต้องมี), `position`, `email`, `phone` |
| History | `partnerId`, `occurredOn`, `kind`, `note`; สามฟิลด์หลังต้องมี |
| ประเภท History | `meeting`, `agreement`, `activity`, `other` |
| Reference ของ History | `referenceType` เป็น `agreement` หรือ `activity` และต้องมี `referenceId` คู่กันเมื่อใช้อ้างอิง |

Contact/History เป็นข้อมูลภายในขององค์กร ไม่รวมใน public catalog โดย History เก็บประวัติที่ผู้ใช้บันทึก แยกจาก audit log ของระบบ

## 5. ประเภทของ Feedback

| รูปแบบ | ฟิลด์สำคัญ | การแสดงผลและขอบเขต |
| --- | --- | --- |
| Feedback ที่บันทึกในระบบ | `occurredOn`, `sourceType`, `comment`, `improvement`, `respondentName` เมื่อมี | เชื่อม Partner/Activity/Exchange; อ่านตามสิทธิ์ และแก้ไขได้เฉพาะผู้สร้างที่ยังมีสิทธิ์ |
| คอมเมนต์จากผู้เยี่ยมชมเว็บ | `origin: web`, `respondentType`, `comment`; ระบบกำหนดวันและ `createdBy: anonymous` | เฉพาะ Partner/Activity ที่เผยแพร่; แสดงผ่าน public feedback endpoint |
| คำตอบนำเข้าจากแบบฟอร์ม | `entityType: formFeedback`, `origin: form_import`, ข้อมูลคำถาม/คำตอบเป็น batch | ข้อมูลภายในสำหรับ coordinator/staff/executive ตาม scope และสิทธิ์ของรายการ |

Feedback ภายในใช้ `sourceType` เป็น `participant`, `partner`, `other`; `comment` ต้องมีและยาวไม่เกิน 10,000 ตัวอักษร `improvement` ไม่เกิน 10,000 และ `respondentName` ไม่เกิน 200 ตัวอักษร

คอมเมนต์สาธารณะรับเฉพาะ `respondentType` และ `comment` โดยประเภทผู้ตอบคือ `student`, `teacher`, `partner`, `participant`, `other` และข้อความยาว 1–5,000 ตัวอักษร ไม่ต้องเข้าบัญชี TU แต่ต้องมี anonymous session, CSRF token และผ่านการจำกัดคำขอ ประเภทผู้ตอบเป็นการระบุตนเอง ไม่ใช่บทบาทที่ยืนยันแล้วหรือสิทธิ์ในระบบ คอมเมนต์ชนิดนี้ใช้ `sourceType: other` และแยกประเภทด้วย `respondentType`

Reaction `like` / `dislike` นับตาม Session ไม่ใช่จำนวนผู้ตอบที่ยืนยันตัวตน

หน้า Feedback Inbox รวมข้อมูลตามสิทธิ์ โดย API รายการซ่อน `respondentName` และเพิ่ม `parentTitle`; สำหรับ Activity เพิ่ม `relatedPartners` เฉพาะรหัสและชื่อองค์กรที่อนุญาตให้แสดง การอ่าน Feedback ร่วมกันไม่ได้เพิ่มสิทธิ์แก้ไขรายการแม่หรือดาวน์โหลดเอกสารของรายการนั้น

## 6. การนำเข้า Excel / CSV จากแบบฟอร์ม

ระบบอ่านไฟล์ `.xlsx` หรือ `.csv` ที่ผู้ใช้ส่งออกจาก Google Forms/Sheets หรือแหล่งอื่น ไม่ได้เชื่อม Google Forms อัตโนมัติ ผู้ใช้เลือกชีต แถวหัวคำถาม คอลัมน์คำตอบ และคอลัมน์เวลาเมื่อมี แล้วตรวจตัวอย่างก่อนบันทึก

| ฟิลด์ | ความหมาย |
| --- | --- |
| `formName`, `sourceType` | ชื่อแบบฟอร์มและประเภทแหล่งข้อมูล |
| `fileName`, `sheetName` | ชื่อไฟล์และชีตสำหรับติดตามที่มา |
| `columns` | Array ของหัวคำถามตามลำดับที่เลือก |
| `rows[].sourceRow` | หมายเลขแถวต้นทาง |
| `rows[].answers` | คำตอบแบบ String เรียงตรงกับ `columns` |
| `rows[].respondedAt` | เวลาตอบจากคอลัมน์ที่เลือก เก็บเป็นข้อความ ไม่บังคับเป็น ISO date |
| `responseCount`, `contentHash`, `importedByName` | จำนวนคำตอบ fingerprint ป้องกันนำเข้าซ้ำ และชื่อผู้บันทึกที่ระบบเติม |

หนึ่ง batch เป็นหนึ่งระเบียน `formFeedback` ซึ่งเก็บคำตอบหลายคนภายใน ไม่ได้สร้าง `feedback` หนึ่งแถวต่อคำตอบ การแสดงผลเรียงหัวคำถามตามด้วยคำตอบ และรายการ batch จะไม่ส่ง `columns`/`rows` จนกว่าจะขอรายละเอียด

ข้อจำกัดการนำเข้า:

- ไฟล์ต้นทางไม่เกิน 5 MiB; CSV ต้องเป็น UTF-8 และ Excel รองรับไม่เกิน 30 ชีต
- อ่านไม่เกิน 2,000 แถวข้อมูลและ 100 คอลัมน์; บันทึกได้ครั้งละ 1,000 คำตอบ
- หัวคำถามยาวไม่เกิน 500 ตัวอักษร; คำตอบต่อช่องไม่เกิน 10,000 ตัวอักษร
- payload JSON ที่เลือกแล้วไม่เกิน 200 KiB รวมอักษรไทยแบบ UTF-8; ขนาดนี้เป็นคนละข้อจำกัดกับขนาดไฟล์ต้นทาง
- ประมวลผลไฟล์ใน Web Worker; ไม่คำนวณสูตร และส่งเฉพาะข้อมูลคอลัมน์ที่เลือก ไม่อัปโหลด workbook ต้นฉบับเข้า S3 ใน flow นี้
- ระบบตรวจเนื้อหาซ้ำภายใต้รายการแม่เดียวกันด้วย fingerprint; เปลี่ยนชื่อไฟล์อย่างเดียวไม่ทำให้เป็นชุดข้อมูลใหม่

นำเข้าเฉพาะคอลัมน์ที่จำเป็นต่อการติดตามความร่วมมือ คำตอบที่เลือกจะถูกจัดเก็บและเปิดอ่านได้ตามสิทธิ์ของข้อมูลภายใน

## 7. เอกสารแนบและ S3

ไฟล์แนบจัดเก็บใน S3 ส่วน metadata จัดเก็บใน Business table แยกจากการนำเข้าคำตอบ Excel/CSV

| ฟิลด์ metadata | ความหมาย |
| --- | --- |
| `parentType`, `parentId`, `scopeId` | รายการ Agreement/Exchange และขอบเขตที่ไฟล์สังกัด |
| `displayName`, `mime`, `size` | ชื่อแสดงผล ชนิดไฟล์ และขนาดเป็น byte |
| `audience` | `internal` หรือ `participants`; แบบผู้เข้าร่วมใช้กับ Exchange |
| `containsPersonal` | Boolean ระบุข้อมูลส่วนบุคคล; เมื่อเป็นจริงต้องเป็นเอกสารของ Exchange ที่ให้ผู้เข้าร่วมอ่าน |
| `objectKey`, `storageVersionId` | ตำแหน่งไฟล์และ S3 version ที่ตรวจแล้ว; ไม่ส่งออกเป็น public catalog |
| `hash`, `storageMode`, `uploadState` | SHA-256, โหมดจัดเก็บ เช่น `direct` และสถานะไฟล์ |
| `uploadedBy`, `uploadedAt` | ผู้ส่งไฟล์และเวลาที่ระบบบันทึก |

เมื่อเปิด `DOCUMENT_DIRECT_UPLOAD_ENABLED=true` ลำดับการทำงานคือ:

1. API ตรวจ Session สิทธิ์รายการแม่ และ metadata แล้วสร้าง upload ticket
2. Browser ส่งไฟล์ตรงไป `documents/staging/` ใน S3 ด้วย presigned POST
3. Backend ตรวจขนาด MIME, SHA-256 และโครงสร้าง/signature ของไฟล์ โดยอ่าน S3 version ที่ระบุแน่นอน
4. ไฟล์ที่ผ่านการตรวจถูกคัดลอกไป `documents/ready/` และบันทึก metadata พร้อม version ใน transaction
5. ตอนเปิดไฟล์ API ตรวจสิทธิ์อีกครั้ง แล้วส่งลิงก์ดาวน์โหลดชั่วคราวที่มีอายุ 120 วินาที พร้อม `no-store`

Upload ticket ใช้สถานะ `pending`, `processing`, `ready`, `failed` ส่วน metadata เอกสารใช้ `uploadState` เช่น `ready` หรือ `deleted` ไฟล์ที่อยู่ใน staging ต้องผ่านการตรวจก่อนจึงพร้อมใช้งาน

Direct upload รองรับ PDF/DOCX สูงสุด 50 MiB และ PNG/JPEG สูงสุด 10 MiB โดยลดเพดานได้ผ่าน environment variables ส่วนการอัปโหลดเดิมผ่าน API จำกัด 3 MiB ขนาดที่ใช้ได้จึงขึ้นอยู่กับโหมดและ configuration การตรวจไฟล์ครอบคลุมชนิด โครงสร้าง และ checksum แต่ไม่รวมการสแกนมัลแวร์

Direct upload ต้องเปิด S3 Versioning ส่วน Lifecycle, replication, backup และ DynamoDB PITR ต้องกำหนดแยกใน AWS สำหรับ static fallback ใช้แสดง catalog เท่านั้น ไม่รองรับการกู้เอกสารหรือ Feedback

## 8. สิทธิ์และข้อมูลบัญชี

| Environment variable | Key | หน้าที่ |
| --- | --- | --- |
| `USER_TABLE` | `id` | บัญชีผู้ใช้ `active`, `identityVerified`, `grants`, `capabilities`, `authzVersion` |
| `IDENTITY_TABLE` | `subjectKey` | เชื่อมตัวตนจากผู้ให้บริการกับ `userId` |
| `SESSION_TABLE` | `tokenHash` | Session และเวลาใช้งาน/หมดอายุ เช่น `expiresAt`, `absoluteExpiresAt` |
| `LOGIN_RATE_TABLE` | `key` | ตัวนับจำกัดคำขอ login, public feedback และ reaction ตามช่วงเวลา |

บทบาทผู้ใช้ประกอบด้วย `student`, `coordinator`, `staff`, `executive` โดยตรวจคู่ role/scope ไม่ใช้ชื่อที่แสดงหน้าจออย่างเดียว ผู้ประสานงานต้องเป็นผู้รับผิดชอบสำหรับการจัดการรายการที่กำหนด ส่วนการอ่าน Feedback ร่วมมีข้อยกเว้นเฉพาะการอ่านตาม scope

Student อ่านกิจกรรมที่เผยแพร่ ข้อตกลงสาธารณะ และ Exchange ที่มีชื่อเป็นผู้เข้าร่วมตามเงื่อนไขของแต่ละ endpoint เอกสารของผู้เข้าร่วมต้องผ่านทั้งสิทธิ์รายการแม่และ `audience` ขณะที่ Form Feedback เป็นข้อมูลสำหรับบุคลากรภายใน

สิทธิ์ `manageRoles` แยกเป็น capability ตาม scope; บทบาท Executive ไม่ได้ทำให้ได้รับสิทธิ์จัดการบัญชีทุกคนโดยอัตโนมัติ ข้อมูลบัญชี Session สิทธิ์ Contact และหมายเหตุภายในต้องไม่ถูกคัดลอกไปไฟล์ใต้ `public/`

## 9. ภาพรวมและการตีความตัวเลข

API ภาพรวมอนุญาต `staff`/`executive` และสรุปเฉพาะข้อมูลที่อ่านได้หลังใช้ตัวกรอง จึงไม่ใช่ยอดทั้งฐานข้อมูลสำหรับผู้ใช้ทุกคน

- จำนวน Stakeholder นับตามขอบเขตและประเภทที่เลือก ไม่กรององค์กรด้วยช่วงวันของกิจกรรม
- กิจกรรมใช้ `periodDate`; Agreement/Exchange ตรวจช่วงวันที่ซ้อนกับช่วงค้นหา เมื่อกรองวัน รายการที่ไม่มีวันครบตามเงื่อนไขจะไม่ถูกรวม
- ตัวกรองประเภทองค์กรพิจารณาทั้งองค์กรหลักและผู้ร่วมจัดของกิจกรรม
- จำนวน Feedback ของ overview ใน backend ปัจจุบันคำนวณจาก `feedback` ของ Activity/Exchange ที่ผ่านตัวกรอง ไม่รวม Feedback ของ Partner และไม่รวมคำตอบใน `formFeedback` จึงอาจต่างจากหน้า Feedback Inbox
- `outcomeSummary` และผลรวม outcomes ยังอยู่ใน backend แม้จะนำแท็บหรือการ์ดผลลัพธ์ออกจาก UI แล้ว

ข้อมูลจำลอง เช่น `PART-A`, `PART-B`, `PART-C` ใช้ประกอบการทดสอบ และต้องแยกจากข้อมูลความร่วมมือจริงเมื่อนำไปสรุปรายงาน

<a id="v1-data"></a>
<a id="v1-data-version-1-public-data"></a>

## 10. ชุดข้อมูลสาธารณะเดิมและการใช้งานร่วมกับระบบปัจจุบัน

`data/partners.json` มี **17 หน่วยงานและ 12 กิจกรรมแบบซ้อน** ส่วน `public/data/partner-data-backup.json` มี **29 ระเบียนแบบแบน** จำนวนนี้เป็นชุดเริ่มต้นใน repository ไม่รวมรายการที่ผู้ใช้เพิ่มใน DynamoDB ภายหลัง

<a id="v1-data-public-data-model-and-validation"></a>

### ชื่อฟิลด์เดิมกับ API จัดการ

| ชุดข้อมูลสาธารณะเดิม | API จัดการ | ความหมาย |
| --- | --- | --- |
| `full_description` | `fullDescription` | รายละเอียด |
| `website_url` | `websiteUrl` | เว็บไซต์องค์กร |
| `logo_path` | `logoPath` | โลโก้ |
| `period` | `periodText` | ข้อความช่วงเวลา |
| `period_date` | `periodDate` | วันเริ่ม/วันกิจกรรม |
| `image_path` | `imagePath` | รูปกิจกรรม |
| `co_hosts` เป็นชื่อ | `coHostPartnerIds` เป็นรหัส | ผู้ร่วมจัด; backend ต้องตรวจ reference ไม่ใช้ชื่อแทน ID |
| `access_level` / `visibility` | `publication` | สถานะเผยแพร่; หากมีหลาย flag ต้องไม่ขัดกัน |
| `collaborations` แบบซ้อน | ระเบียน `activity` แยกต่างหาก | กิจกรรมเชื่อมด้วย `partnerId` |

`source_urls`, `source_checked_on`, `evidence_note`, `relationship_basis` และ `organization_roles` เป็นข้อมูลประกอบหลักฐาน ไม่ใช่การมอบสิทธิ์ บทบาทผู้ลงนามหรือวิทยากรไม่เท่ากับผู้ประสานงานโดยอัตโนมัติ

`date_precision` อธิบายความแน่นอนของวัน (`day`, `range`, `month`, `unknown`) และ `period_end_date` เก็บวันสิ้นสุดในข้อมูลเดิม หากไม่ทราบวันหรือหลักฐานขัดกัน ให้เก็บความไม่แน่นอน ห้ามเติมวันที่สมมติ ส่วน `activity_tags: ["mou"]` เป็นป้ายสำหรับตัวกรองข่าว ไม่ใช่ระเบียน Agreement หรือสถานะ MoU ที่ยังมีผล

<a id="v1-data-catalog-deployment"></a>

### การอ่านและเผยแพร่ catalog

หน้าเว็บเรียก `/fetchPartnersData` ก่อน และใช้ `public/data/partner-data-backup.json` เมื่ออ่าน API ไม่สำเร็จ เมื่อเปิด auth integration จะอ่าน `/api/public/records` เพิ่มและรวมด้วย ID backend ส่งเฉพาะฟิลด์ที่อนุญาตสำหรับข้อมูลสาธารณะ ไม่ส่งระเบียนฐานข้อมูลทั้งก้อน

`PARTNER_TABLE` แบบแยกใช้ `(id, type)` และไม่นำรายการ `source_state: retired` มาเป็น active record ถ้าพบหลาย active rows ของ ID/ชนิดระเบียนเดียวกัน ตัวอ่านจัดการจะตอบ `AMBIGUOUS_RECORD` แทนการเลือกเอง

Repository ปัจจุบันมี `.github/workflows/lambda-deploy.yml` สำหรับ deploy Python backend แต่ไม่มี workflow sync catalog ต้นทางเข้า DynamoDB อัตโนมัติ การ build/deploy หน้าเว็บหรือแก้ JSON จึงไม่ได้อัปเดตฐานข้อมูลตามไปด้วย การใช้ `migrate.js` รุ่นเก่าต้องตรวจตารางปลายทางและผลกระทบก่อนดำเนินการ

หากแก้ชุดข้อมูลสาธารณะต้นทาง ต้องปรับ fallback ให้ตรงกันใน changeset เดียวกันและรักษารหัสเดิม ส่วนข้อมูลที่เพิ่มผ่านฟอร์มให้แก้ผ่าน API ที่มีสิทธิ์ ไฟล์ fallback ต้องมีเฉพาะข้อมูลสาธารณะ การใช้ fallback อาจแสดงข้อมูลเก่าจึงต้องคงข้อความแจ้งผู้ใช้ไว้

<a id="v1-data-json-structure"></a>

### ตัวอย่างความสัมพันธ์เชิงโครงสร้าง

```text
Partner: partner-example
  Activity: activity-example
    partnerId = partner-example
    coHostPartnerIds = [partner-cohost]
    agreementIds = [agreement-example]
    Feedback: parentType = activity, parentId = activity-example
    Form Feedback: columns + rows อยู่ใน batch เดียว
  Contact / History: partnerId = partner-example
Agreement: agreement-example
  partnerIds = [partner-example, partner-cohost]
  Document metadata → S3 objectKey + storageVersionId
Exchange: exchange-example
  partnerIds = [partner-example]
  agreementId = agreement-example
  participantUserIds = [user-example]
  Feedback / Form Feedback / Document ผูกกับ Exchange นี้
```

ตัวอย่างใช้รหัสสมมติเพื่อแสดงความสัมพันธ์ของข้อมูล

## 11. ไฟล์ที่เกี่ยวข้อง

| เรื่อง | ไฟล์ใน repository |
| --- | --- |
| Runtime และตาราง | `backend/lambda_function.py`, `backend/business/dynamo_repository.py` |
| ฟิลด์ สิทธิ์ และ public projection | `backend/permissions/policy.py`, `backend/permissions/projections.py` |
| Validation ธุรกิจ | `backend/business/validation.py`, `backend/partners/validators.py`, `backend/agreements/validators.py` |
| ความสัมพันธ์กิจกรรม | `backend/relationships/activity_links.py` |
| Feedback ภายใน/สาธารณะ | `backend/feedback.py`, `backend/application.py`, `backend/business/dynamo_repository.py` |
| Form import | `backend/form_feedback.py`, `public/assets/form-import-data.js`, `public/assets/form-import-worker.js` |
| เอกสาร | `backend/documents/direct_gateway.py`, `backend/documents/direct_storage.py`, `backend/documents/direct_validation.py` |
| Inbox และ Overview | `backend/permissions/gateway.py`, `public/assets/feedback-inbox.js`, `public/assets/overview.js` |
| Public catalog และ fallback | `backend/lambda/fetchPartnersData/index.mjs`, `public/assets/script.js` |

<a id="sources"></a>

## แหล่งข้อมูลและข้อจำกัด

| ความร่วมมือ / หน่วยงานที่เกี่ยวข้อง | กิจกรรมที่มีหลักฐาน | หลักฐานจาก LinkedIn CSTU / เว็บสาขา / เว็บคณะ (ตรวจ 9 ต.ค. 2026; เฉพาะรายการที่พบ ไม่ใช่ครบทุกหน้า) |
| --- | --- | --- |
| **IPB, อินโดนีเซีย — ผู้จัดหลักสูตรที่นักศึกษา CSTU เข้าร่วม** | International Summer Course CSAgri IPB 2022, 9–17 ก.ย. 2565; นักศึกษาภีมภัช พจน์สุนทร และธนกฤต ยืนยงพิสิฐเข้าร่วมกิจกรรม IoT เพื่อเกษตร | [เว็บสาขา: เครือข่ายความร่วมมือ](https://cs.sci.tu.ac.th/partnership-th/) ระบุโครงการ ช่วงวัน และนักศึกษาที่เข้าร่วม; ไม่ใช่หลักฐาน MoU รายฉบับ |
| **UC San Diego, สหรัฐฯ — สถาบันปลายทางวิจัย** | International Summer Research Program (ISRP), 26 มิ.ย.–27 ส.ค. 2565; เปมิกา ศรีโมราเข้าร่วมวิจัยหุ่นยนต์โดยได้รับทุน Outbound | [เว็บสาขา: เครือข่ายความร่วมมือ](https://cs.sci.tu.ac.th/partnership-th/) ระบุผู้เข้าร่วม ช่วงวัน และงานวิจัย |
| **KBTG — หน่วยงานที่ร่วมแบ่งปันความรู้** | KBTG University Roadshow, ต.ค. 2563; ผู้เชี่ยวชาญแนะนำบริษัทและแบ่งปันความรู้แก่นักศึกษา | [เว็บสาขา: เครือข่ายความร่วมมือ](https://cs.sci.tu.ac.th/partnership-th/) ระบุชื่อกิจกรรมและเดือน แต่ไม่ระบุวันแน่นอนหรือยืนยัน MoU |
| **Feed Ingredients Trading Business Group (C.P. Group) — หน่วยงานของวิทยากร** | สาขาจัดสัมมนา Democratizing A.I. – How a computer scientist can help narrow social inequality, 24 ก.พ. 2563; เชิญผู้เชี่ยวชาญบริษัทแบ่งปันความรู้ | [เว็บสาขา: เครือข่ายความร่วมมือ](https://cs.sci.tu.ac.th/partnership-th/) ระบุผู้จัด วิทยากร และวันที่; ไม่ยืนยัน MoU |
| **Technological University Dublin, ไอร์แลนด์ — หน่วยงานที่หารือความร่วมมือ** | หารือความเป็นไปได้ด้านการศึกษา, 5 พ.ย. 2562 ณ ศูนย์รังสิต | [เว็บสาขา: เครือข่ายความร่วมมือ](https://cs.sci.tu.ac.th/partnership-th/) ระบุการหารือและผู้แทน; ไม่ยืนยันว่าลงนาม MoU แล้ว |
| **AIST, ญี่ปุ่น — สถาบันปลายทางวิจัย** | ยุทธนา บุญปาลิต และศิวกร สุวรรณจินดาไปแลกเปลี่ยนวิจัยที่ Tsukuba; หน้าเครือข่ายระบุ 10 มิ.ย.–17 ส.ค. 2563 | [เว็บสาขา: เครือข่ายความร่วมมือ](https://cs.sci.tu.ac.th/partnership-th/) ระบุ AIST และนักศึกษา; [หน้ารวมเว็บคณะ](https://sci.tu.ac.th/all-exchange-students-th/) ระบุช่วงในปี 2562 สำหรับชื่อเดียวกัน จึงต้องยืนยันรอบ/วันที่ก่อนใช้; ไม่ผูกกับ King Power Click จากคำบรรยายปะปน |
| **AIST, ญี่ปุ่น — สถาบันปลายทางและผู้สนับสนุนการเดินทาง/ที่พัก** | ปริญญา บุญเอี่ยมไปแลกเปลี่ยนวิจัย, 20 ม.ค.–6 มี.ค. 2563 โดยมีประภาพร รัตนธำรงเป็นอาจารย์ที่ปรึกษา | [เว็บคณะ: บันทึกปริญญา](https://sci.tu.ac.th/exchange-student-outbound-eu-6-th/) ระบุสาขาวิทยาการคอมพิวเตอร์ ช่วงวัน และการสนับสนุนจาก AIST |
| **Faculty of Information Technology, Yarsi University, อินโดนีเซีย — คู่ลงนามกับคณะ SCI-TU โดยสาขามีส่วนร่วม** | ลงนาม MoU ด้านวิชาการ วิจัย และพัฒนานักศึกษา, 22 มิ.ย. 2565 | [เว็บคณะ: ข่าว Yarsi](https://sci.tu.ac.th/news-2022-6-22/) ระบุคณาจารย์สาขาร่วมพิธีและผู้ลงนาม ณัฐธนนท์ หงส์วริทธิ์ธร กับ Dr. Ummi Azizah Rachmawati; ไม่ระบุอายุข้อตกลงหรือสถานะล่าสุด |
| **NVIDIA, SVOA, ECTI และคณะพาณิชยศาสตร์ฯ — ผู้ร่วมจัด; AGICAFET — หน่วยงานของวิทยากร** | NVIDIA Powers the World’s AI, And Yours: Unlocked, 9 ก.ค. 2569 เวลา 09.00–16.00 น. ณ SC3 ห้อง 402 ศูนย์รังสิต; อบรม Local AI | [เว็บคณะ: ข่าวกิจกรรม NVIDIA](https://sci.tu.ac.th/%E0%B8%84%E0%B8%93%E0%B8%B0%E0%B8%A7%E0%B8%B4%E0%B8%97%E0%B8%A2%E0%B8%B2%E0%B8%A8%E0%B8%B2%E0%B8%AA%E0%B8%95%E0%B8%A3%E0%B9%8C%E0%B9%81%E0%B8%A5%E0%B8%B0%E0%B9%80%E0%B8%97%E0%B8%84%E0%B9%82-43/) ระบุสาขาเป็นผู้ดำเนินการ ผู้ร่วมจัด และวิทยากร; ยืนยันบทบาทในงานนี้ ไม่ยืนยัน MoU ทุกหน่วยงาน |
| **PRAGMA34 — เวทีประชุมที่นักศึกษาและอาจารย์สาขาเข้าร่วม** | นำเสนอผลงานโครงงานที่ Akihabara โตเกียว; สุชานาถ มั่งคั่งเจริญได้รับรางวัลโปสเตอร์อันดับ 3 | [เว็บสาขา: ข่าว PRAGMA34](https://cs.sci.tu.ac.th/2021/02/15/the-pragma34-workshop-meeting/) ระบุผู้เข้าร่วมและรางวัล; ข่าวเผยแพร่ปี 2021 แต่เนื้อหาระบุ 11 พ.ค. 2561 พร้อมชื่อวันที่ไม่ตรงปฏิทิน ต้องยืนยันวันกิจกรรม; ไม่ใช่หลักฐานคู่สัญญา MoU |
| **หน่วยบัญชาการไซเบอร์ กองทัพไทย (CNC) — หน่วยงานที่หารือโอกาสความร่วมมือ** | ผู้แทนวิทยาการคอมพิวเตอร์และคณิตศาสตร์/สถิติหารือด้าน Cybersecurity, 4 ก.ย. 2026 | [LinkedIn CSTU: CNC](https://lnkd.in/p/gAqkfXX9) ระบุวันที่ หน่วยงาน และหัวข้อหารือ; ยังไม่ยืนยัน MoU |
| **Embedded LLM และ AGICAFET — คู่ลงนาม MoU กับ CSTU ตามข่าว** | ลงนาม MoU เพื่อพัฒนาการเรียน AI Platform Engineering ระหว่าง CSTU Spark Camp in AI: Final Pitching Day | [LinkedIn CSTU: MoU](https://lnkd.in/p/gSXtuQDq) ระบุคู่ความร่วมมือ เป้าหมาย และผู้ลงนาม; ไม่ระบุวันจัดงาน ช่วงอายุข้อตกลง หรือสถานะล่าสุด |
| **CSTU Spark Camp in AI — กิจกรรมที่เชื่อมกับข่าว MoU Embedded LLM / AGICAFET** | Final Pitching Day; ผู้สมัคร 111 คน ผ่าน Phase 1 จำนวน 67 คน ผ่าน Phase 2 จำนวน 61 คน แสดงผลงาน 41 คน และรอบสุดท้าย 6 ทีม | [LinkedIn CSTU: โพสต์เดียวกับ MoU](https://lnkd.in/p/gSXtuQDq) ระบุชื่อกิจกรรมและจำนวนผู้เข้าร่วมแต่ละช่วง; เป็นเรื่องในโพสต์เดียวกัน ไม่ใช่ข่าวอีกโพสต์ และยังไม่ยืนยันวันจัด |
| **Kansai University, ญี่ปุ่น — สถาบันปลายทางโครงการนำร่อง; University of Florida — สถาบันของอาจารย์ที่ร่วมให้คำปรึกษา** | นักศึกษาชั้นปีที่ 4 Pitawat Piruksa แลกเปลี่ยนวิจัย AI/BIM กับ Prof. Kohei Ichikawa และประชุมออนไลน์กับอาจารย์ประภาพร รัตนธำรง และ Prof. José Fortes | [LinkedIn CSTU: Kansai Exchange](https://lnkd.in/p/gxEmjuZD) ระบุโครงการ นักศึกษา และบทบาทอาจารย์; ไม่ระบุช่วงวันแลกเปลี่ยนหรือยืนยัน MoU ทุกสถาบัน |
| **NECTEC, INESC TEC, AIST, NCHC, UCSD และ UF — เครือข่ายร่วมวิจัยที่เว็บหลักสูตรสาขาระบุ** | โอกาสแลกเปลี่ยนทำวิจัยกับอาจารย์ในสถาบันเหล่านี้; หน้าแหล่งนี้ไม่ระบุกิจกรรมหรือรอบแลกเปลี่ยนรายบุคคล | [เว็บสาขา: หลักสูตรปริญญาเอก](https://cs.sci.tu.ac.th/phd-comsci-th/) ระบุรายชื่อสถาบันในหัวข้อโอกาสแลกเปลี่ยนวิจัย; ไม่ใช่หลักฐาน MoU รายฉบับหรือกิจกรรมที่เกิดขึ้นทุกแห่ง |
| **King Power Click — หน่วยงานที่เว็บสาขาระบุในเครือข่ายความร่วมมือ** | ยังไม่ระบุกิจกรรมเฉพาะ เพราะคำบรรยายใต้หัวข้อปะปนกับการแลกเปลี่ยน AIST | [เว็บสาขา: เครือข่ายความร่วมมือ](https://cs.sci.tu.ac.th/partnership-th/) มีชื่อบริษัทโดยตรง จึงเก็บเป็น Collaborator ตามรายชื่อได้ แต่ยังไม่ยืนยัน MoU รายฉบับ บทบาทสนับสนุน หรือกิจกรรม AIST ของบริษัท |
| **Ascend Group (C75) และ SET (C03) — สถานประกอบการในทะเบียนสหกิจ; แยกจากหน้าหลัก** | รายชื่อที่หลักสูตรอนุญาตในปี 2569; ยังไม่ยืนยันว่ารับนักศึกษาจริง วันฝึกงาน หรือ MoU ของ Ascend ตามข้อมูลเดิม | [ทะเบียนสหกิจ 2569 ที่เว็บสาขาเชื่อมถึง](https://docs.google.com/spreadsheets/d/1mrexRW94TkVQUK91wLhqQtbEBResL4OBc9BWzcsvOjE/edit?usp=sharing); ยังไม่พบหลักฐานนอกสหกิจในสามแหล่งที่ตรวจ จึงไม่คืนเป็น Collaborator ของหน้าหลักรอบนี้ |
