module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  roots: ['<rootDir>', '<rootDir>/../scripts'],
  testRegex: '.*\.spec\.ts$',
  setupFilesAfterEnv: ['<rootDir>/../jest.setup.ts'],
  // maxWorkers: 1 -- os testes rodam contra Postgres/Redis REAIS e
  // compartilhados entre arquivos de spec, sem isolamento por
  // schema/instância. Por padrão o Jest roda arquivos de teste diferentes
  // em workers separados EM PARALELO, e um publisher de outbox de um
  // arquivo pode capturar e marcar como publicado um evento que outro
  // arquivo acabou de inserir e ainda não terminou de verificar (reproduzido
  // ao vivo: outbox-publisher.service.spec.ts publicando um evento de
  // outbox.service.spec.ts). Forçar um único worker serializa os arquivos
  // (dentro de um arquivo os testes já rodavam em série, isso não muda) e
  // elimina essa classe de race entre specs de integração. Trade-off
  // deliberado: correção > velocidade de CI, aceitável numa suíte ainda
  // pequena.
  maxWorkers: 1,
};
