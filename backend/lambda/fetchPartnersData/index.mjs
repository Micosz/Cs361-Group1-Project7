import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

export const handler = async (event) => {
    try {
        const command = new ScanCommand({
            TableName: "Partner"
        });
        let response = await docClient.send(command);
        const items = [...(response.Items || [])];
        while (response.LastEvaluatedKey) {
            response = await docClient.send(new ScanCommand({TableName:"Partner",ExclusiveStartKey:response.LastEvaluatedKey}));
            items.push(...(response.Items || []));
        }

        // คัดกรองเฉพาะข้อมูลที่เผยแพร่ได้ตาม Requirement
        const fields = new Set(['id','name','title','type','summary','location','website_url','logo_path',
            'full_description','partnerId','partnerName','co_hosts','coordinators','image_path','period','period_date',
            'period_end_date','date_precision','activity_tags','access_level','visibility','organization_roles',
            'relationship_basis','source_checked_on','source_urls','evidence_note']);
        const publicData = items.filter(item => {
            const flags = ['publication','access_level','visibility'].filter(key => key in item).map(key => item[key]);
            return flags.length > 0 && flags.every(value => value === 'public');
        }).map(item => Object.fromEntries(Object.entries(item).filter(([key]) => fields.has(key))));

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