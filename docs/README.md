# เอกสารโครงการ

เลือกอ่านตามงาน ไม่ต้องอ่านทุกไฟล์ เอกสารผลตรวจเป็นหลักฐาน ณ วันที่ระบุ ไม่ใช่สถานะ deployment ปัจจุบัน

| ต้องการทำอะไร | เริ่มอ่าน |
| --- | --- |
| ตั้ง pipeline Python / AWS สำหรับระบบภายใน | [Python auth deployment](deployment/python-auth-cicd.md) |
| ตั้ง auth, ตารางผู้ใช้ และ Session | [Auth integration](deployment/auth-integration.md) |
| ตั้ง TU authentication / บัญชีทดสอบ | [TU authentication](deployment/tu-authentication.md), [Course test login](deployment/course-test-login.md) |
| Deploy Node Lambda เดิม | [Lambda CI/CD](deployment/lambda-cicd.md) |
| เตรียม business table และ private documents | [Workspace integration และ storage](evidence/v3-evidence.md#workspace-83-86-integration) |
| ต่อหรือแก้ backend / frontend | [API contracts](design/v3-design.md#api-flows), [Data model](design/v3-design.md#data-model), [Permission matrix](design/v3-design.md#scope-permissions) |
| ทำความเข้าใจเหตุผลการออกแบบ / migration | [V3 design baseline](design/v3-design.md#design-baseline) |
| ตรวจแหล่งข้อมูลสาธารณะ | [Sources](data/data-guide.md#sources), [ข้อมูล V1 และ source sync](data/data-guide.md#v1-data) |

## หลักฐานแยกตามเวอร์ชัน

- [V1 Evidence](evidence/v1-evidence.md) — หลักฐานส่งมอบรุ่นแรก
- [V2 Evidence](evidence/v2-evidence.md) — Search, review #88 และ follow-up #89
- [V3 Evidence](evidence/v3-evidence.md) — auth, permissions, CI/CD และ integration ฟีเจอร์ภายใน
- รูปและผลตรวจดิบเก็บใน `evidence/assets/` เป็นไฟล์แนบ ไม่ต้องอ่านเพื่อเริ่มงาน

## เอกสารย้อนหลังสำหรับอ้างอิงและส่งงาน

V1/V2 design, architecture, deployment และ release evidence ยังเก็บไว้ในโฟลเดอร์เดิม
รวมถึง [AI Usage Declaration ของ V1](ai-usage/v1-ai-usage-declaration.md)
ใช้เป็นประวัติของแต่ละรุ่น ไม่ใช้แทนคู่มือ V3 หรือผลตรวจระบบจริงล่าสุด

คู่มือส่งงานให้ AI ราย issue และบันทึกเตรียม UI/prototype login เก่าถูกนำออกแล้ว
ข้อกำหนดหลักและหลักฐานการทดสอบไม่ได้ถูกลบตามคู่มือเหล่านั้น
