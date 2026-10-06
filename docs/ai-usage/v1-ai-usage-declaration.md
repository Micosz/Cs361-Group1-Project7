# Version 1: AI Usage Declaration

## สมาชิกคนที่ 1: นายชนกานต์ คงรัชตภิญโญ

### Tool Used
ChatGPT

### Type of Work and Output Used
ใช้ AI ช่วยจัดโครงสร้างและร่างข้อความสำหรับเอกสารของ V1 โดยนำข้อมูลจาก Project Requirements, Issues, Acceptance Criteria และเอกสารที่จัดทำไว้เเล้ว มาสรุปและเรียบเรียงให้อยู่ในรูปแบบ .md, ใช้ช่วยเปรียบเทียบทางเลือกสำหรับการ Hosting บน AWS

### Verification and Modifications
ตรวจสอบผลลัพธ์จาก AI เทียบกับ Project Requirements, Issues, Acceptance Criteria, ขอบเขต V1 และไฟล์ `partners.json` ที่ทีมใช้งานจริงก่อนนำไปใช้ มีการตัดเนื้อหาที่อยู่นอกขอบเขต ปรับชื่อไฟล์และ Path ให้เหมาะสม

## สมาชิกคนที่ 2: นายวุฒิกร บุญทวี

### Tool Used

Gemini Pro

### Type of Work and Output Used

ใช้ AI ช่วยออกแบบ Data Dictionary และปรับปรุงข้อมูลใน `partners.json` เช่น การกำหนด Field และการแก้ไข Path ของรูปภาพ นอกจากนี้ ใช้ช่วยปรับฟังก์ชัน `openModal` ให้ดึง Logo, รูปภาพ และ `full_description` มาแสดงผลแบบ Dynamic

### Verification and Modifications

ตรวจสอบและปรับปรุงโค้ด JavaScript และ HTML ที่ได้รับ โดยตรวจสอบการเชื่อมโยงข้อมูลจาก JSON และ Path ของรูปภาพ แก้ไขกรณีข้อมูลแสดงไม่ครบหรือไม่ถูกต้อง

## สมาชิกคนที่ 3: นายศุภวิชญ์ ไม้จัตุรัส

### Tool Used

Gemini

### Type of Work and Output Used

ใช้ AI ช่วยวิเคราะห์ และปรับปรุง Front-end สำหรับ Reusable Popup ซึ่งใช้แสดงรายละเอียดของการ์ดแต่ละรายการ เเละช่วยในฟังก์ชัน `openModal` สำหรับดึงข้อมูลจาก JSON มาแสดงแบบ Dynamic การเพิ่ม Animation และการปรับการแสดงผลของรูปภาพ

### Verification and Modifications

ตรวจสอบและปรับโค้ดให้รองรับกรณีข้อมูลในบาง Field ไม่มีค่า เช่น รูปภาพหรือสถานที่ เพื่อป้องกัน Error การแก้ไขจำกัดเฉพาะส่วนที่เกี่ยวข้องกับ Modal

## สมาชิกคนที่ 4: นายสุทธิพจน์ สุวรรณสุทธิ์

### Tool Used

Google Gemini

### Type of Work and Output Used

ใช้ AI ช่วยเขียนและปรับปรุงโค้ด HTML, CSS และ JavaScript สำหรับหน้าหลัก เช่น โครงสร้างหน้าเว็บ การแสดงข้อมูลจาก `partners.json` และช่วยในการปรับหน้าเว็บให้รองรับ Desktop และ Mobile

### Verification and Modifications

ตรวจสอบการแสดงผลบน Desktop และ Mobile เมื่อพบปัญหา เช่น Animation ทับปุ่ม การ์ดถูกบีบอัด หรือข้อความตกบรรทัด ได้ส่งภาพปัญหาให้ AI วิเคราะห์และนำคำแนะนำมาปรับ