import { Module } from '@nestjs/common';
import { AirtimeModule } from '../airtime/airtime.module';
import { DataModule } from '../data/data.module';
import { PairgateWebhookController } from './pairgate-webhook.controller';

@Module({
  imports: [AirtimeModule, DataModule],
  controllers: [PairgateWebhookController],
})
export class PairgateModule {}
