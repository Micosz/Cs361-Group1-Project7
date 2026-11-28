# หลักฐานการวัดประสิทธิภาพหน้าแรก — V6 (#259)

บันทึกผลการวัดหน้า Welcome (`https://main.d1d0za87xu48iv.amplifyapp.com/`) บน AWS Singapore (`ap-southeast-1`) ตามเกณฑ์ของ Issue `#259` เพื่อใช้อ้างอิงก่อน–หลังการปรับปรุง `#260` / `#261` และส่งตัวเลขต่อให้ `#262`

---

## 1. ฐานที่ใช้วัด (Baseline — ก่อนแก้ `#260` / `#261`)

| รายการ | ค่าที่ตรวจสอบได้ |
| --- | --- |
| **Baseline Commit SHA (`main`)** | `58a40f8e122930ab7c31e88e40fbe0a5f0a52bbd` (`58a40f8`) |
| **Target URL** | `https://main.d1d0za87xu48iv.amplifyapp.com/` (Amplify `d1d0za87xu48iv`, HTTP API `gez448y9c5`, Region `ap-southeast-1`) |
| **การยืนยันความตรงกับ AWS Singapore** | SHA-256 (LF-normalized) ของ `public/index.html` บน `main@58a40f8` = `c6264114fd92` ตรงกับหน้าเว็บจริงที่ deploy อยู่ (`c6264114fd92`) |
| **วันที่–เวลาที่วัด** | `2026-11-28T10:38:27Z` (17:38–17:40 น. เวลาไทย) |
| **ชุดข้อมูลสาธารณะขณะวัด** | 37 รายการ (20 คู่ความร่วมมือ + 17 กิจกรรมสาธารณะ) — `/fetchPartnersData` (37 รายการ, 44,743 bytes JSON) และ `/api/public/records` (37 รายการ, 36,297 bytes JSON) มี **ID ซ้ำกัน 37/37 รายการ (100%)** |
| **เบราว์เซอร์ / Viewport** | Google Chrome `158.0.8127.38` (`--headless=new` via CDP), `1440×900` |
| **เครือข่าย** | Broadband ปกติ (ไม่จำกัดความเร็ว, ประเทศไทย ➔ AWS Singapore `ap-southeast-1`) |
| **จำนวนรอบที่วัด** | Cold Cache: 10 รอบ · Warm Cache: 1 รอบอุ่นเครื่อง + 10 รอบวัดจริง · Concurrent: 3 ผู้ใช้พร้อมกัน × 3 รอบ (= 9 การเปิด) |
| **สคริปต์และไฟล์ผลดิบ** | [scripts/measure-v6-welcome.mjs](../../scripts/measure-v6-welcome.mjs) · [baseline-58a40f8.json](assets/v6/issue-259/baseline-58a40f8.json) |

---

## 2. ผลวัด Baseline — แยกเปิดครั้งแรก (Cold), เปิดซ้ำ (Warm) และผู้ใช้พร้อมกัน (Concurrent)

| ตัวชี้วัด | เปิดครั้งแรก (Cold, n=10) | เปิดซ้ำ (Warm, n=10) | พร้อมกัน 3 คน (Cold, n=9) |
| --- | ---: | ---: | ---: |
| **เวลาเริ่มเปิดหน้าจนเห็นการ์ด (`firstCardMs`) — p50** | **453.4 ms** | **338.9 ms** | **652.1 ms** |
| **เวลาเริ่มเปิดหน้าจนเห็นการ์ด (`firstCardMs`) — p95** | **4,829.4 ms** | **633.6 ms** | **4,615.9 ms** |
| เวลาเริ่มเปิดหน้าจนเห็นการ์ด — min / avg / max | 377.9 / 922.7 / 4,829.4 ms | 323.4 / 399.8 / 633.6 ms | 569.1 / 1,255.8 / 4,615.9 ms |
| Document TTFB (p50 / p95) | 37.4 / 83.2 ms | 11.4 / 13.9 ms | 64.2 / 92.8 ms |
| First Contentful Paint — FCP (p50 / p95) | 208.0 / 268.0 ms | 164.0 / 216.0 ms | 328.0 / 372.0 ms |
| DOMContentLoaded (p50 / p95) | 244.8 / 297.2 ms | 166.3 / 187.2 ms | 368.7 / 435.0 ms |
| **เวลา API รวมทุกคำขอ — p50 / p95 / max** | **112.4 / 319.1 / 4,535.3 ms** | **89.7 / 177.4 / 470.4 ms** | **115.0 / 4,043.1 / 4,281.0 ms** |
| **จำนวนคำขอ HTTP ทั้งหมด / การเปิด** | **90** (Network 90, Cache 0) | **89** (Network 86, Cache 3) | **89–90** (Network 89–90) |
| **จำนวนคำขอ API / การเปิด** | **6 ครั้ง** | **6 ครั้ง** | **6 ครั้ง** |
| Transfer Size (p50 / p95) | 1,469.1 / 2,112.8 KB | 37.4 / 88.3 KB | 2,107.9 / 2,114.7 KB |
| จำนวนการ์ดคู่ความร่วมมือที่แสดง / API Errors | 20 การ์ด / 0 errors | 20 การ์ด / 0 errors | 20 การ์ด / 0 errors |

### รายละเอียดแยกตาม API Endpoint (6 คำขอต่อการเปิด 1 ครั้ง)

