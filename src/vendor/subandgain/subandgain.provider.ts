import { AirtimeProvider, AirtimePurchaseParams } from '../airtime/providers/airtime.provider';
import { DataProvider, DataPurchaseParams } from '../data/providers/data.provider';
import { NormalizedProviderResult } from '../providers/provider-result';
import * as https from 'https';
import { URL } from 'url';

export interface SubAndGainProviderOptions {
  baseUrl: string;
  username: string;
  apiKey: string;
  timeoutMs?: number;
  requestHandler?: (requestOptions: https.RequestOptions, body: string) => Promise<{ statusCode: number; raw: string }>;
}

export interface SubAndGainPlanRecord {
  dataPlanId: string;
  id?: string;
  planId?: string;
  name?: string;
  network?: string;
  status?: string;
  isActive?: boolean;
}

export class SubAndGainProvider implements AirtimeProvider, DataProvider {
  readonly name = 'SUBANDGAIN';
  private readonly baseUrl: string;
  private readonly username: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly requestHandler?: (requestOptions: https.RequestOptions, body: string) => Promise<{ statusCode: number; raw: string }>;

  constructor(options: SubAndGainProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.username = options.username;
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 10000;
    this.requestHandler = options.requestHandler;
  }

  purchaseAirtime(params: AirtimePurchaseParams): Promise<NormalizedProviderResult> {
    return this.request('POST', '/api/airtime.php', {
      username: this.username,
      apiKey: this.apiKey,
      network: normalizeNetwork(params.network),
      phoneNumber: params.phone,
      amount: params.amount,
      reference: params.reference,
    });
  }

  purchaseData(params: DataPurchaseParams): Promise<NormalizedProviderResult> {
    return this.request('POST', '/api/data.php', {
      username: this.username,
      apiKey: this.apiKey,
      network: normalizeNetwork(params.network),
      dataPlan: params.plan,
      phoneNumber: params.phone,
      amount: params.amount,
      reference: params.reference,
    });
  }

  getAirtimeTransactionStatus(reference: string): Promise<NormalizedProviderResult> {
    return this.request('POST', '/api/query_airtime.php', {
      username: this.username,
      apiKey: this.apiKey,
      reference,
    });
  }

  getDataTransactionStatus(reference: string): Promise<NormalizedProviderResult> {
    return this.request('POST', '/api/query_data.php', {
      username: this.username,
      apiKey: this.apiKey,
      reference,
    });
  }

  getTransactionStatus(reference: string): Promise<NormalizedProviderResult> {
    return this.getAirtimeTransactionStatus(reference);
  }

  getWalletBalance(): Promise<NormalizedProviderResult> {
    return this.request('POST', '/api/balance.php', {
      username: this.username,
      apiKey: this.apiKey,
    });
  }

  getDataPlanCatalogue(): Promise<NormalizedProviderResult> {
    return this.request('POST', '/api/databundles.php', {
      username: this.username,
      apiKey: this.apiKey,
    });
  }

