const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, TransactWriteCommand, GetCommand } = require("@aws-sdk/lib-dynamodb");
const crypto = require("crypto"); // สำหรับสร้าง UUID ภายใน

const client = new DynamoDBClient({ region: "us-east-1" });
const docClient = DynamoDBDocumentClient.from(client);

// ใช้ชื่อ Table ตามที่จะกำหนดร่วมกันใน Issue #91
const TABLE_NAME = process.env.TABLE_NAME || "CSTUHub-Users"; 

/**
 * ฟังก์ชันจัดการข้อมูลผู้ใช้หลัง TU API ยืนยันตัวตนสำเร็จ (Issue #76)
 * ต้องเรียกใช้ที่ฝั่ง Backend เท่านั้น ห้ามเรียกจาก Browser
 * 
 * @param {Object} tuPayload - ข้อมูลที่ยืนยันแล้วจากฝั่ง Backend ที่ไปคุยกับ TU
 * @param {boolean} tuPayload.status - สถานะการยืนยัน ต้องเป็น true เท่านั้น
 * @param {string} tuPayload.tu_identifier - รหัสประจำตัว (Immutable ID) เช่น username จาก TU
 * @param {string} [tuPayload.type] - ประเภทบุคคล "student" หรือ "employee" (เดี๋ยวเพื่อนจะดึงมาใส่ทีหลัง)
 */
async function handleTULogin(tuPayload) {
    // 1. Validation (กติกา: ใช้เฉพาะผลที่ Backend เรียก TU เองและตรวจ status === true)
    if (!tuPayload || tuPayload.status !== true) {
        throw new Error("Unauthorized: Invalid TU login status. ไม่ได้รับอนุญาต");
    }

    const { tu_identifier, type } = tuPayload;
    if (!tu_identifier) {
        throw new Error("Missing TU identifier: ไม่พบตัวระบุบัญชี");
    }

    // สร้าง Key สำหรับ Mapping ป้องกันบัญชีซ้ำ
    const tuMappingKey = `TU#${tu_identifier}`;
    
    try {
        // 2. พยายามสร้างบัญชีใหม่ (Create) แบบป้องกัน Concurrency (Race Condition)
        const userId = crypto.randomUUID(); // ใช้ UUID เป็น Internal ID
        const userKey = `USER#${userId}`;

        // กติกา: student ได้บทบาทนักศึกษาอัตโนมัติ / employee หรือกรณียังไม่มี type ส่งมา ให้ว่างไว้ก่อน
        let initialRoles = [];
        if (type === "student") {
            initialRoles = ["student"];
        } else if (!type) {
            console.warn(`[Auth] Warning: No type provided for TU ID: ${tu_identifier}. Defaulting to no roles until API is updated.`);
        }

        // ใช้ TransactWrite เพื่อรับประกันว่า Mapping และ Profile ต้องถูกสร้างพร้อมกันเสมอ
        await docClient.send(new TransactWriteCommand({
            TransactItems: [
                {
                    Put: {
                        TableName: TABLE_NAME,
                        Item: {
                            PK: tuMappingKey,
                            SK: "MAPPING",
                            userId: userId, // ชี้ไปยัง Internal UUID
                            createdAt: new Date().toISOString()
                        },
                        // กฎสำคัญ: ห้ามสร้างถ้ามี TU ID นี้อยู่แล้ว (ป้องกันยิง Request Login รัวๆ พร้อมกัน)
                        ConditionExpression: "attribute_not_exists(PK)"
                    }
                },
                {
                    Put: {
                        TableName: TABLE_NAME,
                        Item: {
                            PK: userKey,
                            SK: "PROFILE",
                            id: userId,
                            tuId: tu_identifier,
                            tuType: type, // เก็บ type ไว้เผื่ออ้างอิง แต่สิทธิ์จริงๆ ดึงจาก roles
                            roles: initialRoles, 
                            isRevoked: false, // สถานะบัญชี
                            createdAt: new Date().toISOString()
                        }
                    }
                }
            ]
        }));

        // ถ้าโค้ดผ่านมาถึงตรงนี้ แสดงว่าเป็น "บัญชีใหม่" (ทำงานสำเร็จ ไม่มีคนแย่งสร้าง)
        console.log(`[Auth] Created new user: ${userId} for TU ID: ${tu_identifier}`);
        return {
            isNewUser: true,
            user: {
                id: userId,
                tuId: tu_identifier,
                tuType: type,
                roles: initialRoles,
                isRevoked: false
            }
        };

    } catch (error) {
        // 3. การจัดการ "บัญชีเดิม" (Update / Return)
        if (error.name === "TransactionCanceledException" || error.message.includes("ConditionalCheckFailed")) {
            
            // เช็คว่า Item แรก (Mapping) พังเพราะ ConditionalCheckFailed จริงๆ
            const reasons = error.CancellationReasons || [];
            if (reasons.length > 0 && reasons[0]?.Code !== "ConditionalCheckFailed") {
                throw error; // พังเพราะสาเหตุอื่นของ Transaction
            }

            console.log(`[Auth] Found existing mapping for TU ID: ${tu_identifier}. Fetching existing user...`);
            
            // ดึงข้อมูล Mapping เดิม
            const mappingRes = await docClient.send(new GetCommand({
                TableName: TABLE_NAME,
                Key: { PK: tuMappingKey, SK: "MAPPING" }
            }));

            if (!mappingRes.Item || !mappingRes.Item.userId) {
                throw new Error("Data Corruption: Identity mapping is invalid.");
            }

            const existingUserId = mappingRes.Item.userId;

            // ดึง Profile ของ User เดิมออกมา
            const userRes = await docClient.send(new GetCommand({
                TableName: TABLE_NAME,
                Key: { PK: `USER#${existingUserId}`, SK: "PROFILE" }
            }));

            const existingUser = userRes.Item;
            if (!existingUser) {
                throw new Error("Data Corruption: User profile not found.");
            }

            // กติกา: บัญชีปิดหรือถูกถอนสิทธิ์ต้องไม่ถูกเปิดหรือคืนสิทธิ์จากการ Login ซ้ำ
            if (existingUser.isRevoked) {
                throw new Error("Access Denied: Account is revoked. บัญชีถูกระงับสิทธิ์");
            }

            // คืนค่าบัญชีเดิม โดย **ไม่แก้ไข Role ใดๆ** 
            // (เพราะ Employee อาจจะถูกกำหนดสิทธิ์ผู้บริหารใน Issue #77 ไปแล้ว ห้ามเขียนทับ)
            return {
                isNewUser: false,
                user: existingUser
            };
        }

        // กรณีเป็น Error อื่นๆ เช่น ต่อ AWS ไม่ติด
        console.error("[Auth] Unexpected Error:", error);
        throw error;
    }
}

module.exports = { handleTULogin };

