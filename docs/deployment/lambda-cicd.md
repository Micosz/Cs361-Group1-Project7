# Lambda CI/CD ใน AWS Academy Learner Lab — #120

## Functions และ source

| AWS function | Source | Runtime / Handler | Architecture |
| --- | --- | --- | --- |
| `fetchPartnersData` | `backend/lambda/fetchPartnersData/index.mjs` | Node.js 24 / `index.handler` | x86_64 |
| `getPublicPartners` | `backend/lambda/getPublicPartners/index.cjs` | Node.js 24 / `index.handler` | arm64 |
| `tuAuthLogin` | `backend/lambda/tuAuthLogin/index.mjs` | Node.js 24 / `index.handler` | arm64 |

ตรวจ configuration และดาวน์โหลด source จาก AWS แบบ read-only เมื่อ 8 ตุลาคม 2026 ทุก function ใช้ Zip, ไม่มี layers และ source ใน Git ตรงกับ AWS เดิมหลังตัด trailing whitespace ของสอง data functions ชื่อจริงคือ `fetchPartnersData` มี s ส่วน `getPublicPartners` เดิมเป็น CommonJS ในไฟล์ `.mjs` จึงเปลี่ยนเฉพาะชื่อไฟล์เป็น `.cjs` เพื่อให้ module type ตรง โดยคงโค้ดและ Handler `index.handler` เดิม

คงการพึ่ง AWS SDK v3 ของ runtime เดิมสำหรับสอง data functions จึงไม่เพิ่ม package.json ที่ไม่จำเป็น ส่วน `tuAuthLogin` ใช้ fetch ของ Node.js และอ่าน `TU_APP_KEY` จาก Lambda environment เดิม Workflow ไม่เปลี่ยน environment/runtime/handler/architecture/role หรือสร้าง resources ใหม่

## Secrets และข้อจำกัด Learner Lab

ที่ GitHub repository → Settings → Secrets and variables → Actions ตั้ง repository secrets:

| Secret | ค่าจาก AWS Academy Learner Lab |
| --- | --- |
| `AWS_ACCESS_KEY_ID` | temporary access key |
| `AWS_SECRET_ACCESS_KEY` | temporary secret access key |
| `AWS_SESSION_TOKEN` | temporary session token จำเป็นสำหรับ Learner Lab |

ตั้งทั้งสามค่าแล้วตามการอนุมัติของผู้รับผิดชอบ ณ วันที่ตรวจ ห้ามใส่ค่าจริงลง source, issue, PR, screenshots หรือ logs ทั้งสามค่าต้องมาจาก session เดียวกันของ Lab account ที่มี functions ข้างต้นใน `us-east-1`

Credentials **หมดอายุ** และ workflow ต่ออายุเองไม่ได้: Start / Resume Learner Lab → AWS Details → รับ AWS CLI credentials ใหม่ → อัปเดต GitHub Secrets ทั้งสามค่า → Re-run failed workflow ของ commit ที่ต้องการ หากมี Lambda source ใหม่กว่าแล้วต้องตรวจ commit ก่อน Re-run เพื่อไม่ย้อนรุ่นโดยไม่ตั้งใจ

ใช้สิทธิ์ Learner Lab เดิมที่มีอยู่ ไม่สร้าง IAM users/roles/OIDC สิทธิ์ที่จำเป็นคือ `lambda:GetFunctionConfiguration`, `lambda:GetFunction` สำหรับ waiter v2 และ `lambda:UpdateFunctionCode` ของสาม functions พร้อม credential validation ของ action หาก AccessDenied ให้ประสานผู้ดูแล/อาจารย์ ไม่สมมติว่าแก้ IAM ได้เอง

## Deployment flow และการเลือก function

Issue → Feature Branch → Implementation → Commit → Push → Draft PR → Review → Merge `main` → GitHub Actions → เลือก functions ที่เปลี่ยน → Authenticate ด้วย credentials ชั่วคราว → อ่าน configuration เดิม → Package → Update existing Lambda → ตรวจ update status/checksum → API smoke แยก

`.github/workflows/deploy-lambda.yml` trigger เฉพาะ push `main` ที่แก้ source ในสาม directories ข้างต้น, `package-lambda.py`, `select-lambdas.py` หรือ deploy workflow ไม่มี PR/manual trigger ที่ deploy

- selector ใช้ diff จาก **before ถึง after ของ push ทั้งชุด** ไม่ใช่เฉพาะ commit สุดท้าย รวมการลบไฟล์; matrix มีเฉพาะชื่อใน allowlist
- แก้ `tuAuthLogin/**` ตัวเดียว → deploy เฉพาะ `tuAuthLogin`; แก้สอง directories → deploy สองตัว
- แก้ shared packager/selector/deploy workflow → deploy ทั้งสาม เพราะกระทบวิธีส่ง package ร่วมกัน
- frontend, docs นอก source directory, tests และ functions ที่ไม่อยู่ใน allowlist ไม่ trigger deployment; README ภายใน source directoryยังถือว่าอยู่ใน path filter
- matrix แยกแต่ละ function และไม่ยกเลิกตัวอื่นเมื่อหนึ่งตัวล้มเหลว จึงอาจสำเร็จบางส่วน ต้องอ่านผลราย function; workflow concurrency ไม่ยกเลิก run ที่กำลัง deploy

