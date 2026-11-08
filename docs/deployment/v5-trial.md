# คู่มือทดลอง CSTUHub V5 บน AWS Singapore

คู่มือนี้ใช้กับชุดทดลองจาก branch `IaC` ซึ่งมีฐานข้อมูลและเว็บแยกจาก production ใช้ข้อมูลจำลองกับชื่อขึ้นต้น `cstuhub-iac-` เท่านั้น ตรวจ [ขอบเขตของแต่ละ stack](../design/v5-design.md) ก่อนเริ่ม

## 1. ตรวจเครื่องและบัญชี

ใช้ checkout สะอาดของ commit ที่จะทดสอบ, Node.js 24, Python 3.12, AWS CLI และ `zip` ติดตั้ง dependency จาก lockfile และใช้ profile ที่ตรวจสอบได้ว่าอยู่ในบัญชีเป้าหมาย มีสิทธิ์ CloudFormation, IAM สำหรับ execution roles, DynamoDB, S3, Secrets Manager, Lambda, API Gateway และ Amplify ของชุดทดลอง

```bash
export AWS_PROFILE=micin-aws AWS_REGION=ap-southeast-1 AWS_PAGER=
export ACCOUNT=781485979426
export TRIAL=cstuhub-iac-v5-test
test "$(aws sts get-caller-identity --query Account --output text)" = "$ACCOUNT"
git status --short --branch
git rev-parse HEAD
npm ci
python -m pip install -r backend/lambda/CSTUHubAuth/requirements.txt cfn-lint==1.60.0 'botocore[crt]'
npm test
cfn-lint --regions "$AWS_REGION" --template infra/*.yaml
```

หาก AWS CLI แจ้งว่า session หมดอายุ ให้ต่ออายุด้วย `aws login --profile micin-aws --region ap-southeast-1` แล้วตรวจบัญชีอีกครั้ง ก่อนใช้คำสั่ง AWS ให้เปลี่ยนส่วนท้ายของ `TRIAL` เป็นชื่อว่างที่ตั้งไว้สำหรับรอบนั้น

## 2. สร้าง Change Set และตรวจทุกครั้งก่อน execute

ฟังก์ชันนี้สร้าง Change Set อย่างเดียว รับ ARN จากผลคำสั่ง แล้วใช้ `describe-change-set` ตรวจสถานะ, logical ID, ประเภทการเปลี่ยน และ Replacement ก่อน execute ระบุชื่อ trial ในบันทึกทุกครั้ง

```bash
plan() {
  stack="$1"; template="$2"; shift 2
  aws cloudformation validate-template --template-body "file://$template" --output off &&
    aws cloudformation deploy --stack-name "$stack" --template-file "$template" \
      --no-execute-changeset "$@"
}
show_plan() {
  aws cloudformation describe-change-set --change-set-name "$1" \
    --query '{Status:Status,Reason:StatusReason,Execution:ExecutionStatus,Changes:Changes[].ResourceChange.{Action:Action,LogicalId:LogicalResourceId,Type:ResourceType,Replacement:Replacement}}'
}
output() {
  aws cloudformation describe-stacks --stack-name "$1" \
    --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue | [0]" --output text
}
```

ใช้ `aws cloudformation execute-change-set --change-set-name "$CHANGE_SET_ARN"` หลังตรวจแล้ว รอ `aws cloudformation wait stack-create-complete --stack-name "$STACK"` สำหรับการสร้าง หรือ `stack-update-complete` สำหรับการอัปเดต หากแผนมีการลบหรือแทนที่ทรัพยากรเกินที่ตั้งใจ ให้หยุดที่ Change Set และแก้ template หรือ parameter ก่อน รันขั้นต่อไปเมื่อ stack ก่อนหน้าพร้อมแล้ว

### Frontend รอบแรกและ Data

