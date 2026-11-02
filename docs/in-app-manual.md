# คู่มือใช้งานในเว็บ CSTUHub

เพิ่มปุ่ม ? เปิดคู่มือทับหน้าปัจจุบัน มีสารบัญ ค้นหา เลือกบทบาท และขยายภาพ ปิดแล้วคืนโฟกัส ตำแหน่งเลื่อน และฟอร์มที่ค้างอยู่ โดยไม่เปลี่ยน URL หรือโหลดหน้าฟอร์มใหม่

## เนื้อหาและภาพ

35 หัวข้อ 81 ขั้นตอน ใช้ภาพจากเว็บจริง Singapore ผ่านบัญชีตัวอย่างของรายวิชา ภาพฟอร์มใช้ข้อมูลว่างหรือข้อมูลสาธิต ไม่มีภาพรหัสผ่าน การนำเข้าใช้ไฟล์สาธิตและหยุดที่ขั้นตรวจสอบ การแนบไฟล์หยุดที่คิวก่อนอัปโหลด ไม่ได้บันทึกหรือลบข้อมูลจริงเพื่อถ่ายภาพ

ภาพเน้นจุดเริ่มต้นหรือช่องควบคุมของแต่ละขั้น การกดบันทึก/ยืนยันอธิบายเป็นข้อความ ไม่ใช่หลักฐานว่าทำรายการจริงแล้ว

## การทำงาน

- `public/assets/manual.js`: overlay, focus/scroll restoration, search, role filter, F1 และปุ่มใน dialog
- `public/assets/manual.css`: desktop/mobile layout และกรอบเน้นจุดที่ต้องกด
- `public/assets/manual-data.json`: หัวข้อ คำอธิบาย ภาพ และพิกัด highlight
- `public/resources/manual/`: ภาพ JPEG จากเว็บจริง
- โหลดข้อมูลคู่มือเมื่อเปิดครั้งแรก และโหลดภาพเฉพาะบทที่เลือกแบบ lazy
- อ่านบทบาทจาก session ที่หน้าเว็บมีอยู่ ไม่เรียก refresh หรือแก้สิทธิ์
- การกรองบทบาทเป็นความสะดวกในการอ่าน ไม่ใช่การป้องกันข้อมูลลับ เนื้อหาและภาพคู่มือทั้งหมดเป็น static assets ที่เปิดอ่านได้
- iframe ใช้ปุ่มช่วยเหลือของ dialog ภายนอก หรือ F1 ส่งคำขอเปิดคู่มือไปยัง parent เดิม ตรวจ same-origin และ frame ต้นทาง

## ขอบเขต

ครอบคลุมฟังก์ชันที่เข้าถึงได้จากหน้าปัจจุบัน: ข้อมูลสาธารณะ บัญชี ความคิดเห็น Feedback Inbox แบบฟอร์มนำเข้า คู่ความร่วมมือ กิจกรรม MoU การแลกเปลี่ยน เอกสาร ภาพรวม และจัดการสิทธิ์

หน้ารายละเอียด MoU ปัจจุบันไม่ได้แสดงปุ่มเปลี่ยน lifecycle/ต่ออายุ จึงไม่สร้างขั้นตอนกดปุ่มที่ผู้ใช้ยังเข้าถึงไม่ได้ หากเปิดฟังก์ชันนั้นกลับมาให้เพิ่มภาพและบทคู่มือภายหลัง

## ตรวจสอบ

- ตรวจ syntax `manual.js`, build ของโครงการ และ whitespace diff ผ่าน
- ตรวจ JSON อ้างอิงภาพครบและพิกัด highlight อยู่ในภาพ
- เปิดคู่มือบน local preview: ผู้ใช้ทั่วไป 7 หัวข้อ นักศึกษา 12 หัวข้อ ผู้ดูแลความร่วมมือ 35 หัวข้อ
- ค้นหาและกรณีไม่พบผลลัพธ์ ขยายภาพ/Escape และหน้าจอมือถือ 390×844
- คลิกปุ่มจริงจากฟอร์ม: หลังปิดคู่มือ ข้อความร่างและตำแหน่งเลื่อน 244 กลับเป็น 244 พร้อม dialog เดิม
- เปิดจาก iframe ด้วย F1 แล้วปิด: iframe และข้อความร่างเดิมยังอยู่ URL ไม่เปลี่ยน
- local preview ใช้ session/รายการจำลองและไม่อนุญาตคำขอเขียน ไม่ใช่การทดสอบธุรกรรม production
- ไม่เพิ่มไฟล์ test และไม่แก้ backend/API/IAM

