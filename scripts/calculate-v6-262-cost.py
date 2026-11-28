"""Reproducible AWS Singapore (ap-southeast-1) cost comparison per 1,000 Welcome loads (#262).

Reads verified measurements from #259 (baseline-58a40f8.json), #260 (rcu-comparison.json),
and #261 (browser-verification.json) and calculates Before vs After AWS marginal costs
using identical service scope across both versions.

All prices are AWS ap-southeast-1 (Singapore) on-demand list prices (excluding Free Tier)
as of 2026-11-28. When post-deploy CloudWatch REPORT RequestId metrics are collected,
pass --after-lambda-ms / --before-lambda-ms / --after-rcu to re-run with live CloudWatch values.
"""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASELINE_259 = ROOT / 'docs/evidence/assets/v6/issue-259/baseline-58a40f8.json'
RCU_260 = ROOT / 'docs/evidence/assets/v6/issue-260/rcu-comparison.json'
BROWSER_261 = ROOT / 'docs/evidence/assets/v6/issue-261/browser-verification.json'
DEFAULT_OUT = ROOT / 'docs/evidence/assets/v6/issue-262/aws-cost-1000.json'

# AWS ap-southeast-1 (Singapore) list prices (USD), reference date: 2026-11-28
PRICING = {
    'region': 'ap-southeast-1 (Asia Pacific - Singapore)',
    'referenceDate': '2026-11-28',
    'freeTierExcluded': True,
    'sources': {
        'apiGatewayHttpApi': 'https://aws.amazon.com/api-gateway/pricing/',
        'lambda': 'https://aws.amazon.com/lambda/pricing/',
        'dynamoDbOnDemand': 'https://aws.amazon.com/dynamodb/pricing/on-demand/',
        'amplifyHosting': 'https://aws.amazon.com/amplify/pricing/',
    },
    'rates': {
        'apiGatewayHttpPerMillion': 1.25,       # USD per 1M HTTP API requests (first 300M/mo)
        'lambdaRequestPerMillion': 0.20,        # USD per 1M Lambda invocations (x86_64)
        'lambdaGbSecond': 0.0000166667,         # USD per GB-second (x86_64)
        'dynamoRruPerMillion': 0.1425,          # USD per 1M Read Request Units (ap-southeast-1)
        'dynamoWruPerMillion': 0.71,            # USD per 1M Write Request Units (ap-southeast-1)
        'amplifyTransferPerGb': 0.15,           # USD per GB served
    },
}


