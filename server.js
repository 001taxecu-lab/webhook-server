const express = require('express');
const app = express();
app.use(express.json());

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const EMAIL_DESTINO = process.env.EMAIL_DESTINO || "001taxecu@gmail.com";
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;

// ============================================================
// WEBHOOK — recibe alertas de TradingView
// ============================================================
app.post('/webhook', async (req, res) => {
  const datos = req.body;
  console.log('=================================');
  console.log('ALERTA RECIBIDA DE TRADINGVIEW:');
  console.log(JSON.stringify(datos, null, 2));
  console.log('Fecha/Hora:', new Date().toLocaleString('es-US', { timeZone: 'America/New_York' }));
  console.log('=================================');

  // Responder 200 inmediatamente para que TradingView no reintente
  res.status(200).json({ recibido: true });

  // Procesar la alerta en segundo plano
  try {
    await procesarAlerta(datos);
  } catch (e) {
    console.error('Error procesando alerta:', e.message);
  }
});

// ============================================================
// PROCESAR ALERTA — genera analisis y envia email
// ============================================================
async function procesarAlerta(datos) {
  const ticker    = datos.ticker    || 'SPY';
  const tipo      = datos.tipo      || 'cruce_ema';
  const precio    = datos.precio    || datos.close || 'N/A';
  const ema8      = datos.ema8      || 'N/A';
  const ema20     = datos.ema20     || 'N/A';
  const ema50     = datos.ema50     || 'N/A';
  const ema200    = datos.ema200    || 'N/A';
  const volumen   = datos.volumen   || 'N/A';
  const intervalo = datos.intervalo || datos.interval || 'N/A';
  const exchange  = datos.exchange  || 'N/A';
  const hora      = new Date().toLocaleString('es-US', { timeZone: 'America/New_York' });

  // Determinar tipo de señal
  let tipoSenal = '';
  let urgencia  = '';
  if (tipo === 'cruce_ema8_20_alcista' || (ema8 !== 'N/A' && ema20 !== 'N/A' && parseFloat(ema8) > parseFloat(ema20))) {
    tipoSenal = 'CRUCE ALCISTA EMA 8 x EMA 20';
    urgencia  = 'SEÑAL DE COMPRA DE CORTO PLAZO';
  } else if (tipo === 'cruce_ema8_20_bajista') {
    tipoSenal = 'CRUCE BAJISTA EMA 8 x EMA 20';
    urgencia  = 'SEÑAL DE VENTA DE CORTO PLAZO';
  } else if (tipo === 'golden_cross') {
    tipoSenal = 'GOLDEN CROSS — EMA 50 cruza EMA 200 HACIA ARRIBA';
    urgencia  = 'SEÑAL ALCISTA MAYOR — TENDENCIA DE LARGO PLAZO';
  } else if (tipo === 'death_cross') {
    tipoSenal = 'DEATH CROSS — EMA 50 cruza EMA 200 HACIA ABAJO';
    urgencia  = 'SEÑAL BAJISTA MAYOR — TENDENCIA DE LARGO PLAZO';
  } else {
    tipoSenal = tipo.toUpperCase();
    urgencia  = 'ALERTA DE MERCADO';
  }

  console.log('Generando analisis para:', tipoSenal);

  // Llamar a Claude para analisis
  const analisis = await llamarClaude(ticker, tipoSenal, urgencia, precio, ema8, ema20, ema50, ema200, volumen, intervalo, hora);

  // Enviar email
  await enviarEmail(ticker, tipoSenal, urgencia, precio, ema8, ema20, ema50, ema200, volumen, intervalo, hora, analisis);
}

// ============================================================
// LLAMAR A CLAUDE — analisis del momento
// ============================================================
async function llamarClaude(ticker, tipoSenal, urgencia, precio, ema8, ema20, ema50, ema200, volumen, intervalo, hora) {
  if (!ANTHROPIC_API_KEY) {
    console.log('Sin API key de Anthropic — saltando analisis');
    return 'API key no configurada. Configura ANTHROPIC_API_KEY en las variables de Railway.';
  }

  const prompt = `Eres analista tecnico experto. Una alerta acaba de activarse en TradingView.

ALERTA: ${tipoSenal}
Ticker: ${ticker}
Precio actual: $${precio}
EMA 8: $${ema8}
EMA 20: $${ema20}
EMA 50: $${ema50}
EMA 200: $${ema200}
Volumen: ${volumen}
Timeframe: ${intervalo}
Hora NY: ${hora}

Escribe un analisis profesional y conciso del momento actual con estas 5 secciones usando formato HTML simple con <b> y <br>:

1. <b>QUE ESTA PASANDO</b><br>
Explica el cruce o señal detectada y su significado tecnico.

2. <b>CONTEXTO DE MERCADO</b><br>
Que implica este cruce en el contexto actual. Es confiable la señal?

3. <b>PLAN DE ACCION INMEDIATO</b><br>
Si la señal es alcista: entrada sugerida, target y stop loss.
Si es bajista: nivel de salida, cobertura o espera.

4. <b>NIVELES CLAVE A VIGILAR</b><br>
3 niveles criticos para las proximas horas basados en las EMAs.

5. <b>RIESGO Y ADVERTENCIAS</b><br>
Que puede invalidar esta señal. Factores de riesgo.

Termina con: <br><i>Analisis generado automaticamente. Solo informativo — no constituye asesoramiento financiero.</i>`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await response.json();
    if (data.content && data.content[0]) { return data.content[0].text; }
    return 'Error obteniendo analisis de Claude.';
  } catch (e) {
    console.error('Error llamando a Claude:', e.message);
    return 'Error de conexion con Claude API.';
  }
}

