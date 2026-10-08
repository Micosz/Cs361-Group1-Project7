# Data dictionary, ownership and states — #91

**V3-B1 · baseline schema · 8 October 2026** · [สารบัญ](README.md)

## สิ่งที่พบจริง

ตรวจ `public/data/partner-data-backup.json`, `data/partners.json`, `migrate.js` และ reconstruction ใน `public/assets/script.js` พบ snapshot flat 26 records (13 partners, 13 activities), partner `access_level=public`, activity `visibility=public`, `partnerId` และ `period_date`; มี co-host เป็นชื่อและ coordinator เป็นชื่อบุคคล ไม่มี user/owner/participant ID หรือ agreement/exchange/document entity ที่ยืนยันใน snapshot ดู [field inventory](legacy-inventory.json) ข้อนี้ไม่ยืนยัน schema AWS ทั้งหมด

`migrate.js` เป็นสคริปต์เก่า PutCommand ลงตาราง Partner ไม่มีแผน V3/rollback จึงไม่ใช้รัน migration ใหม่นี้โดยตรง ข้อมูลชื่อ coordinator เดิมจะเก็บเป็น external contact จนมี identity mapping ยืนยัน ไม่เปลี่ยนชื่อเป็นผู้มีสิทธิ์อัตโนมัติ

## Common fields และกติกา

ทุก business entity ใช้ `id:string` stable ไม่ซ้ำ, `entityType`, `schemaVersion:3`, `scopeId:string` required, `createdAt/updatedAt:UTC timestamp`, `createdBy/updatedBy:userId|null` (null ได้เฉพาะ imported legacy), `version:positive integer` สำหรับ optimistic concurrency; field server-owned ห้าม client เปลี่ยน

Public-capable Partner/Activity มี `publication:public|internal` default internal; ข้อมูลอื่น internal/personal โดยโครงสร้าง ไม่ publish ทั้งก้อน ค่า publication ขัดกับ legacy flags ให้ quarantine ตรวจเพิ่ม ไม่ใช้ OR แล้วเปิดอัตโนมัติ Unknown fields/mass assignment → 422

`R` required, `O` optional; `P` public ได้เฉพาะเมื่อรายการถูกเผยแพร่และอยู่ใน allowlist, `I` internal, `S` personal/server-only ทุก reference ต้องตรวจ existence, entity type, curriculum scope และสิทธิ์ผู้เรียกก่อนบันทึก ความสัมพันธ์ protected ไม่ถูกแปลงเป็นชื่อ/count ใน public responses

## Entities / field dictionary

