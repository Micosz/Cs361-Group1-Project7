# Version 1 Public Data

## Public Data Model and Validation

**Partner / Stakeholder**

| Field | ความหมาย | ชนิดข้อมูล | การกำหนดค่า |
| --- | --- | --- | --- |
| `id` | รหัสประจำ Partner | String | Required และต้องไม่ซ้ำ |
| `name` | ชื่อองค์กรหรือคู่ความร่วมมือ | String | Required |
| `type` | ประเภทของ Partner | String | Required: `company`, `university`, `government` หรือ `research_institute` |
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

`data/partners.json` เป็นชุดข้อมูลเตรียมสำหรับทีม และ `public/data/partner-data-backup.json` เป็นชุดเดียวกันในรูปแบบแบนสำหรับ fallback ของเว็บ มี 17 หน่วยงานและ 12 กิจกรรม ไม่รวมสหกิจศึกษา คืน King Power Click ตามรายชื่อเครือข่าย และ INESC TEC/NCHC ตามเครือข่ายวิจัย โดยเว้นกิจกรรมที่ยังไม่ยืนยัน ชื่อผู้ประสานงานที่ไม่มีหลักฐานถูกนำออก รายการที่ถูกต้องและรูปเดิมที่ตรงกับกิจกรรมยังเก็บไว้

อ่าน [ตารางหลักฐาน](sources.md) และ [รายละเอียดส่งต่องาน](../../data/source-handoff.json) สำหรับรายการที่นำออก วันที่ที่ต้องยืนยัน ที่มารูป และข้อมูลที่รอแบบ/ฟีเจอร์ใน issues เดิม เช่น กิจกรรมที่ไม่ผูกคู่ความร่วมมือ ข้อตกลง และระเบียนแลกเปลี่ยน ข้อมูลเตรียมในไฟล์ส่งต่องานยังไม่ถูกโหลดในหน้าเว็บ

| ฟิลด์เพิ่มเติม | ความหมาย |
| --- | --- |
| `source_urls`, `source_checked_on`, `evidence_note` | ข่าวหลักฐาน วันที่ตรวจ และข้อจำกัดของหลักฐาน |
| `relationship_basis` | บทบาทที่มีหลักฐาน เช่น ผู้จัดหลักสูตร หน่วยงานของวิทยากร เครือข่ายวิจัย การหารือ หรือข่าวลงนาม MoU; ไม่ถือว่าทุกหน่วยงานมี MoU |
| `coordinators` | ใช้ `[]` เมื่อยังไม่พบผู้ประสานงานที่ยืนยัน ผู้ลงนาม/วิทยากรไม่ใช่ผู้ประสานงานโดยอัตโนมัติ |
| `date_precision` | `day`, `range`, `month` หรือ `unknown` |
| `period_date`, `period_end_date` | วันเริ่ม/สิ้นสุดที่ยืนยัน; วันเริ่มเป็น `null` เมื่อรู้แค่เดือน ไม่ระบุ หรือวันที่ขัดกัน ห้ามเติมวันที่สมมติ |
| `organization_roles` | บทบาทของหน่วยงานต่อกิจกรรม ไม่ได้สร้างความสัมพันธ์หรือสิทธิ์ V3 |

Collaborator กับ MoU แยกกัน: รายชื่อในเครือข่ายความร่วมมือหรือข้อความระบุความร่วมมือวิจัยใช้ยืนยันความสัมพันธ์ได้ แม้ไม่มี MoU รายฉบับ ข้อความว่าเว็บสาขาลงนาม MoU กับสถาบันต่าง ๆ โดยรวมไม่ใช้ยืนยัน MoU ทุกองค์กร ส่วน `research_institute` ใช้แสดงสถาบันวิจัยที่ไม่ควรถูกจัดเป็นบริษัทหรือมหาวิทยาลัย โดยไม่เปลี่ยนฟีเจอร์จัดการ V3

กิจกรรมมีเจ้าของข้อมูลหนึ่งแห่งใน `collaborations`; `co_hosts` ระบุเฉพาะผู้ร่วมจัด/ร่วมดำเนินการที่มีหลักฐาน เพื่อให้ V2 เชื่อมกิจกรรมร่วมได้โดยไม่บันทึก ID กิจกรรมซ้ำ หน่วยงานของวิทยากรและผู้ให้คำปรึกษาอยู่ใน `organization_roles` ตามบทบาทจริง

เมื่อแก้ชุดข้อมูล ให้สร้าง fallback และตรวจความสอดคล้อง:

```sh
node scripts/build-source-backup.cjs
node scripts/build-source-backup.cjs --check
```

## Sync GitHub ไป DynamoDB

