# Mock user สำหรับ #81

สำหรับบัญชีทดสอบบนเว็บออนไลน์ผ่าน Login ปกติ ใช้ [course-test-login.md](../../docs/deployment/course-test-login.md) แทน เครื่องมือด้านล่างเป็นทางเลือกสำหรับลองในเครื่องเท่านั้น

ใช้ลองเมนู, Session และสิทธิ์ด้วยข้อมูลสมมติในเครื่อง ไม่เรียก TU, AWS หรือ DynamoDB ไม่ต้องลง dependencies เพิ่ม ใช้ Python 3.12+

## เริ่มใช้

จาก root ของ repository บน branch `81-mock-users`:

```sh
python3 tools/mock-auth/server.py
```

เปิด **http://127.0.0.1:8765/mock.html** → เลือกบัญชี → กด **เข้าสู่ระบบบัญชีนี้** → กด **ดูเมนูหน้าเว็บเดิม** หรือ **เปิดพื้นที่ผู้ใช้ / จัดการบทบาท**

ถ้าพอร์ตซ้ำ: `python3 tools/mock-auth/server.py --port 8766` แล้วเปิด URL ที่คำสั่งแสดง ใช้ `127.0.0.1` ตาม URL เท่านั้น

หยุดด้วย Ctrl+C รันใหม่เพื่อ reset บัญชี บทบาท Session และข้อมูลทั้งหมด ไม่มีข้อมูลถูกเขียนลงไฟล์หรือ AWS

## บัญชีที่มีให้

| บัญชี | ผลที่ลองได้ |
| --- | --- |
| นักศึกษา A / B | เห็น Exchange ของตนเอง เปิดของอีกคนไม่ได้ |
| ผู้ประสานงาน | อ่าน Exchange ที่รับผิดชอบใน `cs-demo` |
| เจ้าหน้าที่หลักสูตร | อ่าน Exchange ใน `cs-demo` |
| ผู้บริหาร | อ่านข้อมูลตาม policy แต่ไม่มี supportingInfo/ข้อมูลผู้เข้าร่วม |
| พนักงานไม่มีบทบาท | Login ได้ แต่เรียก Exchange ไม่ได้ |
| ผู้มอบหมายบทบาท | มี scoped manageRoles; ไม่มีสิทธิ์อ่าน Exchange อัตโนมัติ |
| หลายบทบาท | student + coordinator; My Exchange ยังใช้เฉพาะสิทธิ์ student |
| ผู้ไม่ Login | กดออกจากระบบแล้วลอง API ต้องถูกปฏิเสธ |

รหัสผ่านบัญชีจำลองทุกคนคือ `mock` หากต้องการลองฟอร์ม `/login.html` โดยตรง username อยู่ใน `server.py` หน้า mock เลือกบัญชีให้โดยไม่ต้องพิมพ์เอง

## ลองมอบหมาย/ถอนบทบาท

1. เลือกผู้มอบหมายบทบาทแล้วเข้าสู่ระบบ
2. เปิด “ดูรหัสผู้ใช้สำหรับลองมอบหมายบทบาท” คัดลอกรหัสของพนักงานที่ยังไม่มีบทบาท
3. เปิดพื้นที่ผู้ใช้ → จัดการสิทธิ์ผู้ใช้ → เลือก `cs-demo` → วางรหัส → ค้นหาบัญชี
4. ยืนยันตัวตนจำลอง เลือกบทบาทแล้วบันทึก กลับหน้า mock เลือกบัญชีพนักงานและ Login เพื่อดูสิทธิ์ที่มอบหมาย
5. ผู้มอบหมายถอนบทบาทด้วยการไม่เลือกบทบาทใดแล้วบันทึก Session เก่าของเป้าหมายต้องถูกปฏิเสธ เมื่อ Login ใหม่ต้องไม่คืนสิทธิ์ที่ถอน

ทุกแท็บใน browser เดียวกันใช้บัญชีเดียวกัน ถ้าต้องการผู้มอบหมายกับเป้าหมาย Login พร้อมกัน ใช้ browser คนละตัวหรือหน้าต่างส่วนตัว เมื่อสลับบัญชีที่ mock แล้วกลับไปแท็บเว็บ เมนูจะ refresh ตาม Session

## ขอบเขต

- เรียก `AuthApplication`, `AccountService`, `RoleService`, `SessionService` และ PermissionGateway จริง โดยแทน provider/store ด้วยข้อมูลในหน่วยความจำ
- Fixture bootstrap มอบบทบาทให้บัญชีที่กำหนดไว้บน server การ Login ไม่รับ role จาก browser
- มี API อ่าน Exchange จำลองสามรายการ สำหรับ own-record/cross-user/cross-scope และ field filtering การเขียนข้อมูลธุรกิจ/อัปโหลดไฟล์ยังไม่จำลอง (405/404)
- ใช้ local cookie `cstuhub_mock` แบบ HttpOnly/SameSite=Lax ผ่าน HTTP loopback ตัว server แปลง cookie/Origin ที่ตรวจแล้วเข้าหาสัญญา production ภายใน **ไม่ได้ทดสอบ Secure cookie/HTTPS จริง** และไม่แก้ cookie policy ของ production
- ผูก server เฉพาะ `127.0.0.1` ตรวจ Host/Origin ไม่รองรับเปิดผ่าน LAN ห้าม deploy เครื่องมือนี้เป็น production
- เปิด auth-config เฉพาะ response ของ local server เท่านั้น ไฟล์ `public/assets/auth-config.js` จริงยัง `enabled:false`
- เครื่องมืออยู่นอก `public/` จึงไม่ถูกนำขึ้น Amplify build เดิม ไม่มีการเปลี่ยน workflow deploy หรือเปิด AWS
- เมนูธุรกิจที่ยังไม่พัฒนาจะยังเป็น workspace landing การมี role ไม่ได้สร้างหน้าที่ขาดให้เอง
- Rate limit จำลองผ่อนเป็นบัญชีละ 30/IP 200 ครั้งต่อ 5 นาที เพื่อให้สลับบัญชีได้สะดวก ไม่ใช่ quota ของ production

## ตรวจแบบสั้น

```sh
python3 -m unittest discover -s tools/mock-auth -p 'test_*.py' -v
```

มี 3 checks: local Origin/cookie/Logout, สิทธิ์อ่านแต่ละ role และมอบหมาย/อ่านกลับ/ถอนบทบาทพร้อม Session revocation ทั้งหมดเป็น localhost/synthetic ไม่ใช่ TU/AWS verification
