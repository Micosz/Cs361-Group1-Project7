# Scope and Permission Matrix — #66

**V3-B1 · baseline choices · 8 October 2026** · [สารบัญ/ข้อจำกัด](README.md)

## Scope

ส่งจริง: Public V2 เดิม, TU Login + account linking + Session/logout, role assignments, เพิ่ม/แก้ partner/contact/activity, สร้าง/แก้ agreement + status/renewal, เอกสาร private, สร้าง/แก้ exchange/participants/status, My Exchange และ coordinator/staff/executive workspaces พร้อม keyword/type/date filters ที่ระบุใน API contract

เลื่อน/ไม่รวม: Feedback หลายแหล่ง, เชื่อมข้อมูลระบบอื่น, analytics เชิงลึก/ส่งออกรายงาน, สมัครโครงการ/approval workflow, ลบ, follow/notifications, บัญชีคู่ความร่วมมือ/ศิษย์เก่า และ auto-sync/scheduled backup ไม่ตีความว่าแนวคิดทั้งหมดใน Role Diagram ต้องส่ง V3

## นิยามขอบเขต

- `public`: รายการที่ถูกเผยแพร่พร้อม field allowlist; anonymous และทุกบทบาทอ่านได้
- `curriculum`: record อยู่ใน `scopeIds` ที่มอบหมายให้ user ในบทบาทนั้น
- `assigned`: user อยู่ใน `responsibleUserIds` ของ record **และ** มี coordinator grant ใน curriculum เดียวกัน
- `participant`: user อยู่ใน `participantUserIds` ของ exchange **และ** มี student grant ใน curriculum เดียวกัน; เป็น own exchange view ไม่ได้สิทธิ์แก้ไข
- role ที่อยู่คนละ curriculum ใช้ข้าม scope ไม่ได้; `createdBy` ไม่ให้สิทธิ์อ่าน/แก้อัตโนมัติ
- default deny; หลายบทบาทรวมเฉพาะ grant/action/scope ที่ตรงกัน ไม่รวม scope ของ role หนึ่งเข้ากับ action ของอีก role หนึ่ง

## Matrix

`R` อ่าน, `C` สร้าง, `U` แก้ไข, `S` เปลี่ยนสถานะ, `F` อัปโหลด, `D` ดู/ดาวน์โหลดเอกสาร; `—` ปฏิเสธ ทั้งหมดบังคับที่ backend

| Resource / Action | Anonymous / no-role | Student | Coordinator | Staff | Executive |
| --- | --- | --- | --- | --- | --- |
| Public partner/activity/detail/search | R public | R public | R public | R public | R public |
| Internal partner/contact/history | — | — | R/U assigned; ประวัติเพิ่ม/แก้ได้ | R/C/U curriculum; ประวัติเพิ่ม/แก้ได้ | R partner/history curriculum non-personal; contact — |
| Activities + partner/agreement links | — | — | R/U assigned; C ใน grant scope โดย assign ตนเอง | R/C/U curriculum | R curriculum non-personal |
| Agreements + responsibility/dates/renewal/status | — | — | R/C/U/S assigned (create assign ตนเอง) | R/C/U/S curriculum | R curriculum non-personal |
| Exchanges + partners/dates/participants/status | — | R participant projection | R/C/U/S assigned (create assign ตนเอง) | R/C/U/S curriculum | R curriculum non-personal ไม่เห็น participant identity |
| Agreement documents | — | — | F/D assigned parent | F/D curriculum parent | D curriculum เมื่อ audience=`internal` |
| Exchange documents audience=`participants` | — | D participant; ไม่ upload | F/D assigned parent | F/D curriculum parent | — |
| Exchange documents audience=`internal` | — | — | F/D assigned parent | F/D curriculum parent | D curriculum ถ้าไม่เป็น personal |
| Participant/user account details | — | เฉพาะตนผ่าน `/auth/session` | เฉพาะ minimal identity ของ participants ใน assigned exchange | minimal identity สำหรับงาน curriculum | — |
| Internal overview/count/search | — | own exchange count | assigned count | curriculum count | curriculum non-personal count |
| มอบหมาย responsible users / scopes | — | — | คง assignment เดิม; ห้ามเพิ่ม/ย้าย scope | U curriculum; target ต้องมี grant ที่เหมาะสม | — |
| Role grants / revoke | — | — | — | เฉพาะผู้ถือ capability `manageRoles` | — |
| Delete / approve / global admin | — | — | — | — | — |

