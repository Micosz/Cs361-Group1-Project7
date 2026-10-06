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

## JSON Structure

ไฟล์ที่ทีมใช้อยู่ชื่อ `partners.json` แต่ละ Partner มี Array `collaborations` สำหรับข้อมูลความร่วมมือหรือกิจกรรมที่เกี่ยวข้อง ดังตัวอย่างต่อไปนี้

```json
[
  {
    "id": "partner-ascend-001",
    "name": "บริษัท แอสเซนด์ กรุ๊ป จำกัด",
    "type": "company",
    "summary": "พันธมิตรด้านเทคโนโลยีที่มีการลงนามความร่วมมือ (MoU) และเป็นสถานประกอบการที่รับนักศึกษาปฏิบัติงาน",
    "location": "กรุงเทพมหานคร ประเทศไทย",
    "website_url": "https://www.ascendcorp.com",
    "logo_path": "../Ascend_Logo.jpg",
    "collaborations": [
      {
        "id": "collab-ascend-001",
        "title": "โครงการฝึกงานและสหกิจศึกษา",
        "type": "internship",
        "period": "2026",
        "summary": "รับนักศึกษาหลักสูตรวิทยาการคอมพิวเตอร์เข้าปฏิบัติสหกิจศึกษา",
        "image_path": "../Ascend_Logo.jpg",
        "visibility": "public"
      }
    ]
  }
]
```
