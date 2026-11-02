# คู่มือ Deployment V4 — CSTUHub

ปรับปรุงวันที่ 3 พฤศจิกายน 2026

ระบบหลักใช้บัญชี AWS `781485979426` และ Region Singapore (`ap-southeast-1`) คู่มือนี้ครอบคลุมการเตรียม configuration การปล่อย frontend/backend การตรวจระบบ และการย้อนกลับ โดยอิง workflow และสคริปต์ใน repository ส่วนสถานะทรัพยากรและผลการปล่อยแต่ละรอบบันทึกแยกใน release record

## 1. ปลายทางและขอบเขต

| ส่วน | ปลายทางตาม configuration ของโครงการ |
| --- | --- |
| เว็บหลัก | [CSTUHub](https://main.d1d0za87xu48iv.amplifyapp.com/) |
| Amplify | `d1d0za87xu48iv` / `CSTUHub-Singapore`, repository `Micosz/Cs361-Group1-Project7`, branch `main` |
| HTTP API | `gez448y9c5`, stage `default`, Region `ap-southeast-1` |
| Python Lambda | `CSTUHubAuth`, runtime `python3.12`, handler `backend.lambda_function.handler` |
| Node.js Lambda | `tuAuthLogin`, `fetchPartnersData`, `getPublicPartners`; ตรวจ runtime/handler/dependencies ของแต่ละตัวก่อนอัปเดต |
| DynamoDB | `CSTUHub-Users`, `CSTUHub-IdentityLinks`, `CSTUHub-Sessions`, `CSTUHub-LoginRate`, `CSTUHub-Partner`, `CSTUHub-Business` |
| S3 เอกสาร | `cstuhub-private-documents-781485979426-ap-southeast-1` |
| WAF ของ Amplify | ชื่อในเอกสารย้ายระบบ: `CSTUHub-Singapore-Firewall`; ตรวจ association และกฎที่ใช้อยู่ก่อนเปลี่ยน |

Singapore ถูกเลือกให้บริการหลักอยู่ใกล้ผู้ใช้ในไทยและอยู่ Region เดียวกัน การย้ายครั้งนี้ไม่ได้ตั้งระบบสลับ Region อัตโนมัติ ส่วน WAF ที่ผูกกับ Amplify ใช้ scope `CLOUDFRONT` และจัดการผ่าน `us-east-1`; ไม่ใช้ Regional web ACL แทน ดู [ข้อกำหนด WAF ของ Amplify](https://docs.aws.amazon.com/amplify/latest/userguide/amplify-waf-configuration.html)

การ deploy โค้ดไม่สร้าง VPC, subnet หรือ AZ เพิ่ม และไม่เปลี่ยนการเชื่อม VPC ของ Lambda งานโครงสร้างเครือข่าย การย้ายข้อมูล และ cache ต้องแยกจากการปล่อยโค้ดตามปกติ

## 2. ส่วนที่ deploy อัตโนมัติและส่วนที่ต้องจัดการแยก

| ส่วน | วิธีปล่อย | ขอบเขต |
| --- | --- | --- |
| Frontend | Amplify build จาก branch ที่เชื่อมไว้ | ใช้ `amplify.yml`, รัน `npm run build`, เผยแพร่ `public/` |
| `CSTUHubAuth` | GitHub Actions: `Package and deploy Auth Lambda` | แพ็ก Python และอัปเดตเฉพาะโค้ด Lambda |
| Node.js Lambda อีกสามตัว | แพ็กและอัปเดตแยกตาม function | ไม่รวมอยู่ใน workflow ของ Auth |
| HTTP API / Amplify rewrites | AWS Console หรือกระบวนการตั้งค่าของผู้ดูแล | ไม่เปลี่ยนตามการ deploy Python |
| Environment, IAM, S3, DynamoDB, WAF, monitoring | ตั้งค่าแยก | ต้องมี configuration และแผนย้อนกลับของงานนั้น |
| ข้อมูล catalog / migration | ดำเนินการแยกจาก code deployment | การแก้ JSON หรือ deploy หน้าเว็บไม่ sync DynamoDB อัตโนมัติ |

`npm run build` ปัจจุบันตรวจเพียงว่ามี `public/login/index.html` ไม่ใช่การทดสอบ frontend ทั้งระบบ และการที่ Amplify build ผ่านไม่ได้ยืนยันว่า Lambda เป็นโค้ดรุ่นเดียวกัน

## 3. Configuration ที่ต้องพร้อม

### Frontend และ HTTP API

- เชื่อม Amplify กับ repository และ branch ตามตารางปลายทาง ตรวจสิทธิ์การเข้าถึง repository และการเปิด auto build ใน Console
- ตั้ง rewrite `/api/<*>` และ `/fetchPartnersData` ไป HTTP API ใน Singapore โดยคง path และ stage ให้ถูกต้อง กฎ API ต้องอยู่ก่อนกฎ catch-all ที่ส่งกลับ HTML
- ใช้ HTTP API payload format `2.0` กับ `CSTUHubAuth` และตรวจ integration/สิทธิ์ invoke ของ API Gateway หลังเปลี่ยน target
- Frontend เรียก API ผ่านโดเมนเดียวกัน; `public/assets/auth-config.js` ใช้ `enabled: true` สำหรับระบบบัญชีและ workspace
- ตรวจ Session cookie และ `Set-Cookie` ผ่านเส้นทาง Amplify → API ให้ครบ ไม่ cache response ส่วนตัวหรือ response ของ Session
- หากใช้ preview branch ต้องตั้ง origin และ CORS ของ preview แบบเจาะจงก่อนทดสอบ ไม่เปิด wildcard เพื่อให้ทุกโดเมนเข้าถึงได้

### Environment ของ CSTUHubAuth

| ตัวแปร | ค่า / หน้าที่ |
| --- | --- |
| `AUTH_V3_ENABLED` | `true` เพื่อเปิด application routes ของระบบบัญชีและข้อมูลธุรกิจ |
| `SESSION_ORIGIN` | `https://main.d1d0za87xu48iv.amplifyapp.com` |
| `SESSION_ADDITIONAL_ORIGINS` | JSON array ของ origin เพิ่มเติมที่อนุญาต; ค่าเริ่มต้น `[]` |
| `SESSION_CSRF_SECRET` | Secret แบบ Base64 สำหรับ CSRF; เก็บนอก repository |
| `IDENTITY_HMAC_SECRET` | Secret แบบ Base64 สำหรับเชื่อมตัวตน; การเปลี่ยนต้องมีแผนจัดการ identity เดิม |
| `STUDENT_SCOPE_ID` | Scope ที่ใช้กำหนดสิทธิ์เริ่มต้นของนักศึกษา |
| `USER_TABLE` | `CSTUHub-Users` |
| `IDENTITY_TABLE` | `CSTUHub-IdentityLinks` |
| `SESSION_TABLE` | `CSTUHub-Sessions` |
| `LOGIN_RATE_TABLE` | `CSTUHub-LoginRate` |
| `PARTNER_TABLE` | `CSTUHub-Partner` |
| `BUSINESS_TABLE` | `CSTUHub-Business` |
| `BUSINESS_SCOPE_INDEX` | `scope-entity-id` ตามดัชนีของ Business table |
| `DOCUMENT_BUCKET` | `cstuhub-private-documents-781485979426-ap-southeast-1` |
| `DOCUMENT_DIRECT_UPLOAD_ENABLED` | `true` เมื่อ bucket และสิทธิ์สำหรับ direct upload พร้อม |
| `DOCUMENT_MAX_BYTES` | เพดาน PDF/DOCX; ค่าเริ่มต้นและเพดานสูงสุด 50 MiB |
| `DOCUMENT_IMAGE_MAX_BYTES` | เพดาน PNG/JPEG; ค่าเริ่มต้นสูงสุด 10 MiB และไม่เกินเพดานเอกสาร |
| `COURSE_TEST_ENABLED`, `COURSE_TEST_ACCOUNTS` | เปิดบัญชีทดลองเฉพาะช่วงที่ต้องใช้; configuration บัญชีต้องไม่อยู่ในไฟล์สาธารณะ |

`AWS_REGION` มาจาก Lambda runtime ไม่ต้องเพิ่มทับเอง ตัว Auth เรียก `tuAuthLogin` ใน Region เดียวกัน โดย `tuAuthLogin` ใช้ `TU_APP_KEY` และ `TU_AUTH_URL` เมื่อกำหนด ส่วน public catalog Lambda ใช้ `PARTNER_TABLE`

คง runtime, architecture, layer และ execution role เดิมระหว่าง code-only release สำหรับ direct upload คู่มือตั้งค่ากำหนด timeout 90 วินาที และพื้นที่ชั่วคราวอย่างน้อย 512 MiB; การเปลี่ยนค่าเหล่านี้ทำแยกจาก workflow deploy โค้ด

### DynamoDB

- เตรียมตารางและ key ให้ตรงกับ [Data guide](../data/data-guide.md): Users ใช้ `id`, IdentityLinks ใช้ `subjectKey`, Sessions ใช้ `tokenHash`, LoginRate ใช้ `key`, Partner ใช้ `(id, type)` และ Business ใช้ `id`
- ตรวจดัชนี `scope-entity-id` ที่ query ด้วย `scopeEntity` และ TTL attribute ของแต่ละตารางให้ตรงกับระเบียนจริง ไม่เปิด TTL ชื่อเดียวกันทุกตารางโดยอัตโนมัติ
- ตรวจข้อมูลเดิมและ reference ก่อน migration รักษา ID, scope, version และความสัมพันธ์ระหว่างรายการ
- การเพิ่ม index, ปรับ capacity หรือเปิด PITR เป็นงาน configuration แยก ไม่ได้เกิดขึ้นจากการปล่อย Lambda
- ไม่ใช้ `migrate.js` รุ่นเก่าซ้ำโดยไม่ตรวจตารางปลายทางและข้อมูลที่จะถูกเขียนทับ

## 4. IAM และเอกสารส่วนตัว

### แยกบทบาท deploy กับ runtime

| Role | หน้าที่ |
| --- | --- |
| `CSTUHubGitHubAuthDeployRole` | ให้ GitHub Actions อ่าน configuration, สำรอง version และอัปเดตโค้ดเฉพาะ `CSTUHubAuth` |
| Execution role ของ `CSTUHubAuth` เช่น `CSTUHubAuthExecutionRole` | ให้โค้ดทำงานกับตาราง, bucket, `tuAuthLogin` และ CloudWatch Logs ตามสิทธิ์ที่จำเป็น |

ตั้ง GitHub OIDC ด้วย provider `token.actions.githubusercontent.com` และ audience `sts.amazonaws.com` ใช้ [trust policy](../../deploy/policies/github-auth-trust.json) และ [deploy policy](../../deploy/policies/github-auth-deploy.json) ของโครงการ ค่า subject ในไฟล์ trust ผูกกับ repository และ branch `main` ของโครงการโดยเฉพาะ ต้องตรวจ subject ที่ GitHub ออกให้ก่อนเปลี่ยนรูปแบบหรือเพิ่ม GitHub Environment

Execution role ต้องมีสิทธิ์ DynamoDB สำหรับการอ่าน/เขียนและ `ConditionCheckItem` บนตารางที่ระบบใช้ รวมถึงสิทธิ์ index เมื่อ query ผ่าน GSI การเพิ่มสิทธิ์ให้ deploy role ไม่ได้แก้สิทธิ์ runtime ของ Lambda

### ไฟล์ตั้งค่า S3

| ไฟล์ | หน้าที่ |
| --- | --- |
| [public-access-block.json](../../private/s3/public-access-block.json) | เปิด Block Public Access ทั้งสี่ค่า |
| [ownership-controls.json](../../private/s3/ownership-controls.json) | ใช้ Bucket owner enforced |
| [encryption.json](../../private/s3/encryption.json) | เข้ารหัส SSE-S3 (`AES256`) |
| [versioning.json](../../private/s3/versioning.json) | เปิด Versioning สำหรับตรวจและอ่านไฟล์รุ่นที่แน่นอน |
| [cors.json](../../private/s3/cors.json) | อนุญาต POST/GET/HEAD จาก origin ที่ระบุ; ไฟล์มี origin Singapore และ Sydney เดิม |
| [bucket-policy-statements.json](../../private/s3/bucket-policy-statements.json) | Statement ปฏิเสธการส่งข้อมูลผ่าน HTTP ตามเงื่อนไขในไฟล์ |
| [cstuhub-auth-document-bucket-controls.json](policies/cstuhub-auth-document-bucket-controls.json) | ให้ execution role เรียก `s3:GetBucketPublicAccessBlock` เฉพาะ bucket เอกสาร |
| [runtime-version-read-policy.json](../../private/s3/runtime-version-read-policy.json) | เพิ่ม `s3:GetObjectVersion` เฉพาะ `documents/staging/*` และ `documents/ready/*` |
| [lifecycle-rules.json](../../private/s3/lifecycle-rules.json) | กฎเก็บ staging และรุ่นเก่าของไฟล์ |

JSON เหล่านี้เป็นต้นฉบับ configuration ต้องนำไปตั้งค่าใน AWS แยกจากการ deploy โค้ด รวม statement/rules กับค่าที่มีอยู่ โดยรักษานโยบายอื่นของ bucket และ execution role ไว้ ไฟล์ bucket-controls ให้เฉพาะสิทธิ์ตรวจ Block Public Access ไม่ใช่สิทธิ์ทั้งหมดสำหรับเอกสาร; runtime ยังต้องมี Get/Put/DeleteObject และสิทธิ์อ่าน version ตามเส้นทางใช้งาน

Lifecycle ตั้งให้ staging หมดอายุหลัง 1 วัน และลบรุ่นเก่าของ staging หลังเป็น noncurrent 1 วัน ส่วน ready ลบเฉพาะรุ่นเก่าหลังเป็น noncurrent 90 วัน ไม่ตั้งหมดอายุไฟล์ ready ปัจจุบัน การลบรุ่นเก่าเป็นการลบถาวร จึงต้องตรวจ prefix และไฟล์ที่ metadata ยังอ้างถึงก่อนใช้กฎ ดู [S3 Lifecycle expiration](https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-expire-general-considerations.html)

Direct upload ส่งไฟล์เข้า staging ด้วย presigned POST แล้วให้ backend ตรวจไฟล์ก่อนย้ายไป ready และบันทึก metadata ไฟล์จริงอยู่ S3; metadata และ `storageVersionId` อยู่ DynamoDB รายละเอียดการทำงานและข้อจำกัดอยู่ใน [Private document storage](../../private/s3/README.md)

## 5. ขั้นตอนปล่อยระบบ

### ก่อน merge

1. แยก branch และเปิด PR ระบุส่วนที่เปลี่ยน ผลตรวจ และวิธีย้อนกลับ ให้ทีม review ก่อน merge
2. ตรวจความเข้ากันได้ระหว่าง frontend/backend เพราะ Amplify และ Actions ทำงานคนละ pipeline ไม่รับประกันลำดับเสร็จ
3. หาก API เปลี่ยนแบบเข้ากันไม่ได้ ให้แบ่ง release: backend รองรับรูปแบบเก่าและใหม่ก่อน → frontend ใช้รูปแบบใหม่ → ถอดรูปแบบเก่าเมื่อพร้อม
4. เตรียม configuration ที่จำเป็นและบันทึกค่าเดิมโดยไม่ใส่ secret ลงเอกสาร PR หรือ log
5. ยืนยันว่ามี Git checkout ที่ใช้งานได้และ source ที่จะปล่อยอยู่ใน commit แล้ว ไม่แพ็กจากโฟลเดอร์สำเนาที่ `.git` ใช้งานไม่ได้

### Frontend — Amplify

1. Merge โค้ดที่ผ่าน review เข้า branch ที่เชื่อมกับ Amplify
2. เปิด Amplify → `CSTUHub-Singapore` → branch `main` ตรวจว่า build ของ commit นั้นเริ่มทำงาน หากไม่เริ่ม ให้ตรวจ auto build และการเชื่อม repository
3. ตรวจ Build และ Deploy ว่าสำเร็จ รวมถึง deployed commit และ rewrite rules
4. เปิดเว็บหลัก ตรวจหน้าและ API ที่เกี่ยวข้อง หากยังเห็นรุ่นเดิม ให้ตรวจไฟล์ที่โหลดและ cache ของเบราว์เซอร์ก่อนสรุปว่า deploy ล้มเหลว

สิ่งที่อยู่ใต้ `public/` จะถูกเผยแพร่ทั้งหมดตาม `amplify.yml` จึงไม่เก็บ ZIP, credentials, dump ฐานข้อมูล หรือเอกสารส่วนตัวไว้ในโฟลเดอร์นี้

### CSTUHubAuth — GitHub Actions

Workflow: [.github/workflows/lambda-deploy.yml](../../.github/workflows/lambda-deploy.yml)

- PR และ push ที่เปลี่ยน Python backend, packager, `deploy/` หรือ workflow จะเข้า pipeline; ไม่รวม `backend/tests/**` และ `backend/lambda/**`
- PR ตรวจ syntax และแพ็ก ZIP เท่านั้น ไม่ deploy AWS และไม่รัน test suite
- Push เข้า `main` ที่ตรง path filter จะแพ็กแล้ว deploy ผ่าน OIDC หรือสั่ง `Run workflow` บน `main` ได้
- การแก้เฉพาะ docs/frontend ไม่ทำให้ workflow Auth เริ่มอัตโนมัติ

ขั้นตอนใน workflow:

1. [Packager](../../scripts/package-auth-lambda.py) อ่าน Python source จาก commit และสร้าง ZIP พร้อม `SOURCE_COMMIT` ไม่รวม tests, Node.js Lambda หรือไฟล์ local
2. สร้าง artifact `auth-<commit>` เก็บ 7 วัน ไม่ commit ZIP กลับ repository
3. [Deploy script](../../deploy/deploy-auth.py) ตรวจ AWS account, Region, function, runtime, handler และ commit ว่าตรงกับ `main` ล่าสุด
4. สำรองโค้ดเดิมเป็น published version หรือใช้ version เดิมที่ code/config ตรงกัน แล้วบันทึกหมายเลขใน Actions Summary
5. ใช้ `RevisionId` ป้องกันเขียนทับการเปลี่ยน configuration ระหว่าง deploy และอัปเดตเฉพาะโค้ด
6. รอ Lambda อัปเดตเสร็จ ตรวจ `CodeSha256`, `LastUpdateStatus` และ configuration สำคัญว่าไม่เปลี่ยน
7. ตรวจการใช้งานตามหัวข้อ 6 ก่อนถือว่าปล่อยสำเร็จ

Deploy runs ทำงานทีละรอบ Run ที่ commit ตามหลัง `main` ล่าสุดจะหยุด ให้สั่ง run ใหม่แทนการข้ามการตรวจ Workflow ไม่ย้อนโค้ดอัตโนมัติเมื่อผลตรวจท้ายงานล้มเหลว

ZIP ใช้ boto3 จาก Lambda runtime การเพิ่ม dependency ใน `requirements.txt` อย่างเดียวไม่ทำให้ dependency เข้า ZIP ต้องปรับ packager หรือ layer ที่ใช้ให้พร้อมก่อน release

### แพ็กและ deploy Auth ด้วยตนเอง

ใช้เมื่อ pipeline ไม่พร้อม โดยรันจาก Git checkout ของ commit ที่ผ่าน review และตรงกับ `main` ล่าสุด มี Python 3.12+, AWS CLI และสิทธิ์บัญชีปลายทางพร้อมแล้ว คำสั่ง deploy ด้านล่างเปลี่ยนโค้ด Lambda จริง

```sh
release_commit=$(git rev-parse HEAD)
release_zip="$(mktemp -d)/cstuhub-auth.zip"
python3 scripts/package-auth-lambda.py "$release_zip"
aws sts get-caller-identity --query Account --output text
python3 deploy/deploy-auth.py "$release_zip" "$release_commit"
```

Account ต้องเป็น `781485979426` สคริปต์กำหนด Singapore ไว้และตรวจ account ซ้ำก่อนเขียน การแพ็ก source เพียงอย่างเดียวไม่ deploy AWS และ packager จะปฏิเสธไฟล์ Python ใน backend ที่ยังไม่ได้ commit

### Node.js Lambda — อัปเดตแยก

Source อยู่ใน `backend/lambda/tuAuthLogin/`, `backend/lambda/fetchPartnersData/` และ `backend/lambda/getPublicPartners/`

1. เลือกเฉพาะ function ที่แก้ ตรวจ API integration หรือผู้เรียกก่อน ไม่อัปเดตทั้งสามตัวโดยไม่จำเป็น
2. บันทึก runtime, handler, architecture, layers, environment และสำรอง deployment package/version เดิม
3. แพ็ก source ของ function ให้ entry point อยู่ตำแหน่งที่ handler อ้างถึง พร้อม dependency ที่ function ต้องใช้ ไม่ใช้ ZIP ของ Python Auth แทน
4. อัปโหลด ZIP ไป function ใน Singapore รอ update สำเร็จ และตรวจ code hash
5. ตรวจการทำงานเฉพาะส่วน เช่น TU login หรือ public catalog แล้วบันทึกผล

## 6. ตรวจหลัง deploy และบันทึกผล

เลือกตรวจตามส่วนที่แก้โดยใช้ข้อมูลทดสอบแยกจากข้อมูลจริง ไม่จำเป็นต้องรัน load test ทุก release

| ส่วนที่เปลี่ยน | จุดตรวจขั้นต่ำ |
| --- | --- |
| Frontend | หน้าเปิดได้ รูปและ script โหลดครบ API ส่ง JSON และข้อมูลแสดงถูกต้อง |
| Login / Session | เข้าสู่ระบบ อ่าน Session ออกจากระบบ และคำขอหลัง logout ถูกปฏิเสธ |
| สิทธิ์ / Feedback | ผู้มีสิทธิ์อ่านได้ ผู้ไม่มีสิทธิ์ถูกปฏิเสธ ผู้สร้างแก้ Feedback ของตนเองได้ตาม scope |
| เอกสาร | อัปโหลดไฟล์ทดสอบผ่านหน้าเว็บ รอ `ready`, reload แล้วยังพบรายการ ดาวน์โหลดกลับและเทียบขนาด/checksum |
| Form import | Preview คำถาม/คำตอบถูกต้อง บันทึกแล้วเปิดกลับได้ และการส่งชุดเดิมซ้ำไม่เพิ่มรายการซ้ำ |
| ข้อมูล / migration | ID, reference, scope, จำนวนรายการที่ย้าย และ version mapping ของไฟล์ครบ |

แยก “build ผ่าน”, “code hash ตรง” และ “ทดสอบฟีเจอร์ผ่าน” ออกจากกัน หากยังไม่ทดสอบส่วนใด ให้ระบุว่ายังไม่ทดสอบ ไม่ใช้ผลตรวจ package แทนผลใช้งานจริง

Release record ใน PR หรือบันทึกการปล่อยต้องมีวันที่/ผู้ดำเนินการ, commit, account/Region/function, Amplify job หรือ Actions run, code hash และ backup version เมื่อมี, configuration ที่เปลี่ยนโดยไม่ระบุ secret, ผลตรวจและรายการที่ยังไม่ทดสอบ รวมถึงผล rollback หากเกิดขึ้น

## 7. Monitoring และการตรวจปัญหา

ตรวจ CloudWatch Logs ของ Lambda เช่น `/aws/lambda/CSTUHubAuth`, metrics ของ Lambda ได้แก่ Errors/Throttles/Duration และ 4xx/5xx/latency ของ HTTP API ใช้เวลาและ request ID เชื่อมเหตุการณ์ โดยไม่บันทึกรหัสผ่าน token, secret, signed URL หรือเนื้อหาเอกสารลง log

ก่อนปล่อยงานที่เปลี่ยน monitoring ให้ตรวจ alarm thresholds, log retention และ SNS subscription ใน Singapore ว่ารับแจ้งเตือนได้จริง รายการเหล่านี้ไม่ได้ถูกสร้างโดย workflow deploy Auth

| อาการ | ตรวจตามลำดับ |
| --- | --- |
| `FORBIDDEN` หลังอัปเดตหน้าเว็บ | บทบาท/scope/ความสัมพันธ์กับรายการ → รุ่น frontend และ Lambda → policy ของ application; ไม่เพิ่ม IAM เพื่อแก้ application permission โดยอัตโนมัติ |
| `PERMISSION_UNAVAILABLE` ตอนแนบไฟล์ | CloudWatch request ที่ล้มเหลว → `DOCUMENT_BUCKET`/Region → GetBucketPublicAccessBlock และสิทธิ์ object/version → สิทธิ์ DynamoDB ตาม error |
| “คำตอบจากระบบไม่ถูกต้อง” | HTTP status และ content type → rewrite/stage → gateway timeout → Lambda log; HTML ที่ถูกส่งแทน JSON ก็ทำให้เกิดอาการนี้ได้ |
| อัปโหลดแล้วรอนาน | สถานะ ticket และ log การตรวจไฟล์; API อาจหมดเวลาก่อน Lambda เสร็จ Browser จึงต้องอ่านสถานะซ้ำ |
| `SignatureDoesNotMatch` / S3 CORS | origin, regional endpoint, form fields, เวลาและอายุ signature; ไม่เปิด bucket เป็น public |
| `VERSION_CONFLICT` | อ่าน version ล่าสุดและตรวจงานที่ถูกแก้ไขก่อนบันทึกใหม่ |
| Actions ไม่เริ่ม / ไม่ deploy | branch และ path filter → package job → OIDC trust subject → commit ที่ `main` ล่าสุด |
| WAF ปฏิเสธคำขอ | ตรวจ sampled requests/logging ที่เปิดไว้และ rule ที่ match ก่อนปรับเฉพาะขอบเขต |

WAF ที่ผูกกับ Amplify ป้องกันคำขอที่ผ่าน Amplify ไม่ควรถือว่าคำขอที่เรียก execute-api โดยตรงผ่าน WAF เดียวกันเสมอ API ยังต้องตรวจ authentication, authorization และการจำกัดคำขอของตนเอง

## 8. Rollback

### คืนโค้ดใน Singapore

1. หยุด release ถัดไปและระบุ commit/job ที่เป็นสาเหตุ ตรวจว่าโค้ดถูกอัปเดตไปแล้วหรือยัง
2. วิธีปกติคือ revert การเปลี่ยนแปลงที่มีปัญหาผ่าน PR แล้ว merge เข้า `main` ให้ pipeline ปล่อยรุ่นแก้กลับ ตรวจทั้ง Amplify และ Lambda ตามไฟล์ที่เปลี่ยน
3. หากต้องคืน Auth เร่งด่วนและ pipeline ใช้ไม่ได้ ให้ดาวน์โหลด ZIP ของ backup version จาก Lambda แล้วอัปโหลดกลับ `$LATEST` ตรวจ hash และผลใช้งานหลังคืน
4. ตรวจ API integration ว่าเรียก `$LATEST` หรือ alias/version ก่อนคืน traffic การสร้าง published version เพียงอย่างเดียวไม่เปลี่ยน target ของ API
5. หากคืน frontend ผ่าน Amplify ไป deployment เดิม ต้องตรวจ API compatibility และแก้ `main` ให้ตรงกับรุ่นที่ต้องการก่อน deploy ครั้งต่อไป
6. การคืนโค้ดไม่คืน environment, IAM หรือข้อมูล ให้ย้อน configuration เฉพาะที่เปลี่ยนตามบันทึก release แยกต่างหาก

ไม่ใช้สคริปต์ deploy Auth เพื่อข้ามกลับไป commit เก่าโดยตรง เพราะสคริปต์ตรวจว่าตรงกับ `main` ล่าสุด การคืนผ่าน Git ใช้ revert commit ใหม่แทน

### เอกสารและข้อมูล

- ปิด `DOCUMENT_DIRECT_UPLOAD_ENABLED` ได้เพื่อหยุด direct upload ใหม่ แต่คงโค้ดที่อ่านเอกสาร direct เดิมไว้
- ไม่ปิด Versioning หรือลบ bucket/metadata เพื่อคืนโค้ด ลิงก์ดาวน์โหลดที่ออกแล้วอาจใช้ได้จนหมดอายุ
- S3 รุ่นเก่าที่ถูก Lifecycle ลบถาวรต้องกู้จากสำเนาอื่นที่ยังมีอยู่ การ revert โค้ดไม่กู้ไฟล์เหล่านั้น
- การ restore DynamoDB หรือคัดลอก S3 กลับต้องตรวจสิทธิ์ ตาราง/index และ `storageVersionId` หลัง restore ก่อนสลับระบบ

### ย้อนกลับข้าม Region

Sydney (`ap-southeast-2`) เป็นปลายทางเดิม ไม่ใช่ failover ที่พร้อมสลับอัตโนมัติ ตรวจทรัพยากรที่ยังเหลืออยู่ก่อนใช้แผนนี้ ไม่สร้าง WAF/monitoring เก่ากลับเพียงเพราะเอกสาร migration เดิมระบุไว้

หากต้องกลับ Sydney ให้หยุดการเขียน กำหนดชุดข้อมูลล่าสุด ย้ายข้อมูลใหม่จาก Singapore พร้อม metadata และ mapping S3 VersionId ตรวจ environment/IAM/API/origin แล้วจึงสลับปลายทาง การเปลี่ยน URL กลับอย่างเดียวอาจทำให้ข้อมูลหายจากมุมมองผู้ใช้หรือแยกเป็นสองชุด

## 9. การย้าย Region และการกู้คืนข้อมูล

การย้ายครั้งถัดไปต้องทำแยกจาก code deployment:

1. ตรวจบริการและข้อจำกัด account/SCP ใน Region ปลายทาง
2. เตรียมตาราง schema/index/TTL, bucket settings, Lambda configuration, IAM และเส้นทาง API
3. สำรองและคัดลอก DynamoDB พร้อมตรวจรายการจริง ไม่ใช้เพียงจำนวนประมาณจากหน้า Overview
4. คัดลอก S3 พร้อม metadata และตรวจความครบถ้วน; สร้าง mapping `storageVersionId` ใหม่ เพราะ VersionId ข้าม bucket ไม่เท่ากัน และ ETag ไม่ใช่ checksum เนื้อหาในทุกกรณี
5. หยุดเขียนช่วง sync สุดท้าย ตรวจ delta และการทำงานก่อนสลับ frontend/origin
6. เก็บต้นทางตามระยะ rollback ที่ตกลงและตรวจค่าใช้จ่าย ก่อนลบทรัพยากรที่เลิกใช้

Versioning, replication ไป backup bucket และ DynamoDB PITR มีหน้าที่ต่างกัน ตรวจสถานะ/ช่วงเก็บรักษาของทรัพยากรจริงก่อนเลือกวิธีกู้คืน สำเนาใน Region เดียวกันไม่ใช่แผนรองรับ Region outage และการเปิด backup ไม่ทำให้ระบบสลับไปใช้ข้อมูลสำรองเอง

## 10. ไฟล์ประกอบ

| ไฟล์ / โฟลเดอร์ | การใช้งาน |
| --- | --- |
| [deploy/](../../deploy/README.md) | สคริปต์และ policy สำหรับ Auth CI/CD |
| [private/s3/](../../private/s3/README.md) | Configuration และรายละเอียด direct upload |
| [Data guide](../data/data-guide.md) | โครงสร้างข้อมูล ความสัมพันธ์ และสิทธิ์ |
| [V3 deployment](v3-deployment.md) | เอกสาร deployment ของรุ่นก่อน; ใช้คู่มือ V4 สำหรับระบบ Singapore |

ไฟล์ JSON policy เก็บแยกเพื่อใช้งานเป็น configuration ได้โดยตรง ส่วนขั้นตอน deploy และแก้ปัญหาทั่วไปใช้เอกสารนี้เป็นหลัก
