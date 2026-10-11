# AI Guides สำหรับงานย่อย #82–#86

ส่งไฟล์ `issue-<number>.md` ของงานนั้นให้ AI ของเพื่อนได้เลย ทุกไฟล์มีบริบทโครงการและกติกาจุดต่อในตัว ไม่ต้องพึ่งประวัติแชทนี้ อ่าน Issue/PR ล่าสุดก่อนเริ่ม เพราะ snapshot นี้อาจเปลี่ยน

อ้าง main `e21750907ffed9f379a9d3d61a6be097a45f0385` วันที่ 11 ตุลาคม 2026 · เอกสารเท่านั้น ไม่เพิ่ม runtime code หรือ deploy

| Parent | Guide รายงานย่อย |
| --- | --- |
| [#82](https://github.com/Micosz/Cs361-Group1-Project7/issues/82) | [#94 — Partner และ Contact](issue-94.md), [#95 — ประวัติความร่วมมือจากข้อมูลเดิม](issue-95.md), [#96 — Activity และผู้รับผิดชอบ](issue-96.md), [#97 — เชื่อม Activity กับ Partner และ Agreement](issue-97.md) |
| [#83](https://github.com/Micosz/Cs361-Group1-Project7/issues/83) | [#98 — ฟอร์มและรายละเอียดข้อตกลง](issue-98.md), [#99 — คู่สัญญา ผู้รับผิดชอบ และช่วงวัน Agreement](issue-99.md), [#100 — สถานะและต่ออายุ Agreement](issue-100.md) |
| [#84](https://github.com/Micosz/Cs361-Group1-Project7/issues/84) | [#101 — พื้นที่เก็บเอกสารส่วนตัวและ upload](issue-101.md), [#102 — แนบ metadata เอกสารกับรายการ](issue-102.md), [#103 — เปิดและดาวน์โหลดเอกสารตามสิทธิ์](issue-103.md) |
| [#85](https://github.com/Micosz/Cs361-Group1-Project7/issues/85) | [#104 — ฟอร์มและรายละเอียด Exchange](issue-104.md), [#105 — ผู้เกี่ยวข้องและช่วงวัน Exchange](issue-105.md), [#106 — สถานะและข้อมูลประกอบ Exchange](issue-106.md), [#107 — My Exchange](issue-107.md) |
| [#86](https://github.com/Micosz/Cs361-Group1-Project7/issues/86) | [#108 — Assigned Work ของผู้ประสานงาน](issue-108.md), [#109 — Management ของเจ้าหน้าที่](issue-109.md), [#110 — Overview ของผู้บริหาร](issue-110.md), [#111 — Search/Filters และ Responsive Workspaces](issue-111.md) |

## ภาพรวมหน้าเว็บที่ใช้ร่วมกัน

- #94/#96 เจ้าของ form/detail Partner/Activity; #95 ใช้ sourcesเดิมเป็นประวัติ แต่ต้อง reconcile body/schemaเดิมก่อนเปลี่ยน contract; #97 ต่อ linksกับ Agreement
- #98 เจ้าของ Agreement form/detail ที่เปิดจาก Event & Activity; #99/#100 ต่อ fields/statusในชุดนั้น ยังไม่ได้ปิดรวมสาม Issuesเป็นหนึ่ง
- #101/#102/#103 ต่อ upload/metadata/download sectionใน detail Agreement/Exchange ไม่มี public document library
- #104 เจ้าของ Exchange form/detail; #105/#106 ต่อผู้เกี่ยวข้อง/status; #107 เป็น student read-only My Exchange
- #108/#109/#110 เป็นรายการงาน/ทางเข้า coordinator/staff/executive ใช้ formsเดิม; #111 ต่อ filters/count/pagination/responsive
- #80 ใช้ role menuเดิมจาก #73 ร่วมกับ #86 เป็น dependency ไม่ใช่ sub-issueจริงของ #86 จึงไม่สร้าง guide/เมนูซ้ำ

## จุดตัดสินใจที่ต้องเห็นก่อนใช้

1. #95 bodyเก่ายังมีเหตุการณ์แยก; แนวล่าสุดใช้กิจกรรม/ข้อตกลงเดิมไม่กรอกประชุมซ้ำ AIต้องแจ้งและ reconcile #95/#91/#92 ก่อนเปลี่ยน API/model ไม่ลบ legacy routeตามใจ
2. MoU activity_tagsใช้จริงแล้วแต่ V3 allowlistยังต้องต่อ ไม่ให้ข่าว publicทำให้ Agreement/docเผยแพร่
3. #147 PartnerRepositoryเป็น memory prototypeห้ามฉีดในproduction; #123/#146 Draftยังไม่main / คู่มือเก่า #146เขียนก่อน #147 ให้ยึดสถานะล่าสุดและไม่เขียนส่วนเดิมซ้ำ
4. /overview, user selectors, type/status/date protected filters, private file streaming และ persistent business repositoriesยังต้องimplement/verify; routesใน designไม่ใช่ deployed endpoints

## การใช้ในแชทของเพื่อน

แนบไฟล์ของ Issue แล้วส่งว่า: “ช่วยทำ Issue นี้ใน repoของฉันตาม guide ตรวจ main/PRล่าสุดก่อน ใช้ของที่มีแล้ว ทำเฉพาะส่วนที่ขาดและรายงานผล/ข้อจำกัดตามจริง” หาก AIอ่าน GitHubไม่ได้ให้แนบไฟล์ source/designที่ระบุใน guideเพิ่ม อย่าให้มันเดา APIหรือสิทธิ์
