/**
 * Sending mail through Resend.
 *
 * The key is a Worker secret, never a database row — unlike the AI provider's,
 * which only spends money. This one can send mail *as the academy*, and a
 * leaked sending key is how a domain ends up on a blocklist with its ordinary
 * business email caught behind it. It belongs somewhere SQL cannot reach.
 *
 * Nothing here throws. A caller minting an invite has already created it by
 * the time this runs, and an exception would lose the code in a stack trace
 * while the invite sat in the database unusable. Failures come back as values
 * and get recorded.
 */

export type EmailResult = { ok: true; messageId: string } | { ok: false; error: string };

export type Envelope = {
  /**
   * One address, or several. An array goes to Resend as-is, so the recipients
   * can see each other — fine for an internal notification going to the people
   * who share the inbox, and the reason nothing addressed to a member of the
   * public may ever be sent this way.
   */
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  /**
   * Overrides the configured reply-to for this one message. An enquiry
   * notification sets it to the visitor, so that hitting reply answers the
   * person who asked rather than the academy's own unattended inbox.
   */
  replyTo?: string;
};

export type MailConfig = {
  apiKey: string;
  /** 'Devin Jordan Security Training Academy <invites@devinjordansecurity.com>' */
  from: string;
  /**
   * Where a reply goes. The sending address is unattended, and an invite is
   * exactly the kind of mail people answer with a question — so it needs to
   * land somewhere a person reads.
   */
  replyTo?: string;
};

/**
 * Pull the configuration out of the Worker's environment.
 *
 * Returns null rather than throwing when unconfigured: a deployment without a
 * key should still issue invites, just not post them.
 */
export function getMailConfig(runtimeEnv?: Record<string, string | undefined>): MailConfig | null {
  const read = (key: string): string | undefined =>
    runtimeEnv?.[key] ?? (import.meta.env as Record<string, string | undefined>)[key];

  const apiKey = read('RESEND_API_KEY');
  const from = read('EMAIL_FROM');
  if (!apiKey || !from) return null;

  return { apiKey, from, replyTo: read('EMAIL_REPLY_TO') };
}

export async function sendEmail(envelope: Envelope, config: MailConfig): Promise<EmailResult> {
  const replyTo = envelope.replyTo ?? config.replyTo;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: config.from,
        to: Array.isArray(envelope.to) ? envelope.to : [envelope.to],
        subject: envelope.subject,
        html: envelope.html,
        // Always both. A text part is what a plain-text client shows, and its
        // absence is one of the cheaper ways to look like spam.
        text: envelope.text,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const payload = (await response.json().catch(() => null)) as {
      id?: string;
      message?: string;
      name?: string;
    } | null;

    if (!response.ok) {
      // Resend puts the useful part in `message`; fall back to the status so
      // the recorded error is never just "failed".
      return {
        ok: false,
        error: payload?.message ?? `Resend returned ${response.status} ${response.statusText}`,
      };
    }

    if (!payload?.id)
      return { ok: false, error: 'Resend accepted the request but returned no id.' };

    return { ok: true, messageId: payload.id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