```bash
plan "$TRIAL-frontend" infra/frontend.yaml --parameter-overrides TrialName="$TRIAL" ConnectBackend=false
# ตรวจ, execute และรอ Frontend CREATE_COMPLETE ก่อนอ่าน Outputs
ORIGIN=$(output "$TRIAL-frontend" Origin)
ARTIFACTS=$(output "$TRIAL-frontend" ArtifactBucket)
plan "$TRIAL-data" infra/data.yaml --parameter-overrides TrialName="$TRIAL" DocumentOrigin="$ORIGIN"
# ตรวจ, execute และรอ Data CREATE_COMPLETE ก่อน seed
```

### Fixture, secret และ ZIP

สคริปต์ seed รับรหัสผ่านจำลองผ่าน prompt แบบซ่อนหรือไฟล์นอก checkout เก็บรหัสผ่านเดียวกันไว้จนจบ smoke test และเก็บเฉพาะ VersionId เป็นหลักฐาน สคริปต์จำกัดชื่อ stack, Region, บัญชี และตรวจ output ก่อนเขียนข้อมูล

```bash
work_dir=$(mktemp -d)
chmod 700 "$work_dir"
umask 077
openssl rand -hex 24 > "$work_dir/synthetic-password"
SECRET_VERSION=$(python infra/trial-smoke.py seed "$TRIAL" --profile "$AWS_PROFILE" \
  --account "$ACCOUNT" --password-file "$work_dir/synthetic-password")

COMMIT=$(git rev-parse HEAD)
PREFIX="releases/$COMMIT"
python scripts/package-auth-lambda.py "$work_dir/CSTUHubAuth.zip"
for function in tuAuthLogin fetchPartnersData getPublicPartners; do
  python scripts/package-node-lambda.py "$function" "$work_dir/$function.zip"
done
upload_zip() {
  aws s3api put-object --bucket "$ARTIFACTS" --key "$PREFIX/$1.zip" \
    --body "$work_dir/$1.zip" --query VersionId --output text
}
AUTH_ZIP=$(upload_zip CSTUHubAuth)
TU_ZIP=$(upload_zip tuAuthLogin)
FETCH_ZIP=$(upload_zip fetchPartnersData)
PUBLIC_ZIP=$(upload_zip getPublicPartners)
```

ก่อนใช้ผล ให้ตรวจว่า `SECRET_VERSION` และ ZIP VersionId ทั้งสี่มีค่าและไม่ใช่ `None` หรือ `null` เก็บค่าพารามิเตอร์ที่เป็น version identifier ไว้เพื่ออัปเดตและย้อนกลับ รหัสผ่านและค่า secret จริงอยู่เฉพาะในไฟล์ชั่วคราว/Secrets Manager

### Backend และผูก rewrite

```bash
backend_parameters=(
  "TrialName=$TRIAL" "SessionOrigin=$ORIGIN" "ArtifactBucket=$ARTIFACTS"
  "ArtifactPrefix=$PREFIX" "AuthZipVersion=$AUTH_ZIP" "TuZipVersion=$TU_ZIP"
  "FetchZipVersion=$FETCH_ZIP" "PublicZipVersion=$PUBLIC_ZIP"
  "AuthSecretVersion=$SECRET_VERSION" "CourseTestEnabled=true"
)
plan "$TRIAL-backend" infra/backend.yaml --capabilities CAPABILITY_IAM \
  --parameter-overrides "${backend_parameters[@]}" ApiRateLimit=10
# ตรวจ Lambda, runtime roles, permissions และ routes ก่อน execute และรอ Backend
plan "$TRIAL-frontend" infra/frontend.yaml --parameter-overrides TrialName="$TRIAL" ConnectBackend=true
# ตรวจการเปลี่ยน rewrite แล้ว execute และรอ Frontend UPDATE_COMPLETE
```

สร้าง ZIP ของหน้าเว็บโดยให้ `index.html` อยู่ที่ root แล้ว deploy ไป Amplify app ทดลองเท่านั้น

