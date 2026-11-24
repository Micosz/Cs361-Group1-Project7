# บันทึกตรวจหน้าเว็บ CSTUHub

ตรวจเมื่อ 24 พฤศจิกายน 2569 จาก [หน้าแรกบน main ที่ใช้เทียบ](https://github.com/Micosz/Cs361-Group1-Project7/blob/abb7cb3205942f9ee110af226e69ee4f667113fd/public/index.html) ภาพประกอบถ่ายจาก Chromium บน Cloud โดยใช้ชื่อ องค์กร และรายการตัวอย่างทั้งหมด กิจกรรมที่ใช้ทดสอบระบุว่า **วันสมมติ**

## สิ่งที่ควรเพิ่ม ตัด และปรับ

| สิ่งที่พบ | ข้อเสนอ | จุดที่ต้องระวัง | สถานะ |
| --- | --- | --- | --- |
| หน้า Welcome มีปุ่มเริ่มต้น แต่ชื่อหมวดปรากฏเมื่อถึง Information Board | นำแถบหมวดเดิมขึ้นมาใต้ข้อความต้อนรับ แล้วให้ตามไปอยู่เหนือรายการ ใช้สีดำบน Welcome และสีขาวพร้อมหมวดสีแดงบนบอร์ด | การเลื่อนขึ้นลงต้องคงหมวดและโฟกัส มือถือ 320 พิกเซลต้องกดทุกปุ่มที่แสดงได้ | ทดสอบบน [branch แถบหมวด](https://github.com/Micosz/Cs361-Group1-Project7/tree/feature/browse-shortcuts) |
| เมื่อค้นแล้วไม่มีรายการ หน้าเดิมมีข้อความบอกผลอยู่แล้ว แต่ต้องย้อนกลับไปลบคำค้น | เพิ่มปุ่มล้างคำค้นในพื้นที่ผลลัพธ์ว่าง | คนที่เลือกประเภท วันที่ หรือช่วงกิจกรรมไว้ต้องได้รายการที่ตรงเงื่อนไขเดิมหลังล้าง | ทดสอบบน [branch คำค้น](https://github.com/Micosz/Cs361-Group1-Project7/tree/feature/clear-result-search) · [Issue #267](https://github.com/Micosz/Cs361-Group1-Project7/issues/267) |
| บอร์ดข้อเสนอเดิมมีหน้ารายละเอียด ขั้นตอน และประวัติให้ลองใช้ | ใช้หน้ารายละเอียดเดิมทดสอบว่าผู้ส่งหาเรื่องของตนพบและรู้ว่าเรื่องอยู่ขั้นไหน | ทีมยังต้องยืนยันผู้รับเรื่องหลัก ระยะเวลารอ และขั้นตอนถัดไปเมื่อครบกำหนด | บันทึกเพื่อคุยต่อใน [Issue #235](https://github.com/Micosz/Cs361-Group1-Project7/issues/235) · [ต้นแบบเดิม #242](https://github.com/Micosz/Cs361-Group1-Project7/pull/242) |
| มีงานวัดหน้าแรกและงานเชื่อมข้อมูลที่ทีมรับไว้แล้ว | ติดตามผลผ่าน Issue เดิมของแต่ละงาน | การเปิดงานซ้อนทำให้เทียบผลงานและตามผู้รับผิดชอบยาก | ทีมติดตามที่ [V6 #257](https://github.com/Micosz/Cs361-Group1-Project7/issues/257) และ [V7 #258](https://github.com/Micosz/Cs361-Group1-Project7/issues/258) |

การตรวจปุ่มใช้ Tab, Enter และ Space ควบคู่กับการเลื่อนหน้าและการตั้งค่าลดการเคลื่อนไหว แนวทางอ้างอิงมาจาก [WAI-ARIA Button Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/) และ [WCAG Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html)

## วันกิจกรรมที่ตรวจจากต้นทาง

| กิจกรรม | ข้อความกำกับที่แนะนำ | เหตุผลและหลักฐาน |
| --- | --- | --- |
| CSTU Spark Camp in AI, Final Pitch | **จบแล้ว · 30 ก.ค. 2569** | กำหนดการของงานระบุวัน Final Pitch และข่าวของสาขายืนยันว่าได้จัดกิจกรรม การนับวันสุดท้ายนี้ใช้เฉพาะกิจกรรม [กำหนดการผู้จัด](https://v0-cstu-spark-camp-landing-page.vercel.app/session/final-pitch-day) · [ข่าวของสาขา](https://www.linkedin.com/posts/cstu-thammasatuniversity-aiplatformengineering-ugcPost-7494355090963615744-UwSS/) |
| AIST, Tsukuba | **จบแล้ว · รอยืนยันรอบ** | สำหรับผู้เข้าร่วมคู่เดียวกัน เว็บสาขาระบุ 10 มิ.ย.–17 ส.ค. 2563 ส่วนเว็บคณะระบุ 5 มิ.ย.–7 ส.ค. และ 25 ส.ค.–15 ก.ย. 2562 ทั้งสองแหล่งกล่าวถึงช่วงที่สิ้นสุดแล้ว ต้องยืนยันรอบก่อนลงวันสุดท้ายรายรายการ [เว็บสาขา](https://cs.sci.tu.ac.th/partnership-th/) · [เว็บคณะ](https://sci.tu.ac.th/all-exchange-students-th/) |
| โครงการนำร่อง Kansai University | **มีรายงานการเข้าร่วมราว ส.ค. 2569 · รอยืนยันวันสิ้นสุด** | สาขารายงานว่ากำลังเข้าร่วมเมื่อเผยแพร่โพสต์ในเดือนสิงหาคม โพสต์ไม่ได้ระบุวันจบ ให้เว้นช่องวันสิ้นสุดไว้ [โพสต์ของสาขา](https://www.linkedin.com/posts/cstu-computersciencetu-thammasatuniversity-ugcPost-7494355815647064064-GhgF/) |

## หลักฐานหน้าจอ

| สิ่งที่ตรวจ | ก่อน | หลัง |
| --- | --- | --- |
| จุดที่เริ่มเลือกหมวด | [Welcome เดิม](assets/information-board/welcome-before.jpg) | [แถบหมวดใต้ข้อความต้อนรับ](assets/information-board/welcome-after.jpg) |
| ตำแหน่งเมื่อถึงรายการ | [บอร์ดเดิม](assets/information-board/board-before.jpg) | [หมวดกิจกรรมที่เลือกยังอยู่](assets/information-board/board-after.jpg) |
| ย้อนขึ้นบนมือถือ | — | [แถบยังอยู่ที่ Exchange](assets/information-board/exchange-mobile.jpg) |
| ผลลัพธ์ว่าง | [ข้อความเดิม](assets/information-board/search-before.jpg) | [ปุ่มล้างคำค้น](assets/information-board/search-empty.jpg) · [ผลหลังล้างโดยคงประเภทมหาวิทยาลัย](assets/information-board/search-restored.jpg) |
