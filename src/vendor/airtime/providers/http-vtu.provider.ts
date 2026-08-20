import { AirtimeProvider, AirtimePurchaseParams } from './airtime.provider';
import { DataProvider, DataPurchaseParams } from '../../data/providers/data.provider';
import { NormalizedProviderResult } from '../../providers/provider-result';
import * as https from 'https';
import { URL } from 'url';

export interface HttpVtuProviderOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  name?: string;
}

export class HttpVtuProvider implements AirtimeProvider, DataProvider {
  name: string;
  private baseUrl: string;
  private apiKey: string;
  private timeoutMs: number;

  constructor(opts: HttpVtuProviderOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 10000;
    this.name = opts.name ?? 'HTTP';
  }

  private providerSlug(network: string): string {
    const value = String(network).toUpperCase();
    if (value === 'NINE_MOBILE') return '9mobile';
    return value.toLowerCase();
  }

  async purchaseAirtime(params: AirtimePurchaseParams): Promise<NormalizedProviderResult> {
    return this._post('/airtime/purchase', {
      provider_id: this.providerSlug(params.network),
      amount: params.amount,
      recipient: params.phone,
      reference: params.reference,
    });
  }

  async purchaseData(params: DataPurchaseParams): Promise<NormalizedProviderResult> {
    return this._post('/data/purchase', {
      provider_id: this.providerSlug(params.network),
      plan_id: params.plan,
      recipient: params.phone,
      reference: params.reference,
    });
  }

  private async _post(path: string, params: Record<string, unknown>): Promise<NormalizedProviderResult> {
    if (!this.baseUrl) return this.unknown('VTU_BASE_URL not configured');
    if (!this.apiKey) return this.unknown('VTU_API_KEY not configured');

    try {
      const url = new URL(`${this.baseUrl}${path}`);
      const body = JSON.stringify(params);
      const requestOptions: https.RequestOptions = {
        method: 'POST',
        hostname: url.hostname,
        port: url.port ? Number(url.port) : undefined,
        path: url.pathname + url.search,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Authorization: `Bearer ${this.apiKey}`,
        },
        timeout: this.timeoutMs,
      };

      const { statusCode, raw } = await new Promise<{ statusCode: number; raw: string }>((resolve, reject) => {
        const req = https.request(requestOptions, (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, raw: data }));
        });
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('VTU request timed out')));
        req.write(body);
        req.end();
      });

      let parsed: any;
      try { parsed = JSON.parse(raw); } catch { parsed = { message: raw }; }

      const providerStatus = typeof parsed?.status === 'string' ? parsed.status : undefined;
      const providerReference = parsed?.data?.reference_code ?? parsed?.reference_code ?? undefined;
      const message = parsed?.message ?? parsed?.data?.message;
      if (!providerStatus) return this.unknown(message ?? 'Provider returned malformed response', parsed);

      const normalizedStatus = providerStatus.toLowerCase();
      if (normalizedStatus === 'success' && statusCode >= 200 && statusCode < 300) {
        return {
          outcome: 'SUCCESS',
          providerName: this.name,
          providerReference,
          providerStatus,
          retryability: 'NOT_RETRYABLE',
          rawResponse: parsed,
          message,
        };
      }

      if (['pending', 'processing', 'queued'].includes(normalizedStatus)) {
        return {
          outcome: 'PENDING',
          providerName: this.name,
          providerReference,
          providerStatus,
          retryability: 'RETRYABLE',
          rawResponse: parsed,
          message,
        };
      }

      if (['failed', 'rejected', 'declined', 'error'].includes(normalizedStatus)) {
        return {
          outcome: 'REJECTED',
          providerName: this.name,
          providerReference,
          providerStatus,
          retryability: 'NOT_RETRYABLE',
          rawResponse: parsed,
          message,
        };
      }

      return this.unknown(message ?? `Provider returned status ${providerStatus}`, parsed, providerStatus);
    } catch (err) {
      return this.unknown(err instanceof Error ? err.message : String(err));
    }
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
