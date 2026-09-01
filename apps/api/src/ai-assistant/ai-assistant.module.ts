import { Module } from '@nestjs/common';
import { OllamaService } from './ollama.service';
import { AiChatService } from './ai-chat.service';
import { AiChatController } from './ai-chat.controller';
import { SearchModule } from '../search/search.module';

@Module({
  imports: [SearchModule],
  controllers: [AiChatController],
  providers: [OllamaService, AiChatService],
  exports: [OllamaService],
})
export class AiAssistantModule {}
