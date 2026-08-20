import { Controller, Headers, NotFoundException, Post, RawBodyRequest, Req, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { AirtimeService } from '../airtime/airtime.service';
import { DataService } from '../data/data.service';
import { NormalizedProviderResult } from '../providers/provider-result';

interface PairgateWebhookPayload {
  event?: string;
  reference_code?: string;
  status?: string;
  message?: string;
}

@Controller('pairgate')
export class PairgateWebhookController {
  constructor(
    private readonly config: ConfigService,
    private readonly airtime: AirtimeService,
    private readonly data: DataService,
  ) {}

  @Post('webhook')
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-pairgate-timestamp') timestamp?: string,
    @Headers('x-pairgate-signature') signature?: string,
  ) {
    const secret = this.config.get<string>('PAIRGATE_WEBHOOK_SECRET') ?? '';
    if (!secret || !timestamp || !signature || !req.rawBody) {
      throw new UnauthorizedException('Invalid Pairgate webhook signature');
    }

    const timestampSeconds = Number(timestamp);
    if (!Number.isFinite(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > 300) {
      throw new UnauthorizedException('Expired Pairgate webhook');
    }

    const expected = createHmac('sha256', secret)
      .update(`${timestamp}.${req.rawBody.toString('utf8')}`)
      .digest('hex');
    const supplied = Buffer.from(signature, 'utf8');
    const calculated = Buffer.from(expected, 'utf8');
    if (supplied.length !== calculated.length || !timingSafeEqual(supplied, calculated)) {
      throw new UnauthorizedException('Invalid Pairgate webhook signature');
    }

    const payload = req.body as PairgateWebhookPayload;
    if (!payload.reference_code || !payload.event) return { received: true, ignored: true };

    const result = this.normalize(payload);
    const isData = payload.event === 'data.purchase';
    const isAirtime = payload.event === 'airtime.purchase';
    if (!isData && !isAirtime) return { received: true, ignored: true };

    const reconciled = isData
      ? await this.data.reconcileByProviderReference(payload.reference_code, result)
      : await this.airtime.reconcileByProviderReference(payload.reference_code, result);

    if (!reconciled) throw new NotFoundException('Pairgate transaction is not yet available for reconciliation');
    return { received: true, reconciled: true };
  }

  private normalize(payload: PairgateWebhookPayload): NormalizedProviderResult {
    const status = payload.status?.toLowerCase();
    if (status === 'successful') {
      return {
        outcome: 'SUCCESS',
        providerName: 'PAIRGATE',
        providerReference: payload.reference_code,
        providerStatus: payload.status,
        retryability: 'NOT_RETRYABLE',
        rawResponse: payload,
        message: payload.message,
      };
    }
    if (status === 'failed') {
      return {
        outcome: 'REJECTED',
        providerName: 'PAIRGATE',
        providerReference: payload.reference_code,
        providerStatus: payload.status,
        retryability: 'NOT_RETRYABLE',
        rawResponse: payload,
        message: payload.message,
      };
    }
    if (status === 'processing' || status === 'pending') {
      return {
        outcome: 'PENDING',
        providerName: 'PAIRGATE',
        providerReference: payload.reference_code,
        providerStatus: payload.status,
        retryability: 'RETRYABLE',
        rawResponse: payload,
        message: payload.message,
      };
    }
    return {
      outcome: 'UNKNOWN',
      providerName: 'PAIRGATE',
      providerReference: payload.reference_code,
      providerStatus: payload.status,
      retryability: 'UNKNOWN',
      rawResponse: payload,
      message: payload.message,
    };
  }
}
