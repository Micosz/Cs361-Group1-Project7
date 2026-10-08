const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, ScanCommand } = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

exports.handler = async (event) => {
    // ต้องใส่ CORS เสมอ เพื่อให้หน้าเว็บ (Browser) ยิงข้ามโดเมนมาขอข้อมูลได้
    const headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET"
    };

    try {
        const command = new ScanCommand({
            TableName: "Partner",
        });

        const response = await docClient.send(command);

        // คัดกรองข้อมูลก่อนส่งให้ Browser
        // (กรองเฉพาะฟิลด์ที่ปลอดภัย เผื่อในฐานข้อมูลมีข้อมูลภายใน)
        const publicData = response.Items.map(item => ({
          id: item.id,
          name: item.name,
          type: item.type,
          summary: item.summary,
          location: item.location,
          website_url: item.website_url,
          logo_path: item.logo_path,
          coordinators: item.coordinators,
          access_level: item.access_level,
          collaborations: item.collaborations,
          full_description: item.full_description // (ถ้ามีในบาง Partner เช่น สหกิจศึกษา)
      }));

        return {
            statusCode: 200,
            headers: headers,
            body: JSON.stringify(publicData)
        };
    } catch (error) {
        console.error("DynamoDB Error:", error);
        return {
            statusCode: 500,
            headers: headers,
            body: JSON.stringify({ message: "Internal Server Error" })
        };
    }
};