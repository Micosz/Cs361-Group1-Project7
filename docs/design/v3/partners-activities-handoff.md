# คู่มือเริ่มงาน Partners and Activities — #82

ตรวจจาก `main` commit `c3449a52a86f4a3d75937b738413208ae9890da4` และ Draft [PR #123](https://github.com/Micosz/Cs361-Group1-Project7/pull/123) commit `da023cb6bfd42d2ac77ee346c3fe05fd467d6aed` วันที่ 11 ตุลาคม 2026 คู่มือนี้เตรียมการพัฒนา ไม่ใช่หลักฐานว่า CRUD หรือ AWS พร้อมใช้งาน

## เริ่มตรงนี้

1. อ่านส่วนของตนในตารางด้านล่าง แล้วอ่าน [แบบข้อมูล #91](data-model.md), [API #92](api-flows.md) และ [สิทธิ์ #66](scope-permissions.md) เฉพาะ partner/contact/history/activity
2. ใช้ branch ของ issue จาก `origin/main` ล่าสุด ไม่เริ่มจาก `66-UserRole` หรือ branch Login เก่า ถ้ามี branch งานเดิมให้ใช้ต่อหลังตรวจ diff และประสานผู้รับผิดชอบ
3. ตกลง storage และสัญญาร่วมในหัวข้อ “จุดที่ต้องตกลง” ก่อนเขียน adapter จริง ระหว่างนี้ทำ form, validator และ tests ด้วยข้อมูลสมมติได้
4. แบ่ง commit เป็น model/validation, API/storage, UI และหลักฐานตามงานที่มีจริง เปิด Draft PR ตั้งแต่มีส่วนที่ review ได้ ระบุว่าใช้ mock/local หรือระบบจริง

| Issue / ผู้รับผิดชอบ ณ วันที่ตรวจ | งานหลัก | ส่งต่อให้ |
| --- | --- | --- |
| [#94](https://github.com/Micosz/Cs361-Group1-Project7/issues/94) / Suttipoch | Partner + Contact เพิ่ม/แก้, ตัวเลือก Partner ตามสิทธิ์ | #95 ใช้ parent; #96/#97 ใช้ ID และตัวเลือก |
| [#95](https://github.com/Micosz/Cs361-Group1-Project7/issues/95) / Micosz | ประวัติจาก Activity/Agreement เดิมในรายละเอียด Partner | detail ร่วมของ #94 |
| [#96](https://github.com/Micosz/Cs361-Group1-Project7/issues/96) / wuttikornboontawee | Activity เพิ่ม/แก้, ผู้รับผิดชอบ, form/detail ร่วม | #97 ต่อความสัมพันธ์ใน API/form เดียวกัน |
| [#97](https://github.com/Micosz/Cs361-Group1-Project7/issues/97) / Micosz, Supavit-49 | ตรวจ/อ่าน/ถอด partner/co-host/agreement links | repository และ form/detail ของ #96; options ของ #94/#98 |

ผู้รับผิดชอบและ PR อาจเปลี่ยน ให้เช็ก Issue ก่อนเริ่ม ไม่ต้องรอปิด parent #82 หรือ #79 ทั้งชุด

## มีอะไรแล้ว และอะไรยังไม่มี

| ฐานที่ใช้ | ใช้ทำอะไร | ข้อจำกัดที่ต้องต่อ |
| --- | --- | --- |
| `backend/permissions/gateway.py` | route partner/activity และ nested contact/history; Session, field permission, If-Match, write conditions | ไม่มี business repository จริง; adapter ไม่พร้อมตอบ 503 |
| `backend/permissions/policy.py` | `require_record`, `validate_fields`, `require_reference`, `require_assignee` | ตรวจสิทธิ์ ไม่ตรวจความถูกต้องของชื่อ/วันที่/ค่าฟิลด์ธุรกิจทั้งหมด |
| `backend/permissions/projections.py` | `project`, `public_projection` | ไม่ expand protected reference IDs; history ยังไม่คืน referenceType/referenceId; feature ต้องเติมเฉพาะ reference ที่ตรวจสิทธิ์แล้ว |
| `backend/permissions/transactions.py` | `transaction_checks`, `target_condition` | adapter ต้องรวม checks กับ write/idempotency/reference checks ใน transaction เดียว |
| `backend/application.py` | `AuthApplication(..., repository=None)` ส่ง repository ไป transport | `backend/lambda_function.py` ยังไม่ inject business repository |
| `public/assets/auth-client.js` | `CstuAuth.refresh/request/mutate/create` | มี helper POST จาก PR #147; storage replay ยังต้องต่อ |
| `public/assets/workspace.js`, `public/workspace.html` | Session/role workspace และฟอร์ม role management | ยังไม่มี form/list/detail ธุรกิจของ #82 |
| `public/assets/script.js` | Public browse/detail เดิม, Search/date/MoU และลิงก์ Partner จาก PR #145 | เป็น public reader ไม่ใช่ protected CRUD; อย่าใช้ public cache เป็นข้อมูลแก้ไขภายใน |
| PR #123 / `backend/relationships/activity_links.py` | `plan_patch`, `internal_links`, `public_links`, `legacy_relationships` | Draft ไม่อยู่บน main, ไม่บันทึกจริง, ไม่มี API/UI และรองรับแผน PATCH ของ activity ที่มี version แล้ว |

main มี `backend/partners/` จาก PR #147 เป็น prototype Partner/Contact ในหน่วยความจำ ยังไม่มี persistent storage, UI หรือ production injection ให้ใช้ต่อและตกลง validator กลางก่อนเชื่อม `backend/business/` ไม่สร้าง adapter ซ้ำ

ชุดเตรียม #82 ใน PR นี้เพิ่ม [โค้ดฐานร่วมและตัวอย่างใช้](../../../backend/business/README.th.md): `backend/business/validation.py`, typing port ใน `ports.py`, synthetic fixtures ใน `backend/tests/fixtures/partners_activities.py` โดยใช้ `CstuAuth.create` ที่มีบน main แล้ว ส่วนฐานร่วมนี้พร้อมใช้หลัง PR #146 merge ไม่ใช่ business repository ที่ใช้งานจริง

## จุดที่ต้องตกลงร่วมกันก่อนต่อของจริง

ให้ #94/#96 กับผู้รับผิดชอบ #79/#98 บันทึกข้อสรุปใน #82; ช่องว่างต่อไปนี้ไม่ใช่สิ่งที่เพื่อนต้องเดาเอง:

- [ ] เลือก business table/key/index และเจ้าของ adapter กลางสำหรับ Partner/Contact/History/Activity พร้อมวิธีอ่านตาม scope/parent; #93 ยังไม่ได้เลือก topology และชื่อตารางธุรกิจจริง
- [ ] ระบุที่เก็บ idempotency และวิธีตรวจ user/session/target/parent/reference versions ณ commit รวมการแปลง DynamoDB Decimal และ transaction limits
- [ ] ตกลง response สำหรับ expanded links และ history references หลัง authorization เพื่อให้ form/detail อ่านกลับได้โดยไม่คืน raw records
- [ ] ระบุช่องทางเลือก active verified responsible users ใน scope ของ staff สำหรับ #96; role-manager API ไม่ใช่ user directory และ `/users` selector ใน #92 ยังไม่ใช่ endpoint ที่ทำแล้ว
- [ ] รักษา `activity_tags: ["mou"]` จาก PR #142: แบบข้อมูล/allowlist ใน #91/#92/#79 ยังไม่มีฟิลด์นี้ ต้องตกลง internal field + validation + public alias ร่วมกันก่อนเปิด V3 writer/export ไม่ตัด tag ทิ้งหรือจัด MoU จากชื่อ
- [ ] #95 ใช้ history เป็น **internal** ตาม dictionary ปัจจุบัน ไม่มี publication field สำหรับ history; ข้อความ “สาธารณะ/ภายใน” ใน Issue ไม่ได้อนุญาต export history อัตโนมัติ หากต้องการ public history ให้ทบทวน #91/#92/#79 ก่อน
- [ ] Review ชนิดที่ helper เริ่มต้นใช้: Partner เป็น union ของ #91 และ V2 (รวม research_institute/internship), Activity academic_activity/event/research และข้อจำกัด asset `resources/<filename>.jpg/jpeg/png/webp`; หากขยายให้ frontend/backend ใช้ชุดเดียวกัน
- [ ] ยืนยันกติกาเรียง history: baseline ใช้ occurredOn แล้ว createdAt/id; ข้อเสนอสำหรับ UI คือใหม่ไปเก่า และ tie-break คงที่ ต้องตกลงทิศทางเดียวกันก่อน acceptance

เตรียม local validators/forms ได้ก่อนข้อสรุปเหล่านี้ แต่ PR ต้องระบุจุด pending ไม่ประกาศ API/storage พร้อมแล้ว

## ขั้นตอน #94 — Partner และ Contact

1. สร้าง validator จาก dictionary: Partner `name/type/summary/location`, optional `websiteUrl/logoPath/fullDescription`; Contact `name`, optional `position/email/phone` ตรวจชนิด/ความยาว/URL และ unknown fields ฝั่ง server
2. ต่อ `GET/POST /api/partners`, `GET/PATCH /api/partners/{id}` ผ่าน gateway เดิม ไม่สร้างเส้นทางที่ข้าม policy POST ส่ง scopeId ใน grant ของ staff; server สร้าง id/version/timestamps เอง
3. ต่อ `GET/POST /api/partners/{id}/contacts` และ `PATCH .../contacts/{contactId}`: parentId มาจาก URL; backend stamp partnerId/scopeId เอง ตรวจ child อยู่ parent นั้นและ parent version ณ write
4. ทำ shared form เพิ่ม/แก้ และอ่าน protected detail ก่อนแก้ ใช้ Edit บนรายละเอียดสำหรับผู้มีสิทธิ์และทางเข้าเพิ่ม Partner สำหรับ staff ในเมนูงาน ไม่สร้างฟอร์มแยกทุกบทบาท
5. ส่งตัวเลือก Partner ให้ #96/#97 ด้วย ID จริงและ label ที่ผ่าน projection โดยจำกัดสิทธิ์/scope ก่อน pagination/count ต้องประสาน query contract กับ #92; ห้ามโหลดทุก Partner แล้วกรองใน browser
6. อ่านกลับหลังบันทึก ตรวจ Contact ไม่ออก public/backup และ executive อ่าน contact ไม่ได้

หลักฐานขั้นต่ำ: staff C1 สร้าง/แก้/อ่านกลับ, coordinator assigned แก้ internal ได้แต่ unassigned/ข้าม scope ถูกปฏิเสธ, missing fields/unknown fields/Contact ข้าม parent ไม่เปลี่ยนข้อมูล; stale If-Match และ create replay ได้ผลตาม contract

## ขั้นตอน #95 — ประวัติความร่วมมือของ Partner

แนวล่าสุดแสดงประวัติจาก Activity/Agreement เดิมในรายละเอียด Partner ไม่เพิ่มฟอร์มประชุมหรือบันทึกกิจกรรมซ้ำ อ่าน [คู่มือ #95](../../ai-guides/v3/issue-95.md) ก่อนเริ่ม

1. ตกลงและปรับ Issue #95 กับแบบข้อมูล #91/API #92 ให้ตรงกันก่อน implementation เพราะ baseline เดิมยังใช้ RelationshipHistory และ GET/POST/PATCH history แยก
2. ใช้ partnerId/coHostPartnerIds และความสัมพันธ์ Agreement ที่ตรวจแล้วรวบรวมรายการเดิม จำกัดสิทธิ์และ scope ก่อน pagination/count ไม่ดึงข้อมูลทั้งหมดไปกรองใน browser
3. คืนรายการตาม projection ที่ผู้ใช้มีสิทธิ์อ่าน ไม่เปิดชื่อ/ID/count ของข้อตกลงที่อ่านไม่ได้ และไม่คืน raw records
4. แสดงวัน ประเภท ชื่อรายการ และลิงก์ไป detail เดิม เรียงตามวันที่ที่ตกลงกับ tie-break คงที่ พร้อม empty/loading/error; สร้าง/แก้ผ่านฟอร์ม Activity/Agreement เดิม
5. helper/schema history ในฐานร่วมนี้รองรับ baseline เดิมเท่านั้น ไม่บังคับสร้างข้อมูลซ้ำ การเลิกใช้หรือย้ายข้อมูลต้องตกลง migration กับ #91/#92 ก่อน

หลักฐานขั้นต่ำ: หลายรายการ/วันเดียวกัน/ไม่มีรายการ, primary/co-host ถูก Partner, ข้าม scope/ไม่มีสิทธิ์ไม่เผยข้อมูล, ลิงก์เปิด detail เดิม และไม่เกิดการบันทึกซ้ำ

## ขั้นตอน #96 — Activity และผู้รับผิดชอบ

1. ใช้ model Activity จาก #91; validator ตรวจ required title/type/summary/partnerId, optional date/image/text และคง tag MoU ตามข้อสรุปร่วม
2. ต่อ `GET/POST /api/activities` และ `GET/PATCH /api/activities/{id}` ผ่าน gateway; แยก validator ฟิลด์กิจกรรมกับความสัมพันธ์ที่จะส่งให้ #97
3. Coordinator create ให้ server assign ตนเองและ default internal; staff เปลี่ยน responsibleUserIds ได้หลังอ่าน UserState จริงและเรียก `require_assignee` ใน scope นั้น Coordinator ห้ามส่ง assignment/publication/scope เพื่อเพิ่มสิทธิ์
4. ประสาน #97 สำหรับ primary/co-host/agreement ก่อน transaction; create ต้องมี validation ความสัมพันธ์ของตน เพราะ `plan_patch` ใน PR #123 ยังไม่รองรับ create โดยตรง ห้ามถือ helper เป็น saved entity
5. ทำ form/detail ชุดเดียวให้ #108/#109 ใช้ต่อ ผู้รับผิดชอบเลือกจากบัญชีจริง; ถ้า selector ยังไม่พร้อมให้ระบุ pending ไม่ใช้รายชื่อ coordinator เดิมเป็น user IDs
6. เก็บ version และอ่านกลับหลัง save; การเปลี่ยนผู้รับผิดชอบต้องทำให้คนเดิม/คนใหม่มีสิทธิ์ตรงกัน การแก้ public-facing fields ของ public activity โดย coordinator ต้องถูกปฏิเสธ

หลักฐานขั้นต่ำ: create/update/read-back, real assignee validation + เปลี่ยนคนรับผิดชอบ, wrong date/unknown field/ปลอม user ID, stale version, Public Search/type/date/ลิงก์ Partner/MoU ยังทำงานเดิมและไม่มี internal fields

## ขั้นตอน #97 — ความสัมพันธ์กิจกรรม

1. อ่าน [PR #123](https://github.com/Micosz/Cs361-Group1-Project7/pull/123) และ `backend/relationships/README.th.md` บน branch `97-Activity-Links` ก่อนเริ่ม ไม่เขียน helper ชุดเดิมซ้ำ ไม่ merge Draft เพียงเพื่อให้ import ผ่าน
2. Review ส่วนแยกก่อนเลือกว่าจะรวมตามปกติหรือใช้ branch ต่อร่วมกับ #96 โดยบันทึก base/commit ที่ใช้; ทดลอง branch แยกได้ด้วยคำสั่งด้านล่าง
3. ต่อ callback `allowed` จาก server SessionContext และ `get_record` จาก repository; แปลง LinkError เป็น AuthError/contract error ไม่เปลี่ยน error ของ storage เป็น empty success
4. PATCH ส่งเฉพาะ partnerId/coHostPartnerIds/agreementIds ให้ `plan_patch`; primary 1, co-host หลายตัว, agreement ว่างได้, IDs ไม่ซ้ำ การถอด link ไม่ลบต้นทาง
5. repository ของ #96 รวม target/user/session/parent/reference checks, idempotency ตาม action และ write ใน transaction เดียว; helper คืนแผน ไม่ได้บันทึกหรือรับรอง transaction ให้
6. options จาก #94/#98 จำกัดสิทธิ์ก่อน paginate/count; detail ใช้ `internal_links` หลัง policy, public adapter ใช้ `public_links` + allowlist โดยไม่อ่าน/คืน Agreement IDs/name/count
7. Migration คง partnerId และเก็บ legacyCoHostNames ภายในจนมี mapping ยืนยัน ไม่ใช้ substring ที่แสดงชื่อบน Public V2 เป็น migration authority

หลักฐานขั้นต่ำ: ก่อน/หลังเปลี่ยน primary/co-host, agreements=[] แล้วต้นทางยังอยู่, ID ซ้ำ/หาย/ผิดชนิด/ข้าม scope/อ่านไม่ได้, concurrent reference/version changes ปฏิเสธ atomic และ Public ไม่มี Agreement หรือชื่อ/count ของ internal co-host

## คำสั่งเริ่มงานและตรวจผล

จาก checkout ที่ทีมตกลง ตรวจ local changes ก่อน switch; ถ้ามีงานค้างให้หยุดและเก็บ/ประสานงาน ไม่ reset หรือ stash ให้อัตโนมัติ:

```sh
git status --short
git fetch origin
git switch -c 94-partners origin/main
# งานอื่นใช้ 95-history / 96-activities; ถ้า branch มีแล้วให้ตรวจและใช้ต่อ
```

สำหรับอ่าน/ทดลองส่วนแยก #97 โดยไม่เปลี่ยน main:

```sh
git fetch origin 97-Activity-Links
git switch -c 97-integration origin/97-Activity-Links
python3 -m unittest discover -s backend/tests -p 'test_activity_links.py' -v
```

ใช้ root ของ checkout งานนั้นและ Python environment ของโครงการ (CI ใช้ Python 3.12; dependencies ใน `backend/requirements.txt`):

```sh
python3 -m unittest discover -s backend/tests -p 'test_permissions.py' -v
# เพิ่ม tests ธุรกิจเฉพาะจุดสำคัญใน backend/tests และรันด้วย -p ของไฟล์นั้น
npm test
git diff --check
```

ก่อนส่ง integration ให้รัน backend suite เดิมตาม workflow ด้วย ไม่สร้าง tests ซ้ำเพื่อเพิ่มจำนวน:

```sh
python3 -m unittest discover -s backend/tests -v
```

Local/mock ผ่านยังไม่ยืนยัน DynamoDB/HTTPS จริง การตั้ง AWS และ migration ใช้ [runbook #93](architecture-migration.md) และ #81/#112/#113; อย่ารัน `migrate.js` เก่าหรือเขียนข้อมูล V3 ลงตาราง Partner เดิมก่อนตกลง destination/rollback

## Header และ frontend ที่ต้องต่อร่วมกัน

- อ่านข้อมูลผ่าน `CstuAuth.request('/partners/...')` path ไม่เติม `/api` ซ้ำ; protected ไม่มี fallback JSON
- PATCH ใช้ `CstuAuth.mutate(path, payload, version)` ซึ่งเติม CSRF/If-Match แล้ว ขาด version ห้ามกดบันทึก
- main จาก PR #147 มี `CstuAuth.create(path, payload, submissionKey)` ให้แล้ว: refresh Session, POST, X-CSRF-Token, Idempotency-Key 16–128 ตัว `[A-Za-z0-9_-]`; form ส่งเฉพาะ allowlist, retry payload เดิมใช้ key เดิมและเปลี่ยน key เมื่อแก้ payload/เริ่มรายการใหม่ ไม่มี token/password ใน localStorage ส่วน storage replay ยังต้องทำ
- Browser ส่ง Origin เอง; ฟอร์มแสดง saving/กันกดซ้ำ, 401 กลับ Login/ล้าง protected state, 403 แสดงไม่มีสิทธิ์, 409 โหลดรุ่นล่าสุดให้ผู้ใช้ทบทวน, 422 แสดง validation, 503 แสดง retry ไม่แทนด้วยรายการว่าง
- Response ตอนนี้ไม่ได้มี `allowedActions`/`writableFields` โดยอัตโนมัติ หาก UI ต้องใช้ให้ตกลงกับ #92/#79 ก่อน ปุ่มซ่อนไม่แทน backend authorization
- Render ชื่อ/หมายเหตุด้วย textContent หรือ DOM ที่ปลอดภัย; คง Search/filter เมื่อกลับ detail ไม่เก็บ protected payload ใน URL

## สิ่งที่แนบเมื่อส่งต่อ/ขอ Review

ระบุ Issue/branch/base/head/PR, ส่วนที่ทำ, ส่วนที่ต้องต่อพร้อมเจ้าของงาน, คำสั่งและผลตรวจ, before/after ของข้อมูลสมมติ และภาพ UI ที่เกี่ยวข้อง แยก static/local/mock/CI/ระบบจริง พร้อมข้อจำกัด ไม่แนบ secret หรือข้อมูลติดต่อจริง

เกณฑ์รวม #82: #94 → history #95 ถูก Partner, #96 → links #97 ถูก IDs; อ่านกลับหลังเขียน; coordinator assigned/staff scope ทำได้, คนอื่น/ข้าม scope/API ตรงถูกปฏิเสธ, Public/backup ไม่มี Contact/History/Agreement/responsible IDs; V2 Search/type/date/MoU ยังใช้ได้ งานแต่ละข้อยังเปิดจน integration/ผลจริงตาม acceptance พร้อม
