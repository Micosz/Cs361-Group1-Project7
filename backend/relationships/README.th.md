# ความสัมพันธ์กิจกรรม — ส่วนแยกของ #97

## ทำอะไรได้ตอนนี้

โมดูล Python `activity_links.py` ไม่มี dependencies เพิ่ม ไม่มี AWS client และไม่เขียน/ลบข้อมูล ใช้เตรียม domain logic ให้ API กิจกรรม #96 ต่อเมื่อ storage และสิทธิ์ #79 พร้อม โดยไม่สร้าง CRUD หรือฟอร์มซ้ำกับ #94/#96/#98

- `plan_patch`: ตรวจ relationship-only PATCH และคืนแผนก่อนบันทึก
- `internal_links`: อ่านชื่อคู่ความร่วมมือ/ผู้จัดร่วม/ข้อตกลงเท่าที่ผู้ใช้มีสิทธิ์
- `public_links`: คืนเฉพาะ partner/co-host ที่เผยแพร่ ไม่อ่านหรือคืน agreement ID, ชื่อ หรือจำนวนเลย
- `legacy_relationships`: เตรียม fragment จาก V2 โดยคง partnerId และเก็บ co_hosts เป็น legacyCoHostNames ไม่จับชื่อคล้ายกันเป็น ID