| Endpoint | Lambda | จำนวนครั้ง/การเปิด | Cold p50 / p95 (ms) | Warm p50 / p95 (ms) | Concurrent 3u p50 / p95 (ms) | ขนาดตอบกลับ (Brotli) |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `GET /fetchPartnersData` | `fetchPartnersData` (Node) | **1** | 200.5 / **390.6** | 155.0 / **470.4** | 225.3 / **1,633.5** | ~6.8 KB (44.7 KB raw) |
| `GET /api/public/records` | `CSTUHubAuth` (Python) | **1** | 153.1 / **4,535.3** | 157.1 / **442.3** | 168.0 / **4,172.9** | ~6.2 KB (36.3 KB raw) |
| `GET /api/auth/session` | `CSTUHubAuth` (Python) | **4** | 104.3 / **223.1** (max 4,291.9) | 84.9 / **104.5** | 101.7 / **4,043.1** | ~0.48 KB × 4 |

---

## 3. หลักฐาน Network Waterfall — จุดที่รอนานที่สุด

### รอบที่เกิด Lambda Cold Start (`cold-1`, `firstCardMs = 4,829.4 ms`)

| ลำดับ | Endpoint | เริ่มยิง (ms) | TTFB (ms) | ระยะเวลารวม (ms) | เสร็จสิ้น (ms) | สถานะ |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 1 | `GET /api/auth/session` (#1) | 253.3 | 189.2 | 190.4 | 443.7 | 200 |
| 2 | `GET /api/auth/session` (#2) | 254.4 | 255.2 | 256.3 | 510.6 | 200 |
| 3 | `GET /api/auth/session` (#3) | 285.5 | 221.8 | 223.1 | 508.6 | 200 |
| 4 | **`GET /api/public/records`** | **286.9** | **4,534.0** | **4,535.3** | **4,822.2** | **200** |
| 5 | `GET /fetchPartnersData` | 287.1 | 218.5 | 219.5 | 506.7 | 200 |
| 6 | **`GET /api/auth/session` (#4)** | **337.2** | **4,290.6** | **4,291.9** | **4,629.1** | **200** |

### รอบที่ Lambda อุ่นแล้ว (`cold-5`, `firstCardMs = 622.7 ms`)

| ลำดับ | Endpoint | เริ่มยิง (ms) | TTFB (ms) | ระยะเวลารวม (ms) | เสร็จสิ้น (ms) |
| ---: | --- | ---: | ---: | ---: | ---: |
| 1 | `GET /api/auth/session` (#1) | 241.0 | 89.9 | 91.7 | 332.7 |
| 2 | `GET /api/auth/session` (#2) | 242.7 | 85.8 | 87.2 | 329.9 |
| 3 | `GET /api/auth/session` (#3) | 288.0 | 97.8 | 99.3 | 387.3 |
| 4 | `GET /api/public/records` | 289.1 | 238.4 | 240.2 | 529.3 |
| 5 | `GET /fetchPartnersData` | 289.3 | 316.2 | 319.1 | 608.4 |
| 6 | `GET /api/auth/session` (#4) | 324.5 | 106.8 | 109.0 | 433.5 |

### สรุปคอขวดที่พบ
1. **สแกน `CSTUHub-Partner` ซ้ำ 2 ครั้งต่อการเปิดหน้า (ข้อมูลซ้ำกัน 37/37 รายการ = 100%):** หน้าแรกเรียกทั้ง `/fetchPartnersData` (Node) และ `/api/public/records` (Python + `ConsistentRead=True`) พร้อมกัน และต้องรอให้เสร็จทั้งคู่ก่อนจึงวาดการ์ด (`firstCardMs` ตามหลัง API ที่ช้ากว่าโดยตรง)
2. **ยิง `GET /api/auth/session` ซ้ำ 4 ครั้งต่อการเปิดหน้า:** สคริปต์ 4 ตัว (`role-menu.js`, `records.js`, `role-home.js`, `exchange-admissions.js`) เรียก `CstuAuth.refresh()` พร้อมกันโดยไม่แชร์ in-flight promise ทำให้การเปิดหน้า 1 ครั้งเรียก `CSTUHubAuth` ถึง **5 invocations** และเมื่อมีผู้ใช้ 3 คนพร้อมกันเกิด **15 concurrent invocations** จนกระตุ้น Python Lambda Cold Start (~4.0–4.5 วินาที)
3. **Warm Cache ยัง re-validate static assets 86/89 รายการ** (มีเพียง 3 ไฟล์จาก `cdnjs` ที่อ่านจาก cache โดยตรง)

---

## 4. หลักฐาน CloudWatch Logs (รอเติมจาก AWS Console `ap-southeast-1`)

> หมายเหตุ: เก็บบรรทัด `REPORT RequestId:` ของ `/aws/lambda/CSTUHubAuth` และ `/aws/lambda/fetchPartnersData` ช่วงเวลา `2026-11-28 17:38–17:40 (+07:00)` เพื่อส่งตัวเลข `Billed Duration`, `Memory Size`, `Init Duration` และ DynamoDB RCU ให้ `#262`

---

## 5. ผลวัดหลังแก้ `#260` / `#261` และส่วนต่างก่อน–หลัง

*(รอดำเนินการหลัง `#260` และ `#261` deploy บน AWS Singapore — รันซ้ำด้วย `node scripts/measure-v6-welcome.mjs` ภายใต้เงื่อนไขเดิมทุกประการ)*
