# โค้ดฐานร่วม #82

เริ่มจาก [คู่มือ #94–#97](../../docs/design/v3/partners-activities-handoff.md) ส่วนนี้ไม่มี AWS client, storage implementation, migration หรือ route ใหม่ ไม่เปิด business feature อัตโนมัติ

## ใช้ใน adapter ของแต่ละงาน

`validation.normalize_payload(kind, action, payload, record=...)` รับ create/update ของ `partner/activity/contact/history` หลัง gateway เรียก `validate_fields` แล้ว คืนเฉพาะ payload ที่ trim/ตรวจค่า ไม่ใช่ saved record และไม่ให้สิทธิ์เอง

```python
from backend.business.validation import normalize_payload
from backend.permissions.policy import require_reference, require_assignee

# ภายใน repository.mutate หลัง gateway ตรวจ Session/CSRF/field permissions:
changes = normalize_payload(kind, action, payload, record=record)
# ต่อ business validation ของ feature: อ่าน references/users จริง,
# require_reference(context, reference, conditions.scope_id)
# require_assignee(user_state, conditions.scope_id)
# ตรวจ entity type/child parent/relationship rules ของ feature ด้วย
# แล้ว stamp server fields + commit แบบ atomic กับ WriteConditions,
# reference versions และ idempotency ก่อนคืน saved record
```

`context` ต้องเป็น SessionContext ที่เชื่อถือได้จาก request นี้และ adapter ต้องถือไว้เอง ไม่มาจาก payload; `WriteConditions` ไม่มี grants จึงไม่ใช้แทน context เพื่อตรวจ reference ห้ามอ่าน callback allow-all ใน tests ไปใช้จริง

`ports.BusinessRepository` บอก method signatures ที่ gateway ใช้สำหรับ #82; เป็น typing Protocol เท่านั้น ผู้ทำ adapter ต้อง implement get/list/mutate จริงและ fail closed สำหรับ kinds/uploads ที่ยังไม่รองรับ ถ้าขยายไป Documents ต้องทำ parse_upload/content เพิ่มตาม README ของ #79

ต้อง strong-read, list scoped candidates ทุก storage page และตรวจ parent, transaction, version/idempotency ตาม [#79](../permissions/README.th.md) สัญญานี้ไม่เลือก table topology หรือช่วย commit ให้โดยอัตโนมัติ

## ข้อตกลงของ validator

- Required Partner: name/type/summary/location; Activity: title/type/summary/partnerId; Contact: name; History: occurredOn/kind/note ตาม #91
- PATCH merge กับ trusted record เพื่อตรวจ required values/reference pair แต่คืนเฉพาะ fields ที่ส่ง; ไม่ mutate input, ไม่เขียน null ให้ omitted fields
- Optional text ล้างด้วย `""`, periodDate ล้างด้วย null, arrays ล้างด้วย []; history ถอด reference ต้องส่ง referenceType/referenceId เป็น null ทั้งคู่
- ISO วันจริง, display text trim/จำกัดความยาว, references/assignees เป็น unique string IDs ≤20, primary + co-host รวม ≤20, primary ไม่ซ้ำ co-host
- Partner types ใช้ union ของแบบ #91 กับ snapshot V2: company/university/government/research_institute/internship; Activity: academic_activity/event/research เป็น baseline ในโค้ดนี้ ทีมทบทวนก่อนเพิ่มชนิด ไม่ทิ้ง research_institute เดิม
- websiteUrl รับ HTTP/HTTPS ไม่มี embedded credentials; public assets รับชื่อไฟล์ใน `resources/` เฉพาะ jpg/jpeg/png/webp เป็นข้อตกลงเริ่มต้นของ helper นี้ หากต้องรองรับ path อื่นให้ขยายผ่าน review พร้อมตรวจ URI/traversal ไม่ใช่ปล่อย URL ใดก็ได้ และ helper ยังไม่ตรวจว่าไฟล์มีจริง
- responsibility/publication/scope ที่ผ่าน gateway ยังตรวจค่าต่อ ไม่สร้าง server-owned id/version/time/recordedBy; staff create ต้องกำหนด assignment ที่เหมาะสมใน feature ตาม dictionary
- Value validation ไม่พิสูจน์ reference existence/access/version, target UserState, business transaction หรือความปลอดภัยของข้อความที่เลือก publish; adapter ต้องทำก่อน write ทุกครั้ง
- Error ใช้ AuthError INVALID_FIELDS/422 แบบปัจจุบัน; ยังไม่คืน field-specific messages หากเพิ่มให้ขยาย contract/UI ร่วมกัน
- `activity_tags` จาก public MoU ยังไม่อยู่ helper/policy V3; อย่าส่งผ่าน unknown-field rules หรือ deploy exporter ที่ทิ้ง tags ก่อนตกลง mapping

## Fixtures และตรวจ

`backend/tests/fixtures/partners_activities.py` สร้าง fresh records/context สำหรับ tests มี public/internal Partner, Activity พร้อม protected Agreement, Contact และ History เป็นข้อมูลสมมติทั้งหมด ไม่มีบัญชี Login/seed AWS ใช้ `context('coordinator', user='u-coordinator')`, `context('staff')`, `context('executive')`, ต่าง user/scope หรือ no-role เพื่อเติม tests ของ feature

```sh
python3 -m unittest discover -s backend/tests -p 'test_business_validation.py' -v
```

## เว็บสร้างรายการ

```javascript
// สร้าง key ครั้งเดียวต่อ submission เก็บใน memory ของฟอร์ม
const submissionKey = crypto.randomUUID();
const result = await CstuAuth.create('/partners', payload, submissionKey);
// ถ้า timeout/retry ใช้ payload + key เดิม; ถ้าแก้ payload/เริ่มรายการใหม่ใช้ key ใหม่
```

`create` refresh Session, POST, CSRF และ Idempotency-Key พร้อม same-origin cookie ไม่มี automatic retry หรือเก็บข้อมูลใน browser storage กรณี server เขียนสำเร็จแต่ client ไม่ได้รับผล ต้อง retry ด้วย key เดิมก่อนเริ่ม key ใหม่ ความปลอดภัยเรื่อง replay ยังขึ้นกับ storage adapter จริงที่ตรวจ key/user/route/payload และเก็บผล 24h ตาม #92
