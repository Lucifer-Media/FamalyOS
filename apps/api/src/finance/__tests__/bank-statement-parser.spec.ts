import { parseBankStatementText, parseBankStatementRows } from '../bank-statement-parser';

// Все образцы ниже — реальные (анонимизированные по сумме, где нужно) фрагменты
// выписок, предоставленных пользователем, а не выдуманные данные.

const OFX_SAMPLE = `<?xml version="1.0" encoding="utf-8" ?>
<?OFX OFXHEADER="200" VERSION="202" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>
<OFX>
  <BANKMSGSRSV1>
    <STMTTRNRS>
      <STMTRS>
        <CURDEF>RUB</CURDEF>
        <BANKACCTFROM>
          <BANKID>T-BANK</BANKID>
          <ACCTID>40817933500000271424</ACCTID>
          <ACCTTYPE>CHECKING</ACCTTYPE>
        </BANKACCTFROM>
        <BANKTRANLIST>
          <STMTTRN>
            <TRNTYPE>CREDIT</TRNTYPE>
            <DTPOSTED>20260811121757.000[+3:MSK]</DTPOSTED>
            <TRNAMT>5000</TRNAMT>
            <FITID>158103284474</FITID>
            <NAME>Между своими счетами</NAME>
            <MEMO>Переводы</MEMO>
            <CURRENCY><CURSYM>RUB</CURSYM><CURRATE>1.0</CURRATE></CURRENCY>
          </STMTTRN>
          <STMTTRN>
            <TRNTYPE>DEBIT</TRNTYPE>
            <DTPOSTED>20260809161405.000[+3:MSK]</DTPOSTED>
            <TRNAMT>-5000</TRNAMT>
            <FITID>158001112233</FITID>
            <NAME>Максим Т.</NAME>
            <MEMO>Переводы</MEMO>
            <CURRENCY><CURSYM>RUB</CURSYM><CURRATE>1.0</CURRATE></CURRENCY>
          </STMTTRN>
        </BANKTRANLIST>
      </STMTRS>
    </STMTTRNRS>
  </BANKMSGSRSV1>
</OFX>`;

const TBANK_CSV_SAMPLE =
  '"Дата операции";"Дата платежа";"Номер карты";"Статус";"Сумма операции";"Валюта операции";"Сумма платежа";"Валюта платежа";"Кэшбэк";"Категория";"MCC";"Описание";"Бонусы (включая кэшбэк)";"Округление на инвесткопилку";"Сумма операции с округлением"\r\n' +
  '"11.08.2026 12:18:35";"11.08.2026";"*8537";"OK";"-5000,00";"RUB";"-5000,00";"RUB";"";"Кредиты";"9999";"Досрочное погашение кредита";"0,00";"0,00";"-5000,00"\r\n' +
  '"11.07.2026 12:44:03";"11.07.2026";"*8537";"OK";"-30010,00";"RUB";"-30010,00";"RUB";"";"Переводы";"";"Максим Т.";"0,00";"0,00";"-30010,00"\r\n';

const ALFA_CSV_EN_SAMPLE =
  '\uFEFFoperationDate,transactionDate,accountName,accountNumber,cardName,cardNumber,merchant,amount,currency,status,category,mcc,type,comment,bonusValue,bonusTitle\n' +
  '12.08.2026,,"Текущий зарплатный счёт",40817810804260237000,"Альфа-Карта ТОП МИР",220015******0600,"MOSCOW/DRINKIT 37-3",370,RUR,"В обработке",Фастфуд,5814,Списание,,,\n' +
  '10.08.2026,10.08.2026,"Текущий зарплатный счёт",40817810804260237000,,,"Широков Кирилл Павлович",7000,RUR,Выполнен,Переводы,,Пополнение,"Перевод денежных средств",,\n';

describe('parseBankStatementText — реальные форматы банковских выписок', () => {
  it('разбирает OFX-выписку Т-Банка', () => {
    const result = parseBankStatementText(OFX_SAMPLE, 'test.ofx');
    expect(result.detectedFormat).toBe('OFX 2.02');
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]).toMatchObject({ date: '2026-08-11', amount: 5000, currency: 'RUB' });
    expect(result.transactions[1]).toMatchObject({ date: '2026-08-09', amount: -5000, currency: 'RUB' });
    expect(result.accountHint?.accountNumber).toBe('40817933500000271424');
  });

  it('разбирает CSV-выписку Т-Банка (";", русские заголовки)', () => {
    const result = parseBankStatementText(TBANK_CSV_SAMPLE, 'test.csv');
    expect(result.detectedFormat).toContain('Т-Банк');
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]).toMatchObject({
      date: '2026-08-11',
      amount: -5000,
      description: 'Досрочное погашение кредита',
    });
  });

  it('разбирает CSV-выписку Альфа-Банка (",", английские заголовки) и корректно определяет знак по полю "Тип"', () => {
    const result = parseBankStatementText(ALFA_CSV_EN_SAMPLE, 'test.csv');
    expect(result.detectedFormat).toContain('Альфа-Банк');
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0].amount).toBe(-370); // "Списание" -> отрицательное
    expect(result.transactions[1].amount).toBe(7000); // "Пополнение" -> положительное
  });

  it('для нераспознанного формата возвращает пустой список и предупреждение, не пытается угадать', () => {
    const result = parseBankStatementText('какой-то случайный текстовый файл без структуры', 'unknown.txt');
    expect(result.transactions).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe('parseBankStatementRows — реальные форматы XLSX', () => {
  it('разбирает XLSX Т-Банка с датой в формате Excel serial number', () => {
    const rows = [
      ['Дата операции', 'Дата платежа', 'Номер карты', 'Статус', 'Сумма операции', 'Валюта операции', 'Сумма платежа', 'Валюта платежа', 'Кэшбэк', 'Категория', 'MCC', 'Описание', 'Бонусы', 'Округление', 'Сумма с округлением'],
      [46245.51290509259, 46245, '*8537', 'OK', -5000, 'RUB', -5000, 'RUB', null, 'Кредиты', 9999, 'Досрочное погашение кредита', 0, 0, -5000],
    ];
    const result = parseBankStatementRows(rows);
    expect(result.detectedFormat).toContain('Т-Банк');
    expect(result.transactions).toHaveLength(1);
    // Реальная проверка: serial 46245.xxx должен дать ИМЕННО ту же дату,
    // что и в CSV-версии той же самой операции того же банка — 2026-08-11.
    expect(result.transactions[0].date).toBe('2026-08-11');
    expect(result.transactions[0].amount).toBe(-5000);
  });

  it('разбирает XLSX Альфа-Банка (русские заголовки, дата строкой)', () => {
    const rows = [
      ['Дата операции', 'Дата проводки', 'Название счета', 'Номер счета', 'Название карты', 'Номер карты', 'Описание операции', 'Сумма', 'Валюта', 'Статус', 'Категория', 'MCC код', 'Тип'],
      ['12.08.2026', null, 'Текущий зарплатный счёт', '40817810804260237000', 'Альфа-Карта ТОП МИР', '220015******0600', 'MOSCOW/DRINKIT 37-3', 370, 'RUR', 'В обработке', 'Фастфуд', 5814, 'Списание'],
    ];
    const result = parseBankStatementRows(rows);
    expect(result.detectedFormat).toContain('Альфа-Банк');
    expect(result.transactions[0]).toMatchObject({ date: '2026-08-12', amount: -370, currency: 'RUB' });
  });
});
