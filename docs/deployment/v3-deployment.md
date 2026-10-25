# คู่มือ Deploy V3

เอกสารนี้สรุปจุดตรวจสำหรับ source และ environment ของ V3 ไม่ยืนยันสถานะ AWS หรือเว็บ production โดยตัวมันเอง

## สิ่งที่ repository ทำอยู่

- Frontend ใช้ `amplify.yml`: รัน `npm run build` แล้วเผยแพร่ไฟล์ใน `public/`; คำสั่ง build ตรวจว่า `public/login/index.html` มีอยู่
- GitHub Actions ใน `.github/workflows/lambda-deploy.yml` ตรวจ syntax/แพ็ก source และ deploy เฉพาะ `CSTUHubAuth` เมื่อเปลี่ยน Backend แล้ว merge เข้า `main`; ดู [คู่มือ Lambda CI/CD](../../deploy/README.md)
- ชุดทดสอบ frontend ระดับ root ถูกนำออกแล้ว; ชุดทดสอบ Backend ยังอยู่ใน `backend/tests/` และรันเองได้ด้วยคำสั่งใน [Backend README](../../backend/README.md)
- Source ของ Lambda และโครงสร้าง AWS ใน repository ไม่ได้หมายความว่า Lambda/API ถูก deploy อัตโนมัติหรือ config ตรงกับ AWS ปัจจุบัน

## ก่อน Deploy

- ตรวจ branch และ commit ที่จะนำขึ้น พร้อม diff ของไฟล์ที่จะเปลี่ยน
- ตรวจบัญชี/region และ resource เป้าหมายใน AWS; ตรวจ environment variables, IAM, API routes, ตาราง/index/TTL และ private document bucket ตามงานที่จะ deploy
- ตรวจ Amplify branch/build settings และ rewrite `/api/*` ใน Console แยกจาก `amplify.yml`
- ห้ามใส่ AWS credentials หรือค่า secret ลง Git หรือเอกสาร

## เส้นทาง Deploy

| ส่วน | สิ่งที่ต้องตรวจ |
| --- | --- |
| Frontend | ตรวจ build log และ deployed commit ใน Amplify; `amplify.yml` ระบุ build command และโฟลเดอร์เผยแพร่ แต่การเชื่อม app/branch ต้องยืนยันใน Console |
| Lambda / API | Workflow ปล่อยเฉพาะโค้ด `CSTUHubAuth` ผ่าน OIDC ไปบัญชี `781485979426`, `ap-southeast-2`; API config และ Lambda อีกสามตัวใช้วิธีเดิม |
| DynamoDB / S3 | ใช้ resource ที่เตรียมไว้; การ deploy source ไม่ได้สร้างหรือตรวจ schema, permission หรือ object privacy ให้อัตโนมัติ |

### IAM สำหรับเอกสารแนบส่วนตัว

การอัปโหลดและอ่านเอกสารเรียก [GetPublicAccessBlock](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetPublicAccessBlock.html)
ซึ่งต้องมี IAM action `s3:GetBucketPublicAccessBlock` เพื่อตรวจว่า bucket ยังปิด public access อยู่
ก่อนทำงานกับ object เมื่อ 24 ต.ค. 2026 ตรวจ role `CSTUHubAuthExecutionRole` ใน Free Tier account
`781485979426` พบว่ามีสิทธิ์อ่าน/เขียน/ลบ object ใน bucket เอกสารแล้ว แต่ขาด action ตรวจ bucket นี้
ทำให้ Lambda ตอบ `PERMISSION_UNAVAILABLE` เมื่ออัปโหลดไฟล์แนบ

เพิ่ม policy จาก [cstuhub-auth-document-bucket-controls.json](policies/cstuhub-auth-document-bucket-controls.json)
เป็น policy แบบ additive ให้ role เดิม โดยคง inline policy `CSTUHubAuthRuntime` ไว้ เพราะมีสิทธิ์ DynamoDB
และ action อื่นที่ระบบใช้อยู่ การ merge source ไม่เปลี่ยน IAM บน AWS; ผู้ดูแลต้องแนบ policy ใน Console
แล้วทดสอบอัปโหลดใหม่ก่อนถือว่าแก้ปัญหาบนเว็บแล้ว

## ตรวจหลัง Deploy

1. บันทึก commit SHA และ environment ที่เปลี่ยน
2. ตรวจผล build และ deployed commit ใน Amplify
3. เปิด [เว็บ production](https://main.d1l97oh16w2h6u.amplifyapp.com/) แล้วตรวจหน้า/ข้อมูลที่เปลี่ยน
4. เรียก API และตรวจ Login/สิทธิ์/เอกสารตามขอบเขตที่เปลี่ยน โดยแยกผล browser/API จริงออกจากผล unit หรือ mock tests

หาก build, deploy หรือ smoke test ล้มเหลว ให้หยุดและตรวจ log, commit และ AWS environment ก่อนลองซ้ำ

## เอกสารประกอบ

ดู [V3 API routes](../architecture/v3/v3-api-routes.md) และ [V3 evidence](../evidence/v3-evidence.md) สำหรับ API contract และขอบเขตของหลักฐาน; ยืนยันค่าจริงใน AWS แยกจากเอกสารเหล่านี้