อ่าน cardinality/fields จาก `docs/design/v3/data-model.md` (#91): primary partner จำเป็น 1 ตัว, co-hosts หลายตัว, agreements หลายตัวหรือไม่มีได้; IDs ไม่ซ้ำ primary ไม่ซ้ำ co-hosts และ partner รวมไม่เกิน 20 ตัวตาม baseline ที่ใช้กับความสัมพันธ์ partner

## ตัวอย่างก่อน/หลัง (ข้อมูลสมมติ)

```json
{"before":{"partnerId":"p1","coHostPartnerIds":["p2"],"agreementIds":["g1"]},"patch":{"partnerId":"p2","coHostPartnerIds":["p1"],"agreementIds":[]},"after":{"partnerId":"p2","coHostPartnerIds":["p1"],"agreementIds":[]}}
```

`agreementIds: []` ถอดความสัมพันธ์ ไม่ลบ agreement g1; ถ้าไม่ส่ง field จะรักษาค่าเดิม primary partner ถอดไม่ได้แต่เปลี่ยนได้เมื่อ reference ใหม่ผ่านการตรวจ

Internal read สำหรับตัวอย่างหลังบันทึก:

```json
{"partner":{"id":"p2","name":"Co-host"},"coHosts":[{"id":"p1","name":"Primary"}],"agreements":[]}
```

Public read ไม่มี key agreements แม้กิจกรรมผูก g1 อยู่ ถ้า primary partner ไม่เผยแพร่/หาย/คนละ scope จะคืน None ให้ caller ตัดกิจกรรมออก; internal co-host ถูกตัดออก ไม่คืน ID/placeholder/count ของตัวที่ซ่อน

## จุดเชื่อม #79 (ยังไม่ได้ merge หรือต่อ HTTP)

`get_record(kind, id)` ต้องอ่าน record จริงแบบ strongly consistent และคืน dict/None; exception ของ storage ต้องปล่อยให้ API คืน dependency failure ห้ามแทนเป็น None/empty success

`allowed(kind, action, row)` ต้องมาจาก SessionContext ฝั่ง Serverเท่านั้นและคืน bool จริง ไม่ใช่ policy จาก HTTP, role จาก Browser หรือฟังก์ชัน allow-all ใน production หลังรวม #79 ตัวอย่าง bridge คือ:

```python
from backend.permissions.policy import allowed_roles

def allowed(kind, action, row):
    # context มาจาก require_session ใน request นี้
    if action == 'change_public_links':
        return 'staff' in allowed_roles(context, 'activity', 'update', row)
    return bool(allowed_roles(context, kind, action, row))
```

`change_public_links` เป็น callback ภายในโมดูลนี้เพื่อจำกัดการแก้ public-facing partner/co-host ให้ staff ตาม #79 ไม่ใช่ HTTP action/บทบาทใหม่ Coordinator ต้องให้ staff เปลี่ยน publication เป็น internal ก่อน; การแก้ agreementIds ที่ไม่ใช่ public display ยังใช้สิทธิ์ update ปกติ

เรียก `plan_patch` หลัง `require_session` + Origin/CSRF + #79 `validate_fields` และแยกเฉพาะสาม fields ความสัมพันธ์ ไม่ส่ง payload CRUD ทั้งก้อนให้ helper:

```python
from backend.relationships.activity_links import plan_patch, internal_links

plan = plan_patch(activity, relationship_patch,
                  get_record=repository.get, allowed=allowed)
# ยังไม่บันทึก: ให้ repository ของ #96 ทำ transaction ตามข้อกำหนดด้านล่าง
```

`LinkError` มี `code/status` ให้ boundary แปลงเป็น AuthError หรือ API error shape ตาม #92; missing/wrong kind/wrong scope/unreadable references คืน INVALID_REFERENCE 422 แบบเดียวกัน, target ไม่มีสิทธิ์คืน NOT_FOUND 404, public link edit ที่ไม่ใช่ staff คืน FORBIDDEN 403

## เงื่อนไขก่อน repository บันทึกจริง

1. `plan.changes` เป็น fragment ที่ตรวจแล้ว ไม่ใช่ saved entity; อย่าใช้ UpdateItem หลัง read เฉย ๆ
2. นำ `plan.activity_id/activity_version/scope_id` ไปตรวจ version/scope บน target Update เดียวกัน พร้อม If-Match ของ caller
3. ตรวจ versions/kind/scope ของ `plan.references` ทุกตัวใน transaction เดียวกับ write เพื่อกัน reference ถูกลบ/เปลี่ยนสิทธิ์ระหว่างตรวจและบันทึก
4. รวม user/authzVersion/session expiry/revoke และ assignment checks ของ #79; recheck session ก่อนคืน protected response ห้ามใช้ version check เพียง target ตัวเดียว
5. เพิ่ม version/update audit ของกิจกรรมและกติกา create/idempotency ของ #96 ไม่แก้หรือลบ referenced partner/agreement
6. ต้องแปลง DynamoDB numbers เป็นชนิดที่ #79/model รองรับ และจำกัดขนาด write/transaction ตาม adapter จริง ถ้าใหญ่เกินให้ reject ไม่ตัด ID เงียบ ๆ

ไม่มี production repository/HTTP route ใน PR นี้ ดังนั้นการบันทึกจริงและความปลอดภัยของ transaction ยังไม่ได้ทดสอบกับ AWS

## การอ่าน/ตัวเลือก/หน้าเว็บที่เพื่อนต้องต่อ

- #94/#98 คืน candidate options เฉพาะ records ที่ผู้ใช้มีสิทธิ์ใน scope เดียวกัน กรองก่อน pagination/count; module นี้ตรวจ ID ที่เลือกซ้ำก่อนบันทึก ไม่ใช่ endpoint สำหรับ list options
- #96 ใช้ผล `internal_links` ต่อ detail/form shared component และใช้ plan ใน create/update หลัง activity ถูกประกอบด้วย server-owned fields; helper ตอนนี้รับเฉพาะ existing versioned activity สำหรับ PATCH
- #79 `project` ปัจจุบันตั้งใจไม่ expand relationship IDs: ต้องต่อ projection ของ #97 หลังตรวจสิทธิ์ก่อนส่ง response ไม่มี integration hook ที่เพิ่มใน branch #79 โดย PR นี้
- Public adapter ใช้ `public_links` แล้วประกอบเฉพาะ display allowlist ตาม #92 ไม่ merge raw activity หรือ legacyCoHostNames ลง response; names แสดงด้วย textContent ไม่ต่อ innerHTML
- V2 mapping เป็น fragment เท่านั้น ต้องให้ migration ของทีมยืนยัน scope/schema/version และ resolve co-host IDs ก่อน persist ข้อมูลเดิมไม่มี agreement จึงได้ [] โดยไม่เดา
- หน้าเว็บปัจจุบันและ API จริงยังใช้ของเดิม ไม่ได้เสียบ helper นี้แทน loader/modal ของ V2

## ตรวจแบบเล็กและแยก

```sh
python3 -m unittest discover -s backend/tests -p 'test_activity_links.py' -v
```

5 tests: link/read/unlink, invalid refs/duplicates/scope, policy boundaries, Public ไม่ fetch agreements + dependency failure, และตรวจ partnerId/co_hosts ของกิจกรรมทุกตัวใน snapshot V2 จริงโดยไม่แก้ source JSON

Tests ใช้ memory repository และ policy double ไม่ใช่หลักฐานว่า #79 integration, form, DynamoDB transaction หรือหน้าเว็บจริงผ่านแล้ว Workflow PR เรียกชุดนี้โดยไม่ใช้ AWS credentials และไม่ deploy เพราะ code อยู่ backend/relationships นอก Lambda deploy allowlist

## AWS

งานส่วนแยกนี้ไม่ต้องสร้างตาราง/เปลี่ยน Lambda/API Gateway/Amplify ไม่ได้ใช้ CloudShell หรือ deploy ค่าใด ตอนเชื่อม storage/API จริงให้ #94/#96/#98 ตกลง schema/resource กับ #79 ก่อน ไม่ใช้ตาราง Partner ของ V2 ทดลองเขียนความสัมพันธ์ใหม่โดยยังไม่มี adapter/rollback
