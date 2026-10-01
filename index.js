import makeWASocket, { useMultiFileAuthState, DisconnectReason, downloadMediaMessage } from '@whiskeysockets/baileys'
import express from 'express'
import QRCode from 'qrcode'
import P from 'pino'

const app = express()
let qrCodeData = null
let isConnected = false
const delay = ms => new Promise(r => setTimeout(r, ms))

// ===== EASY SETTINGS - CHANGE HERE =====
const AUTO_REPLY_TEXT = `Thanks for contacting Dennis i will be online soon`
const STATUS_EMOJIS = ['❤️', '🔥', '😍', '👏', '💯'] // change to only ['❤️'] if you want
const USE_RECORDING = true // true = shows 🎙️ recording, false = shows ⌨️ typing

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth')
  const sock = makeWASocket({
    auth: state,
    logger: P({ level: 'silent' }),
    printQRInTerminal: true
  })

  sock.ev.on('creds.update', saveCreds)
  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect, qr } = u
    if (qr) { qrCodeData = await QRCode.toDataURL(qr); isConnected = false }
    if (connection === 'open') { isConnected = true; qrCodeData = null; console.log("BOT CONNECTED") }
    if (connection === 'close') {
      isConnected = false
      if (lastDisconnect?.error?.output?.statusCode!== DisconnectReason.loggedOut) startBot()
    }
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0]
    if (!msg.message || msg.key.fromMe) return
    const from = msg.key.remoteJid

    // --- FUNCTION: FAKE PRESENCE ---
    async function fakePresence() {
      const presence = USE_RECORDING? 'recording' : 'composing'
      await sock.sendPresenceUpdate(presence, from)
      await delay(2500 + Math.random() * 2500)
      await sock.sendPresenceUpdate('paused', from)
    }

    // === 1. AUTO LIKE STATUS ===
    if (from === 'status@broadcast') {
      try {
        await sock.readMessages([msg.key])
        const emoji = STATUS_EMOJIS[Math.floor(Math.random() * STATUS_EMOJIS.length)]
        await sock.sendMessage(from, { react: { text: emoji, key: msg.key } }, { statusJidList: [msg.key.participant] })
        console.log(`Liked ${msg.key.participant} with ${emoji}`)
      } catch(e) {}
      return
    }

    // === 2. VIEW ONCE READER ===
    try {
      let viewOnceMsg = msg.message.viewOnceMessageV2?.message || msg.message.viewOnceMessage?.message
      if (viewOnceMsg) {
        await fakePresence()
        const mediaType = Object.keys(viewOnceMsg)[0]
        const buffer = await downloadMediaMessage(
          { message: viewOnceMsg, key: msg.key }, 'buffer', {},
          { logger: P({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
        )
        await sock.sendMessage(from, { text: `👁️ *View Once Opened by Dennis Bot*` })
        if (mediaType === 'imageMessage') await sock.sendMessage(from, { image: buffer, caption: `View Once Image` })
        if (mediaType === 'videoMessage') await sock.sendMessage(from, { video: buffer, caption: `View Once Video` })
        return
      }
    } catch(e) { console.log(e) }

    // === 3. AUTO REPLY ===
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || ""
    if (!text) return

    await fakePresence()
    await sock.sendMessage(from, { text: AUTO_REPLY_TEXT })
  })
}

app.get('/', (req, res) => {
  if (qrCodeData) res.send(`<h1 style="text-align:center">Scan QR Code</h1><div style="text-align:center"><img src="${qrCodeData}" style="width:300px"><p>WhatsApp > Linked Devices > Link a Device</p></div>`)
  else if (isConnected) res.send(`<h1 style="text-align:center">✅ Dennis Bot is LIVE</h1><p style="text-align:center">❤️ Auto Status Like | 👁️ View Once Reader | 🎙️ Fake Recording | 💬 Auto Reply<br><br>Reply Text: ${AUTO_REPLY_TEXT}</p>`)
  else res.send(`<h1>Starting... Refresh in 3 sec</h1><script>setTimeout(()=>location.reload(),3000)</script>`)
})

app.listen(10000, () => console.log("Running"))
startBot()
