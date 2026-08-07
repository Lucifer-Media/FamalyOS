import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';

const execFileAsync = promisify(execFile);

export interface OcrExtractionResult {
  textSource: 'embedded_pdf_text' | 'ocr';
  extractedText: string;
  confidence: number | null; // null — не применимо (текстовый слой, а не распознавание)
  errorMessage?: string;
}

// Языковые данные Tesseract встраиваются в Docker-образ на этапе сборки
// (см. Dockerfile) — приложение НИКОГДА не обращается в сеть в рантайме.
// Это осознанное требование: документы, проходящие через OCR, часто
// конфиденциальны (паспорта, договоры, медицинские заключения).
const TESSDATA_DIR = process.env.TESSDATA_PREFIX ?? '/app/tessdata';

/**
 * OCR/извлечение текста. Движок — Tesseract, работает полностью локально:
 * ни распознавание изображений, ни чтение PDF никогда не отправляют данные
 * во внешние сервисы. Языковые файлы (rus/eng) вшиты в образ заранее.
 *
 * Поддерживается:
 *  - PDF со встроенным текстовым слоем (быстрый путь, без OCR вообще);
 *  - PDF-сканы без текстового слоя — растеризуются постранично через
 *    poppler-utils (pdftoppm, локальный бинарник, тоже без сети) и
 *    прогоняются через Tesseract;
 *  - изображения (JPG/PNG) — напрямую через Tesseract.
 */
@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);

  async extract(buffer: Buffer, mimeType: string): Promise<OcrExtractionResult> {
    if (mimeType === 'application/pdf') {
      return this.extractFromPdf(buffer);
    }
    if (mimeType.startsWith('image/')) {
      return this.extractFromImageBuffer(buffer);
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
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pdfParse = require('pdf-parse');
      const parsed = await pdfParse(buffer);
      const text = (parsed.text ?? '').trim();
      if (text.length > 20) {
        return { textSource: 'embedded_pdf_text', extractedText: text, confidence: null };
      }
    } catch (err) {
      this.logger.warn('Не удалось прочитать текстовый слой PDF, пробуем растеризацию: ' + (err as Error).message);
    }

    // Текстового слоя нет (или он пуст) — похоже на скан. Растеризуем страницы
    // локально через poppler-utils (pdftoppm) и прогоняем каждую через OCR.
    return this.extractFromScannedPdf(buffer);
  }

  private async extractFromScannedPdf(buffer: Buffer): Promise<OcrExtractionResult> {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'family-os-ocr-'));
    const pdfPath = path.join(tmpDir, 'input.pdf');
    const outPrefix = path.join(tmpDir, 'page');
    try {
      fs.writeFileSync(pdfPath, buffer);
      // -r 300: 300 DPI — достаточно для печатного текста без чрезмерного размера файла.
      await execFileAsync('pdftoppm', ['-png', '-r', '300', pdfPath, outPrefix]);

      const pageFiles = fs
        .readdirSync(tmpDir)
        .filter((f) => f.startsWith('page') && f.endsWith('.png'))
        .sort();

      if (pageFiles.length === 0) {
        return {
          textSource: 'ocr',
          extractedText: '',
          confidence: 0,
          errorMessage: 'Не удалось растеризовать PDF в изображения (пустой результат pdftoppm)',
        };
      }

      const texts: string[] = [];
      const confidences: number[] = [];
      // Ограничиваем первыми 5 страницами — для семейных документов (паспорт,
      // договор на несколько листов) этого достаточно, а обработка всех
      // страниц многостраничного PDF может быть медленной без выделенной GPU.
      for (const pageFile of pageFiles.slice(0, 5)) {
        const pageBuffer = fs.readFileSync(path.join(tmpDir, pageFile));
        const result = await this.runTesseract(pageBuffer);
        if (result.text) texts.push(result.text);
        if (result.confidence != null) confidences.push(result.confidence);
      }

      const avgConfidence =
        confidences.length > 0 ? confidences.reduce((a, b) => a + b, 0) / confidences.length : null;

      return {
        textSource: 'ocr',
        extractedText: texts.join('\n\n--- страница ---\n\n'),
        confidence: avgConfidence,
      };
    } catch (err) {
      this.logger.error('Ошибка растеризации/OCR скана PDF', err as Error);
      return {
        textSource: 'ocr',
        extractedText: '',
        confidence: 0,
        errorMessage:
          'Не удалось обработать скан PDF: ' +
          (err as Error).message +
          '. Убедитесь, что poppler-utils установлен в образе (см. Dockerfile).',
      };
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  private async extractFromImageBuffer(buffer: Buffer): Promise<OcrExtractionResult> {
    const result = await this.runTesseract(buffer);
    return {
      textSource: 'ocr',
      extractedText: result.text,
      confidence: result.confidence,
      errorMessage: result.errorMessage,
    };
  }

  private async runTesseract(
    buffer: Buffer,
  ): Promise<{ text: string; confidence: number | null; errorMessage?: string }> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { createWorker } = require('tesseract.js');
      // langPath указывает на ЛОКАЛЬНУЮ директорию с .traineddata, встроенную
      // в образ на этапе сборки — cachePath тоже локальный, gzip:false,
      // чтобы не пытаться скачивать/распаковывать из сети при отсутствии кэша.
      const worker = await createWorker('rus+eng', 1, {
        langPath: TESSDATA_DIR,
        cachePath: TESSDATA_DIR,
        gzip: false,
      });
      try {
        const { data } = await worker.recognize(buffer);
        return {
          text: data.text ?? '',
          confidence: typeof data.confidence === 'number' ? data.confidence / 100 : null,
        };
      } finally {
        await worker.terminate();
      }
    } catch (err) {
      this.logger.error('Ошибка Tesseract OCR', err as Error);
      return { text: '', confidence: 0, errorMessage: 'OCR не удался: ' + (err as Error).message };
    }
  }
}