Student ไม่ได้สิทธิ์ protected จาก TU `type=student` อัตโนมัติ; ต้องมี application grant และ participant link Executive ไม่เป็น editor/admin การอ่าน internal ไม่รวม personal fields โดยอัตโนมัติ

## Role-manager และ bootstrap

`manageRoles` เป็น capability ทางเทคนิคแยกจาก business roles ใช้จัดการ student/coordinator/staff/executive grants ภายใน `managedScopeIds` เท่านั้น ไม่ให้สิทธิ์อ่านข้อมูลธุรกิจเพิ่ม

1. ผู้ดูแล deployment ที่ได้รับมอบหมายยืนยันตัวตน/หลักสูตรของผู้รับผิดชอบคนแรกนอกเว็บ แล้วใช้ขั้นตอน provisioning ฝั่ง server สร้าง `manageRoles` grant; ไม่มี public bootstrap endpoint และไม่ใช้ email/employee เดาเป็น admin
2. บันทึก actor/target/scope/action/time โดยไม่บันทึก credentials; ทดสอบคนไม่มี capability ส่ง role request แล้วได้ 403
3. role-manager เพิ่ม/ถอน **business** grants ในขอบเขตตนได้ แต่ห้ามแก้ grant/capability ของตน และห้ามมอบ `manageRoles` ผ่าน business-role API การหมุนเวียน role-manager ใช้ provisioning ที่ตรวจทานเช่นเดียวกับ bootstrap
4. ถอน role หรือเปลี่ยน scope ให้เพิ่ม `authzVersion`; request ถัดไปใช้ grants ล่าสุดและปฏิเสธ Session version เก่า ตาม [Session](authentication-session.md) ไม่รอ cookie หมดอายุ

No-role Login สำเร็จได้ แต่เห็น Public และคำอธิบายว่าให้ติดต่อผู้รับผิดชอบเพื่อมอบหมายสิทธิ์ ไม่มี auto-role จากหน้าฟอร์ม Role หลายตัวมี workspace selector แต่ไม่บังคับเลือก role เพื่อหลบ backend check

## ข้อมูลและตัวอย่าง allow/deny

Public: ชื่อ/type/summary/location/เว็บไซต์/logo และกิจกรรมที่เลือกเผยแพร่; internal: responsibility/history/status/renewal/notes; personal: identity, contacts ที่ไม่อนุญาตเผยแพร่, participants และเอกสารที่มีข้อมูลบุคคล เอกสาร personal ต้อง audience=`participants` และ executive อ่านไม่ได้

| Case | Allow | Deny |
| --- | --- | --- |
| student U1 มี grant C1, exchange E1 ใน C1 มี U1 participant | อ่าน E1 + participant-audience docs | อ่าน E2 ของ U2, PATCH E1, upload หรือดูรายชื่อคนอื่น |
| coordinator U3 ใน C1 ถูก assign E1 | แก้ business fields/สถานะและ upload E1 | เปลี่ยน `responsibleUserIds`, `scopeId`, `createdBy` หรือแก้ E2 ที่ไม่ assigned |
| staff U4 ใน C1 | สร้าง/แก้ข้อมูล C1 และ assign coordinator ที่มี grant C1 | เปิด C2, assign ผู้ไม่มี grant หรือให้ role ตนเอง |
| executive U5 ใน C1 | อ่านภาพรวม C1 และ internal non-personal details/docs | POST/PATCH ทุก business record, participant identity/personal docs |
| anonymous หรือ user ยัง no-role | public projection | protected list/detail/count/file แม้ทราบ ID/URL |
| role-manager | มอบ student grant ใน managed C1 | promote ตนเอง, มอบ capability, หรือ scope C2 |

เกณฑ์ implementation: ทุกแถวมี positive/negative direct API tests, field allowlists และ cross-scope cases ตาม [API](api-flows.md) รายการนี้คือ baseline ที่ผู้ใช้ขอให้จัดทำ ไม่อ้างว่ามีผู้ใช้จริงหรือ role-manager คนแรกแล้ว
