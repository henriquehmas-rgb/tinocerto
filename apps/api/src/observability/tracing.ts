import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { trace } from '@opentelemetry/api';

export function startTracing() {
  const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter({
      url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318/v1/traces',
      // Sem timeout curto aqui, a exportação já roda em background via
      // BatchSpanProcessor (padrão do NodeSDK) -- o request/response HTTP
      // da aplicação nunca espera o export terminar. Se não houver coletor
      // ouvindo, o exporter falha (ECONNREFUSED) de forma assíncrona e
      // silenciosa via console.error do próprio SDK; não derruba a API nem
      // atrasa requisições.
    }),
    instrumentations: [getNodeAutoInstrumentations()],
  });

  sdk.start();
  return sdk;
}

export function setTenantSpanAttribute(tenantId: string) {
  const span = trace.getActiveSpan();
  span?.setAttribute('tenant.id', tenantId);
}
