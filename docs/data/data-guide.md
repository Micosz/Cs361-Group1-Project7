# คู่มือข้อมูลสาธารณะและ source sync

`data/` เก็บข้อมูลต้นทาง/config ที่เครื่องมือใช้ ส่วนคู่มือนี้อธิบายโครงสร้าง ขั้นตอน sync และที่มาข้อมูล วันที่ในแต่ละส่วนเป็นวันที่ตรวจเดิม

## สารบัญ

- [Version 1 Public Data](#v1-data)
- [แหล่งข้อมูลและข้อจำกัด](#sources)


<a id="v1-data"></a>

<a id="v1-data-version-1-public-data"></a>

## Version 1 Public Data

<a id="v1-data-public-data-model-and-validation"></a>

### Public Data Model and Validation

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

<a id="v1-data-ข้อมูลที่ตรวจจาก-sources-9-ตค-2026"></a>

### ข้อมูลที่ตรวจจาก Sources (9 ต.ค. 2026)

`data/partners.json` เป็นชุดข้อมูลเตรียมสำหรับทีม และ `public/data/partner-data-backup.json` เป็นชุดเดียวกันในรูปแบบแบนสำหรับ fallback ของเว็บ มี 17 หน่วยงานและ 12 กิจกรรม ไม่รวมสหกิจศึกษา คืน King Power Click ตามรายชื่อเครือข่าย และ INESC TEC/NCHC ตามเครือข่ายวิจัย โดยเว้นกิจกรรมที่ยังไม่ยืนยัน ชื่อผู้ประสานงานที่ไม่มีหลักฐานถูกนำออก รายการที่ถูกต้องและรูปเดิมที่ตรงกับกิจกรรมยังเก็บไว้

อ่าน [ตารางหลักฐาน](#sources) และ [รายละเอียดส่งต่องาน](../../data/source-handoff.json) สำหรับรายการที่นำออก วันที่ที่ต้องยืนยัน ที่มารูป และข้อมูลที่รอแบบ/ฟีเจอร์ใน issues เดิม เช่น กิจกรรมที่ไม่ผูกคู่ความร่วมมือ ข้อตกลง และระเบียนแลกเปลี่ยน ข้อมูลเตรียมในไฟล์ส่งต่องานยังไม่ถูกโหลดในหน้าเว็บ

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

<a id="v1-data-sync-github-ไป-dynamodb"></a>

### Sync GitHub ไป DynamoDB

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

<a id="v1-data-json-structure"></a>

### JSON Structure

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

ตัวกรอง MoU ใน Event ใช้ `activity_tags: ["mou"]` เฉพาะข่าวที่มีหลักฐานลงนาม ได้แก่ Yarsi และ Spark Camp (Embedded LLM / AGICAFET) ไม่ตรวจจากคำว่า MoU ในข้อความ เพราะข่าวหารืออาจเขียนว่า “ยังไม่ยืนยัน MoU” กิจกรรมวิชาการไม่รวมรายการติดป้ายนี้ ส่วน Spark Camp คงประเภท `event` และใช้ ID เดิม จึงพบได้ทั้งตัวกรองกิจกรรมทั่วไปและ MoU โดยไม่เพิ่มการ์ดซ้ำ เมื่อกรองช่วงวัน รายการที่ยังไม่ทราบวันจะไม่ผ่านตามกติกาเดิม ป้ายนี้ไม่ใช่สถานะหรือระเบียน Agreement ของ V3

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


## การใช้ตาราง Partner เดิมกับระบบจัดการ

กำหนด `PARTNER_TABLE=Partner` โดยใช้ composite key เดิม `(id, type)` ให้ Python backend อ่านและเขียนคู่ความร่วมมือกับกิจกรรมในตารางเดิม โดยคง ID, field สำหรับหน้าสาธารณะ และข้อมูลอ้างอิงจากแหล่งต้นทางไว้ เพิ่มเพียง metadata สำหรับ scope, version และสิทธิ์ในรายการเดิม ส่วน Agreement, Exchange, Contact, History และ Document metadata ยังใช้ `BUSINESS_TABLE` ตามเดิม การตรวจ version, parent และ reference ทำใน transaction ข้ามตารางเดียวกัน

Public reader ส่งเฉพาะ field ของข้อมูลเผยแพร่ ไม่ส่ง metadata บัญชีหรือผู้รับผิดชอบ และ backend เขียน alias เช่น `full_description`, `logo_path`, `period_date` ให้ตัวอ่านเดิมใช้ต่อได้ ไม่ต้องสร้างตารางใหม่หรือย้ายรายการเก่าออกจาก `Partner`.

รายการต้นทางที่มี `source_state=retired` คงอยู่ในตาราง แต่การอ่านและจัดการใช้รายการ active ของ ID นั้นเท่านั้น ถ้าพบ active มากกว่าหนึ่งแถว ระบบปฏิเสธการแก้ไขแทนการเลือกแถวเอง.
