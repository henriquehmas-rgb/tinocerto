import { trace } from '@opentelemetry/api';

export function setTenantSpanAttribute(tenantId: string) {
  const span = trace.getActiveSpan();
  span?.setAttribute('tenant.id', tenantId);
}
