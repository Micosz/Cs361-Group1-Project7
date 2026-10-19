# ตาราง API ของ CSTUHub V3

เอกสารประกอบ [แผนภาพสถาปัตยกรรม V3](v3-architecture-diagram.png) สรุปเส้นทาง API หน้าที่ และสิทธิ์จากโค้ด ณ วันที่ 19 ตุลาคม 2026 การมีเส้นทางในโค้ดยังไม่ยืนยันว่าเปิดใช้งานบน AWS ครบทุกเส้นทาง

## บัญชีและเซสชัน

| Method | เส้นทาง | หน้าที่และเงื่อนไข |
|---|---|---|
| GET | `/api/auth/session` | ตรวจสถานะผู้ใช้; สร้างเซสชันผู้เยี่ยมชมหากไม่มีคุกกี้ |
| POST | `/api/auth/login` | เข้าสู่ระบบผ่าน `CSTUHubAuth` → `tuAuthLogin` → TU API; ตรวจ CSRF, origin และจำกัดความถี่การเข้าสู่ระบบ |
| POST | `/api/auth/logout` | ออกจากระบบและยกเลิกเซสชัน; ต้องมีเซสชันที่ถูกต้องและผ่านการตรวจ CSRF/origin |

## ข้อมูลสาธารณะและภาพรวม

| Method | เส้นทาง | ผู้ใช้ / หน้าที่ |
|---|---|---|
| GET | `/api/public/records` | ทุกคน; อ่านเฉพาะข้อมูลที่อนุญาตให้เผยแพร่สาธารณะ ไม่รับ query parameter |
| GET | `/api/overview` | Executive ในขอบเขตที่ได้รับสิทธิ์; ดูจำนวนและสถานะสรุป |
| GET | `https://eb49u61kph.execute-api.us-east-1.amazonaws.com/default/fetchPartnersData` | ทุกคน; อ่าน catalog เดิมผ่าน Lambda `fetchPartnersData` |

| การโหลดข้อมูลหน้าหลัก | พฤติกรรม |
|---|---|
| Catalog เดิม | เรียก `fetchPartnersData`; หากล้มเหลวใช้ `public/data/partner-data-backup.json` |
| ข้อมูลสาธารณะเพิ่มเติม | เมื่อเปิดระบบ auth จะเรียก `/api/public/records` มารวมกับ catalog |
| เส้นทางเรียกใช้ | Catalog เดิมเรียก API Gateway โดยตรง ส่วน `/api/*` เรียกผ่านโดเมนเดียวกับเว็บและ Amplify rewrite |

## ตัวเลือกในฟอร์มและการจัดการบทบาท

| Method | เส้นทาง | สิทธิ์ / หน้าที่ |
|---|---|---|
| GET | `/api/selection-partners?scopeId={scopeId}` | Coordinator หรือ Staff ในขอบเขตนั้น; อ่านคู่ความร่วมมือสำหรับเลือกในฟอร์ม |
| GET | `/api/selection-users?scopeId={scopeId}&kind=participant\|responsible` | `participant`: Coordinator/Staff ในขอบเขต; `responsible`: Staff ในขอบเขต |
| GET | `/api/users/{userId}/roles?scopeId={scopeId}` | ผู้มีความสามารถ `manageRoles` สำหรับขอบเขตและผู้ใช้เป้าหมาย; อ่านบทบาท |
| PATCH | `/api/users/{userId}/roles` | สิทธิ์เดียวกับแถวก่อน; แก้บทบาทด้วย `If-Match` ไม่รับ query string และทำให้สิทธิ์เวอร์ชันเก่าใช้ต่อไม่ได้ |

## ข้อมูลหลัก

ทุกเส้นทางในตารางนี้ต้องเข้าสู่ระบบและผ่านการตรวจบทบาท ขอบเขต และความรับผิดชอบต่อรายการ รายการข้อมูลรองรับการแบ่งหน้าและตรวจ query parameter ที่ส่งมา

| ข้อมูล | อ่านรายการ / สร้าง | อ่านรายรายการ / แก้ไข | เปลี่ยนสถานะ |
|---|---|---|---|
| คู่ความร่วมมือ | `GET /api/partners` · `POST /api/partners` | `GET /api/partners/{partnerId}` · `PATCH /api/partners/{partnerId}` | — |
| กิจกรรม | `GET /api/activities` · `POST /api/activities` | `GET /api/activities/{activityId}` · `PATCH /api/activities/{activityId}` | — |
| ข้อตกลง | `GET /api/agreements` · `POST /api/agreements` | `GET /api/agreements/{agreementId}` · `PATCH /api/agreements/{agreementId}` | `POST /api/agreements/{agreementId}/status` |
| การแลกเปลี่ยน | `GET /api/exchanges` · `POST /api/exchanges` | `GET /api/exchanges/{exchangeId}` · `PATCH /api/exchanges/{exchangeId}` | `POST /api/exchanges/{exchangeId}/status` |

| บทบาท | ขอบเขตสิทธิ์โดยสรุป |
|---|---|
| Staff | สร้างและจัดการข้อมูลในขอบเขตที่ได้รับสิทธิ์; การสร้างคู่ความร่วมมือเป็นสิทธิ์ของ Staff เท่านั้น |
| Coordinator | สร้างและจัดการงานที่ได้รับอนุญาตและตนรับผิดชอบ |
| Executive | อ่านข้อมูลที่ไม่ใช่ข้อมูลส่วนบุคคลตามสิทธิ์ ไม่แก้ไขข้อมูล |
| Student | อ่านการแลกเปลี่ยนที่ตนเข้าร่วมผ่าน `/api/me/exchanges` และเส้นทางย่อย |

