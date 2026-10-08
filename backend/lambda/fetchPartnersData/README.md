# fetchPartnersData

Source จาก Lambda เดิมใน `us-east-1` ตรวจเมื่อ 8 ตุลาคม 2026: Node.js 24, Handler `index.handler`, architecture x86_64, ไม่มี layer

`index.mjs` คัดลอก source เดิมและตัด trailing whitespace โดยไม่เปลี่ยน behavior ใช้ AWS SDK v3 ที่มีใน Lambda runtime เดิม จึงไม่มี package.json ที่ไม่จำเป็น

ชื่อ AWS ที่ตรวจพบคือ `fetchPartnersData` (มี s) ไม่ใช่ `fetchPartnerData`

ดู [คู่มือ CI/CD](../../../docs/deployment/lambda-cicd.md)
