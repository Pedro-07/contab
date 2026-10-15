/**
 * Escolha do canal de cada envio (incremento 3, P25, RN7, ADR 0008).
 * - O contato nasce autorizado em cada canal que tem (P25); desmarcado ou opt-out, não sai.
 * - Canal preferido: WhatsApp, e-mail ou os dois.
 * - WhatsApp indisponível (sem conexão ativa, template não aprovado ou pausado, sem
 *   telefone ou sem autorização): desvia para o e-mail, se houver, e o escritório é avisado.
 */
import type { PreferredChannel } from './clients';

export type DeliveryChannel = 'whatsapp' | 'email';

export type ChannelInput = {
  preferred: PreferredChannel;
  phone: string | null;
  email: string | null;
  whatsappOptIn: boolean;
  emailOptIn: boolean;
  /** Conexão ativa e template aprovado para este gatilho. */
  whatsappReady: boolean;
};

export type ChannelChoice = {
  channels: DeliveryChannel[];
  /** Motivo de o WhatsApp preferido não ter saído (vira alerta). */
  whatsappSkipped: 'sem_telefone' | 'sem_autorizacao' | 'indisponivel' | null;
};

export function chooseChannels(input: ChannelInput): ChannelChoice {
  const wantsWhatsapp = input.preferred === 'whatsapp' || input.preferred === 'ambos';
  const wantsEmail = input.preferred === 'email' || input.preferred === 'ambos';
  const emailOk = Boolean(input.email) && input.emailOptIn;

  let whatsappSkipped: ChannelChoice['whatsappSkipped'] = null;
  if (wantsWhatsapp) {
    if (!input.phone) whatsappSkipped = 'sem_telefone';
    else if (!input.whatsappOptIn) whatsappSkipped = 'sem_autorizacao';
    else if (!input.whatsappReady) whatsappSkipped = 'indisponivel';
  }
  const whatsappOk = wantsWhatsapp && whatsappSkipped === null;

  const channels: DeliveryChannel[] = [];
  if (whatsappOk) channels.push('whatsapp');
  // E-mail quando é o preferido, ou como desvio do WhatsApp que não pôde sair: a guia
  // do cliente ainda chega, mesmo que ele tenha recusado o WhatsApp.
  if (emailOk && (wantsEmail || (wantsWhatsapp && !whatsappOk))) channels.push('email');
  return { channels, whatsappSkipped };
}
