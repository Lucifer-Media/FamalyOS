import { extractMedicalPartyGuesses, findBestNameMatch } from '../document-classifier';

describe('Автосвязь медицинских документов: догадки об участниках (не NLP, разбор меток бланка)', () => {
  it('извлекает пациента, врача и организацию из подписанных полей', () => {
    const text = `
      МЕДИЦИНСКОЕ ЗАКЛЮЧЕНИЕ
      Пациент: Иванов Иван Иванович
      Врач: Петрова Анна Сергеевна
      Учреждение: Клиника "Здоровье"
      Диагноз: ОРВИ, лёгкое течение
    `;
    const guesses = extractMedicalPartyGuesses('medical_conclusion', text);
    expect(guesses.patientFullName).toBe('Иванов Иван Иванович');
    expect(guesses.doctorFullName).toBe('Петрова Анна Сергеевна');
    expect(guesses.organizationName).toContain('Здоровье');
  });

  it('для нерелевантного типа документа не пытается ничего извлечь', () => {
    const guesses = extractMedicalPartyGuesses('passport_rf', 'Пациент: Кто-то\nВрач: Кто-то ещё');
    expect(guesses).toEqual({});
  });

  it('если меток нет в тексте — возвращает undefined по каждому полю, не выдумывает', () => {
    const guesses = extractMedicalPartyGuesses('prescription', 'Случайный текст без подписанных полей вообще');
    expect(guesses.patientFullName).toBeUndefined();
    expect(guesses.doctorFullName).toBeUndefined();
    expect(guesses.organizationName).toBeUndefined();
  });
});

describe('findBestNameMatch — сопоставление с уже существующими карточками', () => {
  const doctors = [
    { id: 'd1', title: 'Петрова Анна Сергеевна' },
    { id: 'd2', title: 'Сидоров Пётр Петрович' },
  ];

  it('находит точное совпадение без учёта регистра', () => {
    expect(findBestNameMatch('петрова анна сергеевна', doctors)).toBe('d1');
  });

  it('находит частичное совпадение (вхождение подстроки)', () => {
    expect(findBestNameMatch('Петрова А.С.', doctors)).toBeUndefined(); // сокращение — не подстрока, справедливо не находит
    expect(findBestNameMatch('Врач Петрова Анна Сергеевна, каб. 12', doctors)).toBe('d1');
  });

  it('для несуществующего имени возвращает undefined, не гадает', () => {
    expect(findBestNameMatch('Совершенно другой Человек', doctors)).toBeUndefined();
  });

  it('для пустого/undefined имени возвращает undefined', () => {
    expect(findBestNameMatch(undefined, doctors)).toBeUndefined();
    expect(findBestNameMatch('', doctors)).toBeUndefined();
  });
});
