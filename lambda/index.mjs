// Lambda function: hurka-contact-form
// Receives form data via API Gateway, sends notification + auto-reply via SendGrid

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const TO_EMAIL = process.env.TO_EMAIL || 'info@smartconitalia.com';
const FROM_EMAIL = process.env.FROM_EMAIL || 'info@hurka.it';
const FROM_NAME = process.env.FROM_NAME || 'HURKA!';
const INBOUND_WEBHOOK_TOKEN = process.env.INBOUND_WEBHOOK_TOKEN || '';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function res(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

function getHeader(headers, name) {
  if (!headers) return '';
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) {
      return Array.isArray(value) ? value[0] || '' : value || '';
    }
  }
  return '';
}

function decodeBody(event) {
  if (!event?.body) return '';
  return event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractEmailAddress(value) {
  const match = String(value || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : '';
}

function parseMultipartFormData(body, contentType) {
  const match = String(contentType || '').match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) {
    throw new Error('Missing multipart boundary');
  }

  const boundary = `--${match[1] || match[2]}`;
  const parts = String(body || '').split(boundary).slice(1, -1);
  const fields = {};

  for (const part of parts) {
    const trimmedPart = part.replace(/^\r\n/, '').replace(/\r\n$/, '');
    const separatorIndex = trimmedPart.indexOf('\r\n\r\n');
    if (separatorIndex === -1) continue;

    const rawHeaders = trimmedPart.slice(0, separatorIndex);
    let value = trimmedPart.slice(separatorIndex + 4);
    value = value.replace(/\r\n$/, '');

    const nameMatch = rawHeaders.match(/name="([^"]+)"/i);
    if (!nameMatch) continue;

    fields[nameMatch[1]] = value;
  }

  return fields;
}

async function handleInboundEmail(event) {
  const token = event?.queryStringParameters?.inboundToken || '';
  if (!INBOUND_WEBHOOK_TOKEN || token !== INBOUND_WEBHOOK_TOKEN) {
    return res(401, { error: 'Unauthorized inbound webhook' });
  }

  const contentType = getHeader(event.headers, 'content-type');
  const fields = parseMultipartFormData(decodeBody(event), contentType);
  const inboundTo = fields.to || '';
  const inboundFrom = fields.from || '';
  const subject = fields.subject || '(senza oggetto)';
  const textBody = fields.text || '';
  const htmlBody = fields.html || '';
  const originalRecipient = FROM_EMAIL.toLowerCase();

  if (!inboundTo.toLowerCase().includes(originalRecipient)) {
    return res(202, { message: 'Inbound email ignored' });
  }

  const replyToEmail = extractEmailAddress(inboundFrom);
  const normalizedText = textBody || stripHtml(htmlBody) || '(messaggio vuoto)';
  const notifyHtml = `
    <div style="font-family:sans-serif;max-width:720px;margin:0 auto;color:#333;">
      <div style="background:#203863;padding:24px 32px;">
        <h1 style="margin:0;color:#fae04a;font-size:24px;letter-spacing:1px;">Nuova email ricevuta su ${escapeHtml(FROM_EMAIL)}</h1>
      </div>
      <div style="padding:24px 32px;background:#ffffff;">
        <table style="border-collapse:collapse;width:100%;font-size:14px;">
          <tr><td style="padding:10px 12px;border:1px solid #e0e0e0;font-weight:bold;background:#f5f5f5;width:140px;">Da</td><td style="padding:10px 12px;border:1px solid #e0e0e0;">${escapeHtml(inboundFrom)}</td></tr>
          <tr><td style="padding:10px 12px;border:1px solid #e0e0e0;font-weight:bold;background:#f5f5f5;">A</td><td style="padding:10px 12px;border:1px solid #e0e0e0;">${escapeHtml(inboundTo)}</td></tr>
          <tr><td style="padding:10px 12px;border:1px solid #e0e0e0;font-weight:bold;background:#f5f5f5;">Oggetto</td><td style="padding:10px 12px;border:1px solid #e0e0e0;">${escapeHtml(subject)}</td></tr>
        </table>
        <div style="margin-top:24px;padding:20px;background:#f8f7f4;border-left:4px solid #fae04a;border-radius:4px;white-space:pre-wrap;">${escapeHtml(normalizedText)}</div>
      </div>
    </div>`;

  await sendEmail({
    personalizations: [{ to: [{ email: TO_EMAIL }] }],
    from: { email: FROM_EMAIL, name: FROM_NAME },
    reply_to: replyToEmail ? { email: replyToEmail } : undefined,
    subject: `[HURKA! Inbox] ${subject}`,
    content: [
      {
        type: 'text/plain',
        value: `Nuova email ricevuta su ${FROM_EMAIL}\nDa: ${inboundFrom}\nA: ${inboundTo}\nOggetto: ${subject}\n\n${normalizedText}`,
      },
      { type: 'text/html', value: notifyHtml },
    ],
  });

  return res(200, { message: 'Inbound email forwarded' });
}

async function sendEmail(payload) {
  const r = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`SendGrid ${r.status}: ${t}`);
  }
}

