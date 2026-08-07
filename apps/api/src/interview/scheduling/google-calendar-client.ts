import { randomUUID } from 'crypto';
import { google } from 'googleapis';
import { EventoCalendarioInput, EventoCalendarioResultado, GoogleCalendarClient } from './google-calendar.types';

function clienteOAuthBase() {
  return new google.auth.OAuth2(process.env.GOOGLE_OAUTH_CLIENT_ID, process.env.GOOGLE_OAUTH_CLIENT_SECRET);
}

export class GoogleCalendarApiClient implements GoogleCalendarClient {
  async criarEvento(refreshToken: string, input: EventoCalendarioInput): Promise<EventoCalendarioResultado> {
    const oauth2Client = clienteOAuthBase();
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const fim = new Date(input.inicio.getTime() + input.duracaoMinutos * 60_000);
    const response = await calendar.events.insert({
      calendarId: 'primary',
      conferenceDataVersion: 1,
      requestBody: {
        summary: input.resumo,
        description: input.descricao,
        start: { dateTime: input.inicio.toISOString(), timeZone: input.timeZone },
        end: { dateTime: fim.toISOString(), timeZone: input.timeZone },
        attendees: input.attendeeEmails.map((email) => ({ email })),
        conferenceData: {
          createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } },
        },
      },
    });

    if (!response.data.id) {
      throw new Error('Google Calendar não retornou id do evento criado');
    }
    const meetEntry = response.data.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video');
    return { googleEventId: response.data.id, googleMeetLink: meetEntry?.uri ?? null };
  }
}
