import { Module } from '@nestjs/common';
import { FirstAidKitsService } from './first-aid-kits.service';
import { FirstAidKitsController } from './first-aid-kits.controller';

@Module({
  providers: [FirstAidKitsService],
  controllers: [FirstAidKitsController],
})
export class FirstAidKitsModule {}
