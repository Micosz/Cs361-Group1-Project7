# ส่วนเตรียม Partner/Contact — #94

โมดูลนี้เป็น prototype ในหน่วยความจำสำหรับทดสอบ local ผ่าน gateway #79 ไม่ใช่ production business repository ข้อมูลและ idempotency cache หายเมื่อ process สิ้นสุด Lock ป้องกันเฉพาะ writes ใน process เดียว ไม่ทำให้การตรวจ user/session กับข้อมูลธุรกิจเป็น transaction จริง

มี validators, Partner/Contact create/update/read-back ผ่าน gateway ใน tests, version checks และ process-local idempotency แยก user/kind/parent/key พร้อม `CstuAuth.create` สำหรับ POST/CSRF/Idempotency-Key ในเว็บ

ยังไม่มีฟอร์ม Partner/Contact, persistent storage, candidate options, real reference/assignee checks หรือการ inject repository ใน `backend/lambda_function.py` Routes และ field permissions ใช้ gateway เดิม ไม่ได้สร้าง API ที่ deploy ใหม่ อย่าต่อ repository นี้กับ Lambda ที่ใช้งานจริง

Activity/History validators เป็นส่วนเตรียม ไม่ใช่ฟีเจอร์ #95/#96 และ repository นี้ปฏิเสธการเขียน resource อื่นนอกจาก Partner/Contact รวม upload ที่ไม่รองรับ ช่วยป้องกันนำ placeholder ไปใช้เป็น feature จริง

## งานต่อก่อนปิด #94

- สร้าง shared form เพิ่ม/แก้ Partner และ Contact พร้อมอ่าน protected detail และแสดง loading/error/conflict
- ตกลง table/key/index และ persistent repository กับ #79/#96 แล้ว validate references/assignees จากบัญชีจริง
- รวม user/session expiry/authzVersion, target/parent/reference versions และ idempotency 24h กับ write ใน transaction เดียว
- ส่ง Partner options ตามสิทธิ์ให้ #96/#97; กรองก่อน pagination/count
- ต่อ API/storage จริงและตรวจ HTTPS/direct API allow/deny/read-back โดยไม่เผย contacts ใน Public/backup

```sh
python3 -m unittest discover -s backend/tests -p 'test_partner_contact.py' -v
npm test
```

ผลเหล่านี้เป็น local/mock ไม่ใช่ DynamoDB หรือเว็บจริง Issue #94 ยังต้องเปิดจน acceptance ของฟอร์ม/storage/integration พร้อม
