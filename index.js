const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const app = express();
app.use(bodyParser.json());
const TOKEN = process.env.TOKEN;
const PHONE_ID = process.env.PHONE_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
app.get('/webhook', (req, res) => {
  if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
    res.send(req.query['hub.challenge']);
  } else {
    res.sendStatus(403);
  }
});
app.post('/webhook', async (req, res) => {
  const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (msg) {
    const from = msg.from;
    const text = msg.text?.body?.toLowerCase() || "";
    let reply = "Hi 👋 Njwanga ni ya punda, mayai ni ya kuku 😂\n\n1. Price\n2. Location";
    if (text.includes("1")) reply = "Price: Ksh 500";
    if (text.includes("2")) reply = "Nairobi CBD";
    await axios.post(`https://graph.facebook.com/v19.0/${PHONE_ID}/messages`, {
      messaging_product: "whatsapp", to: from, text: { body: reply }
    }, { headers: { Authorization: `Bearer ${TOKEN}` } });
  }
  res.sendStatus(200);
});
app.get('/', (req,res)=> res.send("Bot is running!"));
app.listen(10000, () => console.log("Bot running"));
