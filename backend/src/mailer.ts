import nodemailer from 'nodemailer';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
  // Shown by mail clients as an "Unsubscribe" button (List-Unsubscribe header)
  unsubscribeUrl?: string;
}

// Sends one email. Rejects if the provider did not accept it.
export interface Mailer {
  send(mail: Mail): Promise<void>;
}

export interface SmtpConfig {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  from: string;
}

// Any SMTP provider (SendPulse now, Brevo works the same). Port 465 uses TLS from the start,
// other ports (587) switch to TLS with STARTTLS; nodemailer refuses to send without it.
export class SmtpMailer implements Mailer {
  private readonly transport;

  constructor(private readonly config: SmtpConfig) {
    this.transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      requireTLS: config.port !== 465,
      auth: config.user ? { user: config.user, pass: config.pass } : undefined,
    });
  }

  async send(mail: Mail): Promise<void> {
    await this.transport.sendMail({
      from: this.config.from,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      list: mail.unsubscribeUrl ? { unsubscribe: mail.unsubscribeUrl } : undefined,
    });
  }
}

// Local development and tests: prints the email instead of sending it, so the links in it
// can be opened by hand.
export class ConsoleMailer implements Mailer {
  readonly sent: Mail[] = [];

  constructor(private readonly log: (line: string) => void = console.log) {}

  send(mail: Mail): Promise<void> {
    this.sent.push(mail);
    this.log(`Email to ${mail.to}: ${mail.subject}\n${mail.text}`);
    return Promise.resolve();
  }
}

// SMTP_HOST set → SmtpMailer. Without it ConsoleMailer, but not in production: there it would
// answer "check your mail" and send nothing, so starting fails instead.
export function mailerFromEnv(env: NodeJS.ProcessEnv = process.env): Mailer {
  const host = env.SMTP_HOST;
  if (!host) {
    if (env.NODE_ENV === 'production') {
      throw new Error('SMTP_HOST must be set in production when PUBLIC_URL is set (the waitlist)');
    }
    return new ConsoleMailer();
  }
  const port = Number(env.SMTP_PORT ?? 587);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid SMTP_PORT: ${env.SMTP_PORT}`);
  }
  const from = env.MAIL_FROM;
  if (!from) throw new Error('MAIL_FROM must be set when SMTP_HOST is set');
  return new SmtpMailer({ host, port, user: env.SMTP_USER, pass: env.SMTP_PASS, from });
}
