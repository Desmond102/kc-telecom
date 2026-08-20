import { useEffect, useState } from 'react';
import { conversionApi, ApiError } from '../../lib/api';
import { formatDate, formatNaira } from '../../lib/format';
import { Badge, Banner, Button, Card, EmptyState, Select, Spinner } from '../../components/ui';
import type { ConversionRequest, ConversionStatus, ConversionType } from '../../types';

function statusTone(status: ConversionStatus): 'slate' | 'green' | 'amber' | 'red' {
  if (status === 'APPROVED' || status === 'CREDITED' || status === 'COMPLETED') return 'green';
  if (status === 'REJECTED') return 'red';
  if (status === 'PENDING') return 'amber';
  return 'slate';
}

export default function ConversionRequests() {
  const [requests, setRequests] = useState<ConversionRequest[]>([]);
  const [status, setStatus] = useState<ConversionStatus | ''>('');
  const [type, setType] = useState<ConversionType | ''>('');
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [verificationNotes, setVerificationNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    conversionApi
      .adminRequests({ status: status || undefined, type: type || undefined })
      .then(setRequests)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Unable to load conversion requests'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [status, type]);

  const verify = async (requestId: string) => {
    const verificationNote = verificationNotes[requestId]?.trim() ?? '';
    if (!verificationNote) {
      setError('Enter a verification note before verifying a request.');
      return;
    }
    setError(null);
    setWorkingId(requestId);
    try {
      await conversionApi.verify(requestId, verificationNote);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to verify request');
    } finally {
      setWorkingId(null);
    }
  };

  const approve = async (requestId: string) => {
    setError(null);
    setWorkingId(requestId);
    try {
      await conversionApi.approve(requestId);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to credit request');
    } finally {
      setWorkingId(null);
    }
  };

  const reject = async (requestId: string) => {
    const reason = reasons[requestId]?.trim() ?? '';
    if (!reason) {
      setError('Enter a rejection reason before rejecting a request.');
      return;
    }
    setError(null);
    setWorkingId(requestId);
    try {
      await conversionApi.reject(requestId, reason);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to reject request');
    } finally {
      setWorkingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Conversion Requests</h1>
        <p className="mt-1 text-sm text-slate-500">Review vendor requests and credit wallets only after approval.</p>
      </div>
      {error && <Banner kind="error" message={error} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Status" value={status} onChange={(event) => setStatus(event.target.value as ConversionStatus | '')}>
          <option value="">All statuses</option>
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Verified</option>
          <option value="CREDITED">Credited</option>
          <option value="REJECTED">Rejected</option>
        </Select>
        <Select label="Type" value={type} onChange={(event) => setType(event.target.value as ConversionType | '')}>
          <option value="">All types</option>
          <option value="AIRTIME">Airtime</option>
          <option value="DATA">Data</option>
        </Select>
      </div>
      {loading ? (
        <Spinner />
      ) : (
        <Card>
          {requests.length === 0 ? (
            <EmptyState message="No matching conversion requests." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
                    <th className="py-2 pr-4">Date</th>
                    <th className="py-2 pr-4">Vendor</th>
                    <th className="py-2 pr-4">Type</th>
                    <th className="py-2 pr-4">Amount</th>
                    <th className="py-2 pr-4">Credit</th>
                    <th className="py-2 pr-4">Source</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((request) => (
                    <tr key={request.id} className="border-b border-slate-100 align-top last:border-0">
                      <td className="py-3 pr-4 text-slate-600">{formatDate(request.createdAt)}</td>
                      <td className="py-3 pr-4 text-slate-700">
                        {request.user?.businessName || request.user?.fullName || 'Vendor'}
                        <div className="text-xs text-slate-400">{request.user?.email}</div>
                      </td>
                      <td className="py-3 pr-4 font-medium">{request.type === 'AIRTIME' ? 'Airtime' : 'Data'}</td>
                      <td className="py-3 pr-4">{formatNaira(request.amount)}</td>
                      <td className="py-3 pr-4 font-medium text-green-700">{formatNaira(request.convertedAmount)}</td>
                      <td className="py-3 pr-4 text-slate-600">{request.sourceReference || 'Not provided'}</td>
                      <td className="py-3 pr-4">
                        <Badge tone={statusTone(request.status)}>{request.status}</Badge>
                        {request.verificationNote && <p className="mt-1 max-w-xs text-xs text-slate-600">{request.verificationNote}</p>}
                        {request.rejectionReason && <p className="mt-1 max-w-xs text-xs text-red-600">{request.rejectionReason}</p>}
                      </td>
                      <td className="py-3 pr-4">
                        {request.status === 'PENDING' || request.status === 'APPROVED' ? (
                          <div className="flex min-w-[220px] flex-col gap-2">
                            {request.status === 'PENDING' && (
                              <input
                                className="rounded-lg border border-slate-300 px-3 py-2 text-xs"
                                placeholder="Verification note"
                                value={verificationNotes[request.id] ?? ''}
                                onChange={(event) => setVerificationNotes((current) => ({ ...current, [request.id]: event.target.value }))}
                              />
                            )}
                            <input
                              className="rounded-lg border border-slate-300 px-3 py-2 text-xs"
                              placeholder="Reason if rejecting"
                              value={reasons[request.id] ?? ''}
                              onChange={(event) => setReasons((current) => ({ ...current, [request.id]: event.target.value }))}
                            />
                            <div className="flex gap-2">
                              {request.status === 'PENDING' ? (
                                <Button type="button" className="px-3 py-1.5 text-xs" isLoading={workingId === request.id} onClick={() => verify(request.id)}>
                                  Verify
                                </Button>
                              ) : (
                                <Button type="button" className="px-3 py-1.5 text-xs" isLoading={workingId === request.id} onClick={() => approve(request.id)}>
                                  Credit
                                </Button>
                              )}
                              <Button type="button" variant="danger" className="px-3 py-1.5 text-xs" isLoading={workingId === request.id} onClick={() => reject(request.id)}>
                                Reject
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">No action</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}