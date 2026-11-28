"""Published catalog uses the public allowlist, independently of login roles."""
import json
import unittest
from types import SimpleNamespace
from backend.application import AuthApplication
from backend.business.dynamo_repository import DynamoBusinessRepository
from backend.permissions.transactions import values


class PublicCatalogTests(unittest.TestCase):
    def test_public_catalog_hides_private_rows_and_editor_fields(self):
        rows = [
            dict(id='visible', entityType='partner', name='Public', publication='public',
                 responsibleUserIds=['secret-user'], scopeId='private-scope', version=3,
                 businessRecord=True, legacySource=False, objectKey='secret-object-key',
                 authToken='secret-token'),
            dict(id='demo', entityType='partner', name='QA Staff demo', publication='public',
                 legacySource=True, businessRecord=False),
            dict(id='hidden', entityType='partner', name='Private', publication='internal'),
            dict(id='conflict', entityType='partner', name='Conflict', publication='public', visibility='private'),
            dict(id='news', entityType='activity', title='Public event', publication='public',
                 partnerId='visible', scopeId='private-scope', responsibleUserIds=['secret-user']),
            dict(id='hidden-host', entityType='activity', title='Hidden host', publication='public', partnerId='hidden'),
            dict(id='contact', entityType='contact', name='Private contact', publication='public'),
        ]
        calls = []
        def scan(**query):
            calls.append(query)
            if 'ExclusiveStartKey' not in query:
                return {'Items':[values(row) for row in rows[:3]], 'LastEvaluatedKey':values({'id':'cursor'})}
            return {'Items':[values(row) for row in rows[3:]]}
        repository = DynamoBusinessRepository(SimpleNamespace(scan=scan), 'business', None, 'users', 'sessions')
        result = repository.public_catalog()
        self.assertEqual({'visible','demo','news'}, {row['id'] for row in result})
        self.assertTrue(all(row['visibility']=='public' for row in result))
        response_fields = set().union(*(row.keys() for row in result))
        self.assertFalse({'responsibleUserIds','scopeId','version','businessRecord',
                          'legacySource','objectKey','authToken'} & response_fields)
        self.assertEqual(2,len(calls))
        self.assertTrue(all(call['ConsistentRead'] for call in calls))

    def test_public_route_needs_no_session_and_rejects_writes(self):
        app = AuthApplication(None,None,None,None,None,SimpleNamespace(public_catalog=lambda:[{'id':'public'}]))
        event = dict(version='2.0',rawPath='/api/public/records',requestContext={'http':{'method':'GET'}})
        result=app.handle(event)
        self.assertEqual(200,result['statusCode'])
        self.assertEqual([{'id':'public'}],json.loads(result['body']))
        event['requestContext']['http']['method']='POST'
        self.assertEqual(405,app.handle(event)['statusCode'])
        event['requestContext']['http']['method']='GET'
        event['queryStringParameters']={'scopeId':'private'}
        self.assertEqual(422,app.handle(event)['statusCode'])


    def test_original_composite_key_resolves_active_source_without_deleting_retired_copy(self):
        from backend.auth.session_service import AuthError
        rows=[dict(id='same',type='academic_activity',entityType='activity',source_state='retired'),
              dict(id='same',type='event',entityType='activity',source_state='active')]
        calls=[]
        def query(**kwargs):
            calls.append(kwargs)
            return {'Items':[values(row) for row in rows]}
        repository=DynamoBusinessRepository(SimpleNamespace(query=query),'business',None,'users','sessions',partner_table='CSTUHub-Partner')
        self.assertEqual('event',repository.get('activity','same')['type'])
        self.assertEqual('CSTUHub-Partner',calls[0]['TableName'])
        self.assertTrue(calls[0]['ConsistentRead'])
        rows[0]['source_state']='active'
        with self.assertRaises(AuthError):repository.get('activity','same')

    def test_card_view_unifies_welcome_fields_omits_detail_fields_and_tracks_rcu(self):
        rows = [
            dict(id='p1', type='company', entityType='partner', name='Partner Alpha',
                 summary='Short summary', fullDescription='Very long HTML detail text',
                 location='Bangkok', websiteUrl='https://alpha.example', logoPath='resources/a.jpg',
                 publication='public', scopeId='cs-demo', version=1),
            dict(id='p2', type='university', entityType='partner', name='Partner Beta',
                 summary='Co-host summary', fullDescription='Beta detail',
                 location='Tokyo', websiteUrl='https://beta.example', logoPath='resources/b.jpg',
                 publication='public', scopeId='cs-demo', version=1),
            dict(id='a1', type='event', entityType='activity', title='Joint Workshop',
                 summary='Workshop summary', fullDescription='Long workshop article',
                 partnerId='p1', coHostPartnerIds=['p2'], period='พ.ย. 2569',
                 periodDate='2026-11-01', periodEndDate='2026-11-03', date_precision='day',
                 imagePath='resources/w.jpg', activity_tags=['mou'],
                 publication='public', scopeId='cs-demo', version=1),
            dict(id='dup', type='company', entityType='partner', name='Dup Public',
                 publication='public', scopeId='cs-demo', version=1),
            dict(id='dup', type='university', entityType='partner', name='Dup Internal',
                 publication='internal', scopeId='cs-demo', version=1),
        ]
        scan_calls = []

        def scan(**query):
            scan_calls.append(query)
            return {
                'Items': [values(row) for row in rows],
                'ConsumedCapacity': {'TableName': query['TableName'], 'CapacityUnits': 12.0},
            }

        repository = DynamoBusinessRepository(
            SimpleNamespace(scan=scan), 'business', None, 'users', 'sessions', partner_table='CSTUHub-Partner'
        )
        app = AuthApplication(None, None, None, None, None, repository)

        # Card view omits heavy detail-only fields but keeps everything Welcome cards & filters need
        card_event = dict(version='2.0', rawPath='/api/public/records',
                          queryStringParameters={'view': 'cards'},
                          requestContext={'http': {'method': 'GET'}})
        card_res = app.handle(card_event)
        self.assertEqual(200, card_res['statusCode'])
        cards = json.loads(card_res['body'])
        by_id = {row['id']: row for row in cards}
        self.assertEqual({'p1', 'p2', 'a1'}, set(by_id))
        self.assertNotIn('dup', by_id)  # ambiguous public/internal duplicate fails closed
        self.assertNotIn('full_description', by_id['p1'])
        self.assertNotIn('website_url', by_id['p1'])
        self.assertNotIn('full_description', by_id['a1'])
        self.assertEqual('Partner Alpha', by_id['a1']['partnerName'])
        self.assertEqual(['Partner Beta'], by_id['a1']['co_hosts'])
        self.assertEqual(['p2'], by_id['a1']['coHostPartnerIds'])
        self.assertEqual('2026-11-01', by_id['a1']['period_date'])
        self.assertEqual('2026-11-03', by_id['a1']['period_end_date'])
        self.assertEqual('day', by_id['a1']['date_precision'])
        self.assertEqual(['mou'], by_id['a1']['activity_tags'])
        self.assertEqual('TOTAL', scan_calls[0]['ReturnConsumedCapacity'])
        self.assertEqual(1, repository.last_public_read_metrics['dynamoCalls'])
        self.assertEqual(12.0, repository.last_public_read_metrics['consumedRcu'])

        # Full view keeps backwards-compatible detail fields and invalid view is rejected
        full_event = dict(version='2.0', rawPath='/api/public/records',
                          requestContext={'http': {'method': 'GET'}})
        full_rows = {row['id']: row for row in json.loads(app.handle(full_event)['body'])}
        self.assertEqual('Very long HTML detail text', full_rows['p1']['full_description'])
        self.assertEqual('https://alpha.example', full_rows['p1']['website_url'])
        self.assertEqual('Long workshop article', full_rows['a1']['full_description'])
        bad_view = dict(version='2.0', rawPath='/api/public/records',
                        queryStringParameters={'view': 'internal'},
                        requestContext={'http': {'method': 'GET'}})
        self.assertEqual(422, app.handle(bad_view)['statusCode'])

    def test_public_detail_uses_targeted_query_and_hides_unpublished_records(self):
        table = [
            dict(id='p1', type='company', entityType='partner', name='Partner Alpha',
                 summary='Short', fullDescription='Alpha full detail', location='Bangkok',
                 websiteUrl='https://alpha.example', publication='public', scopeId='cs-demo',
                 responsibleUserIds=['u-secret'], version=1),
            dict(id='p2', type='university', entityType='partner', name='Partner Beta',
                 summary='Beta', publication='public', scopeId='cs-demo', version=1),
            dict(id='a1', type='event', entityType='activity', title='Joint Workshop',
                 summary='Short act', fullDescription='Full act detail',
                 partnerId='p1', coHostPartnerIds=['p2'], periodDate='2026-11-01',
                 periodEndDate='2026-11-02', date_precision='day',
                 publication='public', scopeId='cs-demo', agreementIds=['secret-mou'], version=1),
        ]
        scan_count = 0
        query_calls = []

        def scan(**query):
            nonlocal scan_count
            scan_count += 1
            return {
                'Items': [values(row) for row in table],
                'ConsumedCapacity': {'TableName': query['TableName'], 'CapacityUnits': 8.0},
            }

        def query(**kwargs):
            query_calls.append(kwargs)
            key = kwargs['ExpressionAttributeValues'][':id']['S']
            matched = [values(row) for row in table if row['id'] == key]
            return {
                'Items': matched,
                'ConsumedCapacity': {'TableName': kwargs['TableName'], 'CapacityUnits': 1.0},
            }

        repository = DynamoBusinessRepository(
            SimpleNamespace(scan=scan, query=query), 'business', None, 'users', 'sessions',
            partner_table='CSTUHub-Partner'
        )
        app = AuthApplication(None, None, None, None, None, repository)

        # Detail read uses targeted Query (zero Scan calls!)
        p_res = app.handle(dict(version='2.0', rawPath='/api/public/partners/p1',
                                requestContext={'http': {'method': 'GET'}}))
        self.assertEqual(200, p_res['statusCode'])
        p_data = json.loads(p_res['body'])['data']
        self.assertEqual('Alpha full detail', p_data['full_description'])
        self.assertEqual('https://alpha.example', p_data['website_url'])
        self.assertNotIn('responsibleUserIds', p_data)
        self.assertEqual(0, scan_count)
        self.assertEqual(1, repository.last_public_read_metrics['dynamoCalls'])
        self.assertEqual(1.0, repository.last_public_read_metrics['consumedRcu'])

        a_res = app.handle(dict(version='2.0', rawPath='/api/public/activities/a1',
                                requestContext={'http': {'method': 'GET'}}))
        self.assertEqual(200, a_res['statusCode'])
        a_data = json.loads(a_res['body'])['data']
        self.assertEqual('Full act detail', a_data['full_description'])
        self.assertEqual('Partner Alpha', a_data['partnerName'])
        self.assertEqual(['Partner Beta'], a_data['co_hosts'])
        self.assertEqual(['p2'], a_data['coHostPartnerIds'])
        self.assertNotIn('agreementIds', a_data)
        self.assertEqual(0, scan_count)
        self.assertEqual(3, repository.last_public_read_metrics['dynamoCalls'])
        self.assertEqual(3.0, repository.last_public_read_metrics['consumedRcu'])

        # Unpublish co-host partner p2 -> disappears from list, detail 404, co_hosts updated immediately
        table[1]['publication'] = 'internal'
        list_after_cohost = json.loads(app.handle(dict(
            version='2.0', rawPath='/api/public/records',
            queryStringParameters={'view': 'cards'},
            requestContext={'http': {'method': 'GET'}}
        ))['body'])
        self.assertEqual({'p1', 'a1'}, {r['id'] for r in list_after_cohost})
        act_card = next(r for r in list_after_cohost if r['id'] == 'a1')
        self.assertEqual([], act_card['co_hosts'])
        self.assertNotIn('coHostPartnerIds', act_card)
        self.assertEqual(404, app.handle(dict(
            version='2.0', rawPath='/api/public/partners/p2',
            requestContext={'http': {'method': 'GET'}}
        ))['statusCode'])

        # Unpublish activity a1 -> disappears from list AND detail returns 404
        table[2]['publication'] = 'internal'
        list_after_act = json.loads(app.handle(dict(
            version='2.0', rawPath='/api/public/records',
            queryStringParameters={'view': 'cards'},
            requestContext={'http': {'method': 'GET'}}
        ))['body'])
        self.assertEqual({'p1'}, {r['id'] for r in list_after_act})
        self.assertEqual(404, app.handle(dict(
            version='2.0', rawPath='/api/public/activities/a1',
            requestContext={'http': {'method': 'GET'}}
        ))['statusCode'])

        # Re-publish a1, then unpublish primary partner p1 -> BOTH p1 and orphan a1 disappear
        table[2]['publication'] = 'public'
        table[0]['publication'] = 'internal'
        list_after_primary = json.loads(app.handle(dict(
            version='2.0', rawPath='/api/public/records',
            queryStringParameters={'view': 'cards'},
            requestContext={'http': {'method': 'GET'}}
        ))['body'])
        self.assertEqual([], list_after_primary)
        self.assertEqual(404, app.handle(dict(
            version='2.0', rawPath='/api/public/activities/a1',
            requestContext={'http': {'method': 'GET'}}
        ))['statusCode'])

        # Method & query restrictions
        self.assertEqual(405, app.handle(dict(
            version='2.0', rawPath='/api/public/partners/p1',
            requestContext={'http': {'method': 'POST'}}
        ))['statusCode'])
        self.assertEqual(422, app.handle(dict(
            version='2.0', rawPath='/api/public/partners/p1',
            queryStringParameters={'scopeId': 'cs-demo'},
            requestContext={'http': {'method': 'GET'}}
        ))['statusCode'])
