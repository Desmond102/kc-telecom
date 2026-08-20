import { IsString, MinLength } from 'class-validator';

export class RejectConversionRequestDto {
  @IsString()
  @MinLength(1)
  reason: string;
}