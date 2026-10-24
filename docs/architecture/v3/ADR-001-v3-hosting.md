# ADR-001: แนวทาง Hosting และ Application Architecture สำหรับ V3

## บริบทและข้อจำกัด

V1 ให้บริการหน้าเว็บและข้อมูลสาธารณะแบบ static โดยไม่ต้องมีฐานข้อมูลหรือระบบ Login จึงเลือก Amazon S3 Static Website Hosting เพื่อให้ระบบเรียบง่ายและเหมาะกับข้อจำกัดของ AWS Learner Lab. V2 เปลี่ยน Frontend Hosting เป็น AWS Amplify และเพิ่ม API Gateway, Lambda และ DynamoDB เพื่ออ่านข้อมูลสาธารณะโดยไม่ให้ Browser เชื่อมฐานข้อมูลหรือถือ AWS credentials โดยตรง
V3 เพิ่มบัญชีและเซสชัน, การตรวจสิทธิ์ตามบทบาท/ขอบเขต, ข้อมูล Agreement และ Exchange รวมถึงเอกสารที่ต้องอ่านได้เฉพาะผู้มีสิทธิ์. V3 design กำหนด opaque server-side session, same-origin `/api`, backend authorization และ private object storage เป็น baseline แต่ระบุชัดว่าการตั้ง routing, cookie และ AWS resources ต้องตรวจใน environment จริงก่อนรับรอง

## ทางเลือกที่พิจารณา

### Authentication และ Session

ตารางนี้ตรึง Frontend เป็น **AWS Amplify Hosting** เหมือนกันทุกทางเลือก เพื่อเปรียบเทียบเฉพาะวิธียืนยันตัวตนและการออก Session. Amplify Hosting ไม่ได้เปิด Cognito หรือสร้างระบบ Login ให้โดยอัตโนมัติ. การยืนยันตัวตนตอบว่า “ผู้ใช้เป็นใคร”; Backend ของ CSTUHub ยังต้องตรวจ role, capability และ scope สำหรับทุกคำขอไม่ว่าจะเลือกทางใด

| ทางเลือก | การเชื่อมกับ TU | ข้อดี | ข้อจำกัดและงานที่ต้องทำ | หลักฐาน/สถานะใน repository |
| --- | --- | --- | --- | --- |
| **1. Amplify + ระบบ Login/Session ของ CSTUHub + TU API** | Backend เรียก `tuAuthLogin` เพื่อตรวจบัญชี แล้วผูก identity กับบัญชีภายใน | ใช้ TU เป็นแหล่งยืนยันตัวตน; บัญชีภายในเก็บ role/scope ของระบบ; เข้ากับ session แบบ opaque ที่ออกแบบไว้ | ทีมต้องดูแล Session, expiry/revoke, CSRF, origin, rate limit, account linking และการติดตามปัญหา TU; Login พึ่งความพร้อมของ TU API | ใกล้กับ code path ที่พบใน [`lambda_function.py`](../../../backend/lambda_function.py) และ [`tu_provider.py`](../../../backend/auth/tu_provider.py); เป็นหลักฐานระดับ source ไม่ใช่การยืนยัน AWS live |
| **2. Amplify + Cognito User Pool สำหรับบัญชีของระบบ** | Cognito ตรวจบัญชีใน User Pool; ไม่ได้ใช้ TU account โดยอัตโนมัติ | ใช้ความสามารถจัดการบัญชีและออก token ของ Cognito; ลดงานที่ทีมต้องสร้างระบบรหัสผ่าน/วงจรบัญชีเอง | ต้องกำหนดการสร้าง/ยืนยัน/กู้บัญชีและเชื่อม Cognito identity กับบัญชี/role/scope ภายใน; ถ้าผู้ใช้คาดว่าจะใช้บัญชี TU ทางเลือกนี้ยังไม่ตอบโจทย์นั้น; ต้องออกแบบการส่ง token หรือแลกเป็น CSTUHub Session ใหม่ | ไม่พบ Cognito integration ใน source path ปัจจุบัน; ยังเป็นทางเลือกที่ต้องทดลองและอนุมัติ |
| **3. Amplify + Cognito ที่เชื่อม TU เป็น Identity Provider** | Cognito รับการยืนยันจาก TU ผ่าน OIDC หรือ SAML แล้วออก token ให้แอป | ได้รูปแบบ token กลางจาก Cognito และอาจให้ TU เป็นผู้ยืนยันบัญชีต่อไป | ต้องให้ TU รองรับ OIDC/SAML และจัดเตรียม metadata, client configuration และ claims ที่เชื่อถือได้; ต้องทดสอบ account linking และคงการตรวจ role/scope ที่ Backend; source ปัจจุบันยังไม่ยืนยันว่า TU API รองรับ federation | เป็นไปได้เมื่อ TU มี OIDC/SAML; AWS รองรับ external IdP ตาม [คู่มือ Cognito](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-identity-federation.html), แต่ยังไม่มีหลักฐานการตั้งค่า TU ใน repository |