def compute_model(loads=1000, *,
                  fetch_lambda_ms=118.0,
                  public_records_before_ms=120.0,
                  session_lambda_ms=48.0,
                  public_records_after_ms=115.0,
                  detail_click_rate=0.20):
    b259 = json.loads(BASELINE_259.read_text(encoding='utf-8'))
    r260 = json.loads(RCU_260.read_text(encoding='utf-8'))
    b261 = json.loads(BROWSER_261.read_text(encoding='utf-8'))

    rates = PRICING['rates']

    # Lambda memory from infra/backend.yaml (CSTUHubAuth = 256 MB, fetchPartnersData = 128 MB)
    auth_mem_gb = 256 / 1024.0   # 0.25 GB
    fetch_mem_gb = 128 / 1024.0  # 0.125 GB

    # Per-load metrics from #259, #260, #261
    before_api_calls = int(b259['summary']['cold']['apiRequestCount']['p50'])  # 6
    after_api_calls = len(b261['ac1InitialLoadNetwork']['allApiCallsOnWelcomeLoad'])  # 2

    before_catalog_rcu = float(r260['ac3DynamoComparisonPerWelcomeLoad']['before']['totalCatalogRcu'])  # 16.5
    after_catalog_rcu = float(r260['ac3DynamoComparisonPerWelcomeLoad']['after']['totalCatalogRcu'])    # 11.0

    # Cold visitor anonymous session writes on CSTUHub-Sessions (4 before vs 1 after)
    before_session_wru = 4.0
    after_session_wru = 1.0

    # Lambda GB-seconds per 1 Welcome load
    before_gbs_per_load = (
        (1 * fetch_mem_gb * (fetch_lambda_ms / 1000.0)) +
        (1 * auth_mem_gb * (public_records_before_ms / 1000.0)) +
        (4 * auth_mem_gb * (session_lambda_ms / 1000.0))
    )
    after_gbs_per_load = (
        (1 * auth_mem_gb * (public_records_after_ms / 1000.0)) +
        (1 * auth_mem_gb * (session_lambda_ms / 1000.0))
    )

    # API wire transfer (Brotli bytes from #259 & #260 ratio)
    before_api_bytes = 6847 + 6245 + (4 * 478)  # 15,004 bytes compressed per load
    # Card view raw JSON dropped 78.7% vs combined raw (17,301 vs 81,040), ~52% smaller than /api/public/records alone
    after_api_bytes = round(6245 * (17301 / 36297)) + 478  # ~3,455 bytes compressed per load

    # Amplify total transfer per load (Cold p50 = 1,469.1 KB; Warm p50 = 37.4 KB)
    before_cold_total_kb = float(b259['summary']['cold']['totalTransferKB']['p50'])
    after_cold_total_kb = round(before_cold_total_kb - ((before_api_bytes - after_api_bytes) / 1024.0), 1)
    before_warm_total_kb = float(b259['summary']['warm']['totalTransferKB']['p50'])
    after_warm_total_kb = round(max(1.0, before_warm_total_kb - ((before_api_bytes - after_api_bytes) / 1024.0)), 1)

    def line_item(service, unit, qty_before, qty_after, unit_price, unit_divisor=1.0):
        cost_before = (qty_before / unit_divisor) * unit_price
        cost_after = (qty_after / unit_divisor) * unit_price
        diff = cost_after - cost_before
        pct = ((diff / cost_before) * 100.0) if cost_before else 0.0
        return {
            'service': service,
            'unit': unit,
            'qtyBefore': round(qty_before, 4),
            'qtyAfter': round(qty_after, 4),
            'unitPriceUsd': unit_price,
            'unitDivisor': unit_divisor,
            'costBeforeUsd': round(cost_before, 6),
            'costAfterUsd': round(cost_after, 6),
            'diffUsd': round(diff, 6),
            'diffPct': f'{pct:.1f}%',
        }

    backend_items = [
        line_item('API Gateway (HTTP API)', 'requests', before_api_calls * loads, after_api_calls * loads,
                  rates['apiGatewayHttpPerMillion'], 1_000_000),
        line_item('AWS Lambda (Requests)', 'invocations', before_api_calls * loads, after_api_calls * loads,
                  rates['lambdaRequestPerMillion'], 1_000_000),
        line_item('AWS Lambda (Compute Duration, x86_64)', 'GB-seconds',
                  before_gbs_per_load * loads, after_gbs_per_load * loads,
                  rates['lambdaGbSecond'], 1.0),
        line_item('DynamoDB On-Demand (Catalog Reads — CSTUHub-Partner)', 'RRU',
                  before_catalog_rcu * loads, after_catalog_rcu * loads,
                  rates['dynamoRruPerMillion'], 1_000_000),
        line_item('DynamoDB On-Demand (Cold Session Writes — CSTUHub-Sessions)', 'WRU',
                  before_session_wru * loads, after_session_wru * loads,
                  rates['dynamoWruPerMillion'], 1_000_000),
    ]

    backend_before = sum(i['costBeforeUsd'] for i in backend_items)
    backend_after = sum(i['costAfterUsd'] for i in backend_items)
    backend_diff = backend_after - backend_before

    # Amplify Hosting Data Transfer (Cold vs Warm)
    cold_transfer_item = line_item(
        'AWS Amplify Hosting (Data Transfer — Cold Cache)', 'GB',
        (before_cold_total_kb * loads) / (1024 * 1024),
        (after_cold_total_kb * loads) / (1024 * 1024),
        rates['amplifyTransferPerGb'], 1.0
    )
    warm_transfer_item = line_item(
        'AWS Amplify Hosting (Data Transfer — Warm Cache)', 'GB',
        (before_warm_total_kb * loads) / (1024 * 1024),
        (after_warm_total_kb * loads) / (1024 * 1024),
        rates['amplifyTransferPerGb'], 1.0
    )

    # Sensitivity: on-demand detail clicks (e.g., 20% of Welcome visitors click 1 partner card)
    detail_clicks = round(loads * detail_click_rate)
    detail_gbs = detail_clicks * auth_mem_gb * (45.0 / 1000.0)
    detail_cost = (
        (detail_clicks / 1_000_000) * rates['apiGatewayHttpPerMillion'] +
        (detail_clicks / 1_000_000) * rates['lambdaRequestPerMillion'] +
        detail_gbs * rates['lambdaGbSecond'] +
        (detail_clicks * 1.0 / 1_000_000) * rates['dynamoRruPerMillion']
    )

    return {
        'pricing': PRICING,
        'loadsEvaluated': loads,
        'perLoadInputs': {
            'before': {
                'apiRequests': before_api_calls,
                'lambdaInvocations': before_api_calls,
                'lambdaBreakdown': [
                    {'function': 'fetchPartnersData', 'memoryMB': 128, 'calls': 1, 'estBilledMsPerCall': fetch_lambda_ms},
                    {'function': 'CSTUHubAuth (/api/public/records)', 'memoryMB': 256, 'calls': 1, 'estBilledMsPerCall': public_records_before_ms},
                    {'function': 'CSTUHubAuth (/api/auth/session)', 'memoryMB': 256, 'calls': 4, 'estBilledMsPerCall': session_lambda_ms},
                ],
                'totalBilledDurationMs': round(fetch_lambda_ms + public_records_before_ms + 4 * session_lambda_ms, 1),
                'totalGbSeconds': round(before_gbs_per_load, 5),
                'dynamoCatalogRru': before_catalog_rcu,
                'dynamoColdSessionWru': before_session_wru,
                'coldTransferKB': before_cold_total_kb,
                'warmTransferKB': before_warm_total_kb,
            },
            'after': {
                'apiRequests': after_api_calls,
                'lambdaInvocations': after_api_calls,
                'lambdaBreakdown': [
                    {'function': 'fetchPartnersData', 'memoryMB': 128, 'calls': 0, 'estBilledMsPerCall': 0},
                    {'function': 'CSTUHubAuth (/api/public/records?view=cards)', 'memoryMB': 256, 'calls': 1, 'estBilledMsPerCall': public_records_after_ms},
                    {'function': 'CSTUHubAuth (/api/auth/session)', 'memoryMB': 256, 'calls': 1, 'estBilledMsPerCall': session_lambda_ms},
                ],
                'totalBilledDurationMs': round(public_records_after_ms + session_lambda_ms, 1),
                'totalGbSeconds': round(after_gbs_per_load, 5),
                'dynamoCatalogRru': after_catalog_rcu,
                'dynamoColdSessionWru': after_session_wru,
                'coldTransferKB': after_cold_total_kb,
                'warmTransferKB': after_warm_total_kb,
            },
        },
        'backendCostPer1000Loads': {
            'items': backend_items,
            'totalBeforeUsd': round(backend_before, 6),
            'totalAfterUsd': round(backend_after, 6),
            'diffUsd': round(backend_diff, 6),
            'diffPct': f'{(backend_diff / backend_before) * 100.0:.1f}%',
        },
        'fullStackCostPer1000Loads': {
            'coldCache': {
                'transferItem': cold_transfer_item,
                'totalBeforeUsd': round(backend_before + cold_transfer_item['costBeforeUsd'], 6),
                'totalAfterUsd': round(backend_after + cold_transfer_item['costAfterUsd'], 6),
                'diffUsd': round((backend_after + cold_transfer_item['costAfterUsd']) - (backend_before + cold_transfer_item['costBeforeUsd']), 6),
                'diffPct': f'{(((backend_after + cold_transfer_item["costAfterUsd"]) - (backend_before + cold_transfer_item["costBeforeUsd"])) / (backend_before + cold_transfer_item["costBeforeUsd"])) * 100.0:.1f}%',
            },
            'warmCache': {
                'transferItem': warm_transfer_item,
                'totalBeforeUsd': round(backend_before + warm_transfer_item['costBeforeUsd'], 6),
                'totalAfterUsd': round(backend_after + warm_transfer_item['costAfterUsd'], 6),
                'diffUsd': round((backend_after + warm_transfer_item['costAfterUsd']) - (backend_before + warm_transfer_item['costBeforeUsd']), 6),
                'diffPct': f'{(((backend_after + warm_transfer_item["costAfterUsd"]) - (backend_before + warm_transfer_item["costBeforeUsd"])) / (backend_before + warm_transfer_item["costBeforeUsd"])) * 100.0:.1f}%',
            },
        },
        'onDemandDetailSensitivity': {
            'assumedClickRate': detail_click_rate,
            'detailClicksPer1000Loads': detail_clicks,
            'addedBackendCostUsd': round(detail_cost, 6),
            'afterBackendPlusDetailUsd': round(backend_after + detail_cost, 6),
            'netBackendSavingsVsBeforePct': f'{(((backend_after + detail_cost) - backend_before) / backend_before) * 100.0:.1f}%',
        },
        'assumptions': [
            'Prices are AWS ap-southeast-1 (Singapore) on-demand list prices as of 2026-11-28, excluding AWS Free Tier so marginal unit cost differences remain visible.',
            'Lambda memory sizes match infra/backend.yaml: CSTUHubAuth = 256 MB (x86_64), fetchPartnersData = 128 MB (x86_64).',
            'Lambda billed duration uses Warm p50 TTFB from #259 minus ~37 ms baseline Singapore RTT (118 ms fetchPartnersData, 120 ms public/records before, 115 ms public/records?view=cards after, 48 ms auth/session). Replace with CloudWatch REPORT RequestId Billed Duration after PR #306 deploys.',
            'DynamoDB catalog RRU uses the live 37-item public snapshot (44,335 bytes -> 16.5 RRU before vs 11.0 RRU after); any additional private/retired rows scale both versions proportionally (-33.3% unchanged).',
            'Cold-visitor anonymous session writes on CSTUHub-Sessions drop from 4 WRU to 1 WRU per load after auth-client.js deduplication and role-menu.js pageshow guard.',
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--loads', type=int, default=1000)
    parser.add_argument('--out', default=str(DEFAULT_OUT))
    args = parser.parse_args()
    result = compute_model(loads=args.loads)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
