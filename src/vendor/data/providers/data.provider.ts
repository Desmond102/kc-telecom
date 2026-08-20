import { NormalizedProviderResult } from '../../providers/provider-result';

export interface DataPurchaseParams {
  network: string;
  phone: string;
  amount: number;
  plan: string;
  reference: string;
}

export interface DataProvider {
  name: string;
  purchaseData(params: DataPurchaseParams): Promise<NormalizedProviderResult>;
  getDataTransactionStatus?(reference: string): Promise<NormalizedProviderResult>;
  getTransactionStatus?(reference: string): Promise<NormalizedProviderResult>;
  getActiveDataPlans?(): Promise<Array<{ dataPlanId: string; name?: string; network?: string; status?: string }>>;
}