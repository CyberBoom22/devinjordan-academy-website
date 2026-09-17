/**
 * The invitation email.
 *
 * This message is, structurally, a phishing email: unexpected, from an
 * organisation, carrying a secret code and a link to a login page. Everything
 * below is shaped by that. It names who invited them and what role they are
 * being given, so the recipient can check the story against something they
 * already know; it tells them the code expires; and it never asks them to
 * reply with anything.
 *
 * The code is in the body as text rather than baked only into a link, because
 * a link that carries a credential ends up in browser history, in a corporate
 * link-scanner's logs, and in whatever the recipient pastes into a group chat
 * when they get stuck.
 */

import type { Envelope } from './send';

export type InviteEmailInput = {
  code: string;
  firstName: string | null;
  roleName: string;
  invitedBy: string | null;
  expiresAt: Date;
  /** Absolute, because a relative URL in an email goes nowhere. */
  registerUrl: string;
  academyName: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildInviteEmail(input: InviteEmailInput): Envelope {
  const greeting = input.firstName?.trim() ? `Hello ${input.firstName.trim()},` : 'Hello,';
  const expires = input.expiresAt.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const from = input.invitedBy?.trim()
    ? `${input.invitedBy.trim()} has invited you`
    : 'You have been invited';

  const text = [
    greeting,
    '',
    `${from} to join the ${input.academyName} website team as ${input.roleName}.`,
    '',
    'Your invite code is:',
    '',
    `    ${input.code}`,
    '',
    `Go to ${input.registerUrl} and enter it along with your details to set up your account.`,
    '',
    `The code works once, only for this email address, and expires on ${expires}.`,
    '',
    'If you were not expecting this, you can ignore it — the code is useless without',
    'your email address, and it will expire on its own. If you would like it cancelled',
    'sooner, reply to this message and ask.',
  ].join('\n');

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#18181b;line-height:1.6">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e4e4e7;border-radius:6px">
      <tr>
        <td style="padding:28px 28px 8px 28px">
          <p style="margin:0 0 16px 0">${escapeHtml(greeting)}</p>
          <p style="margin:0 0 16px 0">
            ${escapeHtml(from)} to join the ${escapeHtml(input.academyName)} website team as
            <strong>${escapeHtml(input.roleName)}</strong>.
          </p>
        </td>
      </tr>
      <tr>
        <td style="padding:0 28px">
          <p style="margin:0 0 8px 0;font-size:13px;color:#52525b">Your invite code</p>
          <p style="margin:0 0 20px 0;padding:14px;background:#fafafa;border:1px dashed #d4d4d8;border-radius:4px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:19px;letter-spacing:2px;text-align:center">
            ${escapeHtml(input.code)}
          </p>
          <p style="margin:0 0 24px 0">
            <a href="${escapeHtml(input.registerUrl)}" style="display:inline-block;padding:11px 20px;background:#18181b;color:#ffffff;text-decoration:none;border-radius:4px;font-weight:600">
              Set up your account
            </a>
          </p>
          <p style="margin:0 0 20px 0;font-size:14px;color:#52525b">
            The code works once, only for this email address, and expires on
            <strong>${escapeHtml(expires)}</strong>.
          </p>
        </td>
      </tr>
      <tr>
        <td style="padding:0 28px 28px 28px;border-top:1px solid #e4e4e7">
          <p style="margin:16px 0 0 0;font-size:13px;color:#71717a">
            If you were not expecting this you can ignore it — the code is useless without your
            email address and will expire on its own. If you would like it cancelled sooner, reply
            to this message and ask.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return {
    to: '',
    // Named, not "Your invitation": a subject line that says who it is from is
    // one the recipient can recognise before opening it.
    subject: `Your invite to the ${input.academyName} website team`,
    html,
    text,
  };
}
