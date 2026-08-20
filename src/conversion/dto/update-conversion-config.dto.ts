import { Type } from 'class-transformer';
import { IsBoolean, IsNumber, IsOptional, IsPositive, Max, Min } from 'class-validator';

export class UpdateConversionConfigDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(100)
  rate: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  minimumAmount: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  maximumAmount?: number | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}