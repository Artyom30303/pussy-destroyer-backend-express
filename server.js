const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
app.use(cors());

app.get("/api/analyze", async (req, res) => {
  const symbol = req.query.symbol || "BTCUSDT";

  try {
    const response = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=100`
    );
    const raw = await response.json();

    const candles = raw.map(c => ({
      openTime: c[0],
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
      volume: parseFloat(c[5])
    }));

    const closes = candles.map(c => c.close);
    const lastClose = closes[closes.length - 1];

    const rsi = calculateRSI(closes, 14);
    const lastRSI = rsi[rsi.length - 1];

    const ema21 = calculateEMA(closes, 21);
    const lastEMA = ema21[ema21.length - 1];

    const bos = lastClose > Math.max(...closes.slice(-6, -1));
    const choch = lastClose < Math.min(...closes.slice(-6, -1));

    let direction = "NONE";
    let argument = [];

    if (lastClose > lastEMA) argument.push("Цена выше EMA — бычий контекст");
    else argument.push("Цена ниже EMA — медвежий контекст");

    if (lastRSI < 30) argument.push("RSI в зоне перепроданности");
    else if (lastRSI > 70) argument.push("RSI в зоне перекупленности");
    else argument.push(`RSI нейтральный: ${lastRSI.toFixed(2)}`);

    if (bos) {
      direction = "LONG";
      argument.push("Break of Structure вверх");
    } else if (choch) {
      direction = "SHORT";
      argument.push("Change of Character вниз");
    }

    if (direction === "NONE") {
      return res.status(200).json({
        symbol,
        direction,
        confidence: 0,
        reason: ["Нет чёткого сигнала — боковик"]
      });
    }

    const entry = lastClose;
    const sl = direction === "LONG" ? +(entry * 0.985).toFixed(2) : +(entry * 1.015).toFixed(2);
    const tp1 = direction === "LONG" ? +(entry * 1.015).toFixed(2) : +(entry * 0.985).toFixed(2);

    const confidence =
      (direction === "LONG" && lastRSI < 40 && lastClose > lastEMA) ||
      (direction === "SHORT" && lastRSI > 60 && lastClose < lastEMA)
        ? 85 : 65;

    res.status(200).json({
      symbol,
      direction,
      confidence,
      entry,
      sl,
      tp1,
      reason: argument
    });

  } catch (err) {
    res.status(500).json({ error: "Ошибка анализа", details: err.message });
  }
});

function calculateRSI(closes, period = 14) {
  let gains = [], losses = [];

  for (let i = 1; i <= period; i++) {
    let diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains.push(diff);
    else losses.push(Math.abs(diff));
  }

  let avgGain = gains.reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.reduce((a, b) => a + b, 0) / period;

  let rsis = [];
  for (let i = period; i < closes.length; i++) {
    let change = closes[i] - closes[i - 1];
    let gain = change > 0 ? change : 0;
    let loss = change < 0 ? -change : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    let rs = avgGain / (avgLoss || 1);
    rsis.push(100 - 100 / (1 + rs));
  }

  return rsis;
}

function calculateEMA(closes, period = 21) {
  const k = 2 / (period + 1);
  let emaArray = [closes.slice(0, period).reduce((a, b) => a + b, 0) / period];

  for (let i = period; i < closes.length; i++) {
    const price = closes[i];
    const prevEma = emaArray[emaArray.length - 1];
    const ema = price * k + prevEma * (1 - k);
    emaArray.push(ema);
  }

  return emaArray;
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log("✅ Server running on port", port);
});
