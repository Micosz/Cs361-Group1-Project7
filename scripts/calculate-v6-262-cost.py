"""Reproducible AWS Singapore (ap-southeast-1) cost comparison per 1,000 Welcome loads (#262).

Reads verified live AWS Singapore measurements from #259 (baseline-58a40f8.json and
after-6d407dc.json), #260 (rcu-comparison.json), and #261 (browser-verification.json)
and calculates Before vs After AWS marginal costs using identical service scope across
both versions.

All prices are AWS ap-southeast-1 (Singapore) on-demand list prices (excluding Free Tier)
as of 2026-11-28. Optional CLI flags allow overriding Lambda billed duration or DynamoDB
RCU with exact CloudWatch REPORT RequestId / public_catalog_read log values.
"""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASELINE_259 = ROOT / 'docs/evidence/assets/v6/issue-259/baseline-58a40f8.json'
AFTER_259 = ROOT / 'docs/evidence/assets/v6/issue-259/after-6d407dc.json'
RCU_260 = ROOT / 'docs/evidence/assets/v6/issue-260/rcu-comparison.json'
BROWSER_261 = ROOT / 'docs/evidence/assets/v6/issue-261/browser-verification.json'
DEFAULT_OUT = ROOT / 'docs/evidence/assets/v6/issue-262/aws-cost-1000.json'

