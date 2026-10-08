# Lambda CI/CD ใน AWS Academy Learner Lab — #120

## สถานะก่อน merge

Workflow พร้อมตรวจทาน แต่ **ยังขาด source จริงของ `fetchPartnersData` และยังไม่ได้ deploy** ใน `main` ที่ตรวจมี frontend/migration/backup workflow แต่ไม่มี source Lambda เครื่องที่ใช้ตรวจไม่มี AWS credentials และ repository ยังไม่มี Actions Secrets ทั้งสามค่า ณ วันที่ตรวจ

นำ source จาก Lambda Console หรือ deployment package เดิมมาเก็บใน `backend/lambda/fetchPartnersData/` ก่อน merge ยืนยัน Runtime, Handler, dependencies และ layers โดยไม่คัดลอก credentials/config secrets มาด้วย ห้ามใช้ `migrate.js`, frontend fetch function หรือ backend Session ของ #78 เป็นโค้ดทดแทน Lambda นี้

Packager ปัจจุบันรองรับ Node.js Zip functions เท่านั้น โดยตรวจ Runtime/Handler จริงผ่าน AWS ก่อน deploy ถ้าฟังก์ชันเดิมเป็น runtime/container แบบอื่น ให้ปรับ packaging ตาม source จริงก่อน review ห้ามเปลี่ยน runtime/handler ของ AWS เพื่อให้ workflow ผ่าน

## Secrets ที่ต้องตั้ง

ที่ GitHub repository → Settings → Secrets and variables → Actions → New repository secret:

| Secret | ค่าจาก AWS Academy Learner Lab |
| --- | --- |
| `AWS_ACCESS_KEY_ID` | temporary access key |
| `AWS_SECRET_ACCESS_KEY` | temporary secret access key |
| `AWS_SESSION_TOKEN` | temporary session token ซึ่งจำเป็นสำหรับ Learner Lab |

ทั้งสามค่าต้องมาจาก session เดียวกันของ Lab และ account ที่มี `fetchPartnersData` ใน `us-east-1` ไม่ใส่ค่าจริงใน source, issue, PR, screenshots หรือ logs ใช้ identity ของ Learner Lab ที่มีสิทธิ์อยู่แล้ว ไม่สร้าง IAM users/roles/OIDC provider ในงานนี้

สิทธิ์ที่ workflow ต้องใช้: `lambda:GetFunctionConfiguration`, `lambda:GetFunction` (waiter v2) และ `lambda:UpdateFunctionCode` เฉพาะฟังก์ชันเดิม รวม credential validation ของ action หาก Lab ปฏิเสธสิทธิ์ให้ประสานผู้ดูแล/อาจารย์ ไม่สมมติว่าแก้ IAM ได้เอง

## ขั้นตอน deploy

Issue → Feature Branch → Implementation → Commit → Push → Draft PR → Review → Merge `main` → GitHub Actions → ใช้ Learner Lab credentials → อ่าน config เดิม → Package Lambda → Update `fetchPartnersData` → รอ update สำเร็จและเทียบ checksum

`.github/workflows/deploy-lambda.yml` ทำงานเฉพาะ push เข้า `main` ที่เปลี่ยน source ใต้ `backend/lambda/fetchPartnersData/**`, package script หรือ deploy workflow ไม่มี PR/manual trigger ที่ deploy การแก้ frontend/เอกสารนอก source directory ไม่ trigger; README ภายใน source directory ถือว่าอยู่ใน path filter

