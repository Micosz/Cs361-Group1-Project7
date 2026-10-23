# เอกสารโครงการ

เลือกอ่านตามเวอร์ชันหรืองาน เอกสารแต่ละรุ่นบันทึกขอบเขตและสถาปัตยกรรมของช่วงนั้น; evidence เป็นผลตรวจ ณ วันที่ระบุ ไม่ใช่สถานะ deployment ปัจจุบัน

## เอกสารตามเวอร์ชัน

| เวอร์ชัน | เริ่มจาก | เอกสารประกอบ |
| --- | --- | --- |
| **V1 · Public Collaboration Profile** | [Design](design/v1-design.md) | [Hosting ADR](architecture/v1/ADR-001-v1-hosting.md), [Architecture diagram](architecture/v1/v1-architecture-diagram.png), [Data guide](data/data-guide.md#v1-data), [Evidence](evidence/v1-evidence.md), [AI Usage Declaration](ai-usage/v1-ai-usage-declaration.md) |
| **V2 · Collaboration Repository** | [Hosting ADR](architecture/v2/ADR-001-v2-hosting.md) | [Architecture diagram](architecture/v2/v2-architecture-diagram.png), [Evidence](evidence/v2-evidence.md) |
| **V3 · Secure Collaboration Workspace** | [Design baseline](design/v3-design.md#design-baseline) | [Hosting ADR](architecture/v3/ADR-001-v3-hosting.md), [Architecture diagram](architecture/v3/v3-architecture-diagram.png), [API routes](architecture/v3/v3-api-routes.md), [Deployment guide](deployment/v3-deployment.md), [Evidence](evidence/v3-evidence.md) |

## เอกสารข้ามเวอร์ชันและการทำงานกับ source ปัจจุบัน

| ต้องการทำอะไร | เริ่มอ่าน |
| --- | --- |
| Deploy และตรวจ workflow ที่รวมใน repository | [Deployment guide](deployment/v3-deployment.md) — เนื้อหาอิง workflow และ config ที่เอกสาร V3 ระบุ; ไม่ใช่หลักฐานว่า AWS ปัจจุบันตรงกัน |
| เตรียมข้อมูลคู่ความร่วมมือและตรวจ source sync | [Data guide](data/data-guide.md) |
| ต่อหรือแก้ backend/frontend ตามสัญญา V3 | [API contracts](design/v3-design.md#api-flows), [Data model](design/v3-design.md#data-model), [Permission matrix](design/v3-design.md#scope-permissions) |
| ดูภาพและเหตุผลการออกแบบแยกตามรุ่น | [Architecture index](architecture/README.md) |

## หลักฐานแยกตามเวอร์ชัน

- [V1 Evidence](evidence/v1-evidence.md)
- [V2 Evidence](evidence/v2-evidence.md)
- [V3 Evidence](evidence/v3-evidence.md)
- รูปและผลตรวจดิบเก็บใน `evidence/assets/`; แต่ละรายการระบุวันที่และขอบเขตไว้ในเอกสารของรุ่น

เอกสารของแต่ละรุ่นใช้ยืนยันขอบเขตของรุ่นนั้น ไม่ใช้แทนเอกสารหรือหลักฐานของรุ่นอื่น; เอกสารที่ระบุว่าเป็น design baseline ก็ไม่ใช่หลักฐานการใช้งานจริงโดยตัวมันเอง
