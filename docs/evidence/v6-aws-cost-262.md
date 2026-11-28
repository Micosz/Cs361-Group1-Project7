# หลักฐานการเปรียบเทียบค่า AWS ต่อการเปิดหน้าแรก 1,000 ครั้ง — V6 (#262)

ประมาณการค่าใช้จ่าย AWS ใน Region **Asia Pacific (Singapore) `ap-southeast-1`** ต่อการเปิดหน้า Welcome **1,000 ครั้ง** โดยใช้ขอบเขตบริการเดียวกันทั้งก่อนแก้ (`58a40f8`) และหลังแก้จริงบนระบบ production (`6d407dc` จาก PR `#306`) อ้างอิงผลวัดจริงจาก `#259`–`#261`

* **สคริปต์คำนวณ (อ่านผลวัดจริงก่อน–หลังโดยตรงและรองรับพารามิเตอร์ CloudWatch):** [scripts/calculate-v6-262-cost.py](../../scripts/calculate-v6-262-cost.py)
* **ไฟล์ผลคำนวณ JSON (อัปเดตจากผลวัดจริง `6d407dc`):** [aws-cost-1000.json](assets/v6/issue-262/aws-cost-1000.json)
* **ผลวัดจริงจาก `#259`:** [baseline-58a40f8.json](assets/v6/issue-259/baseline-58a40f8.json) ➔ [after-6d407dc.json](assets/v6/issue-259/after-6d407dc.json)

---

## 1. ข้อมูลปริมาณการใช้งานต่อการเปิดหน้าแรก 1 ครั้ง (Inputs จากผลวัดจริง `#259`–`#261`)

| ตัวชี้วัด (ต่อการเปิด Welcome 1 ครั้ง) | ก่อนแก้ (`58a40f8`) | หลังแก้จริง (`6d407dc`) | ส่วนต่าง |
| --- | ---: | ---: | ---: |
| **จำนวนคำขอ API (API Gateway HTTP API)** | **6 ครั้ง** (`1× fetchPartnersData`, `1× public/records`, `4× auth/session`) | **2 ครั้ง** (`1× public/records?view=cards`, `1× auth/session`) | **-4 (-66.7%)** |
| **จำนวนครั้งที่เรียก Lambda** | **6 invocations** (`1× fetchPartnersData` + `5× CSTUHubAuth`) | **2 invocations** (`2× CSTUHubAuth`, `0× fetchPartnersData`) | **-4 (-66.7%)** |
| **หน่วยความจำ Lambda (ตาม `infra/backend.yaml`)** | `fetchPartnersData`: 128 MB (`0.125 GB`)<br>`CSTUHubAuth`: 256 MB (`0.25 GB`) | `CSTUHubAuth`: 256 MB (`0.25 GB`) | ใช้ `CSTUHubAuth` ตัวเดียว |
| **เวลาที่คิดค่าบริการ Lambda รวม (ประมาณจาก Warm p50 TTFB − 37.0 ms RTT)** | **417.9 ms** (`116.3` + `116.0` + `4×46.4`) = **`0.08994 GB-s`** | **176.6 ms** (`133.2` + `43.4`) = **`0.04415 GB-s`** | **-241.3 ms (-57.7%) / -50.9% GB-s** |
| **หน่วยอ่าน DynamoDB — ตาราง `CSTUHub-Partner` (ฐาน 37 รายการสาธารณะ)** | **16.5 RRU** (`5.5` EC Scan + `11.0` SC Scan) | **11.0 RRU** (`11.0` SC Scan) | **-5.5 RRU (-33.3%)** |
| **หน่วยเขียน DynamoDB — ตาราง `CSTUHub-Sessions` (Cold anonymous visitor)** | **4.0 WRU** (4× session init พร้อมกัน) | **1.0 WRU** (deduplicated, ยืนยันครบ 29 รอบจริง) | **-3.0 WRU (-75.0%)** |
| **ปริมาณข้อมูล API ผ่านสาย (Brotli, วัดจริงจาก `#259`)** | Cold `15,004 B` / Warm `14,585 B` | Cold `4,384 B` / Warm `4,295 B` | **-70.8% Cold / -70.6% Warm** |
| **ปริมาณข้อมูลส่งออกรวม (Amplify Transfer วัดจริงจาก `#259`)** | Warm p50 `37.4 KB`<br>Cold Full-Load p95 `2,112.8 KB` | Warm p50 `27.3 KB`<br>Cold Full-Load p95 `2,104.9 KB` | **-10.1 KB (-27.0%) Warm**<br>**-7.9 KB (-0.4%) Cold p95** |

