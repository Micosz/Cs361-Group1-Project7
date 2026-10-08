# V2 follow-up and V3 prerequisites — Issue #89

จัดทำวันที่ **8 ตุลาคม 2026 (Asia/Bangkok)** สำหรับ [#89](https://github.com/Micosz/Cs361-Group1-Project7/issues/89)

## ข้อสรุปและฐานหลักฐาน

เสนอให้เก็บ Public Browse/Search/Filter/Detail และ fallback ที่ผ่านการตรวจไว้ แล้วตกลงขอบเขตข้อมูล สิทธิ์ และบัญชีผู้ใช้ก่อนพัฒนา protected features ของ V3 งานศึกษาสาเหตุ API และหลักฐาน deployment ทำควบคู่ได้ ไม่ต้องรอปิดทุกเรื่องจึงเริ่มออกแบบ

ใช้ [รายงาน #88](v2-review-issue-88.md) และ scenario S01–S15 เป็นฐาน ตรวจบน source `4c90fdd51cbf9fba44360f06981b188bd263c365`; รายงาน/หลักฐานเผยแพร่ใน [commit 034ca41](https://github.com/Micosz/Cs361-Group1-Project7/commit/034ca4104e98fbe63d0888b6f3e1b4fb9ca16102) และ [#88 ปิดพร้อมคอมเมนต์หลักฐาน](https://github.com/Micosz/Cs361-Group1-Project7/issues/88#issuecomment-6056453823) ผล HTTP 500 และผล browser เป็นผล ณ รอบตรวจ #88 ไม่ใช่การตรวจบริการซ้ำใน #89

เอกสารนี้เป็นข้อเสนอให้ทีม review ไม่ใช่ Scope/Permission Matrix หรือ ADR ที่ทีมอนุมัติแล้ว ไม่เพิ่ม requirement จากข้อเสนอทุกแถว

## Keep / Change / Investigate

| ID / ประเภท | ข้อเสนอและเหตุผล | หลักฐาน | ส่งต่อ / เงื่อนไข |
| --- | --- | --- | --- |
| K1 Keep | คง Public Browse/Detail และความสัมพันธ์ partner/event/co-host; มี flow เดิมที่ใช้ต่อได้ | #88 S03/S07 และ mock S12 | #66/#91/#92: ใช้เป็น baseline regression ไม่สร้างหน้า public ใหม่ซ้ำ |
| K2 Keep | คง keyword ตาม name/title ร่วม type และการล้างคำค้นโดยคงเงื่อนไขอื่น | #88 S04–S06/S11 | #92/#111/#113: ระบุ contract และทดสอบ regression เมื่อต่อ protected workspace |
| K3 Keep | คง date adapter พ.ศ., inclusive bounds, reversed-range feedback และ clear date | #88 S08–S12; [DOM วันขอบเขต](issue-88/production-date-dom.txt) | #66/#91/#92: ทีมยืนยันความหมายวันที่ก่อนนำไปใช้กับข้อตกลง/แลกเปลี่ยน |
| K4 Keep | คง API-first, timeout, backup notice และ snapshot cache สำหรับ Public; ช่วยให้ดูข้อมูลได้เมื่อ API ไม่พร้อม | #88 S02/S11; [console](issue-88/production-console.json) | #92/#93/#113: คง fallback เฉพาะ public projection; ไม่ใช้ snapshot สาธารณะกับข้อมูล protected |
| C1 Change | กำหนด public field allowlist และกติกา publication flags ที่ขัดกันก่อนมี internal/personal fields; record-level filter อย่างเดียวไม่ตัด field | #88 S13 และข้อจำกัด 2; [workflow ปัจจุบัน](../../.github/workflows/update-data-backup.yml) | #66/#91/#92/#93: ระบุ classification, response/backup projection และ allow/deny cases; ยังไม่อ้างว่าพบ secret รั่ว |
| C2 Change | ผูก ownership/responsible user/participant ด้วย application identity ที่ตรวจสอบได้; display name/contacts ไม่ใช่สิทธิ์บัญชี | #88 ข้อจำกัด 3; [snapshot field inventory](issue-88/inspection.json) | #90/#91/#93: ต้องมี identifier และ legacy mapping ก่อนใช้กับ #76/#79/#104–#107 |
| C3 Change | เพิ่ม release traceability ในเอกสาร: frontend SHA, environment/date และหลักฐาน workflow/build/deploy แยกกัน | #88 S14/S15 และข้อจำกัด 5; [คู่มือ deploy](../deployment/v2-deployment.md) | #93/#114/#115: เติมค่าที่ตรวจได้จริงก่อนรายงานส่งมอบ ไม่เดาจากหน้าเว็บเปิดได้ |
| I1 Investigate | ตรวจสาเหตุ API 500 และ readiness ของ Lab/backend; อาการยืนยันแล้วแต่สาเหตุยังไม่ยืนยัน | #88 S01; [headers](issue-88/api-headers.txt), [error body](issue-88/api-error.json) | ผู้รับผิดชอบ AWS: ตรวจ logs/config/IAM/table/Lab แล้ว retest API 200 ก่อน live integration/release; ออกแบบและ local work ทำควบคู่ได้ |
| I2 Investigate | ตรวจ workflow → backup commit → Amplify deployment และ read-after-update/unauthorized write | #88 S14/S15; query runs ว่าง ไม่ใช่หลักฐานว่า workflow ไม่เคยทำงาน | #93/#114/#115: ใช้ authorized environment และ run/deploy URLs; งานนี้ไม่ dispatch workflow หรือเขียน AWS |
| I3 Investigate | ทีมต้องการแสดงเวลา snapshot หรือไม่ และยอมรับ freshness แบบ manual update + reload ได้แค่ไหน | #88 ข้อจำกัด 4; cache ไม่มี background refresh | #66/#92/#93: เป็นคำถาม UX/operations ไม่บังคับทำ auto-sync หรือ scheduled jobs |

## สิ่งที่ต้องตัดสินใจก่อนพัฒนาส่วนที่เกี่ยวข้อง

ไม่ต้องรอ Parent #72 ปิดทั้งหมด: เริ่มแต่ละงานได้เมื่อข้อสรุปที่งานนั้นใช้พร้อม

| Prerequisite | ข้อสรุปที่ต้องมี | งานที่ได้รับผลกระทบ / เงื่อนไขเริ่ม |
| --- | --- | --- |
| P1 Scope + permissions | #66 ระบุฟีเจอร์ส่งจริง, action, public/own/assigned scope, ผู้มอบหมายบทบาท, bootstrap/no-role/multiple-role/revocation; TU employee ไม่ให้สิทธิ์สูงอัตโนมัติ | #77/#79/#80 และ workspace #108–#110: เริ่ม implementation ตาม Matrix version ที่ทีมยืนยัน |
| P2 Public/internal/personal boundary | #66/#91/#92 ระบุ field classification และ response/search/count/backup projection รวม conflicting flags | ก่อนเปิด protected APIs หรือเติมข้อมูลภายในใน record ที่ public; กระทบ #79/#94–#107/#111/#113 |
| P3 TU identity + Session | #90 ยืนยัน contract/endpoint/identifier และข้อจำกัดเข้าถึงจริง เลือก expiry/logout/revocation/credential handling ตามบริบท | #75/#74/#76/#78 เริ่มตามข้อสรุปที่จำเป็น; ไม่เดา endpoint, ไม่ส่ง Application-Key ไป frontend และไม่เก็บรหัสผ่าน TU |
| P4 Ownership + legacy mapping | #91/#93 ระบุ user links, missing-owner/reference handling, document metadata และ safe defaults; ไม่ให้สิทธิ์ภายในจาก field ที่ขาด | ก่อน record authorization และย้ายข้อมูลจริงใน #79/#94–#107; งาน schema draft เริ่มจาก snapshot ได้ แต่ต้องตรวจ schema backend เพิ่ม |
| P5 Data/date/status contract | #91/#92 แยก activity day กับ agreement/exchange interval, transitions และ validation; ใช้ shared detail/form flows | ก่อน #98–#100/#104–#106/#111 นำ filter/status ไปใช้จริง; date tests เดิมไม่พิสูจน์ interval overlap |
| P6 Backend และ release evidence | API ปัจจุบันผ่าน smoke; มี migration validation, role denial, workflow/deploy record พร้อมรุ่นและ environment | #112–#115: ต้องพร้อมก่อนรับ production release; ไม่เป็นเงื่อนไขห้ามทำเอกสาร/mock/local development |

## ทำควบคู่ได้ / เสนอเลื่อน

- **ทำควบคู่ได้:** ผู้รับผิดชอบ AWS ตรวจ I1/I2; ทีมทำ #66, ศึกษา #90 และร่าง dictionary จากข้อมูลเดิมใน #91 จากนั้นปรับตามข้อสรุป identity/permissions; ใช้ test fixtures ที่ไม่มีข้อมูลจริงศึกษากรณี legacy และ direct denial ได้
- **เสนอเลื่อนถ้าไม่จำเป็นต่อ Scope ที่ยืนยัน:** background refresh, scheduled backup, search service ใหม่ และการย้าย hosting เพื่อให้ Lab ทำงานตลอดเวลา ยังไม่มีหลักฐานปริมาณ/latency ปัจจุบันพอให้บังคับเพิ่มองค์ประกอบเหล่านี้
- **คงนอกขอบเขตตาม #72:** analytics เชิงลึก, feedback หลายแหล่ง, รับข้อมูลระบบอื่น, สมัครโครงการ/approval, ลบ/follow/แจ้งเตือน และบัญชีคู่ความร่วมมือ/ศิษย์เก่า ไม่เพิ่มงาน V4 จาก retrospective นี้

## คำถามส่งต่อ #66 และงานออกแบบ

1. ฟีเจอร์/action ใดส่งจริงใน V3 และใครมีอำนาจมอบหมายบทบาทคนแรก/คนถัดไป? ยืนยัน own/assigned scope และผู้ใช้ไม่มีบทบาทอย่างไร? → P1
2. Field ใด public/internal/personal รวม contacts, เอกสาร และ participant links; publication flags ขัดกันให้ถืออะไรเป็นหลัก? → P2
3. Identifier จาก TU ใดพิสูจน์ได้และเหมาะกับ account linking; Session ใช้วิธีใดและถอนสิทธิ์เดิมอย่างไร? → P3 (รอหลักฐาน #90)
4. ข้อมูลเดิมไม่มี owner/status/date หรือหา reference ไม่พบจะ mapping/จำกัดสิทธิ์อย่างไร และผู้รับผิดชอบตรวจ mapping คือใคร? → P4
5. วันของกิจกรรมกับช่วงเวลาของข้อตกลง/แลกเปลี่ยนมีความหมายและกติกาต่างกันอย่างไร; manual snapshot freshness เพียงพอหรือไม่? → P5/I3
6. ใครตรวจ API/AWS และรวบรวม run/deploy/denial evidence ก่อน release? → P6/I1/I2 (ยังไม่ได้มอบหมายบุคคลแทนทีม)

## Review และสถานะตรวจรับ

- [x] ทุกข้อเสนอมีประเภท เหตุผล และหลักฐาน #88 หรือระบุว่ายังต้องศึกษา
- [x] prerequisites ระบุงานที่ได้รับผลกระทบและเงื่อนไขเริ่ม; แยกเรื่องที่ศึกษาควบคู่/เสนอเลื่อน
- [ ] ผู้ใช้/ทีม review รายการและบันทึกข้อสรุป พร้อมคงคำถามที่ยังไม่ตัดสินใจ

**สถานะ: พร้อม review; ยังไม่มีหลักฐาน team approval** ณ เวลาจัดทำ การยืนยันข้อเสนอใน #89 ไม่ถือว่าอนุมัติ Matrix/Session/schema ทั้งหมด งานตัดสินใจเหล่านั้นยังอยู่ใน #66/#90–#93 ต้องบันทึกผล review ในคอมเมนต์ #89 ก่อนปิด Issue
