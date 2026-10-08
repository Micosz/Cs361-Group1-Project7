# V2 evidence and architecture review — Issue #88

ตรวจวันที่ **8 ตุลาคม 2026 (Asia/Bangkok)** สำหรับ [#88](https://github.com/Micosz/Cs361-Group1-Project7/issues/88)

## ข้อสรุป

Public frontend ปัจจุบันยัง Browse, Search, Filter และเปิดรายละเอียดได้ผ่านข้อมูลสำรอง แต่ API จริงตอบ **HTTP 500** ในรอบตรวจนี้ จึงยังยืนยันการอ่าน DynamoDB ล่าสุดไม่ได้ ไม่สรุปว่า Learner Lab ปิดหรือ Lambda เสียจาก HTTP status เพียงอย่างเดียว

เอกสาร [search verification วันที่ 3 ต.ค.](v2-search-verification.md) เป็นหลักฐานย้อนหลังที่ระบุว่าไม่มี fallback; รุ่นปัจจุบันมี fallback และการกรองช่วงวันแล้ว รายงานนี้ใช้เป็นข้อสรุปล่าสุดเฉพาะรายการที่ตรวจ ไม่แก้ผลทดสอบย้อนหลัง ไม่เปลี่ยน AWS ไม่ dispatch workflow และไม่ deploy

## รุ่นและขอบเขตหลักฐาน

- Local HEAD และ GitHub `main` ที่อ่านระหว่างตรวจ: `4c90fdd51cbf9fba44360f06981b188bd263c365`; working tree สะอาดก่อนเริ่มงาน
- Node `v24.18.0`; `npm test` ผ่านทั้ง 3 test files และรันแบบ `--test-isolation=none` ได้ **44 cases ผ่าน**: search/data 30, dates 9, login 5 ดู [ผลเต็ม](issue-88/automated-tests.txt)
- [Production](https://main.d2q46seuxuluap.amplifyapp.com/) ตอบ HTTP 200; `index.html`, `assets/script.js`, `data/partner-data-backup.json` ที่ดาวน์โหลดตรงกับ local แบบ byte-for-byte ดู SHA-256 ใน [inspection.json](issue-88/inspection.json) การเทียบสามไฟล์นี้ไม่ยืนยัน deployed commit ทั้งชุดหรือสถานะ Amplify build/deploy job
- Browser: Codex in-app browser บน localhost `http://127.0.0.1:8780/` และ Production; ตรวจ desktop flow ไม่ได้ตรวจ mobile/responsive หรือ reduced motion ครบทุกกรณี
- API: `https://eb49u61kph.execute-api.us-east-1.amazonaws.com/default/fetchPartnersData`; curl หนึ่งรอบ HTTP 500, 0.902296 วินาที, body `{"message":"Internal Server Error"}`; browser Production พบ HTTP 500 และ fallback เช่นกัน ดู [headers](issue-88/api-headers.txt), [body](issue-88/api-error.json), [console](issue-88/production-console.json)

## ตารางตรวจสอบ

ทุกผลใหม่ในตารางตรวจวันที่ 8 ต.ค. 2026 บนรุ่นข้างต้น; mock คือ DOM/fetch/timer จำลอง ไม่ใช่ AWS จริง

| ID / Scenario | Expected | Actual | Environment / Evidence |
| --- | --- | --- | --- |
| S01 อ่านรายการจาก API | HTTP 200 และ public records | **ไม่ผ่าน ณ เวลาตรวจ:** HTTP 500; ไม่ได้ข้อมูลหลัก | Real API; [headers](issue-88/api-headers.txt), [body](issue-88/api-error.json) |
| S02 API ล้มเหลว → backup | มีข้อมูลและแจ้งว่าอาจไม่ล่าสุด | ผ่าน: localhost และ Production แสดงข้อความสำรอง; localhost พบ hero เปลี่ยนจาก loading เป็นข้อมูล | Browser; [console](issue-88/production-console.json), [ภาพ](issue-88/production-fallback-search-date.jpg) |
| S03 Browse | แสดงองค์กรสาธารณะ | ผ่าน: Production แสดง 13 องค์กรใน collaborator view; snapshot มี 13 องค์กรและ 13 กิจกรรม | Browser + local artifact; [inspection](issue-88/inspection.json) |
| S04 Search `KBTG` | ชื่อองค์กรและชื่อกิจกรรมตรงคำค้น | ผ่าน: พบองค์กร KBTG และ Event tab พบ `KBTG University Roadshow` | Production browser; [DOM](issue-88/production-date-dom.txt) |
| S05 `KBTG` + university | ไม่มีองค์กรตรงทั้งสองเงื่อนไข | ผ่าน: แสดงไม่พบผู้มีส่วนได้ส่วนเสีย | Production browser; ขั้นตอนทำซ้ำด้านล่าง |
| S06 ล้าง keyword โดยคง university | คืนเฉพาะมหาวิทยาลัย | ผ่าน: Dublin, IPB, UCSD, Kansai รวม 4 รายการ; type ยัง university | Production browser; ขั้นตอนทำซ้ำด้านล่าง |
| S07 รายละเอียด KBTG | modal มีข้อมูลและกิจกรรมที่ผูกไว้ | ผ่าน: พบสหกิจศึกษาด้าน Software Engineering และ KBTG University Roadshow | Production browser; ขั้นตอนทำซ้ำด้านล่าง |
| S08 keyword + type + วันขอบเขต | `KBTG` + event + 15/10/2563 ถึงวันเดียวกันยังพบ Roadshow | ผ่าน; ISO inputs เป็น `2020-10-15` ทั้งสองค่า | Production browser; [DOM](issue-88/production-date-dom.txt), [ภาพ](issue-88/production-fallback-search-date.jpg) |
| S09 reversed date range | แจ้ง error และไม่พบผล | ผ่าน: 17/10/2563 → 14/10/2563 แจ้งวันที่สิ้นสุดต้องไม่น้อยกว่าวันที่เริ่มต้น; ไม่พบกิจกรรม | Production browser; [DOM](issue-88/production-reversed-dom.txt), [ภาพ](issue-88/production-reversed.jpg) |
| S10 แก้ช่วงวัน / ล้างวัน | คืนผล; clear ไม่ล้าง keyword/type | ผ่าน: แก้เป็น 15/10/2563 ทั้งสองค่า Roadshow กลับมา; clear แล้ว ISO/display ว่าง, keyword `KBTG`, type `event` คงเดิม | Production browser; S08 และขั้นตอนทำซ้ำ |
| S11 debounce/cache/race/empty/retry | request แชร์กันและผลเก่าไม่ทับใหม่; error ลองใหม่ได้ | ผ่านใน mock รวม HTTP/network/JSON/shape failure, empty success และ backup | Local mocked tests; [ผลเต็ม](issue-88/automated-tests.txt) |
| S12 co-host / dates / Thai digits | ความสัมพันธ์คงเดิม; วัน inclusive, one-sided, undated และ พ.ศ. ถูกต้อง | ผ่านใน mock; ไม่อ้างว่า browser ตรวจครบทุกกรณี | Local mocked tests; [ผลเต็ม](issue-88/automated-tests.txt) |
| S13 ขอบเขต public ของ snapshot | ทุกรายการมี explicit public และ IDs ไม่ซ้ำ | ผ่านระดับรายการ: 26 records, ไม่มี non-public/duplicate ID; ไม่ใช่การรับรอง field-level privacy | Local + live artifact ตรงกัน; [inspection](issue-88/inspection.json) |
| S14 workflow อัปเดต backup | validate ก่อนเขียน; run ขณะ API พร้อม; deploy ต่อได้ | static logic มีแล้ว; `gh run list --workflow update-data-backup.yml --limit 5` คืน `[]`; ยังไม่มีหลักฐาน run/deploy chain จากการตรวจนี้ | Static + GitHub read-only; [workflow](../../.github/workflows/update-data-backup.yml) |
| S15 แก้ DynamoDB → refresh | หน้าใหม่อ่านค่าล่าสุด; ผู้ไม่มีสิทธิ์เขียนถูกปฏิเสธ | **ยังตรวจไม่ได้:** API 500 และไม่ได้ใช้ AWS Console/credentials; ไม่ทำการเขียนข้อมูลจริง | หลักฐานย้อนหลัง #43/#46/#55 ไม่แทนผลปัจจุบัน |

## หลักฐานเดิมจาก Issues

อ่าน body และ comments ปัจจุบันของ issues ต่อไปนี้; ลิงก์ภาพเป็นหลักฐานที่ผู้เขียนแนบ ไม่ได้ตรวจภาพย้อนหลังทุกใบหรือยืนยันว่าเป็น deployed commit ปัจจุบัน

| Issue | หลักฐานที่พบ | ใช้ยืนยันอะไรได้ / ช่องว่าง |
| --- | --- | --- |
| [#43](https://github.com/Micosz/Cs361-Group1-Project7/issues/43) | [comment เพิ่มค่า a แล้วแก้เป็น b และเรียกกลับ](https://github.com/Micosz/Cs361-Group1-Project7/issues/43#issuecomment-5645139478) | เป็นรายงานการอ่านกลับย้อนหลัง; ยังไม่พบผล direct write denial ใน comment ที่อ่าน |
| [#46](https://github.com/Micosz/Cs361-Group1-Project7/issues/46) | [comment อธิบาย Lambda/API/CORS และ reconstruction](https://github.com/Micosz/Cs361-Group1-Project7/issues/46#issuecomment-5654170710) | เป็นหลักฐาน implementation ตามผู้เขียน; backend source/IaC ไม่อยู่ใน repo จึงยังตรวจ config ปัจจุบันไม่ได้ |
| [#48](https://github.com/Micosz/Cs361-Group1-Project7/issues/48) | [ภาพ search สองภาพ](https://github.com/Micosz/Cs361-Group1-Project7/issues/48#issuecomment-5654811874) และ verification 3 ต.ค. | ใช้เป็นประวัติ; ผล S04–S06 เป็นการตรวจใหม่ผ่าน backup |
| [#49](https://github.com/Micosz/Cs361-Group1-Project7/issues/49) | [ภาพ filter สองภาพ](https://github.com/Micosz/Cs361-Group1-Project7/issues/49#issuecomment-5654712992) | ไม่ใช้ภาพอย่างเดียวสรุปกติกาช่วงวัน; อ่านโค้ดและตรวจ S08–S12 เพิ่ม |
| [#55](https://github.com/Micosz/Cs361-Group1-Project7/issues/55) | [ภาพข้อมูล/ความสัมพันธ์](https://github.com/Micosz/Cs361-Group1-Project7/issues/55#issuecomment-5983975306) | Issue ปิดและ checklist ไม่ยืนยัน API/deployment ปัจจุบัน; S01 แสดงข้อจำกัดใหม่ |
| [#65](https://github.com/Micosz/Cs361-Group1-Project7/issues/65) | body ระบุ manual backup workflow และ fallback; ไม่มี comments ที่อ่านพบ | frontend fallback ยืนยันใหม่แล้ว; workflow → commit → Amplify ยังต้องมี run/deployment record |

## ความต่างเอกสารกับโค้ดปัจจุบัน

| หัวข้อ | หลักฐานเดิม | รุ่นที่ตรวจ |
| --- | --- | --- |
| Fallback | verification 3 ต.ค. ไม่มี JSON fallback | [script.js](../../public/assets/script.js) เรียก API ก่อน, timeout 8s แล้วโหลด backup อีกไม่เกิน 8s; ทั้งสองล้มเหลวจึงแสดง error และลองใหม่จาก Search/filter ได้ |
| Visibility | verification เดิมยอมรับ visibility ว่าง | ขั้นโหลดปัจจุบันยอมรับ `access_level === 'public' OR visibility === 'public'`; mock ตรวจว่าไม่มี explicit public ถูกตัดออก แต่ไม่ได้ปฏิเสธ conflicting flags ทุกแบบ |
| Snapshot cache | เดิม cache API ต่อหน้า | ปัจจุบัน cache snapshot สำเร็จทั้ง API และ backup ต่อหน้า; ถ้า backup โหลดสำเร็จ API กลับมาพร้อมภายหลังก็ต้อง reload เพื่ออ่านใหม่ ไม่มี background refresh |
| ช่วงวัน | หลักฐานเดิมเน้น keyword/type | ปัจจุบันใช้ `period_date` เป็นวัน ISO, inclusive start/end และรองรับข้างเดียว; องค์กรผ่านเมื่อมีกิจกรรมสาธารณะเดียวที่อยู่ในทั้งสองขอบเขต รวม co-host ไม่ใช่การวัดช่วงอายุ MoU |
| การแสดงปี | หลักฐาน UI ก่อนหน้าระบุ 43 cases | date adapter รับ พ.ศ./เลขไทยแล้วแปลง ค.ศ. ครั้งเดียว; รอบนี้มี 44 cases เพราะ login clean-route case เพิ่มแล้ว |
| โครงสร้างไฟล์ | เอกสารเก่าอ้าง `assets/script.js` และ `index.html` | source ปัจจุบันอยู่ใต้ `public/`; Amplify `baseDirectory: public`, URL ยัง `/assets/...` |

`period` เป็นข้อความแสดงผลและ `period_date` เป็นวันที่ใช้กรอง ไม่ใช่ interval overlap ของข้อตกลง; เมื่อเลือกวัน รายการไม่มี `period_date` จะไม่ผ่าน filter (ทดสอบด้วย fixture; snapshot จริงรอบนี้ทั้ง 13 กิจกรรมมีวัน) ควรยืนยันกับทีมว่ากติกานี้ตรง Requirement ที่ส่ง

## ปัญหาและข้อจำกัดที่ส่งต่อได้

1. **API unavailable — ยืนยันอาการแล้ว:** เปิด endpoint ด้วย curl หรือเปิดหน้าใหม่ดู console จะพบ HTTP 500 ตามรอบตรวจ; ส่งผลให้เว็บใช้ snapshot และตรวจ read-after-update ไม่ได้ ต้องให้ผู้รับผิดชอบ AWS ตรวจ Lambda logs/IAM/table/Lab status ก่อนสรุปสาเหตุ ไม่เปลี่ยน AWS ในงานนี้
2. **Field boundary ยังไม่ถูกบังคับใน backup pipeline — ยืนยันจากโค้ด:** workflow ตรวจชนิดข้อมูล, id, explicit public และ id ซ้ำ จากนั้นเขียนทั้ง record ลงไฟล์; frontend กรองรายการแล้ว spread record ทั้งก้อน ไม่มี field allowlist การเพิ่ม internal field ใน record ที่ยัง public จะทำให้ pipeline เก็บ field นั้นด้วย ต้องกำหนด public projection ก่อน V3 ไม่ได้อ้างว่าพบข้อมูลลับรั่วใน snapshot รอบนี้
3. **Ownership ยังไม่มีใน snapshot — ยืนยันขอบเขตไฟล์:** top-level fields ไม่มี user/owner/participant identifiers; `coordinators` ไม่ใช่หลักฐานสิทธิ์บัญชี ต้องออกแบบ mapping/legacy handling ก่อนใช้กับ role/record authorization ไม่สรุป schema จริงใน DynamoDB จาก snapshot อย่างเดียว
4. **Snapshot freshness — ยืนยันจากโค้ด:** workflow มีเฉพาะ `workflow_dispatch` ไม่รันตามเวลา และหน้า cache backup จน reload; notice บอกว่าอาจไม่ล่าสุดแต่ไม่ระบุ snapshot timestamp ต้องตรวจ freshness แยกจากการเปิดเว็บสำเร็จ
5. **Release traceability ยังไม่ครบ:** คู่มือ deploy ยังเว้นชื่อผู้ deploy, วันที่และ SHA; workflow runs ที่ query ได้ว่าง และไม่ได้เข้าถึง Amplify Console จึงยังไม่ยืนยัน build/deploy chain หรือ AWS write denial ผล curl ไม่พิสูจน์ CORS, IAM, backup job หรือการเปลี่ยน DynamoDB

## วิธีทำซ้ำและตรวจส่วนที่ยังขาด

1. รัน `npm test` และ `node --test --test-isolation=none tests/search.test.js tests/date-presentation.test.js tests/login-presentation.test.js` จาก root; expected 3 files/44 cases ผ่าน
2. เปิด Production ใหม่ ไป Information Board; หาก API ยัง 500 ต้องเห็น notice สำรอง ค้น `KBTG`, เลือก university → ไม่พบ; ล้างคำค้น → มหาวิทยาลัย 4 รายการ; ล้างประเภท ค้น KBTG แล้วเปิดรายละเอียด → สองกิจกรรมตาม S07
3. Event tab: keyword `KBTG`, ประเภทกิจกรรมทั่วไปและสัมมนา; **พิมพ์** `15102563` ในแต่ละช่องแล้ว Tab ออกจากช่อง; ตรวจ native ISO values เป็น `2020-10-15` ทั้งคู่และพบ Roadshow อย่าใช้ข้อความ display อย่างเดียวเป็นหลักฐานว่า filter ถูก apply (การใช้ browser automation `fill` รอบแรกไม่ commit ISO จึงตัดผลนั้นออกและตรวจใหม่ด้วย keyboard)
4. พิมพ์เริ่ม `17102563`, สิ้นสุด `14102563` แล้ว Tab → error และไม่พบ; แก้เป็น 15/10/2563 ทั้งคู่ → Roadshow กลับมา; กดล้างวันที่ → keyword/type คงเดิม
5. เมื่อผู้รับผิดชอบยืนยัน API พร้อม ค่อยตรวจ API 200 และ browser แบบไม่มี notice; ตรวจ update/refresh และ authorized/unauthorized Console scenarios ใน environment ที่ทีมอนุญาต เก็บเวลา รุ่น expected/actual และปกปิด credentials
6. ผู้รับผิดชอบ workflow/deployment จัด run URL, source SHA และ Amplify build/deploy record มายืนยันการอัปเดต backup จริง งานทบทวนนี้ไม่กด Run workflow เพราะมีผล commit/push/deploy

## สถานะตรวจรับ #88

- มี scenario table และ evidence แยก static/mock/local/API/Production แล้ว
- สรุปความต่าง fallback/ช่วงวัน พร้อมคำถามเรื่อง field boundary, freshness และข้อจำกัด architecture แล้ว
- ปัญหามีวิธีทำซ้ำหรือระบุช่องว่างชัดเจน; **ไม่ได้รับรองว่า V2 backend ปัจจุบันผ่าน**
- พร้อมให้ทีม review และส่งต่อข้อค้นพบไป [#89](https://github.com/Micosz/Cs361-Group1-Project7/issues/89); ยังไม่ได้เปลี่ยนสถานะ Issue หรือโพสต์ GitHub
