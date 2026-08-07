import { validateEntityAttributes } from '../attribute-validator';

describe('Валидация атрибутов специализированных типов (Итерация 2)', () => {
  it('паспорт РФ: требует обязательные поля', () => {
    const result = validateEntityAttributes('passport_rf', { series: '45 00' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Номер'))).toBe(true);
    expect(result.errors.some((e) => e.includes('ФИО'))).toBe(true);
    expect(result.errors.some((e) => e.includes('Дата рождения'))).toBe(true);
  });

  it('паспорт РФ: валидный набор полей проходит проверку', () => {
    const result = validateEntityAttributes('passport_rf', {
      series: '45 00',
      number: '123456',
      fullName: 'Тихомиров Максим Сергеевич',
      birthDate: '1990-01-01',
      issueDate: '2015-05-20',
      issuingAuthority: 'ОВД района Тестовый',
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('неверный формат даты отклоняется', () => {
    const result = validateEntityAttributes('snils', {
      number: '123-456-789 00',
      fullName: 'Тест Тестов',
      issueDate: '20.05.2015', // неверный формат — ожидается ГГГГ-ММ-ДД
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('датой'))).toBe(true);
  });

  it('enum-поле принимает только допустимые значения', () => {
    const bad = validateEntityAttributes('border_crossing', {
      date: '2026-01-01',
      direction: 'SIDEWAYS',
      country: 'Беларусь',
    });
    expect(bad.valid).toBe(false);

    const good = validateEntityAttributes('border_crossing', {
      date: '2026-01-01',
      direction: 'ENTRY',
      country: 'Беларусь',
    });
    expect(good.valid).toBe(true);
  });

  it('числовое поле не принимает строку', () => {
    const result = validateEntityAttributes('first_aid_kit_item', {
      kitId: 'kit-1',
      medicationId: 'med-1',
      quantity: 'много' as any,
      expiryDate: '2027-01-01',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('числом'))).toBe(true);
  });

  it('булево поле работает корректно (true/false, не строка)', () => {
    const good = validateEntityAttributes('digital_account', {
      service: 'Google',
      twoFactorEnabled: true,
    });
    expect(good.valid).toBe(true);

    const bad = validateEntityAttributes('digital_account', {
      service: 'Google',
      twoFactorEnabled: 'yes' as any,
    });
    expect(bad.valid).toBe(false);
  });

  it('незарегистрированный тип (например, из будущих итераций) не блокируется', () => {
    const result = validateEntityAttributes('unknown_future_type', { anything: 'goes' });
    expect(result.valid).toBe(true);
  });

  it('поле, похожее на пароль, отклоняется — Family OS не хранит пароли', () => {
    const result = validateEntityAttributes('digital_account', {
      service: 'Google',
      password: 'qwerty123', // не должно допускаться ни при каких условиях
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.toLowerCase().includes('пароль'))).toBe(true);
  });

  it('ссылка на менеджер секретов (secretsManagerNote) не триггерит защиту от паролей', () => {
    const result = validateEntityAttributes('digital_account', {
      service: 'Google',
      secretsManagerNote: 'bitwarden://item/abc123',
    });
    expect(result.valid).toBe(true);
  });
});
