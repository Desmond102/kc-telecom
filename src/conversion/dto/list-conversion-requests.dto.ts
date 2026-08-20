import { IsEnum, IsOptional } from 'class-validator';
import { ConversionStatus, ConversionType } from '@prisma/client';

export class ListConversionRequestsDto {
  @IsOptional()
  @IsEnum(ConversionType)
  type?: ConversionType;

  @IsOptional()
  @IsEnum(ConversionStatus)
  status?: ConversionStatus;
}