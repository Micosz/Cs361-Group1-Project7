import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

export const handler = async (event) => {
    try {
        const command = new ScanCommand({
            TableName: "Partner"
        });
        const response = await docClient.send(command);

        // คัดกรองเฉพาะข้อมูลที่เผยแพร่ได้ตาม Requirement
        const publicData = response.Items.filter(item =>
            item.access_level === 'public' || item.visibility === 'public'
        );

        return {
            statusCode: 200,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "Content-Type",
                "Access-Control-Allow-Methods": "OPTIONS,GET"
            },
            body: JSON.stringify(publicData)
        };
    } catch (error) {
        console.error("Error fetching data:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Internal Server Error" })
        };
    }
};