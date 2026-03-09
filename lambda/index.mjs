// Lambda function: hurka-contact-form
// Receives form data via API Gateway, sends notification + auto-reply via SendGrid

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const TO_EMAIL = process.env.TO_EMAIL || 'info@smartconitalia.it';
const FROM_EMAIL = process.env.FROM_EMAIL || 'info@hurka.it';
const FROM_NAME = process.env.FROM_NAME || 'HURKA!';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function res(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
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

