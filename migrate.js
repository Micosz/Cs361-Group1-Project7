const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand } = require("@aws-sdk/lib-dynamodb");
const fs = require("fs");

// 1. ตั้งค่าการเชื่อมต่อ AWS 
const client = new DynamoDBClient({ region: "us-east-1" }); 
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = "Partner";

async function runMigration() {
    try {
        console.log("กำลังอ่านไฟล์ partners.json...");
        const rawData = fs.readFileSync('data/partners.json');
        const partners = JSON.parse(rawData);

        console.log(`พบข้อมูล Partner จำนวน ${partners.length} รายการ เริ่มทำการย้ายข้อมูล...`);

        for (const partner of partners) {
      
            const partnerItem = { ...partner };
            delete partnerItem.collaborations; 
            console.log(`[Partner] กำลังบันทึก: ${partnerItem.name}`);
            await docClient.send(new PutCommand({
                TableName: TABLE_NAME,
                Item: partnerItem
            }));

            if (partner.collaborations && partner.collaborations.length > 0) {
                for (const collab of partner.collaborations) {
                    const collabItem = {
                        ...collab,
                        partnerId: partner.id,      
                        partnerName: partner.name    
                    };

                    console.log(`  -> [Event] กำลังบันทึก: ${collabItem.title}`);
                    await docClient.send(new PutCommand({
                        TableName: TABLE_NAME,
                        Item: collabItem
                    }));
                }
            }
        }
        console.log("ย้ายข้อมูลเสร็จสมบูรณ์");
    } catch (error) {
        console.error("เกิดข้อผิดพลาด:", error);
    }
}

runMigration();