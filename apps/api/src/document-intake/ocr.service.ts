import { Injectable, Logger } from '@nestjs/common';

export interface OcrExtractionResult {
  textSource: 'embedded_pdf_text' | 'ocr';
  extractedText: string;
  confidence: number | null; // null — не применимо (текстовый слой, а не распознавание)
  errorMessage?: string;
}

/**
 * OCR/извлечение текста. Движок — Tesseract (локально, бесплатно, без
 * отправки документов во внешние сервисы) — выбор согласован с владельцем
 * системы: качество ниже, чем у облачных OCR, особенно на рукописном или
 * сильно повреждённом тексте, но это осознанный компромисс.
 *
 * Технический долг (см. docs/TECH_DEBT.md): сканы PDF без текстового слоя
 * сейчас не растеризуются в изображения для OCR (это требует poppler-utils
 * или аналогичного нативного инструмента в образе Docker) — в этой
 * итерации поддерживается только (а) PDF со встроенным текстовым слоем и
 * (б) изображения (JPG/PNG) напрямую через Tesseract.
 */
@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);

  async extract(buffer: Buffer, mimeType: string): Promise<OcrExtractionResult> {
    if (mimeType === 'application/pdf') {
      return this.extractFromPdf(buffer);
    }
    if (mimeType.startsWith('image/')) {
      return this.extractFromImage(buffer);
    }
    return {
      textSource: 'ocr',
      extractedText: '',
      confidence: 0,
      errorMessage: `Тип файла ${mimeType} не поддерживается конвейером OCR в текущей итерации`,
    };
  }

  private async extractFromPdf(buffer: Buffer): Promise<OcrExtractionResult> {
    try {
      // pdf-parse — чистый JS, читает встроенный текстовый слой PDF без OCR.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pdfParse = require('pdf-parse');
      const parsed = await pdfParse(buffer);
      const text = (parsed.text ?? '').trim();
      if (text.length > 20) {
        return { textSource: 'embedded_pdf_text', extractedText: text, confidence: null };
      }
      return {
        textSource: 'ocr',
        extractedText: '',
        confidence: 0,
        errorMessage:
          'PDF не содержит текстового слоя (похоже на скан). OCR сканированных PDF — известное ' +
          'ограничение текущей итерации, см. docs/TECH_DEBT.md. Загрузите документ как JPG/PNG для OCR.',
      };
    } catch (err) {
      this.logger.error('Ошибка чтения текстового слоя PDF', err as Error);
      return {
        textSource: 'ocr',
        extractedText: '',
        confidence: 0,
        errorMessage: 'Не удалось прочитать PDF: ' + (err as Error).message,
      };
    }
  }

  private async extractFromImage(buffer: Buffer): Promise<OcrExtractionResult> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { createWorker } = require('tesseract.js');
      const worker = await createWorker('rus+eng');
      try {
        const { data } = await worker.recognize(buffer);
        return {
          textSource: 'ocr',
          extractedText: data.text ?? '',
          confidence: typeof data.confidence === 'number' ? data.confidence / 100 : null,
        };
      } finally {
        await worker.terminate();
      }
    } catch (err) {
      this.logger.error('Ошибка Tesseract OCR', err as Error);
      return {
        textSource: 'ocr',
        extractedText: '',
        confidence: 0,
        errorMessage: 'OCR не удался: ' + (err as Error).message,
      };
    }
  }
}
