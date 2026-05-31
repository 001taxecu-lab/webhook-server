const express = require('express');
const app = express();

app.use(express.json());

app.post('/webhook', (req, res) => {
  const datos = req.body;

  console.log('=================================');
  console.log('ALERTA RECIBIDA DE TRADINGVIEW:');
  console.log('Ticker:', datos.ticker);
  console.log('Accion:', datos.accion);
  console.log('Precio:', datos.precio);
  console.log('Volumen:', datos.volumen);
  console.log('Fecha/Hora:', new Date().toLocaleString());
  console.log('=================================');

  res.status(200).json({ recibido: true });
});

app.get('/', (req, res) => {
  res.send('Servidor activo');
});

const PUERTO = 3000;
app.listen(PUERTO, () => {
  console.log('Servidor escuchando en puerto', PUERTO);
  console.log('Esperando alertas de TradingView...');
});