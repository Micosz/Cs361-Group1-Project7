# หลักฐาน CI/CD Lambda — #120

ตรวจวันที่ 8 ตุลาคม 2026 ใน `ReserveFolder`; branch `feature/120-lambda-cicd` จาก `main` commit `3df15f8` ไม่รวมงาน #78/#79

## สิ่งที่ตรวจได้

- `main` ไม่มี implementation ของ `fetchPartnersData`; README/deployment docs ระบุว่า Lambda source อยู่นอก repo จึงไม่ได้สร้าง implementation สมมติ Source directory มีเพียงคำอธิบายสิ่งที่ต้องนำเข้า
- Python packaging tests 7 tests ใช้ synthetic files ใน temporary Git repos: ZIP root/CRC/content ตรง fixture, CJS/ESM เดิมคงไว้, ไม่รวม frontend/untracked files, missing source/lockfile/dependencies/runtime/container/path traversal/unsafe files/symlinks/native deps ถูกปฏิเสธ
- actionlint 1.7.12 จาก release ทางการ ตรวจ checksum ของเครื่องมือก่อนใช้ แล้วตรวจ deploy workflow ผ่าน (`-shellcheck=`; ไม่มีผล shellcheck)
- YAML structure/trigger/main/path filters/target region+function และ Bash syntax ของทุก run step ผ่าน
- actual source packaging ยังทำไม่ได้ เพราะยังขาด source/Runtime/Handler จริง ผล fixture tests ไม่ใช่ผล package ของ Lambda ที่ใช้อยู่
- GitHub repository secret names ที่อ่านได้เป็นรายการว่าง ไม่เคยอ่าน/แสดง secret values; boto3 ไม่พบ credential provider ในเครื่อง

ก่อนส่งตรวจยังตรวจ `git diff --check`, diff scope และสแกน tracked text files หา AWS key/private-key/credential patterns โดยไม่พิมพ์ค่าที่ match ผลและ commit สุดท้ายดูใน Draft PR

## สิ่งที่ยังไม่ได้ยืนยัน

ไม่ได้เรียก `UpdateFunctionCode`, ไม่ได้ deploy/invoke Lambda, ไม่ได้ทดสอบ API หลัง deploy และไม่ได้เปลี่ยน AWS resources/configuration/credentials ไม่มี Actions deployment run จาก branch นี้ เพราะ deploy trigger เฉพาะ `main`

ต้องนำ source จริงเข้า repository และยืนยัน dependencies/layers/runtime/handler ก่อน merge จากนั้นตั้ง Secrets ทั้งสามค่า เปิด Lab และทดสอบ workflow กับ credentials ที่ยังไม่หมดอายุ พร้อมบันทึก run URL, Git SHA, CodeSha256 และผล API smoke ตาม [คู่มือ deploy](../deployment/lambda-cicd.md)
