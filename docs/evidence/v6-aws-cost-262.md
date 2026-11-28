# หลักฐานการเปรียบเทียบค่า AWS ต่อการเปิดหน้าแรก 1,000 ครั้ง — V6 (#262)

ประมาณการค่าใช้จ่าย AWS ใน Region **Asia Pacific (Singapore) `ap-southeast-1`** ต่อการเปิดหน้า Welcome **1,000 ครั้ง** โดยใช้ขอบเขตบริการเดียวกันทั้งก่อนแก้ (`58a40f8`) และหลังแก้ (`#260` + `#261`) อ้างอิงผลวัดจาก `#259`–`#261`

* **สคริปต์คำนวณ (รันซ้ำได้ทันทีเมื่อได้ CloudWatch log หลัง deploy):** [scripts/calculate-v6-262-cost.py](../../scripts/calculate-v6-262-cost.py)
* **ไฟล์ผลคำนวณ JSON:** [aws-cost-1000.json](assets/v6/issue-262/aws-cost-1000.json)

---

## 1. ข้อมูลปริมาณการใช้งานต่อการเปิดหน้าแรก 1 ครั้ง (Inputs จาก `#259`–`#261`)

| ตัวชี้วัด (ต่อการเปิด Welcome 1 ครั้ง) | ก่อนแก้ (`58a40f8`) | หลังแก้ (`#260` + `#261`) | ส่วนต่าง |
| --- | ---: | ---: | ---: |
| **จำนวนคำขอ API (API Gateway HTTP API)** | **6 ครั้ง** (`1× fetchPartnersData`, `1× public/records`, `4× auth/session`) | **2 ครั้ง** (`1× public/records?view=cards`, `1× auth/session`) | **-4 (-66.7%)** |
| **จำนวนครั้งที่เรียก Lambda** | **6 invocations** (`1× fetchPartnersData` + `5× CSTUHubAuth`) | **2 invocations** (`2× CSTUHubAuth`, `0× fetchPartnersData`) | **-4 (-66.7%)** |
| **หน่วยความจำ Lambda (ตาม `infra/backend.yaml`)** | `fetchPartnersData`: 128 MB (`0.125 GB`)<br>`CSTUHubAuth`: 256 MB (`0.25 GB`) | `CSTUHubAuth`: 256 MB (`0.25 GB`) | ใช้ `CSTUHubAuth` ตัวเดียว |
| **เวลาที่คิดค่าบริการ Lambda รวม (ประมาณจาก Warm TTFB − 37 ms RTT)** | **430 ms** (`118` + `120` + `4×48`) = **`0.09275 GB-s`** | **163 ms** (`115` + `48`) = **`0.04075 GB-s`** | **-267 ms / -56.1% GB-s** |
| **หน่วยอ่าน DynamoDB — ตาราง `CSTUHub-Partner` (ฐาน 37 รายการสาธารณะ)** | **16.5 RRU** (`5.5` EC Scan + `11.0` SC Scan) | **11.0 RRU** (`11.0` SC Scan) | **-5.5 RRU (-33.3%)** |
| **หน่วยเขียน DynamoDB — ตาราง `CSTUHub-Sessions` (Cold anonymous visitor)** | **4.0 WRU** (4× session init พร้อมกัน) | **1.0 WRU** (deduplicated) | **-3.0 WRU (-75.0%)** |
| **ปริมาณข้อมูลส่งออกรวม (Amplify Transfer p50)** | Cold `1,469.1 KB` / Warm `37.4 KB` | Cold `1,457.8 KB` / Warm `26.1 KB` | `-11.3 KB` API wire (-77% API bytes) |

> **หมายเหตุเรื่อง CloudWatch Billed Duration:** ตัวเลขเวลา Lambda ข้างต้นประมาณจากผลวัด Warm p50 TTFB ใน `#259` หักค่า RTT ไทย–สิงคโปร์ (~37 ms) เมื่อ PR `#306` deploy บน AWS Singapore เสร็จ ให้แทนที่ด้วยค่า `Billed Duration` และ `consumedRcu` จริงจาก CloudWatch Logs (`/aws/lambda/CSTUHubAuth`) ผ่านพารามิเตอร์ของ `scripts/calculate-v6-262-cost.py`

---

## 2. ตาราง “ค่า AWS โดยประมาณต่อการเปิด 1,000 ครั้ง” (Region `ap-southeast-1`)

**วันที่อ้างอิงราคา:** `2026-11-28` · **ไม่หัก AWS Free Tier** เพื่อให้เห็นต้นทุนส่วนเพิ่ม (marginal cost) ชัดเจนและเทียบกันได้ตรงไปตรงมา

