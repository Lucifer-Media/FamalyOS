import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { FamilySpaceId } from '../common/decorators/family-space.decorator';
import { AiChatService } from './ai-chat.service';

class AskDto {
  @IsString()
  @MinLength(1)
  question: string;
}

@UseGuards(JwtAuthGuard)
@Controller('ai-assistant')
export class AiChatController {
  constructor(private readonly service: AiChatService) {}

  @Post('chat')
  ask(@CurrentUser() userId: string, @FamilySpaceId() familySpaceId: string, @Body() dto: AskDto) {
    return this.service.ask(userId, familySpaceId, dto.question);
  }
}
