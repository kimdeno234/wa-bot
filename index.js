import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys'
import express from 'express'
import QRCode from 'qrcode'
import P from 'pino'

const app = express()
let qrCodeData = null

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth')

  const sock = makeWASocket({
    auth: state,
    logger: P({ level: 'silent' }),
    printQRInTerminal: true
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update
    if (qr) {
      qrCodeData = await QRCode.toDataURL(qr)
      console.log("QR GENERATED - Open your website to scan")
    }
    if (connection === 'open') {
      console.log("BOT CONNECTED!")
      qrCodeData = null
    }
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode!== DisconnectReason.loggedOut
      if (shouldReconnect) startBot()
    }
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0]
    if (!msg.message || msg.key.fromMe) return

    const from = msg.key.remoteJid
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || ""

    console.log("Message:", text)

    // Auto reply logic - change this text to what you want!
    await sock.sendMessage(from, { text: `Hello! You said: ${text}\n\nI am your auto-bot 🤖` })
  })
}

app.get('/', async (req, res) => {
  if (qrCodeData) {
    res.send(`<h1>Scan QR with WhatsApp</h1><p>WhatsApp > Linked Devices > Link Device</p><img src="${qrCodeData}" style="width:300px"><br><br><a href="/">Refresh</a><script>setTimeout(()=>location.reload(), 5000)</script>`)
  } else {
    res.send(`<h1>Bot is Running!</h1><p>If not connected, QR will show here in 10 seconds. Refresh.</p><a href="/">Refresh</a>`)
  }
})

app.listen(10000, () => console.log("Server on 10000"))
startBot()
