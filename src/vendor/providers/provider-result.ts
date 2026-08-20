export type ProviderOutcome = 'SUCCESS' | 'REJECTED' | 'PENDING' | 'UNKNOWN';

export type ProviderRetryability = 'RETRYABLE' | 'NOT_RETRYABLE' | 'UNKNOWN';

export interface NormalizedProviderResult {
  outcome: ProviderOutcome;
  providerName: string;
  providerReference?: string;
  providerStatus?: string;
  retryability: ProviderRetryability;
  rawResponse?: unknown;
  message?: string;
}