# เริ่มงาน #108–#111 — เมนูและหน้าร่วม

เริ่มจาก main `29df98451085426322f679845c4f7c8767122d2f` บน branch `108-shared-navigation` ปรับข้อความ GitHub เฉพาะ #108–#111 ตามคำขอ ไม่เปลี่ยน #80/#86 หรือปิดงานใด

## ใช้ได้ใน branch นี้

- เมนูขวาบนเปิดตามชนิดข้อมูลแทนการแยกหน้า coordinator/staff; แสดงทางเข้าเพิ่มตาม grant และคง My Exchange/จัดการสิทธิ์เดิม
- `records.html?kind=partners|activities|agreements|exchanges` ใช้รายการ/รายละเอียดชุดเดียว ผ่าน protected API; รองรับ `id` เพื่ออ่าน detail ตรง โดย Backend ตรวจสิทธิ์จริง
- coordinator เห็นรายการที่ policy อนุญาตจาก assignment; staff ตาม scope; executive read-only ไม่มีปุ่มแก้ และ projection เดิมไม่คืนข้อมูลส่วนบุคคล
- Public Partner/Event detail มีจุดเปิดจัดการ เมื่ออ่าน protected record ได้และมีสิทธิ์แก้จริง; protected API ล้มเหลวไม่เพิ่มปุ่มและไม่ทำให้ public detail หาย
- `records.html?view=overview` นับจาก count ของ protected collections ที่จำกัดสิทธิ์แล้ว ใช้ limit=1 ไม่โหลดทุก record มานับ ไม่มี /overview route ใหม่
- #111 เพิ่ม query type (Partner/Activity), status (Agreement/Exchange), startDate/endDate ใน listing เดิม หลัง authorization + projection ก่อน filter/count/page; Activity เป็นวันจริง, Agreement/Exchange เป็นช่วงทับซ้อนรวมขอบ ขาดวันไม่ผ่านเมื่อกรองวัน ช่วงกลับ/ไม่ใช่วันจริง/ฟิลด์ไม่รองรับ ->422
- cursor ผูก Session/ชุดข้อมูลที่มีสิทธิ์/ทุกเงื่อนไขค้นหา ไม่ใช้ cursor เก่าข้ามเงื่อนไข; UI แยก empty/error/503 ไม่มี protected fallback/cache

## จุดต่อฟอร์มของเพื่อน

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

## ยังไม่ครบ / รอ integration

- production business repository/topology/injection และหลักฐาน AWS/HTTPS; ถ้า adapter ไม่พร้อมตอบ503 ห้ามเอา mock ไป inject production
- form adapters จากเพื่อน รวมตัวเลือก/expanded references/assignment ที่ผ่านสิทธิ์ ไม่มี status/docs handlers พร้อมใน branch นี้
- executive overview ตอนนี้มี totals ตามชนิดเท่านั้น ยังรอสรุปแยกสถานะพื้นฐาน/aggregate routeตามข้อสรุป #110; /overview ใน design ยังไม่ได้ implement
- My Exchange ยังเปิด landing เดิม รอ #107; ไม่สร้างหน้าสมัครหรืออนุมัติ
- ทดสอบครบ coordinator/staff หลายscope การถอน assignment/role ระหว่างเปิดหน้า การแก้จริงและเอกสารหลัง adaptersพร้อมก่อนปิด #108–#111

## หลักฐาน

backend 95 tests ผ่าน, frontend npm test 6 ไฟล์ผ่าน และ local mock server 3 tests ผ่าน; git diff --check ผ่าน

เบราว์เซอร์ localhost บัญชีสมมติ: staff เปิด Exchange 2 รายการใน cs-demo ไม่เห็นรายการ other-scope; ค้นหา exchange-other ไม่พบ; detail ใช้ปุ่มแก้/สถานะ/เอกสาร disabled ตามฟอร์มที่ยังไม่มี; executive เห็น2รายการ ไม่มีปุ่มเขียนและไม่มี supportingInfo/participant info; overviewนับตามขอบเขต; มือถือ390pxรายการ/ตัวกรองไม่ล้นจอ

ภาพชั่วคราว: /tmp/cs361-108-menu.jpg และ /tmp/cs361-111-mobile.jpg ผลนี้เป็น local/mock ไม่ใช่ deploy และไม่ติ๊ก acceptance ระบบจริง
