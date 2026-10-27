# V4 deployment — Singapore

บัญชี `781485979426` ใช้ Singapore (`ap-southeast-1`) เป็นปลายทางใหม่ เก็บ Sydney (`ap-southeast-2`) ไว้ก่อนเพื่อย้อนกลับ

## เหตุผลและขอบเขต

เลือก Singapore เพื่อให้บริการหลักอยู่ Region เดียวกันและใกล้ผู้ใช้ในไทยกว่า Sydney ต้องวัด latency จริงก่อนสรุปผลด้านความเร็ว การย้าย Region ไม่ใช่การเพิ่ม Multi-Region failover

เปิด Singapore ใน SCP เฉพาะบัญชีเว็บและเพิ่มใน Visible Regions ของ Console โดยคงข้อจำกัดบัญชีอื่น งาน VPC หลาย AZ ทำหลังย้ายและตรวจระบบแล้ว ส่วน Cache อยู่ V6 ตาม [#200](https://github.com/Micosz/Cs361-Group1-Project7/issues/200)

## ปลายทาง

| ส่วน | Singapore |
| --- | --- |
| เว็บหลัก | https://main.d1d0za87xu48iv.amplifyapp.com/ |
| Amplify | `d1d0za87xu48iv` / `CSTUHub-Singapore`, repo เดิม branch `main` |
| HTTP API | `gez448y9c5`, stage `default` |
| Lambda | `CSTUHubAuth`, `tuAuthLogin`, `fetchPartnersData`, `getPublicPartners` |
| DynamoDB | `CSTUHub-Business`, `CSTUHub-Partner`, `CSTUHub-Users`, `CSTUHub-IdentityLinks`, `CSTUHub-Sessions`, `CSTUHub-LoginRate` |
| S3 เอกสาร | `cstuhub-private-documents-781485979426-ap-southeast-1` |
| WAF | `CSTUHub-Singapore-Firewall`, สำเนากฎเดิม 3 กฎ |

IAM เป็นบริการ global; WAF ของ Amplify ต้องเป็น Global/CloudFront และจัดการผ่าน `us-east-1` ตามข้อกำหนด AWS จึงไม่ย้าย WAF ไปเป็น regional ACL ใน Singapore

## สิ่งที่ต้องตรงกัน

- Amplify rewrite `/api/<*>` และ `/fetchPartnersData` ไป API Singapore; frontend ใช้ path บนโดเมนเดียวกัน ไม่ผูกกับชื่อเว็บหรือ API ของ Learner Lab
- Lambda ใช้ code/runtime/architecture ของตัวที่ deploy จริงและตรวจ SHA-256 ก่อนคัดลอก ตั้งชื่อตารางเดิมใน Singapore และเปลี่ยน `DOCUMENT_BUCKET` ให้ตรง bucket ใหม่
- `AWS_REGION` มาจาก Lambda runtime ทำให้ `CSTUHubAuth` เรียก `tuAuthLogin` ใน Singapore; execution roles มีสิทธิ์เฉพาะทรัพยากรปลายทางที่จำเป็น คงสิทธิ์ Sydney ไว้ก่อน
- ตั้ง `SESSION_ORIGIN` เป็นโดเมนใหม่ เก็บ origin เดิมในรายการที่ยอมรับระหว่างเปลี่ยน และปรับ S3 CORS ตาม [ไฟล์ตั้งค่า](../../private/s3/cors.json) ไม่เปิด bucket เป็น public
- คัดลอก DynamoDB พร้อม schema/index/TTL และตรวจข้อมูล ไม่ใช้จำนวนโดยประมาณบนหน้า Overview แทนการตรวจรายการจริง
- คัดลอก S3 พร้อม metadata/ขนาด/ETag และทำ mapping `storageVersionId` ใน DynamoDB ไป VersionId ใหม่ ไม่ใช้เลขรุ่นเก่ากับ bucket ใหม่
- GitHub Actions และ `deploy/deploy-auth.py` ปล่อยโค้ด Auth ไป Singapore; workflow นี้ไม่ย้ายข้อมูลหรือแก้ environment secrets

## การสลับและย้อนกลับ

ตรวจ public API, session/login, สิทธิ์อ่านข้อมูล และไฟล์แนบก่อนสลับ หยุดการเขียนฝั่งเดิมช่วง sync สุดท้ายและตรวจว่าไม่มีข้อมูลใหม่ที่ปลายทางถูกเขียนทับ จากนั้นให้ URL Sydney พาไปเว็บใหม่เพื่อไม่ให้เกิดข้อมูลแยกสองชุด

เก็บเว็บ/API/Lambda/ตาราง/bucket/นโยบายเดิม และ on-demand backups ของ DynamoDB ไว้ ห้ามลบ Sydney เพื่อทำความสะอาดระหว่างช่วงนี้ หาก Singapore มีข้อมูลใหม่แล้ว การเปลี่ยน URL กลับอย่างเดียวทำให้ข้อมูลย้อนหลัง ต้องหยุดเขียนและรวมข้อมูลพร้อม mapping รุ่นไฟล์กลับให้ครบก่อน

ผลการดำเนินการและข้อจำกัดล่าสุดให้ดู [คอมเมนต์ #191](https://github.com/Micosz/Cs361-Group1-Project7/issues/191#issuecomment-6435078891) และบันทึกผลหลังสลับ ไม่ใช้เอกสารขั้นตอนนี้เป็นหลักฐานว่าทดสอบทุกกรณีแล้ว

อ้างอิง: [SCP](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html) · [WAF กับ Amplify](https://docs.aws.amazon.com/amplify/latest/userguide/amplify-waf-configuration.html) · [S3 copy](https://docs.aws.amazon.com/AmazonS3/latest/userguide/copy-object.html)
