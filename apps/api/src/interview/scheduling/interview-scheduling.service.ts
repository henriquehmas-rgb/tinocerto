import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { TenantContext } from '../../database/tenant-context';
import { InterviewScheduleCriarInput, InterviewScheduleService } from '../interview-schedule.service';
import { CalendarEventService } from './calendar-event.service';

export interface AgendarComCalendarioInput extends InterviewScheduleCriarInput {
  organizadoPorUserId: string;
}

@Injectable()
export class InterviewSchedulingService {
  private readonly logger = new Logger(InterviewSchedulingService.name);
  private readonly tenantContext: TenantContext;

  constructor(
    private readonly scheduleService: InterviewScheduleService,
    private readonly calendarEventService: CalendarEventService,
    databaseService: DatabaseService,
  ) {
    this.tenantContext = new TenantContext(databaseService.pool);
  }

  // Duas etapas SEQUENCIAIS, nunca uma transação aninhada dentro da outra
  // -- mesma lição já documentada em bars-generation.service.ts (Fase 3a):
  // segurar um client de pool através de uma chamada de rede lenta (aqui,
  // a API do Google Calendar) sob concorrência esgota a pool inteira.
  // Etapa 1 grava e COMMITA interview_schedule/interview_evaluator antes
  // de qualquer chamada de rede começar -- o agendamento em si nunca fica
  // refém do calendário (decisão 6 da spec).
  async agendar(input: AgendarComCalendarioInput): Promise<{ id: string }> {
    const created = await this.tenantContext.run(input.tenantId, (client) => this.scheduleService.criar(client, input));

    try {
      await this.calendarEventService.tentarCriarEvento({
        tenantId: input.tenantId,
        interviewScheduleId: created.id,
        applicationId: input.applicationId,
        organizadoPorUserId: input.organizadoPorUserId,
        avaliadorIds: input.avaliadorIds,
        dataHora: input.dataHora,
      });
    } catch (err) {
      // Rede de segurança: tentarCriarEvento já captura tudo internamente
      // e nunca deveria lançar. Este catch existe só para blindar a
      // invariante "agendar() nunca falha por causa do calendário" mesmo
      // contra um bug futuro em tentarCriarEvento -- nunca deve disparar
      // na prática.
      this.logger.error(
        `tentarCriarEvento lançou inesperadamente para interview_schedule ${created.id} -- agendamento em si já está commitado e não é afetado`,
        err as Error,
      );
    }

    return created;
  }
}
