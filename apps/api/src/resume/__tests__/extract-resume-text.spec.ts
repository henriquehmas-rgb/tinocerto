import { PDFDocument, StandardFonts } from 'pdf-lib';
import { extractResumeText } from '../extract-resume-text';

async function buildTestPdf(texto: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(texto, { x: 50, y: page.getHeight() - 50, size: 12, font });
  const bytes = await doc.save();
  return Buffer.from(bytes);
}

describe('extractResumeText', () => {
  it('extrai o texto de um PDF gerado programaticamente', async () => {
    const pdf = await buildTestPdf('Experiência como Analista de Operações na Empresa Exemplo, 2020 a 2023.');
    const texto = await extractResumeText(pdf);
    expect(texto).toContain('Analista de Operações');
    expect(texto).toContain('Empresa Exemplo');
  });

  it('lança um erro claro para um buffer que não é um PDF válido', async () => {
    await expect(extractResumeText(Buffer.from('isto não é um pdf'))).rejects.toThrow();
  });
});
