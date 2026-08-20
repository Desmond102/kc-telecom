import { IsString, MinLength } from 'class-validator';

export class VerifyConversionRequestDto {
  @IsString()
  @MinLength(1)
  verificationNote: string;
}