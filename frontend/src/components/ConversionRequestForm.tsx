import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { conversionApi, ApiError } from '../lib/api';
import { formatNaira } from '../lib/format';
import { Banner, Button, Card, Input, Spinner } from './ui';
import type { ConversionConfig, ConversionRequest, ConversionType } from '../types';

export function ConversionRequestForm({ type }: { type: ConversionType }) {
  const [config, setConfig] = useState<ConversionConfig | null>(null);
  const [amount, setAmount] = useState('');
  const [sourceReference, setSourceReference] = useState('');
  const [sourcePhone, setSourcePhone] = useState('');
  const [result, setResult] = useState<ConversionRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    conversionApi
      .activeConfigs()
      .then((configs) => setConfig(configs.find((item) => item.type === type) ?? null))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Unable to load conversion settings'))
      .finally(() => setLoading(false));
  }, [type]);

  const expectedCredit = useMemo(() => {
    if (!config || !amount || Number.isNaN(Number(amount))) return null;
    return (Number(amount) * Number(config.rate)) / 100;
  }, [amount, config]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setResult(null);
    const numericAmount = Number(amount);
    if (!config) {
      setError('This conversion type is not currently available.');
      return;
    }
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError('Enter a valid amount.');
      return;
    }
    if (numericAmount < Number(config.minimumAmount)) {
      setError(`Minimum amount is ${formatNaira(config.minimumAmount)}.`);
      return;
    }
    if (config.maximumAmount && numericAmount > Number(config.maximumAmount)) {
      setError(`Maximum amount is ${formatNaira(config.maximumAmount)}.`);
      return;
    }

    setSubmitting(true);
    try {
      const created = await conversionApi.createRequest({
        type,
        amount: numericAmount,
        sourceReference: sourceReference.trim(),
        sourcePhone: sourcePhone.trim() || undefined,
      });
      setResult(created);
      setAmount('');
      setSourceReference('');
      setSourcePhone('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to submit conversion request');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Spinner />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">
          {type === 'AIRTIME' ? 'Airtime to Cash' : 'Data to Cash'}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Submit a request for admin review. Your wallet is only credited after approval.
        </p>
      </div>

      {error && <Banner kind="error" message={error} />}
      {result && (
        <Banner
          kind="success"
          message={`Request submitted. Expected credit: ${formatNaira(result.convertedAmount)}. It is pending admin approval.`}
        />
      )}

      <Card className="max-w-xl">
        {!config ? (
          <p className="text-sm text-slate-500">This conversion type is not currently available.</p>
        ) : (
          <>
            <div className="mb-5 grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-4 text-sm">
              <div>
                <p className="text-slate-500">Conversion rate</p>
                <p className="mt-1 font-semibold text-slate-900">{config.rate}%</p>
              </div>
              <div>
                <p className="text-slate-500">Limits</p>
                <p className="mt-1 font-semibold text-slate-900">
                  {formatNaira(config.minimumAmount)} – {config.maximumAmount ? formatNaira(config.maximumAmount) : 'No maximum'}
                </p>
              </div>
            </div>
            <form onSubmit={onSubmit} className="space-y-4">
              <Input
                label="Amount"
                type="number"
                min={config.minimumAmount}
                max={config.maximumAmount ?? undefined}
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0.00"
                required
              />
              <Input
                label="Source transaction reference"
                value={sourceReference}
                onChange={(event) => setSourceReference(event.target.value)}
                placeholder="e.g. transfer reference or receipt number"
                required
              />
              <Input
                label="Source phone number (optional)"
                value={sourcePhone}
                onChange={(event) => setSourcePhone(event.target.value)}
                placeholder="08012345678"
                pattern="^(0[7-9][0-1]\d{8}|[7-9][0-1]\d{8})$"
                title="Enter a valid Nigerian mobile number (e.g., 08012345678)"
              />
              {expectedCredit !== null && (
                <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700">
                  Estimated wallet credit: <strong>{formatNaira(expectedCredit)}</strong>
                </p>
              )}
              <Button type="submit" isLoading={submitting}>
                Submit conversion request
              </Button>
            </form>
          </>
        )}
      </Card>
    </div>
  );
}