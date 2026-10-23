# V3 Release Evidence

รวมหลักฐานเดิมตามงานและวันที่ตรวจ ผลย้อนหลังไม่ได้ยืนยันบริการหรือ deployment ปัจจุบัน
สถานะก่อนและหลัง integration เก็บตามลำดับในแต่ละหัวข้อ; ให้อ่านผลวันที่ล่าสุดของงานนั้นประกอบ

หลักฐานบัญชีทดสอบบน AWS #81 อยู่ใน [ผลตรวจดิบ](assets/v3/course-test-login-81.json)

## เลือกอ่าน

- [หลักฐาน CI/CD Lambda — #120](#lambda-cicd-issue-120)
- [หลักฐานตรวจ #75 — 9 ตุลาคม 2026](#tu-auth-issue-75)
- [หลักฐานการตรวจการรวม #74–#80](#auth-integration-74-80)
- [หลักฐานตัวตรวจสิทธิ์ #79](#v3-permissions-issue-79)
- [เริ่มงาน #108–#111 — เมนูและหน้าร่วม](#shared-navigation-108-111)
- [รวมงาน #83–#86 — 13 ต.ค. 69](#workspace-83-86-integration)
- [95 — ส่วนประวัติกิจกรรมที่เริ่มได้](#partner-history-95)
- [96 Integration — 13 ต.ค. 69](#activity-96-integration)
- [ผลตรวจส่วนแยกของ #97 — 9 ตุลาคม 2026](#activity-links-issue-97)


<a id="lambda-cicd-issue-120"></a>

<a id="lambda-cicd-issue-120-หลักฐาน-cicd-lambda--120"></a>

## หลักฐาน CI/CD Lambda — #120

ตรวจวันที่ 8 ตุลาคม 2026 ใน `ReserveFolder`; branch `feature/120-lambda-cicd` จาก `main` commit `3df15f8` ไม่รวมงาน #78/#79 Scope ล่าสุดที่ผู้รับผิดชอบเลือกคือสาม functions และ deploy เฉพาะ source ที่เปลี่ยน

<a id="lambda-cicd-issue-120-source-และ-configuration-จริง"></a>

### Source และ configuration จริง

ใช้ Learner Lab credentials ที่ผู้รับผิดชอบให้เพื่อตรวจ AWS แบบ read-only พบ `fetchPartnersData`, `getPublicPartners`, `tuAuthLogin` ใน us-east-1; ชื่อ `fetchPartnerData` ไม่มีใน account ที่ตรวจ ทั้งสามใช้ Node.js 24, Zip, Handler index.handler และไม่มี layers

Source ใน Git เทียบกับ index.mjs ที่ดาวน์โหลดแล้วต่างเฉพาะ trailing whitespace ของสอง data functions และชื่อไฟล์ CommonJS ไม่มีการเปลี่ยน application logic; SHA-256 ด้านล่างเป็นของไฟล์ต้นฉบับ AWS:

| Function | SHA-256 ของ source file | Packaging |
| --- | --- | --- |
| fetchPartnersData | `8ff005e976e3276163c4de151ac9910eda4d407ce2360215e7c0ddd8ed47581b` | index.mjs เดิม |
| getPublicPartners | `0e249becac85157ac6befd958695de1db2d10bd2c327f7ddcfb89a750a628194` | เปลี่ยนเฉพาะชื่อจาก index.mjs เป็น index.cjs สำหรับ CommonJS |
| tuAuthLogin | `bb6787c6b4885c0fab7e66cb384315f77460c987e89fb74f821880cc31d67dc2` | index.mjs เดิม |

getPublicPartners มี mapping/CORS/query เดิม ไม่มีการเพิ่ม publication filter ใหม่ในงาน CI/CD นี้ ส่วน tuAuthLogin ไม่ได้เปลี่ยนการจัดการ Session/role หรือ TU credential logic

<a id="lambda-cicd-issue-120-ผลตรวจ"></a>

### ผลตรวจ

- Python packaging/selection tests ผ่าน 15 tests: root/CRC/source isolation/dependencies/unsafe files, full push range, multi-function selection, deletion และ shared-tool changes
- Actual Lambda source behavior ผ่าน Node tests 6 tests ด้วย AWS SDK/TU mocks ไม่มีคำขอฐานข้อมูลหรือ TU จริง
- git diff --check ผ่านหลังตัด trailing whitespace ของ source ที่นำเข้า; node --check ผ่านทั้งสามไฟล์; actual source ZIP ทั้งสามสร้างได้และมีเพียง handler file ที่ root
- actionlint 1.7.12 ตรวจ deploy/PR CI workflows ผ่าน; binary ตรวจ checksum จาก release ทางการ (`-shellcheck=` ไม่ได้อ้างผล shellcheck)
- YAML triggers/paths/matrix และ Bash syntax ของ run steps ตรวจในเครื่อง; frontend regression และ credential scan ดูผลสรุปใน PR
- หลังผู้รับผิดชอบอนุมัติ บันทึก repository Actions Secrets ทั้งสามค่าแล้ว ตรวจเฉพาะชื่อ ไม่แสดง secret values ใน logs/Git/PR

<a id="lambda-cicd-issue-120-aws-dryrun-จริง"></a>

### AWS DryRun จริง

เรียก `UpdateFunctionCode` ด้วย `DryRun=True` และ actual ZIP ทั้งสามสำเร็จ HTTP 200 ตรวจ CodeSha256, RevisionId, Runtime, Handler, Architectures และ Environment ก่อน/หลังไม่เปลี่ยน ไม่ได้เผยค่า environment ในหลักฐาน

ผลย่อที่ไม่มี credentials อยู่ใน [dry-run results](assets/v3/lambda-cicd-issue-120.json) การที่ AWS ยอมรับ dry-run ไม่ยืนยันว่า module load/handler/database/TU/API Gateway ทำงานจริง

<a id="lambda-cicd-issue-120-ส่วนที่ยังไม่ได้ทดสอบ"></a>

### ส่วนที่ยังไม่ได้ทดสอบ

**ไม่ได้ deploy หรือ invoke functions และไม่ได้ merge PR** จึงยังไม่มี GitHub Actions deployment run หรือ API smoke ของ commit นี้ ต้อง review/merge main ขณะ Lab/credentials พร้อม แล้วเก็บ run URL, Git SHA, CodeSha256 ราย function และผล API smoke ตาม [คู่มือ Deploy V3](../deployment/v3-deployment.md)

PR CI ใช้ mocks และไม่รับ AWS Secrets; credential expiration/renewal ยังเป็น manual ตาม Learner Lab ไม่ได้สร้าง IAM/OIDC/resources หรือเปลี่ยน AWS configuration


<a id="tu-auth-issue-75"></a>

<a id="tu-auth-issue-75-หลักฐานตรวจ-75--9-ตุลาคม-2026"></a>

## หลักฐานตรวจ #75 — 9 ตุลาคม 2026

<a id="tu-auth-issue-75-ตรวจในเครื่อง"></a>

### ตรวจในเครื่อง

- Node.js 24: `node --experimental-vm-modules tests/lambda-source.test.cjs` ผ่าน 8 tests ทั้งชุด (TU 5 กลุ่ม + data functions เดิม 3 กลุ่ม)
- TU fixtures ครอบคลุม student/employee, status false/string-true, type หาย/ไม่รู้จัก, malformed JSON/profile, Browser ส่ง role/type/userId, config หาย/URL ผิด, TU 401/403/400/5xx/429, network failure และ timeout ทั้ง fetch/body
- ตรวจการใช้ endpoint เดิมเมื่อไม่ตั้ง/ตั้งค่าว่าง `TU_AUTH_URL` และการ override URL ฝั่ง Server; URL นอก origin ยังถูกปฏิเสธ
- ตรวจ request headers/body, ไม่มี automatic retry, abort เมื่อ timeout, bounded Retry-After, ไม่มีค่า password/key/raw error ใน response/log ที่ทดสอบ
- `node --check backend/lambda/tuAuthLogin/index.mjs` และ `git diff --check` ผ่าน
- ใช้ packager เดิมกับ configuration สมมติ Node.js 24 / `index.handler` / Zip: ZIP root มีเพียง `index.mjs`, CRC และ source ตรงไฟล์ใน branch
- ตรวจ diff และไฟล์ที่เปลี่ยน ไม่ใส่ credentials จริง ไม่เปลี่ยน frontend, DynamoDB, IAM, API Gateway หรือ logic ของอีกสอง Lambdas

<a id="tu-auth-issue-75-ข้อจำกัดของหลักฐาน"></a>

### ข้อจำกัดของหลักฐาน

ทั้งหมดเป็น local static/mock validation ไม่มีการส่งรหัสผ่านหรือ key ไป TU จริง ไม่มีการ deploy/invoke Lambda, ตรวจ channel permission, อ่านค่า environment จริง หรือยืนยัน quota ของบัญชีทีม ไม่มีผลทดสอบ student/employee จริงหรือ end-to-end #74 → #76 → #78

<a id="tu-auth-issue-75-งานที่เหลือก่อนใช้งานจริง"></a>

### งานที่เหลือก่อนใช้งานจริง

1. เพื่อน Review branch และตรวจสิทธิ์ authentication ของ channel
2. ตั้ง `TU_APP_KEY` ฝั่ง Lambda; `TU_AUTH_URL` เป็นตัวเลือกและใช้ endpoint เดิมเมื่อไม่ตั้ง; timeout มากกว่า 8 วินาที; ปิด auth body logging
3. เชื่อม account-linking/Session/local rate limit ตาม #74/#76/#78/#90 โดยไม่ใช้ profile/role จาก Browser เป็นหลักฐาน
4. หลัง deploy ที่ได้รับอนุมัติ ทดสอบบัญชี student/employee ที่อนุญาตและกรณีผิดพลาด เก็บเฉพาะ HTTP/code/ผลที่ปกปิดตัวตน ไม่แนบ password/key/raw profile

ดูแนวทาง deploy และตรวจ #75 ใน [คู่มือ Deploy V3](../deployment/v3-deployment.md)


<a id="auth-integration-74-80"></a>

<a id="auth-integration-74-80-หลักฐานการตรวจการรวม-7480"></a>

## หลักฐานการตรวจการรวม #74–#80

ตรวจบน branch `codex/auth-integration` โดยรวมประวัติทั้งเจ็ด branches และแก้สัญญาที่ไม่ตรงกันก่อนเสนอ merge เข้า main

<a id="auth-integration-74-80-ตรวจแล้วในเครื่อง"></a>

### ตรวจแล้วในเครื่อง

- `python3 -m unittest discover -s backend/tests -q`: 70 tests ผ่าน รวม test integration ใหม่ 7 กลุ่มที่ใช้ provider/store จำลอง
- `npm test`: frontend ทั้ง 4 test files ผ่าน รวม auth client checks 3 กลุ่ม
- `python3 -m unittest discover -s .github/scripts -p 'test_*.py' -q`: 15 tests ผ่าน
- `node --experimental-vm-modules --test tests/lambda-source.test.cjs`: 8 tests ผ่าน
- Browser localhost: หน้า Browse แสดงข้อมูลสำรองได้, ลิงก์ Login เปิดฟอร์มได้, ส่งค่า placeholder แล้วแสดงข้อความยังไม่เปิดระบบยืนยันตัวตนตามเดิม ไม่มีการส่งบัญชี TU จริง
- Browser พบคำเตือน API ข้อมูลคู่ความร่วมมือตอบ HTTP 500 แล้วใช้ข้อมูลสำรอง เป็นเส้นทาง fallback เดิม ไม่ใช่การทดสอบว่า AWS API ปกติ
- Integration จำลองครอบคลุม Login→User/IdentityLink→Session→Logout, การ Login ซ้ำไม่คืนสิทธิ์, การแข่งขันสร้างบัญชี, employee provisional, Origin/CSRF/rate limit, scoped role management และ Session เก่าถูกปฏิเสธหลัง authzVersion เปลี่ยน

<a id="auth-integration-74-80-ยังไม่ได้ยืนยัน"></a>

### ยังไม่ได้ยืนยัน

ไม่ได้ deploy Python API, เปลี่ยน AWS, เรียก TU ด้วยบัญชีจริง หรือทดสอบ cookie/routing บน Amplify จริง ระบบใหม่ปิดไว้ด้วย frontend config และ backend environment gate และพัก automatic Lambda deployment ระหว่างเตรียม #81

แนวทาง deployment: [คู่มือ Deploy V3](../deployment/v3-deployment.md) การผ่าน CI เป็นหลักฐานระดับ source/mock เท่านั้น งาน deployment และ acceptance บน AWS ยังต้องตรวจใน #81


<a id="v3-permissions-issue-79"></a>

<a id="v3-permissions-issue-79-หลักฐานตัวตรวจสิทธิ์-79"></a>

## หลักฐานตัวตรวจสิทธิ์ #79

วันที่ 8 ตุลาคม 2026; baseline V3-B1; branch `79-permissions` ต่อจาก `78-session` commit `8f920db` ผลนี้เป็น local tests ด้วยข้อมูลจำลอง ไม่ใช่ Production/AWS/TU

<a id="v3-permissions-issue-79-ผลตรวจ"></a>

### ผลตรวจ

- Python 3.14.7: `python3 -m unittest discover -s backend/tests -q` ผ่าน 63 tests (เดิม #78 จำนวน 33 และ #79 จำนวน 30; policy matrix ตรวจหลายชุดย่อยภายใน test)
- `npm test` ผ่าน 44 tests ครบ 3 ไฟล์ของ frontend เดิม
- `git diff --check` ผ่าน
- CI กำหนด Python 3.12; ผล CI จริงให้ดู checks ใน draft PR ไม่อนุมานจาก local tests

<a id="v3-permissions-issue-79-กรณีที่ยืนยันใน-local"></a>

### กรณีที่ยืนยันใน local

| กลุ่ม | ผลที่ตรวจ |
| --- | --- |
| Session | missing/anonymous/tampered/expired/revoked ถูกปฏิเสธ ไม่มี fallback |
| Role/action | matrix ทุก business resource; no-role และ provisional ไม่มีสิทธิ์; executive/student ไม่มี write |
| Scope/record | บัญชี A/B, คนละหลักสูตร, createdBy ไม่ให้สิทธิ์, legacy ไม่มี owner ไม่เปิดสิทธิ์, mixed roles ไม่ยืม scope |
| Fields | role/server-owned/assignment/publication injection, unknown fields, coordinator แก้ public display fields ไม่ได้ |
| HTTP | list/detail/create/update/status ทุก business group, contact/history parent tamper, document upload/read/content, My Exchange หลายบทบาทยังใช้ participant projection |
| Data boundary | student/executive ไม่มี personal IDs/notes, metadata ไม่คืน objectKey/hash, raw nested objects ไม่หลุด, public flags ขัดกันและ orphan/internal partner ถูกตัด |
| Search/count/page | authorization/projection ก่อน q/count/page, ค้น internalNote ไม่เจอ, cursor ต่าง Session/query ใช้ไม่ได้ |
| Mutation | CSRF/Origin/If-Match/idempotency key ต้องผ่านก่อน side effect; test-only repository จำลอง role withdrawal/logout/assignment race แล้วไม่เขียน |
| DynamoDB | ตรวจโครงสร้าง user/session/parent checks และ target condition ไม่ได้ส่ง transaction ไป AWS |
| Errors | dependency ล้มเหลวให้ 503 ไม่มี secret จาก exception ใน response |

<a id="v3-permissions-issue-79-ข้อจำกัดของหลักฐาน"></a>

### ข้อจำกัดของหลักฐาน

Test-only repository อยู่ใน `backend/tests/test_permissions.py` เท่านั้น เพื่อทดสอบขอบเขต HTTP และจำลอง transaction races ไม่ใช่ implementation storage จริง ไม่ยืนยัน atomic guarantees ของ DynamoDB ที่ deploy อยู่ และไม่ได้ทดสอบ validation/transition/idempotency replay/file bytes ที่เป็นหน้าที่ feature adapters

Public projection ถูกทดสอบเป็นฟังก์ชัน ยังไม่ได้เชื่อม public Lambda/backup workflow เดิม API ธุรกิจที่ deploy อยู่จึงยังไม่ได้รับการรับรองจากงานนี้ ต้องทำ integration ตาม [คู่มือ #79](../../backend/permissions/README.th.md) และตรวจ HTTPS/Production ก่อนปิด issue


<a id="shared-navigation-108-111"></a>

<a id="shared-navigation-108-111-เริ่มงาน-108111--เมนูและหน้าร่วม"></a>

## เริ่มงาน #108–#111 — เมนูและหน้าร่วม

เริ่มจาก main `29df98451085426322f679845c4f7c8767122d2f` บน branch `108-shared-navigation` ปรับข้อความ GitHub เฉพาะ #108–#111 ตามคำขอ ไม่เปลี่ยน #80/#86 หรือปิดงานใด

<a id="shared-navigation-108-111-ใช้ได้ใน-branch-นี้"></a>

### ใช้ได้ใน branch นี้

- เมนูขวาบนเปิดตามชนิดข้อมูลแทนการแยกหน้า coordinator/staff; แสดงทางเข้าเพิ่มตาม grant และคง My Exchange/จัดการสิทธิ์เดิม
- `records.html?kind=partners|activities|agreements|exchanges` ใช้รายการ/รายละเอียดชุดเดียว ผ่าน protected API; รองรับ `id` เพื่ออ่าน detail ตรง โดย Backend ตรวจสิทธิ์จริง
- coordinator เห็นรายการที่ policy อนุญาตจาก assignment; staff ตาม scope; executive read-only ไม่มีปุ่มแก้ และ projection เดิมไม่คืนข้อมูลส่วนบุคคล
- Public Partner/Event detail มีจุดเปิดจัดการ เมื่ออ่าน protected record ได้และมีสิทธิ์แก้จริง; protected API ล้มเหลวไม่เพิ่มปุ่มและไม่ทำให้ public detail หาย
- `records.html?view=overview` นับจาก count ของ protected collections ที่จำกัดสิทธิ์แล้ว ใช้ limit=1 ไม่โหลดทุก record มานับ ไม่มี /overview route ใหม่
- #111 เพิ่ม query type (Partner/Activity), status (Agreement/Exchange), startDate/endDate ใน listing เดิม หลัง authorization + projection ก่อน filter/count/page; Activity เป็นวันจริง, Agreement/Exchange เป็นช่วงทับซ้อนรวมขอบ ขาดวันไม่ผ่านเมื่อกรองวัน ช่วงกลับ/ไม่ใช่วันจริง/ฟิลด์ไม่รองรับ ->422
- cursor ผูก Session/ชุดข้อมูลที่มีสิทธิ์/ทุกเงื่อนไขค้นหา ไม่ใช้ cursor เก่าข้ามเงื่อนไข; UI แยก empty/error/503 ไม่มี protected fallback/cache

<a id="shared-navigation-108-111-จุดต่อฟอร์มของเพื่อน"></a>

### จุดต่อฟอร์มของเพื่อน

หน้าอ่านพร้อมใช้กับ adapter ที่มีอยู่ แต่ฟอร์มเพิ่ม/แก้/สถานะ/เอกสารยังรอ #94/#96/#98/#100/#104/#106/#101–#103 ไม่มีฟอร์มหรือปุ่ม save จำลองแทนของจริง

เพิ่ม script ของ feature หลัง `work-navigation.js` ก่อน `records.js` ใน records.html แล้ว register เฉพาะ action ที่พร้อม เช่น:

```javascript
CstuWork.register('activities', {
  create: ({container, session, auth, reload}) => activityForm.openCreate({container, session, auth, reload}),
  edit: ({container, record, session, auth, reload}) => activityForm.openEdit({container, record, session, auth, reload})
});
```

`activityForm` เป็นตัวอย่างชื่อ adapter ไม่ใช่ฟังก์ชันที่มีแล้ว Handler ต้องใช้ grant/scope และ trusted record รุ่นล่าสุด, Session/CSRF/If-Match/Idempotency ของ CstuAuth และ API เดิม; callback ไม่ให้สิทธิ์เอง ผู้มีสิทธิ์เห็นปุ่ม disabled จน handler พร้อม การเปิดเพิ่มยังแจ้งฟอร์มไม่พร้อม ไม่ส่ง mutation

CstuWork.canEdit เป็น affordance เท่านั้น Backend #79 เป็นผู้ตัดสินจริง Handler ต้องไม่เขียนข้อมูล/สิทธิ์จาก browser อย่างเดียว

<a id="shared-navigation-108-111-ยังไม่ครบ--รอ-integration"></a>

### ยังไม่ครบ / รอ integration

- production business repository/topology/injection และหลักฐาน AWS/HTTPS; ถ้า adapter ไม่พร้อมตอบ503 ห้ามเอา mock ไป inject production
- form adapters จากเพื่อน รวมตัวเลือก/expanded references/assignment ที่ผ่านสิทธิ์ ไม่มี status/docs handlers พร้อมใน branch นี้
- executive overview ตอนนี้มี totals ตามชนิดเท่านั้น ยังรอสรุปแยกสถานะพื้นฐาน/aggregate routeตามข้อสรุป #110; /overview ใน design ยังไม่ได้ implement
- My Exchange ยังเปิด landing เดิม รอ #107; ไม่สร้างหน้าสมัครหรืออนุมัติ
- ทดสอบครบ coordinator/staff หลายscope การถอน assignment/role ระหว่างเปิดหน้า การแก้จริงและเอกสารหลัง adaptersพร้อมก่อนปิด #108–#111

<a id="shared-navigation-108-111-หลักฐาน"></a>

### หลักฐาน

backend 95 tests ผ่าน, frontend npm test 6 ไฟล์ผ่าน และ local mock server 3 tests ผ่าน; git diff --check ผ่าน

เบราว์เซอร์ localhost บัญชีสมมติ: staff เปิด Exchange 2 รายการใน cs-demo ไม่เห็นรายการ other-scope; ค้นหา exchange-other ไม่พบ; detail ใช้ปุ่มแก้/สถานะ/เอกสาร disabled ตามฟอร์มที่ยังไม่มี; executive เห็น2รายการ ไม่มีปุ่มเขียนและไม่มี supportingInfo/participant info; overviewนับตามขอบเขต; มือถือ390pxรายการ/ตัวกรองไม่ล้นจอ

ภาพชั่วคราว: /tmp/cs361-108-menu.jpg และ /tmp/cs361-111-mobile.jpg ผลนี้เป็น local/mock ไม่ใช่ deploy และไม่ติ๊ก acceptance ระบบจริง

<a id="shared-navigation-108-111-integration-update--13-ตค-69"></a>

### Integration update — 13 ต.ค. 69

ฟอร์ม Agreement/Exchange และเอกสารต่อกับเมนูร่วมแล้ว ภาพรวมมี count/status ตามสิทธิ์ผ่าน `/api/overview`; มี DynamoDB/S3 adapter ใน Python backend ดู [ผลตรวจและ config](#workspace-83-86-integration) สำหรับสถานะล่าสุด ผล local ผ่าน แต่ยังไม่ใช่ production acceptance


<a id="workspace-83-86-integration"></a>

<a id="workspace-83-86-integration-รวมงาน-8386--13-ตค-69"></a>

## รวมงาน #83–#86 — 13 ต.ค. 69

คง AgreementRepository, ExchangeRepository, validators, ฟอร์มและ tests ของเพื่อน
เติมจุดต่อ Workspace และ adapter บันทึกถาวรโดยไม่แก้โค้ดโดยตรงบน main

<a id="workspace-83-86-integration-ผลที่ตรวจ"></a>

### ผลที่ตรวจ

- Backend 160 tests รวม 4 integration tests สำคัญ: บันทึก/อ่านกลับข้าม adapter instance,
  retry ไม่สร้างซ้ำ, version เก่าถูกปฏิเสธ, เอกสาร participant, ถอนผู้เข้าร่วม,
  reference เปลี่ยนระหว่างเขียน, ถอนบทบาทระหว่าง upload และเก็บกวาดไฟล์ที่แนบไม่สำเร็จ
- npm test ผ่านทั้ง 8 ไฟล์เดิม/ฟอร์ม/เมนูร่วม; HTTP localhost smoke 3 tests ผ่าน
- เบราว์เซอร์ localhost: staff สร้าง Agreement, เปิดรายละเอียด, แนบ PDF และเห็น metadata อ่านกลับ;
  สร้าง Exchange ผ่านฟอร์มเดิมของเพื่อนและกลับหน้ารายการที่บันทึกแล้ว
- ทุกผลข้างต้นเป็น local/test doubles ของ AWS ไม่ใช่หลักฐาน deployment หรือ S3/DynamoDB จริง

<a id="workspace-83-86-integration-เปิดใช้บน-aws"></a>

### เปิดใช้บน AWS

Python handler เดิม `backend.lambda_function.handler` จะต่อ business adapter เมื่อกำหนด
`BUSINESS_TABLE`; ไม่ตั้งค่าแล้ว API business ยังตอบ 503 ตามเดิม ไม่ใช้ memory repository บน Lambda

1. ใช้ตาราง business แยกจาก auth tables: partition key `id` String,
   GSI `scope-entity-id` (หรือชื่อใน `BUSINESS_SCOPE_INDEX`) มี partition key `scopeEntity` String
   และ sort key `id` String, projection KEYS_ONLY; เปิด TTL `ttl` สำหรับ retry records
2. กำหนด `BUSINESS_TABLE`, `BUSINESS_SCOPE_INDEX`, `DOCUMENT_BUCKET` ใน Lambda เดิม
   ร่วมกับ config auth/session ที่มีอยู่; tables และ bucket ต้องอยู่ region เดียวกับ client
3. Bucket ต้องเปิด BlockPublicAcls, IgnorePublicAcls, BlockPublicPolicy,
   RestrictPublicBuckets ทั้งหมด และไม่เผยแพร่ URL สาธารณะ
4. Service role ต้องมี DynamoDB GetItem/Query (รวม index)/TransactWriteItems
   ใน business/user/session tables และ S3 GetBucketPublicAccessBlock/GetObject/PutObject/DeleteObject
   เฉพาะ bucket/prefix documents; ไม่ส่ง credentials ไป browser
5. Package Python backend พร้อม dependencies ใน backend/requirements.txt ลง Lambda auth ตัวเดิม
   workflow Node Lambda เดิมไม่ได้ deploy Python backend นี้ ไม่เปิด deployment อัตโนมัติแทนทีม
6. หากย้าย Partner/Activity จาก V2 ให้ใช้ mapping ที่ยืนยัน scope/ID/visibility/เจ้าของตาม
   docs/design/v3-design.md; ไม่เดาผู้รับผิดชอบจากชื่อและไม่ overwrite V2
7. ตรวจ same-origin API route, create → detail → edit → status → upload → download,
   student A/B, executive read-only และ logout บน HTTPS จริงก่อนปิด acceptance Issues

GSI ใช้หาผู้สมัครรายการเท่านั้น ทุก record อ่านซ้ำแบบ strongly consistent ก่อนตรวจสิทธิ์;
รายการที่เพิ่งสร้างอาจรอ GSI ตาม eventual consistency แต่ detail อ่านตรงด้วย id ได้ทันที
การเขียนตรวจ user/session/target/parent/reference versions พร้อม transaction;
ถ้าจำนวน checks เกิน 100 จะปฏิเสธ 422 TOO_MANY_REFERENCES ก่อนเขียน

ไฟล์จำกัด 3 MiB ให้พอดี Lambda buffered request/response ที่ต้องมี base64 และ envelope
(เปลี่ยนจากเป้าหมาย 10 MiB ใน ADR เดิม; ยังไม่ได้ใช้ Lambda response streaming จริง):
[AWS Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html).
ดาวน์โหลดผ่าน authenticated API ทุกครั้งและบังคับ attachment; ไม่มี presigned/public URL
คำขอใหม่หลังถอนสิทธิ์ถูกตรวจใหม่ แต่ bytes ที่เริ่มส่งแล้วเรียกกลับไม่ได้

S3 และ DynamoDB ไม่ใช่ transaction เดียวกัน: upload ก่อน commit metadata และลบ object
เมื่อ commit ล้มเหลวแน่ชัด หาก timeout ต้องอ่าน metadata ยืนยันก่อนลบ;
กรณี process หยุด/การลบล้มเหลว ให้ผู้ดูแลเทียบ objectKey กับ metadata แล้วเก็บกวาดเฉพาะ
objects ที่ไม่มี metadata และอายุมากกว่า 24 ชั่วโมง ห้ามลบไฟล์ที่มี record พร้อมใช้งาน

<a id="workspace-83-86-integration-ทดลองในเครื่อง"></a>

### ทดลองในเครื่อง

```bash
python -m pip install -r backend/requirements.txt
python tools/mock-auth/server.py --workspace --port 8765
```

เปิด http://127.0.0.1:8765/login.html บัญชี staff/coordinator/student-a/student-b/executive
ใช้รหัสผ่าน `mock`; Partner จำลองใช้ `partner-demo` ข้อมูลทั้งหมดจำลองและ reset เมื่อ restart
บัญชี/ไฟล์จริงไม่ใช้ในเครื่องทดสอบนี้

<a id="workspace-83-86-integration-ข้อจำกัดที่ตรวจพบในรอบนี้"></a>

### ข้อจำกัดที่ตรวจพบในรอบนี้

เครื่องไม่มี AWS credentials และ repository variable `LAMBDA_DEPLOYMENT_PAUSED=true`
จึงยังไม่ได้ตั้ง resources/config, deploy Python Lambda หรือยืนยัน production acceptance
ให้คง Issues ที่เกี่ยวข้องเปิดจนผ่านขั้นตอน AWS/HTTPS ข้างต้น


<a id="partner-history-95"></a>

<a id="partner-history-95-95--ส่วนประวัติกิจกรรมที่เริ่มได้"></a>

## #95 — ส่วนประวัติกิจกรรมที่เริ่มได้

เริ่มจาก main `29df98451085426322f679845c4f7c8767122d2f` บน branch `95-partner-history` ไม่เปลี่ยน body/checklist ของ Issue และไม่ปิด #95

<a id="partner-history-95-ทำแล้ว"></a>

### ทำแล้ว

- รายละเอียด Partner ใช้รายการกิจกรรมสาธารณะเดิม แสดงประวัติเรียงวันใหม่ไปเก่า วันเดียวกันเรียง ID คงที่และไม่ซ้ำ ไม่มีวัน/วันผิดอยู่ท้าย ไม่เดาวันจากข้อความ
- กดชื่อเปิด Activity detail เดิม ปุ่มรองรับคีย์บอร์ด ชื่อรายการใหม่ใช้ textContent
- ใช้ primary partnerId หรือ coHostPartnerIds เท่านั้น ไม่ใช้ชื่อผู้จัดร่วมที่คล้ายกันเป็นหลักฐานความสัมพันธ์ในประวัติ การ browse/filter เดิมยังใช้พฤติกรรมเดิม
- รับ period_date แบบ public เดิมและ periodDate สำหรับรายการ Activity ที่ผ่าน public projection ในอนาคต ปฏิเสธ flags ที่ขัดกัน/ไม่มีการเผยแพร่และ entityType ที่ไม่ใช่ activity
- ไม่มีกิจกรรมแสดงข้อความชัดเจน การโหลดผิดพลาดยังใช้สถานะ error ของ detail เดิม

<a id="partner-history-95-จุดต่อหลังเพื่อนพร้อม"></a>

### จุดต่อหลังเพื่อนพร้อม

- #94: ย้ายส่วนแสดงประวัติไปใช้ใน protected Partner detail ร่วมเมื่อมี UI จริง
- #96/#97: ต่อข้อมูลจริงและ stable coHostPartnerIds หลังตรวจสิทธิ์/reference และ mapping เดิม อย่าเดา ID จาก co_hosts
- #98/#99: ข้อตกลงต้องมาจาก authorized API ใช้ startDate และ Agreement detail เดิม ไม่อ่าน protected Agreements จาก public cache/backup หรือส่งเข้า buildPartnerActivityHistory
- helper ปัจจุบันคืน sourceId/kind/label/date/dateLabel แยกจาก renderer เป็นจุดเริ่มสำหรับรวมรายการที่ผ่าน authorization ภายหลัง ต้องเพิ่มการเปิด Agreement detail และกรองสิทธิ์ก่อนรวม/เรียง/pagination/count ฝั่ง server
- Issue #95 และ #91/#92 เดิมยังมี standalone history GET/POST/PATCH งานนี้ยังไม่ได้ทำช่องเพิ่ม/แก้หรือเปลี่ยน contract ดังกล่าว ให้ตกลง integration หลังงานที่เกี่ยวข้องพร้อมตามที่ผู้ใช้ขอ ไม่ลบ route/model เดิม

<a id="partner-history-95-ตรวจแล้ว"></a>

### ตรวจแล้ว

`npm test` ผ่านทั้ง 6 ไฟล์ รวม 3 tests สำคัญใหม่: การเรียง/วันที่/ซ้ำ, public+stable relationship IDs, การแสดงข้อความปลอดภัย+เปิด detail+empty state; `git diff --check` ผ่าน

เปิดเว็บ localhost ในเบราว์เซอร์จริง: Partner NVIDIA แสดง 9 ก.ค. 69 และชื่อกิจกรรม กดแล้วเปิด Activity detail พร้อมลิงก์หลักฐานเดิม ภาพตรวจอยู่ `/tmp/cs361-95-partner-history.jpg` (ไฟล์ชั่วคราวในเครื่อง)

ยังไม่ได้รวม main/deploy หรือยืนยัน business storage/API/สิทธิ์ภายในบน AWS งานนี้เป็นส่วน public activities ของ #95 เท่านั้น

<a id="partner-history-95-integration--13-ตค-69"></a>

### Integration — 13 ต.ค. 69

ต่อ history GET/POST/PATCH ใน shared Partner detail และ DynamoDB transaction adapter แล้ว
ประวัติภายในเรียง occurredOn ใหม่ไปเก่า ตามด้วย createdAt ใหม่ไปเก่า และ id เมื่อเวลาเท่ากัน
ฟอร์มเหตุการณ์เลือก reference จากรายการที่ตรวจสิทธิ์และ scope แล้ว การอ่านคืน reference เฉพาะที่อ่านได้
ข้อมูลประวัติภายในไม่ถูกเพิ่มลง public history/backup

ตรวจเพิ่ม 2 integration tests: เขียน/อ่านกลับ/เรียง/แก้/วันที่ผิด/deny และ reference/parent-version race
เป็น local AWS doubles; configuration และ production acceptance ยังใช้ข้อจำกัดใน workspace-83-86-integration.md


<a id="activity-96-integration"></a>

<a id="activity-96-integration-96-integration--13-ตค-69"></a>

## #96 Integration — 13 ต.ค. 69

คง ActivityRepository, validators, ฟอร์ม HTML และ tests ของเพื่อน
ย้ายเฉพาะ Activity JS ไป activity-workspace.js เพื่อไม่ชนตัวแปรของ Exchange
หน้าร่วมเปิดฟอร์มเดิมผ่าน activity-adapter.js และ durable adapter ใช้ ActivityRepository เตรียมข้อมูลก่อน transaction

เพิ่มการตรวจ role ตาม scope, pagination, retry key ตาม payload และปุ่มโหลดข้อมูลล่าสุดหลัง 409 โดยไม่ทับค่าที่กรอกทันที
ช่องว่างส่งค่าล้างได้ แต่เมื่อ API ยังไม่ยืนยันความสัมพันธ์ครบ ฟอร์มจะไม่ส่ง arrays เดิมทิ้งโดยไม่ตั้งใจ
การอ่าน/ตัวเลือกความสัมพันธ์ต่อใน #97 ไม่สร้างฟอร์ม Agreement ซ้ำ

Backend 176 tests และ npm test ทั้ง 10 ไฟล์ผ่าน รวมการเขียน/อ่านกลับ/แก้/มอบหมาย/ถอนผู้รับผิดชอบผ่าน shared transaction adapter
เป็น local AWS doubles ไม่ใช่ production deployment ดู workspace-83-86-integration.md สำหรับ config และข้อจำกัด AWS


<a id="activity-links-issue-97"></a>

<a id="activity-links-issue-97-ผลตรวจส่วนแยกของ-97--9-ตุลาคม-2026"></a>

## ผลตรวจส่วนแยกของ #97 — 9 ตุลาคม 2026

Branch: `97-Activity-Links` จาก main `2fc1d29`

<a id="activity-links-issue-97-ผลที่ตรวจแล้ว"></a>

### ผลที่ตรวจแล้ว

`python3 -m unittest discover -s backend/tests -p 'test_activity_links.py' -v` ผ่าน 5 tests:

1. แผน link/read/unlink หลาย partner และ agreement=[] โดยไม่แก้ input หรือลบ partner/agreement
2. ไม่รับ IDs ซ้ำ/ว่าง/หาย/ผิดประเภท/ผิด scope/ไม่มีสิทธิ์ รวม relationship patch ที่ส่ง server-owned fields
3. ตรวจสิทธิ์ target/public-facing edits และซ่อน unreadable agreement labels
4. Public ไม่มี agreement IDs/ชื่อ/count และไม่เรียกอ่าน agreement เลย; primary ไม่เผยแพร่ถูกตัดออก; dependency failure ไม่กลายเป็น empty success
5. ตรวจ partnerId และ co_hosts ของกิจกรรมใน public/data/partner-data-backup.json ทุกตัว: คง primary ID เก็บชื่อเป็น legacyCoHostNames ไม่เดา ID และไม่เปลี่ยน snapshot

ตัวอย่างก่อน/หลังและการเชื่อมต่ออยู่ใน [คู่มือ](../../backend/relationships/README.th.md)

`git diff --check` ผ่าน; ไม่มี dependencies หรือ credentials ใหม่

<a id="activity-links-issue-97-ขอบเขตหลักฐาน"></a>

### ขอบเขตหลักฐาน

Tests ใช้ storage/policy doubles ไม่มี HTTP route จริง ไม่มี #79 runtime integration ไม่มี form/detail UI ใหม่ ไม่มี AWS/DynamoDB transaction หรือ migration/deployment ไม่ได้ใช้ CloudShell เพราะส่วนที่ทำเป็นโมดูลไม่แตะ infrastructure

ยังต้องให้ #94/#96/#98 ต่อ candidate options/form/storage และ #79 ต่อ permission/projection/transaction checks ตามคู่มือ ก่อนตรวจ Acceptance Criteria แบบ end-to-end หรือปิด Issue

<a id="activity-links-issue-97-integration--13-ตค-69"></a>

### Integration — 13 ต.ค. 69

ต่อ plan_patch เข้ากับ durable Activity mutation และ transaction guards แล้ว
internal_links ใช้ trusted SessionContext/strong repository read ก่อนคืน labels/IDs;
เมื่อความสัมพันธ์เดิมอ่านไม่ได้ API ไม่คืน ID/ชื่อ และฟอร์มไม่ส่ง partial arrays ทับลิงก์เดิม
public_projection ใช้ public_links ซึ่งไม่อ่าน Agreements และคง activity_tags=[mou] ที่ตรวจรูปแบบแล้ว

ตัวเลือกใช้ protected lists ที่กรอง scopeId ฝั่ง server ก่อน count/pagination และฟอร์ม #96 เดิม
รายละเอียดกิจกรรมเปิด AgreementComponent เดิม ไม่มีฟอร์มข้อตกลงใหม่
เลือกถอด coHostPartnerIds/agreementIds ทั้งหมดได้โดยไม่ลบ records ต้นทาง

ตรวจรวม: backend 183 tests, npm test 10 ไฟล์, HTTP localhost smoke 3 tests และ git diff --check ผ่าน
เพิ่มเฉพาะ 2 integration tests สำคัญ: hidden references/unlink/no-delete และ scoped options/invalid refs/transaction race
แก้ fixtures ของ tests เดิมให้มี primary partner และไม่ใช้ primary ซ้ำเป็น co-host; คง assertions เรื่อง privacy/filters ไว้

เบราว์เซอร์ localhost ตรวจบันทึก History, สร้าง Agreement/Activity, เลือกข้อตกลงจาก options,
อ่านความสัมพันธ์กลับ, เปิด Agreement detail เดิม และถอดความสัมพันธ์จากฟอร์มแล้วอ่านกลับ
แก้การ refresh เมื่อ focus ให้ตรวจ Session โดยไม่ปิดรายละเอียด/ฟอร์มที่กำลังใช้งาน

ผลทั้งหมดเป็น local AWS doubles ยังไม่ได้ deploy/ตรวจ AWS HTTPS เพราะข้อจำกัดเดิมใน workspace-83-86-integration.md
Legacy primary IDs/co_hosts คง source เดิมและไม่เดา co-host IDs; การ migrate จริงยังต้องยืนยัน mapping/scope ตาม ADR



<a id="verification"></a>

<a id="verification-v3-b1-baseline-verification"></a>

## V3-B1 baseline verification

ตรวจวันที่ **8 ตุลาคม 2026 (Asia/Bangkok)** สำหรับ #72/#66/#90/#91/#92/#93

<a id="verification-ตรวจอะไรแล้ว"></a>

### ตรวจอะไรแล้ว

1. **Source/evidence pass:** อ่าน issue bodies ทั้ง 6 งาน, #82/#94–#111, Role Diagram จริงใน PR #67, V2 ADR/data docs, script reconstruction, old migration script และ backup snapshot; inventory จริง 26 records, primary refs ไม่ orphan, IDs ไม่ซ้ำ กิจกรรมทั้ง 13 มี period_date ไม่สรุป production schema จาก snapshot
2. **Design consistency pass:** เทียบ Matrix กับ field/route permissions, student read-only vs participants, executive no-personal/write, staff scope, role-manager capability แยกจาก staff; ทุก write ใช้ Origin/CSRF/field allowlist และ version validation แยกการสร้าง scope กับการแก้ scope
3. **Requirement coverage pass:** เติม MoU/MoA enum, history create/edit/order/ref validation, activity/co-host/agreement cardinality, responsible/participant account links, agreement renewal/status, exchange transitions/supportingInfo, document audience และ role workspaces ตาม implementation issues ที่มีอยู่
4. **Document/artifact pass:** ตรวจ relative links, fenced JSON examples parse ได้, inventory hash/count ตรง source, decision B1–B7 และ acceptance A01–A12 ไม่ซ้ำ, ไม่มี conflict markers/trailing whitespace; ดู machine summary ใน [validation.json](assets/v3/design/validation.json)

<a id="verification-สิ่งที่เลือกให้ทั้งชุดใช้ตรงกัน"></a>

### สิ่งที่เลือกให้ทั้งชุดใช้ตรงกัน

| Concern | Baseline rule |
| --- | --- |
| บทบาท/scope | grant + curriculum + responsibility/participant intersection; deny by default; ไม่เชื่อ role จาก frontend |
| Identity | local UUID + verified provider link; provisional no-role เท่านั้น; name/email ไม่ให้สิทธิ์ |
| Session | opaque cookie, idle30m/absolute8h, authzVersion check/revoke, same-origin routing ต้องพิสูจน์ |
| Writes | body allowlist, record version, field-level permission และ authz recheck at commit |
| Public | allowlist/compatibility DTO + public-only backup; contacts/users/docs ไม่ export |
| Dates | Public activity day inclusive; agreement/exchange interval overlap; พ.ศ. เฉพาะ presentation |
| Documents | inherited parent+audience, private backend stream; student download own participant files ไม่มี upload |
| Legacy | stable IDs, explicit-public normalization, responsible=[]/unverified identity ไม่เปิดสิทธิ์ |

<a id="verification-ไม่ได้ตรวจหรือทำในงานนี้"></a>

### ไม่ได้ตรวจหรือทำในงานนี้

- ไม่มี V3 runtime/Session/TU Login implementation จึงไม่มีผลทดสอบ allow/deny จริงสำหรับ A01–A12
- ไม่ใช้ credentials, ไม่ยืนยัน TU endpoint/key/quota/immutable ID จากบริการจริง, ไม่แก้ AWS/config/IAM/storage
- ไม่รัน migration, ไม่พิสูจน์ deployment proxy/cookie/file-size support, ไม่ทำ production smoke ใหม่
- ไม่อ้างว่าผู้ใช้หรือทีมอ่านรายละเอียดแล้ว ผู้ใช้ขอชุด baseline เพื่ออ่านภายหลัง เก็บ decision choices แยกจาก provider/runtime gates ใน [index](../design/v3-design.md#design-baseline)

**ผล:** เอกสารพร้อมใช้เป็น V3-B1 design baseline และส่งต่อ implementation; การปิด Issues ชุดออกแบบหากดำเนินการหมายถึงส่งมอบ baseline ตามคำขอ ไม่ใช่การอนุมัติ production deployment หรือปิด gates ที่ยังค้าง
