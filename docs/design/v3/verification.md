# V3-B1 baseline verification

ตรวจวันที่ **8 ตุลาคม 2026 (Asia/Bangkok)** สำหรับ #72/#66/#90/#91/#92/#93

## ตรวจอะไรแล้ว

1. **Source/evidence pass:** อ่าน issue bodies ทั้ง 6 งาน, #82/#94–#111, Role Diagram จริงใน PR #67, V2 ADR/data docs, script reconstruction, old migration script และ backup snapshot; inventory จริง 26 records, primary refs ไม่ orphan, IDs ไม่ซ้ำ กิจกรรมทั้ง 13 มี period_date ไม่สรุป production schema จาก snapshot
2. **Design consistency pass:** เทียบ Matrix กับ field/route permissions, student read-only vs participants, executive no-personal/write, staff scope, role-manager capability แยกจาก staff; ทุก write ใช้ Origin/CSRF/field allowlist และ version validation แยกการสร้าง scope กับการแก้ scope
3. **Requirement coverage pass:** เติม MoU/MoA enum, history create/edit/order/ref validation, activity/co-host/agreement cardinality, responsible/participant account links, agreement renewal/status, exchange transitions/supportingInfo, document audience และ role workspaces ตาม implementation issues ที่มีอยู่
4. **Document/artifact pass:** ตรวจ relative links, fenced JSON examples parse ได้, inventory hash/count ตรง source, decision B1–B7 และ acceptance A01–A12 ไม่ซ้ำ, ไม่มี conflict markers/trailing whitespace; ดู machine summary ใน [validation.json](validation.json)

## สิ่งที่เลือกให้ทั้งชุดใช้ตรงกัน

| Concern | Baseline rule |
| --- | --- |
| บทบาท/scope | grant + curriculum + responsibility/participant intersection; deny by default; ไม่เชื่อ role จาก frontend |
| Identity | local UUID + verified provider link; provisional no-role เท่านั้น; name/email ไม่ให้สิทธิ์ |
| Session | opaque cookie, idle30m/absolute8h, authzVersion check/revoke, same-origin routing ต้องพิสูจน์ |
| Writes | body allowlist, record version, field-level permission และ authz recheck at commit |
| Public | allowlist/compatibility DTO + public-only backup; contacts/users/docs ไม่ export |
| Dates | Public activity day inclusive; agreement/exchange interval overlap; พ.ศ. เฉพาะ presentation |
| Documents | inherited parent+audience, private backend stream; student download own participant files ไม่มี upload |
| Legacy | stable IDs, explicit-public normalization, responsible=[]/unverified identity ไม่เปิดสิทธิ์ |

## ไม่ได้ตรวจหรือทำในงานนี้

- ไม่มี V3 runtime/Session/TU Login implementation จึงไม่มีผลทดสอบ allow/deny จริงสำหรับ A01–A12
- ไม่ใช้ credentials, ไม่ยืนยัน TU endpoint/key/quota/immutable ID จากบริการจริง, ไม่แก้ AWS/config/IAM/storage
- ไม่รัน migration, ไม่พิสูจน์ deployment proxy/cookie/file-size support, ไม่ทำ production smoke ใหม่
- ไม่อ้างว่าผู้ใช้หรือทีมอ่านรายละเอียดแล้ว ผู้ใช้ขอชุด baseline เพื่ออ่านภายหลัง เก็บ decision choices แยกจาก provider/runtime gates ใน [index](README.md)

**ผล:** เอกสารพร้อมใช้เป็น V3-B1 design baseline และส่งต่อ implementation; การปิด Issues ชุดออกแบบหากดำเนินการหมายถึงส่งมอบ baseline ตามคำขอ ไม่ใช่การอนุมัติ production deployment หรือปิด gates ที่ยังค้าง