```bash
npm run build
(cd public && zip -qr "$work_dir/site.zip" . -x '*.DS_Store')
python infra/trial-smoke.py publish "$TRIAL" --profile "$AWS_PROFILE" \
  --account "$ACCOUNT" --archive "$work_dir/site.zip"
python infra/trial-smoke.py verify "$TRIAL" --profile "$AWS_PROFILE" \
  --account "$ACCOUNT" --password-file "$work_dir/synthetic-password"
```

ตรวจผล catalog ผ่าน Amplify และ `getPublicPartners` แบบ invoke ตรวจว่า TU adapter คืนสถานะ configuration unavailable จากชุดทดลอง และตรวจ anonymous → login → refresh session → logout ด้วยผู้ใช้จำลอง เปิดหน้า trial และลองค้นหา `V5 Smoke Public Partner` ถ้าต้องการหลักฐาน browser เพิ่มจาก API smoke

### ทดสอบผ่าน API เมื่อบัญชีสร้าง Amplify app เพิ่มไม่ได้

หาก AWS ตอบ `ServiceLimitExceeded` ที่ `AWS::Amplify::App` ให้เก็บผล rollback แล้วใช้ `CreateHosting=false ConnectBackend=false` ตอนสร้าง Frontend Stack เพื่อสร้างเฉพาะ bucket สำหรับ artifact ตั้ง `DocumentOrigin` และ `SessionOrigin` เป็น `https://trial.cstuhub.invalid` ซึ่งใช้เป็นค่า Origin จำลองสำหรับตรวจ CSRF ทำขั้น seed, upload ZIP และ Backend ตามเดิม แล้วทดสอบด้วยคำสั่งนี้

```bash
python infra/trial-smoke.py verify "$TRIAL" --profile "$AWS_PROFILE" \
  --account "$ACCOUNT" --password-file "$work_dir/synthetic-password" --direct-api
```

ใช้คำสั่งเดียวกันก่อนและหลังอัปเดต stage จากนั้นลบ stack และตรวจ retention ตามขั้นถัดไป ผลนี้ยืนยันเส้นทาง API Gateway, Lambda และข้อมูลของ trial การทดสอบ Amplify Hosting และ rewrite ต้องสร้าง app แยกและรันขั้นตอนปกติเมื่อมีโควตา

## 3. Update, verify และ cleanup

1. สร้าง Backend Change Set จากพารามิเตอร์เดิม เปลี่ยน `ApiRateLimit=10` เป็น `ApiRateLimit=8` ตรวจว่าเปลี่ยนเฉพาะ stage และไม่มี replacement จึง execute และรอ `UPDATE_COMPLETE`
2. อ่านค่าของ stage จริงด้วย `aws apigatewayv2 get-stage` แล้วรัน `verify` อีกรอบ เทียบผลกับก่อนอัปเดต
3. ก่อนลบ ให้บันทึก Outputs ของ Data และ Frontend, ชื่อ stack, ชื่อ secret และรายการที่ต้องเก็บไว้ ตรวจว่าทุกชื่อเป็นของ trial
4. ลบตามลำดับ Frontend → Backend → Data ใช้ `aws cloudformation delete-stack --stack-name "$STACK"` และรอ `aws cloudformation wait stack-delete-complete --stack-name "$STACK"` ทีละ stack เพราะมีการ import outputs ข้าม stack
5. ใช้ `aws dynamodb describe-table` ยืนยันว่า Users, IdentityLinks, Partners และ Business ยังอยู่ ส่วน Sessions และ LoginRate ต้องได้ `ResourceNotFoundException` ตรวจ S3 ทั้งสอง bucket ด้วย `aws s3api head-bucket` และยืนยันว่ากฎ HTTPS ของ bucket เอกสารยังอยู่ด้วย `get-bucket-policy` และไฟล์จำลอง `v5-smoke/retention.txt` ยังอยู่ด้วย `head-object` สำหรับตาราง Partners อ่านเฉพาะ fixture `v5-smoke-public` ด้วย key `id` และ `type=Company` เพื่อยืนยันว่าข้อมูลยังอยู่
6. หลังเก็บหลักฐาน ให้ทีมตกลงเวลาทิ้งทรัพยากรที่ retain เพราะอาจมีค่าใช้จ่าย เช่น PITR, object versions และ Secrets Manager ใช้ชื่อ trial เท่านั้น สำหรับ bucket แบบ versioned ต้องจัดการ object versions และ delete markers ทั้งหมดก่อนลบ bucket ตั้งเวลาลบ secret ด้วย recovery window ของ Secrets Manager และลบไฟล์รหัสผ่านชั่วคราวจากเครื่องเมื่อเสร็จ

