# แก้ student โหลด Feedback แล้วขึ้น FORBIDDEN

## สาเหตุที่ตรวจพบ — 25 ต.ค. 2026

Lambda `CSTUHubAuth` บัญชี `781485979426`, region `ap-southeast-2`
ยังใช้ package hash `Rea1cHKvpuW7YdQR02rPw9Te36+m8bJGvYS4I470eK4=`
(แก้ไขล่าสุด `2026-10-25T13:19:03Z`) จากการอ่าน source ที่ deploy จริง:

- `permissions/policy.py` ไม่มี student ใน action ของ Feedback จึงถูก `require_action` ปฏิเสธด้วย `FORBIDDEN`
- `permissions/gateway.py` ยังไม่ส่ง `canCreate` กลับมาสำหรับรายการ Feedback
- `main` มีการแก้สองส่วนนี้แล้วจาก PR #187/#185 แต่ Amplify build เผยแพร่เฉพาะ `public/` ไม่ได้ deploy Lambda

จึงเป็น backend กับ frontend คนละรุ่น ไม่ต้องเพิ่ม IAM หรือเปิดสิทธิ์ตาราง/S3
หลักฐานนี้ยืนยันความต่างของ source; ยังไม่ได้ทดสอบ request จาก session student ของผู้ใช้ในรอบนี้

## หลัง review/merge: deploy backend แยก

1. ใช้ checkout ของ commit ที่ทีมตรวจแล้ว ตรวจ diff รวมก่อน deploy เพราะ ZIP รวม Auth backend ทั้งชุด
2. ใช้ Python 3.12+ แพ็ก source ที่ commit แล้ว (ไม่รวม test, credential หรือไฟล์ local):

   ```sh
   python3 scripts/package-auth-lambda.py /tmp/cstuhub-auth-feedback.zip
   ```

   ZIP ใช้ handler `backend.lambda_function.handler` และ boto3 ที่มีใน Lambda Python runtime
   ไม่ได้เปลี่ยน runtime, layer หรือ dependency บน AWS
3. ใน AWS Console ยืนยันบัญชี/region/function ข้างต้น แล้ว publish version ของโค้ดปัจจุบันไว้ย้อนกลับ
   บันทึกเลข version และ routing/alias ที่ใช้งานจริงก่อนเปลี่ยน
4. รันจาก CloudShell ของบัญชีเป้าหมาย โดยอัปโหลด ZIP เข้า CloudShell ก่อน:

   ```sh
   aws sts get-caller-identity --query Account --output text
   auth_revision=$(aws lambda get-function-configuration --function-name CSTUHubAuth --region ap-southeast-2 --query RevisionId --output text)
   aws lambda update-function-code --function-name CSTUHubAuth --region ap-southeast-2 --revision-id "$auth_revision" --zip-file fileb:///tmp/cstuhub-auth-feedback.zip --query '{CodeSha256:CodeSha256,LastUpdateStatus:LastUpdateStatus}'
   aws lambda wait function-updated-v2 --function-name CSTUHubAuth --region ap-southeast-2
   aws lambda get-function-configuration --function-name CSTUHubAuth --region ap-southeast-2 --query '{CodeSha256:CodeSha256,Status:LastUpdateStatus,Handler:Handler}'
   ```

   ต้องเป็นบัญชี `781485979426` ก่อน update และ hash หลัง update ต้องตรงค่าจากคำสั่งแพ็ก
   ถ้า RevisionId เปลี่ยน ให้ตรวจงานผู้ deploy คนอื่นก่อน ไม่เขียนทับทันที
   คำสั่งนี้ไม่แก้ environment variables, IAM, DynamoDB, S3 หรือ API routes
5. ตรวจใช้งานสั้น ๆ: student ที่อยู่ scope เดียวกันและเป็นผู้เข้าร่วม Exchange เปิด Feedback ได้
   แล้วเพิ่ม/แก้ Feedback ของตนเองได้; student อื่นแก้ข้อความนั้นไม่ได้
   Activity อนุญาตเฉพาะรายการเผยแพร่ และไม่แสดงชื่อผู้ให้ Feedback ภายใน

ถ้าไม่ผ่าน ให้คืน package จาก version ที่สำรองในข้อ 3 ผ่าน UpdateFunctionCode
(อ่าน Code.Location ของ version นั้นแล้วดาวน์โหลด ZIP กลับมา; ไม่บันทึก URL ลง Git)
หรือคืน alias หาก integration ใช้ alias แล้วตรวจ hash ซ้ำ ไม่แก้ policy ให้กว้างขึ้นเพื่อกลบปัญหา

PR นี้เตรียมการ release เท่านั้น; merge อย่างเดียวไม่ทำให้ Lambda เปลี่ยน และไม่มี GitHub Action ใหม่
