# ตัวตรวจสิทธิ์ API และรายการ — #79

อิง V3-B1 ใน [ตารางสิทธิ์](../../docs/design/v3/scope-permissions.md), [แบบข้อมูล](../../docs/design/v3/data-model.md) และ [API contract](../../docs/design/v3/api-flows.md) โดยต่อจาก `78-session` งานนี้เป็นส่วนกลางสำหรับ feature APIs และยังไม่ใช่ระบบ V3 ที่ deploy แล้ว

## สิ่งที่ทำแล้ว

- `policy.py` ตรวจ role/action/scope/assignment/participant แบบ default deny โดยใช้ `SessionContext` ที่ได้จาก `require_session` เท่านั้น ไม่เชื่อ user/role จาก body หรือ query และไม่รวม action ของ role หนึ่งกับ scope ของอีก role
- ครอบคลุม partner/activity/agreement/exchange, contact/history ผ่าน parent และเอกสารผ่าน parent พร้อม audience/containsPersonal นักศึกษาอ่าน exchange ที่ตนเข้าร่วม ผู้บริหารอ่านข้อมูลที่ไม่ใช่ข้อมูลส่วนบุคคลและไม่มีสิทธิ์เขียน
- ฟิลด์ที่ไม่มีสิทธิ์เขียนตอบ 403 ฟิลด์ไม่รู้จักตอบ 422; coordinator เปลี่ยน scope/responsibility/publication ไม่ได้ และแก้ display fields ของรายการ public ไม่ได้ การสร้าง activity/agreement/exchange โดย coordinator กำหนดตนเองเป็นผู้รับผิดชอบบน server
- `projections.py` คืนเฉพาะฟิลด์ที่อนุญาต ไม่คืน raw objects, objectKey/hash, embedded documents/users หรือข้อมูลผู้เข้าร่วมคนอื่นให้นักศึกษา ข้อมูลอ้างอิงที่ยังไม่ได้ตรวจสิทธิ์แยกจะถูกละไว้ feature ต้องตรวจ reference ก่อนแสดงหรือบันทึก ไม่ใส่ raw object กลับเข้า response
- `gateway.py` ใช้กับ API Gateway HTTP API v2 ผ่าน `http_api.handle(event, service, repository)` ตรวจ Session/CSRF ก่อนเรียก adapter; ทุก response protected ใช้ no-store; content ต้อง ready และตรวจสิทธิ์ก่อน stream
- list ตรวจสิทธิ์และ projection ก่อนค้นจาก name/title รวม count และแบ่งหน้า limit 20/max100; cursor มีลายเซ็น ผูกกับ Session, route, query, limit และ snapshot ที่ผู้ใช้เห็น การเปลี่ยน snapshot ให้ 422 และ frontend เริ่มหน้าแรกใหม่ type/status/date filters ยังไม่เชื่อมกับ #111 และ query ที่ไม่รองรับให้ 422
- `public_projection` และ `public_records` เป็นฟังก์ชันร่วมสำหรับ public/backup adapter เลือกเฉพาะ public fields; activity ที่ primary partner ไม่ public จะถูกตัด และ co-host แสดงเฉพาะ public partners ไม่คืน internal IDs/counts publication flags ที่ขัดกันถูกปฏิเสธ
- ฟังก์ชันตรวจ role-manager/target/assignee/reference พร้อมให้ #77 และ feature validators เรียกใช้ manageRoles ไม่เพิ่มสิทธิ์อ่านข้อมูลธุรกิจ และแก้ grant ของตนเองไม่ได้

## การเชื่อม repository ของ feature

ส่ง adapter เป็น argument ที่สามของ `handle` หรือสร้าง `PermissionGateway(service, repository)` โดย adapter ต้องทำตามสัญญานี้:

| Method | ข้อกำหนด |
| --- | --- |
| `get(kind, id)` | อ่าน record จริงแบบ strongly consistent; ไม่มีข้อมูลคืน None ห้ามผสม entity type |
| `list(kind, context, parent)` | iterator ของ candidates เฉพาะ grant scopes จาก server และชนิด/parent ที่ร้องขอ ต้องอ่าน storage ทุกหน้าจนครบก่อนคิด count ไม่คืน global count หรือข้อมูลตกหล่นเป็น empty success; gateway ตรวจ assignment/participant/parent ซ้ำ |
| `parse_upload(event)` | #101 parse multipart และ validate signature/MIME/extension/size คืน `(metadata, validated_file)` โดยยังไม่เขียนไฟล์/metadata/log credential |
| `mutate(kind, action, payload, record, parent, conditions, idempotency_key, upload=None)` | validate required fields/values/references/assignees/state transitions; stamp server-owned fields และสัมพันธ์ parent; บันทึกแบบ atomic ตามเงื่อนไขด้านล่าง แล้วคืน record จริงหลังเขียน |
| `content(document, disposition)` | stream private file โดยไม่เปิด public URL; กำหนด MIME ที่ตรวจแล้วและ safe Content-Disposition; ห้าม log objectKey/credential |