  async getActiveDataPlans(): Promise<SubAndGainPlanRecord[]> {
    const result = await this.getDataPlanCatalogue();
    const list = extractPlanList(result.rawResponse ?? result);
    return list.filter((plan) => isActivePlan(plan)).map((plan) => ({
      id: String(plan.id ?? plan.dataPlanId ?? plan.planId ?? ''),
      dataPlanId: String(plan.dataPlanId ?? plan.id ?? plan.planId ?? ''),
      planId: String(plan.planId ?? plan.dataPlanId ?? plan.id ?? ''),
      name: typeof plan.name === 'string' ? plan.name : undefined,
      network: typeof plan.network === 'string' ? plan.network : undefined,
      status: typeof plan.status === 'string' ? plan.status : undefined,
      isActive: isActivePlan(plan),
    }));
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    payload: Record<string, unknown>,
  ): Promise<NormalizedProviderResult> {
    if (!this.baseUrl) return this.unknown('SUBANDGAIN_BASE_URL not configured');
    if (!this.username) return this.unknown('SUBANDGAIN_USERNAME not configured');
    if (!this.apiKey) return this.unknown('SUBANDGAIN_API_KEY not configured');

    try {
      const url = new URL(`${this.baseUrl}${path}`);
      const body = JSON.stringify(payload);
      const requestOptions: https.RequestOptions = {
        method,
        hostname: url.hostname,
        port: url.port ? Number(url.port) : undefined,
        path: `${url.pathname}${url.search}`,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: this.timeoutMs,
      };

      const response = this.requestHandler
        ? await this.requestHandler(requestOptions, body)
        : await sendHttpsRequest(requestOptions, body);

      let parsed: any;
      try {
        parsed = JSON.parse(response.raw);
      } catch {
        return this.unknown('SubAndGain returned malformed JSON', { statusCode: response.statusCode, raw: response.raw });
      }

      return normalizeSubAndGainResponse(parsed, response.statusCode, this.name);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.unknown(message);
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

function normalizeNetwork(network: string): string {
  const value = String(network).trim().toUpperCase();
  if (value === 'NINE_MOBILE') return '9MOBILE';
  if (value === '9MOBILE') return '9MOBILE';
  if (value === 'GLO' || value === 'MTN' || value === 'AIRTEL') return value;
  return value;
}

function isActivePlan(plan: SubAndGainPlanRecord): boolean {
  const statuses = [
    String(plan.status ?? '').trim().toLowerCase(),
    String(plan.isActive ?? '').trim().toLowerCase(),
  ];
  if (statuses.includes('active')) return true;
  if (statuses.includes('true')) return true;
  if (statuses.includes('inactive')) return false;
  if (statuses.includes('false')) return false;
  return false;
}

function extractPlanList(rawResponse: unknown): SubAndGainPlanRecord[] {
  if (!rawResponse || typeof rawResponse !== 'object') return [];
  const payload = rawResponse as Record<string, unknown>;
  const candidate =
    payload.data ??
    payload.plans ??
    payload.result ??
    payload.items ??
    payload.response ??
    payload.catalogue ??
    [];

  if (Array.isArray(candidate)) return candidate as SubAndGainPlanRecord[];
  if (candidate && typeof candidate === 'object' && Array.isArray((candidate as Record<string, unknown>).plans)) {
    return ((candidate as Record<string, unknown>).plans as SubAndGainPlanRecord[]);
  }
  return [];
}

function normalizeSubAndGainResponse(payload: any, statusCode: number, providerName: string): NormalizedProviderResult {
  const statusValue = readStatus(payload);
  const reference = readReference(payload);
  const message = readMessage(payload);
  const normalized = String(statusValue ?? '').trim();
  const lowered = normalized.toLowerCase();

  if (statusCode >= 200 && statusCode < 300) {
    if (lowered === 'approved' || lowered === 'success' || lowered === 'completed') {
      return {
        outcome: 'SUCCESS',
        providerName,
        providerReference: reference,
        providerStatus: statusValue,
        retryability: 'NOT_RETRYABLE',
        rawResponse: payload,
        message,
      };
    }

    if (lowered === 'pending' || lowered === 'processing' || lowered === 'queued') {
      return {
        outcome: 'PENDING',
        providerName,
        providerReference: reference,
        providerStatus: statusValue,
        retryability: 'RETRYABLE',
        rawResponse: payload,
        message,
      };
    }

    if (lowered === 'cancelled' || lowered === 'canceled' || lowered === 'rejected' || lowered === 'failed') {
      return {
        outcome: 'REJECTED',
        providerName,
        providerReference: reference,
        providerStatus: statusValue,
        retryability: 'NOT_RETRYABLE',
        rawResponse: payload,
        message,
      };
    }

    if (payload && typeof payload === 'object' && Array.isArray(extractPlanList(payload))) {
      return {
        outcome: 'SUCCESS',
        providerName,
        providerReference: reference,
        providerStatus: statusValue || 'ACTIVE_PLANS',
        retryability: 'NOT_RETRYABLE',
        rawResponse: { plans: extractPlanList(payload).filter(Boolean) },
        message,
      };
    }
  }

  if (statusCode >= 400 && statusCode < 500) {
    return {
      outcome: 'UNKNOWN',
      providerName,
      providerReference: reference,
      providerStatus: statusValue || `HTTP_${statusCode}`,
      retryability: 'UNKNOWN',
      rawResponse: payload,
      message: message ?? `SubAndGain HTTP ${statusCode}`,
    };
  }

  return {
    outcome: 'UNKNOWN',
    providerName,
    providerReference: reference,
    providerStatus: statusValue,
    retryability: 'UNKNOWN',
    rawResponse: payload,
    message: message ?? 'SubAndGain response was indeterminate',
  };
}

function readStatus(payload: any): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const candidates = [
    payload.status,
    payload.state,
    payload.result?.status,
    payload.data?.status,
    payload.transaction?.status,
    payload.transactionStatus,
    payload.data?.state,
    payload.result?.state,
    payload.response?.status,
  ];
  const value = candidates.find((candidate) => typeof candidate === 'string' && candidate.trim().length > 0);
  return typeof value === 'string' ? value : undefined;
}

function readReference(payload: any): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const candidates = [
    payload.reference,
    payload.transactionId,
    payload.transaction_id,
    payload.id,
    payload.data?.reference,
    payload.data?.transactionId,
    payload.data?.transaction_id,
    payload.result?.reference,
    payload.transaction?.reference,
    payload.transaction?.transactionId,
    payload.transaction?.id,
  ];
  const value = candidates.find((candidate) => typeof candidate === 'string' && candidate.trim().length > 0);
  return typeof value === 'string' ? value : undefined;
}

function readMessage(payload: any): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const candidates = [
    payload.message,
    payload.error,
    payload.data?.message,
    payload.data?.error,
    payload.result?.message,
    payload.result?.error,
    payload.transaction?.message,
  ];
  const value = candidates.find((candidate) => typeof candidate === 'string' && candidate.trim().length > 0);
  return typeof value === 'string' ? value : undefined;
}

async function sendHttpsRequest(
  requestOptions: https.RequestOptions,
  body: string,
): Promise<{ statusCode: number; raw: string }> {
  const { hostname, port, path, method } = requestOptions;
  const url = new URL(`https://${hostname}${port ? `:${port}` : ''}${path}`);

  return await new Promise((resolve, reject) => {
    const request = https.request(
      {
        hostname: url.hostname,
        port: url.port ? Number(url.port) : undefined,
        path: url.pathname + url.search,
        method,
        headers: requestOptions.headers,
        timeout: requestOptions.timeout,
      },
      (response) => {
        let raw = '';
        response.on('data', (chunk) => (raw += chunk));
        response.on('end', () => resolve({ statusCode: response.statusCode ?? 0, raw }));
      },
    );

    request.on('error', reject);
    request.on('timeout', () => {
      request.destroy(new Error('SubAndGain request timed out'));
    });
    request.write(body);
    request.end();
  });
}
