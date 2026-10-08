# หลักฐาน CI/CD Lambda — #120

ตรวจวันที่ 8 ตุลาคม 2026 ใน `ReserveFolder`; branch `feature/120-lambda-cicd` จาก `main` commit `3df15f8` ไม่รวมงาน #78/#79 Scope ล่าสุดที่ผู้รับผิดชอบเลือกคือสาม functions และ deploy เฉพาะ source ที่เปลี่ยน

## Source และ configuration จริง

ใช้ Learner Lab credentials ที่ผู้รับผิดชอบให้เพื่อตรวจ AWS แบบ read-only พบ `fetchPartnersData`, `getPublicPartners`, `tuAuthLogin` ใน us-east-1; ชื่อ `fetchPartnerData` ไม่มีใน account ที่ตรวจ ทั้งสามใช้ Node.js 24, Zip, Handler index.handler และไม่มี layers

Source bytes ใน Git ตรงกับ index.mjs ที่ดาวน์โหลดจากแต่ละ function ตาม SHA-256:

| Function | SHA-256 ของ source file | Packaging |
| --- | --- | --- |
| fetchPartnersData | `8ff005e976e3276163c4de151ac9910eda4d407ce2360215e7c0ddd8ed47581b` | index.mjs เดิม |
| getPublicPartners | `0e249becac85157ac6befd958695de1db2d10bd2c327f7ddcfb89a750a628194` | เปลี่ยนเฉพาะชื่อจาก index.mjs เป็น index.cjs สำหรับ CommonJS |
| tuAuthLogin | `bb6787c6b4885c0fab7e66cb384315f77460c987e89fb74f821880cc31d67dc2` | index.mjs เดิม |

getPublicPartners มี mapping/CORS/query เดิม ไม่มีการเพิ่ม publication filter ใหม่ในงาน CI/CD นี้ ส่วน tuAuthLogin ไม่ได้เปลี่ยนการจัดการ Session/role หรือ TU credential logic

## ผลตรวจ

- Python packaging/selection tests ผ่าน 15 tests: root/CRC/source isolation/dependencies/unsafe files, full push range, multi-function selection, deletion และ shared-tool changes
- Actual Lambda source behavior ผ่าน Node tests 6 tests ด้วย AWS SDK/TU mocks ไม่มีคำขอฐานข้อมูลหรือ TU จริง
- node --check ผ่านทั้งสามไฟล์; actual source ZIP ทั้งสามสร้างได้และมีเพียง handler file ที่ root
- actionlint 1.7.12 ตรวจ deploy/PR CI workflows ผ่าน; binary ตรวจ checksum จาก release ทางการ (`-shellcheck=` ไม่ได้อ้างผล shellcheck)
- YAML triggers/paths/matrix และ Bash syntax ของ run steps ตรวจในเครื่อง; frontend regression และ credential scan ดูผลสรุปใน PR
- หลังผู้รับผิดชอบอนุมัติ บันทึก repository Actions Secrets ทั้งสามค่าแล้ว ตรวจเฉพาะชื่อ ไม่แสดง secret values ใน logs/Git/PR

## AWS DryRun จริง

เรียก `UpdateFunctionCode` ด้วย `DryRun=True` และ actual ZIP ทั้งสามสำเร็จ HTTP 200 ตรวจ CodeSha256, RevisionId, Runtime, Handler, Architectures และ Environment ก่อน/หลังไม่เปลี่ยน ไม่ได้เผยค่า environment ในหลักฐาน

ผลย่อที่ไม่มี credentials อยู่ใน [dry-run results](lambda-cicd-issue-120.json) การที่ AWS ยอมรับ dry-run ไม่ยืนยันว่า module load/handler/database/TU/API Gateway ทำงานจริง

## ส่วนที่ยังไม่ได้ทดสอบ

**ไม่ได้ deploy หรือ invoke functions และไม่ได้ merge PR** จึงยังไม่มี GitHub Actions deployment run หรือ API smoke ของ commit นี้ ต้อง review/merge main ขณะ Lab/credentials พร้อม แล้วเก็บ run URL, Git SHA, CodeSha256 ราย function และผล API smoke แยกตาม [คู่มือ](../deployment/lambda-cicd.md)

PR CI ใช้ mocks และไม่รับ AWS Secrets; credential expiration/renewal ยังเป็น manual ตาม Learner Lab ไม่ได้สร้าง IAM/OIDC/resources หรือเปลี่ยน AWS configuration
