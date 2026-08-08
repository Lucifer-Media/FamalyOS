/**
 * Парсер машиночитаемой зоны (MRZ) загранпаспорта — стандарт ICAO Doc 9303,
 * формат TD3 (паспорта): две строки по 44 символа.
 *
 * Пример:
 * P<RUSIVANOV<<IVAN<IVANOVICH<<<<<<<<<<<<<<<<<
 * 1234567891RUS9001014M3005108<<<<<<<<<<<<<<08
 *
 * OCR часто путает символы внутри MRZ (O/0, I/1, S/5) — эта функция
 * работает с уже распознанным текстом и НЕ пытается угадывать/исправлять
 * такие ошибки сама, только извлекает то, что чётко соответствует формату.
 * Контрольные цифры (check digits) по стандарту ICAO проверяются — если не
 * сходятся, соответствующее поле не выдаётся (лучше пусто, чем неверно).
 */

export interface MrzResult {
  documentType: string;
  issuingCountry: string; // ISO 3166-1 alpha-3
  surname: string;
  givenNames: string;
  documentNumber: string;
  nationality: string;
  birthDate: string; // YYYY-MM-DD
  gender: 'M' | 'F' | 'X' | null;
  expiryDate: string; // YYYY-MM-DD
  personalNumber: string;
  documentNumberValid: boolean;
  birthDateValid: boolean;
  expiryDateValid: boolean;
}

const MRZ_LINE_RE = /^[A-Z0-9<]{44}$/;

/** Контрольная цифра MRZ по стандарту ICAO 9303 (весовые коэффициенты 7-3-1). */
function computeCheckDigit(input: string): number {
  const weights = [7, 3, 1];
  const values: Record<string, number> = {};
  for (let i = 0; i < 10; i++) values[String(i)] = i;
  for (let i = 0; i < 26; i++) values[String.fromCharCode(65 + i)] = i + 10;
  values['<'] = 0;

  let sum = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const value = values[ch] ?? 0;
    sum += value * weights[i % 3];
  }
  return sum % 10;
}

function mrzDateToIso(yymmdd: string): string | null {
  if (!/^\d{6}$/.test(yymmdd)) return null;
  const yy = parseInt(yymmdd.slice(0, 2), 10);
  const mm = yymmdd.slice(2, 4);
  const dd = yymmdd.slice(4, 6);
  // Эвристика века: считаем, что YY >= 30 — 1900-е (даты рождения), иначе 2000-е.
  // Для дат окончания срока действия это тоже приемлемо в горизонте ближайших лет.
  const century = yy >= 30 ? 1900 : 2000;
  return `${century + yy}-${mm}-${dd}`;
}

/**
 * Ищет в произвольном тексте OCR две строки, похожие на MRZ, и парсит их.
 * Возвращает null, если MRZ не найдена вообще (не ошибка — просто её нет
 * в кадре или OCR не смог её вычленить).
 */
export function extractMrz(ocrText: string): MrzResult | null {
  const lines = ocrText
    .split('\n')
    .map((l) => l.trim().toUpperCase().replace(/\s+/g, ''))
    .filter((l) => l.length >= 40); // MRZ-строки длинные, отсекаем короткие строки сразу

  // Строки MRZ иногда распознаются с потерей нескольких символов по краям —
  // ищем две подряд идущие строки, начинающиеся с 'P' (тип "паспорт") и
  // похожие по длине на 44 символа, с запасом на огрехи OCR (40-46).
  for (let i = 0; i < lines.length - 1; i++) {
    const line1 = lines[i];
    const line2 = lines[i + 1];
    if (!line1.startsWith('P') && !line1.startsWith('P<')) continue;
    if (line1.length < 40 || line1.length > 46) continue;
    if (line2.length < 40 || line2.length > 46) continue;

    return parseMrzLines(padOrTrim(line1, 44), padOrTrim(line2, 44));
  }
  return null;
}

function padOrTrim(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : s.padEnd(len, '<');
}

function parseMrzLines(line1: string, line2: string): MrzResult | null {
  if (!MRZ_LINE_RE.test(line1) || !MRZ_LINE_RE.test(line2)) return null;

  const documentType = line1.slice(0, 2).replace(/</g, '');
  const issuingCountry = line1.slice(2, 5);
  const namesRaw = line1.slice(5).replace(/<+$/, '');
  const [surnamePart, givenPart = ''] = namesRaw.split('<<');
  const surname = surnamePart.replace(/</g, ' ').trim();
  const givenNames = givenPart.replace(/</g, ' ').trim();

  const documentNumberRaw = line2.slice(0, 9);
  const documentNumberCheck = line2[9];
  const documentNumber = documentNumberRaw.replace(/<+$/, '');
  const documentNumberValid = computeCheckDigit(documentNumberRaw) === Number(documentNumberCheck || -1);

  const nationality = line2.slice(10, 13);

  const birthDateRaw = line2.slice(13, 19);
  const birthDateCheck = line2[19];
  const birthDateValid = computeCheckDigit(birthDateRaw) === Number(birthDateCheck || -1);
  const birthDate = mrzDateToIso(birthDateRaw);

  const genderChar = line2[20];
  const gender: MrzResult['gender'] = genderChar === 'M' ? 'M' : genderChar === 'F' ? 'F' : genderChar === '<' ? null : 'X';

  const expiryDateRaw = line2.slice(21, 27);
  const expiryDateCheck = line2[27];
  const expiryDateValid = computeCheckDigit(expiryDateRaw) === Number(expiryDateCheck || -1);
  const expiryDate = mrzDateToIso(expiryDateRaw);

  const personalNumberRaw = line2.slice(28, 42).replace(/<+$/, '');

  if (!birthDate || !expiryDate) return null;

  return {
    documentType,
    issuingCountry,
    surname,
    givenNames,
    documentNumber,
    nationality,
    birthDate,
    gender,
    expiryDate,
    personalNumber: personalNumberRaw,
    documentNumberValid,
    birthDateValid,
    expiryDateValid,
  };
}
