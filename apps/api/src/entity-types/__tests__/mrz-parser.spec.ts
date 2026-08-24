import { extractMrz } from '../mrz-parser';

// Канонический пример MRZ из спецификации ICAO Doc 9303 (используется
// повсеместно как эталонный тестовый образец).
const ICAO_LINE1 = 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<';
const ICAO_LINE2 = 'L898902C<3UTO6908061F9406236ZE184226B<<<<<10';

describe('MRZ-парсер загранпаспорта (ICAO 9303 TD3)', () => {
  it('корректно парсит эталонный пример ICAO', () => {
    const text = `какой-то текст сверху\n${ICAO_LINE1}\n${ICAO_LINE2}\nещё текст снизу`;
    const result = extractMrz(text);
    expect(result).not.toBeNull();
    expect(result?.surname).toBe('ERIKSSON');
    expect(result?.givenNames).toBe('ANNA MARIA');
    expect(result?.documentNumber).toBe('L898902C');
    expect(result?.issuingCountry).toBe('UTO');
    expect(result?.nationality).toBe('UTO');
    expect(result?.birthDate).toBe('1969-08-06');
    expect(result?.expiryDate).toBe('1994-06-23');
    expect(result?.gender).toBe('F');
  });

  it('контрольные цифры валидны для корректного MRZ', () => {
    const result = extractMrz(`${ICAO_LINE1}\n${ICAO_LINE2}`);
    expect(result?.documentNumberValid).toBe(true);
    expect(result?.birthDateValid).toBe(true);
    expect(result?.expiryDateValid).toBe(true);
  });

  it('если текст не содержит MRZ — возвращает null, не пытается угадать', () => {
    const result = extractMrz('Обычный текст без машиночитаемой зоны вообще');
    expect(result).toBeNull();
  });

  it('повреждённая контрольная цифра номера документа помечается как невалидная', () => {
    // Меняем последнюю цифру номера документа так, чтобы контрольная сумма не сошлась.
    const brokenLine2 = ICAO_LINE2.replace('L898902C<3', 'L898902X<3');
    const result = extractMrz(`${ICAO_LINE1}\n${brokenLine2}`);
    expect(result?.documentNumberValid).toBe(false);
  });

  it('РЕГРЕССИЯ: находит MRZ, даже если OCR исказил самый первый символ строки (раньше требовалось строгое начало с "P")', () => {
    // 'P' в начале строки распознан OCR как 'F' — раньше это ломало поиск целиком.
    const corruptedLine1 = 'F' + ICAO_LINE1.slice(1);
    const text = `какой-то шум OCR перед MRZ\n${corruptedLine1}\n${ICAO_LINE2}\nшум после`;
    const result = extractMrz(text);
    // Контрольная сумма строки 2 (номер документа/дата рождения) всё равно сходится —
    // этого достаточно, чтобы доверять MRZ, даже если тип документа в line1 искажён.
    expect(result).not.toBeNull();
    expect(result?.documentNumberValid).toBe(true);
    expect(result?.documentNumber).toBe('L898902C');
  });

  it('строки, явно не похожие на MRZ (мало букв/цифр/<), не рассматриваются вообще', () => {
    const notMrz = 'Это обычное предложение на пятьдесят символов длиной примерно';
    expect(extractMrz(notMrz)).toBeNull();
  });
});