| Entity | Fields / ชนิด / required | Classification และเงื่อนไข |
| --- | --- | --- |
| User | `id UUID R`, `displayName string R`, `active bool R`, `identityVerified bool R`, `authzVersion int R`, `email string O` | S; email optional display/contact ไม่เป็น unique account/authorization key; server owns active/identityVerified/version |
| IdentityLink | `provider='tu' R`, `subjectKey string R unique`, `userId R`, `verification=provisional\|verified R`, `verifiedAt timestamp O`, `aliasKeys string[] O` | S/server-only; subjectKey ตาม [identity design](authentication-session.md); alias manual verified; ไม่เก็บ TU password |
| RoleGrant | `id R`, `userId R`, `role=student\|coordinator\|staff\|executive R`, `scopeId R`, `active bool R`, `grantedBy R`, `grantedAt R` | S; unique active user/role/scope, write เฉพาะ manageRoles capability; capability grants เก็บแยก provisioning path |
| Session | `tokenHash R`, `userId O` (anonymous ได้), `authzVersion O`, `csrfHash R`, `createdAt/lastSeenAt/absoluteExpiresAt R`, `revokedAt O` | Server-only; token อายุ/cleanup ตาม Session design ไม่ใช้ business table export |
| Partner | `name/type/summary/location string R`, `websiteUrl/logoPath/fullDescription string O`, `responsibleUserIds userId[] R`, `publication R` | P สำหรับ display fields เท่านั้น; responsible IDs I; type company/university/government/internship ตามข้อมูลจริง; imported legacy ใช้ responsible=[] ได้ |
| Contact | `id R`, `partnerId R`, `name R`, `position/email/phone string O` | S; external contact แยกจาก User ไม่มี Login/grants; ห้ามส่ง public อัตโนมัติ |
| RelationshipHistory | `id R`, `partnerId R`, `occurredOn date R`, `kind=meeting\|agreement\|activity\|other R`, `note string R`, `referenceType=agreement\|activity/referenceId O`, `recordedBy userId R` | I; บันทึก/แก้เหตุการณ์ตาม #95 ด้วย parent permission และ version check; sort occurredOn แล้ว createdAt/id ไม่ใช่ full audit dashboard; reference ต้องเข้าถึงได้และอยู่ scope เดียวกัน |
| Activity | `title/type/summary string R`, `fullDescription string O`, `partnerId R`, `coHostPartnerIds string[] O`, `agreementIds string[] O`, `periodText string O`, `periodDate date O`, `imagePath O`, `responsibleUserIds R`, `publication R` | P สำหรับ display fields/allowed public partner relations; links agreement/responsibility I; legacy co-host names เก็บ `legacyCoHostNames` I จน resolve |
| Agreement | `title string R`, `agreementType=MoU\|MoA R`, `partnerIds string[] R nonempty`, `responsibleUserIds userId[] R nonempty`, `startDate/endDate date O`, `status R`, `renewalDueOn date O`, `renewalNote/internalNote string O` | I; status/dates ตาม transition table; ไม่เผยเอกสาร/contact details สู่ Public |
| Exchange | `title string R`, `partnerIds string[] R nonempty`, `agreementId string O`, `responsibleUserIds userId[] R nonempty`, `participantUserIds userId[] R`, `startDate/endDate date O`, `status R`, `supportingInfo/supportingInfoForParticipant string O` | I; participant identities S; draft participant=[] ได้, ongoing ต้องมี verified participants; student projection ห้ามคืน participants คนอื่น/internal notes |
| Document | `id R`, `parentType=agreement\|exchange R`, `parentId R`, `scopeId R`, `objectKey R`, `displayName R`, `mime/size/hash R`, `audience=internal\|participants R`, `containsPersonal bool R`, `uploadState=pending\|ready\|rejected R`, `uploadedBy/uploadedAt R` | objectKey/hash/server upload state server-only; metadata I/S ตาม parent/audience; containsPersonal=true ต้อง audience=participants และ parent=exchange; inherited access ห้าม independent public flag |

`responsibleUserIds` ต้องอ้าง active verified coordinator/staff ใน scope นั้น student participant ต้องอ้าง active verified student ใน scope เดียวกัน Role withdrawal ทำให้สิทธิ์หมดแม้ record ยังมี userId อยู่ Record ที่ขาด responsible หลัง revoke ให้ staff รับช่วง ไม่เปิดให้ทุก coordinator

## Validation baseline

- `title/name` 1–200 chars, `summary` ≤2,000, notes/description ≤20,000; trim display text, render เป็น text/sanitized markup ไม่ต่อ innerHTML จากข้อมูลผู้ใช้โดยตรง
- Arrays ไม่ซ้ำ; partnerIds ≤20, responsibility ≤20, participants ≤200; limits เป็น baseline product choices ต้อง validate ฝั่ง server และ client ใช้ข้อความเดียวกัน
- Date ใช้ Gregorian `YYYY-MM-DD` จริงตาม calendar; start ≤ end ถ้ามีทั้งคู่ ไม่มี timezone conversion สำหรับวัน พ.ศ. แปลงใน UI ก่อนส่ง ISO
- `websiteUrl` เฉพาะ HTTPS/HTTP, asset paths เฉพาะ approved public media path ไม่รับ JavaScript/data URL; private file ไม่มี object URL ใน business JSON
- create โดย coordinator: server assign ตนเองใน grant scope; staff เปลี่ยน responsibilities/participants ได้หลังตรวจ refs; coordinator แก้ participants ของ assigned exchange ได้แต่เปลี่ยน responsibility/scope ไม่ได้
- active agreement/ongoing exchange ต้องมี start/end และ responsible; draft/legacy อนุญาต date=null โดยไม่เดา ห้าม activate เมื่อ endDate ผ่านแล้วหรือ linked refs ใช้ไม่ได้
- publication เปลี่ยนโดย staff เท่านั้น; coordinator แก้ internal fields ได้ แต่การแก้ public-facing fields ของรายการที่เผยแพร่แล้วให้ 403 จน staff เปลี่ยนเป็น internal ก่อน (ไม่มี approval workflow)

## State transitions

