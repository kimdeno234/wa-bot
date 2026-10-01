import makeWASocket, { useMultiFileAuthState, DisconnectReason, downloadMediaMessage } from '@whiskeysockets/baileys'
import express from 'express'
import QRCode from 'qrcode'
import P from 'pino'

const app = express()
let qrCodeData = null
const delay = ms => new Promise(r => setTimeout(r, ms))

// PUT YOUR OWN NUMBER HERE TO RECEIVE VIEW ONCE - format 254...
const OWNER_JID = '254182629455@s.whatsapp.net'
const AUTO_REPLY_TEXT = `Thanks for contacting Dennis i will be online soon`

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth')
  const sock = makeWASocket({ auth: state, logger: P({ level: 'silent' }) })

  sock.ev.on('creds.update', saveCreds)
  sock.ev.on('connection.update', async (u) => {
    if (u.qr) qrCodeData = await QRCode.toDataURL(u.qr)
    if (u.connection === 'open') qrCodeData = null
    if (u.connection === 'close' && u.lastDisconnect?.error?.output?.statusCode!== DisconnectReason.loggedOut) startBot()
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0]
    if (!msg.message || msg.key.fromMe) return
    const from = msg.key.remoteJid
    const isGroup = from.endsWith('@g.us')
    const senderName = msg.pushName || 'Someone'

    // ===== 1. VIEW ONCE READER - MAIN =====
    try {
      let viewOnce = msg.message.viewOnceMessageV2?.message || msg.message.viewOnceMessage?.message || msg.message.viewOnceMessageV2Extension?.message

      if (viewOnce) {
        console.log("View Once detected!")
        await sock.sendPresenceUpdate('composing', from)
        await delay(2000)

        const mediaType = Object.keys(viewOnce)[0] // imageMessage or videoMessage or audio
        const buffer = await downloadMediaMessage(
          { message: viewOnce, key: msg.key },
          'buffer',
          {},
          { logger: P({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
        )

        const caption = `👁️ *View Once Opened*\nFrom: ${senderName}\nChat: ${isGroup? from : 'Private'}`

        // Send to you (owner) + back to chat
        if (mediaType === 'imageMessage') {
          await sock.sendMessage(from, { image: buffer, caption: caption })
        } else if (mediaType === 'videoMessage') {
          await sock.sendMessage(from, { video: buffer, caption: caption })
        } else if (mediaType === 'audioMessage') {
          await sock.sendMessage(from, { audio: buffer, ptt: true })
        }

        // Also send a copy to your own DM so you save it forever
        // await sock.sendMessage(OWNER_JID, { image: buffer, caption: caption }) // uncomment if you want copy

        return // stop here, don't auto reply for view once
      }
    } catch(e) {
      console.log("View Once error:", e.message)
    }

    // ===== 2. STATUS LIKE =====
    if (from === 'status@broadcast') {
      try {
        await sock.readMessages([msg.key])
        await sock.sendMessage(from, { react: { text: '❤️', key: msg.key } }, { statusJidList: [msg.key.participant] })
      } catch(e) {}
      return
    }

    // ===== 3. AUTO REPLY WITH FAKE TYPING - PRIVATE + GROUP =====
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || ""
    if (!text) return

    await sock.sendPresenceUpdate('composing', from)
    await delay(3500)
    await sock.sendPresenceUpdate('paused', from)
    await sock.sendMessage(from, { text: AUTO_REPLY_TEXT })
  })
}

app.get('/', (req,res)=>{
  if(qrCodeData) res.send(`<img src="${qrCodeData}" style="width:300px">`)
  else res.send(`✅ View Once Reader LIVE - Works in Private + Groups`)
})

app.listen(10000)
startBot()