## ผู้ติดต่อ ประวัติ และข้อเสนอแนะ

ต้องตรวจสิทธิ์กับรายการหลักที่ข้อมูลนั้นสังกัดก่อนเข้าถึง

| Method | เส้นทาง | สิทธิ์ / หน้าที่ |
|---|---|---|
| GET, POST | `/api/partners/{partnerId}/contacts` | Coordinator/Staff ที่เข้าถึงคู่ความร่วมมือนั้นได้; อ่านรายการหรือเพิ่มผู้ติดต่อ |
| GET, PATCH | `/api/partners/{partnerId}/contacts/{contactId}` | Coordinator/Staff ที่เข้าถึงคู่ความร่วมมือนั้นได้; อ่านหรือแก้ไขผู้ติดต่อ |
| GET, POST | `/api/partners/{partnerId}/history` | อ่าน: รวม Executive; เพิ่ม: Coordinator/Staff ที่มีสิทธิ์ในรายการหลัก |
| GET, PATCH | `/api/partners/{partnerId}/history/{historyId}` | อ่าน: รวม Executive; แก้ไข: Coordinator/Staff ที่มีสิทธิ์ในรายการหลัก |
| GET, POST | `/api/{activities\|exchanges}/{recordId}/feedback` | Coordinator/Staff อ่านและเพิ่ม; Executive อ่านอย่างเดียว โดยไม่แสดงชื่อผู้ให้ข้อเสนอแนะ |
| GET, PATCH | `/api/{activities\|exchanges}/{recordId}/feedback/{feedbackId}` | Coordinator/Staff อ่านและแก้ไข; Executive อ่านอย่างเดียว โดยไม่แสดงชื่อผู้ให้ข้อเสนอแนะ |

## เอกสารและข้อมูลของนักศึกษา

| Method | เส้นทาง | สิทธิ์ / หน้าที่ |
|---|---|---|
| GET, POST | `/api/{agreements\|exchanges}/{recordId}/documents` | Coordinator/Staff อ่านและเพิ่มเอกสารตามสิทธิ์รายการหลัก; Executive อ่านเอกสารภายในที่มีสิทธิ์; Student อ่านเอกสารสำหรับผู้เข้าร่วมใน Exchange ของตน |
| GET | `/api/documents/{documentId}` | อ่านข้อมูลกำกับเอกสาร หลังตรวจสิทธิ์รายการหลักและกลุ่มผู้รับเอกสาร |
| GET | `/api/documents/{documentId}/content?disposition=inline\|attachment` | อ่านเนื้อหาไฟล์ผ่าน API หลังตรวจสิทธิ์; เลือกเปิดดูหรือดาวน์โหลด รับเฉพาะ query `disposition` และไม่ส่ง URL สาธารณะของ S3 กลับมา |
| GET | `/api/me/exchanges` · `/api/me/exchanges/{exchangeId}` | Student; อ่านเฉพาะการแลกเปลี่ยนที่ตนเข้าร่วม |
| GET | `/api/me/exchanges/{exchangeId}/documents` | Student; อ่านเอกสารสำหรับผู้เข้าร่วมใน Exchange ของตน |

## เงื่อนไขร่วมและการจัดเก็บ

| หัวข้อ | รายละเอียด |
|---|---|
| ตรวจสิทธิ์ | Backend ตรวจเซสชัน บทบาท ขอบเขต ผู้รับผิดชอบ รายการหลัก และการเข้าร่วมตามเส้นทาง; การซ่อนเมนูในหน้าเว็บไม่ใช่การควบคุมสิทธิ์ |
| แก้ไข / เปลี่ยนสถานะ | ใช้ `If-Match` เพื่อตรวจเวอร์ชันข้อมูลก่อนบันทึก |
| สร้าง / อัปโหลด | ใช้ `Idempotency-Key` ป้องกันการสร้างซ้ำจากคำขอเดิม |
| ลบข้อมูล | ไม่มีเส้นทาง `DELETE` ใน gateway นี้ |
| บัญชีและเซสชัน | DynamoDB: Users, IdentityLinks, Sessions และ LoginRate |
| ข้อมูลหลักและข้อมูลย่อย | DynamoDB: Partner และ Business |
| เอกสาร | ข้อมูลกำกับอยู่ใน DynamoDB; ไฟล์อยู่ใน S3 แบบ private และอ่านผ่าน API ที่ตรวจสิทธิ์ |
| เปิดใช้ API ชุดรวม | Lambda ต้องตั้ง `AUTH_V3_ENABLED=true`; หากไม่เปิดจะใช้ตัวจัดการเฉพาะเซสชัน |
| ยืนยันการใช้งานจริง | ตรวจ branch/rewrite ของ Amplify, route/integration ของ API Gateway, Lambda และค่าตาราง/bucket พร้อมทดสอบผู้เยี่ยมชม ผู้เข้าสู่ระบบ ผู้ไม่มีสิทธิ์ และการอ่านไฟล์ส่วนตัว |

## ไฟล์อ้างอิง

| ส่วน | โค้ด |
|---|---|
| ประกอบ Lambda และเชื่อมบริการ | [lambda_function.py](../../../backend/lambda_function.py) |
| เซสชันและ HTTP | [http_api.py](../../../backend/http_api.py) |
| เส้นทางบัญชี ตัวเลือก และบทบาท | [application.py](../../../backend/application.py) |
| เส้นทางข้อมูลและสิทธิ์ | [gateway.py](../../../backend/permissions/gateway.py), [policy.py](../../../backend/permissions/policy.py) |
| ข้อมูลที่อนุญาตให้ส่งกลับ | [projections.py](../../../backend/permissions/projections.py) |
| Catalog และข้อมูลสำรอง | [script.js](../../../public/assets/script.js) |
