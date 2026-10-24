# คู่มือ Deploy V3

ใช้ไฟล์นี้เป็นทางเข้าหลักสำหรับ deploy และตรวจระบบ V3 เอกสารนี้อธิบาย workflow ของโค้ด ไม่ยืนยันว่า AWS หรือเว็บ production ปัจจุบันพร้อมใช้งาน ทรัพยากร AWS เป็นของเดิม; workflow ไม่สร้างตาราง, bucket, API หรือ Lambda ใหม่

## ก่อน Deploy

- ทำงานผ่าน branch และ Pull Request; ตรวจ CI และ review ก่อน merge เข้า `main`
- ตรวจ GitHub Actions variable `LAMBDA_DEPLOYMENT_PAUSED` ก่อน merge งาน backend เพราะถ้าเป็น `true` จะพัก workflow deploy Lambda ทั้งสองชุด
- งาน Lambda ต้องใช้ AWS Academy credentials ชั่วคราวที่ยังไม่หมดอายุใน GitHub Actions Secrets: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` ห้ามใส่ค่าจริงใน Git หรือเอกสาร
- สำหรับ Auth V3 ตรวจ `AUTH_V3_ENABLED=true`, ตาราง/index/TTL และ private document bucket ที่มีอยู่; workflow ตรวจ config แต่ไม่สร้าง resources
- ตรวจ `CSTUHUB_API_ORIGIN` ให้เป็น origin HTTPS เดียวกับ `SESSION_ORIGIN`; ตรวจ Amplify rewrite `/api/*` ใน Console แยกจาก `amplify.yml`

## เส้นทาง Deploy

| ส่วน | วิธีทำงาน |
| --- | --- |
| Frontend | Amplify build จาก `amplify.yml` รัน `npm run build` และเผยแพร่ `public/`; frontend tests ใน `tests/` ยังรันเองได้ด้วย `npm test` แต่ไม่ได้เป็น build gate |
| Node Lambda | `fetchPartnersData`, `getPublicPartners`, `tuAuthLogin`; push `main` ที่แก้ source ใน allowlist จะ deploy เฉพาะ function ที่เปลี่ยน; แก้ workflow/packager ส่วนกลางอาจ deploy ทั้งชุด |
| Python `CSTUHubAuth` | Workflow รันทดสอบบน PR; deploy จาก `main` หลัง push ที่แตะ `backend/**` หรือสั่ง `workflow_dispatch` บน `main` และตรวจ config/resources เดิมก่อนอัปเดต code |
| API Gateway, DynamoDB, S3 | ใช้ทรัพยากรที่เตรียมไว้แล้ว; workflow ไม่สร้างหรือแก้ config/schema ของบริการเหล่านี้ |

## ตรวจหลัง Deploy

1. ตรวจ GitHub Actions ให้ workflow ที่เกี่ยวข้องผ่าน และบันทึก commit SHA ที่ deploy แล้ว
2. ตรวจ Amplify ว่า build สำเร็จและ deployed commit ตรงกับ `main` ที่ต้องการ
3. เปิด [เว็บ production](https://main.d2q46seuxuluap.amplifyapp.com/) แล้วตรวจหน้าและข้อมูลสาธารณะ; เรียก `/api/auth/session` ต้องได้ anonymous session `200` พร้อม `Cache-Control: no-store`
4. ตรวจ API/การ Login และการอ่านข้อมูลตามขอบเขตที่เปลี่ยน แยกผล browser/API จริงจาก unit หรือ mock tests

หน้าเว็บอาจยังแสดง catalog จากไฟล์สำรองเมื่อ API ล้มเหลว จึงต้องตรวจ API แยกจากการโหลดหน้า

ถ้า deploy หรือ smoke test ล้มเหลว ให้หยุดและตรวจ log, commit และสถานะ AWS ก่อน rerun; Lambda workflows อัปเดต `$LATEST` และไม่มี automatic rollback การผ่าน CI หรือ checksum อย่างเดียวไม่ยืนยันว่า feature ใช้งานได้จริง

## คู่มือประกอบ

ดูสัญญา API และข้อจำกัดของผลตรวจใน [V3 API routes](../architecture/v3/v3-api-routes.md) และ [V3 evidence](../evidence/v3-evidence.md) ส่วน workflow ที่ใช้จริงอยู่ใน `.github/workflows/` และ config ของ Lambda/API อยู่ใน AWS

คู่มือ deployment แยกตาม V1/V2, Node/Python Lambda, Auth/TU และบัญชีทดสอบถูกรวม/นำออกแล้ว; เก็บเอกสาร evidence V1/V2 ไว้เป็นประวัติ ไม่ใช่คู่มือ deploy ปัจจุบัน
