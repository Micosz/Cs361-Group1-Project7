# V3 design baseline — #72

**Version: V3-B1 · 8 October 2026 · สถานะ: baseline สำหรับอ่านและพัฒนาต่อ**

จัดทำตามคำขอให้ทำ [#72](https://github.com/Micosz/Cs361-Group1-Project7/issues/72) และ 5 sub-issues ทั้งชุด ผู้ใช้จะอ่านภายหลัง จึงไม่อ้างว่าเป็นรายละเอียดที่ทีม review/อนุมัติครบแล้ว การปิดงานเอกสาร baseline ไม่ใช่การรับรอง production readiness

## อ่านตามลำดับ

| Issue | เอกสาร | สิ่งที่ได้ |
| --- | --- | --- |
| #66 | [Scope และ Permission Matrix](scope-permissions.md) | ฟีเจอร์ส่งจริง, บทบาท, action/scope, bootstrap และ allow/deny |
| #90 | [TU identity และ Session](authentication-session.md) | contract ที่ตรวจได้, วิธีผูกบัญชี, cookie Session, failure/revocation |
| #91 | [Data dictionary และ states](data-model.md) | entities/fields/relationships/classification, legacy และ state transitions |
| #92 | [API contracts และ page flows](api-flows.md) | routes, write fields, errors, public projection, workspace และ contract cases |
| #93 | [Architecture, ADR และ migration](architecture-migration.md) | ทางเลือก/เหตุผล, data flow, migration validation/rollback และ deployment gates |
| #72 | เอกสารหน้านี้ | แผนที่เอกสาร สถานะ decision และ traceability รวม |

## ฐานที่ใช้

- [#88: ตรวจ V2](../../evidence/v2-review-issue-88.md) และ [#89: follow-up](../../evidence/v2-follow-up-issue-89.md) พร้อมหลักฐาน source/Production ณ 8 ต.ค. 2026; ไม่ใช้ผลเก่าแทน live verification ใหม่
- [User Role Diagram ใน PR #67](https://github.com/Micosz/Cs361-Group1-Project7/pull/67) อ่านภาพจริง: Public ดูข้อมูลสาธารณะ, student ดู exchange ของตน, coordinator บันทึก/แก้ไขงานรับผิดชอบ, staff จัดการข้อมูล/เอกสาร/สถานะ, executive ดูข้อมูลภายใน/ภาพรวม รายงานส่งออกและ Feedback ในภาพกว้างกว่าขอบเขต V3 จึงเลื่อนตาม #72
- [V2 ADR](../../architecture/ADR-001-v2-hosting.md), [ข้อมูล V1](../../data/v1-data.md), `public/assets/script.js`, `migrate.js` และ [inventory จริง](legacy-inventory.json) จาก backup 26 records โครงสร้างฐานข้อมูล AWS จริงยังต้องเทียบเพิ่ม
- เอกสาร TU/OWASP/AWS ที่เปิดอ่านรอบนี้มีลิงก์ในเอกสารที่ใช้ ไม่ทดลอง Login จริง ไม่สร้าง key ไม่เปลี่ยน AWS และไม่รัน migration

## Decision register

| ID | ข้อเลือกสำหรับ baseline | สถานะ / จุดยืนยัน |
| --- | --- | --- |
| B1 | บทบาท 5 กลุ่ม, public ไม่ต้อง Login; student read-only; executive read-only | ใช้เป็น baseline ตาม diagram/#66; อ่าน Matrix ก่อน implementation |
| B2 | staff มีขอบเขตหลักสูตร; role-manager เป็น capability ที่มอบหมายแยก ไม่ได้ติดมากับทุก staff | ตัวเลือก least privilege; ต้องระบุคน bootstrap จริงก่อนใช้งาน |
| B3 | opaque server-side Session และ same-origin `/api` | เลือกสำหรับ baseline; ต้องพิสูจน์ proxy/cookie บน hosting จริง |
| B4 | local UUID + explicit TU identity link; ไม่ใช้ email/name เป็น owner key | เลือก; provider identifier/alias rules ยังต้องยืนยันกับ TU |
| B5 | public field allowlist แยก API/backup; ข้อมูล protected ไม่อยู่ static bundle | เลือก; migration ต้องเทียบ public regression ก่อน cutover |
| B6 | private object storage; backend authorize/stream ทุก download | เลือกพฤติกรรม; S3 เป็น candidate ตาม stack เดิม ยังไม่สร้าง bucket |
| B7 | เพิ่ม schema แบบมี version และ migration บนสำเนาก่อน | เลือก; backend table/key/index layout และ costs รอ deployment review |

## สิ่งที่ยังไม่ถือว่าพิสูจน์แล้ว

1. TU endpoint ที่ทีมมีสิทธิ์ใช้, key/quota จริง, response จริง และความคงที่/aliases ของ username หรือ provider ID
2. ชื่อ role-manager คนแรก, staff curriculum scope และรายชื่อบัญชี/record mapping ที่ยืนยันได้
3. API 500 ใน #88 มีสาเหตุใด; AWS config/logs, backend schema, IAM และ deployment source SHA ปัจจุบัน
4. same-origin API routing/cookie behavior, private storage/IAM/file delivery และค่าใช้จ่ายจริง
5. schema/public fields/สถานะ/ช่วงวันในชุดนี้เป็น baseline choices; ประเด็นที่ทีมเปลี่ยนให้ bump version แล้วปรับทั้ง 5 เอกสารก่อนพัฒนาส่วนที่กระทบ

จุดค้างเหล่านี้เป็น implementation/release gates ไม่ใช่ข้ออ้างว่าทดลองแล้วสำเร็จ ห้าม deploy protected data โดยข้าม gate

## ขั้นตอนต่อไป

เริ่ม #75/#74/#76/#78 ตาม B3/B4 เมื่อ TU prerequisites พร้อม; #77/#79 ใช้ Matrix; feature #94–#111 ใช้ dictionary/API เดียวกัน เอกสารออกแบบ/local fixtures ทำควบคู่ได้ ส่วน #112–#115 ต้องมี allow/deny, migration, private-file และ Production evidence จริง

ก่อนปิด release ตรวจด้วยผู้ใช้ anonymous/no-role/student/coordinator/staff/executive/role-manager, direct API ID tampering, role withdrawal, expiry และ V2 regression ไม่ใช้ UI hidden buttons แทน backend permissions
