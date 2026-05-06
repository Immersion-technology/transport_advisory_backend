import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
}

export const sendEmail = async (options: EmailOptions): Promise<void> => {
  await transporter.sendMail({
    from: `"${process.env.FROM_NAME}" <${process.env.FROM_EMAIL}>`,
    ...options,
  });
};

export const buildReminderEmail = (params: {
  firstName: string;
  plateNumber: string;
  documentType: string;
  expiryDate: string;
  daysLeft: number;
  confirmToken: string;
  renewalLink: string;
}): string => {
  const { firstName, plateNumber, documentType, expiryDate, daysLeft, confirmToken, renewalLink } = params;
  const urgencyColor = daysLeft <= 7 ? '#D97706' : '#059669';
  const urgencyLabel = `${daysLeft} DAYS LEFT`;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Document Reminder — Transport Advisory Services</title>
</head>
<body style="margin:0;padding:0;background:#F5F5F0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F5F0;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:#0A3828;padding:32px 40px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td>
                          <div style="width:40px;height:40px;background:linear-gradient(135deg,#0A3828,#166534);border:1px solid rgba(110,231,183,0.35);border-radius:9px;display:inline-block;vertical-align:middle;text-align:center;line-height:40px;">
                            <span style="color:#fff;font-size:22px;font-weight:900;letter-spacing:-1px;">✓</span>
                          </div>
                        </td>
                        <td style="padding-left:12px;vertical-align:middle;">
                          <h1 style="color:#FFFFFF;margin:0;font-size:22px;font-weight:800;letter-spacing:-0.5px;line-height:1;">Transport Advisory Services</h1>
                          <p style="color:#6EE7B7;margin:2px 0 0;font-size:12px;">Vehicle Compliance · Not Government Owned</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td align="right">
                    <span style="background:${urgencyColor};color:#fff;padding:6px 14px;border-radius:20px;font-size:12px;font-weight:700;letter-spacing:0.5px;">${urgencyLabel}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:40px;">
              <p style="color:#374151;font-size:16px;margin:0 0 8px;">Dear ${firstName},</p>
              <p style="color:#6B7280;font-size:15px;line-height:1.6;margin:0 0 32px;">
                Your vehicle document is due for renewal in <strong style="color:${urgencyColor};">${daysLeft} days</strong>. Renew early to avoid fines and impoundment.
              </p>

              <table width="100%" cellpadding="0" cellspacing="0" style="background:#F9FAFB;border-radius:10px;border:1px solid #E5E7EB;margin-bottom:32px;">
                <tr>
                  <td style="padding:24px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:8px 0;border-bottom:1px solid #E5E7EB;">
                          <span style="color:#9CA3AF;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Vehicle</span>
                        </td>
                        <td style="padding:8px 0;border-bottom:1px solid #E5E7EB;text-align:right;">
                          <span style="color:#111827;font-size:14px;font-weight:600;">${plateNumber}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;border-bottom:1px solid #E5E7EB;">
                          <span style="color:#9CA3AF;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Document</span>
                        </td>
                        <td style="padding:8px 0;border-bottom:1px solid #E5E7EB;text-align:right;">
                          <span style="color:#111827;font-size:14px;font-weight:600;">${documentType}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;">
                          <span style="color:#9CA3AF;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Expiry Date</span>
                        </td>
                        <td style="padding:8px 0;text-align:right;">
                          <span style="color:${urgencyColor};font-size:14px;font-weight:700;">${expiryDate}</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
                <tr>
                  <td align="center">
                    <a href="${renewalLink}" style="display:inline-block;background:#0A3828;color:#ffffff;text-decoration:none;padding:16px 40px;border-radius:8px;font-size:16px;font-weight:700;letter-spacing:0.3px;">Renew Now →</a>
                  </td>
                </tr>
              </table>

              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
                <tr>
                  <td align="center">
                    <a href="${process.env.FRONTEND_URL}/confirm-reminder/${confirmToken}" style="display:inline-block;background:#F9FAFB;color:#374151;text-decoration:none;padding:12px 32px;border-radius:8px;font-size:14px;font-weight:600;border:1px solid #E5E7EB;">I've seen this — Got it ✓</a>
                  </td>
                </tr>
              </table>

              <p style="color:#9CA3AF;font-size:13px;text-align:center;margin:0;">
                This reminder was sent from Transport Advisory Services · <a href="${process.env.FRONTEND_URL}/settings/notifications" style="color:#059669;">Manage preferences</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#F9FAFB;padding:20px 40px;border-top:1px solid #E5E7EB;">
              <p style="color:#9CA3AF;font-size:12px;margin:0;text-align:center;">
                © ${new Date().getFullYear()} Transport Advisory Services · transportadvisory.ng · Lagos, Nigeria · Not government owned
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

export const buildMagicLinkEmail = (params: {
  firstName: string;
  link: string;
  purpose: 'WELCOME' | 'LOGIN';
  ttlMinutes: number;
}): string => {
  const { firstName, link, purpose, ttlMinutes } = params;
  const isWelcome = purpose === 'WELCOME';
  const heading = isWelcome ? 'Your Transport Advisory Services account is ready' : 'Sign in to Transport Advisory Services';
  const lead = isWelcome
    ? "We've created your Transport Advisory Services account using the details from your service request. Click the button below to access your dashboard, track your application, and view your vehicle documents."
    : 'Click the button below to sign in to your dashboard. No password needed.';
  const ctaLabel = isWelcome ? 'Open My Dashboard' : 'Sign In Now';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${heading} — Transport Advisory Services</title>
</head>
<body style="margin:0;padding:0;background:#F5F5F0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F5F0;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:#0A3828;padding:32px 40px;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <div style="width:40px;height:40px;background:linear-gradient(135deg,#0A3828,#166534);border:1px solid rgba(110,231,183,0.35);border-radius:9px;display:inline-block;vertical-align:middle;text-align:center;line-height:40px;">
                      <span style="color:#fff;font-size:22px;font-weight:900;letter-spacing:-1px;">✓</span>
                    </div>
                  </td>
                  <td style="padding-left:12px;vertical-align:middle;">
                    <h1 style="color:#FFFFFF;margin:0;font-size:22px;font-weight:800;letter-spacing:-0.5px;line-height:1;">Transport Advisory Services</h1>
                    <p style="color:#6EE7B7;margin:2px 0 0;font-size:12px;">Vehicle Compliance · Not Government Owned</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:40px;">
              <h2 style="color:#111827;font-size:24px;font-weight:800;margin:0 0 12px;letter-spacing:-0.3px;">${heading}</h2>
              <p style="color:#374151;font-size:16px;margin:0 0 8px;">Hi ${firstName},</p>
              <p style="color:#6B7280;font-size:15px;line-height:1.6;margin:0 0 32px;">${lead}</p>

              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td align="center">
                    <a href="${link}" style="display:inline-block;background:#0A3828;color:#ffffff;text-decoration:none;padding:16px 40px;border-radius:8px;font-size:16px;font-weight:700;letter-spacing:0.3px;">${ctaLabel} →</a>
                  </td>
                </tr>
              </table>

              <p style="color:#9CA3AF;font-size:13px;line-height:1.6;text-align:center;margin:0 0 16px;">
                This link expires in <strong>${ttlMinutes} minutes</strong> and can only be used once.<br>
                If the button doesn't work, copy and paste this URL into your browser:
              </p>
              <p style="color:#0A3828;font-size:12px;word-break:break-all;text-align:center;margin:0 0 24px;background:#F9FAFB;padding:12px;border-radius:6px;border:1px solid #E5E7EB;">
                ${link}
              </p>

              ${isWelcome ? `
              <div style="background:#FEF3C7;border:1px solid #FDE68A;border-radius:8px;padding:14px 16px;margin-bottom:8px;">
                <p style="color:#92400E;font-size:13px;line-height:1.5;margin:0;">
                  <strong>Caveat:</strong> Transport Advisory Services is a private vehicle compliance service — <em>not government owned</em>. We facilitate document tracking, renewal, and delivery on your behalf.
                </p>
              </div>
              ` : ''}

              <p style="color:#9CA3AF;font-size:12px;text-align:center;margin:24px 0 0;">
                Didn't request this? You can safely ignore this email — the link will expire on its own.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#F9FAFB;padding:20px 40px;border-top:1px solid #E5E7EB;">
              <p style="color:#9CA3AF;font-size:12px;margin:0;text-align:center;">
                © ${new Date().getFullYear()} Transport Advisory Services · transportadvisory.ng · Lagos, Nigeria · Not government owned
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};
