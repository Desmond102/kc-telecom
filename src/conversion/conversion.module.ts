import { Module } from '@nestjs/common';
import { AdminConversionController } from './admin-conversion.controller';
import { ConversionController } from './conversion.controller';
import { ConversionService } from './conversion.service';

@Module({
  controllers: [ConversionController, AdminConversionController],
  providers: [ConversionService],
})
export class ConversionModule {}