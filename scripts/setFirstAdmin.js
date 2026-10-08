const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, UpdateCommand } = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({ region: "us-east-1" });
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME || "UsersTable";

/**
 * Script สำหรับมอบหมายสิทธิ์ "ผู้บริหาร (executive)" ให้ผู้ใช้คนแรกสุด
 * เนื่องจากระบบป้องกันไม่ให้มอบหมายสิทธิ์ตัวเองจากหน้าเว็บ
 * ผู้ดูแลระบบ (Developer/DevOps) ต้องรัน Script นี้ตรงๆ บน Server เพื่อตั้งไข่คนแรก
 */
async function setFirstAdmin(targetUserId) {
    if (!targetUserId) {
        console.error("กรุณาระบุ UUID ของผู้ใช้ที่ต้องการตั้งเป็นคนแรก");
        console.error("วิธีใช้: node scripts/setFirstAdmin.js <user-uuid>");
        process.exit(1);
    }

    try {
        console.log(`กำลังมอบหมายบทบาท 'executive' ให้บัญชี: ${targetUserId}...`);
        const updateRes = await docClient.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { PK: `USER#${targetUserId}`, SK: "PROFILE" },
            UpdateExpression: "SET roles = :newRoles, roleUpdatedAt = :updatedAt",
            ExpressionAttributeValues: {
                ":newRoles": ["executive"],
                ":updatedAt": new Date().toISOString()
            },
            ReturnValues: "ALL_NEW"
        }));
        
        console.log("ตั้งค่าสำเร็จ! ข้อมูลปัจจุบัน:", updateRes.Attributes);
    } catch (err) {
        console.error("เกิดข้อผิดพลาดในการตั้งค่าคนแรก:", err);
    }
}

// รับค่า Argument จาก Command Line
const targetId = process.argv[2];
setFirstAdmin(targetId);

