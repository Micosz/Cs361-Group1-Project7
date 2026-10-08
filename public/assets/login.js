'use strict';

const LOGIN_API_URL = 'https://eb49u61kph.execute-api.us-east-1.amazonaws.com/default/login';

const form = document.getElementById('login-form');
const status = document.getElementById('login-status');
const submit = document.getElementById('login-submit');

// ค้นหาช่อง input username และ password ภายในฟอร์ม
const usernameInput = document.getElementById('student-id');
const passwordInput = document.getElementById('student-password');
function mount() {
  const controller = new AbortController();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!form.reportValidity()) return;

    const username = usernameInput ? usernameInput.value.trim() : '';
    const password = passwordInput ? passwordInput.value : '';

    if (!username || !password) {
      status.textContent = 'กรุณากรอกรหัสนักศึกษาและรหัสผ่านให้ครบถ้วน';
      status.hidden = false;
      return;
    }

    try {
      // 1. ตั้งค่า Loading State และปิดการกดปุ่มซ้ำ
      submit.disabled = true;
      submit.dataset.originalText = submit.innerHTML;
      submit.innerHTML = 'กำลังเข้าสู่ระบบ...';
      status.hidden = true;

      // 2. ส่งคำขอไปยัง Backend
      const response = await fetch(LOGIN_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          UserName: username,
          PassWord: password
        }),
        signal: controller.signal
      });

      const data = await response.json();

      // 3. ตรวจสอบเงื่อนไขตามข้อตกลง Issue #74
      if (response.ok && data.success === true) {
        // บันทึกเฉพาะข้อมูล Profile ผู้ใช้ (ห้ามบันทึกรหัสผ่าน)
        sessionStorage.setItem('cstu_user', JSON.stringify(data.user));

        // กลับสู่หน้าหลัก
        window.location.href = 'index.html';
      } else {
        // แจ้งเตือนข้อผิดพลาด เช่น รหัสผ่านไม่ถูกต้อง
        status.textContent = data.message || 'รหัสนักศึกษาหรือรหัสผ่านไม่ถูกต้อง';
        status.hidden = false;
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('Login error:', err);
      status.textContent = 'เกิดข้อผิดพลาดในการเชื่อมต่อ กรุณาลองใหม่อีกครั้ง';
      status.hidden = false;
    } finally {
      // คืนสถานะปุ่มกด
      submit.disabled = false;
      submit.innerHTML = submit.dataset.originalText || 'เข้าสู่ระบบ &rarr;';
    }
  }, { signal: controller.signal });

  submit.disabled = false;
  document.body.classList.add('login-enter');

  return () => {
    controller.abort();
    submit.disabled = true;
    document.body.classList.remove('login-enter');
  };
}

let dispose;
const start = () => { dispose?.(); dispose = mount(); };
start();

window.addEventListener('pagehide', () => { dispose?.(); dispose = undefined; });
window.addEventListener('pageshow', (event) => { if (event.persisted) start(); });