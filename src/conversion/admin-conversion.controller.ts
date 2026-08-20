import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ConversionType } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { ConversionService } from './conversion.service';
import { ListConversionRequestsDto } from './dto/list-conversion-requests.dto';
import { RejectConversionRequestDto } from './dto/reject-conversion-request.dto';
import { UpdateConversionConfigDto } from './dto/update-conversion-config.dto';
import { VerifyConversionRequestDto } from './dto/verify-conversion-request.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/conversions')
export class AdminConversionController {
  constructor(private readonly conversionService: ConversionService) {}

  @Get('config')
  getConfigs() {
    return this.conversionService.listConfigs();
  }

  @Patch('config/:type')
  updateConfig(@Param('type') type: ConversionType, @Body() dto: UpdateConversionConfigDto) {
    return this.conversionService.updateConfig(type, dto);
  }

  @Get('requests')
  listRequests(@Query() filters: ListConversionRequestsDto) {
    return this.conversionService.listAdminRequests(filters);
  }

  @Post('requests/:requestId/verify')
  verifyRequest(
    @Param('requestId') requestId: string,
    @CurrentUser('id') adminId: string,
    @Body() dto: VerifyConversionRequestDto,
  ) {
    return this.conversionService.verifyRequest(requestId, adminId, dto);
  }

  @Post('requests/:requestId/approve')
  approveRequest(@Param('requestId') requestId: string) {
    return this.conversionService.approveRequest(requestId);
  }

  @Post('requests/:requestId/reject')
  rejectRequest(@Param('requestId') requestId: string, @Body() dto: RejectConversionRequestDto) {
    return this.conversionService.rejectRequest(requestId, dto);
  }
}