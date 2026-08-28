const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }

  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    res.status(503).send('Stripe todavía no está configurado');
    return;
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const rawBody = await readRawBody(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    res.status(400).send('Firma inválida: ' + err.message);
    return;
  }

  // Este es el único momento en todo el proyecto donde se usa la service_role key:
  // corre en el servidor de Vercel, nunca llega al navegador, así que es seguro aquí.
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const eventId = session.metadata && session.metadata.event_id;
    if (eventId) {
      const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
      await supabase.from('events').update({ status: 'activo' }).eq('id', eventId);
    }
  }

  res.status(200).json({ received: true });
}

// Stripe necesita el cuerpo de la petición "crudo" (sin procesar) para poder
// verificar que la firma es auténtica -- por eso se apaga el parseo automático.
handler.config = { api: { bodyParser: false } };

module.exports = handler;
