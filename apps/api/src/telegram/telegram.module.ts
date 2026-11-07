import { Module } from '@nestjs/common';
import { EntitiesModule } from '../entities/entities.module';
import { AiAssistantModule } from '../ai-assistant/ai-assistant.module';
import { FinanceModule } from '../finance/finance.module';
import { TelegramBotService } from './telegram-bot.service';
import { TelegramController } from './telegram.controller';

/** Telegram-бот (Итерация 4.1). Без TELEGRAM_BOT_TOKEN — полностью выключен. */
@Module({
  imports: [EntitiesModule, AiAssistantModule, FinanceModule],
  controllers: [TelegramController],
  providers: [TelegramBotService],
})
export class TelegramModule {}
