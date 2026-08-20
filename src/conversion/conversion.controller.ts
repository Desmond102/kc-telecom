import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { ConversionService } from './conversion.service';
import { CreateConversionRequestDto } from './dto/create-conversion-request.dto';
import { ListConversionRequestsDto } from './dto/list-conversion-requests.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('VENDOR')
@Controller('vendor/conversions')
export class ConversionController {
  constructor(private readonly conversionService: ConversionService) {}

  @Get('config')
  getConfig() {
    return this.conversionService.listActiveConfigs();
  }

  @Post('requests')
  createRequest(@CurrentUser('id') userId: string, @Body() dto: CreateConversionRequestDto) {
    return this.conversionService.createRequest(userId, dto);
  }

  @Get('requests')
  listRequests(@CurrentUser('id') userId: string, @Query() filters: ListConversionRequestsDto) {
    return this.conversionService.listVendorRequests(userId, filters);
  }
}