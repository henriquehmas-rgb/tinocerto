import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';

export function startTracing() {
  // Sem isso, o `diag` do OpenTelemetry fica no-op por padrão: uma falha de
  // exportação (endpoint errado, coletor fora do ar) não produz NENHUM log.
  // Nível ERROR porque o BatchSpanProcessor agrupa falhas por lote (a cada
  // scheduledDelayMillis, alguns segundos), não por requisição -- então
  // isso não reintroduz o spam-por-request que a decisão original de não
  // logar por request queria evitar.
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR);

  const sdk = new NodeSDK({
    // Sem opção `url` explícita: deixamos o exporter resolver o endpoint
    // seguindo a convenção padrão do OpenTelemetry -- primeiro
    // OTEL_EXPORTER_OTLP_TRACES_ENDPOINT (URL completa do sinal), senão
    // OTEL_EXPORTER_OTLP_ENDPOINT (URL base) + "/v1/traces", senão o
    // default "http://localhost:4318/v1/traces". Passar `url` aqui
    // anularia essa resolução e quebraria a convenção caso alguém setasse
    // OTEL_EXPORTER_OTLP_ENDPOINT (a variável "base") esperando o SDK
    // completar o path do sinal sozinho.
    traceExporter: new OTLPTraceExporter(),
    // Sem timeout curto aqui, a exportação já roda em background via
    // BatchSpanProcessor (padrão do NodeSDK) -- o request/response HTTP
    // da aplicação nunca espera o export terminar. Se não houver coletor
    // ouvindo, o exporter falha (ECONNREFUSED) de forma assíncrona; o erro
    // é reportado via `diag` -- que agora (com o diag.setLogger acima) loga
    // no nível ERROR, mas antes disso era 100% silencioso, sem nenhum log.
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'tinocerto-api',
    instrumentations: [
      getNodeAutoInstrumentations({
        // Ruidosas e sem valor de diagnóstico hoje: cada I/O de
        // filesystem gera um span (centenas só no boot da aplicação), e
        // vai piorar quando o upload de arquivo via MinIO existir. DNS e
        // net idem -- desabilitadas até haver motivo concreto para
        // instrumentá-las.
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
        '@opentelemetry/instrumentation-net': { enabled: false },
      }),
    ],
  });

  sdk.start();
  return sdk;
}