### ก. ต้นทุนฝั่ง Backend API (API Gateway + Lambda + DynamoDB)

| บริการ AWS (`ap-southeast-1`) | ปริมาณก่อนแก้ (1,000 ครั้ง) | ปริมาณหลังแก้ (1,000 ครั้ง) | ราคาต่อหน่วย (USD) | ยอดก่อนแก้ (USD) | ยอดหลังแก้ (USD) | ส่วนต่าง (USD / %) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| **API Gateway (HTTP API)** | 6,000 req | 2,000 req | \$1.25 / 1M req | \$0.007500 | \$0.002500 | **-\$0.005000 (-66.7%)** |
| **AWS Lambda — Requests** | 6,000 inv | 2,000 inv | \$0.20 / 1M inv | \$0.001200 | \$0.000400 | **-\$0.000800 (-66.7%)** |
| **AWS Lambda — Compute (`x86_64`)** | 92.75 GB-s | 40.75 GB-s | \$0.0000166667 / GB-s | \$0.001546 | \$0.000679 | **-\$0.000867 (-56.1%)** |
| **DynamoDB On-Demand — Catalog Reads (`CSTUHub-Partner`)** | 16,500 RRU | 11,000 RRU | \$0.1425 / 1M RRU | \$0.002351 | \$0.001567 | **-\$0.000784 (-33.3%)** |
| **DynamoDB On-Demand — Cold Session Writes (`CSTUHub-Sessions`)** | 4,000 WRU | 1,000 WRU | \$0.71 / 1M WRU | \$0.002840 | \$0.000710 | **-\$0.002130 (-75.0%)** |
| **รวมฝั่ง Backend (API + Lambda + DynamoDB)** | — | — | — | **\$0.015437** | **\$0.005856** | **-\$0.009581 (-62.1%)** |

* **กรณีผู้ใช้คลิกเปิดการ์ดโหลดรายละเอียด (Sensitivity Check):** หากสมมติว่า **20%** ของการเปิดหน้า (200 ครั้ง / 1,000 โหลด) คลิกเปิดการ์ดคู่ความร่วมมือ 1 ใบ (`GET /api/public/partners/{id}`, 1 RRU, ~45 ms @ 256 MB) จะมีต้นทุนส่วนเพิ่มเพียง **+\$0.000356 / 1,000 ครั้ง** ➔ รวมฝั่ง Backend = **\$0.006212** (ยังประหยัดลง **-59.8%** เทียบก่อนแก้!)

### ข. ต้นทุนรวมทั้งหน้าเว็บ (Backend + AWS Amplify Hosting Data Transfer)

| สถานการณ์ Cache | บริการ Amplify Transfer (`$0.15 / GB`) | ยอดรวมก่อนแก้ (USD) | ยอดรวมหลังแก้ (USD) | ส่วนต่าง (USD / %) |
| --- | --- | ---: | ---: | ---: |
| **เปิดซ้ำ (Warm Cache)** | `0.0357 GB` ➔ `0.0249 GB` (`$0.005350` ➔ `$0.003734`) | **\$0.020787** | **\$0.009590** | **-\$0.011197 (-53.9%)** |
| **เปิดครั้งแรก (Cold Cache)** | `1.4010 GB` ➔ `1.3903 GB` (`$0.210156` ➔ `$0.208540`) | **\$0.225593** | **\$0.214396** | **-\$0.011197 (-5.0%)** |

### สมมติฐานและลิงก์ราคาอ้างอิง (`2026-11-28`)
1. **ขอบเขตเดียวกันทั้งสองรุ่น:** นับเฉพาะคำขอและทรัพยากรที่เกิดจากการเปิดหน้า Welcome (API Gateway HTTP API, Lambda Requests/Duration, DynamoDB On-Demand RRU/WRU, และ Amplify Data Transfer Out) ไม่รวมค่าเก็บข้อมูลคงที่ (Storage GB-month), CloudWatch Logs ingestion, และ WAF ที่เท่ากันทั้งสองรุ่น
2. **ไม่หัก Free Tier:** เพื่อให้เห็นสัดส่วนที่ลดลงจริงแม้ระบบจะขยายปริมาณผู้ใช้เกิน Free Tier (ในระดับการใช้งานปัจจุบันของรายวิชา ยอดทั้งหมดยังอยู่ใน AWS Always-Free / Free Tier)
3. **ตารางจริงใน AWS:** หาก `CSTUHub-Partner` มีรายการ internal/retired เพิ่มจาก 37 รายการสาธารณะ ค่า RRU ทั้งก่อน (`1.5×`) และหลัง (`1.0×`) จะขยายเป็นสัดส่วนเดียวกัน อัตราการลด **-33.3% RCU** ยังคงเดิม
4. **ลิงก์ราคาทางการ AWS (`ap-southeast-1`):**
   * API Gateway HTTP API: https://aws.amazon.com/api-gateway/pricing/
   * AWS Lambda: https://aws.amazon.com/lambda/pricing/
   * Amazon DynamoDB On-Demand: https://aws.amazon.com/dynamodb/pricing/on-demand/
   * AWS Amplify Hosting: https://aws.amazon.com/amplify/pricing/

