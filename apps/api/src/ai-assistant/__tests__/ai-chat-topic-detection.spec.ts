import { detectTopicEntityTypes } from '../chat-topic-detection';

describe('detectTopicEntityTypes — распознавание темы вопроса для прямой подгрузки данных', () => {
  it('РЕГРЕССИЯ: реальный вопрос пользователя ("расскажи про последние финансовые операции") распознаётся как финансовая тема', () => {
    const types = detectTopicEntityTypes('расскажи про последние финансовые операции');
    expect(types).toContain('financial_transaction');
    expect(types).toContain('bank_account');
  });

  it('вопрос про ЖКХ распознаёт нужные типы', () => {
    const types = detectTopicEntityTypes('сколько я потратил на электроэнергию в этом месяце?');
    expect(types).toContain('utility_bill');
  });

  it('вопрос без явной темы не подтягивает ничего лишнего', () => {
    const types = detectTopicEntityTypes('какая погода сегодня?');
    expect(types).toEqual([]);
  });

  it('вопрос про паспорт распознаёт нужный тип', () => {
    const types = detectTopicEntityTypes('когда истекает мой паспорт?');
    expect(types).toContain('passport_rf');
  });
});
