/**
 * The enquiry notification.
 *
 * This one goes inward, to the people who answer the phone, so it is shaped by
 * the opposite constraints to the invite email. Nobody needs persuading it is
 * genuine and nobody is being asked to click anything. What they need is to
 * decide, from the notification alone, whether this is worth interrupting what
 * they are doing — and if it is, to reply without opening the admin.
 *
 * So the reply-to is the visitor, not the academy's own inbox. Hitting reply
 * should answer the person who asked, which is what everybody will do whatever
 * the body says. The admin link is there for working the queue properly; it is
 * not the only route to a response.
 *
 * Every visitor-supplied value is escaped before it reaches the HTML part. The
 * whole message is attacker-controlled text arriving from an unauthenticated
 * form, and it lands in the inbox of the account that can administer the site.
 */

import type { Envelope } from './send';

export type EnquiryEmailInput = {
  name: string;
  email: string | null;
  phone: string | null;
  preferredContact: string | null;
  programInterest: string | null;
  availability: string | null;
  heardFrom: string | null;
  message: string;
  /** Absolute, because a relative URL in an email goes nowhere. */
  adminUrl: string;
  academyName: string;
  receivedAt: Date;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Rows with nothing in them are dropped rather than printed blank. */
function rows(input: EnquiryEmailInput): [string, string][] {
  const entries: [string, string | null][] = [
    ['Name', input.name],
    ['Email', input.email],
    ['Phone', input.phone],
    ['Prefers', input.preferredContact],
    ['Interested in', input.programInterest],
    ['Availability', input.availability],
    ['Heard about us via', input.heardFrom],
  ];
  return entries.filter((entry): entry is [string, string] => Boolean(entry[1]?.trim()));
}

export function buildEnquiryEmail(input: EnquiryEmailInput): Envelope {
  const received = input.receivedAt.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  // The subject carries the name and the programme, because a run of
  // "New enquiry" subjects is unreadable in a list and nobody opens the
  // fourth one.
  const subjectTail = input.programInterest?.trim()
    ? `${input.name} — ${input.programInterest.trim()}`
    : input.name;

  const detail = rows(input);

  const text = [
    `New enquiry from the ${input.academyName} website.`,
    '',
    ...detail.map(([label, value]) => `${label}: ${value}`),
    `Received: ${received} (Eastern)`,
    '',
    'Message:',
    input.message,
    '',
    `Reply to this email to answer ${input.name} directly.`,
    `Or work the queue at: ${input.adminUrl}`,
  ].join('\n');

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#18181b;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;padding:28px;">
      <p style="margin:0 0 4px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#71717a;">
        New website enquiry
      </p>
      <h1 style="margin:0 0 20px;font-size:20px;line-height:1.3;">${escapeHtml(subjectTail)}</h1>

      <table style="width:100%;border-collapse:collapse;font-size:15px;">
        ${detail
          .map(
            ([label, value]) => `<tr>
          <td style="padding:6px 12px 6px 0;color:#71717a;white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td>
          <td style="padding:6px 0;vertical-align:top;">${escapeHtml(value)}</td>
        </tr>`,
          )
          .join('\n        ')}
        <tr>
          <td style="padding:6px 12px 6px 0;color:#71717a;white-space:nowrap;vertical-align:top;">Received</td>
          <td style="padding:6px 0;vertical-align:top;">${escapeHtml(received)} (Eastern)</td>
        </tr>
      </table>

      <p style="margin:20px 0 6px;color:#71717a;font-size:13px;letter-spacing:.08em;text-transform:uppercase;">Message</p>
      <div style="white-space:pre-wrap;padding:14px 16px;background:#fafafa;border-left:3px solid #9b1b1b;border-radius:4px;font-size:15px;line-height:1.55;">${escapeHtml(
        input.message,
      )}</div>

      <p style="margin:24px 0 0;font-size:14px;color:#3f3f46;">
        Reply to this email to answer ${escapeHtml(input.name)} directly, or
        <a href="${escapeHtml(input.adminUrl)}" style="color:#9b1b1b;">open the enquiry list</a>.
      </p>
    </div>
  </body>
</html>`;

  return {
    // Filled in by the caller, which knows who currently holds the roles.
    to: [],
    subject: `New enquiry — ${subjectTail}`,
    html,
    text,
  };
}
