export const handler = async (event) => {
  // CORS Headers สำหรับตอบกลับ Frontend
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "OPTIONS,POST",
    "Content-Type": "application/json"
  };

  // จัดการ Preflight Request (CORS OPTIONS)
  if (event.requestContext?.http?.method === "OPTIONS" || event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: JSON.stringify({ message: "OK" }) };
  }

  try {
    if (!event.body) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, message: "Missing request body" })
      };
    }

    const { UserName, PassWord } = JSON.parse(event.body);

    // ตรวจสอบ Input พื้นฐาน
    if (!UserName || !PassWord) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, message: "Username and Password are required" })
      };
    }

    const TU_APP_KEY = process.env.TU_APP_KEY;
    if (!TU_APP_KEY) {
      console.error("TU_APP_KEY is not configured in Environment variables");
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ success: false, message: "Server authentication config error" })
      };
    }

    // ยิงคำขอไปที่ TU REST API โดยตรงจากฝั่ง Backend
    const tuResponse = await fetch("https://restapi.tu.ac.th/api/v1/auth/Ad/verify2", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Application-Key": TU_APP_KEY
      },
      body: JSON.stringify({ UserName, PassWord })
    });

    if (!tuResponse.ok) {
      // กรณี TU API มีปัญหา เช่น 500, 503 หรือ Timeout/Unavailable
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ success: false, message: "TU Authentication service unavailable" })
      };
    }

    const tuData = await tuResponse.json();

    // กฎสำคัญของ Issue #74: เช็ค status ภายใน body เท่านั้น ไม่ยึดแค่ HTTP 200
    if (tuData.status === true) {
      // Login สำเร็จ: คืนข้อมูลผู้ใช้ที่จำเป็น (ห้ามคืนรหัสผ่าน และไม่คืน Application-Key)
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: "Login successful",
          user: {
            username: UserName,
            type: tuData.type || "student",
            displayname_th: tuData.displayname_th || "",
            displayname_en: tuData.displayname_en || "",
            email: tuData.email || ""
          }
        })
      };
    } else {
      // Login ไม่ผ่าน (Wrong credentials / Invalid user)
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({
          success: false,
          message: tuData.message || "Invalid TU credentials"
        })
      };
    }
  } catch (error) {
    // ป้องกันการ log Password ลงระบบเด็ดขาด (Security rule)
    console.error("Login processing error:", error.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, message: "Internal server error" })
    };
  }
};