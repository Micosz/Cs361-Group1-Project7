# หลักฐานการลดการอ่านข้อมูลซ้ำใน API หน้าแรก — V6 (#260)

สรุปการปรับปรุง Backend API (`CSTUHubAuth`) ตามผลวัด Baseline ของ `#259` เพื่อรวมข้อมูลที่การ์ดหน้า Welcome ต้องใช้ไว้ใน API รายการเดียว (`GET /api/public/records?view=cards`), เพิ่ม endpoint โหลดรายละเอียดเฉพาะตอนเปิดการ์ด (`GET /api/public/partners/{id}` และ `GET /api/public/activities/{id}`), และเก็บยอดอ่าน DynamoDB (Read Calls + Consumed RCU) ส่งต่อให้ `#261` และ `#262`

---

## 1. สิ่งที่อ่านซ้ำก่อนแก้ (อ้างอิงผล `#259` ที่ commit `58a40f8`)

* ก่อนแก้ หน้า Welcome ยิงคำขอรายการสาธารณะ **2 API พร้อมกัน** ไปยังตาราง DynamoDB `CSTUHub-Partner` เดียวกัน:
  1. `GET /fetchPartnersData` (Node.js Lambda `fetchPartnersData`) ➔ `Scan` ตาราง `CSTUHub-Partner` (Eventually Consistent) คืน 37 รายการ (`44,743 bytes` JSON)
  2. `GET /api/public/records` (Python Lambda `CSTUHubAuth`) ➔ `Scan` ตาราง `CSTUHub-Partner` (`ConsistentRead=True`) คืน **37 รายการชุดเดียวกันเป๊ะ (ID ซ้ำ 37/37 = 100%)** (`36,297 bytes` JSON)
* สาเหตุที่เดิมต้องเรียกคู่กัน: `/api/public/records` ขาดฟิลด์วันที่ `period_end_date` และ `date_precision` ที่การ์ดและตัวกรองวันที่หน้าแรกต้องใช้ และยังไม่มี endpoint สาธารณะสำหรับโหลดรายละเอียด (`full_description`, `website_url`) เฉพาะตอนเปิดการ์ด

---

## 2. การเปลี่ยนแปลงใน `#260` (Backwards-Compatible ไม่กระทบหน้าเว็บเดิมก่อน `#261`)

| ไฟล์ | การเปลี่ยนแปลง |
| --- | --- |
| `backend/lambda/CSTUHubAuth/backend/permissions/projections.py` | เพิ่ม `period_end_date` (alias `periodEndDate`), `date_precision`, และ `coHostPartnerIds` (เฉพาะคู่ความร่วมมือสาธารณะที่ผ่าน `public_links`) ใน `public_projection`; เพิ่ม `PUBLIC_CARD_FIELDS` (`card=True`) ที่ตัดฟิลด์หนักเฉพาะหน้ารายละเอียด (`full_description`, `website_url`) ออก |
| `backend/lambda/CSTUHubAuth/backend/business/dynamo_repository.py` | อัปเกรด `public_catalog(view='full'|'cards')` ให้ปิดช่องโหว่ ID ซ้ำแบบ fail-closed, ส่ง `ReturnConsumedCapacity='TOTAL'` และบันทึก metric `public_catalog_read` (`dynamoCalls`, `consumedRcu`, `itemsScanned`, `itemsReturned`) ลง CloudWatch Logs; เพิ่ม `public_record(kind, key)` ที่อ่านรายการเดี่ยวด้วย targeted `Query` (`ConsistentRead=True`, `ReturnConsumedCapacity='TOTAL'`) โดยไม่สแกนทั้งตาราง |
| `backend/lambda/CSTUHubAuth/backend/application.py` | รองรับ `GET /api/public/records?view=cards` (คง `GET /api/public/records` แบบเต็มไว้ให้เข้ากันได้กับรุ่นเดิม และปฏิเสธ query อื่นด้วย `422`) และเพิ่ม `GET /api/public/partners/{id}` กับ `GET /api/public/activities/{id}` (คืน `{"data": ...}`, ไม่มี session requirement, รายการที่ไม่เผยแพร่คืน `404`) |
| `tests/backend/CSTUHubAuth/test_public_catalog.py` | เพิ่มเคสทดสอบครบทั้ง card view, co-hosts, fail-closed duplicate IDs, การถอนการเผยแพร่ (partner/activity/co-host), targeted detail query (0 scan) และ RCU tracking |

