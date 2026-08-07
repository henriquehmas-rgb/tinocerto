export interface EventoCalendarioInput {
  resumo: string;
  descricao?: string;
  inicio: Date;
  duracaoMinutos: number;
  timeZone: string;
  attendeeEmails: string[];
}

export interface EventoCalendarioResultado {
  googleEventId: string;
  googleMeetLink: string | null;
}

export interface GoogleCalendarClient {
  criarEvento(refreshToken: string, input: EventoCalendarioInput): Promise<EventoCalendarioResultado>;
}