แต่ละ job อ่าน Runtime/Handler/PackageType/RevisionId เดิมโดยไม่ dump environment secrets แล้วใช้ Node major เดียวกัน หากเพิ่ม dependencies ภายหลัง ต้องมี Lambda package.json/lockfile และใช้ `npm ci --omit=dev --ignore-scripts` เฉพาะ Lambda directory ไม่ใช้ root/frontend dependencies

Packager เก็บเฉพาะ tracked source ของ function ที่เลือก กับ production dependencies ที่ติดตั้งไว้ ตรวจ handler/ZIP root/CRC/size ไม่ห่อด้วย path `backend/lambda/...` ข้าม README และปฏิเสธ tracked `.env`/ZIP/keys/symlinks/native dependencies ที่ยังไม่ได้ยืนยัน architecture ปัจจุบัน source ทั้งสามไม่มี native dependencies

Deploy ด้วย `aws lambda update-function-code` เฉพาะชื่อใน matrix พร้อม RevisionId เพื่อกันเขียนทับ Console change ระหว่าง run รอ `function-updated-v2` และเทียบ CodeSha256 กับ ZIP ที่ส่ง ก่อนบันทึก Git SHA/function/hash ใน run summary ZIP อยู่ runner temp ไม่ commit/เผยแพร่ credentials หรือ ZIP artifact

Workflow อัปเดต `$LATEST` เท่านั้น ไม่ publish version/ย้าย alias หาก API integration ใช้ alias/published version ต้องให้ผู้ดูแลยืนยัน release flow เพิ่มก่อนอ้างว่า API รับ code ใหม่

หากเพิ่ม function ใหม่ ให้สร้างใน AWS ก่อน แล้วเพิ่ม source directory, allowlists ใน selector/packager, path filters และ tests ก่อนเปิด PR การเพิ่มไฟล์ชื่อใหม่อย่างเดียวจะไม่สร้างหรือ deploy Lambda ที่ไม่อยู่ใน allowlist

## Validation และการกู้คืน

PR ใช้ `.github/workflows/lambda-ci.yml` ตรวจ packaging/selection, source behavior ด้วย AWS/TU mocks, syntax และ actionlint โดยไม่ใช้ AWS credentials และไม่ deploy

คำสั่งตรวจในเครื่อง:

```sh
python3 -m unittest discover -s .github/scripts -p 'test_*.py' -v
node --experimental-vm-modules --test tests/lambda-source.test.cjs
python3 .github/scripts/package-lambda.py --function fetchPartnersData \
  --config /tmp/lambda-config.json --output /tmp/fetchPartnersData.zip
```

metadata สำหรับ package ต้องมี Runtime/Handler/PackageType จาก function เดิม ไม่ใส่ environment/credentials VM flag ใช้เฉพาะ test harness ไม่ได้เปลี่ยน flags ของ Lambda

Missing secret ให้ตั้งครบสามค่า; ExpiredToken/InvalidClientTokenId ให้ต่ออายุ session; AccessDenied ให้ตรวจสิทธิ์ Lab; missing handler ให้ตรวจ source/packaging; RevisionId conflict ให้เทียบ Console กับ Git ก่อน deploy ใหม่

หาก update ผ่านแต่ waiter/checksum/API test ล้มเหลว อย่าอนุมานว่าระบบเดิมยังทำงาน ตรวจ AWS Console/API แยก Rollback ใช้ commit/source รุ่นที่ยืนยันแล้วผ่าน review และ workflow เดียวกัน ไม่ลบ resources ไม่มี automatic rollback ระหว่างสาม functions

หลัง deploy ตรวจ API data จริงและ TU login ด้วยบัญชีทดสอบที่อนุญาต แยก API smoke จาก frontend fallback และจาก checksum success งานนี้ยังไม่ได้ deploy/invoke จริง ผล AWS ที่ตรวจคือ **DryRun=True** เท่านั้น ดู [หลักฐาน](../evidence/lambda-cicd-issue-120.md)

ใน production AWS ทั่วไป GitHub OIDC กับ IAM Role เหมาะกว่าการเก็บ temporary credentials ใน Secrets หาก environment อนุญาต งานนี้ไม่ implement OIDC ภายใต้ข้อจำกัด Learner Lab

อ้างอิง: [Lambda module types และ SDK](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-handler.html), [ZIP packaging](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-package.html), [AWS credential action](https://github.com/aws-actions/configure-aws-credentials), [update-function-code / dry-run](https://docs.aws.amazon.com/cli/latest/reference/lambda/update-function-code.html)
