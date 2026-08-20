import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateDataSubscriptionDto } from './dto/create-data-subscription.dto';
import { DataProvider } from './providers/data.provider';
import { NormalizedProviderResult } from '../providers/provider-result';

@Injectable()
export class DataService {
  constructor(
    private prisma: PrismaService,
    @Inject('DATA_PROVIDER') private provider: DataProvider,
  ) {}

  async purchase(vendorId: string, dto: CreateDataSubscriptionDto) {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId: vendorId } });
    if (!wallet) throw new NotFoundException('Vendor wallet not found');
    if (Number(wallet.balance) < dto.amount) {
      throw new BadRequestException(
        `Insufficient wallet balance. Available: ₦${Number(wallet.balance).toFixed(2)}`,
      );
    }

    const reference = `DATA-${randomUUID()}`;
    let txResult: { dataSubscription: { id: string }; txEntry: { id: string } };
    try {
      txResult = await this.prisma.$transaction(
        async (tx) => {
          const currentWallet = await tx.wallet.findUnique({ where: { id: wallet.id } });
          if (!currentWallet) throw new NotFoundException('Vendor wallet not found');
          if (Number(currentWallet.balance) < dto.amount) {
            throw new BadRequestException('Insufficient wallet balance');
          }

          const balanceBefore = currentWallet.balance;
          const newBalance = Number(balanceBefore) - dto.amount;
          const dataSubscription = await tx.dataSubscription.create({
            data: {
              vendorId,
              network: dto.network,
              phone: dto.phone,
              plan: dto.plan,
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
              description: `Data subscription: ${dto.network} ${dto.plan} to ${dto.phone}`,
            },
          });

          return { dataSubscription, txEntry };
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
      result = await this.provider.purchaseData({
        network: dto.network,
        phone: dto.phone,
        amount: dto.amount,
        plan: dto.plan,
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

    return this.reconcile(txResult.dataSubscription.id, txResult.txEntry.id, wallet.id, dto.amount, result);
  }

  private async reconcile(
    subscriptionId: string,
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
        const claim = await tx.dataSubscription.updateMany({
          where: { id: subscriptionId, status: { in: ['PENDING', 'UNKNOWN'] } },
          data: { status: 'COMPLETED', ...providerData, paidAt: new Date() },
        });
        if (claim.count === 0) return tx.dataSubscription.findUniqueOrThrow({ where: { id: subscriptionId } });
        await tx.walletTransaction.updateMany({
          where: { id: transactionId, status: 'PENDING' },
          data: { status: 'SUCCESS', ...providerData, paidAt: new Date() },
        });
        return tx.dataSubscription.findUniqueOrThrow({ where: { id: subscriptionId } });
      });
    }

    if (result.outcome === 'REJECTED') {
      return this.prisma.$transaction(async (tx) => {
        const claim = await tx.dataSubscription.updateMany({
          where: { id: subscriptionId, status: { in: ['PENDING', 'UNKNOWN'] } },
          data: { status: 'FAILED', ...providerData },
        });
        if (claim.count === 0) return tx.dataSubscription.findUniqueOrThrow({ where: { id: subscriptionId } });
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
            type: 'REFUND',
            amount,
            balanceBefore: currentWallet.balance,
            balanceAfter: refundBalance,
            reference: `DATA-REFUND-${subscriptionId}`,
            status: 'SUCCESS',
            description: `Refund for rejected data subscription ${subscriptionId}`,
          },
        });
        return tx.dataSubscription.findUniqueOrThrow({ where: { id: subscriptionId } });
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const status = result.outcome === 'UNKNOWN' ? 'UNKNOWN' : 'PENDING';
      await tx.dataSubscription.updateMany({
        where: { id: subscriptionId, status: { in: ['PENDING', 'UNKNOWN'] } },
        data: { status, ...providerData },
      });
      await tx.walletTransaction.updateMany({
        where: { id: transactionId, status: 'PENDING' },
        data: providerData,
      });
      return tx.dataSubscription.findUniqueOrThrow({ where: { id: subscriptionId } });
    });
  }

  async getSubscriptions(vendorId: string) {
    const vendor = await this.prisma.user.findUnique({ where: { id: vendorId } });
    if (!vendor) throw new NotFoundException('Vendor not found');
    return this.prisma.dataSubscription.findMany({
      where: { vendorId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getSubscriptionById(vendorId: string, subscriptionId: string) {
    const subscription = await this.prisma.dataSubscription.findUnique({ where: { id: subscriptionId } });
    if (!subscription) throw new NotFoundException('Data subscription not found');
    if (subscription.vendorId !== vendorId) {
      throw new BadRequestException('You do not have access to this subscription');
    }
    return subscription;
  }

  async reconcileByProviderReference(providerReference: string, result: NormalizedProviderResult) {
    const subscription = await this.prisma.dataSubscription.findFirst({
      where: { provider: 'PAIRGATE', providerReference },
    });
    if (!subscription) return null;
    const transaction = await this.prisma.walletTransaction.findUniqueOrThrow({
      where: { reference: subscription.reference },
    });
    return this.reconcile(
      subscription.id,
      transaction.id,
      transaction.walletId,
      Number(subscription.amount),
      result,
    );
  }
}