สถานะเป็น business state ที่เจ้าหน้าที่/ผู้รับผิดชอบเปลี่ยนเอง ไม่ใช่ระบบอนุมัติ ไม่มี auto date job คำนวณ `pastEndDate` เป็น derived warning แยกจาก persisted status

| Entity / From → To | Actor / Guard | หมายเหตุ |
| --- | --- | --- |
| Agreement draft → active | assigned coordinator หรือ curriculum staff; required dates/partners/responsible valid | ไม่อนุญาต date ในอดีตที่ endDate < วันนี้ |
| Agreement active → expired | actor เดียวกัน; endDate < วันนี้ | boundary วันตาม business timezone Asia/Bangkok |
| Agreement active → terminated | actor เดียวกัน; reason required | เก็บ termination note/time ไม่ delete |
| Agreement expired → active | actor เดียวกัน; renewalNote + endDate ใหม่ ≥ วันนี้, start≤end | renewal ของ record เดิม; version/history ไม่หาย |
| Agreement draft → draft / active → active / expired → expired / terminated → terminated | actor เดียวกัน; ordinary field validation | terminated ห้ามแก้ dates/status กลับ; แก้ note ได้ |
| Exchange draft → ongoing | assigned coordinator หรือ curriculum staff; dates/partners/responsible และ participants อย่างน้อยหนึ่งคน valid, end≥วันนี้ | ไม่มี student self-application |
| Exchange ongoing → completed | actor เดียวกัน; completion supportingInfo required | ไม่บังคับรอ endDate หากจบก่อนกำหนด แต่เก็บเหตุผล |
| Exchange draft/ongoing → cancelled | actor เดียวกัน; reason required | ไม่ delete |
| Exchange draft → draft / ongoing → ongoing | actor เดียวกัน; validation เดิม | completed/cancelled แก้ supportingInfo ได้แต่ไม่ย้อน status/participants/dates |
| transition อื่นทั้งหมด | deny 409 `INVALID_TRANSITION` | student/executive ไม่มีสิทธิ์ write แม้ transition ถูกต้อง |

## Synthetic examples (ไม่ใช่ข้อมูลผู้ใช้จริง)

```json
{
  "user": {"id":"u-student-1","displayName":"Demo Student","active":true,"identityVerified":true,"authzVersion":1},
  "grant": {"id":"g1","userId":"u-student-1","role":"student","scopeId":"cs-demo","active":true,"grantedBy":"u-manager","grantedAt":"2026-10-08T00:00:00Z"},
  "exchange": {"id":"ex-demo-1","entityType":"exchange","schemaVersion":3,"scopeId":"cs-demo","title":"Demo Exchange","partnerIds":["partner-ipb-001"],"responsibleUserIds":["u-coordinator-1"],"participantUserIds":["u-student-1"],"status":"draft","startDate":null,"endDate":null,"version":1,"createdBy":"u-staff-1","updatedBy":"u-staff-1","createdAt":"2026-10-08T00:00:00Z","updatedAt":"2026-10-08T00:00:00Z"},
  "document": {"id":"doc-demo-1","parentType":"exchange","parentId":"ex-demo-1","scopeId":"cs-demo","objectKey":"private/demo/random-id","displayName":"demo.pdf","mime":"application/pdf","size":1024,"hash":"example-only","audience":"participants","containsPersonal":true,"uploadState":"ready","uploadedBy":"u-coordinator-1","uploadedAt":"2026-10-08T00:00:00Z"}
}
```

ตัวอย่างแสดง subset สำหรับ relationship; IDs demo ต้องมี referenced coordinator/staff/partner ที่ valid ใน fixture จึงทดสอบ writes ได้ ไม่ใช่ migration payload พร้อมรัน

Legacy example: partner `partner-tudublin-001` → คง id/display fields; เพิ่ม entityType/schemaVersion/scopeId ที่ผู้รับผิดชอบยืนยัน, responsible=[], createdBy=null, publication=public เฉพาะ explicit public เดิมที่ผ่าน field projection ตรวจแล้ว activities มี unresolved co-host ให้เก็บชื่อ legacy และรายงาน mapping pending ไม่ผูกชื่อคล้ายกันอัตโนมัติ; record missing owner ไม่ได้ทำให้ coordinator/student อ่าน internal ได้ ข้อมูลขาด status ของ agreement/exchange ให้ draft, dates=null และห้าม transition จนเติมครบ ดู [migration](architecture-migration.md)
