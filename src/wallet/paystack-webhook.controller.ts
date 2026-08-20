import {
  Controller,
  Headers,
  Post,
  RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { WalletService } from './wallet.service';

interface PaystackWebhookEvent {
  event?: string;
  data?: {
    reference?: string;
  };
}

@Controller('paystack')
export class PaystackWebhookController {
  constructor(
    private readonly walletService: WalletService,
    private readonly config: ConfigService,
  ) {}

  @Post('webhook')
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-paystack-signature') signature?: string,
  ) {
    const secretKey = this.config.get<string>('PAYSTACK_SECRET_KEY') ?? '';

    if (!secretKey || !signature || !req.rawBody) {
      throw new UnauthorizedException('Invalid Paystack webhook signature');
    }

    const expected = createHmac('sha512', secretKey)
      .update(req.rawBody)
      .digest('hex');

    const suppliedBuffer = Buffer.from(signature, 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');

    if (
      suppliedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(suppliedBuffer, expectedBuffer)
    ) {
      throw new UnauthorizedException('Invalid Paystack webhook signature');
    }

    const payload = req.body as PaystackWebhookEvent;

    if (payload.event !== 'charge.success') {
      return { received: true, ignored: true };
    }

    const reference = payload.data?.reference;

    if (!reference) {
      return { received: true, ignored: true };
    }

    // Reuse the existing Paystack verification + idempotent wallet-credit flow.
    await this.walletService.verifyPaystackFunding(reference);

    return { received: true };
  }
}
