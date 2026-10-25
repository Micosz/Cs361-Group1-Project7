# Lambda CI/CD

รอบแรกดูแลเฉพาะ `CSTUHubAuth` ในบัญชี `781485979426`, Region `ap-southeast-2`.
ใช้ Lambda, environment variables, execution role, API และ DynamoDB เดิมทั้งหมด.
อีกสามตัว (`tuAuthLogin`, `fetchPartnersData`, `getPublicPartners`) ยังปล่อยด้วยวิธีเดิม.

## ไฟล์แต่ละส่วน

| ไฟล์ | หน้าที่ |
| --- | --- |
| `../.github/workflows/lambda-deploy.yml` | GitHub Actions สำหรับแพ็กและ deploy |
| `../scripts/package-auth-lambda.py` | แพ็ก Python จาก commit พร้อม `SOURCE_COMMIT`; ไม่รวม tests หรือ Node Lambdas |
| `deploy-auth.py` | ตรวจปลายทาง สำรองรุ่นเดิม อัปเดตเฉพาะโค้ด และตรวจ hash/config |
| `policies/github-auth-trust.json` | ให้เฉพาะ GitHub repository นี้บน branch main ใช้ OIDC |
| `policies/github-auth-deploy.json` | สิทธิ์ปล่อยโค้ดเฉพาะ CSTUHubAuth |

ไฟล์ ZIP ถูกสร้างเป็น Actions artifact เก็บ 7 วัน ไม่ commit และไม่วางใน `public/`.
ไม่มี AWS access key, รหัสผ่าน หรือ runtime environment values ใน GitHub.

## การทำงาน

1. PR ที่เปลี่ยน `backend/`, packager, `deploy/` หรือ workflow จะตรวจ syntax และแพ็ก ZIP.
   ขั้นตอนนี้ไม่รัน test suite และไม่มี AWS deployment credentials.
2. เมื่อ merge เข้า `main` จะสร้าง artifact ใหม่จาก commit นั้น แล้ว deploy ผ่าน OIDC role
   `CSTUHubGitHubAuthDeployRole`. สามารถกด Actions → Package and deploy Auth Lambda → Run workflow
   บน branch `main` เพื่อปล่อยซ้ำได้.
3. ก่อนเปลี่ยนโค้ด จะตรวจ account/region/function/runtime/handler และเทียบ commit กับ main ล่าสุด.
   Run เก่าที่ตามหลัง main จะหยุด; เริ่ม run ใหม่จาก main ล่าสุดแทน.
4. บันทึก published version ของโค้ดเดิมสำหรับย้อนกลับ ใช้ RevisionId กันชนกับการแก้ใน Console
   แล้วอัปเดตโค้ดและรอให้ Lambda อัปเดตเสร็จ.
5. ตรวจ CodeSha256 และค่าตั้งสำคัญว่าไม่เปลี่ยน; commit, hash และ backup version อยู่ใน run summary.
   ขั้นตอนนี้ยืนยัน deployment identity ไม่ใช่การยืนยันว่า Login/สิทธิ์/ฟีเจอร์ผ่านการทดสอบ.
6. ทีมตรวจงานจริงเองหลังปล่อยตามส่วนที่แก้ เช่น Login และสิทธิ์เข้าถึงเอกสาร.

Deploy runs ทำงานทีละรอบและไม่ยกเลิก run ที่เริ่มอัปเดตแล้ว.
Frontend ยังใช้ Amplify ตามเดิม จึงยังไม่ได้รับประกันการปล่อย Frontend/Backend พร้อมกัน.
การเปลี่ยน API ต้องรองรับหน้าเว็บเดิมระหว่างปล่อย; workflow นี้ไม่ตั้งค่าหรือสั่ง deploy Amplify.

## การตั้งค่า AWS ครั้งแรก

ให้ผู้ดูแลตรวจ account ก่อนสร้างทรัพยากรต่อไปนี้ (ไม่ต้องสร้างทุกครั้งที่ปล่อย):

