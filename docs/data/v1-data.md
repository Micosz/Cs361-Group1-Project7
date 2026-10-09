# Version 1 Public Data

## Public Data Model and Validation

**Partner / Stakeholder**

| Field | ความหมาย | ชนิดข้อมูล | การกำหนดค่า |
| --- | --- | --- | --- |
| `id` | รหัสประจำ Partner | String | Required และต้องไม่ซ้ำ |
| `name` | ชื่อองค์กรหรือคู่ความร่วมมือ | String | Required |
| `type` | ประเภทของ Partner | String | Required: `company`, `university` หรือ `government` |
| `summary` | คำอธิบายสาธารณะแบบสั้น | String | Required |
| `location` | ที่ตั้งขององค์กร | String | Required |
| `website_url` | เว็บไซต์ภายนอกขององค์กร | String | Optional; ใช้ URL แบบ `http`/`https` หรือ `""` เมื่อไม่มีข้อมูล |
| `logo_path` | Path ของ Logo ที่ใช้แสดงผล | String | Optional; ใช้ Relative Path ไปยังไฟล์ที่เผยแพร่ได้ |
| `collaborations` | ความร่วมมือหรือกิจกรรมที่เกี่ยวข้อง | Array | Required; ใช้ `[]` เมื่อยังไม่มีข้อมูลที่เกี่ยวข้อง |

**Collaboration / Activity**

| Field | ความหมาย | ชนิดข้อมูล | การกำหนดค่า |
| --- | --- | --- | --- |
| `id` | รหัสประจำความร่วมมือหรือกิจกรรม | String | Required และต้องคงเดิมตลอดการใช้งาน |
| `title` | ชื่อความร่วมมือหรือกิจกรรม | String | Required |
| `type` | ประเภทของรายการ | String | Required: `internship`, `academic_activity`, `event` หรือ `research` |
| `period` | ปี วันที่ หรือช่วงเวลาดำเนินงาน | String | Required |
| `summary` | คำอธิบายสาธารณะแบบสั้น | String | Required |
| `image_path` | Path ของรูปที่ใช้แสดงผล | String | Optional; ใช้ Relative Path หรือ `""` เมื่อไม่มีรูป |
| `visibility` | สถานะการเผยแพร่ | String | Required; V1 อนุญาตเฉพาะ `public` |
| `co_hosts` | รายชื่อผู้ร่วมจัดกิจกรรม | Array of String | Optional; ไม่ต้องใส่ Field นี้เมื่อไม่มีผู้ร่วมจัด |

## ข้อมูลที่ตรวจจาก Sources (9 ต.ค. 2026)

`data/partners.json` เป็นชุดข้อมูลเตรียมสำหรับทีม และ `public/data/partner-data-backup.json` เป็นชุดเดียวกันในรูปแบบแบนสำหรับ fallback ของเว็บ มี 14 หน่วยงานและ 12 กิจกรรม ไม่รวมสหกิจศึกษา ชื่อผู้ประสานงานที่ไม่มีหลักฐานถูกนำออก รายการที่ถูกต้องและรูปเดิมที่ตรงกับกิจกรรมยังเก็บไว้

อ่าน [ตารางหลักฐาน](sources.md) และ [รายละเอียดส่งต่องาน](../../data/source-handoff.json) สำหรับรายการที่นำออก วันที่ที่ต้องยืนยัน ที่มารูป และข้อมูลที่รอแบบ/ฟีเจอร์ใน issues เดิม เช่น กิจกรรมที่ไม่ผูกคู่ความร่วมมือ ข้อตกลง และระเบียนแลกเปลี่ยน ข้อมูลเตรียมในไฟล์ส่งต่องานยังไม่ถูกโหลดในหน้าเว็บ

| ฟิลด์เพิ่มเติม | ความหมาย |
| --- | --- |
| `source_urls`, `source_checked_on`, `evidence_note` | ข่าวหลักฐาน วันที่ตรวจ และข้อจำกัดของหลักฐาน |
| `relationship_basis` | บทบาทที่มีหลักฐาน เช่น ผู้จัดหลักสูตร หน่วยงานของวิทยากร เครือข่ายวิจัย การหารือ หรือข่าวลงนาม MoU; ไม่ถือว่าทุกหน่วยงานมี MoU |
| `coordinators` | ใช้ `[]` เมื่อยังไม่พบผู้ประสานงานที่ยืนยัน ผู้ลงนาม/วิทยากรไม่ใช่ผู้ประสานงานโดยอัตโนมัติ |
| `date_precision` | `day`, `range`, `month` หรือ `unknown` |
| `period_date`, `period_end_date` | วันเริ่ม/สิ้นสุดที่ยืนยัน; วันเริ่มเป็น `null` เมื่อรู้แค่เดือน ไม่ระบุ หรือวันที่ขัดกัน ห้ามเติมวันที่สมมติ |
| `organization_roles` | บทบาทของหน่วยงานต่อกิจกรรม ไม่ได้สร้างความสัมพันธ์หรือสิทธิ์ V3 |