## รายการหัวข้อ

| หัวข้อ | บทบาทในข้อมูลคู่มือ |
|---|---|
| ดูคู่ความร่วมมือ กิจกรรม และ MoU | public, account, student, coordinator, staff, executive, manager |
| ค้นหาและกรองข้อมูล | public, account, student, coordinator, staff, executive, manager |
| เข้าสู่ระบบด้วยบัญชี TU | public, account, student, coordinator, staff, executive, manager |
| ดูสิทธิ์และออกจากระบบ | account, student, coordinator, staff, executive, manager |
| พักการเคลื่อนไหวพื้นหลัง | public, account, student, coordinator, staff, executive, manager |
| อ่านและส่งความคิดเห็นสาธารณะ | public, account, student, coordinator, staff, executive, manager |
| กรองและแสดงความเห็นต่อ Comment | public, account, student, coordinator, staff, executive, manager |
| ส่ง Feedback ของงานที่เกี่ยวข้อง | student, coordinator, staff, executive |
| แก้ไข Feedback ที่ตนเองบันทึก | student, coordinator, staff, executive |
| อ่าน Feedback รวมทุกงาน | coordinator, staff, executive |
| เก็บ Feedback ไว้อ่านต่อ | coordinator, staff, executive |
| อ่านผลตอบรับจากแบบฟอร์มในงาน | coordinator, staff, executive |
| นำเข้าคำตอบ Google Forms / Excel / CSV | coordinator, staff, executive |
| ลบชุดคำตอบที่นำเข้าผิด | coordinator, staff, executive |
| เพิ่มคู่ความร่วมมือ | coordinator, staff, executive |
| แก้ไขคู่ความร่วมมือและยกเลิกการแก้ไข | coordinator, staff, executive |
| เพิ่มและจัดการผู้ติดต่อภายใน | coordinator, staff, executive |
| บันทึกประวัติความสัมพันธ์ | coordinator, staff, executive |
| เพิ่มกิจกรรมและเชื่อมหน่วยงาน | coordinator, staff, executive |
| แก้ไขกิจกรรมและบันทึกผลลัพธ์ | coordinator, staff, executive |
| เพิ่มข้อตกลง MoU / MoA | coordinator, staff, executive |
| แก้ไขข้อมูลข้อตกลง | coordinator, staff, executive |
| ดูโครงการแลกเปลี่ยนของตนเอง | student, coordinator, staff, executive |
| เพิ่มโครงการแลกเปลี่ยน | coordinator, staff, executive |
| แก้ไขผู้เข้าร่วมและข้อมูลโครงการ | coordinator, staff, executive |
| เริ่ม เสร็จสิ้น หรือยกเลิกโครงการ | coordinator, staff, executive |
| แนบไฟล์เอกสารและรูปภาพ | coordinator, staff, executive |
| แชร์เอกสารให้ผู้เข้าร่วม | coordinator, staff, executive |
| เปิดหรือดาวน์โหลดเอกสาร | student, coordinator, staff, executive |
| นำไฟล์ออกหรือลบเอกสารแนบ | coordinator, staff, executive |
| กำหนดข้อมูลภายในหรือสาธารณะ | staff, executive |
| ดูภาพรวมความร่วมมือและ Stakeholder | staff, executive |
| ส่งออกรายงาน CSV | staff, executive |
| มอบหมาย เปลี่ยน หรือถอนบทบาท | manager, executive |
| เมื่อไม่พบปุ่ม โหลดไม่ครบ หรือบันทึกไม่ได้ | public, account, student, coordinator, staff, executive, manager |