## 4. ย้อนกลับและบันทึกหลักฐาน

หาก update ล้มเหลว ตรวจ stack events และสถานะ rollback ก่อนรันซ้ำ หาก update สำเร็จแต่แอปผิดปกติ สร้าง Change Set จาก template และพารามิเตอร์ก่อนหน้า ใช้ ZIP และ secret version เดิม สำหรับหน้าเว็บให้ปล่อย static ZIP รุ่นก่อนใน Amplify app ทดลอง หากข้อมูลหาย ให้ประเมิน PITR/backup และ S3 versioning แยกจากการย้อน template และตรวจ ID, references, สิทธิ์ และ object version ก่อนสลับระบบ

บันทึก commit, Actions run, Region, stack IDs, Change Set IDs, สถานะ Create/Update/Delete, ผล smoke ก่อนและหลัง update, และรายการที่ retain หลัง cleanup ตาม [Issue #246](https://github.com/Micosz/Cs361-Group1-Project7/issues/246) สำหรับ production ให้ใช้ขั้น release และ rollback ของ [V4 Deployment](v4-deployment.md) กับ [Auto Deploy](node-lambda-autodeploy.md) และตรวจการเปลี่ยน IAM/CloudFormation กับทีมก่อน apply

## 5. ผลทดสอบจริงวันที่ 8 พฤศจิกายน 2026

ชุดทดลอง `cstuhub-iac-246nov08` ใช้ AWS Singapore และแพ็ก Lambda ทั้งสี่จาก commit `1ee195a` ด้วยข้อมูลจำลองทั้งหมด

| ขั้น | ผลที่ตรวจจาก AWS |
| --- | --- |
| Amplify Hosting | การสร้าง app แยกตอบ `ServiceLimitExceeded` และ Frontend Stack รอบแรก rollback จึงยังไม่มีผลทดสอบ Hosting หรือ rewrite |
| Create | Frontend แบบ bucket-only, Data และ Backend ได้ `CREATE_COMPLETE` จาก Change Set ที่ตรวจแล้ว |
| Verify | API Gateway และการ invoke catalog Lambda คืนเฉพาะ partner สาธารณะ TU adapter คืน error ตาม configuration ของ trial และการล็อกอิน ตรวจ session และออกจากระบบด้วยผู้ใช้จำลองผ่าน |
| Update | Change Set เปลี่ยนเฉพาะ `DefaultStage` และ AWS แสดง rate limit จาก 10 เป็น 8 คำขอต่อวินาที ผล smoke test หลังอัปเดตผ่านอีกครั้ง |
| Delete และ retention | ทั้งสาม stack ได้ `DELETE_COMPLETE` ตาราง Sessions และ LoginRate หายไป ส่วน Users, IdentityLinks, Partners และ Business ยังอยู่ S3 ทั้งสอง bucket ยังอยู่ และตรวจพบ HTTPS policy, ไฟล์จำลอง และข้อมูล partner ตามแผน |

Secrets Manager ของ trial ถูกสร้างแยกจาก CloudFormation และอยู่ในรายการ cleanup หลังทดสอบร่วมกับทรัพยากรที่ retain ตามข้อ 3
