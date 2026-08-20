import { AirtimeProvider, AirtimePurchaseParams } from './airtime.provider';
import { DataProvider, DataPurchaseParams } from '../../data/providers/data.provider';
import { NormalizedProviderResult } from '../../providers/provider-result';
import * as https from 'https';
import { URL } from 'url';

export interface PairgateProviderOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  dataPlanMap: Record<string, string>;
}

export class PairgateProvider implements AirtimeProvider, DataProvider {
  readonly name = 'PAIRGATE';
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly dataPlanMap: Record<string, string>;

  constructor(options: PairgateProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 10000;
    this.dataPlanMap = options.dataPlanMap;
  }

  purchaseAirtime(params: AirtimePurchaseParams): Promise<NormalizedProviderResult> {
    return this.post('/airtime/purchase', {
      provider_id: this.providerSlug(params.network),
      amount: params.amount,
      recipient: params.phone,
      reference: params.reference,
    });
  }

  purchaseData(params: DataPurchaseParams): Promise<NormalizedProviderResult> {
    const planId = this.dataPlanMap[`${params.network}:${params.plan}`] ?? this.dataPlanMap[params.plan];
    if (!planId) {
      return Promise.resolve({
        outcome: 'REJECTED',
        providerName: this.name,
        providerStatus: 'PLAN_MAPPING_MISSING',
        retryability: 'NOT_RETRYABLE',
        rawResponse: { network: params.network, plan: params.plan },
        message: 'Pairgate plan mapping is not configured for this plan',
      });
    }

    return this.post('/data/purchase', {
      provider_id: this.providerSlug(params.network),
      plan_id: planId,
      recipient: params.phone,
      reference: params.reference,
    });
  }

  getTransactionStatus(reference: string): Promise<NormalizedProviderResult> {
    return this.get(`/transaction/status?reference_code=${encodeURIComponent(reference)}`);
  }

  private providerSlug(network: string): string {
    const value = String(network).toUpperCase();
    return value === 'NINE_MOBILE' ? '9mobile' : value.toLowerCase();
  }

  private async post(path: string, bodyParams: Record<string, unknown>): Promise<NormalizedProviderResult> {
    return this.request('POST', path, bodyParams);
  }

  private async get(path: string): Promise<NormalizedProviderResult> {
    return this.request('GET', path);
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    bodyParams?: Record<string, unknown>,
  ): Promise<NormalizedProviderResult> {
    if (!this.baseUrl) return this.unknown('PAIRGATE_BASE_URL not configured');
    if (!this.apiKey) return this.unknown('PAIRGATE_API_KEY not configured');

    try {
      const url = new URL(`${this.baseUrl}${path}`);
      const body = bodyParams ? JSON.stringify(bodyParams) : '';
      const requestOptions: https.RequestOptions = {
        method,
        hostname: url.hostname,
        port: url.port ? Number(url.port) : undefined,
        path: url.pathname + url.search,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Cache-Control': 'no-cache',
          ...(bodyParams
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
              }
            : {}),
        },
        timeout: this.timeoutMs,
      };

      const response = await new Promise<{ statusCode: number; raw: string }>((resolve, reject) => {
        const request = https.request(requestOptions, (response) => {
          let raw = '';
          response.on('data', (chunk) => (raw += chunk));
          response.on('end', () => resolve({ statusCode: response.statusCode ?? 0, raw }));
        });
        request.on('error', reject);
        request.on('timeout', () => request.destroy(new Error('Pairgate request timed out')));
        if (body) request.write(body);
        request.end();
      });

      let payload: any;
      try {
        payload = JSON.parse(response.raw);
      } catch {
        return this.unknown('Pairgate returned malformed JSON', { statusCode: response.statusCode });
      }

      if (path.startsWith('/transaction/status')) {
        return this.normalizeStatus(response.statusCode, payload);
      }
      return this.normalizePurchase(response.statusCode, payload);
    } catch (error) {
      return this.unknown(error instanceof Error ? error.message : String(error));
    }
  }

  private normalizePurchase(statusCode: number, payload: any): NormalizedProviderResult {
    const providerStatus = typeof payload?.data?.status === 'string'
      ? payload.data.status
      : payload?.status;
    const providerReference = payload?.data?.reference_code;
    const message = payload?.data?.message ?? payload?.message;

    if (statusCode >= 200 && statusCode < 300 && payload?.status === 'success' && payload?.data?.status === true) {
      return {
        outcome: 'PENDING',
        providerName: this.name,
        providerReference,
        providerStatus: 'processing',
        retryability: 'RETRYABLE',
        rawResponse: payload,
        message,
      };
    }

    if (statusCode === 401 || statusCode === 403 || statusCode === 422) {
      return {
        outcome: 'REJECTED',
        providerName: this.name,
        providerReference,
        providerStatus: String(providerStatus ?? `HTTP_${statusCode}`),
        retryability: 'NOT_RETRYABLE',
        rawResponse: payload,
        message,
      };
    }

    return this.unknown(message ?? `Pairgate returned HTTP ${statusCode}`, payload, providerStatus);
  }

  private normalizeStatus(statusCode: number, payload: any): NormalizedProviderResult {
    const providerStatus = payload?.data?.status;
    const providerReference = payload?.data?.reference_code;
    const message = payload?.message;
    const common = {
      providerName: this.name,
      providerReference,
      providerStatus,
      rawResponse: payload,
      message,
    };

    if (statusCode >= 200 && statusCode < 300 && payload?.status === 'success') {
      if (providerStatus === 'successful') {
        return { ...common, outcome: 'SUCCESS', retryability: 'NOT_RETRYABLE' };
      }
      if (providerStatus === 'failed') {
        return { ...common, outcome: 'REJECTED', retryability: 'NOT_RETRYABLE' };
      }
      if (providerStatus === 'processing' || providerStatus === 'pending') {
        return { ...common, outcome: 'PENDING', retryability: 'RETRYABLE' };
      }
    }

    return this.unknown(message ?? `Pairgate returned HTTP ${statusCode}`, payload, providerStatus);
  }

  private unknown(message: string, rawResponse?: unknown, providerStatus?: string): NormalizedProviderResult {
    return {
      outcome: 'UNKNOWN',
      providerName: this.name,
      providerStatus,
      retryability: 'UNKNOWN',
      rawResponse,
      message,
    };
  }
}
