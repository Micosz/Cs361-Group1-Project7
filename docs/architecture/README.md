# Architecture documents

ไฟล์สถาปัตยกรรมแยกตามรุ่น เพื่อให้ภาพและเอกสารของแต่ละเวอร์ชันอยู่ด้วยกัน

| รุ่น | เนื้อหา |
| --- | --- |
| [V1](v1/) | [ADR การเลือก Hosting](v1/ADR-001-v1-hosting.md), [ภาพรวมระบบ](v1/v1-architecture-diagram.png), [ภาพฉบับเต็ม](v1/v1-architecture-diagram%5BFull%5D.png) |
| [V2](v2/) | [ADR การเลือก Hosting](v2/ADR-001-v2-hosting.md), [ภาพสถาปัตยกรรม](v2/v2-architecture-diagram.png) |
| [V3](v3/) | [ภาพสถาปัตยกรรมปัจจุบันในเอกสาร](v3/v3-architecture-diagram.png), [แผนผัง API](v3/v3-api-routes.md), [ภาพรุ่นก่อน](v3/archive/v3-architecture-diagram-older.png) |

ไฟล์ในแต่ละโฟลเดอร์เป็นเอกสารของรุ่นนั้นเท่านั้น ภาพใน `v3/archive/` เก็บไว้เพื่ออ้างอิงประวัติ ไม่ใช่ภาพปัจจุบัน

เอกสารและภาพเป็นบันทึกสถาปัตยกรรมตามรุ่น ไม่ใช่หลักฐานยืนยันสถานะ AWS ปัจจุบันหรือการ deploy; โปรดตรวจ environment จริงแยกต่างหากก่อนใช้อ้างอิงสถานะระบบ
