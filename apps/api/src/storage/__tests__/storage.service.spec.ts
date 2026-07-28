import { StorageService } from '../storage.service';

describe('StorageService', () => {
  const BUCKET = 'test-bucket-storage-service';

  beforeAll(() => {
    process.env.MINIO_ENDPOINT ??= 'localhost';
    process.env.MINIO_PORT ??= '9000';
    process.env.MINIO_ACCESS_KEY ??= 'tinocerto';
    process.env.MINIO_SECRET_KEY ??= 'dev_local_only';
  });

  it('cria um bucket, faz upload e baixa o mesmo conteúdo de volta', async () => {
    const service = new StorageService();
    await service.ensureBucket(BUCKET);

    const conteudo = Buffer.from('conteúdo de teste do currículo');
    await service.upload(BUCKET, 'candidato-1/curriculo.pdf', conteudo, 'application/pdf');

    const baixado = await service.download(BUCKET, 'candidato-1/curriculo.pdf');
    expect(baixado.equals(conteudo)).toBe(true);
  });

  it('ensureBucket é idempotente (chamar duas vezes não lança)', async () => {
    const service = new StorageService();
    await service.ensureBucket(BUCKET);
    await expect(service.ensureBucket(BUCKET)).resolves.toBeUndefined();
  });

  it('lança ao baixar uma chave que não existe', async () => {
    const service = new StorageService();
    await service.ensureBucket(BUCKET);
    await expect(service.download(BUCKET, 'chave-que-nao-existe.pdf')).rejects.toThrow();
  });
});
