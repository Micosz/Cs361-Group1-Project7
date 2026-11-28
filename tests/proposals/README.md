# ทดสอบกระดานข้อเสนอข้ามบัญชี

จากราก repo ใช้ Node และ Python ตามชุดทดสอบเดิม พร้อม OpenSSL และ Chromium ของ Playwright

```sh
npm ci
python3 -m pip install -r backend/lambda/CSTUHubAuth/requirements.txt
npx playwright install chromium
npm run test:proposals
```

หากมี Chromium ในเครื่องแล้ว ให้กำหนด `CSTU_CHROMIUM` เป็น path ของ executable หากต้องการบันทึกภาพจอระหว่างรัน ให้กำหนด `CSTU_PROPOSAL_EVIDENCE_DIR` เป็นโฟลเดอร์ผลลัพธ์

ชุดทดสอบเปิดหน้า Login จริงในเบราว์เซอร์คนละบริบท แล้วเข้ากระดานจากหน้าทำงาน เซิร์ฟเวอร์ HTTPS บน loopback เรียกตัวจัดการ API ของแอป ส่วนผู้ให้บริการบัญชี ฐานข้อมูล ที่เก็บไฟล์ และนาฬิกาใช้ชุดจำลองร่วมกัน การรีโหลดหน้าและการเปิดบริบทเบราว์เซอร์ใหม่จึงอ่านเรื่องและไฟล์เดิมได้จนกว่าเซิร์ฟเวอร์ทดสอบจะสิ้นสุด

ไฟล์ [ร่างฉบับที่ 1](fixtures/mou-demo-v1.pdf) และ [ร่างฉบับที่ 2](fixtures/mou-demo-v2.pdf) เป็นเอกสารสมมติของเรื่องเดียวกันตาม [Issue #287](https://github.com/Micosz/Cs361-Group1-Project7/issues/287) ฉบับที่ 2 แก้ข้อ 3 เรื่องผู้ส่งสรุป ผู้รับ และกำหนด 14 วัน
