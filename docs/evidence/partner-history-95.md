# #95 — ส่วนประวัติกิจกรรมที่เริ่มได้

เริ่มจาก main `29df98451085426322f679845c4f7c8767122d2f` บน branch `95-partner-history` ไม่เปลี่ยน body/checklist ของ Issue และไม่ปิด #95

## ทำแล้ว

- รายละเอียด Partner ใช้รายการกิจกรรมสาธารณะเดิม แสดงประวัติเรียงวันใหม่ไปเก่า วันเดียวกันเรียง ID คงที่และไม่ซ้ำ ไม่มีวัน/วันผิดอยู่ท้าย ไม่เดาวันจากข้อความ
- กดชื่อเปิด Activity detail เดิม ปุ่มรองรับคีย์บอร์ด ชื่อรายการใหม่ใช้ textContent
- ใช้ primary partnerId หรือ coHostPartnerIds เท่านั้น ไม่ใช้ชื่อผู้จัดร่วมที่คล้ายกันเป็นหลักฐานความสัมพันธ์ในประวัติ การ browse/filter เดิมยังใช้พฤติกรรมเดิม
- รับ period_date แบบ public เดิมและ periodDate สำหรับรายการ Activity ที่ผ่าน public projection ในอนาคต ปฏิเสธ flags ที่ขัดกัน/ไม่มีการเผยแพร่และ entityType ที่ไม่ใช่ activity
- ไม่มีกิจกรรมแสดงข้อความชัดเจน การโหลดผิดพลาดยังใช้สถานะ error ของ detail เดิม

## จุดต่อหลังเพื่อนพร้อม

- #94: ย้ายส่วนแสดงประวัติไปใช้ใน protected Partner detail ร่วมเมื่อมี UI จริง
- #96/#97: ต่อข้อมูลจริงและ stable coHostPartnerIds หลังตรวจสิทธิ์/reference และ mapping เดิม อย่าเดา ID จาก co_hosts
- #98/#99: ข้อตกลงต้องมาจาก authorized API ใช้ startDate และ Agreement detail เดิม ไม่อ่าน protected Agreements จาก public cache/backup หรือส่งเข้า buildPartnerActivityHistory
- helper ปัจจุบันคืน sourceId/kind/label/date/dateLabel แยกจาก renderer เป็นจุดเริ่มสำหรับรวมรายการที่ผ่าน authorization ภายหลัง ต้องเพิ่มการเปิด Agreement detail และกรองสิทธิ์ก่อนรวม/เรียง/pagination/count ฝั่ง server
- Issue #95 และ #91/#92 เดิมยังมี standalone history GET/POST/PATCH งานนี้ยังไม่ได้ทำช่องเพิ่ม/แก้หรือเปลี่ยน contract ดังกล่าว ให้ตกลง integration หลังงานที่เกี่ยวข้องพร้อมตามที่ผู้ใช้ขอ ไม่ลบ route/model เดิม

## ตรวจแล้ว

`npm test` ผ่านทั้ง 6 ไฟล์ รวม 3 tests สำคัญใหม่: การเรียง/วันที่/ซ้ำ, public+stable relationship IDs, การแสดงข้อความปลอดภัย+เปิด detail+empty state; `git diff --check` ผ่าน

เปิดเว็บ localhost ในเบราว์เซอร์จริง: Partner NVIDIA แสดง 9 ก.ค. 69 และชื่อกิจกรรม กดแล้วเปิด Activity detail พร้อมลิงก์หลักฐานเดิม ภาพตรวจอยู่ `/tmp/cs361-95-partner-history.jpg` (ไฟล์ชั่วคราวในเครื่อง)

ยังไม่ได้รวม main/deploy หรือยืนยัน business storage/API/สิทธิ์ภายในบน AWS งานนี้เป็นส่วน public activities ของ #95 เท่านั้น

## Integration — 13 ต.ค. 69

ต่อ history GET/POST/PATCH ใน shared Partner detail และ DynamoDB transaction adapter แล้ว
ประวัติภายในเรียง occurredOn ใหม่ไปเก่า ตามด้วย createdAt ใหม่ไปเก่า และ id เมื่อเวลาเท่ากัน
ฟอร์มเหตุการณ์เลือก reference จากรายการที่ตรวจสิทธิ์และ scope แล้ว การอ่านคืน reference เฉพาะที่อ่านได้
ข้อมูลประวัติภายในไม่ถูกเพิ่มลง public history/backup

ตรวจเพิ่ม 2 integration tests: เขียน/อ่านกลับ/เรียง/แก้/วันที่ผิด/deny และ reference/parent-version race
เป็น local AWS doubles; configuration และ production acceptance ยังใช้ข้อจำกัดใน workspace-83-86-integration.md
