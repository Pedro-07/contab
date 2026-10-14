/**
 * Adaptador de e-mail (CLAUDE.md, "Integrações"): Resend em produção, SMTP (Mailpit)
 * em desenvolvimento e testes. O conteúdo da mensagem nunca vai para log.
 */
import { logger } from '@contab/config/logger';
import nodemailer from 'nodemailer';
import { Resend } from 'resend';

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Evita envio duplicado quando o provedor suporta (Resend). */
  idempotencyKey?: string;
};

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export type EmailConfig = {
  EMAIL_PROVIDER: 'smtp' | 'resend';
  AUTH_EMAIL_FROM: string;
  SMTP_URL?: string | undefined;
  RESEND_API_KEY?: string | undefined;
};

const TIMEOUT_MS = 10_000;
const ATTEMPTS = 3;

async function withRetry(fn: () => Promise<void>): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      await fn();
      return;
    } catch (error) {
      lastError = error;
      if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
    }
  }
  throw lastError;
}

export function createEmailSender(config: EmailConfig): EmailSender {
  if (config.EMAIL_PROVIDER === 'resend') {
    if (!config.RESEND_API_KEY) throw new Error('RESEND_API_KEY não definida');
    const resend = new Resend(config.RESEND_API_KEY);
    return {
      async send(message) {
        await withRetry(async () => {
          const { error } = await resend.emails.send(
            {
              from: config.AUTH_EMAIL_FROM,
              to: message.to,
              subject: message.subject,
              text: message.text,
              ...(message.html ? { html: message.html } : {}),
            },
            message.idempotencyKey ? { idempotencyKey: message.idempotencyKey } : undefined,
          );
          if (error) throw new Error(`Resend: ${error.name}`);
        });
        logger.info({ provider: 'resend' }, 'e-mail enviado');
      },
    };
  }

  if (!config.SMTP_URL) throw new Error('SMTP_URL não definida');
  const smtp = new URL(config.SMTP_URL);
  const transport = nodemailer.createTransport({
    host: smtp.hostname,
    port: Number(smtp.port || 25),
    secure: smtp.protocol === 'smtps:',
    ...(smtp.username
      ? {
          auth: {
            user: decodeURIComponent(smtp.username),
            pass: decodeURIComponent(smtp.password),
          },
        }
      : {}),
    connectionTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  });
  return {
    async send(message) {
      await withRetry(async () => {
        await transport.sendMail({
          from: config.AUTH_EMAIL_FROM,
          to: message.to,
          subject: message.subject,
          text: message.text,
          ...(message.html ? { html: message.html } : {}),
        });
      });
      logger.info({ provider: 'smtp' }, 'e-mail enviado');
    },
  };
}
