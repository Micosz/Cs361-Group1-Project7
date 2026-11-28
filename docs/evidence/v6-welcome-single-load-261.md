# หลักฐานการปรับหน้าแรกให้โหลดรายการครั้งเดียว — V6 (#261)

สรุปการปรับปรุง Frontend หน้า Welcome ให้เรียกใช้ API รายการเดียวจาก `#260` (`GET /api/public/records?view=cards`), โหลดรายละเอียดเพิ่มเติมเฉพาะเมื่อผู้ใช้เปิดการ์ด (`GET /api/public/{partners|activities}/{id}`), และลดการยิง `GET /api/auth/session` ซ้ำตอนเปิดหน้าแรกจาก 4 ครั้งเหลือ 1 ครั้ง

---

## 1. การเปลี่ยนแปลงใน `#261`

| ไฟล์ | การเปลี่ยนแปลง |
| --- | --- |
| `public/assets/script.js` | เปลี่ยน `fetchPartnersData()` ให้เรียก API รายการเดียว `GET /api/public/records?view=cards` (เมื่อ `CSTU_AUTH_CONFIG.enabled === true`; ยกเลิกการเรียก `/fetchPartnersData` ซ้ำ) และเพิ่ม `fetchPublicDetail(type, id)` ภายใน `openModal()` เพื่อโหลดรายละเอียดเต็ม (`full_description`, `website_url`) จาก `/api/public/partners/{id}` หรือ `/api/public/activities/{id}` เฉพาะตอนเปิดการ์ดพร้อม cache ระดับหน้า (ล้างเมื่อเรียก `invalidatePublicData()`) และปฏิเสธรายการที่ถูกถอนการเผยแพร่ (`404`) |
| `public/assets/auth-client.js` | เพิ่ม in-flight promise deduplication ใน `CstuAuth.refresh()` เพื่อรวมคำขอ `GET /api/auth/session` ที่ถูกเรียกพร้อมกันตอนโหลดหน้าแรกให้เหลือ 1 คำขอ โดยไม่ cache ค้างหลังคำขอเสร็จ (ทุกการกระทำถัดไปยังตรวจ session สดจาก server เสมอ) |
| `public/assets/role-menu.js` | แก้ listener `pageshow` ให้เรียก `refresh()` เฉพาะกรณี BFCache (`event.persisted === true`) เช่นเดียวกับ `records.js` และ `role-home.js` เพื่อไม่ยิง `/api/auth/session` ซ้ำหลัง `load` บนหน้าใหม่ |
| `public/index.html` (+ rebuild `public/work.html`) | อัปเดต query version (`?v=v6-single-load-1`) ของ `auth-client.js`, `script.js`, และ `role-menu.js` |
| `tests/frontend/public-data.test.cjs`, `tests/frontend/activity-time.test.cjs`, `tests/e2e/*.spec.cjs` | อัปเดตและเพิ่มเคสทดสอบ single list load, on-demand detail, 404 unpublished, และ session deduplication |

---

## 2. ผลตรวจจริงบน Google Chrome (`Chrome/158.0.8127.38`) + Backend `#260`

รันด้วย [scripts/verify-v6-261-browser.mjs](../../scripts/verify-v6-261-browser.mjs) (ผลดิบ Network + DOM: [browser-verification.json](assets/v6/issue-261/browser-verification.json))

### เกณฑ์ที่ 1 — Network ตั้งแต่เปิด Welcome จนเห็นการ์ดมีคำขอ API รายการเพียง 1 ครั้ง และคำขอรายละเอียดเกิดเฉพาะเมื่อเปิดการ์ด