---

## 3. สรุปแนวทางที่เลือก (เมื่อดูเวลาแสดงการ์ดคู่กับค่าใช้จ่าย) และข้อเสนอเรื่อง Cache ตาม `#200`

### แนวทางที่แนะนำให้ใช้งานจริงทันที: **ใช้ `#260` + `#261` (Single Unified Card API + On-Demand Detail + Session Dedup)**
* **ด้านเวลาแสดงการ์ด (`#259`):** ตัดการรอ API ซ้ำซ้อน 2 ตัว และลดการยิง `CSTUHubAuth` พร้อมกันจาก **5 invocations/โหลด ➔ 2 invocations/โหลด** (ผู้ใช้พร้อมกัน 3 คนลดจาก 15 ➔ 6 invocations) ช่วยลดโอกาสกระตุ้น Python Lambda Cold Start (~4.0–4.8 วินาที) ลงอย่างมีนัยสำคัญ และลดขนาด JSON รายการลง **-78.7%**
* **ด้านค่าใช้จ่าย:** ลดต้นทุนฝั่ง Backend ลง **-62.1%** (`-59.8%` เมื่อรวมคลิกเปิดการ์ด 20%) และลดต้นทุนรวม Warm Cache ลง **-53.9%** โดย **ไม่ต้องเพิ่มบริการ AWS ใหม่และไม่มีค่าบำรุงรักษาโครงสร้างพื้นฐานเพิ่ม**
* **ด้านความถูกต้องของข้อมูล:** คง `ConsistentRead=True` ทำให้การถอนการเผยแพร่มีผลทันทีในคำขอถัดไป ไม่เสี่ยงแสดงข้อมูลลับค้างใน cache

### ข้อเสนอเพิ่มเติมเรื่อง Cache ตาม `#200` (อ้างอิงผลวัดที่รองรับ)
หากระบบมีผู้ใช้งานเพิ่มขึ้นมากในอนาคต ผลวัดจาก `#259`–`#262` ชี้ลำดับความคุ้มค่าของการทำ Cache ตาม `#200` ดังนี้:
1. **ลำดับที่ 1 — Static Asset Browser/CDN Cache (`Cache-Control` บน Amplify):**
   * *ผลวัดที่รองรับ:* จาก `#259` พบว่าในรอบ **Warm Cache ยังมีการยิงเช็กไฟล์ static ผ่าน network ถึง 86 จาก 89 คำขอ** และในรอบ **Cold Cache ค่า Amplify Data Transfer (`$0.210 / 1,000 โหลด`) คิดเป็น >93% ของค่า AWS ทั้งหมด** (รูปภาพ 23 ไฟล์รวม ~810 KB)
   * การตั้ง `Cache-Control: public, max-age=31536000, immutable` ให้ไฟล์ที่มี query version (`/assets/*?v=...`) และการบีบอัดรูปภาพเป็น WebP จะช่วยลดทั้งจำนวน HTTP requests และค่า Amplify Transfer ได้คุ้มค่าที่สุด
2. **ลำดับที่ 2 — Public Catalog Cache (เฉพาะ `GET /api/public/records?view=cards` ตาม `#200`):**
   * *ผลวัดที่รองรับ:* หลังแก้ `#260/#261` แล้ว `GET /api/public/records?view=cards` เป็นจุดเดียวที่ยังทำ `Scan` บน `CSTUHub-Partner` (`11.0 RRU/โหลด` ซึ่งจะโตตามขนาดตาราง) และเป็นต้นเหตุหลักของ p95 latency ตอน Cold Start (~4.5 วินาทีใน `#259`)
   * *เงื่อนไขความปลอดภัยที่ต้องยึด:* หากเปิดใช้ cache ใน `#200` (เช่น short-TTL edge/memory cache หรือ invalidation เมื่อมีการแก้/ถอนการเผยแพร่) ต้องจำกัดเฉพาะ `GET /api/public/records*` เท่านั้น **ห้าม cache `/api/auth/session` หรือเส้นทาง protected `/api/*`** (`Cache-Control: private, no-store` ต้องคงอยู่เสมอ) และควรทำเมื่อปริมาณผู้ใช้หรือขนาดตารางใหญ่ขึ้นจนค่า DynamoDB Scan เริ่มมีนัยสำคัญ
