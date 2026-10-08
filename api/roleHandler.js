const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({ region: "us-east-1" });
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME || "UsersTable";

// บทบาทที่อนุญาตตามตารางสิทธิ์ (Permission Matrix จาก Issue #66)
// กติกา: ห้ามสร้างบทบาท 'admin' ที่อยู่นอกเหนือจากแบบที่ตกลงไว้
const ALLOWED_ROLES = ["student", "coordinator", "staff", "executive"];

/**
 * ตรวจสอบว่าผู้ทำรายการมีสิทธิ์มอบหมายหรือถอนสิทธิ์คนอื่นหรือไม่
 */
function hasPermissionToAssign(roles = []) {
    // สมมติให้ "เจ้าหน้าที่หลักสูตร (staff)" และ "ผู้บริหาร (executive)" มีสิทธิ์
    // สามารถปรับแก้ได้ตาม Matrix สรุปสุดท้ายใน Issue #66
    return roles.includes("staff") || roles.includes("executive");
}

/**
 * ฟังก์ชันมอบหมายหรือเปลี่ยนบทบาทผู้ใช้
 * 
 * @param {string} assignerId - UUID ของผู้มอบหมาย (ดึงจาก Token/Session ปัจจุบัน)
 * @param {string} targetUserId - UUID ของผู้ถูกมอบหมาย
 * @param {Array<string>} newRoles - รายการบทบาทใหม่ที่จะบันทึกทับ
 */
async function assignRoles(assignerId, targetUserId, newRoles) {
    if (!assignerId || !targetUserId) throw new Error("Missing user IDs");
    
    // กติกา: ผู้ใช้ต้องเพิ่มสิทธิ์ให้ตนเองไม่ได้ (Anti Self-granting)
    if (assignerId === targetUserId) {
        throw new Error("Forbidden: Cannot assign roles to yourself. ไม่สามารถแก้สิทธิ์ตัวเองได้");
    }

    // กติกา: ปฏิเสธการส่ง role สร้างบทบาทนอกแบบ (No custom 'admin' roles)
    const invalidRoles = newRoles.filter(r => !ALLOWED_ROLES.includes(r));
    if (invalidRoles.length > 0) {
        throw new Error(`Forbidden: Invalid roles provided: ${invalidRoles.join(", ")}`);
    }

    // 1. ตรวจสอบสิทธิ์ผู้มอบหมาย (Assigner) จาก DB โดยตรง (ไม่เชื่อ Browser)
    const assignerRes = await docClient.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: `USER#${assignerId}`, SK: "PROFILE" }
    }));
    
    if (!assignerRes.Item || !hasPermissionToAssign(assignerRes.Item.roles)) {
        throw new Error("Forbidden: You do not have permission to assign roles. คุณไม่มีสิทธิ์มอบหมายบทบาท");
    }

    // 2. ตรวจสอบบัญชีเป้าหมาย (Target) ว่าเป็นบัญชีภายในจริง (ไม่ใช่ Contact ภายนอก)
    const targetRes = await docClient.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: `USER#${targetUserId}`, SK: "PROFILE" }
    }));

    if (!targetRes.Item) {
        throw new Error("Not Found: Target user not found. ไม่พบบัญชีเป้าหมายในระบบผู้ใช้ภายใน");
    }

    // 3. บันทึกการเปลี่ยนแปลง (พร้อมติด Timestamp สำหรับ Issue #78 Session Management)
    const timestamp = new Date().toISOString();
    const updateRes = await docClient.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: `USER#${targetUserId}`, SK: "PROFILE" },
        // อัปเดต roleUpdatedAt เพื่อให้ระบบ Session รู้ว่าต้องรีเฟรชสิทธิ์
        UpdateExpression: "SET roles = :newRoles, roleUpdatedAt = :updatedAt, isRevoked = :isRevoked",
        ExpressionAttributeValues: {
            ":newRoles": newRoles,
            ":updatedAt": timestamp,
            ":isRevoked": false // ถือว่าคืนสถานะให้กรณีเคยโดนแบน (หากต้องการให้แบนแยกกัน สามารถเอาบรรทัดนี้ออกได้)
        },
        ReturnValues: "ALL_NEW"
    }));

    // อ่านค่ากลับหลังบันทึกตาม Requirement
    return updateRes.Attributes;
}

/**
 * ฟังก์ชันถอนสิทธิ์ / แบนผู้ใช้
 */
async function revokeUserAccess(assignerId, targetUserId) {
    if (assignerId === targetUserId) {
        throw new Error("Forbidden: Cannot revoke your own access.");
    }

    // 1. ตรวจสอบสิทธิ์คนสั่ง (Assigner)
    const assignerRes = await docClient.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: `USER#${assignerId}`, SK: "PROFILE" }
    }));
    
    if (!assignerRes.Item || !hasPermissionToAssign(assignerRes.Item.roles)) {
        throw new Error("Forbidden: You do not have permission to revoke access.");
    }

    // 2. ล้าง Roles ทั้งหมดและติดสถานะ isRevoked
    const timestamp = new Date().toISOString();
    const updateRes = await docClient.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: `USER#${targetUserId}`, SK: "PROFILE" },
        UpdateExpression: "SET roles = :emptyRoles, isRevoked = :revoked, roleUpdatedAt = :updatedAt",
        ExpressionAttributeValues: {
            ":emptyRoles": [],
            ":revoked": true,
            ":updatedAt": timestamp
        },
        ReturnValues: "ALL_NEW"
    }));

    return updateRes.Attributes;
}

module.exports = { assignRoles, revokeUserAccess };