> ไม่ต้องแก้ API Gateway หรือ Amplify Rewrite Rules เพราะทุกเส้นทางใหม่อยู่ใต้ `ANY /api/{proxy+}` ➔ `CSTUHubAuth` อยู่แล้ว

---

## 3. ผลตรวจตามเกณฑ์การยอมรับ (Acceptance Criteria)

### เกณฑ์ที่ 1 — เทียบผล API กับชุดข้อมูลตัวอย่าง (คู่ความร่วมมือ กิจกรรมสาธารณะ และผู้ร่วมจัด)
* **ตรวจกับชุดข้อมูลจริง 37 รายการจาก AWS Singapore** ผ่าน [scripts/verify-v6-260-rcu.py](../../scripts/verify-v6-260-rcu.py) (ผลดิบ: [rcu-comparison.json](assets/v6/issue-260/rcu-comparison.json)):
  * คู่ความร่วมมือตรงครบ **20 / 20 รายการ**
  * กิจกรรมสาธารณะตรงครบ **17 / 17 รายการ** (รวม `partnerName`, `period_date`, `period_end_date`, `date_precision`)
  * โหมด `?view=cards` ตัด `full_description` และ `website_url` ออกครบทุกรายการ ลดขนาด JSON ลง **-78.7%**
* **ชื่อผู้ร่วมจัด (`co_hosts` และ `coHostPartnerIds`):** ข้อมูลสาธารณะชุดปัจจุบันบน AWS มีกิจกรรมหลายผู้จัด 0 รายการ จึงยืนยันเพิ่มเติมใน automated test `test_public_catalog.py` ทั้งการคืน `co_hosts` + `coHostPartnerIds` ใน `?view=cards` และ `/api/public/activities/{id}` และการซ่อนผู้ร่วมจัดทันทีเมื่อถูกถอนการเผยแพร่

### เกณฑ์ที่ 2 — ถอนการเผยแพร่รายการตัวอย่างแล้วหายจาก API สาธารณะทันที
* **ตรวจกับรายการจากชุดข้อมูลจริง** (ใช้ `ConsistentRead=True` ทุกการอ่านสาธารณะ):
  * ถอนการเผยแพร่กิจกรรม `activity-11e17216b97a` (`publication/visibility/access_level = internal`) ➔ หายจาก `GET /api/public/records?view=cards` ทันที และ `GET /api/public/activities/activity-11e17216b97a` คืน **HTTP 404**
  * ถอนการเผยแพร่คู่ความร่วมมือ `partner-agicafet-001` ➔ หายจาก `GET /api/public/records?view=cards` ทันที และ `GET /api/public/partners/partner-agicafet-001` คืน **HTTP 404** (เหลือ 35 รายการ)
* **ตรวจเพิ่มเติมใน `test_public_catalog.py`:** ถอนการเผยแพร่คู่ความร่วมมือหลัก ➔ กิจกรรมที่ผูกอยู่หายไปด้วยทันที; ถอนการเผยแพร่ผู้ร่วมจัด ➔ ชื่อผู้ร่วมจัดหายจาก `co_hosts` ทันที

### เกณฑ์ที่ 3 — จำนวนครั้งที่อ่านและหน่วยอ่าน DynamoDB รวมต่อการเปิดหน้าแรก 1 ครั้ง (ส่งต่อให้ `#262`)

