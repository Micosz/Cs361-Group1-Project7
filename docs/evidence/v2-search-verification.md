# V2 search performance fix and verification

ตรวจวันที่ 3 ตุลาคม 2026 (Asia/Bangkok) บน checkout ที่เริ่มจาก `47c503e` ซึ่ง Git status สะอาด ไม่พบ `AGENTS.md` ใน repository หรือโฟลเดอร์แม่ งานนี้ไม่มี commit, push หรือ deploy

## Changes

- `assets/script.js`: แชร์ Promise ของ API request ที่กำลังโหลด และ cache เฉพาะ snapshot ที่โหลด/ประกอบข้อมูลสำเร็จในหน่วยความจำของหน้าเว็บ ทุกส่วนยังอ่านข้อมูลจาก API/DynamoDB ไม่มี JSON fallback หรือ persistent storage
- หาก HTTP, network, JSON parsing หรือรูปแบบ response ล้มเหลว จะล้าง Promise เพื่อให้ลองใหม่ได้ โดยไม่ cache `[]` จาก error ส่วน response ที่สำเร็จและเป็น `[]` ถือเป็นข้อมูลที่ถูกต้องและ cache ได้ การ์ดและ modal แสดงข้อความให้กด Search หรือเปลี่ยน filter เพื่อลองใหม่; suggestions ซ่อน และ hero ticker เริ่มได้เมื่อโหลดสำเร็จภายหลัง
- `handleSearch()` ส่งคำค้นผ่าน `setBrowseKeyword()` การพิมพ์ debounce 250 ms; Search ยกเลิก timer และทำงานทันที; ล้างคำค้นคืนรายการตามประเภทที่เลือกไว้
- suggestions ใช้ version และตรวจคำค้นอีกครั้งหลัง await ผลเก่าจึงไม่เขียนทับคำค้นใหม่ หรือเปิด dropdown หลังเลือกผล กด Search เปลี่ยน filter หรือคลิกนอกพื้นที่ การปิด dropdown ระหว่าง debounce ยังให้การค้นหาการ์ดทำงานต่อ
- การ์ดสร้าง HTML ด้วย `map().join('')` และเขียน container ครั้งเดียวต่อ render รวมถึงกรณีไม่พบข้อมูล รักษา `collaboratorRenderVersion` และ `eventRenderVersion`
- รักษา visibility convention ของ data access เดิม: `public` หรือไม่มี visibility แสดงได้; visibility ที่ระบุค่าอื่นไม่แสดง รวมถึงการค้นหาจาก ID, hero และกิจกรรมใน modal
- รักษาการผูกกิจกรรมกับเจ้าภาพหลักและ `co_hosts` รวมถึงการตัด ID ซ้ำ โดยคง `partnerId` จาก API แม้ co-host จะอยู่ก่อนเจ้าภาพหลักในรายการ เพื่อให้ related activities อ้างอิงเจ้าภาพถูกต้อง
- `index.html`: เปลี่ยนเฉพาะ input/button handlers ไม่แก้ CSS หรือ layout
- `tests/search.test.js` และ test script ใน `package.json`: เพิ่มชุดทดสอบด้วย Node built-ins ไม่เพิ่ม dependencies

## Search rule

เลือกค้นจาก `name` ขององค์กรและ `title` ของกิจกรรมตาม [ข้อกำหนด V2](../architecture/ADR-001-v2-hosting.md) ที่ระบุการค้นหาด้วยชื่อ และตามกฎ Browse ที่มีอยู่ ใช้ `filterBrowseRecords()` ร่วมกันทั้ง suggestions และการ์ด รวมถึง filter ประเภทของแต่ละส่วน การค้นหาไม่แยกตัวพิมพ์ใหญ่/เล็กและ trim ช่องว่าง Suggestions ยังแสดงสูงสุด 6 รายการ

ดังนั้น summary, location, partnerName และ co_hosts ไม่ใช่ฟิลด์ค้นหา แต่ยังแสดงในข้อมูล/รายละเอียดตามเดิม วิธีนี้ทำให้รายการแนะนำไม่แสดงผลที่การ์ดค้นไม่พบ และไม่ขยายขอบเขตฟีเจอร์

## Automated verification — mocked API/DOM/timers

รัน `npm test` และตรวจรายกรณีด้วย `node --test --test-isolation=none tests/search.test.js` บน Node v24.18.0: **20 tests ผ่านทั้งหมด** รวมถึง:

- เปิดหน้าและโหลดการ์ดสองส่วน/hero พร้อมกัน: API request เดียว, DOM write ของแต่ละ grid ครั้งเดียว, ticker interval เดียว
- หลังสำเร็จ ค้นหา/filter/modal/ticker ไม่ส่ง request เพิ่ม; หน้าใหม่โหลด API ใหม่ด้วย `cache: 'no-store'`
- คำค้นทำงานร่วมกับประเภท, suggestions/การ์ดใช้กฎเดียวกัน, rapid typing รอครบ 250 ms, Search ทำงานทันทีและยกเลิก debounce
- ล้างคำค้นขณะที่ API ยังรออยู่แล้วคืนประเภทที่เลือกไว้; ผลเก่าของ suggestions และ render การ์ดทั้งสองส่วนไม่ทับผลใหม่
- การคลิกนอกพื้นที่ กด Search เลือก suggestion และเปลี่ยน filter ป้องกันผลที่รออยู่เปิด dropdown อีกครั้ง รวมถึงปิดก่อน debounce
- public/private visibility, ID lookup, co-host ที่อยู่ก่อนเจ้าภาพหลัก, related activities และ modal
- HTTP 503, network rejection, invalid JSON และ invalid response shape: UI จัดการ error และ Search ครั้งถัดไปโหลดสำเร็จ; successful empty array cache ได้

ผ่าน `node --check assets/script.js` และ `git diff --check` ด้วย

## Browser and real API verification

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

## Limits

ข้อมูล cache อยู่จนปิดหรือ refresh หน้า การแก้ DynamoDB ผ่าน AWS Console ระหว่างที่หน้ายังเปิดอยู่จะไม่ปรากฏอัตโนมัติ Refresh จะส่งคำขอ API ใหม่และรับ snapshot ใหม่จาก API; ไม่มี background refresh ในงานนี้

กรณี failure และการจัดลำดับผลเก่าถูกทดสอบด้วย mock เพื่อควบคุม timing อย่างแน่นอน ไม่ได้ทำให้บริการ AWS จริงล้มเหลว ผลจริงเป็น frontend ที่รันบน localhost ไม่ใช่ Amplify deployment ใหม่ และไม่มีโค้ด backend หรือ telemetry สำหรับสรุปสาเหตุความช้าของ Lambda/DynamoDB