// ============================================================
// ENVIAR EMAIL — via SendGrid
// ============================================================
async function enviarEmail(ticker, tipoSenal, urgencia, precio, ema8, ema20, ema50, ema200, volumen, intervalo, hora, analisis) {
  if (!SENDGRID_API_KEY) {
    console.log('Sin SendGrid API key — imprimiendo analisis en logs:');
    console.log('=== ANALISIS GENERADO ===');
    console.log(analisis);
    console.log('========================');
    return;
  }

  const esAlcista = tipoSenal.includes('ALCISTA') || tipoSenal.includes('GOLDEN');
  const colorHeader = esAlcista ? '#0d3d1e' : '#3d0d0d';
  const colorSenal  = esAlcista ? '#1a7a4a' : '#c0392b';
  const emoji       = esAlcista ? '🟢' : '🔴';

  const analisisHtml = (analisis || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
    .replace(/&lt;b&gt;/g, '<b>').replace(/&lt;\/b&gt;/g, '</b>')
    .replace(/&lt;br&gt;/g, '<br>').replace(/&lt;i&gt;/g, '<i>').replace(/&lt;\/i&gt;/g, '</i>');

  const html = `<!DOCTYPE html><html><head><meta charset='UTF-8'></head>
<body style='margin:0;padding:0;background:#f0f0f0;font-family:Arial,sans-serif;'>
<div style='max-width:680px;margin:20px auto;background:#fff;border-radius:12px;overflow:hidden;'>

<div style='background:${colorHeader};color:#fff;padding:20px 24px;'>
  <div style='font-size:11px;color:rgba(255,255,255,0.6);margin-bottom:4px;'>ALERTA AUTOMATICA TRADINGVIEW → CLAUDE AI</div>
  <h1 style='margin:0;font-size:20px;'>${emoji} ${ticker} — ${tipoSenal}</h1>
  <p style='margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.75);'>${urgencia} · ${hora}</p>
</div>

<div style='background:#f8f8f8;padding:12px 24px;border-bottom:1px solid #e0e0e0;display:flex;gap:16px;flex-wrap:wrap;'>
  <div style='text-align:center;'><div style='font-size:10px;color:#888;'>PRECIO</div><div style='font-size:20px;font-weight:bold;color:#333;'>$${precio}</div></div>
  <div style='text-align:center;'><div style='font-size:10px;color:#2980b9;'>EMA 8</div><div style='font-size:16px;font-weight:bold;color:#2980b9;'>$${ema8}</div></div>
  <div style='text-align:center;'><div style='font-size:10px;color:#8e44ad;'>EMA 20</div><div style='font-size:16px;font-weight:bold;color:#8e44ad;'>$${ema20}</div></div>
  <div style='text-align:center;'><div style='font-size:10px;color:#d35400;'>EMA 50</div><div style='font-size:16px;font-weight:bold;color:#d35400;'>$${ema50}</div></div>
  <div style='text-align:center;'><div style='font-size:10px;color:#c0392b;'>EMA 200</div><div style='font-size:16px;font-weight:bold;color:#c0392b;'>$${ema200}</div></div>
  <div style='text-align:center;'><div style='font-size:10px;color:#888;'>TIMEFRAME</div><div style='font-size:14px;font-weight:bold;color:#333;'>${intervalo}</div></div>
</div>

<div style='padding:20px 24px;'>
  <p style='font-size:11px;font-weight:bold;text-transform:uppercase;color:#888;margin:0 0 12px;'>Analisis generado por Claude AI</p>
  <div style='font-size:13px;line-height:1.9;color:#333;'>${analisisHtml}</div>
</div>

<div style='padding:12px 24px;background:#f5f5f5;font-size:11px;color:#999;text-align:center;'>
  Alerta automatica generada por TradingView + Claude AI · ${hora}<br>
  Solo informativo — NO constituye asesoramiento financiero ni recomendacion de inversion
</div>
</div></body></html>`;

  try {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + SENDGRID_API_KEY
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: EMAIL_DESTINO }] }],
        from: { email: '001taxecu@gmail.com', name: 'TradingView Alertas' },
        subject: `${emoji} ALERTA ${ticker}: ${tipoSenal} — $${precio}`,
        content: [{ type: 'text/html', value: html }]
      })
    });
    if (response.ok) {
      console.log('Email enviado exitosamente a', EMAIL_DESTINO);
    } else {
      const err = await response.text();
      console.error('Error enviando email:', err);
    }
  } catch (e) {
    console.error('Error de conexion con SendGrid:', e.message);
  }
}

// ============================================================
// RUTA DE PRUEBA
// ============================================================
app.get('/', (req, res) => {
  res.send('Servidor activo — esperando alertas de TradingView');
});

const PUERTO = process.env.PORT || 3000;
app.listen(PUERTO, () => {
  console.log('Servidor escuchando en puerto', PUERTO);
  console.log('Esperando alertas de TradingView...');
});