- Checkout commit ของ run; ไม่มีการสร้าง resource หรือแก้ function configuration
- อ่านเฉพาะ Runtime/Handler/PackageType/RevisionId ไม่ dump environment secrets
- ใช้ Node major เดียวกับ runtime เดิม ถ้ามี Lambda `package.json` ต้องมี lockfile และใช้ `npm ci --omit=dev --ignore-scripts` ภายใน Lambda directory เท่านั้น ไม่ใช้ dependencies ของ frontend/root project
- หาก source ใช้เพียง SDK ที่ runtime/layer เดิมมีอยู่ คง dependencies ตามของจริง ไม่เพิ่ม package.json โดยไม่จำเป็น
- Package เฉพาะ tracked source กับ production node_modules ที่ติดตั้งไว้ วาง handler module ที่ ZIP root ตาม Handler เดิม ไม่ห่อด้วย `backend/lambda/fetchPartnersData/`; ข้าม README และปฏิเสธ tracked `.env`/ZIP/keys และ symlinks
- Native dependencies หรือ dependencies ที่ต้องใช้ install scripts/symlinks ต้อง review packaging เพิ่มตาม architecture จริง ปัจจุบันหยุดแทนการส่ง package ที่ยังไม่ยืนยัน
- เรียก `aws lambda update-function-code` เฉพาะ `fetchPartnersData`/`us-east-1` พร้อม RevisionId เพื่อไม่เขียนทับการแก้จาก Console ที่เกิดระหว่าง run
- ZIP อยู่ใน runner temp; ไม่ commit ZIP/node_modules หรืออัปโหลด credentials เป็น artifact
- Run summary บันทึก Git SHA และ CodeSha256 หลัง update status/checksum ตรงกัน นี่พิสูจน์ code update เท่านั้น ยังต้องทดสอบ API แยก

คำสั่งตรวจ package ในเครื่อง (ใช้ไฟล์ metadata ที่ไม่มี environment/credentials):

```sh
python3 .github/scripts/test_package_lambda.py -v
python3 .github/scripts/package-lambda.py \
  --config /tmp/lambda-config.json \
  --output /tmp/fetchPartnersData.zip
```

`lambda-config.json` ต้องมี `Runtime`, `Handler`, `PackageType` จาก configuration เดิม การทดสอบด้วย fixture ไม่ยืนยัน behavior ของ source จริง

## Credentials หมดอายุและการกู้คืน

Credentials ของ Learner Lab **หมดอายุ** และ workflow ต่ออายุให้เองไม่ได้:

Start / Resume Learner Lab → AWS Details → รับ AWS CLI credentials ใหม่ → อัปเดต GitHub Secrets **ทั้งสามค่า** → Re-run failed workflow หากจำเป็น

ตรวจ run ว่าเป็น commit ที่ต้องการ deploy ก่อนกด Re-run โดยเฉพาะเมื่อมี source รุ่นใหม่กว่า หาก Lab ยังหยุด/session หมดอายุ ต้องเปิด Lab ก่อน อย่าบันทึกค่าจริงในเอกสาร และอย่า retry token เดิมซ้ำโดยไม่ต่ออายุ

Missing secret จะ fail ก่อน configure AWS; ExpiredToken/InvalidClientTokenId ให้ต่ออายุ credentials; AccessDenied ให้ตรวจสิทธิ์ Lab; missing handler ให้เพิ่ม source จริง; RevisionId conflict ให้ตรวจ Console เทียบ Git ก่อน deploy ใหม่

ถ้า update code สำเร็จแต่ waiter/checksum/API test ล้มเหลว อย่าอนุมานว่าระบบเดิมยังทำงาน ตรวจ AWS Console และ API แยก การ rollback ใช้ source/commit รุ่นที่รู้ว่าทำงานได้ผ่าน review และ workflow เดียวกัน ไม่ลบ resource

API smoke หลัง deploy: เรียก `https://eb49u61kph.execute-api.us-east-1.amazonaws.com/default/fetchPartnersData` ตรวจ HTTP status/รูปแบบ flat array และ behavior เดิม ตรวจหน้า frontend ว่าอ่าน API จริง ไม่ใช่ fallback snapshot หาก integration ใช้ Lambda alias/published version ต้องตรวจผู้ดูแลก่อน เพราะ workflow นี้อัปเดต `$LATEST` เท่านั้นและไม่ย้าย alias

## หลักฐานและอนาคต

ดู [ผล validation และข้อจำกัด #120](../evidence/lambda-cicd-issue-120.md) การ merge/การรัน Actions/การ deploy จริงยังต้องให้ทีมดำเนินการหลัง source และ secrets พร้อม

ใน AWS production ทั่วไป GitHub OIDC กับ IAM Role เหมาะกว่าการเก็บ temporary credentials ใน Secrets หาก environment อนุญาต งานนี้ **ไม่ implement OIDC** เพราะอยู่ภายใต้ข้อจำกัดของ Learner Lab

อ้างอิง: [Lambda Node.js ZIP packaging](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-package.html), [AWS credential action](https://github.com/aws-actions/configure-aws-credentials), [update-function-code](https://docs.aws.amazon.com/cli/latest/reference/lambda/update-function-code.html), [GitHub workflow syntax/path filters](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
