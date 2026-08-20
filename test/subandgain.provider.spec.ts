import { strict as assert } from 'assert';
import { RequestOptions } from 'https';
import { SubAndGainProvider } from '../src/vendor/subandgain/subandgain.provider';

type Stub = (options: RequestOptions, body: string) => Promise<{ statusCode: number; raw: string }>;

function provider(response: { statusCode: number; raw: string } | Error): { client: SubAndGainProvider; requests: Array<{ options: RequestOptions; body: string }> } {
  const requests: Array<{ options: RequestOptions; body: string }> = [];
  const requestHandler: Stub = async (options, body) => {
    requests.push({ options, body });
    if (response instanceof Error) throw response;
    return response;
  };
  return {
    client: new SubAndGainProvider({
      baseUrl: 'https://stub.subandgain.local',
      username: 'stub-user',
      apiKey: 'stub-key',
      requestHandler,
    }),
    requests,
  };
}

async function main() {
  for (const [status, outcome] of [['Approved', 'SUCCESS'], ['Pending', 'PENDING'], ['Cancelled', 'REJECTED']] as const) {
    const { client, requests } = provider({
      statusCode: 200,
      raw: JSON.stringify({ status, transactionId: 'provider-tx-1' }),
    });
    const result = await client.purchaseAirtime({ network: 'NINE_MOBILE', phone: '08012345678', amount: 100, reference: 'AIR-stub' });
    assert.equal(result.outcome, outcome);
    assert.equal(result.providerReference, 'provider-tx-1');
    assert.equal(requests[0].options.method, 'GET');
    assert.equal(requests[0].options.path, '/api/airtime.php?username=stub-user&apiKey=stub-key&network=9MOBILE&phoneNumber=08012345678&amount=100');
    assert.equal(requests[0].body, '');
  }

  const timeout = provider(new Error('stub timeout'));
  assert.equal((await timeout.client.purchaseAirtime({ network: 'MTN', phone: '08012345678', amount: 100, reference: 'AIR-timeout' })).outcome, 'UNKNOWN');

  const malformed = provider({ statusCode: 200, raw: 'not-json' });
  assert.equal((await malformed.client.purchaseAirtime({ network: 'MTN', phone: '08012345678', amount: 100, reference: 'AIR-malformed' })).outcome, 'UNKNOWN');

  const query = provider({ statusCode: 200, raw: JSON.stringify({ status: 'Approved', id: 'query-tx-1' }) });
  const queryResult = await query.client.getAirtimeTransactionStatus('AIR-uncertain');
  assert.equal(query.requests[0].options.path, '/api/query_airtime.php?username=stub-user&apiKey=stub-key&trans_id=AIR-uncertain');
  assert.equal(query.requests[0].body, '');
  assert.equal(queryResult.outcome, 'SUCCESS');
  assert.equal(queryResult.providerReference, 'query-tx-1');

  const dataQuery = provider({ statusCode: 200, raw: JSON.stringify({ status: 'Approved', transactionId: 'data-query-tx-1' }) });
  const dataQueryResult = await dataQuery.client.getDataTransactionStatus('DATA-uncertain');
  assert.equal(dataQuery.requests[0].options.path, '/api/query_data.php');
  assert.equal(JSON.parse(dataQuery.requests[0].body).reference, 'DATA-uncertain');
  assert.equal(dataQueryResult.outcome, 'SUCCESS');
  assert.equal(dataQueryResult.providerReference, 'data-query-tx-1');

  const plans = provider({
    statusCode: 200,
    raw: JSON.stringify({ data: [
      { dataPlanId: 'mtn-active', name: 'Active plan', status: 'Active' },
      { dataPlanId: 'mtn-inactive', name: 'Inactive plan', status: 'Inactive' },
      { dataPlanId: 'glo-active', name: 'Boolean active', isActive: true },
    ] }),
  });
  const activePlans = await plans.client.getActiveDataPlans();
  assert.deepEqual(activePlans.map((plan) => plan.dataPlanId), ['mtn-active', 'glo-active']);
  assert.equal(plans.requests[0].options.method, 'GET');
  assert.equal(plans.requests[0].options.path, '/api/databundles.php?username=stub-user&apiKey=stub-key');
  assert.equal(plans.requests[0].body, '');

  const balance = provider({
    statusCode: 200,
    raw: JSON.stringify({ status: 'successful', balance: 62.5 }),
  });
  const balanceResult = await balance.client.getWalletBalance();
  assert.equal(balanceResult.outcome, 'SUCCESS');
  assert.equal(balance.requests[0].options.method, 'GET');
  assert.equal(balance.requests[0].options.path, '/api/balance.php?username=stub-user&apiKey=stub-key');
  assert.equal(balance.requests[0].body, '');

  const data = provider({ statusCode: 200, raw: JSON.stringify({ status: 'Pending', reference: 'data-tx-1' }) });
  const dataResult = await data.client.purchaseData({ network: 'MTN', phone: '08012345678', amount: 500, plan: 'provider-plan-42', reference: 'DATA-stub' });
  assert.equal(dataResult.outcome, 'PENDING');
  const dataBody = JSON.parse(data.requests[0].body);
  assert.equal(dataBody.dataPlan, 'provider-plan-42');
  assert.equal(data.requests[0].options.path, '/data/purchase');

  console.log('SubAndGain stub tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});