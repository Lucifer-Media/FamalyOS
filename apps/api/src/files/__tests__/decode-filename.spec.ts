import { decodeOriginalFilename } from '../decode-filename.util';

describe('decodeOriginalFilename — фикс кракозябр в именах файлов с кириллицей', () => {
  it('восстанавливает русское имя файла, испорченное latin1-декодированием Multer', () => {
    // Реальный пример из бага: "Паспорт_РФ_Максим.pdf" отправленный браузером в UTF-8,
    // но прочитанный Express/busboy как latin1 — именно так выглядели ваши файлы.
    const original = 'Паспорт_РФ_Максим.pdf';
    const mojibake = Buffer.from(original, 'utf8').toString('latin1');
    expect(decodeOriginalFilename(mojibake)).toBe(original);
  });

  it('не портит обычное латинское имя файла', () => {
    expect(decodeOriginalFilename('passport_scan.pdf')).toBe('passport_scan.pdf');
  });

  it('корректно восстанавливает имя со смешанными кириллицей и цифрами', () => {
    const original = 'Свидетельство_о_браке_2026.png';
    const mojibake = Buffer.from(original, 'utf8').toString('latin1');
    expect(decodeOriginalFilename(mojibake)).toBe(original);
  });
});