- OIDC provider `https://token.actions.githubusercontent.com`, audience `sts.amazonaws.com`.
- IAM role `CSTUHubGitHubAuthDeployRole` โดยใช้ trust และ permission policy ในโฟลเดอร์นี้.

Role นี้ไม่มีสิทธิ์เปลี่ยน IAM, runtime configuration, DynamoDB, S3 หรือ Lambda ตัวอื่น.
ไม่เพิ่ม GitHub Environment ให้ deploy job โดยไม่ปรับ OIDC subject เพราะ trust ปัจจุบันผูก branch main.
ผู้ที่แก้หรือ merge โค้ดเข้า main สามารถเปลี่ยนโค้ดที่ทำงานด้วย execution role เดิมได้;
ควรให้ทีม review PR ก่อน merge. Repository branch protection เป็นการตั้งค่าแยกจาก workflow นี้.

## เมื่อ deploy ล้มเหลว / ย้อนกลับ

1. เปิด Actions run ดูขั้นตอนที่หยุด, commit และหมายเลข rollback backup ใน Summary.
   หากยังไม่ถึง UpdateFunctionCode โค้ดเดิมยังอยู่.
2. ถ้าเป็นข้อผิดพลาดจากโค้ดที่ปล่อย ให้ revert PR ที่เป็นสาเหตุบน GitHub แล้ว merge เข้า main;
   workflow จะปล่อยโค้ดจาก main รุ่นที่แก้กลับ โดยเก็บรุ่นที่กำลังใช้อยู่ไว้ก่อน.
3. ถ้า pipeline ใช้ไม่ได้และต้องคืนโค้ดเร่งด่วน ให้ผู้ดูแลเปิด Lambda → CSTUHubAuth → Versions
   เลือกหมายเลข backup จาก Summary แล้วดาวน์โหลด deployment package ของ version นั้น.
   กลับไป Code ของ `$LATEST` → Upload from → .zip file แล้วอัปโหลด package เดิม.
   ตรวจว่าโค้ดอัปเดตสำเร็จและตรวจงานจริงเอง; ไม่แก้ environment หรือ API target ระหว่างคืนโค้ด.
4. บันทึกการคืนโค้ดและแก้ main ให้สอดคล้องก่อนปล่อยครั้งถัดไป.

ปัจจุบัน API เรียก function แบบไม่มี alias จึงใช้ `$LATEST`; published version เป็นสำรอง
ไม่ใช่การสลับ traffic ด้วย alias. Workflow ไม่ลบ versions อัตโนมัติ; ตรวจพื้นที่เก็บและล้าง
versions เก่าที่ไม่ใช้งานเป็นระยะ โดยรักษารุ่นสำรองที่ทีมต้องการ.

## DynamoDB

โค้ด Lambda อ่านชื่อตารางจาก environment เดิม. การปล่อยโค้ดไม่ต้องสร้างตารางหรือย้ายข้อมูล.
หากภายหลังเพิ่ม index, TTL หรือต้องปรับข้อมูลเก่า ให้จัด migration แยกพร้อมแผนย้อนกลับ;
อย่าเพิ่มการล้าง/สร้างตารางใน code deployment นี้.

## ขอบเขต dependency

Package ปัจจุบันมี Python source และใช้ boto3 จาก Lambda Python runtime.
ถ้าเพิ่ม dependency ภายนอก ต้องปรับวิธีแพ็กก่อน merge; แก้ requirements.txt อย่างเดียวไม่ติดตั้ง
dependency เข้า ZIP. ชุดทดสอบเดิมยังอยู่ใน repo แต่ workflow นี้ไม่เรียกใช้ตามขอบเขตที่ตกลง.

อ้างอิง: [GitHub OIDC กับ AWS](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws),
[Lambda versions](https://docs.aws.amazon.com/lambda/latest/dg/configuration-versions.html).