| ช่วงการทำงาน | คำขอ API ที่เกิดขึ้นจริงใน Chrome Network | ผลเทียบก่อนแก้ (`#259`) |
| --- | --- | --- |
| **เปิดหน้า Welcome จนเห็นการ์ดครบ (`initial-load`)** | 1. `GET /api/auth/session`<br>2. `GET /api/public/records?view=cards` | API รวมลดจาก **6 ➔ 2 ครั้ง (-66.7%)**<br>API รายการลดจาก **2 ➔ 1 ครั้ง (-50%)**<br>`/fetchPartnersData`: **0 ครั้ง**<br>Detail API ก่อนเปิดการ์ด: **0 ครั้ง** |
| **คลิกเปิดการ์ดคู่ความร่วมมือ** | `GET /api/public/partners/partner-kbtg-001` (ตามด้วย feedback ของการ์ดนั้น) | เกิดเฉพาะเมื่อเปิดการ์ดเท่านั้น |
| **คลิกเปิดการ์ดกิจกรรม** | `GET /api/public/activities/act-ai-2026` (ตามด้วย admission-rounds & feedback) | เกิดเฉพาะเมื่อเปิดการ์ดเท่านั้น |

### เกณฑ์ที่ 2 — ค้นชื่อเต็ม เลือกคำแนะนำ แล้วเปิดการ์ด
* พิมพ์ชื่อเต็ม: `KASIKORN Business-Technology Group (KBTG)`
* คำแนะนำแสดง: `["KASIKORN Business-Technology Group (KBTG)"]`
* คลิกเลือกคำแนะนำ ➔ เบราว์เซอร์ยิง `GET /api/public/partners/partner-kbtg-001` แบบ on-demand ➔ Modal แสดงชื่อตรงกับที่เลือก และแสดง `full_description` ที่โหลดเพิ่มครบถ้วน

### เกณฑ์ที่ 3 — ใช้ตัวกรองเดิม เทียบรายการ และเปิดการ์ดจากผลที่กรองได้
1. **ตัวกรองคู่ความร่วมมือ (`type = university`):**
   * รายการที่คาดไว้: `["Kansai University"]` ➔ แสดงจริง: `["Kansai University"]` (ตรงกัน และไม่มีรายการภายในหลุดแสดง)
   * คลิกเปิดการ์ดจากผลที่กรอง ➔ ยิง `GET /api/public/partners/partner-kansai-001` ➔ แสดงชื่อและ `full_description` ตรงตามคู่ความร่วมมือที่เลือก
2. **ตัวกรองกิจกรรม (`type = research`, ช่วงวันที่ `2026-11-01` – `2026-11-30`, แท็บ `ผ่านมาแล้ว`):**
   * รายการที่คาดไว้: `["CSTU x KBTG Applied AI Workshop 2026"]` ➔ แสดงจริง: `["CSTU x KBTG Applied AI Workshop 2026"]`
   * คลิกเปิดการ์ดกิจกรรมจากผลที่กรอง ➔ ยิง `GET /api/public/activities/act-ai-2026` ➔ แสดงชื่อและ `full_description` ตรงตามกิจกรรมที่เลือก

---

## 3. ผลรัน Automated Tests ทั้งระบบ (`npm run build && npm test`)

| ชุดทดสอบ | ผลลัพธ์ |
| --- | --- |
| Frontend (`tests/frontend/*.test.cjs`) | **43 / 43 ผ่าน** |
| Python Backend (`tests/run-backend.py`) | **274 / 274 ผ่าน** |
| Node Lambdas (`tuAuthLogin`, `fetchPartnersData`, `getPublicPartners`) | **9 / 9 ผ่าน** |
| Deployment / Packaging (`tests/deployment`) | **21 / 21 ผ่าน** |
| Chrome CDP Verification (`scripts/verify-v6-261-browser.mjs`) | **AC1, AC2, AC3 ผ่านครบ** |

> **ขั้นถัดไป:** นำรุ่น `#260` + `#261` deploy ขึ้น AWS Singapore แล้วรัน `node scripts/measure-v6-welcome.mjs` วัดซ้ำใน `#259` เพื่อสรุปส่วนต่างก่อน–หลังและคำนวณค่า AWS ต่อ 1,000 ครั้งใน `#262`
