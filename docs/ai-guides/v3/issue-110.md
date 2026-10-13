# AI Guide #110 — Overview ของผู้บริหาร

[Issue #110](https://github.com/Micosz/Cs361-Group1-Project7/issues/110) · [Parent #86](https://github.com/Micosz/Cs361-Group1-Project7/issues/86)

## แนวล่าสุด — 12 ตุลาคม 2026

ใช้เมนูขวาบนเปิดหน้ารายการร่วม และปุ่มจัดการในรายละเอียดเดิม ไม่ทำฟอร์มหรือหน้ารวมซ้ำแยกทุกบทบาท #110 ยังคงภาพรวมพื้นฐานแบบอ่านอย่างเดียว ตรวจ Issue ล่าสุดเป็นหลัก ส่วนสถานะ main ด้านล่างเป็น snapshot เดิมก่อนงานชุดนี้

อ่าน [จุดต่อและสถานะงาน #108–#111](../../evidence/shared-navigation-108-111.md) ใน branch `108-shared-navigation`: มีเมนู/รายการ/รายละเอียด/filters พร้อมใช้กับ protected adapter, ฟอร์มและ storage จริงยังรอ integration ของเพื่อน ไม่ประกาศว่าระบบจริงพร้อมแล้ว

## ผลที่ผู้ใช้จะเห็น

เมนูผู้บริหาร → จำนวน/สถานะพื้นฐาน → เปิดรายการและรายละเอียดแบบอ่านอย่างเดียว

## สถานะที่มีแล้ว

main มี executive read policy/business projection และ menu link แต่ /overview ไม่มี route implementation และ workspace ยัง placeholder

## บริบทและสิ่งที่ต้องตรวจทันที

Repository: [Micosz/Cs361-Group1-Project7](https://github.com/Micosz/Cs361-Group1-Project7) · สถานะอ้างอิง main `e21750907ffed9f379a9d3d61a6be097a45f0385` · 11 ตุลาคม 2026 นี่เป็นคู่มือส่งต่อ ไม่ใช่คำยืนยันว่า feature deploy แล้ว

1. อ่าน Issue/PR ล่าสุดและ AGENTS.md ใน checkout ที่ผู้ใช้เลือก ตรวจ `git status --short` ก่อนแก้ ห้าม reset/stash/เปลี่ยน checkout ให้เองเมื่อมีงานค้าง
2. ตรวจ main และ branch งานเดิม อย่าเขียนส่วนที่เพื่อนมีแล้วซ้ำ ใช้ branch `<issue-number>-<short-name>` จาก origin/main ล่าสุดเมื่อยังไม่มี branch แบ่ง logical commits และเขียน GitHub ภาษาไทยไม่มี emoji
3. อ่าน `docs/design/v3/scope-permissions.md`, `data-model.md`, `api-flows.md`, `architecture-migration.md` เป็น baseline แล้วเทียบ runtime code ด้วย เอกสาร routes ไม่ได้แปลว่า endpoint ถูก deploy/implemented แล้ว
4. โค้ดหลักร่วม: `backend/http_api.py`, `backend/application.py`, `backend/permissions/gateway.py`, `backend/permissions/policy.py`, `backend/permissions/projections.py`, `backend/permissions/listing.py`, `backend/permissions/transactions.py`, `backend/auth/require_session.py`. Frontend ร่วม: `public/assets/auth-client.js`, `public/assets/role-menu.js`, `public/assets/workspace.js`, `public/workspace.html`; Public เดิมอยู่ `public/index.html`/`public/assets/script.js`
5. PR #147 merged มี Partner/Contact memory prototype + validators; production `lambda_function.py` ยังไม่ inject business repository. Draft PR #123 (97-Activity-Links) และ #146 (82-handoff) ไม่อยู่ main ต้อง review/ประสานก่อนใช้ ไม่ merge อัตโนมัติ

## กติกาหน้าเว็บร่วม

- Public Browse/Event & Activity เดิมยังใช้ได้เมื่อไม่ Login; MoU news/filter อยู่กับ Activity แต่ Agreement เป็น internal record ที่ link ด้วย ID ใช้ทางเข้า Event & Activity และ form/detail Agreement ชุดเดียว ไม่มีหน้า MoU/ฟอร์มซ้ำต่อ issue
- section เอกสารอยู่ใน Agreement/Exchange detail, My Exchange สำหรับ student read-only, coordinator/staff/executive workspace เปิด form/detail ร่วมตามสิทธิ์ ไม่มี student self-application/approval/delete/notifications หรือ analytics/export เพิ่มใน V3 นี้
- Loading/empty/error/saving/401/403/404/409/422/503 ต้องต่างกัน; protected dependency failure ไม่แทนด้วยข้อมูลว่างหรือ public backup ปิดปุ่ม save ระหว่างส่ง; conflict ให้ reload/review ไม่ overwrite เงียบ
- Render user content ด้วย textContent/DOM หรือ sanitization ที่ตรวจแล้ว ไม่ต่อ raw user text เข้า innerHTML; dialog ปิดได้ด้วยปุ่ม/Escape/backdrop และคืน focus ใช้ control กระชับกับรายละเอียดเปิดตามต้องการ

## Contract ที่ห้ามข้าม

- User/roles/scope permissions มาจาก server SessionContext; coordinator ต้อง assigned + same scope, staff scoped, executive read-only, student participant + scope; UI ซ่อนปุ่มไม่ให้สิทธิ์ API
- Mutation: Origin/CSRF; POST create/upload Idempotency-Key per user/route 24h (payload เดิม replay เดิม, ต่าง payload 409); PATCH/status If-Match `"<version>"` ขาด 428/เก่า 409. Server owns id/version/audit/recordedBy/status-on-create
- `CstuAuth.request` เติม `/api` เอง; `create(path,payload,key)`/`mutate(path,payload,version)` อยู่ main แล้ว หลัง refresh Session. status POST/ไฟล์ต้องต่อ helper ตาม contract ไม่ใช้ PATCH helper หรือ JSON parser กับ binary โดยผิดวิธี
- Validator ไม่ทดแทน permission/reference/assignee checks; production write ต้องรวม user/authzVersion/session expiry/revoke, target/parent/ref versions + scope และ idempotency กับ write ใน transactionเดียว. Memory lock ไม่รับรอง Lambda/DynamoDB atomicity
- Public/backup/search/count/expanded refs ใช้ allowlist ไม่คืน Contact/History/internal Agreement/user IDs/private objectKey หรือ names/count ของรายการที่ถูกซ่อน; protected relationshipsต้องตรวจทีละ referenceก่อนคืน
- Business topology/indexes/persistent adapter และ user selectorยังต้องตกลงก่อน production. ขาด schema/scope/rollback หรือ transport limits ให้หยุดขั้น deploy แล้วทำส่วน localที่ไม่พึ่งมันต่อ พร้อมระบุสิ่งที่รอ ห้ามเลือก AWS resourceจากชื่อเดา

## งานของ Issue นี้ตามลำดับ

1. ทำ scoped overview พร้อม basic counts/status/list ไม่เพิ่ม analytics/export/reporting V4
2. ต่อ GET overview route ที่ design เสนอ เพราะ gateway ปัจจุบันยังไม่ route /overview
3. filter role/scope/record และ non-personal projection ก่อน aggregate/count ห้ามคืน global totals
4. เปิด shared detail #94/#98/#104 read-only ไม่มี editor/admin actions และ contact/participant/personal docs ต้องถูกซ่อนที่ API
5. ใช้ role-menu/workspace view=executive เดิมและ states loading/empty/error พร้อม #111 filters

## จุดต่อและข้อมูล

Proposed GET /api/overview?scopeId=&entityType=&status=&startDate=&endDate= ตาม #92 ยังไม่ได้ implemented. executive GET scoped non-personal, POST/PATCH/status/upload denied.

## งานที่ต้องประสาน

[#80](https://github.com/Micosz/Cs361-Group1-Project7/issues/80), [#94](https://github.com/Micosz/Cs361-Group1-Project7/issues/94), [#98](https://github.com/Micosz/Cs361-Group1-Project7/issues/98), [#104](https://github.com/Micosz/Cs361-Group1-Project7/issues/104), [#111](https://github.com/Micosz/Cs361-Group1-Project7/issues/111), [#79](https://github.com/Micosz/Cs361-Group1-Project7/issues/79), [#92](https://github.com/Micosz/Cs361-Group1-Project7/issues/92). เจ้าของ form/CRUD อยู่กับ issueนั้น งานต่อช่อง/links/status/docs ต้องใช้จุดต่อร่วมไม่สร้างชุดซ้ำ

## Acceptance ที่ตรวจจริง

- [ ] authorized count/list/detail ไม่มี contact/participant identities/personal documents
- [ ] C1/C2 scopes and totals isolation
- [ ] direct POST/PATCH/status deniedแม้ไม่มีปุ่ม
- [ ] loading/empty/dependency failure ไม่ปลอม empty success

## วิธีตรวจและส่งงาน

ทำ tests เฉพาะพฤติกรรมสำคัญของงานนี้ไม่ซ้ำ implementation ไม่ลบ tests เดิมหรือผ่อน permission checks ให้ผ่าน เมื่อแก้ backend รัน suite เดิมด้วย:

```sh
python3 -m unittest discover -s backend/tests -v
npm test
git diff --check
```

ใช้ Python/dependencies ของโครงการ (`backend/requirements.txt`; CI Python 3.12) หากมีไฟล์ tests ของ feature อยู่แล้วให้ใช้ต่อ และรัน local mock auth checks เมื่อแก้ทาง auth/Session มีโค้ดอยู่ใน `tools/mock-auth`

สรุปให้ผู้ใช้: files/branch/base/head/PR, behavior ก่อน–หลัง, คำสั่งและผล tests, integrationที่ยังรอพร้อมเจ้าของ แยก static/local/mock/CI/HTTPS/AWS ไม่อ้าง deploy จาก tests ผ่าน เปิด Draft PR ตาม authorizationของผู้ใช้และขอ review จุดเชื่อม ไม่ปิด Issueจน acceptance/integrationจริงครบ ห้าม deploy/migrate/merge หรือส่งข้อความแทนผู้ใช้โดยอนุมานจากคู่มือนี้

## ข้อความส่งให้ AI

> ช่วยทำ Issue นี้ใน checkout ของโครงการที่ฉันเลือก อ่านคู่มือไฟล์นี้และ Issue/PR ล่าสุดก่อน ตรวจส่วนที่มีแล้วและทำเฉพาะส่วนที่ยังขาดตามขอบเขต ใช้ form/detail และ permission/Session ร่วมตามที่ระบุ ทำ commits เป็นช่วงและตรวจ tests ที่จำเป็น บอกจุดที่รอ integrationตามจริง หาก contract ขัดกันให้แสดงข้อขัดแย้งก่อนเปลี่ยนและทำส่วนอิสระต่อ อย่าเพิ่ม featureของ issueอื่นหรือ deploy/mergeเอง
