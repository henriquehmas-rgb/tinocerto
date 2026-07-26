import { SetMetadata } from '@nestjs/common';

export const CERBOS_CHECK_KEY = 'cerbosCheck';

export interface CerbosCheckMetadata {
  resourceKind: string;
  action: string;
}

export const CerbosCheck = (resourceKind: string, action: string) =>
  SetMetadata(CERBOS_CHECK_KEY, { resourceKind, action } satisfies CerbosCheckMetadata);
