import { useEffect, useState } from 'react';
import { conversionApi, ApiError } from '../../lib/api';
import { Banner, Button, Card, Input, Spinner } from '../../components/ui';
import type { ConversionConfig, ConversionType } from '../../types';

const TYPES: ConversionType[] = ['AIRTIME', 'DATA'];

type Draft = { rate: string; minimumAmount: string; maximumAmount: string; isActive: boolean };

function emptyDraft(): Draft {
  return { rate: '80', minimumAmount: '50', maximumAmount: '50000', isActive: true };
}

export default function ConversionSettings() {
  const [configs, setConfigs] = useState<Record<ConversionType, Draft>>({
    AIRTIME: emptyDraft(),
    DATA: emptyDraft(),
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<ConversionType | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    conversionApi
      .adminConfigs()
      .then((items) => {
        setConfigs((current) => {
          const next = { ...current };
          items.forEach((item) => {
            next[item.type] = {
              rate: item.rate,
              minimumAmount: item.minimumAmount,
              maximumAmount: item.maximumAmount ?? '',
              isActive: item.isActive,
            };
          });
          return next;
        });
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Unable to load conversion settings'))
      .finally(() => setLoading(false));
  }, []);

  const updateDraft = (type: ConversionType, field: keyof Draft, value: string | boolean) => {
    setConfigs((current) => ({ ...current, [type]: { ...current[type], [field]: value } }));
  };

  const save = async (type: ConversionType) => {
    const draft = configs[type];
    setSaving(type);
    setError(null);
    setMessage(null);
    try {
      await conversionApi.updateConfig(type, {
        rate: Number(draft.rate),
        minimumAmount: Number(draft.minimumAmount),
        maximumAmount: draft.maximumAmount ? Number(draft.maximumAmount) : null,
        isActive: draft.isActive,
      });
      setMessage(`${type === 'AIRTIME' ? 'Airtime' : 'Data'} conversion settings saved.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to save conversion settings');
    } finally {
      setSaving(null);
    }
  };

  if (loading) return <Spinner />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Conversion Settings</h1>
        <p className="mt-1 text-sm text-slate-500">Set rates and limits used when vendors submit conversion requests.</p>
      </div>
      {error && <Banner kind="error" message={error} />}
      {message && <Banner kind="success" message={message} />}
      <div className="grid gap-6 lg:grid-cols-2">
        {TYPES.map((type) => {
          const draft = configs[type];
          return (
            <Card key={type}>
              <h2 className="text-base font-semibold text-slate-900">{type === 'AIRTIME' ? 'Airtime to Cash' : 'Data to Cash'}</h2>
              <div className="mt-4 space-y-4">
                <Input label="Rate (%)" type="number" min="0.01" max="100" step="0.01" value={draft.rate} onChange={(event) => updateDraft(type, 'rate', event.target.value)} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input label="Minimum amount" type="number" min="0.01" step="0.01" value={draft.minimumAmount} onChange={(event) => updateDraft(type, 'minimumAmount', event.target.value)} />
                  <Input label="Maximum amount (optional)" type="number" min="0" step="0.01" value={draft.maximumAmount} onChange={(event) => updateDraft(type, 'maximumAmount', event.target.value)} />
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={draft.isActive} onChange={(event) => updateDraft(type, 'isActive', event.target.checked)} />
                  Allow new requests
                </label>
                <Button type="button" isLoading={saving === type} onClick={() => save(type)}>
                  Save {type === 'AIRTIME' ? 'airtime' : 'data'} settings
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}