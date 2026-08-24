import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';
import { tokenReadabilityRatio } from '../entity-types/document-classifier';

const execFileAsync = promisify(execFile);

export interface PageOcrResult {
  pageNumber: number;
  text: string;
  confidence: number | null;
}

export interface OcrExtractionResult {
  textSource: 'embedded_pdf_text' | 'ocr';
  extractedText: string;
  confidence: number | null; // null — не применимо (текстовый слой, а не распознавание)
  errorMessage?: string;
  /** Постраничные результаты — только для растеризованных PDF (сканов);
   * позволяет впоследствии разметить составной документ (например, разные
   * развороты паспорта: основной, регистрация, брак, дети) по отдельности,
   * а не одним слитным текстом. */
  pages?: PageOcrResult[];
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
      const pages: PageOcrResult[] = [];
      // Ограничиваем первыми 5 страницами — для семейных документов (паспорт,
      // договор на несколько листов) этого достаточно, а обработка всех
      // страниц многостраничного PDF может быть медленной без выделенной GPU.
      let pageNumber = 0;
      for (const pageFile of pageFiles.slice(0, 5)) {
        pageNumber++;
        const pageBuffer = fs.readFileSync(path.join(tmpDir, pageFile));
        const result = await this.runTesseract(pageBuffer);
        if (result.text) texts.push(result.text);
        if (result.confidence != null) confidences.push(result.confidence);
        pages.push({ pageNumber, text: result.text, confidence: result.confidence });
      }

      const avgConfidence =
        confidences.length > 0 ? confidences.reduce((a, b) => a + b, 0) / confidences.length : null;

      return {
        textSource: 'ocr',
        extractedText: texts.join('\n\n--- страница ---\n\n'),
        confidence: avgConfidence,
        pages,
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
      // Три варианта предобработки — эмпирически проверено на реальных
      // документах (паспорта, свидетельства с защитным узором): в
      // зависимости от конкретного скана лучший результат даёт то один,
      // то другой вариант, поэтому пробуем несколько и берём лучший.
      //
      // ВАЖНО: "лучший" определяется НЕ по confidence, который возвращает
      // сам Tesseract. На реальном тесте (свидетельство о браке) движок
      // дал confidence=47% для варианта, где текст был практически чистым
      // шумом (доля читаемых слов ~9%), и confidence=35% для варианта,
      // где чётко читались "СВИДЕТЕЛЬСТВО", "О ЗАКЛЮЧЕНИИ БРАКА",
      // "Российская Федерация" (доля читаемых слов ~36%). Самозаявленная
      // уверенность Tesseract на документах с декоративным фоном
      // ненадёжна как критерий сравнения — она отражает "насколько текст
      // похож на буквы" (декоративная рамка тоже может дать высокий
      // формальный score), а не "сколько распознано настоящих слов".
      // Поэтому сравниваем варианты по доле читаемых слов
      // (tokenReadabilityRatio — та же метрика, что защищает классификатор
      // от случайных совпадений в шуме), а не по числу от движка.
      const attemptGrayscale = await this.runTesseractOnce(await this.preprocessImage(buffer, 'grayscale'));
      let best = attemptGrayscale;
      let bestReadability = tokenReadabilityRatio(attemptGrayscale.text);

      if (bestReadability < 0.35) {
        const attemptBinarize = await this.runTesseractOnce(await this.preprocessImage(buffer, 'binarize'));
        const binarizeReadability = tokenReadabilityRatio(attemptBinarize.text);
        if (binarizeReadability > bestReadability) {
          best = attemptBinarize;
          bestReadability = binarizeReadability;
        }

        const attemptMedian = await this.runTesseractOnce(await this.preprocessImage(buffer, 'median'));
        const medianReadability = tokenReadabilityRatio(attemptMedian.text);
        if (medianReadability > bestReadability) {
          best = attemptMedian;
          bestReadability = medianReadability;
        }
      }
      return best;
    } catch (err) {
      this.logger.error('Ошибка Tesseract OCR', err as Error);
      return { text: '', confidence: 0, errorMessage: 'OCR не удался: ' + (err as Error).message };
    }
  }

  private async runTesseractOnce(
    preprocessed: Buffer,
  ): Promise<{ text: string; confidence: number | null; errorMessage?: string }> {
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
      // PSM 6 ("единый блок текста") обычно работает надёжнее, чем
      // автоматическая сегментация по умолчанию, для фото/сканов документов
      // с плотным текстом (паспорт, договор) — уменьшает "мусорный" вывод.
      await worker.setParameters({ tessedit_pageseg_mode: '6' });
      const { data } = await worker.recognize(preprocessed);
      return {
        text: data.text ?? '',
        confidence: typeof data.confidence === 'number' ? data.confidence / 100 : null,
      };
    } finally {
      await worker.terminate();
    }
  }

  /**
   * Предобработка изображения перед OCR — как правило, критична для
   * реальных фотографий документов (в отличие от идеальных плоских сканов):
   * приведение к градациям серого, автоконтраст, лёгкая резкость и
   * увеличение мелких снимков телефона. Без этого Tesseract на фото
   * документов часто выдаёт "мусорный" текст (низкая уверенность,
   * бессмысленные символы) — это и было основной причиной низкого
   * качества распознавания в первых тестах.
   *
   * @param binarize — вторая попытка (см. runTesseract): жёсткая бинаризация
   * (чёрно-белый порог) вместо просто градаций серого — помогает на
   * документах с узорчатым/цветным фоном (паспорта, свидетельства), но
   * иногда хуже на обычных чистых сканах, поэтому используется только как
   * запасной вариант, а не по умолчанию.
   */
  private async preprocessImage(buffer: Buffer, mode: 'grayscale' | 'binarize' | 'median'): Promise<Buffer> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const sharp = require('sharp');
      const image = sharp(buffer, { failOn: 'none' }).rotate(); // rotate() без аргументов — авто-поворот по EXIF
      const metadata = await image.metadata();
      // 2800px — увеличено по опыту реальных документов с фоновыми узорами
      // (паспорта, свидетельства): больше пикселей помогает LSTM-модели
      // Tesseract отличать текст от фоновой печати.
      const targetWidth = 2800;
      const needsUpscale = (metadata.width ?? 0) > 0 && (metadata.width as number) < targetWidth;

      let pipeline = image.grayscale();
      if (mode === 'median') {
        // Медианный фильтр (окно 3×3) размывает мелкие детали (гильош-узор
        // защитного фона) сильнее, чем основные штрихи текста — на практике
        // хорошо "очищает" официальные бланки перед бинаризацией.
        pipeline = pipeline.median(3);
      }
      pipeline = pipeline.normalize().sharpen();
      if (needsUpscale) {
        pipeline = pipeline.resize({ width: targetWidth, kernel: 'lanczos3' });
      }
      if (mode === 'binarize' || mode === 'median') {
        pipeline = pipeline.threshold(mode === 'median' ? 160 : 150);
      }
      return await pipeline.toFormat('png').toBuffer();
    } catch (err) {
      this.logger.warn('Предобработка изображения не удалась, используем оригинал: ' + (err as Error).message);
      return buffer;
    }
  }
}
