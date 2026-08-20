import type {
  AirtimePurchase,
  AuthResponse,
  DataSubscription,
  ConversionConfig,
  ConversionRequest,
  ConversionStatus,
  ConversionType,
  InventorySummary,
  PinBatch,
  PinPurchase,
  ProfitSummary,
  PurchaseResult,
  PurchasedPin,
  SalesLedgerEntry,
  VendorStockItem,
  VendorSummary,
  Wallet,
  WalletTransaction,
} from '../types';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1';
const TOKEN_KEY = 'kc_telecom_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/** Thrown for any non-2xx response, carrying the backend's real error message. */
export class ApiError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });

  // 204/empty responses (none currently exist on this backend, but stay safe)
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;

  if (!res.ok) {
    // Matches AllExceptionsFilter: { success: false, statusCode, message, ... }
    const message = Array.isArray(body?.message)
      ? body.message.join(', ')
      : body?.message ?? `Request failed with status ${res.status}`;
    throw new ApiError(message, res.status);
  }

  return body as T;
}

// ---- auth -------------------------------------------------------------

export interface RegisterPayload {
  email: string;
  phone: string;
  fullName: string;
  businessName?: string;
  password: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export const authApi = {
  register: (payload: RegisterPayload) =>
    request<AuthResponse>('/auth/register', { method: 'POST', body: JSON.stringify(payload) }),
  login: (payload: LoginPayload) =>
    request<AuthResponse>('/auth/login', { method: 'POST', body: JSON.stringify(payload) }),
};

// ---- wallet (vendor) ----------------------------------------------------

export interface InitializePaystackResult {
  reference: string;
  authorizationUrl: string;
  accessCode?: string;
  amount: number;
  currency: string;
}

export interface VerifyPaystackResult {
  wallet: Wallet;
  transaction: WalletTransaction;
  alreadyCredited: boolean;
}

export const walletApi = {
  getWallet: () => request<Wallet>('/wallet'),
  getTransactions: () => request<WalletTransaction[]>('/wallet/transactions'),
  fund: (amount: number, description?: string) =>
    request<WalletTransaction>('/wallet/fund', {
      method: 'POST',
      body: JSON.stringify({ amount, description }),
    }),
  initializePaystack: (amount: number) =>
    request<InitializePaystackResult>('/wallet/paystack/initialize', {
      method: 'POST',
      body: JSON.stringify({ amount }),
    }),
  verifyPaystack: (reference: string) =>
    request<VerifyPaystackResult>(`/wallet/paystack/verify/${encodeURIComponent(reference)}`),
  // ADMIN only — confirms a pending funding transaction by reference
  confirmFunding: (reference: string) =>
    request<{ wallet: Wallet; transaction: WalletTransaction }>(
      `/wallet/fund/${encodeURIComponent(reference)}/confirm`,
      { method: 'POST' },
    ),
};

// ---- vendor pin purchase -------------------------------------------------

export const vendorPinsApi = {
  listStock: () => request<VendorStockItem[]>('/vendor/pins/stock'),
  purchase: (batchId: string, quantity: number) =>
    request<PurchaseResult>('/vendor/pins/purchase', {
      method: 'POST',
      body: JSON.stringify({ batchId, quantity }),
    }),
  myPurchases: () => request<PinPurchase[]>('/vendor/pins/purchases'),
  myPurchasedPins: (purchaseId: string) =>
    request<PurchasedPin[]>(`/vendor/pins/purchases/${encodeURIComponent(purchaseId)}/pins`),
};

// ---- vendor airtime -------------------------------------------------

export interface BuyAirtimePayload {
  network: string;
  phone: string;
  amount: number;
}

export const airtimeApi = {
  purchase: (payload: BuyAirtimePayload) =>
    request<AirtimePurchase>('/vendor/airtime/purchase', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  myPurchases: () => request<AirtimePurchase[]>('/vendor/airtime/purchases'),
};

// ---- vendor data subscription ------------------------------------
export interface BuyDataPayload {
  network: string;
  phone: string;
  plan: string;
  amount: number;
}

export const dataApi = {
  purchase: (payload: BuyDataPayload) =>
    request<DataSubscription>('/vendor/data/purchase', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  history: () => request<DataSubscription[]>('/vendor/data/history'),
};

// ---- conversions -------------------------------------------------------

export interface CreateConversionRequestPayload {
  type: ConversionType;
  amount: number;
  sourceReference: string;
  sourcePhone?: string;
}

export interface UpdateConversionConfigPayload {
  rate: number;
  minimumAmount: number;
  maximumAmount?: number | null;
  isActive?: boolean;
}

export const conversionApi = {
  activeConfigs: () => request<ConversionConfig[]>('/vendor/conversions/config'),
  createRequest: (payload: CreateConversionRequestPayload) =>
    request<ConversionRequest>('/vendor/conversions/requests', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  myRequests: (status?: ConversionStatus) =>
    request<ConversionRequest[]>(
      `/vendor/conversions/requests${status ? `?status=${encodeURIComponent(status)}` : ''}`,
    ),
  adminConfigs: () => request<ConversionConfig[]>('/admin/conversions/config'),
  updateConfig: (type: ConversionType, payload: UpdateConversionConfigPayload) =>
    request<ConversionConfig>(`/admin/conversions/config/${type}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  adminRequests: (filters: { status?: ConversionStatus; type?: ConversionType } = {}) => {
    const params = new URLSearchParams();
    if (filters.status) params.set('status', filters.status);
    if (filters.type) params.set('type', filters.type);
    const query = params.toString();
    return request<ConversionRequest[]>(`/admin/conversions/requests${query ? `?${query}` : ''}`);
  },
  verify: (requestId: string, verificationNote: string) =>
    request<ConversionRequest>(`/admin/conversions/requests/${encodeURIComponent(requestId)}/verify`, {
      method: 'POST',
      body: JSON.stringify({ verificationNote }),
    }),
  approve: (requestId: string) =>
    request<{ request: ConversionRequest; transaction?: WalletTransaction; alreadyCredited: boolean }>(
      `/admin/conversions/requests/${encodeURIComponent(requestId)}/approve`,
      { method: 'POST' },
    ),
  reject: (requestId: string, reason: string) =>
    request<ConversionRequest>(`/admin/conversions/requests/${encodeURIComponent(requestId)}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
};

// ---- admin pin stock -------------------------------------------------

export interface CreateBatchPayload {
  batchLabel: string;
  network: string;
  denomination: number;
  costPrice: number;
  sellingPrice: number;
}

export interface UploadPinsPayload {
  pins: Array<{ serialNumber: string; pinCode: string }>;
}

export const adminPinStockApi = {
  createBatch: (payload: CreateBatchPayload) =>
    request<PinBatch>('/admin/pin-stock/batches', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  uploadPins: (batchId: string, payload: UploadPinsPayload) =>
    request<PinBatch>(`/admin/pin-stock/batches/${encodeURIComponent(batchId)}/pins`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  listBatches: () => request<PinBatch[]>('/admin/pin-stock/batches'),
  getBatch: (batchId: string) => request<PinBatch>(`/admin/pin-stock/batches/${encodeURIComponent(batchId)}`),
  getInventory: () => request<InventorySummary>('/admin/pin-stock/inventory'),
};

// ---- reports -------------------------------------------------

export const reportsApi = {
  salesLedger: () => request<SalesLedgerEntry[]>('/reports/admin/sales'),
  profitSummary: () => request<ProfitSummary>('/reports/admin/profit-summary'),
  vendorSummary: () => request<VendorSummary>('/reports/vendor/summary'),
};
