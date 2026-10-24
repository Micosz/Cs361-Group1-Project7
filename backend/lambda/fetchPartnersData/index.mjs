import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const partnerTable = process.env.PARTNER_TABLE;

export const handler = async (event) => {
    try {
        const command = new ScanCommand({
            TableName: partnerTable
        });
        let response = await docClient.send(command);
        const items = [...(response.Items || [])];
        while (response.LastEvaluatedKey) {
            response = await docClient.send(new ScanCommand({TableName:partnerTable,ExclusiveStartKey:response.LastEvaluatedKey}));
            items.push(...(response.Items || []));
        }

        // Public relationships must be resolved from current records, not cached labels.
        const published = row => row && row.source_state !== 'retired'
            && ['publication', 'access_level', 'visibility'].some(key => key in row)
            && ['publication', 'access_level', 'visibility'].every(key => !(key in row) || row[key] === 'public');
        const identifier = value => typeof value === 'string' && value.length > 0 && value === value.trim();
        const activity = row => row.entityType === 'activity' || (!row.entityType && 'partnerId' in row);
        const partners = new Map();
        for (const row of items) {
            if (row.source_state !== 'retired' && !activity(row)
                && (!row.entityType || row.entityType === 'partner') && identifier(row.id)) {
                // Ambiguous IDs fail closed, including a private/public duplicate.
                partners.set(row.id, partners.has(row.id) ? null : row);
            }
        }
        const label = (key, owner) => {
            const row = partners.get(key);
            return identifier(key) && published(row) && row.scopeId === owner.scopeId
                && (row.schemaVersion !== 3 || identifier(row.scopeId))
                && typeof row.name === 'string' ? { id: key, name: row.name } : null;
        };
        const scalars = new Set(['id','name','title','type','summary','location','website_url','logo_path',
            'full_description','image_path','period','period_date','period_end_date','date_precision',
            'access_level','visibility','relationship_basis','source_checked_on','evidence_note']);
        const lists = new Set(['coordinators','activity_tags','organization_roles','source_urls']);
        const publicData = [];
        for (const row of items) {
            if (!published(row) || (row.entityType && !['partner', 'activity'].includes(row.entityType))) continue;
            const projected = Object.fromEntries(Object.entries(row).filter(([key, value]) =>
                scalars.has(key) && (value === null || ['string', 'number', 'boolean'].includes(typeof value))
                || lists.has(key) && Array.isArray(value) && value.every(item => typeof item === 'string')));
            if (activity(row)) {
                if (row.schemaVersion === 3 && !identifier(row.scopeId)) continue;
                const primary = label(row.partnerId, row);
                const cohosts = 'coHostPartnerIds' in row ? row.coHostPartnerIds : [];
                if (!primary || !Array.isArray(cohosts) || !cohosts.every(identifier)
                    || new Set(cohosts).size !== cohosts.length) continue;
                projected.partnerId = primary.id;
                projected.partnerName = primary.name;
                projected.co_hosts = cohosts.filter(key => key !== primary.id)
                    .map(key => label(key, row)).filter(Boolean).map(partner => partner.name);
            }
            publicData.push(projected);
        }

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
