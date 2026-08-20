import { useEffect, useState } from 'react';
import { conversionApi, ApiError } from '../../lib/api';
import { formatDate, formatNaira } from '../../lib/format';
import { Badge, Banner, Card, EmptyState, Spinner } from '../../components/ui';
import type { ConversionRequest } from '../../types';

function statusTone(status: ConversionRequest['status']): 'slate' | 'green' | 'amber' | 'red' {
  if (status === 'CREDITED' || status === 'COMPLETED') return 'green';
  if (status === 'REJECTED') return 'red';
  if (status === 'PENDING') return 'amber';
  return 'slate';
}

export default function ConversionHistory() {
  const [requests, setRequests] = useState<ConversionRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    conversionApi
      .myRequests()
      .then(setRequests)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Unable to load conversion history'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Conversion History</h1>
        <p className="mt-1 text-sm text-slate-500">Track your Airtime to Cash and Data to Cash requests.</p>
      </div>
      {error && <Banner kind="error" message={error} />}
      <Card>
        {requests.length === 0 ? (
          <EmptyState message="No conversion requests yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
                  <th className="py-2 pr-4">Date</th>
                  <th className="py-2 pr-4">Type</th>
                  <th className="py-2 pr-4">Amount</th>
                  <th className="py-2 pr-4">Expected credit</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Reference</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => (
                  <tr key={request.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-3 pr-4 text-slate-600">{formatDate(request.createdAt)}</td>
                    <td className="py-3 pr-4 font-medium text-slate-900">{request.type === 'AIRTIME' ? 'Airtime' : 'Data'}</td>
                    <td className="py-3 pr-4 text-slate-600">{formatNaira(request.amount)}</td>
                    <td className="py-3 pr-4 text-slate-600">{formatNaira(request.convertedAmount)}</td>
                    <td className="py-3 pr-4">
                      <Badge tone={statusTone(request.status)}>{request.status}</Badge>
                      {request.rejectionReason && <p className="mt-1 max-w-xs text-xs text-red-600">{request.rejectionReason}</p>}
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs text-slate-400">{request.reference}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}