# V5 · Infrastructure as Code และ Auto Deploy

CSTUHub ใช้ AWS Singapore (`ap-southeast-1`) สำหรับ production และชุดทดลอง V5 ตาม [Issue #246](https://github.com/Micosz/Cs361-Group1-Project7/issues/246) และ [Issue #247](https://github.com/Micosz/Cs361-Group1-Project7/issues/247) งาน IaC ระยะแรกสร้างระบบแยกด้วยข้อมูลจำลองจาก checkout ใหม่ ทรัพยากร production ใช้เป็นข้อมูลอ้างอิงก่อนพิจารณานำเข้าทีละส่วน

## ขอบเขตของ CloudFormation

| Stack | ทรัพยากรและ input | Output ที่ใช้ต่อ |
| --- | --- | --- |
| `<trial>-frontend` | Amplify Hosting app/branch แยกจาก Git และ bucket เก็บ ZIP แบบ versioned ใช้ `TrialName` และเปิด `ConnectBackend` หลัง Backend พร้อม | `AppId`, `Origin`, `ArtifactBucket` |
| `<trial>-data` | DynamoDB หกตารางและ S3 เอกสาร ใช้ `TrialName` และ `DocumentOrigin` จาก Amplify | ชื่อตารางหกตัวและ bucket ส่งให้ Backend ผ่าน CloudFormation exports |
| `<trial>-backend` | Lambda สี่ตัว, execution roles สามตัว, log groups ของ trial, HTTP API และ permission ของแต่ละ route ใช้ exports ของ Data, origin, version ของ ZIP ทั้งสี่ และ version ของ secret ทดลอง | `ApiEndpoint` พร้อม stage `default` ส่งให้ Amplify, `PublicFunctionName` ใช้ตรวจ Lambda ที่ไม่มี route |

ใช้ CloudFormation โดยตรงเพื่อแสดงทรัพยากรและผลใน Change Set ตามบท Module 11 และ Guided Lab ของ CS361 และใช้ ZIP ที่สคริปต์เดิมสร้างอยู่แล้ว ลำดับสร้างคือ Frontend รอบแรก → Data → seed/อัปโหลด ZIP → Backend → Frontend รอบต่อเพื่อผูก rewrite การแยก Data ทำให้ทบทวนการเปลี่ยน schema และ retention แยกจากการเปลี่ยน API หรือโค้ด

## สิ่งที่เทียบกับ production

ตรวจ AWS Console แบบอ่านอย่างเดียวเมื่อ 8 พ.ย. 2026 ใน Singapore ข้อมูลในตารางนี้เป็น snapshot ของ configuration ณ วันตรวจ

| ตาราง production | PK / SK | TTL | ค่าในชุดทดลอง |
| --- | --- | --- | --- |
| `CSTUHub-Users` | `id` / — | — | on-demand, PITR, เก็บไว้เมื่อถอด stack |
| `CSTUHub-IdentityLinks` | `subjectKey` / — | — | on-demand, PITR, เก็บไว้ |
| `CSTUHub-Sessions` | `tokenHash` / — | `ttl` | on-demand, ลบพร้อม stack |
| `CSTUHub-LoginRate` | `key` / — | `expiresAt` | on-demand, ลบพร้อม stack |
| `CSTUHub-Partner` | `id` / `type` | — | on-demand, PITR, เก็บไว้ |
| `CSTUHub-Business` | `id` / — | `ttl` | on-demand, PITR, เก็บไว้, GSI `scope-entity-id` ใช้ `scopeEntity` / `id` และ `KEYS_ONLY` |

เปิด PITR บนตารางถาวรของชุดทดลอง ขณะที่ Sessions และ LoginRate บน production ที่ตรวจมี PITR เปิดอยู่ สองตารางทดลองนี้เก็บข้อมูลชั่วคราวและลบพร้อม stack ตารางถาวรและ S3 ใช้ `RetainExceptOnCreate` กับ `UpdateReplacePolicy: Retain` หากการเปลี่ยนจำเป็นต้องแทนที่ทรัพยากรที่มีชื่อคงที่ ให้สร้างชื่อชุดใหม่และจัดการการคัดลอก/ตรวจข้อมูลเป็นงานแยก เมื่อ Backend ยัง import outputs อยู่ CloudFormation จะกันการลบ Data Stack ไว้

Bucket เอกสารทดลองใช้ Block Public Access ครบสี่ค่า, Bucket Owner Enforced, SSE-S3, versioning และนโยบายบังคับ HTTPS ตั้ง CORS เฉพาะ origin ทดลอง ใช้กฎ staging และ ready จากไฟล์ตั้งค่าเดิม Production ยังมีกฎ `ExpireTemporaryMigrationArchive` สำหรับงานย้ายเก่า ชุดทดลองไม่มีข้อมูลชนิดนั้น Bucket policy สำหรับ HTTPS มี retention เช่นเดียวกับ bucket เพื่อให้การบังคับใช้คงอยู่หลังลบ stack

| Lambda production | Runtime / handler | Architecture | Memory / timeout |
| --- | --- | --- | --- |
| `CSTUHubAuth` | `python3.12` / `backend.lambda_function.handler` | x86_64 | 256 MB / 90 s |
| `tuAuthLogin` | `nodejs24.x` / `index.handler` | arm64 | 128 MB / 15 s |
| `fetchPartnersData` | `nodejs24.x` / `index.handler` | x86_64 | 128 MB / 3 s |
| `getPublicPartners` | `nodejs24.x` / `index.handler` | arm64 | 128 MB / 3 s |

HTTP API ใช้ stage `default` และ payload 2.0 ทั้งสี่ route ได้แก่ `ANY /api/{proxy+}` ไป Auth, `ANY /fetchPartnersData` ไป Fetch และ `POST /login` กับ `ANY /tuAuthLogin` ไป TU adapter การตรวจ `getPublicPartners` ทำผ่าน Lambda invoke โดยไม่มี route เพิ่ม Python ใช้ adapter ของ trial ผ่าน `TU_AUTH_FUNCTION_NAME` และ role invoke ได้เฉพาะ ARN ของ adapter ชุดนั้น เมื่อ production ไม่มีตัวแปรนี้ แอปใช้ชื่อ `tuAuthLogin` เดิม

Secrets Manager เก็บ CSRF secret, identity HMAC และข้อมูลยืนยันบัญชีจำลองแยกตามชื่อ trial CloudFormation ใช้ dynamic references แบบระบุ version เพื่อให้ trial และ rollback ใช้เวอร์ชันที่เลือกไว้ได้ สิทธิ์อ่าน configuration ของ Lambda ยังต้องจำกัด เพราะค่า resolve แล้วอยู่ใน environment ของฟังก์ชัน ชุดทดลองใช้บัญชีจำลองที่สร้างใหม่และไม่มี TU key จึงไม่ส่งรหัสผ่านไปยังระบบ TU

## ใครเปลี่ยนอะไร

| เป้าหมาย | ผู้จัดการ | ขอบเขต |
| --- | --- | --- |
| โค้ด Lambda production | [Lambda deploy workflow](../../.github/workflows/lambda-deploy.yml) จาก `main` | เทสต์, แพ็ก, preflight, สำรอง version และอัปเดต ZIP ของสี่ฟังก์ชันที่มีอยู่ |
| CloudFormation trial | [Infra validation](../../.github/workflows/infra-validate.yml) และผู้ตรวจ Change Set | CI lint อย่างเดียว ผู้ปฏิบัติงานเตรียมและ execute Change Set ของ trial จาก CLI |
| โค้ด Lambda trial | Backend Stack | อ้าง S3 object version ของ ZIP แต่ละตัวเพื่อให้ย้อนกลับได้ |
| Frontend production | Amplify app เดิมและ Git branch `main` | Amplify สร้างเว็บจาก repo และใช้ rewrite ที่ผูกกับ app เดิม |
| Frontend trial | Frontend Stack และ Amplify manual deployment | Stack ดูแล app, branch และ rewrite การปล่อยไฟล์ static แยกจาก Change Set |

แผนสำหรับทรัพยากรเดิมคืออ้างอิงชื่อและ ARN ไว้ก่อน ส่วนการนำทรัพยากรเดิมเข้า CloudFormation ต้องเทียบค่าที่เป็นเจ้าของจริง ตรวจ drift และวางแผนย้อนกลับแยกตามทรัพยากร ให้ทีมตรวจ Change Set และผลกระทบก่อนดำเนินการกับ production การกู้ข้อมูลจริงจาก backup เป็นงานคนละส่วนกับการสร้าง infrastructure

ดู [คู่มือทดลองและกู้คืน](../deployment/v5-trial.md) และ [ภาพสถาปัตยกรรม V5](../architecture/v5/v5-iac.drawio)