> **หมายเหตุเรื่อง Lambda Billed Duration & CloudWatch Logs:** ตัวเลขเวลา Lambda ทั้งก่อนแก้ (`58a40f8`) และหลังแก้ (`6d407dc`) คำนวณด้วยสูตรเดียวกันจากค่า Warm p50 TTFB จริงใน `#259` หักค่า RTT ไทย–สิงคโปร์ (~37.0 ms จาก Cold Document TTFB p50) หากต้องการแทนที่ด้วยค่า `Billed Duration` และ `consumedRcu` จากบรรทัด `REPORT RequestId:` และ `public_catalog_read` ใน CloudWatch Logs (`/aws/lambda/CSTUHubAuth`) สามารถส่งผ่านพารามิเตอร์ `--before-*`, `--after-*`, `--after-rcu` ของ `scripts/calculate-v6-262-cost.py` ได้ทันที

---

## 2. ตาราง “ค่า AWS โดยประมาณต่อการเปิด 1,000 ครั้ง” (Region `ap-southeast-1`)

**วันที่อ้างอิงราคา:** `2026-11-28` · **ไม่หัก AWS Free Tier** เพื่อให้เห็นต้นทุนส่วนเพิ่ม (marginal cost) ชัดเจนและเทียบกันได้ตรงไปตรงมา

### ก. ต้นทุนฝั่ง Backend API (API Gateway + Lambda + DynamoDB)

| บริการ AWS (`ap-southeast-1`) | ปริมาณก่อนแก้ (1,000 ครั้ง) | ปริมาณหลังแก้ (1,000 ครั้ง) | ราคาต่อหน่วย (USD) | ยอดก่อนแก้ (USD) | ยอดหลังแก้ (USD) | ส่วนต่าง (USD / %) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| **API Gateway (HTTP API)** | 6,000 req | 2,000 req | \$1.25 / 1M req | \$0.007500 | \$0.002500 | **-\$0.005000 (-66.7%)** |
| **AWS Lambda — Requests** | 6,000 inv | 2,000 inv | \$0.20 / 1M inv | \$0.001200 | \$0.000400 | **-\$0.000800 (-66.7%)** |
| **AWS Lambda — Compute (`x86_64`)** | 89.9375 GB-s | 44.1500 GB-s | \$0.0000166667 / GB-s | \$0.001499 | \$0.000736 | **-\$0.000763 (-50.9%)** |
| **DynamoDB On-Demand — Catalog Reads (`CSTUHub-Partner`)** | 16,500 RRU | 11,000 RRU | \$0.1425 / 1M RRU | \$0.002351 | \$0.001567 | **-\$0.000784 (-33.3%)** |
| **DynamoDB On-Demand — Cold Session Writes (`CSTUHub-Sessions`)** | 4,000 WRU | 1,000 WRU | \$0.71 / 1M WRU | \$0.002840 | \$0.000710 | **-\$0.002130 (-75.0%)** |
| **รวมฝั่ง Backend (API + Lambda + DynamoDB)** | — | — | — | **\$0.015390** | **\$0.005913** | **-\$0.009477 (-61.6%)** |

* **กรณีผู้ใช้คลิกเปิดการ์ดโหลดรายละเอียด (Sensitivity Check):** หากสมมติว่า **20%** ของการเปิดหน้า (200 ครั้ง / 1,000 โหลด) คลิกเปิดการ์ดคู่ความร่วมมือ 1 ใบ (`GET /api/public/partners/{id}`, 1 RRU, ~45 ms @ 256 MB) จะมีต้นทุนส่วนเพิ่มเพียง **+\$0.000356 / 1,000 ครั้ง** ➔ รวมฝั่ง Backend = **\$0.006269** (ยังประหยัดลง **-59.3%** เทียบก่อนแก้!)

### ข. ต้นทุนรวมทั้งหน้าเว็บ (Backend + AWS Amplify Hosting Data Transfer)

