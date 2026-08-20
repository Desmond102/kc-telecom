import { NormalizedProviderResult } from '../../providers/provider-result';

export interface AirtimePurchaseParams {
  network: string;
  phone: string;
  amount: number;
  reference: string;
}

export interface AirtimeProvider {
  name: string;
  purchaseAirtime(params: AirtimePurchaseParams): Promise<NormalizedProviderResult>;
}