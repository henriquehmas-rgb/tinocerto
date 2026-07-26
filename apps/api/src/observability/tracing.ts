import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { trace } from '@opentelemetry/api';

export function startTracing() {
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
    // ouvindo, o exporter falha (ECONNREFUSED) de forma assíncrona e
    // silenciosa via console.error do próprio SDK; não derruba a API nem
    // atrasa requisições.
    instrumentations: [getNodeAutoInstrumentations()],
  });

  sdk.start();
  return sdk;
}

export function setTenantSpanAttribute(tenantId: string) {
  const span = trace.getActiveSpan();
  span?.setAttribute('tenant.id', tenantId);
}