| ตัวชี้วัด (เฉพาะการโหลดรายการหน้า Welcome) | ก่อนแก้ (`58a40f8`) | หลังแก้ (`#260` + `#261`) | ส่วนต่าง |
| --- | ---: | ---: | ---: |
| **จำนวน API requests สำหรับรายการ** | **2 ครั้ง** (`/fetchPartnersData` + `/api/public/records`) | **1 ครั้ง** (`/api/public/records?view=cards`) | **-1 (-50.0%)** |
| **จำนวนครั้งที่อ่าน DynamoDB (`CSTUHub-Partner`)** | **2 Scans** (1× EC Scan + 1× SC Scan) | **1 Scan** (1× SC Scan, `ConsistentRead=True`) | **-1 Scan (-50.0%)** |
| **หน่วยอ่าน DynamoDB (RCU) — ฐาน 37 รายการสาธารณะ (44,335 bytes)** | **16.5 RCU** (`5.5` EC + `11.0` SC) | **11.0 RCU** (`11.0` SC) | **-5.5 RCU (-33.3%)** |
| **ขนาด Raw JSON รายการหน้าแรก** | **81,040 bytes** (`44,743 + 36,297`) | **17,301 bytes** | **-63,739 bytes (-78.7%)** |
| โหลดรายละเอียดเฉพาะตอนคลิกเปิดการ์ด (`GET /api/public/partners/{id}`) | *(รวมอยู่ใน list แล้ว)* | **1 Query / 1.0 RCU** (0 Scans) | เกิดเฉพาะเมื่อผู้ใช้เปิดการ์ด |
| โหลดรายละเอียดเฉพาะตอนคลิกเปิดการ์ด (`GET /api/public/activities/{id}`) | *(รวมอยู่ใน list แล้ว)* | **2+K Queries / 2.0+K RCU** (0 Scans) | เกิดเฉพาะเมื่อผู้ใช้เปิดการ์ด |

* **วิธีเก็บตัวเลข RCU:**
  1. **Offline / Pre-deploy (ข้อมูลชุดจริง 37 รายการจาก AWS):** คำนวณตามสูตรทางการของ AWS DynamoDB (`ceil(totalItemBytes / 4096)` สำหรับ `ConsistentRead=True` = `1.0 RCU/4KB` และ `0.5 RCU/4KB` สำหรับ Eventually Consistent) ผ่าน [scripts/verify-v6-260-rcu.py](../../scripts/verify-v6-260-rcu.py) — หมายเหตุ: หากตารางจริงใน AWS มีแถว internal/retired เพิ่มเติม ยอด RCU ทั้งก่อน (`1.5×`) และหลัง (`1.0×`) จะขยายเป็นสัดส่วนเดียวกัน อัตราการลด **-50% จำนวน Scan** และ **-33.3% RCU** ยังคงเท่าเดิม
  2. **Live AWS CloudWatch (หลัง deploy `#260`):** โค้ดใหม่ส่ง `ReturnConsumedCapacity='TOTAL'` ทุกการอ่านสาธารณะ และ log JSON `{"metric": "public_catalog_read", "dynamoCalls": ..., "consumedRcu": ...}` ลง `/aws/lambda/CSTUHubAuth` เพื่อให้ดึงยอด Consumed RCU จริงจาก AWS ใน `#262` ได้ทันที

---

## 4. ผลรัน Automated Tests ทั้งระบบ (`npm test`)

| ชุดทดสอบ | ผลลัพธ์ |
| --- | --- |
| Frontend (`tests/frontend/*.test.cjs`) | **42 / 42 ผ่าน** |
| Python Backend (`tests/run-backend.py` รวม `test_public_catalog.py` ใหม่) | **274 / 274 ผ่าน** |
| Node Lambdas (`tuAuthLogin`, `fetchPartnersData`, `getPublicPartners`) | **9 / 9 ผ่าน** |
| Deployment / Packaging (`tests/deployment`) | **21 / 21 ผ่าน** |
| Verification script (`scripts/verify-v6-260-rcu.py`) | **AC1, AC2, AC3 ผ่านครบ** |
