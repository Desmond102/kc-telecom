import { Module } from '@nestjs/common';
import { DataController } from './data.controller';
import { DataService } from './data.service';
import { HttpVtuProvider } from '../airtime/providers/http-vtu.provider';
import { PairgateProvider } from '../airtime/providers/pairgate.provider';

@Module({
  controllers: [DataController],
  providers: [
    DataService,
    {
      provide: 'DATA_PROVIDER',
      useFactory: () => {
        if ((process.env.AIRTIME_DATA_PROVIDER ?? 'HTTP').toUpperCase() === 'PAIRGATE') {
          return new PairgateProvider({
            baseUrl: process.env.PAIRGATE_BASE_URL ?? '',
            apiKey: process.env.PAIRGATE_API_KEY ?? '',
            timeoutMs: Number(process.env.PAIRGATE_TIMEOUT_MS ?? 10000),
            dataPlanMap: parsePairgatePlanMap(),
          });
        }
        const name = process.env.VTU_PROVIDER_NAME ?? 'HTTP';
        return new HttpVtuProvider({
          baseUrl: process.env.VTU_BASE_URL ?? '',
          apiKey: process.env.VTU_API_KEY ?? '',
          timeoutMs: Number(process.env.VTU_TIMEOUT_MS ?? 10000),
          name,
        });
      },
    },
  ],
  exports: [DataService],
})
export class DataModule {}

function parsePairgatePlanMap(): Record<string, string> {
  const raw = process.env.PAIRGATE_DATA_PLAN_MAP ?? '{}';
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('PAIRGATE_DATA_PLAN_MAP must be a JSON object');
  }
  return Object.fromEntries(
    Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}
