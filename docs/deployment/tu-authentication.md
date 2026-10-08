# ตั้งค่าและเชื่อม TU Authentication — #75

## เป้าหมายและขอบเขต

`backend/lambda/tuAuthLogin/index.mjs` เรียก TU จาก Backend ตรวจคำตอบ แล้วคืน profile สำหรับ #74/#76 ไม่มีการสร้าง User, มอบหมาย role หรือออก Session ใน #75 และไม่เปลี่ยน API Gateway/Amplify

## เอกสารและ endpoint

ตรวจวันที่ **9 ตุลาคม 2026**:

- [TU Authentication](https://restapi.tu.ac.th/home/documents/Authen.html): POST JSON, headers `Content-Type: application/json` และ `Application-Key`, body `UserName`/`PassWord`; response มี boolean `status` และ `type` student/employee
- [Getting started](https://restapi.tu.ac.th/home/documents/getting-started.html): สร้างและเปิด channel เพื่อรับ key; ไม่ต้องสร้างใหม่ถ้าทีมมีสิทธิ์อยู่แล้ว
- [Developer Portal](https://restapi.tu.ac.th/tuapi/): ผู้มีสิทธิ์ต้องตรวจ endpoint และบริการของ channel ก่อนเปิดใช้งานจริง

หน้าเอกสารสาธารณะที่อ่านไม่ได้ยืนยัน URL endpoint ของบัญชีทีม ใน source เดิมของโครงการใช้ `https://restapi.tu.ac.th/api/v1/auth/Ad/verify2` ซึ่งเป็น URL ที่ผู้รับผิดชอบให้มา ไม่ใช่ URL ที่สร้างขึ้นใหม่ งานนี้ยังไม่ได้ยืนยันสิทธิ์ผ่าน Portal หรือทดสอบบัญชี TU จริง จึง **ไม่มี default URL ในโค้ด** ผู้รับผิดชอบต้องยืนยันก่อนตั้ง `TU_AUTH_URL` ห้ามลองเดา path หรือส่งรหัสผ่านไป endpoint อื่น

เอกสารระบุ 1,000 requests/hour/user/key เป็นข้อมูลจากเอกสาร ไม่ใช่ผลตรวจ quota จริงของ channel ทีม

## ตั้งค่าก่อน merge/deploy

1. เปิด Lambda `tuAuthLogin` ใน `us-east-1` → Configuration → Environment variables ของสภาพแวดล้อมที่จะใช้
2. ตรวจและคง `TU_APP_KEY` ที่มีสิทธิ์ใช้ authentication ไว้ฝั่ง Lambda เท่านั้น อย่าคัดลอกลง source, issue, PR หรือ screenshot
3. ตั้ง `TU_AUTH_URL` เป็น HTTPS endpoint ที่ยืนยันกับ Portal/ผู้ให้บริการแล้ว โค้ดยอมรับเฉพาะ origin `https://restapi.tu.ac.th` ไม่มี user/password ใน URL, query หรือ fragment และไม่ตาม redirect
4. ตรวจ Lambda timeout ให้ **มากกว่า 8 วินาที** เช่น 12 วินาที เพื่อให้ adapter คืนข้อผิดพลาดได้ก่อน Lambda ถูกตัด ค่านี้เป็นข้อเลือกของระบบ ไม่ใช่ข้อบังคับ TU
5. ตรวจ API Gateway/Lambda/APM ว่าไม่เก็บ request body, password, key หรือ raw provider response ใน logs ห้ามเปิด full request/response tracing สำหรับ Login
6. ตรวจเพียงชื่อ environment variables และสถานะว่ามีค่า ไม่ dump configuration/environment ทั้งชุด ค่า key ของ dev/test/production เก็บแยกตาม environment และสิทธิ์ของทีม
7. ให้เพื่อน Review แล้วจึง merge/deploy ตาม [Lambda CI/CD](lambda-cicd.md); workflow อัปเดตเฉพาะ source **ไม่ได้ตั้ง environment หรือ timeout ให้** ไม่ต้องเปลี่ยน Amplify เพื่อใช้ adapter นี้

หากยังไม่ตั้ง URL/key โค้ดจะคืน 503 `AUTH_CONFIGURATION_UNAVAILABLE` และไม่เรียก TU การ deploy source ใหม่โดยไม่เตรียมค่าตั้งจะทำให้ Login ยังใช้งานไม่ได้

`TU_APP_KEY`/`TU_AUTH_URL` เป็นค่า **Lambda Backend** ไม่ใช่ AWS credential secrets ของ GitHub Actions การ deploy ผ่าน Learner Lab ยังต้องใช้ GitHub Secrets `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` ที่ไม่หมดอายุ ตามคู่มือ CI/CD

## Request / response ที่ใช้ตอนนี้

รองรับ POST ของ API Gateway REST/v2 โดยคง body ที่ branch `74-TU-Login` ใช้:

```json
{"UserName":"example-account","PassWord":"example-password"}
```

ค่าข้างต้นเป็นตัวอย่างสมมติ ไม่ใช่ credentials จริง ตรวจ string/ความยาว username 1–128 และ password 1–512 ตาม #92 ไม่ trim/case-fold ค่าที่ส่งไป TU; field type/role/userId/profile จาก Browser ไม่ถูกส่งให้ TU หรือใช้ให้สิทธิ์

TU request ใช้ POST JSON พร้อม key ฝั่ง Server; timeout **8 วินาที** ครอบคลุมการรอ headers และอ่าน body, abort เมื่อหมดเวลา และ **ไม่ retry อัตโนมัติ** รวมกรณี rate-limit

สำเร็จต้อง HTTP success + JSON object + `status === true` + `type` student/employee เท่านั้น ไม่รับ string `"true"` และไม่เติม student เมื่อ type หาย ชื่อและ email ถ้ามีต้องเป็น string; ถ้าไม่มีจะเป็น `""` ตามรูปแบบเดิม คืนเฉพาะ profile allowlist:

```json
{"success":true,"message":"Login successful","user":{"username":"example-account","type":"student","displayname_th":"","displayname_en":"","email":""}}
```

ไม่คืน department/organization, password, key, provider message หรือ raw response; employee ไม่ถูกแปลงเป็นอาจารย์/เจ้าหน้าที่/ผู้บริหาร Error คง `success/message` ให้ #74 พร้อม `code` สำหรับแยกกรณี:

| กรณี | HTTP / code |
| --- | --- |
| body/username/password ไม่ถูกต้อง | 400 `INVALID_REQUEST` |
| TU `status === false` | 401 `INVALID_CREDENTIALS` |
| key/URL หายหรือ URL ไม่ผ่านกติกา; TU HTTP 401/403 | 503 `AUTH_CONFIGURATION_UNAVAILABLE` |
| TU JSON/status/type/profile ผิดรูปแบบ หรือ HTTP 4xx อื่น | 502 `AUTH_PROVIDER_INVALID_RESPONSE` |
| network, timeout, redirect หรือ TU HTTP 5xx | 503 `AUTH_PROVIDER_UNAVAILABLE` |
| TU HTTP 429 | 429 `RATE_LIMITED`; `Retry-After` 1–300 วินาที, fallback 60 |

HTTP 401/403 จาก TU ถูกจัดเป็นปัญหา channel/key ตามเอกสาร TU ไม่ส่งข้อความของผู้ให้บริการกลับ Browser ต้องยืนยันพฤติกรรม wrong-password กับบัญชีทดสอบจริงก่อนเปิดระบบ Errors ไม่มี `user` และทุก response เป็น `Cache-Control: no-store` Logs ใน adapter มีเฉพาะ category code ของ server failures ไม่ใช้ `error.message` จาก dependency

## ส่งต่องานให้เพื่อน

- **#74:** ใช้ response `success/message/user` เดิมได้ แสดง error จาก `message`/`code`, ห้ามถือ profile ใน sessionStorage เป็นหลักฐานสิทธิ์; เมื่อรวม V3 ให้เปลี่ยนไปใช้ response ของ Session ตาม #92
- **#76:** import `createTuAuthenticator` แล้วเรียก `await createTuAuthenticator()({UserName, PassWord})` จาก Backend จะได้ verified profile หรือ throw `TuAuthError` ที่มี `code/statusCode/retryAfter` ใช้ profile นี้เชื่อมบัญชีเท่านั้น ห้ามส่ง profile จาก Browser เข้า account linker และไม่ควรเรียก TU ซ้ำใน request เดียว
- **#77:** employee ยังต้องมอบหมายบทบาทภายในเอง ไม่เดาจากหน่วยงาน; student grant/scope อยู่ใน #76 ตามกติกา issue ปัจจุบัน
- **#74/#78/#79:** ต่อ account linking → authenticated Session/Origin/CSRF → ตรวจ role/scope/participant ตามสัญญาของแต่ละงาน Adapter นี้ยังใช้ CORS เดิมสำหรับ API ปัจจุบัน จึงยังไม่ใช่ endpoint สำหรับ cookie Session ข้าม origin
- **ก่อนเปิด Login V3:** ทำ local rate limit ตาม #90 (identity fingerprint/IP) ก่อนเรียก TU ใน Login orchestration; #75 รองรับผล quota จาก TU แล้ว แต่ไม่ได้เพิ่ม rate-limit store/resources ในงานนี้
- **ผู้มีสิทธิ์ TU/AWS:** ยืนยัน endpoint/channel, ตั้ง env/timeout และตรวจ logs; ทดสอบ student/employee, wrong password, key ผิด/429 ด้วยวิธีที่ได้รับอนุญาต ไม่ยิงซ้ำจนติด quota ไม่เก็บรหัสผ่านหรือ key เป็นหลักฐาน

#76 branch ที่ตรวจยังไม่มี account-linking implementation เพิ่มจาก main; #78 เป็น Python และยังไม่มี Login route ที่เรียก Node adapter จึงต้องตกลง transport ภายในที่เชื่อถือได้ก่อนเชื่อม ห้ามให้ public API รับ verified profile หรือ userId เพื่อออก Session โดยตรง

## ตรวจในเครื่องและหลักฐาน

```sh
node --experimental-vm-modules tests/lambda-source.test.cjs
node --check backend/lambda/tuAuthLogin/index.mjs
```

ชุดเดิมมี 8 tests รวม data functions; ส่วน TU ใช้กลุ่มกรณีจำเป็น ไม่เรียก TU/AWS จริง และถูกเรียกโดย `lambda-ci.yml` เดิมแล้ว ดู [ผลตรวจและสิ่งที่ยังไม่ได้ทดสอบ](../evidence/tu-auth-issue-75.md)
