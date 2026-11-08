# Lambda deployment tools

ขั้นตอนตั้งค่า ปล่อยโค้ด ตรวจผล และ rollback อยู่ใน [คู่มือ Deployment V4](../docs/deployment/v4-deployment.md)

เครื่องมือชุดนี้ดูแลโค้ด `CSTUHubAuth`, `tuAuthLogin`, `fetchPartnersData` และ `getPublicPartners` ในบัญชี `781485979426`, Region `ap-southeast-1` ไม่เปลี่ยน environment, IAM, API, DynamoDB, S3

| ไฟล์ | หน้าที่ |
| --- | --- |
| [lambda-deploy.yml](../.github/workflows/lambda-deploy.yml) | Workflow สำหรับแพ็ก source และ deploy จาก main |
| [package-auth-lambda.py](../scripts/package-auth-lambda.py) | แพ็ก Python ที่ commit แล้ว พร้อม SOURCE_COMMIT |
| [deploy-auth.py](deploy-auth.py) | ตรวจปลายทางและ commit สำรอง version อัปเดตโค้ด และตรวจ hash/config |
| [github-auth-trust.json](policies/github/github-auth-trust.json) | OIDC trust สำหรับ repository และ branch main ของโครงการ |
| [github-auth-deploy.json](policies/github/github-auth-deploy.json) | สิทธิ์ deploy เฉพาะ Lambda ทั้งสี่ตัว |

Artifact เก็บใน GitHub Actions 7 วัน ไม่เก็บ ZIP หรือ credentials ใน repository Auth ใช้ boto3 จาก runtime; Node catalog ZIP รวม production dependencies จาก package-lock แล้ว

Auth source: `backend/lambda/CSTUHubAuth/backend/`. Packaging preserves `backend/`
at the ZIP root; the AWS handler and deployment verification remain unchanged.

## IAM policy files

- `policies/github/`: trust and deployment permissions for the GitHub Actions role.
- `policies/lambda/`: runtime permissions for the Lambda execution role, including [document bucket controls](policies/lambda/cstuhub-auth-document-bucket-controls.json).

These JSON files are configuration references. Moving or committing them does not apply IAM changes to AWS. Runtime policies are applied separately from the code-only deployment script.

## S3 configuration references

[S3 settings](s3/README.md) are grouped separately from Lambda release tooling. See the [private document storage guide](../docs/deployment/private-document-storage.md) for setup and the [historical Sydney checks](../docs/evidence/s3-direct-upload-2026-10-25.md) for recorded evidence. These files are not applied automatically by the current workflow.

ดู [การตั้งค่า auto deploy ทั้งสี่ Lambda](../docs/deployment/node-lambda-autodeploy.md) ก่อน merge: ต้อง apply IAM policy ที่ปรับแล้วและตรวจ runtime/handler จริงใน AWS การ commit policy ไม่ได้เปลี่ยนสิทธิ์บน AWS

[`scripts/package-node-lambda.py`](../scripts/package-node-lambda.py) แพ็ก Node ZIP พร้อมตรวจ export ของ handler; สคริปต์ `deploy-auth.py` ใช้ร่วมกันโดยเลือก `--function` และใช้ `--preflight` ตรวจแบบไม่เขียน AWS ได้
