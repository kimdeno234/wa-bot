import makeWASocket, { useMultiFileAuthState } from '@whiskeysockets/baileys'
import express from 'express'
import QRCode from 'qrcode'

const app = express()
let qr = null

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('auth')
  const sock = makeWASocket({ auth: state })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async (u) => {
    if (u.qr) {
      qr = await QRCode.toDataURL(u.qr)
      console.log("NEW QR - GO TO RENDER LINK TO SCAN")
    }
    if (u.connection === 'open') {
      console.log("CONNECTED!")
      qr = null
    }
  })

  sock.ev.on('messages.upsert', async (m) => {
    const msg = m.messages[0]
    if (!msg.message || msg.key.fromMe) return
    const from = msg.key.remoteJid
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || ""

    console.log("Got message:", text)

    // Simple reply
    await sock.sendMessage(from, { text: "Hello! Bot is working ✅" })
  })
}

app.get('/', (req, res) => {
  if (qr) res.send(`<img src="${qr}" width="300"><br><h2>Scan this QR</h2>`)
  else res.send("<h1>Bot Connected ✅</h1>")
})

app.listen(10000, () => {
  console.log("Server started on 10000")
  start()
})
