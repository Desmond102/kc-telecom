import { Module } from '@nestjs/common';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';
import { PaystackService } from './paystack.service';
import { PaystackWebhookController } from './paystack-webhook.controller';

@Module({
  controllers: [WalletController, PaystackWebhookController],
  providers: [WalletService, PaystackService],
  exports: [WalletService],
})
export class WalletModule {}