เมื่อเปลี่ยน `data/partners.json` ให้รันคำสั่งด้านบนแล้ว commit ทั้งไฟล์ต้นทางและ fallback เมื่อรวมเข้า `main` workflow **Sync GitHub source catalog to DynamoDB** จะ sync ไปตาราง `Partner` ใน `us-east-1` โดยอัตโนมัติ ใช้ค่าบัญชี/ตารางจาก `data/source-sync-config.json` และทดสอบข้อมูลก่อนเชื่อม AWS มี Run workflow แบบ `apply` และ `dry-run` สำหรับ main เท่านั้น

- ใช้ GitHub Secrets เดิม: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` ไม่ใส่คีย์ในไฟล์หรือ log; session ของ Learner Lab หมดอายุได้ ต้องอัปเดตทั้งสามค่าแล้ว rerun งานที่ล้มเหลว
- GitHub เป็นต้นทาง ไม่ดึง API กลับมาเขียนทับข้อมูลใน repository อีกต่อไป Workflow เดิม `update-data-backup.yml` เปลี่ยนเป็นตรวจข้อมูลอย่างเดียว
- key จริงของ Partner คือ `id` + `type` การเปลี่ยน type จึงเลิกเผยแพร่ key เก่าและเพิ่ม key ใหม่ รายการที่ถูกนำออกใช้ `source_state: retired` และตั้งทั้ง `access_level`/`visibility` เป็น `private`; ไม่ลบเนื้อหาเก่า
- sync เฉพาะ key เดิม 26 รายการที่ตรวจว่าเป็นสาธารณะ หรือรายการที่ automation นี้ดูแลแล้ว ไม่ scan/แทนที่ทั้งตาราง ไม่รับข้อมูลส่วนตัว ชื่อผู้ประสานงานใหม่ หรือฟิลด์สิทธิ์ผ่านชุดข้อมูลนี้ หากพบข้อมูลภายใน ฟิลด์ที่ไม่รู้จัก หรือรายการที่ระบบอื่นดูแลใน key เป้าหมาย จะหยุดทั้งชุด
- ก่อนเปลี่ยนรายการ จะสำรอง snapshot ในตาราง **PartnerSourceSync** และบันทึก control/revision ที่นั่น ครั้งแรกจะสร้างตารางนี้แบบ on-demand หากยังไม่มี ข้อมูลสำรองไม่อยู่ใน Partner และไม่ส่งผ่าน API สาธารณะ ไม่มีการอัปโหลด snapshot เป็น artifact ของ Actions
- เขียนข้อมูล สำรอง และปรับ control ด้วย transaction เดียวพร้อมเงื่อนไขตรวจค่าก่อนหน้า ถ้ามีใครแก้ข้อมูลระหว่างเตรียมและเขียน จะไม่เขียนบางส่วน จากนั้นอ่านกลับแบบ consistent เพื่อตรวจผล กรณีเกิน 100 operations/ขนาดที่รองรับจะหยุดเพื่อทบทวน ไม่แบ่งเขียนจนเกิดข้อมูลครึ่งชุด

หยุด automation ได้ด้วย repository variable `SOURCE_DATA_SYNC_PAUSED=true` เมื่อแก้ไขเหตุขัดข้องแล้วลบ variable/ตั้ง `false` และ Run workflow อีกครั้ง งานที่ค้างจะอ่าน main ล่าสุดก่อน sync การแก้ไฟล์ที่ไม่ได้อยู่ในชุดข้อมูลนี้ไม่แตะฐานข้อมูล

การย้อนข้อมูล: revert การเปลี่ยนชุดข้อมูลใน GitHub แล้วสร้าง fallback ให้ตรงกันก่อนรวมเข้า main ระบบจะนำชุดนั้นกลับขึ้น Partner และเลิกเผยแพร่รายการที่ถูกนำออก หากต้องกลับไปข้อมูลก่อนเปิด automation ซึ่งยังไม่มี evidence fields ตามชุดใหม่ ให้หยุด automation และใช้ `snapshot`/`original_key` ของ revision ใน PartnerSourceSync โดยตรวจ scope/ค่าปัจจุบันก่อน restore ห้ามเขียน snapshot ทับการแก้ไขใหม่ของเพื่อนโดยไม่ตรวจ

`migrate.js` ยังเป็นเครื่องมือเก่าและไม่ใช้ใน workflow ใหม่นี้ ไม่ควรรันซ้ำ เพราะจะข้าม ownership/backup/transaction checks การกรองวันที่ในหน้าเว็บปัจจุบันยังใช้วันเริ่ม ไม่ได้ตรวจช่วงวันที่ทับซ้อนหรือเดือนที่ไม่รู้วัน การ sync สำเร็จในฐานข้อมูลไม่ได้ยืนยันว่า Amplify deploy รูปใหม่แล้ว

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