| สถานการณ์ Cache | บริการ Amplify Transfer (`$0.15 / GB`) | ยอดรวมก่อนแก้ (USD) | ยอดรวมหลังแก้ (USD) | ส่วนต่าง (USD / %) |
| --- | --- | ---: | ---: | ---: |
| **เปิดซ้ำ (Warm Cache, p50 จริง)** | `0.0357 GB` ➔ `0.0260 GB` (`$0.005350` ➔ `$0.003905`, `-27.0%`) | **\$0.020740** | **\$0.009818** | **-\$0.010922 (-52.7%)** |
| **เปิดครั้งแรก (Cold Cache, Full-Load p95 จริง)** | `2.0149 GB` ➔ `2.0074 GB` (`$0.302238` ➔ `$0.301108`, `-0.4%`) | **\$0.317628** | **\$0.307021** | **-\$0.010607 (-3.3%)** |

### สมมติฐานและลิงก์ราคาอ้างอิง (`2026-11-28`)
1. **ขอบเขตเดียวกันทั้งสองรุ่น:** นับเฉพาะคำขอและทรัพยากรที่เกิดจากการเปิดหน้า Welcome (API Gateway HTTP API, Lambda Requests/Duration, DynamoDB On-Demand RRU/WRU, และ Amplify Data Transfer Out) ไม่รวมค่าเก็บข้อมูลคงที่ (Storage GB-month), CloudWatch Logs ingestion, และ WAF ที่เท่ากันทั้งสองรุ่น
2. **ไม่หัก Free Tier:** เพื่อให้เห็นสัดส่วนที่ลดลงจริงแม้ระบบจะขยายปริมาณผู้ใช้เกิน Free Tier (ในระดับการใช้งานปัจจุบันของรายวิชา ยอดทั้งหมดยังอยู่ใน AWS Always-Free / Free Tier)
3. **ความซื่อสัตย์ของตัวเลข Cold Transfer:** ใช้ค่า Cold Full-Load `p95` (`2,112.8 KB` ➔ `2,104.9 KB`) แทน Cold `p50` (`1,469.1` ➔ `1,175.5 KB`) เพื่อไม่ให้จังหวะการโหลดรูปภาพแบบ lazy-load ทำให้ยอดประหยัด Cold Transfer ดูสูงเกินจริง ขณะที่ Warm Cache `p50` (`37.4` ➔ `27.3 KB`) ตรงกับขนาด API ที่ลดลงจริง `-10.05 KB`
4. **ตารางจริงใน AWS:** หาก `CSTUHub-Partner` มีรายการ internal/retired เพิ่มจาก 37 รายการสาธารณะ ค่า RRU ทั้งก่อน (`1.5×`) และหลัง (`1.0×`) จะขยายเป็นสัดส่วนเดียวกัน อัตราการลด **-33.3% RCU** ยังคงเดิม
5. **ลิงก์ราคาทางการ AWS (`ap-southeast-1`):**
   * API Gateway HTTP API: https://aws.amazon.com/api-gateway/pricing/
   * AWS Lambda: https://aws.amazon.com/lambda/pricing/
   * Amazon DynamoDB On-Demand: https://aws.amazon.com/dynamodb/pricing/on-demand/
   * AWS Amplify Hosting: https://aws.amazon.com/amplify/pricing/

---

## 3. สรุปแนวทางที่เลือก (เมื่อดูเวลาแสดงการ์ดคู่กับค่าใช้จ่าย) และข้อเสนอเรื่อง Cache ตาม `#200`

### แนวทางที่เลือกใช้งานจริง: **ใช้ `#260` + `#261` (Single Unified Card API + On-Demand Detail + Session Dedup)**
* **ด้านเวลาแสดงการ์ด (จากผลวัดจริง `#259` `58a40f8` ➔ `6d407dc`):**
  * **Concurrent 3 ผู้ใช้พร้อมกัน:** `firstCardMs p95` ลดจาก **`4,615.9 ms` ➔ `1,000.6 ms` (-78.3%)**, `avg` ลดจาก `1,255.8 ➔ 692.9 ms` (-44.8%), และ `allApiDurationMs p95` ลดจาก `4,043.1 ➔ 537.1 ms` (-86.7%) เพราะลดการยิง `CSTUHubAuth` พร้อมกันจาก **15 ➔ 6 invocations** ขจัด Cold-Start Storm ได้จริง
  * **เปิดซ้ำ (Warm Cache):** `firstCardMs p95` ลดจาก **`633.6 ms` ➔ `434.2 ms` (-31.5%)**, เวลา `GET /api/public/records` `p95` ลดจาก **`442.3 ➔ 188.7 ms` (-57.3%)**, และข้อมูลส่งออกทั้งหน้าลดลง **-27.0%** (`37.4 ➔ 27.3 KB`)
  * **เปิดครั้งแรก (Cold Cache):** `firstCardMs p95` ลดจาก `4,829.4 ➔ 4,547.8 ms` (-5.8%) และ API ลดจาก **6 ➔ 2 คำขอ (-66.7%)** ทุกโหมดโดยมี 0 errors ครบทั้ง 29 รอบ
