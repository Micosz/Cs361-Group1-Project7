# TU identity and Session — #90

**V3-B1 · design baseline · 8 October 2026** · [สารบัญ](README.md)

## Provider evidence และข้อจำกัด

เปิดอ่าน [TU Authentication](https://restapi.tu.ac.th/home/documents/Authen.html), [Getting started](https://restapi.tu.ac.th/home/documents/getting-started.html) และ [Developer Portal](https://restapi.tu.ac.th/tuapi/) วันที่ 8 ต.ค. 2026 เอกสารอธิบาย JSON POST พร้อม application key, username/password, boolean result และ profile สำหรับ student/employee; quota ที่หน้าเอกสารระบุคือ 1,000 requests/hour/user/key เป็นค่าจากเอกสาร ยังไม่ได้ยืนยันโควตาของทีม

หน้าเอกสารที่อ่านไม่ให้หลักฐาน endpoint ที่ทีมได้รับอนุญาตและ stable person ID เพียงพอ; Portal ต้อง Login จึงไม่มีผลจริงจากบัญชีทีม ไม่ส่ง credentials, ไม่สร้าง channel/key และไม่ทดลอง URL ที่ประกอบเอง `TU_AUTH_URL` ต้องได้จากผู้ให้บริการ/portal ของบัญชีที่มีสิทธิ์ก่อนเปิด integration ส่วน key เก็บใน server secret configuration เท่านั้น

Contract สำหรับ adapter: ส่ง `Content-Type: application/json`, `Application-Key` และ body `UserName`/`PassWord`; รับเฉพาะ HTTP success + object schema + `status === true` และ profile shape/type ที่ตรวจตาม provider contract จริง ไม่ถือ HTTP 200 หรือ truthy string ว่าสำเร็จ Profile ใช้แสดงชื่อ/หน่วยงานเท่าที่จำเป็น ไม่ตีความ employee เป็น staff/executive

## ข้อเลือก identity

- ใช้ UUID `userId` ภายในเป็น owner/participant/responsible key; แยก `IdentityLink` (provider=`tu`) จาก profile/email/contact
- ตัวเลือกแรกคือ immutable provider subject ที่ยืนยันได้จริง; **ยังไม่มีหลักฐานว่า TU response มี field นี้** จึงไม่ออกแบบให้ frontend ส่ง subject เอง
- provisional fallback: หลัง TU ยืนยัน credentials สำเร็จเท่านั้น สร้าง identity key เป็น HMAC(server secret, provider + exact submitted username) และ UUID no-role ที่แยกจาก privileged accounts ไม่เก็บ password; username แก้ case/trim/alias เฉพาะที่ provider ยืนยันว่าเทียบเท่า ห้าม merge บัญชีจาก email หรือชื่อเหมือนกัน
- กำหนด uniqueness ของ identity key; concurrent first logins ต้องสร้างเพียงบัญชีเดียว alias/username เปลี่ยนให้หยุด automatic linking และให้ผู้รับผิดชอบตรวจหลักฐานแล้วผูกเข้าบัญชีเดิม แบบมี audit ไม่ transfer role อัตโนมัติ
- privileged grant ต้องมี `identityVerified=true` จากกระบวนการตรวจ link แล้ว; provisional no-role ใช้ได้เฉพาะ Public จน mapping ถูกยืนยัน ไม่มีการรับ userId/role จาก TU success ที่ frontend ส่งมา
- ทดลองด้วยบัญชีที่อนุญาตอย่างน้อย student/employee, ตรวจ repeat login และ aliases ก่อนเปิด #76; ถ้า username ไม่มีความคงที่และพิสูจน์ mapping ไม่ได้ ให้หยุด privileged account linking ไม่แก้ด้วย email fallback

## เปรียบเทียบและเลือก Session

| ทางเลือก | ผลต่อโครงการ | ข้อเลือก |
| --- | --- | --- |
| Opaque cookie + server Session store | ตรวจ expiry/revoke/grants ล่าสุดได้ทุก request แต่เพิ่ม store lookup | **เลือก baseline** เหมาะกับบทบาทเปลี่ยนได้และเว็บ browser เดียว |
| Self-contained JWT ใน browser | ต้องออกแบบ refresh/revocation เพิ่ม; role claims เก่าอาจอยู่จน expiry | ไม่เลือกใน V3 baseline |
| Redirect SSO/OIDC | ลดการรับรหัสผ่านใน app ถ้าผู้ให้บริการรองรับ | ยังไม่มีหลักฐาน TU รองรับในบริการนี้ จึงไม่สมมติว่ามี |

อ้างอิงแนวทาง cookie/expiry จาก [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) และ CSRF จาก [OWASP CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) ค่าต่อไปนี้เป็น **ค่าที่เลือกเองสำหรับ baseline** ไม่ใช่ข้อกำหนด TU

## Session lifecycle และ browser boundary

1. ให้ frontend เรียก same-origin `/api`; routing ไป backend ต้องพิสูจน์บน Amplify/custom domain ก่อน deploy ไม่สมมติว่าตั้งค่าแล้ว ถ้าต้อง cross-origin ต้องออกแบบ cookie/CORS ใหม่ ไม่ใช้ wildcard credentials
2. `GET /api/auth/session` สร้าง pre-login anonymous Session เฉพาะเมื่อจำเป็น พร้อม CSRF token ผูก Session; `Cache-Control: no-store` cookie `__Host-cstuhub`, `Secure; HttpOnly; SameSite=Lax; Path=/` และไม่มี Domain
3. `POST /api/auth/login` ตรวจ exact allowed Origin + CSRF header, input lengths และ rate limit ก่อน TU call; password ไม่ trim หรือ log ส่ง credentials ไป TU จาก server เท่านั้น ปิด request-body logging ของ auth routes/APM
4. เมื่อ TU ผ่านและ account link ถูกต้อง ให้สร้าง random Session token 32 bytes, เก็บ SHA-256 ของ token ฝั่ง store, rotate pre-login token/CSRF และผูก userId/authzVersion ไม่คืน Session token ใน JSON/localStorage
5. Session idle **30 นาที**, absolute **8 ชั่วโมง**; server ตรวจทุก request และเลื่อน idle expiry ได้ไม่เกิน absolute ไม่มี refresh token หรือ silent TU password replay; absolute expiry ต้อง Login ใหม่ store cleanup/TTL ไม่ใช่ตัวตัดสินว่ายัง valid
6. backend อ่าน user active flag และ `authzVersion` แบบ authoritative ทุก protected request; role write เพิ่ม version แบบ atomic ถ้า mismatch ให้ 401 `SESSION_REVOKED` ต้อง Login ใหม่; ตรวจ business grants/scope ทุกครั้ง รวม file download ไม่มี cache decision ข้าม version
7. `POST /api/auth/logout` ตรวจ Origin/CSRF, revoke Session server-side และ expire cookie/clear UI state เป็น idempotent; browser Back/หลาย tabs ต้อง refetch Session ก่อน protected action; API protected ใช้ `no-store` ไม่ใช้ public fallback

CSRF token derive ด้วย HMAC(server CSRF secret, current session token) และเก็บ hash สำหรับตรวจเทียบ ทำให้ GET Session หลาย tabs ไม่เปลี่ยน token ของ Session เดิม; rotate เมื่อ Session token เปลี่ยน ไม่ส่ง secret ให้ browser

CSRF token ต้องอยู่ใน memory และส่ง `X-CSRF-Token` สำหรับ login/logout/ทุก mutation; token หายหรือ Origin ไม่ตรง → 403 ก่อนทำ side effect GET/HEAD ไม่ทำ business mutations Cookie alone ไม่พอป้องกัน CSRF Return path รับเฉพาะ relative route ใน allowlist ภายใน app ไม่มี external redirect

## Timeout/error/rate-limit policy

TU call timeout **8s**, ไม่มี automatic retry ของ credential POST; initial local limit **5 attempts/5 minutes ต่อ identity fingerprint และ 30/5 minutes ต่อ IP**, ไม่บันทึกรหัสผ่านหรือ raw username ใน rate-limit logs ค่านี้ต้องปรับตาม provider quota จริง หลีกเลี่ยง hard account lock ที่คนอื่นใช้ทำ DoS

| Condition | App result / Session |
| --- | --- |
| success + verified application link | 200 `{user, grants, capabilities, csrfToken}`; new authenticated Session |
| success แต่ provisional/no-role | 200 user ไม่มี business grants; หน้าขอสิทธิ์ ไม่เข้าข้อมูลภายใน |
| wrong credentials / `status=false` | 401 `INVALID_CREDENTIALS`; ไม่สร้าง authenticated Session |
| response schema ไม่ตรง | 502 `AUTH_PROVIDER_INVALID_RESPONSE`; ไม่เชื่อ profile/สร้าง Session |
| missing config/invalid application key | 503 `AUTH_CONFIGURATION_UNAVAILABLE`; แจ้งผู้ดูแลผ่าน error code ที่ไม่มี key |
| timeout/provider unavailable | 503 `AUTH_PROVIDER_UNAVAILABLE`; ฟอร์มไม่กล่าวว่า Login สำเร็จ |
| local/provider quota exceeded | 429 `RATE_LIMITED`; bounded `Retry-After` ไม่ retry รหัสผ่านเอง |
| identity mapping ambiguous | 409 `IDENTITY_REVIEW_REQUIRED`; ไม่รวมบัญชีหรือให้ grants |
| missing/expired/revoked Session | 401 `AUTH_REQUIRED` / `SESSION_EXPIRED` / `SESSION_REVOKED`; clear protected state |
| valid Session แต่ไม่มี action/scope | 403 หรือ 404 สำหรับ record นอกขอบเขตตาม [API](api-flows.md) |

External error message สั้นและไม่เผย provider response/key/account existence; server logs เก็บ requestId, category, latency และผล deny แบบไม่เก็บ credentials/Session/CSRF/body TU

## Validation ที่ต้องทำใน implementation

Fixtures: HTTP200+false/string-true/missing fields, wrong creds, missing key, timeout, quota, double submit, ambiguous aliases, concurrent first login และ no-role; ไม่สร้าง privileged Session จาก fake frontend result

Runtime: ตรวจ cookie flags/Origin/CSRF, token rotation, idle/absolute expiry, logout, grant withdrawal ระหว่าง Session และ cross-user file request ด้วยข้อมูลทดสอบที่อนุญาต ตรวจ repository/bundle/log/storage ว่าไม่มี key/password/token ผลเหล่านี้เป็น acceptance cases **ยังไม่ได้รันทดสอบ TU หรือ Session จริง**
