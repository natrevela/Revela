const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');

// Los precios se configuran como variables de entorno en Vercel (en centavos de MXN).
// Mientras no existan, la función responde con un error claro en vez de fallar en silencio.
const PACKAGE_PRICES_CENTS = {
  sencillo: Number(process.env.PRICE_SENCILLO_CENTS || 0),
  doble: Number(process.env.PRICE_DOBLE_CENTS || 0),
  completo: Number(process.env.PRICE_COMPLETO_CENTS || 0)
};

const PACKAGE_LABELS = {
  sencillo: 'Revelado — Paquete Sencillo (1 formato)',
  doble: 'Revelado — Paquete Doble (2 formatos)',
  completo: 'Revelado — Paquete Completo (los 3 formatos)'
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido' });
    return;
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    res.status(503).json({ error: 'El cobro automático todavía no está conectado (falta configurar Stripe).' });
    return;
  }

  const { eventId } = req.body || {};
  if (!eventId) {
    res.status(400).json({ error: 'Falta el id del evento' });
    return;
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const { data: eventRow, error: fetchError } = await supabase
    .from('events')
    .select('id, name, package, status')
    .eq('id', eventId)
    .single();

  if (fetchError || !eventRow) {
    res.status(404).json({ error: 'No encontramos ese evento' });
    return;
  }
  if (eventRow.status === 'activo') {
    res.status(400).json({ error: 'Este evento ya está activo' });
    return;
  }

  const amount = PACKAGE_PRICES_CENTS[eventRow.package];
  if (!amount) {
    res.status(500).json({ error: 'El precio de este paquete todavía no está configurado' });
    return;
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const origin = req.headers.origin || ('https://' + req.headers.host);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'mxn',
          product_data: { name: PACKAGE_LABELS[eventRow.package] + ' — ' + eventRow.name },
          unit_amount: amount
        },
        quantity: 1
      }],
      metadata: { event_id: eventRow.id },
      success_url: origin + '/registro/exito.html?evento=' + eventRow.id,
      cancel_url: origin + '/registro/?cancelado=1'
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo iniciar el pago: ' + err.message });
  }
};