* **ด้านค่าใช้จ่าย:** ลดต้นทุนฝั่ง Backend ลง **-61.6%** (`-59.3%` เมื่อรวมคลิกเปิดการ์ด 20%) และลดต้นทุนรวม Warm Cache ลง **-52.7%** โดย **ไม่ต้องเพิ่มบริการ AWS ใหม่และไม่มีค่าบำรุงรักษาโครงสร้างพื้นฐานเพิ่ม**
* **ด้านความถูกต้องของข้อมูล:** คง `ConsistentRead=True` ทำให้การถอนการเผยแพร่มีผลทันทีในคำขอถัดไป ไม่เสี่ยงแสดงข้อมูลลับค้างใน cache

### ข้อเสนอเพิ่มเติมเรื่อง Cache ตาม `#200` (อ้างอิงผลวัดจริงที่รองรับ)
หากระบบมีผู้ใช้งานเพิ่มขึ้นมากในอนาคต ผลวัดจริงจาก `#259` (`after-6d407dc.json`) และ `#262` ชี้ลำดับความคุ้มค่าของการทำ Cache ตาม `#200` ดังนี้:
1. **ลำดับที่ 1 — Static Asset Browser/CDN Cache (`Cache-Control` บน Amplify):**
   * *ผลวัดจริงที่รองรับ:* หลังแก้ `#260/#261` แล้ว ในรอบ **Warm Cache ยังมีการส่งคำขอ re-validate ไฟล์ static ผ่าน network ถึง 82 จาก 85 คำขอ** (`after-6d407dc.json`) และในรอบ **Cold Cache ค่า Amplify Data Transfer (`\$0.301 / 1,000 โหลด`) คิดเป็น 98.1% ของค่า AWS ทั้งหมด** (รูปภาพและ assets รวม ~2.0 MB)
   * การตั้ง `Cache-Control: public, max-age=31536000, immutable` ให้ไฟล์ที่มี query version (`/assets/*?v=...`) และการบีบอัดรูปภาพเป็น WebP จะช่วยลดทั้งจำนวน HTTP requests และค่า Amplify Transfer ได้คุ้มค่าที่สุด
2. **ลำดับที่ 2 — Public Catalog Cache (เฉพาะ `GET /api/public/records?view=cards` ตาม `#200`):**
   * *ผลวัดจริงที่รองรับ:* หลังแก้ `#260/#261` แล้ว `GET /api/public/records?view=cards` เป็นจุดเดียวที่ยังทำ `Scan` บน `CSTUHub-Partner` (`11.0 RRU/โหลด` ซึ่งจะโตตามขนาดตาราง) และยังเป็นต้นเหตุเดียวของ tail latency ตอน Cold Start (`cold-2` ใน `after-6d407dc.json` ใช้เวลา `4,250.8 ms` ➔ `firstCardMs = 4,547.8 ms`)
   * *เงื่อนไขความปลอดภัยที่ต้องยึด:* หากเปิดใช้ cache ใน `#200` (เช่น short-TTL edge/memory cache หรือ invalidation เมื่อมีการแก้/ถอนการเผยแพร่) ต้องจำกัดเฉพาะ `GET /api/public/records*` เท่านั้น **ห้าม cache `/api/auth/session` หรือเส้นทาง protected `/api/*`** (`Cache-Control: private, no-store` ต้องคงอยู่เสมอ) และควรทำเมื่อปริมาณผู้ใช้หรือขนาดตารางใหญ่ขึ้นจนค่า DynamoDB Scan เริ่มมีนัยสำคัญ