`mutate` ต้องทำ business validation ของ #91 และ #94–#106 ไม่ใช่เพียง PutItem ตาม payload ตัวตรวจสิทธิ์ไม่ได้อนุญาตให้ข้าม required fields, date/state transition หรือให้ assign ผู้ไม่มีสิทธิ์ ใช้ `require_reference` และ `require_assignee` กับข้อมูลจาก server แล้วตรวจซ้ำใน transaction หากเงื่อนไขเปลี่ยนระหว่าง request ได้

ทุกการเปลี่ยน assignment/scope/publication หรือ business record ต้องเพิ่ม `version` รวมถึงการถอน role ต้องอัปเดต user snapshot และ `authzVersion` แบบ atomic ตาม #78 PATCH/status ต้องมี `If-Match: "<version>"`; ขาดให้ 428 เก่าให้ 409 Create/upload ต้องมี Idempotency-Key และ adapter ต้องเก็บผล per user/route 24h ตาม #92 key เดิม payload เดิมคืนผลเดิม ต่าง payload ให้ 409 (gateway ตรวจรูปแบบ key เท่านั้น)

`WriteConditions` ระบุ user/authzVersion, session hash, target/version, parent/version และ scope ที่ตรวจสิทธิ์แล้ว `transactions.py` สร้าง DynamoDB ConditionCheck ของ user/session/parent ให้รวมใน **TransactWriteItems เดียวกับ write**:

```python
from backend.permissions.transactions import transaction_checks, target_condition

checks = transaction_checks(
    conditions, user_table=user_table, session_table=session_table,
    business_table=business_table, now=server_now,
)
# existing target: ใส่ target_condition(conditions) ลงใน Update operation
# create: ใส่ attribute_not_exists(id) ลงใน Put operation
# ใส่ reference/version และ idempotency checks ที่ feature ต้องใช้ด้วย
# dynamodb.transact_write_items(TransactItems=checks + feature_operations)
```

ห้ามแยก ConditionCheck แล้วเขียนทีหลัง DynamoDB ห้าม check และ update item เดียวกันซ้ำใน transaction จึงต้องใส่ target condition ใน Update โดยตรง หาก layout ไม่ใช่ user/business key `id` และ session key `tokenHash` ต้องทำ adapter ที่คงทุกเงื่อนไข ห้ามละ checks เพื่อให้ request ผ่าน Transaction cancellation ให้แปลงเป็น 401 เมื่อ Session ถูกถอน, 409 เมื่อ record/version เปลี่ยน หรือ 503 เมื่อ dependency ล้มเหลว โดยไม่คืนรายละเอียดภายใน

Session ถูกอ่านใหม่ก่อนคืนผล mutation; การตรวจหลังเขียนอย่างเดียวไม่ทดแทน atomic checks ถ้าสิทธิ์ถูกถอนหลัง commit แต่ก่อน response อาจได้ 401 ทั้งที่เขียนสำเร็จแล้ว client ต้องอ่านกลับ/ใช้ idempotency ตาม contract เมื่อเข้าระบบใหม่

## Error contract

| HTTP | ตัวอย่าง |
| --- | --- |
| 400 | JSON ผิดรูปแบบ/ซ้ำ key หรือ body ไม่ใช่ object |
| 401 | ไม่มี Session, anonymous, tampered/expired/revoked |
| 403 | ไม่มี role ที่ทำ action ได้, CSRF/Origin ผิด, field เกินสิทธิ์ |
| 404 | รายการไม่พบหรือนอก scope/assignment/participant/audience ใช้ข้อความเดียวกัน |
| 409 | version ไม่ตรง; feature adapter เพิ่ม transition/conflict cases |
| 422 | fields/query/cursor/version/idempotency key ไม่ถูกต้อง |
| 428 | ไม่มี If-Match สำหรับ update/status |
| 503 | repository/config/dependency ยังไม่พร้อม ไม่มี public fallback |

## หลักฐานและส่วนที่เหลือ

รัน `python3 -m unittest discover -s backend/tests -v` และ `npm test` จาก root รายละเอียดผลอยู่ที่ [หลักฐาน #79](../../docs/evidence/v3-permissions-issue-79.md)

ยังไม่มี production business repository, multipart/file stream adapter, การตั้งค่า AWS business routes หรือการเปลี่ยน public Lambda/backup workflow ตัวจริง `lambda_function.handler` ของ #78 ยังส่งเพียง session service; business request ที่มีสิทธิ์จะได้ 503 จนฉีด repository ที่ทำตามสัญญาข้างต้น ส่วน public routes เดิมและ frontend ไม่ได้เปลี่ยนมาใช้ projection ใหม่นี้โดยอัตโนมัติ

ก่อนปิด #79 ต้องเชื่อม adapters ของ feature และ #77, ให้ production public/backup เรียก projection เดียวกัน, ตรวจ atomic write ด้วย DynamoDB จริง, เชื่อม #111 filters และทดสอบข้ามบัญชี/หลักสูตร/เอกสารบน HTTPS จริง ตาม #81/#112/#113 จึงคง issue และ PR เป็น Draft/เปิดไว้ ผลทดสอบปัจจุบันไม่ใช่หลักฐานว่า Production ผ่านแล้ว