export async function handler(event) {
  if (event.requestContext?.http?.method === 'OPTIONS' || event.httpMethod === 'OPTIONS') {
    return res(200, { message: 'OK' });
  }

  try {
    const contentType = getHeader(event.headers, 'content-type');
    if (contentType.includes('multipart/form-data')) {
      return await handleInboundEmail(event);
    }

    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    const { servizio, nome, email, telefono, messaggio } = body || {};

    if (!nome || !email || !messaggio) {
      return res(400, { error: 'Campi obbligatori: nome, email, messaggio' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res(400, { error: 'Email non valida' });
    }

    // 1) Notification email to the team
    const notifyHtml = `
      <h2 style="color:#203863;">Nuova richiesta dal sito HURKA!</h2>
      <table style="border-collapse:collapse;width:100%;max-width:600px;font-family:sans-serif;">
        <tr><td style="padding:10px 12px;border:1px solid #e0e0e0;font-weight:bold;background:#f5f5f5;">Servizio</td><td style="padding:10px 12px;border:1px solid #e0e0e0;">${servizio || 'Non specificato'}</td></tr>
        <tr><td style="padding:10px 12px;border:1px solid #e0e0e0;font-weight:bold;background:#f5f5f5;">Nome</td><td style="padding:10px 12px;border:1px solid #e0e0e0;">${nome}</td></tr>
        <tr><td style="padding:10px 12px;border:1px solid #e0e0e0;font-weight:bold;background:#f5f5f5;">Email</td><td style="padding:10px 12px;border:1px solid #e0e0e0;"><a href="mailto:${email}">${email}</a></td></tr>
        <tr><td style="padding:10px 12px;border:1px solid #e0e0e0;font-weight:bold;background:#f5f5f5;">Telefono</td><td style="padding:10px 12px;border:1px solid #e0e0e0;">${telefono || 'Non fornito'}</td></tr>
        <tr><td style="padding:10px 12px;border:1px solid #e0e0e0;font-weight:bold;background:#f5f5f5;">Messaggio</td><td style="padding:10px 12px;border:1px solid #e0e0e0;">${messaggio}</td></tr>
      </table>`;

    await sendEmail({
      personalizations: [{ to: [{ email: TO_EMAIL }] }],
      from: { email: FROM_EMAIL, name: FROM_NAME },
      reply_to: { email, name: nome },
      subject: `[HURKA!] Richiesta da ${nome} – ${servizio || 'Generale'}`,
      content: [
        { type: 'text/plain', value: `Nuova richiesta:\nServizio: ${servizio}\nNome: ${nome}\nEmail: ${email}\nTelefono: ${telefono || '-'}\n\n${messaggio}` },
        { type: 'text/html', value: notifyHtml },
      ],
    });

    // 2) Auto-reply to the user
    const replyHtml = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#333;">
        <div style="background:#203863;padding:24px 32px;text-align:center;">
          <h1 style="color:#fae04a;margin:0;font-size:28px;letter-spacing:2px;">HURKA!</h1>
        </div>
        <div style="padding:32px;background:#ffffff;">
          <p style="font-size:16px;">Ciao <strong>${nome}</strong>,</p>
          <p style="font-size:15px;line-height:1.6;">
            grazie per averci contattato! Abbiamo ricevuto la tua richiesta riguardo a
            <strong>${servizio || 'i nostri servizi'}</strong>.
          </p>
          <p style="font-size:15px;line-height:1.6;">
            Il nostro team la sta già analizzando. Ti ricontatteremo il prima possibile con
            una <strong>prima valutazione tecnica</strong> del tuo caso.
          </p>
          <div style="margin:28px 0;padding:20px;background:#f8f7f4;border-left:4px solid #fae04a;border-radius:4px;">
            <p style="margin:0;font-size:14px;color:#555;">
              <strong>La tua richiesta:</strong><br/>
              ${messaggio}
            </p>
          </div>
          <p style="font-size:15px;line-height:1.6;">
            Nel frattempo, se hai bisogno puoi rispondere direttamente a questa email.
          </p>
          <p style="font-size:15px;margin-top:24px;">
            A presto,<br/>
            <strong style="color:#203863;">Il team HURKA!</strong>
          </p>
        </div>
        <div style="background:#203863;padding:16px 32px;text-align:center;">
          <p style="margin:0;font-size:12px;color:rgba(255,255,255,.5);">
            HURKA! – Consulenza Energetica Integrata<br/>
            <a href="https://hurka.it" style="color:#fae04a;text-decoration:none;">hurka.it</a>
          </p>
        </div>
      </div>`;

    await sendEmail({
      personalizations: [{ to: [{ email, name: nome }] }],
      from: { email: FROM_EMAIL, name: FROM_NAME },
      reply_to: { email: TO_EMAIL, name: 'HURKA! Team' },
      subject: `Grazie ${nome}! Abbiamo ricevuto la tua richiesta – HURKA!`,
      content: [
        { type: 'text/plain', value: `Ciao ${nome},\n\ngrazie per averci contattato! Abbiamo ricevuto la tua richiesta riguardo a ${servizio || 'i nostri servizi'}.\n\nIl nostro team la sta già analizzando e ti ricontatterà il prima possibile.\n\nLa tua richiesta:\n${messaggio}\n\nA presto,\nIl team HURKA!\nhurka.it` },
        { type: 'text/html', value: replyHtml },
      ],
    });

    return res(200, { message: 'Richiesta inviata con successo! Controlla la tua email per la conferma.' });

  } catch (err) {
    console.error('Lambda error:', err);
    return res(500, { error: "Errore nell'invio. Riprova più tardi." });
  }
}

