import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { BuyAirtimeDto } from './dto/buy-airtime.dto';
import { AirtimeProvider } from './providers/airtime.provider';
import { NormalizedProviderResult } from '../providers/provider-result';

@Injectable()
export class AirtimeService {
  constructor(
    private prisma: PrismaService,
    @Inject('AIRTIME_PROVIDER') private provider: AirtimeProvider,
  ) {}

  async purchase(vendorId: string, dto: BuyAirtimeDto) {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId: vendorId } });
    if (!wallet) throw new NotFoundException('Wallet not found');
    if (Number(wallet.balance) < dto.amount) {
      throw new BadRequestException(
        `Insufficient wallet balance. Available: ₦${Number(wallet.balance).toFixed(2)}`,
      );
    }

    const reference = `AIR-${randomUUID()}`;
    let txResult: { airtimePurchase: { id: string }; txEntry: { id: string } };
    try {
      txResult = await this.prisma.$transaction(
        async (tx) => {
          const currentWallet = await tx.wallet.findUnique({ where: { id: wallet.id } });
          if (!currentWallet) throw new NotFoundException('Wallet not found');
          if (Number(currentWallet.balance) < dto.amount) {
            throw new BadRequestException('Insufficient wallet balance');
          }

          const balanceBefore = currentWallet.balance;
          const newBalance = Number(balanceBefore) - dto.amount;
          const airtimePurchase = await tx.airtimePurchase.create({
            data: {
              vendorId,
              network: dto.network,
              phone: dto.phone,
              amount: dto.amount,
              reference,
              status: 'PENDING',
            },
          });

          await tx.wallet.update({
            where: { id: wallet.id },
            data: { balance: { decrement: dto.amount } },
          });

          const txEntry = await tx.walletTransaction.create({
            data: {
              walletId: wallet.id,
              type: 'DEBIT',
              amount: dto.amount,
              balanceBefore,
              balanceAfter: newBalance,
              reference,
              status: 'PENDING',
              description: `Airtime purchase — ${dto.network} ₦${dto.amount} → ${dto.phone}`,
            },
          });

          return { airtimePurchase, txEntry };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error: any) {
      if (error?.code === 'P2034') {
        throw new ConflictException('Wallet is busy processing another purchase, please retry');
      }
      throw error;
    }

    let result: NormalizedProviderResult;
    try {
      result = await this.provider.purchaseAirtime({
        network: dto.network,
        phone: dto.phone,
        amount: dto.amount,
        reference,
      });
    } catch (error) {
      result = {
        outcome: 'UNKNOWN',
        providerName: this.provider.name,
        retryability: 'UNKNOWN',
        message: error instanceof Error ? error.message : String(error),
      };
    }

    return this.reconcile(txResult.airtimePurchase.id, txResult.txEntry.id, wallet.id, dto.amount, result);
  }

  private async reconcile(
    purchaseId: string,
    transactionId: string,
    walletId: string,
    amount: number,
    result: NormalizedProviderResult,
  ) {
    const providerData = {
      provider: result.providerName,
      providerReference: result.providerReference,
      providerStatus: result.providerStatus,
      providerOutcome: result.outcome,
      providerRetryability: result.retryability,
      providerResponse: result.rawResponse as Prisma.InputJsonValue,
    };

    if (result.outcome === 'SUCCESS') {
      return this.prisma.$transaction(async (tx) => {
        const claim = await tx.airtimePurchase.updateMany({
          where: { id: purchaseId, status: { in: ['PENDING', 'UNKNOWN'] } },
          data: { status: 'COMPLETED', ...providerData, paidAt: new Date() },
        });
        if (claim.count === 0) return tx.airtimePurchase.findUniqueOrThrow({ where: { id: purchaseId } });
        await tx.walletTransaction.updateMany({
          where: { id: transactionId, status: 'PENDING' },
          data: { status: 'SUCCESS', ...providerData, paidAt: new Date() },
        });
        return tx.airtimePurchase.findUniqueOrThrow({ where: { id: purchaseId } });
      });
    }

    if (result.outcome === 'REJECTED') {
      return this.prisma.$transaction(async (tx) => {
        const claim = await tx.airtimePurchase.updateMany({
          where: { id: purchaseId, status: { in: ['PENDING', 'UNKNOWN'] } },
          data: { status: 'FAILED', ...providerData },
        });
        if (claim.count === 0) return tx.airtimePurchase.findUniqueOrThrow({ where: { id: purchaseId } });
        await tx.walletTransaction.updateMany({
          where: { id: transactionId, status: 'PENDING' },
          data: { status: 'FAILED', ...providerData },
        });

        const currentWallet = await tx.wallet.findUniqueOrThrow({ where: { id: walletId } });
        const refundBalance = Number(currentWallet.balance) + amount;
        await tx.wallet.update({ where: { id: walletId }, data: { balance: { increment: amount } } });
        await tx.walletTransaction.create({
          data: {
            walletId,
            type: 'CREDIT',
            amount,
            balanceBefore: currentWallet.balance,
            balanceAfter: refundBalance,
            reference: `AIR-REFUND-${purchaseId}`,
            status: 'SUCCESS',
            description: `Refund for rejected airtime purchase ${purchaseId}`,
          },
        });
        return tx.airtimePurchase.findUniqueOrThrow({ where: { id: purchaseId } });
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const status = result.outcome === 'UNKNOWN' ? 'UNKNOWN' : 'PENDING';
      await tx.airtimePurchase.updateMany({
        where: { id: purchaseId, status: { in: ['PENDING', 'UNKNOWN'] } },
        data: { status, ...providerData },
      });
      await tx.walletTransaction.updateMany({
        where: { id: transactionId, status: 'PENDING' },
        data: providerData,
      });
      return tx.airtimePurchase.findUniqueOrThrow({ where: { id: purchaseId } });
    });
  }

  myPurchases(vendorId: string) {
    return this.prisma.airtimePurchase.findMany({
      where: { vendorId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async reconcileByProviderReference(providerReference: string, result: NormalizedProviderResult) {
    const purchase = await this.prisma.airtimePurchase.findFirst({
      where: { provider: 'PAIRGATE', providerReference },
    });
    if (!purchase) return null;
    const transaction = await this.prisma.walletTransaction.findUniqueOrThrow({
      where: { reference: purchase.reference },
    });
    return this.reconcile(purchase.id, transaction.id, transaction.walletId, Number(purchase.amount), result);
  }
}