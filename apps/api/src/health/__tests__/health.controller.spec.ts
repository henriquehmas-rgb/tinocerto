import { HealthController } from '../health.controller';

describe('HealthController', () => {
  it('retorna status ok sem tocar nenhuma dependência externa', () => {
    const controller = new HealthController();
    expect(controller.check()).toEqual({ status: 'ok' });
  });
});
