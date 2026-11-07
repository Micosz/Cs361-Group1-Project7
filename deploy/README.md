# Auth Lambda deployment tools

ขั้นตอนตั้งค่า ปล่อยโค้ด ตรวจผล และ rollback อยู่ใน [คู่มือ Deployment V4](../docs/deployment/v4-deployment.md)

เครื่องมือชุดนี้ดูแลเฉพาะโค้ด `CSTUHubAuth` ในบัญชี `781485979426`, Region `ap-southeast-1` ไม่เปลี่ยน environment, IAM, API, DynamoDB, S3 หรือ Lambda ตัวอื่น

| ไฟล์ | หน้าที่ |
| --- | --- |
| [lambda-deploy.yml](../.github/workflows/lambda-deploy.yml) | Workflow สำหรับแพ็ก source และ deploy จาก main |
| [package-auth-lambda.py](../scripts/package-auth-lambda.py) | แพ็ก Python ที่ commit แล้ว พร้อม SOURCE_COMMIT |
| [deploy-auth.py](deploy-auth.py) | ตรวจปลายทางและ commit สำรอง version อัปเดตโค้ด และตรวจ hash/config |
| [github-auth-trust.json](policies/github/github-auth-trust.json) | OIDC trust สำหรับ repository และ branch main ของโครงการ |
| [github-auth-deploy.json](policies/github/github-auth-deploy.json) | สิทธิ์ deploy เฉพาะ CSTUHubAuth |

Artifact เก็บใน GitHub Actions 7 วัน ไม่เก็บ ZIP หรือ credentials ใน repository การแพ็กไม่รวม dependencies ภายนอก ต้องปรับวิธีแพ็กหรือ layer ก่อนเพิ่ม dependency ใหม่

Auth source: `backend/lambda/CSTUHubAuth/backend/`. Packaging preserves `backend/`
at the ZIP root; the AWS handler and deployment verification remain unchanged.

## IAM policy files

- `policies/github/`: trust and deployment permissions for the GitHub Actions role.
- `policies/lambda/`: runtime permissions for the Lambda execution role, including [document bucket controls](policies/lambda/cstuhub-auth-document-bucket-controls.json).

These JSON files are configuration references. Moving or committing them does not apply IAM changes to AWS. Runtime policies are applied separately from the code-only deployment script.

## S3 configuration references

[S3 settings](s3/README.md) are grouped separately from Lambda release tooling. See the [private document storage guide](../docs/deployment/private-document-storage.md) for setup and the [historical Sydney checks](../docs/evidence/s3-direct-upload-2026-10-25.md) for recorded evidence. These files are not applied automatically by the current workflow.