กิจกรรมมีเจ้าของข้อมูลหนึ่งแห่งใน `collaborations`; `co_hosts` ระบุเฉพาะผู้ร่วมจัด/ร่วมดำเนินการที่มีหลักฐาน เพื่อให้ V2 เชื่อมกิจกรรมร่วมได้โดยไม่บันทึก ID กิจกรรมซ้ำ หน่วยงานของวิทยากรและผู้ให้คำปรึกษาอยู่ใน `organization_roles` ตามบทบาทจริง

เมื่อแก้ชุดข้อมูล ให้สร้าง fallback และตรวจความสอดคล้อง:

```sh
node scripts/build-source-backup.cjs
node scripts/build-source-backup.cjs --check
```

เว็บยังอ่าน API ก่อน fallback จึงยังไม่ยืนยันว่าข้อมูลบนเว็บที่ deploy หรือ DynamoDB เปลี่ยนแล้ว **อย่ารัน `migrate.js` เพียงเพื่อทดลองดูเว็บ**: สคริปต์นั้นเขียน DynamoDB จริงด้วย PutCommand และไม่ได้ลบรายการเก่าที่ถูกนำออก ต้องสำรองและวางแผนจัดการรายการเดิมก่อนนำเข้าจริง การกรองวันที่ปัจจุบันยังใช้วันเริ่ม ไม่ได้ตรวจช่วงวันที่ทับซ้อนหรือเดือนที่ไม่รู้วัน

## JSON Structure

ตัวอย่างหนึ่งรายการจากชุดที่ตรวจแล้ว:

```json
{
  "id": "partner-ipb-001",
  "name": "Institut Pertanian Bogor (IPB)",
  "type": "university",
  "summary": "ผู้จัดหลักสูตร CSAgri IPB 2022 ที่นักศึกษา CSTU เข้าร่วม",
  "location": "อินโดนีเซีย",
  "website_url": "https://ipb.ac.id",
  "logo_path": "resources/IPB_logo.jpg",
  "coordinators": [],
  "access_level": "public",
  "relationship_basis": "course_host",
  "full_description": "ผู้จัดหลักสูตร CSAgri IPB 2022 ที่นักศึกษา CSTU เข้าร่วม หลักฐานยืนยันการเข้าร่วมหลักสูตร ไม่ระบุ MoU รายฉบับ<br>หลักฐาน: <a href=\"https://cs.sci.tu.ac.th/partnership-th/\" target=\"_blank\" rel=\"noopener noreferrer\">เว็บสาขา</a>",
  "collaborations": [
    {
      "id": "event-ipb-001",
      "title": "International Summer Course CSAgri IPB 2022",
      "type": "academic_activity",
      "period": "9–17 ก.ย. 2565",
      "period_date": "2022-09-09",
      "summary": "นักศึกษา CSTU เข้าร่วมหลักสูตร IoT เพื่อการเกษตรที่ IPB",
      "full_description": "ภีมภัช พจน์สุนทร และธนกฤต ยืนยงพิสิฐเข้าร่วมหลักสูตรซึ่ง IPB เป็นผู้จัด ระหว่างวันที่ 9–17 กันยายน 2565 เรียนรู้ IoT, Arduino และ Smart Urban Farming โดยภีมภัชได้รับรางวัล Best International Participant<br>หลักฐาน: <a href=\"https://cs.sci.tu.ac.th/partnership-th/\" target=\"_blank\" rel=\"noopener noreferrer\">เว็บสาขา</a>",
      "image_path": "resources/IPB2.jpg",
      "visibility": "public",
      "date_precision": "range",
      "period_end_date": "2022-09-17",
      "organization_roles": [
        {
          "name": "IPB",
          "role": "course_organizer"
        },
        {
          "name": "CSTU",
          "role": "students_home_department"
        }
      ],
      "source_urls": [
        "https://cs.sci.tu.ac.th/partnership-th/"
      ],
      "source_checked_on": "2026-10-09",
      "evidence_note": ""
    }
  ],
  "source_urls": [
    "https://cs.sci.tu.ac.th/partnership-th/"
  ],
  "source_checked_on": "2026-10-09",
  "evidence_note": "หลักฐานยืนยันการเข้าร่วมหลักสูตร ไม่ระบุ MoU รายฉบับ"
}
```