หาก TU มีเพียง REST API สำหรับตรวจบัญชีและไม่มี OIDC/SAML อาจประเมิน Cognito Custom Authentication ที่ใช้ Lambda เรียก TU เพิ่มเติมได้ แต่ต้องใช้ client flow ที่พัฒนาเอง
AWS ระบุว่า custom auth แบบ Lambda ใช้กับ Managed Login/Hosted UI ไม่ได้ ([คู่มือ authentication flows](https://docs.aws.amazon.com/cognito/latest/developerguide/authentication-implement.html)). วิธีนี้จึงไม่ใช่การเปิด Cognito แล้วต่อ TU API ได้ทันที

ในเชิง flow ทางเลือก 1 ต้องเรียก TU ตอน Login และตรวจ Session ของ CSTUHub ในคำขอที่ต้องมีสิทธิ์; ทางเลือก 2/3 ย้ายงานยืนยันตัวตนบางส่วนไป Cognito แต่ยังต้องตรวจ identity mapping และสิทธิ์ที่ Backend; ทางเลือก 3 เพิ่มการ redirect/token exchange และถ้า TU มีเพียง REST API จะมี Lambda/custom UI เพิ่ม.

การเชื่อม Browser เข้ากับ DynamoDB โดยตรงไม่พิจารณาเป็นทางเลือก เพราะจะทำให้การควบคุมสิทธิ์และการปกป้อง AWS credentials ซับซ้อนหรือเสี่ยงเปิดเผย

## สิ่งที่เลือก

เสนอ **AWS Amplify Hosting สำหรับ Frontend** และคงแนวทาง **API Gateway HTTP API → AWS Lambda → DynamoDB / private Amazon S3** สำหรับ V3 โดยให้ Frontend เรียก `/api/*` ผ่าน origin เดียวกับเว็บ เมื่อยืนยัน rewrite และ cookie behavior ใน environment เป้าหมายแล้วเท่านั้น

สำหรับ Authentication เสนอให้ใช้ทางเลือก **1: TU API ผ่าน Backend และ Session ของ CSTUHub** เป็น baseline ปัจจุบัน เพราะตรงกับ source และ contract ที่มีอยู่; ยังไม่ใช่การปฏิเสธ Cognito ถ้า TU ยืนยัน OIDC/SAML ได้ หรือทีมเลือกจัดการบัญชีแยก สามารถประเมินทางเลือก 2/3 พร้อม identity-linking, Session/token และ authorization design ใหม่ก่อนตัดสินใจ

- Amplify build ใช้ `amplify.yml`: รัน `npm run build` และเผยแพร่ไฟล์จาก `public/`; ปัจจุบันไม่มี frontend test suite ใน root `tests/`. ไฟล์นี้ไม่ได้บันทึก `/api` rewrite; ต้องตรวจการตั้งค่า Rewrites and redirects ของ Amplify แยกต่างหาก
- Lambda เป็นจุดบังคับใช้ session, role, scope และ policy; login adapter ใน source เรียก `tuAuthLogin` ฝั่ง server. ห้ามนับการมี `tuAuthLogin` ใน repository เป็นหลักฐานว่า TU API หรือ Login ทำงานได้ใน AWS
- DynamoDB เป็นที่เก็บบัญชี/Identity link/session/rate limit และข้อมูลระบบผ่าน adapters ที่อ่านชื่อ resource จาก environment. ข้อเสนอนี้ไม่ได้กำหนดว่าต้องรวม/แยกตารางอย่างไร และไม่ได้ยืนยันชื่อตารางจริง
- เอกสารเก็บใน S3 แบบ private; API ตรวจสิทธิ์ก่อนอ่าน metadata/content และส่งเนื้อหากลับ. ไม่เผย public object URL
- คง public catalog เดิมและ `/api/public/records` เป็นเส้นทางที่แยกกันในแผนภาพ จนกว่าจะมีการย้าย/ถอด legacy endpoint และ fallback พร้อมหลักฐาน
- ไม่พบ `.github/workflows/` ใน GitHub `main`; source code และ `amplify.yml` ไม่ได้ยืนยันว่ามี CI หรือ Backend deploy อัตโนมัติ. ให้ตรวจการตั้งค่า deployment และ AWS เป้าหมายแยกก่อนนำไปใช้

ข้อเสนอนี้เลือกแนวทางที่เปลี่ยนจาก V2 น้อยที่สุดและรองรับขอบเขต V3 โดยไม่ผูกการตัดสินใจเข้ากับชื่อตารางหรือ bucket ที่ยังต้องตรวจจริง. ทีมควรยืนยันข้อนี้ก่อนเปลี่ยนสถานะเอกสารเป็น Accepted.

## ผลที่ตามมาและข้อแลกเปลี่ยน

- นำ Hosting V2 มาใช้ต่อได้ และเพิ่มการควบคุม session, authorization และไฟล์ private ที่ Backend; ไม่ต้องเปิด AWS credentials ให้ Browser
- ต้องตรวจสิทธิ์ทุก route และทุกไฟล์ที่ร้องขอ; session/revoke, CSRF, origin, rate limit, cookies, S3 privacy และ IAM เป็นส่วนหนึ่งของ release readiness
- Public fallback ช่วยให้หน้าอ่านข้อมูลสาธารณะได้เมื่อ API ใช้ไม่ได้ แต่ไม่ทำให้ Login, การเขียนข้อมูล หรือการอ่านเอกสาร private ใช้ต่อได้
- การ stream เอกสารผ่าน Gateway/Lambda อาจมีข้อจำกัดด้านขนาด, timeout และ bandwidth; ต้องพิสูจน์ตาม limit ที่ใช้จริงก่อนรับรองไฟล์ขนาดสูงสุด
- ค่าใช้จ่ายขึ้นกับ request, storage, logging, data transfer และระยะเวลาที่ Learner Lab เปิดใช้งาน; ยังไม่มีหลักฐาน workload/billing สำหรับประมาณราคาในร่างนี้

## หลักฐานจาก repository และสิ่งที่ยังไม่ยืนยัน

| สิ่งที่ตรวจพบ                                                                                            | หลักฐานใน repository                                                                                                                                                                                                                        | ขอบเขต/ข้อจำกัด                                                                       |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| V1 เลือก S3 Static Website Hosting; V2 เปลี่ยนเป็น Amplify + API Gateway + Lambda + DynamoDB             | [ADR V1](../v1/ADR-001-v1-hosting.md), [ADR V2](../v2/ADR-001-v2-hosting.md)                                                                                                                                                                | เป็นบันทึกการตัดสินใจเดิม ไม่ใช่สถานะ AWS ปัจจุบัน                                    |
| Backend ประกอบ session/auth, เรียก TU adapter, DynamoDB และ private S3 adapter จาก environment           | [`backend/lambda_function.py`](../../../backend/lambda_function.py), [`backend/documents/storage.py`](../../../backend/documents/storage.py)                                                                                                | เป็น code wiring; ไม่ยืนยัน resource names/permissions หรือ runtime ที่ deploy อยู่   |
| Login path ใน source เรียก TU adapter และใช้ Session/role ของแอป; ไม่พบ Cognito integration ในเส้นทางนี้ | [`backend/auth/tu_provider.py`](../../../backend/auth/tu_provider.py), [`backend/auth/session_service.py`](../../../backend/auth/session_service.py), [V3 design: Authentication Session](../../design/v3-design.md#authentication-session) | ไม่ยืนยันผล Login กับ TU หรือ AWS live; ไม่ได้พิสูจน์ว่า TU รองรับ OIDC/SAML          |
| API route map ระบุ same-origin `/api/*`, public catalog legacy, DynamoDB และ S3 private                  | [V3 API routes](v3-api-routes.md)                                                                                                                                                                                                           | เอกสารระบุ ณ 19 ต.ค. 2026 ว่าต้องตรวจ API Gateway, Amplify rewrite และ resources จริง |
| V3 กำหนดทางเลือก identity, data/API, private documents และ deployment ไว้เป็น baseline                   | [V3 design #93](../../design/v3-design.md#architecture-migration-current--target)                                                                                                                                                           | เป็น design baseline; ไม่ใช่การอนุมัติครบทุกข้อหรือหลักฐาน deployment                 |
