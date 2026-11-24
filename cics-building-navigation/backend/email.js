const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

/**
 * Sends a simple branded HTML email through Resend.
 * Returns a result instead of throwing so an email-provider outage does not
 * turn an already-completed application action into a false failure.
 */
async function sendFindrEmail({ to, subject, heading, message, details }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from || !to) return { sent: false, reason: 'not_configured' };

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#172033;line-height:1.6"><main style="max-width:600px;margin:24px auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px"><h2>${escapeHtml(heading)}</h2><p>${escapeHtml(message)}</p><p style="color:#64748b;font-size:14px;white-space:pre-line">${escapeHtml(details || '')}</p><p>— Findr CICS Building Guide</p></main></body></html>`
      })
    });
    if (!response.ok) {
      const providerMessage = await response.text();
      console.error('[Findr email provider]', response.status, providerMessage.slice(0, 500));
      return { sent: false, reason: 'provider_error' };
    }
    return { sent: true };
  } catch (error) {
    console.error('[Findr email]', error.message);
    return { sent: false, reason: 'provider_unavailable' };
  }
}

async function sendReportNotification(options) {
  return sendFindrEmail(options);
}

module.exports = { sendFindrEmail, sendReportNotification };
