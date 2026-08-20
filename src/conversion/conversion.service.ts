import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ConversionStatus,
  ConversionType,
  Prisma,
  WalletTxStatus,
  WalletTxType,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateConversionRequestDto } from './dto/create-conversion-request.dto';
import { ListConversionRequestsDto } from './dto/list-conversion-requests.dto';
import { RejectConversionRequestDto } from './dto/reject-conversion-request.dto';
import { UpdateConversionConfigDto } from './dto/update-conversion-config.dto';
import { VerifyConversionRequestDto } from './dto/verify-conversion-request.dto';

const requestInclude = {
  config: true,
  user: {
    select: {
      id: true,
      fullName: true,
      businessName: true,
      email: true,
      phone: true,
    },
  },
  walletTransaction: true,
} satisfies Prisma.ConversionRequestInclude;

@Injectable()
export class ConversionService {
  constructor(private readonly prisma: PrismaService) {}

  async listActiveConfigs() {
    return this.prisma.conversionConfig.findMany({
      where: { isActive: true },
      orderBy: { type: 'asc' },
    });
  }

  async listConfigs() {
    return this.prisma.conversionConfig.findMany({
      orderBy: { type: 'asc' },
    });
  }

  async updateConfig(type: ConversionType, dto: UpdateConversionConfigDto) {
    this.assertType(type);

    const rate = this.decimal(dto.rate);
    const minimumAmount = this.decimal(dto.minimumAmount);
    const maximumAmount =
      dto.maximumAmount === undefined || dto.maximumAmount === null
        ? null
        : this.decimal(dto.maximumAmount);

    if (maximumAmount && maximumAmount.lessThan(minimumAmount)) {
      throw new BadRequestException('maximumAmount must be greater than or equal to minimumAmount');
    }

    return this.prisma.conversionConfig.upsert({
      where: { type },
      create: {
        type,
        rate,
        minimumAmount,
        maximumAmount,
        isActive: dto.isActive ?? true,
      },
      update: {
        rate,
        minimumAmount,
        maximumAmount,
        ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }),
      },
    });
  }

  async createRequest(userId: string, dto: CreateConversionRequestDto) {
    const sourceReference = dto.sourceReference.trim();
    if (!sourceReference) throw new BadRequestException('Source reference is required');

    const config = await this.prisma.conversionConfig.findUnique({
      where: { type: dto.type },
    });

    if (!config || !config.isActive) {
      throw new BadRequestException('Conversion for this type is not currently available');
    }

    const amount = this.decimal(dto.amount);
    if (amount.lessThan(config.minimumAmount)) {
      throw new BadRequestException(`Minimum conversion amount is ₦${config.minimumAmount.toFixed(2)}`);
    }
    if (config.maximumAmount && amount.greaterThan(config.maximumAmount)) {
      throw new BadRequestException(`Maximum conversion amount is ₦${config.maximumAmount.toFixed(2)}`);
    }

    const expectedCredit = amount.mul(config.rate).div(100).toDecimalPlaces(2);
    return this.prisma.conversionRequest.create({
      data: {
        userId,
        configId: config.id,
        type: dto.type,
        amount,
        rate: config.rate,
        convertedAmount: expectedCredit,
        reference: `CONVERSION-${randomUUID()}`,
        sourceReference,
        sourcePhone: dto.sourcePhone?.trim() || null,
      },
      include: requestInclude,
    });
  }

  async listVendorRequests(userId: string, filters: ListConversionRequestsDto) {
    return this.prisma.conversionRequest.findMany({
      where: {
        userId,
        ...(filters.type ? { type: filters.type } : {}),
        ...(filters.status ? { status: filters.status } : {}),
      },
      include: requestInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  async listAdminRequests(filters: ListConversionRequestsDto) {
    return this.prisma.conversionRequest.findMany({
      where: {
        ...(filters.type ? { type: filters.type } : {}),
        ...(filters.status ? { status: filters.status } : {}),
      },
      include: requestInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  async approveRequest(requestId: string) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const request = await tx.conversionRequest.findUnique({
              where: { id: requestId },
              include: {
                config: true,
                user: { include: { wallet: true } },
                walletTransaction: true,
              },
            });

            if (!request) throw new NotFoundException('Conversion request not found');
            if (request.status === ConversionStatus.CREDITED) {
              return { request, alreadyCredited: true };
            }
            if (request.status === ConversionStatus.REJECTED) {
              throw new ConflictException('Rejected conversion requests cannot be approved');
            }
            if (request.status !== ConversionStatus.APPROVED) {
              throw new ConflictException('Conversion request must be verified before approval');
            }

            const reference = `CONVERSION-CREDIT-${request.id}`;
            const existingCredit = await tx.walletTransaction.findUnique({
              where: { reference },
            });

            if (existingCredit) {
              if (
                existingCredit.type !== WalletTxType.CREDIT ||
                existingCredit.status !== WalletTxStatus.SUCCESS
              ) {
                throw new ConflictException('Conversion credit ledger entry is not successful');
              }

              const creditedRequest = await tx.conversionRequest.update({
                where: { id: request.id },
                data: {
                  status: ConversionStatus.CREDITED,
                  walletTransactionId: existingCredit.id,
                  processedAt: existingCredit.creditedAt ?? new Date(),
                },
                include: requestInclude,
              });
              return { request: creditedRequest, transaction: existingCredit, alreadyCredited: true };
            }

            const wallet = request.user.wallet;
            if (!wallet) throw new NotFoundException('Vendor wallet not found');

            const balanceBefore = new Prisma.Decimal(wallet.balance);
            const balanceAfter = balanceBefore.add(request.convertedAmount);

            const transaction = await tx.walletTransaction.create({
              data: {
                walletId: wallet.id,
                type: WalletTxType.CREDIT,
                amount: request.convertedAmount,
                balanceBefore,
                balanceAfter,
                reference,
                status: WalletTxStatus.SUCCESS,
                description: `Conversion credit for ${request.type.toLowerCase()} request ${request.reference}`,
                creditedAt: new Date(),
              },
            });

            await tx.wallet.update({
              where: { id: wallet.id },
              data: { balance: balanceAfter },
            });

            const creditedRequest = await tx.conversionRequest.update({
              where: { id: request.id },
              data: {
                status: ConversionStatus.CREDITED,
                walletTransactionId: transaction.id,
                processedAt: transaction.creditedAt,
              },
              include: requestInclude,
            });

            return { request: creditedRequest, transaction, alreadyCredited: false };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === 'P2034' || error.code === 'P2002') &&
          attempt < 2
        ) {
          continue;
        }
        throw error;
      }
    }

    throw new ConflictException('Conversion approval could not be completed safely; please retry');
  }

  async verifyRequest(requestId: string, adminId: string, dto: VerifyConversionRequestDto) {
    const verificationNote = dto.verificationNote.trim();
    if (!verificationNote) throw new BadRequestException('Verification note is required');

    const claimed = await this.prisma.conversionRequest.updateMany({
      where: { id: requestId, status: ConversionStatus.PENDING },
      data: {
        status: ConversionStatus.APPROVED,
        verificationNote,
        verifiedById: adminId,
        verifiedAt: new Date(),
      },
    });

    if (claimed.count === 0) {
      const request = await this.prisma.conversionRequest.findUnique({ where: { id: requestId } });
      if (!request) throw new NotFoundException('Conversion request not found');
      if (request.status === ConversionStatus.APPROVED) {
        return this.prisma.conversionRequest.findUniqueOrThrow({
          where: { id: requestId },
          include: requestInclude,
        });
      }
      throw new ConflictException(`Conversion request cannot be verified from ${request.status} status`);
    }

    return this.prisma.conversionRequest.findUniqueOrThrow({
      where: { id: requestId },
      include: requestInclude,
    });
  }

  async rejectRequest(requestId: string, dto: RejectConversionRequestDto) {
    const reason = dto.reason.trim();
    if (!reason) throw new BadRequestException('Rejection reason is required');

    const request = await this.prisma.conversionRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) throw new NotFoundException('Conversion request not found');
    if (request.status === ConversionStatus.CREDITED) {
      throw new ConflictException('Credited conversion requests cannot be rejected');
    }
    if (request.status === ConversionStatus.REJECTED) {
      return this.prisma.conversionRequest.findUniqueOrThrow({
        where: { id: requestId },
        include: requestInclude,
      });
    }
    if (request.status !== ConversionStatus.PENDING && request.status !== ConversionStatus.APPROVED) {
      throw new ConflictException(`Conversion requests in ${request.status} status cannot be rejected`);
    }

    const claimed = await this.prisma.conversionRequest.updateMany({
      where: {
        id: requestId,
        status: { in: [ConversionStatus.PENDING, ConversionStatus.APPROVED] },
      },
      data: {
        status: ConversionStatus.REJECTED,
        rejectionReason: reason,
        processedAt: new Date(),
      },
    });

    if (claimed.count === 0) {
      const latest = await this.prisma.conversionRequest.findUniqueOrThrow({ where: { id: requestId } });
      if (latest.status === ConversionStatus.REJECTED) {
        return this.prisma.conversionRequest.findUniqueOrThrow({
          where: { id: requestId },
          include: requestInclude,
        });
      }
      if (latest.status === ConversionStatus.CREDITED) {
        throw new ConflictException('Credited conversion requests cannot be rejected');
      }
      if (latest.status === ConversionStatus.PENDING || latest.status === ConversionStatus.APPROVED) {
        throw new ConflictException('Conversion rejection conflicted with another update; please retry');
      }
      throw new ConflictException(`Conversion requests in ${latest.status} status cannot be rejected`);
    }

    return this.prisma.conversionRequest.findUniqueOrThrow({
      where: { id: requestId },
      include: requestInclude,
    });
  }

  private decimal(value: number) {
    return new Prisma.Decimal(value.toString());
  }

  private assertType(type: ConversionType) {
    if (!Object.values(ConversionType).includes(type)) {
      throw new BadRequestException('Invalid conversion type');
    }
  }
}