# Baseline Thailand -> AWS Singapore (ap-southeast-1) network RTT from baseline Cold Document TTFB p50 (37.4 ms)
BASELINE_RTT_MS = 37.0

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
                  fetch_lambda_ms=None,
                  public_records_before_ms=None,
                  session_before_ms=None,
                  public_records_after_ms=None,
                  session_after_ms=None,
                  after_catalog_rcu_override=None,
                  detail_click_rate=0.20):
    b259 = json.loads(BASELINE_259.read_text(encoding='utf-8'))
    a259 = json.loads(AFTER_259.read_text(encoding='utf-8'))
    r260 = json.loads(RCU_260.read_text(encoding='utf-8'))
    b261 = json.loads(BROWSER_261.read_text(encoding='utf-8'))

    rates = PRICING['rates']

    # Lambda memory from infra/backend.yaml (CSTUHubAuth = 256 MB, fetchPartnersData = 128 MB)
    auth_mem_gb = 256 / 1024.0   # 0.25 GB
    fetch_mem_gb = 128 / 1024.0  # 0.125 GB

    # Derive Warm Lambda billed duration from live AWS Singapore Warm p50 TTFB minus ~37 ms RTT
    # unless explicitly overridden by CloudWatch REPORT RequestId values.
    b_warm_ep = b259['summary']['warm']['perEndpoint']
    a_warm_ep = a259['summary']['warm']['perEndpoint']

    if fetch_lambda_ms is None:
        fetch_lambda_ms = round(max(1.0, b_warm_ep['GET /fetchPartnersData']['ttfbMs']['p50'] - BASELINE_RTT_MS), 1)
    if public_records_before_ms is None:
        public_records_before_ms = round(max(1.0, b_warm_ep['GET /api/public/records']['ttfbMs']['p50'] - BASELINE_RTT_MS), 1)
    if session_before_ms is None:
        session_before_ms = round(max(1.0, b_warm_ep['GET /api/auth/session']['ttfbMs']['p50'] - BASELINE_RTT_MS), 1)
    if public_records_after_ms is None:
        public_records_after_ms = round(max(1.0, a_warm_ep['GET /api/public/records']['ttfbMs']['p50'] - BASELINE_RTT_MS), 1)
    if session_after_ms is None:
        session_after_ms = round(max(1.0, a_warm_ep['GET /api/auth/session']['ttfbMs']['p50'] - BASELINE_RTT_MS), 1)

    # Per-load metrics directly from live #259 Before/After, #260, and #261
    before_api_calls = int(b259['summary']['cold']['apiRequestCount']['p50'])  # 6
    after_api_calls = int(a259['summary']['cold']['apiRequestCount']['p50'])   # 2
    assert after_api_calls == len(b261['ac1InitialLoadNetwork']['allApiCallsOnWelcomeLoad'])

    before_catalog_rcu = float(r260['ac3DynamoComparisonPerWelcomeLoad']['before']['totalCatalogRcu'])  # 16.5
    after_catalog_rcu = (
        float(after_catalog_rcu_override)
        if after_catalog_rcu_override is not None
        else float(r260['ac3DynamoComparisonPerWelcomeLoad']['after']['totalCatalogRcu'])
    )  # 11.0

    # Cold visitor anonymous session writes on CSTUHub-Sessions (4 before vs 1 after)
    before_session_wru = float(b259['summary']['cold']['perEndpoint']['GET /api/auth/session']['callsPerLoad'])  # 4.0
    after_session_wru = float(a259['summary']['cold']['perEndpoint']['GET /api/auth/session']['callsPerLoad'])   # 1.0

    # Lambda GB-seconds per 1 Welcome load
    before_gbs_per_load = (
        (1 * fetch_mem_gb * (fetch_lambda_ms / 1000.0)) +
        (1 * auth_mem_gb * (public_records_before_ms / 1000.0)) +
        (before_session_wru * auth_mem_gb * (session_before_ms / 1000.0))
    )
    after_gbs_per_load = (
        (1 * auth_mem_gb * (public_records_after_ms / 1000.0)) +
        (after_session_wru * auth_mem_gb * (session_after_ms / 1000.0))
    )

    # Measured API wire bytes (Brotli) from live AWS Singapore #259 runs
    b_cold_ep = b259['summary']['cold']['perEndpoint']
    a_cold_ep = a259['summary']['cold']['perEndpoint']
    before_cold_api_bytes = int(
        b_cold_ep['GET /fetchPartnersData']['bytes']['p50'] +
        b_cold_ep['GET /api/public/records']['bytes']['p50'] +
        (4 * b_cold_ep['GET /api/auth/session']['bytes']['p50'])
    )  # 15,004 B
    after_cold_api_bytes = int(
        a_cold_ep['GET /api/public/records']['bytes']['p50'] +
        a_cold_ep['GET /api/auth/session']['bytes']['p50']
    )  # 4,384 B
    before_warm_api_bytes = int(
        b_warm_ep['GET /fetchPartnersData']['bytes']['p50'] +
        b_warm_ep['GET /api/public/records']['bytes']['p50'] +
        (4 * b_warm_ep['GET /api/auth/session']['bytes']['p50'])
    )  # 14,585 B
    after_warm_api_bytes = int(
        a_warm_ep['GET /api/public/records']['bytes']['p50'] +
        a_warm_ep['GET /api/auth/session']['bytes']['p50']
    )  # 4,295 B

    # Measured Amplify Hosting total transfer per load from live #259:
    # - Warm Cache uses measured Warm p50 (37.4 KB -> 27.3 KB, exact -10.1 KB match with -10,290 B API wire savings).
    # - Cold Cache uses measured Cold full-load p95 (2,112.8 KB -> 2,104.9 KB, -7.9 KB) rather than Cold p50
    #   (1,469.1 -> 1,175.5 KB) to avoid overstating Cold transfer savings from below-the-fold lazy-image timing jitter.
    before_warm_total_kb = float(b259['summary']['warm']['totalTransferKB']['p50'])   # 37.4
    after_warm_total_kb = float(a259['summary']['warm']['totalTransferKB']['p50'])    # 27.3
    before_cold_total_kb = float(b259['summary']['cold']['totalTransferKB']['p95'])   # 2,112.8
    after_cold_total_kb = float(a259['summary']['cold']['totalTransferKB']['p95'])    # 2,104.9

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

    # Amplify Hosting Data Transfer (Cold full-load p95 vs Warm p50)
    cold_transfer_item = line_item(
        'AWS Amplify Hosting (Data Transfer — Cold Cache Full Load p95)', 'GB',
        (before_cold_total_kb * loads) / (1024 * 1024),
        (after_cold_total_kb * loads) / (1024 * 1024),
        rates['amplifyTransferPerGb'], 1.0
    )
    warm_transfer_item = line_item(
        'AWS Amplify Hosting (Data Transfer — Warm Cache p50)', 'GB',
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
        'commits': {
            'before': '58a40f8e122930ab7c31e88e40fbe0a5f0a52bbd',
            'beforeLiveIndexSha256': b259['deployment']['liveSha256'],
            'after': a259['deployment']['mainSha'],
            'afterLiveIndexSha256': a259['deployment']['liveSha256'],
        },
        'loadsEvaluated': loads,
        'perLoadInputs': {
            'before': {
                'apiRequests': before_api_calls,
                'lambdaInvocations': before_api_calls,
                'lambdaBreakdown': [
                    {'function': 'fetchPartnersData', 'memoryMB': 128, 'calls': 1, 'estBilledMsPerCall': fetch_lambda_ms},
                    {'function': 'CSTUHubAuth (/api/public/records)', 'memoryMB': 256, 'calls': 1, 'estBilledMsPerCall': public_records_before_ms},
                    {'function': 'CSTUHubAuth (/api/auth/session)', 'memoryMB': 256, 'calls': int(before_session_wru), 'estBilledMsPerCall': session_before_ms},
                ],
                'totalBilledDurationMs': round(fetch_lambda_ms + public_records_before_ms + before_session_wru * session_before_ms, 1),
                'totalGbSeconds': round(before_gbs_per_load, 5),
                'dynamoCatalogRru': before_catalog_rcu,
                'dynamoColdSessionWru': before_session_wru,
                'apiWireBytesCold': before_cold_api_bytes,
                'apiWireBytesWarm': before_warm_api_bytes,
                'coldTransferFullLoadP95KB': before_cold_total_kb,
                'coldTransferP50KB': float(b259['summary']['cold']['totalTransferKB']['p50']),
                'warmTransferP50KB': before_warm_total_kb,
            },
            'after': {
                'apiRequests': after_api_calls,
                'lambdaInvocations': after_api_calls,
                'lambdaBreakdown': [
                    {'function': 'fetchPartnersData', 'memoryMB': 128, 'calls': 0, 'estBilledMsPerCall': 0},
                    {'function': 'CSTUHubAuth (/api/public/records?view=cards)', 'memoryMB': 256, 'calls': 1, 'estBilledMsPerCall': public_records_after_ms},
                    {'function': 'CSTUHubAuth (/api/auth/session)', 'memoryMB': 256, 'calls': int(after_session_wru), 'estBilledMsPerCall': session_after_ms},
                ],
                'totalBilledDurationMs': round(public_records_after_ms + after_session_wru * session_after_ms, 1),
                'totalGbSeconds': round(after_gbs_per_load, 5),
                'dynamoCatalogRru': after_catalog_rcu,
                'dynamoColdSessionWru': after_session_wru,
                'apiWireBytesCold': after_cold_api_bytes,
                'apiWireBytesWarm': after_warm_api_bytes,
                'coldTransferFullLoadP95KB': after_cold_total_kb,
                'coldTransferP50KB': float(a259['summary']['cold']['totalTransferKB']['p50']),
                'warmTransferP50KB': after_warm_total_kb,
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
            'Before (58a40f8) and After (6d407dc) API counts, transfer sizes, and Warm TTFB are read directly from live AWS Singapore #259 measurements (baseline-58a40f8.json and after-6d407dc.json).',
            'Lambda memory sizes match infra/backend.yaml: CSTUHubAuth = 256 MB (x86_64), fetchPartnersData = 128 MB (x86_64).',
            'Lambda billed duration is derived consistently from live Warm p50 TTFB minus ~37.0 ms Thailand-Singapore RTT (116.3 ms fetchPartnersData, 116.0 ms public/records before, 46.4 ms auth/session before; 133.2 ms public/records?view=cards after, 43.4 ms auth/session after). Pass CLI override flags if replacing with CloudWatch REPORT RequestId Billed Duration.',
            'DynamoDB catalog RRU uses the live 37-item public snapshot (44,335 bytes -> 16.5 RRU before vs 11.0 RRU after); any additional private/retired rows scale both versions proportionally (-33.3% unchanged).',
            'Cold-visitor anonymous session writes on CSTUHub-Sessions drop from 4 WRU to 1 WRU per load, verified live in after-6d407dc.json (1 GET /api/auth/session per load across all 29 runs).',
            'Amplify Cold Cache transfer uses measured full-load Cold p95 (2,112.8 KB -> 2,104.9 KB) rather than Cold p50 (1,469.1 -> 1,175.5 KB) so lazy-image timing differences do not inflate Cold transfer savings; Warm Cache uses measured Warm p50 (37.4 KB -> 27.3 KB, matching the -10.05 KB compressed API reduction).',
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--loads', type=int, default=1000)
    parser.add_argument('--before-fetch-ms', type=float, default=None)
    parser.add_argument('--before-records-ms', type=float, default=None)
    parser.add_argument('--before-session-ms', type=float, default=None)
    parser.add_argument('--after-records-ms', type=float, default=None)
    parser.add_argument('--after-session-ms', type=float, default=None)
    parser.add_argument('--after-rcu', type=float, default=None)
    parser.add_argument('--out', default=str(DEFAULT_OUT))
    args = parser.parse_args()
    result = compute_model(
        loads=args.loads,
        fetch_lambda_ms=args.before_fetch_ms,
        public_records_before_ms=args.before_records_ms,
        session_before_ms=args.before_session_ms,
        public_records_after_ms=args.after_records_ms,
        session_after_ms=args.after_session_ms,
        after_catalog_rcu_override=args.after_rcu,
    )
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
