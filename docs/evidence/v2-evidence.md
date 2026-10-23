# V2 Release Evidence

รวมหลักฐานเดิมตามงานและวันที่ตรวจ ผลย้อนหลังไม่ได้ยืนยันบริการหรือ deployment ปัจจุบัน
สถานะก่อนและหลัง integration เก็บตามลำดับในแต่ละหัวข้อ; ให้อ่านผลวันที่ล่าสุดของงานนั้นประกอบ

## เลือกอ่าน

- [V2 search performance fix and verification](#v2-search-verification)
- [V2 evidence and architecture review — Issue #88](#v2-review-issue-88)
- [V2 follow-up and V3 prerequisites — Issue #89](#v2-follow-up-issue-89)


<a id="v2-search-verification"></a>

<a id="v2-search-verification-v2-search-performance-fix-and-verification"></a>

## V2 search performance fix and verification

ตรวจวันที่ 3 ตุลาคม 2026 (Asia/Bangkok) บน checkout ที่เริ่มจาก `47c503e` ซึ่ง Git status สะอาด ไม่พบ `AGENTS.md` ใน repository หรือโฟลเดอร์แม่ งานนี้ไม่มี commit, push หรือ deploy

<a id="v2-search-verification-changes"></a>

### Changes

- `assets/script.js`: แชร์ Promise ของ API request ที่กำลังโหลด และ cache เฉพาะ snapshot ที่โหลด/ประกอบข้อมูลสำเร็จในหน่วยความจำของหน้าเว็บ ทุกส่วนยังอ่านข้อมูลจาก API/DynamoDB ไม่มี JSON fallback หรือ persistent storage
- หาก HTTP, network, JSON parsing หรือรูปแบบ response ล้มเหลว จะล้าง Promise เพื่อให้ลองใหม่ได้ โดยไม่ cache `[]` จาก error ส่วน response ที่สำเร็จและเป็น `[]` ถือเป็นข้อมูลที่ถูกต้องและ cache ได้ การ์ดและ modal แสดงข้อความให้กด Search หรือเปลี่ยน filter เพื่อลองใหม่; suggestions ซ่อน และ hero ticker เริ่มได้เมื่อโหลดสำเร็จภายหลัง
- `handleSearch()` ส่งคำค้นผ่าน `setBrowseKeyword()` การพิมพ์ debounce 250 ms; Search ยกเลิก timer และทำงานทันที; ล้างคำค้นคืนรายการตามประเภทที่เลือกไว้
- suggestions ใช้ version และตรวจคำค้นอีกครั้งหลัง await ผลเก่าจึงไม่เขียนทับคำค้นใหม่ หรือเปิด dropdown หลังเลือกผล กด Search เปลี่ยน filter หรือคลิกนอกพื้นที่ การปิด dropdown ระหว่าง debounce ยังให้การค้นหาการ์ดทำงานต่อ
- การ์ดสร้าง HTML ด้วย `map().join('')` และเขียน container ครั้งเดียวต่อ render รวมถึงกรณีไม่พบข้อมูล รักษา `collaboratorRenderVersion` และ `eventRenderVersion`
- รักษา visibility convention ของ data access เดิม: `public` หรือไม่มี visibility แสดงได้; visibility ที่ระบุค่าอื่นไม่แสดง รวมถึงการค้นหาจาก ID, hero และกิจกรรมใน modal
- รักษาการผูกกิจกรรมกับเจ้าภาพหลักและ `co_hosts` รวมถึงการตัด ID ซ้ำ โดยคง `partnerId` จาก API แม้ co-host จะอยู่ก่อนเจ้าภาพหลักในรายการ เพื่อให้ related activities อ้างอิงเจ้าภาพถูกต้อง
- `index.html`: เปลี่ยนเฉพาะ input/button handlers ไม่แก้ CSS หรือ layout
- `tests/search.test.js` และ test script ใน `package.json`: เพิ่มชุดทดสอบด้วย Node built-ins ไม่เพิ่ม dependencies

<a id="v2-search-verification-search-rule"></a>

### Search rule

เลือกค้นจาก `name` ขององค์กรและ `title` ของกิจกรรมตาม [ข้อกำหนด V2](../architecture/v2/ADR-001-v2-hosting.md) ที่ระบุการค้นหาด้วยชื่อ และตามกฎ Browse ที่มีอยู่ ใช้ `filterBrowseRecords()` ร่วมกันทั้ง suggestions และการ์ด รวมถึง filter ประเภทของแต่ละส่วน การค้นหาไม่แยกตัวพิมพ์ใหญ่/เล็กและ trim ช่องว่าง Suggestions ยังแสดงสูงสุด 6 รายการ

ดังนั้น summary, location, partnerName และ co_hosts ไม่ใช่ฟิลด์ค้นหา แต่ยังแสดงในข้อมูล/รายละเอียดตามเดิม วิธีนี้ทำให้รายการแนะนำไม่แสดงผลที่การ์ดค้นไม่พบ และไม่ขยายขอบเขตฟีเจอร์

<a id="v2-search-verification-automated-verification--mocked-apidomtimers"></a>

### Automated verification — mocked API/DOM/timers

รัน `npm test` และตรวจรายกรณีด้วย `node --test --test-isolation=none tests/search.test.js` บน Node v24.18.0: **20 tests ผ่านทั้งหมด** รวมถึง:

- เปิดหน้าและโหลดการ์ดสองส่วน/hero พร้อมกัน: API request เดียว, DOM write ของแต่ละ grid ครั้งเดียว, ticker interval เดียว
- หลังสำเร็จ ค้นหา/filter/modal/ticker ไม่ส่ง request เพิ่ม; หน้าใหม่โหลด API ใหม่ด้วย `cache: 'no-store'`
- คำค้นทำงานร่วมกับประเภท, suggestions/การ์ดใช้กฎเดียวกัน, rapid typing รอครบ 250 ms, Search ทำงานทันทีและยกเลิก debounce
- ล้างคำค้นขณะที่ API ยังรออยู่แล้วคืนประเภทที่เลือกไว้; ผลเก่าของ suggestions และ render การ์ดทั้งสองส่วนไม่ทับผลใหม่
- การคลิกนอกพื้นที่ กด Search เลือก suggestion และเปลี่ยน filter ป้องกันผลที่รออยู่เปิด dropdown อีกครั้ง รวมถึงปิดก่อน debounce
- public/private visibility, ID lookup, co-host ที่อยู่ก่อนเจ้าภาพหลัก, related activities และ modal
- HTTP 503, network rejection, invalid JSON และ invalid response shape: UI จัดการ error และ Search ครั้งถัดไปโหลดสำเร็จ; successful empty array cache ได้

ผ่าน `node --check assets/script.js` และ `git diff --check` ด้วย

<a id="v2-search-verification-browser-and-real-api-verification"></a>

### Browser and real API verification

ใช้หน้าเว็บจากไฟล์ repository ที่ให้บริการผ่าน localhost และ API จริง:
`https://eb49u61kph.execute-api.us-east-1.amazonaws.com/default/fetchPartnersData`

ใช้ wrapper นับ `fetch` และ `unhandledrejection` เฉพาะในหน้า verification ชั่วคราวจาก `/tmp` ซึ่งส่งคำขอไป API จริง ไม่แทน API ด้วย fixture และไม่ใส่ wrapper หรือ UI ตัวนับลง repository

- หน้าใหม่: 13 องค์กร, 13 กิจกรรม, hero ทำงาน; **1 request สำเร็จ**
- ค้น `KBTG`: การ์ดองค์กรและ `KBTG University Roadshow` ตรงกับ suggestions
- เลือก university ร่วมกับ `KBTG`: ไม่พบองค์กร; ล้างคำค้นแล้วได้มหาวิทยาลัย 4 รายการและ filter ยังเป็น university; ปุ่มล้าง filter ใช้ได้
- พิมพ์ `K` → `KB` → `KBTG` แล้วกด Search: แสดง KBTG และซ่อน suggestions
- เลือก suggestion ของ KBTG: modal แสดงกิจกรรมที่เกี่ยวข้องทั้งสหกิจศึกษาและ Roadshow
- Reload หลังแก้ไฟล์ล่าสุด: มี API request ใหม่ 1 ครั้งในหน้าใหม่; ค้น `Spark` และเลือก suggestion: modal แสดง `CSTU Spark Camp in AI` และ `AGICAFET และ Embedded LLM`
- เลือก research ร่วมกับ `Spark`: ไม่พบกิจกรรม; เปลี่ยนเป็น event: พบ Spark Camp; เปลี่ยนคำค้นเป็น `Spa` และคลิกนอกพื้นที่: การ์ดยังตรงคำค้นและ dropdown ไม่กลับมา
- หลัง interaction ทั้งหมดในแต่ละหน้า: ตัวนับยังเป็น **1 request, 1 success, 0 failure, 0 unhandled rejection**; browser console ไม่มี error/warning ที่ตรวจพบ

การเรียก API จริงโดย curl หนึ่งครั้งได้ HTTP 200, 26 records, 27,840 bytes; total **1.160581 s**, time to first byte **0.897548 s** ส่วน browser wrapper วัดเวลาจนได้รับ response headers ได้ **684 ms** ในรอบแรก และ **496 ms** หลัง reload ค่านี้ไม่ได้รวม JSON parsing/render และเป็นตัวอย่างเพียงสองรอบ ไม่ใช่ benchmark ระยะยาว

<a id="v2-search-verification-limits"></a>

### Limits

ข้อมูล cache อยู่จนปิดหรือ refresh หน้า การแก้ DynamoDB ผ่าน AWS Console ระหว่างที่หน้ายังเปิดอยู่จะไม่ปรากฏอัตโนมัติ Refresh จะส่งคำขอ API ใหม่และรับ snapshot ใหม่จาก API; ไม่มี background refresh ในงานนี้

กรณี failure และการจัดลำดับผลเก่าถูกทดสอบด้วย mock เพื่อควบคุม timing อย่างแน่นอน ไม่ได้ทำให้บริการ AWS จริงล้มเหลว ผลจริงเป็น frontend ที่รันบน localhost ไม่ใช่ Amplify deployment ใหม่ และไม่มีโค้ด backend หรือ telemetry สำหรับสรุปสาเหตุความช้าของ Lambda/DynamoDB


<a id="v2-review-issue-88"></a>

<a id="v2-review-issue-88-v2-evidence-and-architecture-review--issue-88"></a>

## V2 evidence and architecture review — Issue #88

ตรวจวันที่ **8 ตุลาคม 2026 (Asia/Bangkok)** สำหรับ [#88](https://github.com/Micosz/Cs361-Group1-Project7/issues/88)

<a id="v2-review-issue-88-ข้อสรุป"></a>

### ข้อสรุป

Public frontend ปัจจุบันยัง Browse, Search, Filter และเปิดรายละเอียดได้ผ่านข้อมูลสำรอง แต่ API จริงตอบ **HTTP 500** ในรอบตรวจนี้ จึงยังยืนยันการอ่าน DynamoDB ล่าสุดไม่ได้ ไม่สรุปว่า Learner Lab ปิดหรือ Lambda เสียจาก HTTP status เพียงอย่างเดียว

เอกสาร [search verification วันที่ 3 ต.ค.](#v2-search-verification) เป็นหลักฐานย้อนหลังที่ระบุว่าไม่มี fallback; รุ่นปัจจุบันมี fallback และการกรองช่วงวันแล้ว รายงานนี้ใช้เป็นข้อสรุปล่าสุดเฉพาะรายการที่ตรวจ ไม่แก้ผลทดสอบย้อนหลัง ไม่เปลี่ยน AWS ไม่ dispatch workflow และไม่ deploy

<a id="v2-review-issue-88-รุ่นและขอบเขตหลักฐาน"></a>

### รุ่นและขอบเขตหลักฐาน

- Local HEAD และ GitHub `main` ที่อ่านระหว่างตรวจ: `4c90fdd51cbf9fba44360f06981b188bd263c365`; working tree สะอาดก่อนเริ่มงาน
- Node `v24.18.0`; `npm test` ผ่านทั้ง 3 test files และรันแบบ `--test-isolation=none` ได้ **44 cases ผ่าน**: search/data 30, dates 9, login 5 ดู [ผลเต็ม](assets/v2/issue-88/automated-tests.txt)
- [Production](https://main.d2q46seuxuluap.amplifyapp.com/) ตอบ HTTP 200; `index.html`, `assets/script.js`, `data/partner-data-backup.json` ที่ดาวน์โหลดตรงกับ local แบบ byte-for-byte ดู SHA-256 ใน [inspection.json](assets/v2/issue-88/inspection.json) การเทียบสามไฟล์นี้ไม่ยืนยัน deployed commit ทั้งชุดหรือสถานะ Amplify build/deploy job
- Browser: Codex in-app browser บน localhost `http://127.0.0.1:8780/` และ Production; ตรวจ desktop flow ไม่ได้ตรวจ mobile/responsive หรือ reduced motion ครบทุกกรณี
- API: `https://eb49u61kph.execute-api.us-east-1.amazonaws.com/default/fetchPartnersData`; curl หนึ่งรอบ HTTP 500, 0.902296 วินาที, body `{"message":"Internal Server Error"}`; browser Production พบ HTTP 500 และ fallback เช่นกัน ดู [headers](assets/v2/issue-88/api-headers.txt), [body](assets/v2/issue-88/api-error.json), [console](assets/v2/issue-88/production-console.json)

<a id="v2-review-issue-88-ตารางตรวจสอบ"></a>

### ตารางตรวจสอบ

ทุกผลใหม่ในตารางตรวจวันที่ 8 ต.ค. 2026 บนรุ่นข้างต้น; mock คือ DOM/fetch/timer จำลอง ไม่ใช่ AWS จริง

| ID / Scenario | Expected | Actual | Environment / Evidence |
| --- | --- | --- | --- |
| S01 อ่านรายการจาก API | HTTP 200 และ public records | **ไม่ผ่าน ณ เวลาตรวจ:** HTTP 500; ไม่ได้ข้อมูลหลัก | Real API; [headers](assets/v2/issue-88/api-headers.txt), [body](assets/v2/issue-88/api-error.json) |
| S02 API ล้มเหลว → backup | มีข้อมูลและแจ้งว่าอาจไม่ล่าสุด | ผ่าน: localhost และ Production แสดงข้อความสำรอง; localhost พบ hero เปลี่ยนจาก loading เป็นข้อมูล | Browser; [console](assets/v2/issue-88/production-console.json), [ภาพ](assets/v2/issue-88/production-fallback-search-date.jpg) |
| S03 Browse | แสดงองค์กรสาธารณะ | ผ่าน: Production แสดง 13 องค์กรใน collaborator view; snapshot มี 13 องค์กรและ 13 กิจกรรม | Browser + local artifact; [inspection](assets/v2/issue-88/inspection.json) |
| S04 Search `KBTG` | ชื่อองค์กรและชื่อกิจกรรมตรงคำค้น | ผ่าน: พบองค์กร KBTG และ Event tab พบ `KBTG University Roadshow` | Production browser; [DOM](assets/v2/issue-88/production-date-dom.txt) |
| S05 `KBTG` + university | ไม่มีองค์กรตรงทั้งสองเงื่อนไข | ผ่าน: แสดงไม่พบผู้มีส่วนได้ส่วนเสีย | Production browser; ขั้นตอนทำซ้ำด้านล่าง |
| S06 ล้าง keyword โดยคง university | คืนเฉพาะมหาวิทยาลัย | ผ่าน: Dublin, IPB, UCSD, Kansai รวม 4 รายการ; type ยัง university | Production browser; ขั้นตอนทำซ้ำด้านล่าง |
| S07 รายละเอียด KBTG | modal มีข้อมูลและกิจกรรมที่ผูกไว้ | ผ่าน: พบสหกิจศึกษาด้าน Software Engineering และ KBTG University Roadshow | Production browser; ขั้นตอนทำซ้ำด้านล่าง |
| S08 keyword + type + วันขอบเขต | `KBTG` + event + 15/10/2563 ถึงวันเดียวกันยังพบ Roadshow | ผ่าน; ISO inputs เป็น `2020-10-15` ทั้งสองค่า | Production browser; [DOM](assets/v2/issue-88/production-date-dom.txt), [ภาพ](assets/v2/issue-88/production-fallback-search-date.jpg) |
| S09 reversed date range | แจ้ง error และไม่พบผล | ผ่าน: 17/10/2563 → 14/10/2563 แจ้งวันที่สิ้นสุดต้องไม่น้อยกว่าวันที่เริ่มต้น; ไม่พบกิจกรรม | Production browser; [DOM](assets/v2/issue-88/production-reversed-dom.txt), [ภาพ](assets/v2/issue-88/production-reversed.jpg) |
| S10 แก้ช่วงวัน / ล้างวัน | คืนผล; clear ไม่ล้าง keyword/type | ผ่าน: แก้เป็น 15/10/2563 ทั้งสองค่า Roadshow กลับมา; clear แล้ว ISO/display ว่าง, keyword `KBTG`, type `event` คงเดิม | Production browser; S08 และขั้นตอนทำซ้ำ |
| S11 debounce/cache/race/empty/retry | request แชร์กันและผลเก่าไม่ทับใหม่; error ลองใหม่ได้ | ผ่านใน mock รวม HTTP/network/JSON/shape failure, empty success และ backup | Local mocked tests; [ผลเต็ม](assets/v2/issue-88/automated-tests.txt) |
| S12 co-host / dates / Thai digits | ความสัมพันธ์คงเดิม; วัน inclusive, one-sided, undated และ พ.ศ. ถูกต้อง | ผ่านใน mock; ไม่อ้างว่า browser ตรวจครบทุกกรณี | Local mocked tests; [ผลเต็ม](assets/v2/issue-88/automated-tests.txt) |
| S13 ขอบเขต public ของ snapshot | ทุกรายการมี explicit public และ IDs ไม่ซ้ำ | ผ่านระดับรายการ: 26 records, ไม่มี non-public/duplicate ID; ไม่ใช่การรับรอง field-level privacy | Local + live artifact ตรงกัน; [inspection](assets/v2/issue-88/inspection.json) |
| S14 workflow อัปเดต backup | validate ก่อนเขียน; run ขณะ API พร้อม; deploy ต่อได้ | static logic มีแล้ว; `gh run list --workflow update-data-backup.yml --limit 5` คืน `[]`; ยังไม่มีหลักฐาน run/deploy chain จากการตรวจนี้ | Static + GitHub read-only; [workflow](../../.github/workflows/update-data-backup.yml) |
| S15 แก้ DynamoDB → refresh | หน้าใหม่อ่านค่าล่าสุด; ผู้ไม่มีสิทธิ์เขียนถูกปฏิเสธ | **ยังตรวจไม่ได้:** API 500 และไม่ได้ใช้ AWS Console/credentials; ไม่ทำการเขียนข้อมูลจริง | หลักฐานย้อนหลัง #43/#46/#55 ไม่แทนผลปัจจุบัน |

<a id="v2-review-issue-88-หลักฐานเดิมจาก-issues"></a>

### หลักฐานเดิมจาก Issues

อ่าน body และ comments ปัจจุบันของ issues ต่อไปนี้; ลิงก์ภาพเป็นหลักฐานที่ผู้เขียนแนบ ไม่ได้ตรวจภาพย้อนหลังทุกใบหรือยืนยันว่าเป็น deployed commit ปัจจุบัน

| Issue | หลักฐานที่พบ | ใช้ยืนยันอะไรได้ / ช่องว่าง |
| --- | --- | --- |
| [#43](https://github.com/Micosz/Cs361-Group1-Project7/issues/43) | [comment เพิ่มค่า a แล้วแก้เป็น b และเรียกกลับ](https://github.com/Micosz/Cs361-Group1-Project7/issues/43#issuecomment-5645139478) | เป็นรายงานการอ่านกลับย้อนหลัง; ยังไม่พบผล direct write denial ใน comment ที่อ่าน |
| [#46](https://github.com/Micosz/Cs361-Group1-Project7/issues/46) | [comment อธิบาย Lambda/API/CORS และ reconstruction](https://github.com/Micosz/Cs361-Group1-Project7/issues/46#issuecomment-5654170710) | เป็นหลักฐาน implementation ตามผู้เขียน; backend source/IaC ไม่อยู่ใน repo จึงยังตรวจ config ปัจจุบันไม่ได้ |
| [#48](https://github.com/Micosz/Cs361-Group1-Project7/issues/48) | [ภาพ search สองภาพ](https://github.com/Micosz/Cs361-Group1-Project7/issues/48#issuecomment-5654811874) และ verification 3 ต.ค. | ใช้เป็นประวัติ; ผล S04–S06 เป็นการตรวจใหม่ผ่าน backup |
| [#49](https://github.com/Micosz/Cs361-Group1-Project7/issues/49) | [ภาพ filter สองภาพ](https://github.com/Micosz/Cs361-Group1-Project7/issues/49#issuecomment-5654712992) | ไม่ใช้ภาพอย่างเดียวสรุปกติกาช่วงวัน; อ่านโค้ดและตรวจ S08–S12 เพิ่ม |
| [#55](https://github.com/Micosz/Cs361-Group1-Project7/issues/55) | [ภาพข้อมูล/ความสัมพันธ์](https://github.com/Micosz/Cs361-Group1-Project7/issues/55#issuecomment-5983975306) | Issue ปิดและ checklist ไม่ยืนยัน API/deployment ปัจจุบัน; S01 แสดงข้อจำกัดใหม่ |
| [#65](https://github.com/Micosz/Cs361-Group1-Project7/issues/65) | body ระบุ manual backup workflow และ fallback; ไม่มี comments ที่อ่านพบ | frontend fallback ยืนยันใหม่แล้ว; workflow → commit → Amplify ยังต้องมี run/deployment record |

<a id="v2-review-issue-88-ความต่างเอกสารกับโค้ดปัจจุบัน"></a>

### ความต่างเอกสารกับโค้ดปัจจุบัน

| หัวข้อ | หลักฐานเดิม | รุ่นที่ตรวจ |
| --- | --- | --- |
| Fallback | verification 3 ต.ค. ไม่มี JSON fallback | [script.js](../../public/assets/script.js) เรียก API ก่อน, timeout 8s แล้วโหลด backup อีกไม่เกิน 8s; ทั้งสองล้มเหลวจึงแสดง error และลองใหม่จาก Search/filter ได้ |
| Visibility | verification เดิมยอมรับ visibility ว่าง | ขั้นโหลดปัจจุบันยอมรับ `access_level === 'public' OR visibility === 'public'`; mock ตรวจว่าไม่มี explicit public ถูกตัดออก แต่ไม่ได้ปฏิเสธ conflicting flags ทุกแบบ |
| Snapshot cache | เดิม cache API ต่อหน้า | ปัจจุบัน cache snapshot สำเร็จทั้ง API และ backup ต่อหน้า; ถ้า backup โหลดสำเร็จ API กลับมาพร้อมภายหลังก็ต้อง reload เพื่ออ่านใหม่ ไม่มี background refresh |
| ช่วงวัน | หลักฐานเดิมเน้น keyword/type | ปัจจุบันใช้ `period_date` เป็นวัน ISO, inclusive start/end และรองรับข้างเดียว; องค์กรผ่านเมื่อมีกิจกรรมสาธารณะเดียวที่อยู่ในทั้งสองขอบเขต รวม co-host ไม่ใช่การวัดช่วงอายุ MoU |
| การแสดงปี | หลักฐาน UI ก่อนหน้าระบุ 43 cases | date adapter รับ พ.ศ./เลขไทยแล้วแปลง ค.ศ. ครั้งเดียว; รอบนี้มี 44 cases เพราะ login clean-route case เพิ่มแล้ว |
| โครงสร้างไฟล์ | เอกสารเก่าอ้าง `assets/script.js` และ `index.html` | source ปัจจุบันอยู่ใต้ `public/`; Amplify `baseDirectory: public`, URL ยัง `/assets/...` |

`period` เป็นข้อความแสดงผลและ `period_date` เป็นวันที่ใช้กรอง ไม่ใช่ interval overlap ของข้อตกลง; เมื่อเลือกวัน รายการไม่มี `period_date` จะไม่ผ่าน filter (ทดสอบด้วย fixture; snapshot จริงรอบนี้ทั้ง 13 กิจกรรมมีวัน) ควรยืนยันกับทีมว่ากติกานี้ตรง Requirement ที่ส่ง

<a id="v2-review-issue-88-ปัญหาและข้อจำกัดที่ส่งต่อได้"></a>

### ปัญหาและข้อจำกัดที่ส่งต่อได้

1. **API unavailable — ยืนยันอาการแล้ว:** เปิด endpoint ด้วย curl หรือเปิดหน้าใหม่ดู console จะพบ HTTP 500 ตามรอบตรวจ; ส่งผลให้เว็บใช้ snapshot และตรวจ read-after-update ไม่ได้ ต้องให้ผู้รับผิดชอบ AWS ตรวจ Lambda logs/IAM/table/Lab status ก่อนสรุปสาเหตุ ไม่เปลี่ยน AWS ในงานนี้
2. **Field boundary ยังไม่ถูกบังคับใน backup pipeline — ยืนยันจากโค้ด:** workflow ตรวจชนิดข้อมูล, id, explicit public และ id ซ้ำ จากนั้นเขียนทั้ง record ลงไฟล์; frontend กรองรายการแล้ว spread record ทั้งก้อน ไม่มี field allowlist การเพิ่ม internal field ใน record ที่ยัง public จะทำให้ pipeline เก็บ field นั้นด้วย ต้องกำหนด public projection ก่อน V3 ไม่ได้อ้างว่าพบข้อมูลลับรั่วใน snapshot รอบนี้
3. **Ownership ยังไม่มีใน snapshot — ยืนยันขอบเขตไฟล์:** top-level fields ไม่มี user/owner/participant identifiers; `coordinators` ไม่ใช่หลักฐานสิทธิ์บัญชี ต้องออกแบบ mapping/legacy handling ก่อนใช้กับ role/record authorization ไม่สรุป schema จริงใน DynamoDB จาก snapshot อย่างเดียว
4. **Snapshot freshness — ยืนยันจากโค้ด:** workflow มีเฉพาะ `workflow_dispatch` ไม่รันตามเวลา และหน้า cache backup จน reload; notice บอกว่าอาจไม่ล่าสุดแต่ไม่ระบุ snapshot timestamp ต้องตรวจ freshness แยกจากการเปิดเว็บสำเร็จ
5. **Release traceability ยังไม่ครบ:** คู่มือ deploy ยังเว้นชื่อผู้ deploy, วันที่และ SHA; workflow runs ที่ query ได้ว่าง และไม่ได้เข้าถึง Amplify Console จึงยังไม่ยืนยัน build/deploy chain หรือ AWS write denial ผล curl ไม่พิสูจน์ CORS, IAM, backup job หรือการเปลี่ยน DynamoDB

<a id="v2-review-issue-88-วิธีทำซ้ำและตรวจส่วนที่ยังขาด"></a>

### วิธีทำซ้ำและตรวจส่วนที่ยังขาด

1. รัน `npm test` และ `node --test --test-isolation=none tests/search.test.js tests/date-presentation.test.js tests/login-presentation.test.js` จาก root; expected 3 files/44 cases ผ่าน
2. เปิด Production ใหม่ ไป Information Board; หาก API ยัง 500 ต้องเห็น notice สำรอง ค้น `KBTG`, เลือก university → ไม่พบ; ล้างคำค้น → มหาวิทยาลัย 4 รายการ; ล้างประเภท ค้น KBTG แล้วเปิดรายละเอียด → สองกิจกรรมตาม S07
3. Event tab: keyword `KBTG`, ประเภทกิจกรรมทั่วไปและสัมมนา; **พิมพ์** `15102563` ในแต่ละช่องแล้ว Tab ออกจากช่อง; ตรวจ native ISO values เป็น `2020-10-15` ทั้งคู่และพบ Roadshow อย่าใช้ข้อความ display อย่างเดียวเป็นหลักฐานว่า filter ถูก apply (การใช้ browser automation `fill` รอบแรกไม่ commit ISO จึงตัดผลนั้นออกและตรวจใหม่ด้วย keyboard)
4. พิมพ์เริ่ม `17102563`, สิ้นสุด `14102563` แล้ว Tab → error และไม่พบ; แก้เป็น 15/10/2563 ทั้งคู่ → Roadshow กลับมา; กดล้างวันที่ → keyword/type คงเดิม
5. เมื่อผู้รับผิดชอบยืนยัน API พร้อม ค่อยตรวจ API 200 และ browser แบบไม่มี notice; ตรวจ update/refresh และ authorized/unauthorized Console scenarios ใน environment ที่ทีมอนุญาต เก็บเวลา รุ่น expected/actual และปกปิด credentials
6. ผู้รับผิดชอบ workflow/deployment จัด run URL, source SHA และ Amplify build/deploy record มายืนยันการอัปเดต backup จริง งานทบทวนนี้ไม่กด Run workflow เพราะมีผล commit/push/deploy

<a id="v2-review-issue-88-สถานะตรวจรับ-88"></a>

### สถานะตรวจรับ #88

- มี scenario table และ evidence แยก static/mock/local/API/Production แล้ว
- สรุปความต่าง fallback/ช่วงวัน พร้อมคำถามเรื่อง field boundary, freshness และข้อจำกัด architecture แล้ว
- ปัญหามีวิธีทำซ้ำหรือระบุช่องว่างชัดเจน; **ไม่ได้รับรองว่า V2 backend ปัจจุบันผ่าน**
- พร้อมให้ทีม review และส่งต่อข้อค้นพบไป [#89](https://github.com/Micosz/Cs361-Group1-Project7/issues/89); ยังไม่ได้เปลี่ยนสถานะ Issue หรือโพสต์ GitHub


<a id="v2-follow-up-issue-89"></a>

<a id="v2-follow-up-issue-89-v2-follow-up-and-v3-prerequisites--issue-89"></a>

## V2 follow-up and V3 prerequisites — Issue #89

จัดทำวันที่ **8 ตุลาคม 2026 (Asia/Bangkok)** สำหรับ [#89](https://github.com/Micosz/Cs361-Group1-Project7/issues/89)

<a id="v2-follow-up-issue-89-ข้อสรุปและฐานหลักฐาน"></a>

### ข้อสรุปและฐานหลักฐาน

เสนอให้เก็บ Public Browse/Search/Filter/Detail และ fallback ที่ผ่านการตรวจไว้ แล้วตกลงขอบเขตข้อมูล สิทธิ์ และบัญชีผู้ใช้ก่อนพัฒนา protected features ของ V3 งานศึกษาสาเหตุ API และหลักฐาน deployment ทำควบคู่ได้ ไม่ต้องรอปิดทุกเรื่องจึงเริ่มออกแบบ

ใช้ [รายงาน #88](#v2-review-issue-88) และ scenario S01–S15 เป็นฐาน ตรวจบน source `4c90fdd51cbf9fba44360f06981b188bd263c365`; รายงาน/หลักฐานเผยแพร่ใน [commit 034ca41](https://github.com/Micosz/Cs361-Group1-Project7/commit/034ca4104e98fbe63d0888b6f3e1b4fb9ca16102) และ [#88 ปิดพร้อมคอมเมนต์หลักฐาน](https://github.com/Micosz/Cs361-Group1-Project7/issues/88#issuecomment-6056453823) ผล HTTP 500 และผล browser เป็นผล ณ รอบตรวจ #88 ไม่ใช่การตรวจบริการซ้ำใน #89

เอกสารนี้เป็นข้อเสนอให้ทีม review ไม่ใช่ Scope/Permission Matrix หรือ ADR ที่ทีมอนุมัติแล้ว ไม่เพิ่ม requirement จากข้อเสนอทุกแถว

<a id="v2-follow-up-issue-89-keep--change--investigate"></a>

### Keep / Change / Investigate

| ID / ประเภท | ข้อเสนอและเหตุผล | หลักฐาน | ส่งต่อ / เงื่อนไข |
| --- | --- | --- | --- |
| K1 Keep | คง Public Browse/Detail และความสัมพันธ์ partner/event/co-host; มี flow เดิมที่ใช้ต่อได้ | #88 S03/S07 และ mock S12 | #66/#91/#92: ใช้เป็น baseline regression ไม่สร้างหน้า public ใหม่ซ้ำ |
| K2 Keep | คง keyword ตาม name/title ร่วม type และการล้างคำค้นโดยคงเงื่อนไขอื่น | #88 S04–S06/S11 | #92/#111/#113: ระบุ contract และทดสอบ regression เมื่อต่อ protected workspace |
| K3 Keep | คง date adapter พ.ศ., inclusive bounds, reversed-range feedback และ clear date | #88 S08–S12; [DOM วันขอบเขต](assets/v2/issue-88/production-date-dom.txt) | #66/#91/#92: ทีมยืนยันความหมายวันที่ก่อนนำไปใช้กับข้อตกลง/แลกเปลี่ยน |
| K4 Keep | คง API-first, timeout, backup notice และ snapshot cache สำหรับ Public; ช่วยให้ดูข้อมูลได้เมื่อ API ไม่พร้อม | #88 S02/S11; [console](assets/v2/issue-88/production-console.json) | #92/#93/#113: คง fallback เฉพาะ public projection; ไม่ใช้ snapshot สาธารณะกับข้อมูล protected |
| C1 Change | กำหนด public field allowlist และกติกา publication flags ที่ขัดกันก่อนมี internal/personal fields; record-level filter อย่างเดียวไม่ตัด field | #88 S13 และข้อจำกัด 2; [workflow ปัจจุบัน](../../.github/workflows/update-data-backup.yml) | #66/#91/#92/#93: ระบุ classification, response/backup projection และ allow/deny cases; ยังไม่อ้างว่าพบ secret รั่ว |
| C2 Change | ผูก ownership/responsible user/participant ด้วย application identity ที่ตรวจสอบได้; display name/contacts ไม่ใช่สิทธิ์บัญชี | #88 ข้อจำกัด 3; [snapshot field inventory](assets/v2/issue-88/inspection.json) | #90/#91/#93: ต้องมี identifier และ legacy mapping ก่อนใช้กับ #76/#79/#104–#107 |
| C3 Change | เพิ่ม release traceability ในเอกสาร: frontend SHA, environment/date และหลักฐาน workflow/build/deploy แยกกัน | #88 S14/S15 และข้อจำกัด 5; [คู่มือ deploy ปัจจุบัน (V3)](../deployment/v3-deployment.md) | #93/#114/#115: เติมค่าที่ตรวจได้จริงก่อนรายงานส่งมอบ ไม่เดาจากหน้าเว็บเปิดได้ |
| I1 Investigate | ตรวจสาเหตุ API 500 และ readiness ของ Lab/backend; อาการยืนยันแล้วแต่สาเหตุยังไม่ยืนยัน | #88 S01; [headers](assets/v2/issue-88/api-headers.txt), [error body](assets/v2/issue-88/api-error.json) | ผู้รับผิดชอบ AWS: ตรวจ logs/config/IAM/table/Lab แล้ว retest API 200 ก่อน live integration/release; ออกแบบและ local work ทำควบคู่ได้ |
| I2 Investigate | ตรวจ workflow → backup commit → Amplify deployment และ read-after-update/unauthorized write | #88 S14/S15; query runs ว่าง ไม่ใช่หลักฐานว่า workflow ไม่เคยทำงาน | #93/#114/#115: ใช้ authorized environment และ run/deploy URLs; งานนี้ไม่ dispatch workflow หรือเขียน AWS |
| I3 Investigate | ทีมต้องการแสดงเวลา snapshot หรือไม่ และยอมรับ freshness แบบ manual update + reload ได้แค่ไหน | #88 ข้อจำกัด 4; cache ไม่มี background refresh | #66/#92/#93: เป็นคำถาม UX/operations ไม่บังคับทำ auto-sync หรือ scheduled jobs |

<a id="v2-follow-up-issue-89-สิ่งที่ต้องตัดสินใจก่อนพัฒนาส่วนที่เกี่ยวข้อง"></a>

### สิ่งที่ต้องตัดสินใจก่อนพัฒนาส่วนที่เกี่ยวข้อง

ไม่ต้องรอ Parent #72 ปิดทั้งหมด: เริ่มแต่ละงานได้เมื่อข้อสรุปที่งานนั้นใช้พร้อม

| Prerequisite | ข้อสรุปที่ต้องมี | งานที่ได้รับผลกระทบ / เงื่อนไขเริ่ม |
| --- | --- | --- |
| P1 Scope + permissions | #66 ระบุฟีเจอร์ส่งจริง, action, public/own/assigned scope, ผู้มอบหมายบทบาท, bootstrap/no-role/multiple-role/revocation; TU employee ไม่ให้สิทธิ์สูงอัตโนมัติ | #77/#79/#80 และ workspace #108–#110: เริ่ม implementation ตาม Matrix version ที่ทีมยืนยัน |
| P2 Public/internal/personal boundary | #66/#91/#92 ระบุ field classification และ response/search/count/backup projection รวม conflicting flags | ก่อนเปิด protected APIs หรือเติมข้อมูลภายในใน record ที่ public; กระทบ #79/#94–#107/#111/#113 |
| P3 TU identity + Session | #90 ยืนยัน contract/endpoint/identifier และข้อจำกัดเข้าถึงจริง เลือก expiry/logout/revocation/credential handling ตามบริบท | #75/#74/#76/#78 เริ่มตามข้อสรุปที่จำเป็น; ไม่เดา endpoint, ไม่ส่ง Application-Key ไป frontend และไม่เก็บรหัสผ่าน TU |
| P4 Ownership + legacy mapping | #91/#93 ระบุ user links, missing-owner/reference handling, document metadata และ safe defaults; ไม่ให้สิทธิ์ภายในจาก field ที่ขาด | ก่อน record authorization และย้ายข้อมูลจริงใน #79/#94–#107; งาน schema draft เริ่มจาก snapshot ได้ แต่ต้องตรวจ schema backend เพิ่ม |
| P5 Data/date/status contract | #91/#92 แยก activity day กับ agreement/exchange interval, transitions และ validation; ใช้ shared detail/form flows | ก่อน #98–#100/#104–#106/#111 นำ filter/status ไปใช้จริง; date tests เดิมไม่พิสูจน์ interval overlap |
| P6 Backend และ release evidence | API ปัจจุบันผ่าน smoke; มี migration validation, role denial, workflow/deploy record พร้อมรุ่นและ environment | #112–#115: ต้องพร้อมก่อนรับ production release; ไม่เป็นเงื่อนไขห้ามทำเอกสาร/mock/local development |

<a id="v2-follow-up-issue-89-ทำควบคู่ได้--เสนอเลื่อน"></a>

### ทำควบคู่ได้ / เสนอเลื่อน

- **ทำควบคู่ได้:** ผู้รับผิดชอบ AWS ตรวจ I1/I2; ทีมทำ #66, ศึกษา #90 และร่าง dictionary จากข้อมูลเดิมใน #91 จากนั้นปรับตามข้อสรุป identity/permissions; ใช้ test fixtures ที่ไม่มีข้อมูลจริงศึกษากรณี legacy และ direct denial ได้
- **เสนอเลื่อนถ้าไม่จำเป็นต่อ Scope ที่ยืนยัน:** background refresh, scheduled backup, search service ใหม่ และการย้าย hosting เพื่อให้ Lab ทำงานตลอดเวลา ยังไม่มีหลักฐานปริมาณ/latency ปัจจุบันพอให้บังคับเพิ่มองค์ประกอบเหล่านี้
- **คงนอกขอบเขตตาม #72:** analytics เชิงลึก, feedback หลายแหล่ง, รับข้อมูลระบบอื่น, สมัครโครงการ/approval, ลบ/follow/แจ้งเตือน และบัญชีคู่ความร่วมมือ/ศิษย์เก่า ไม่เพิ่มงาน V4 จาก retrospective นี้

<a id="v2-follow-up-issue-89-คำถามส่งต่อ-66-และงานออกแบบ"></a>

### คำถามส่งต่อ #66 และงานออกแบบ

1. ฟีเจอร์/action ใดส่งจริงใน V3 และใครมีอำนาจมอบหมายบทบาทคนแรก/คนถัดไป? ยืนยัน own/assigned scope และผู้ใช้ไม่มีบทบาทอย่างไร? → P1
2. Field ใด public/internal/personal รวม contacts, เอกสาร และ participant links; publication flags ขัดกันให้ถืออะไรเป็นหลัก? → P2
3. Identifier จาก TU ใดพิสูจน์ได้และเหมาะกับ account linking; Session ใช้วิธีใดและถอนสิทธิ์เดิมอย่างไร? → P3 (รอหลักฐาน #90)
4. ข้อมูลเดิมไม่มี owner/status/date หรือหา reference ไม่พบจะ mapping/จำกัดสิทธิ์อย่างไร และผู้รับผิดชอบตรวจ mapping คือใคร? → P4
5. วันของกิจกรรมกับช่วงเวลาของข้อตกลง/แลกเปลี่ยนมีความหมายและกติกาต่างกันอย่างไร; manual snapshot freshness เพียงพอหรือไม่? → P5/I3
6. ใครตรวจ API/AWS และรวบรวม run/deploy/denial evidence ก่อน release? → P6/I1/I2 (ยังไม่ได้มอบหมายบุคคลแทนทีม)

<a id="v2-follow-up-issue-89-review-และสถานะตรวจรับ"></a>

### Review และสถานะตรวจรับ

- [x] ทุกข้อเสนอมีประเภท เหตุผล และหลักฐาน #88 หรือระบุว่ายังต้องศึกษา
- [x] prerequisites ระบุงานที่ได้รับผลกระทบและเงื่อนไขเริ่ม; แยกเรื่องที่ศึกษาควบคู่/เสนอเลื่อน
- [ ] ผู้ใช้/ทีม review รายการและบันทึกข้อสรุป พร้อมคงคำถามที่ยังไม่ตัดสินใจ

**สถานะ: พร้อม review; ยังไม่มีหลักฐาน team approval** ณ เวลาจัดทำ การยืนยันข้อเสนอใน #89 ไม่ถือว่าอนุมัติ Matrix/Session/schema ทั้งหมด งานตัดสินใจเหล่านั้นยังอยู่ใน #66/#90–#93 ต้องบันทึกผล review ในคอมเมนต์ #89 ก่อนปิด Issue
