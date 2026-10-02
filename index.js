import makeWASocket, { useMultiFileAuthState, downloadMediaMessage, DisconnectReason } from '@whiskeysockets/baileys'
import express from 'express'
import QRCode from 'qrcode'
import P from 'pino'

const app = express()
const PORT = process.env.PORT || 10000
let qr = null
const store = new Map() // for anti-delete
const delay = ms => new Promise(r => setTimeout(r, ms))

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('auth')
  const sock = makeWASocket({
    auth: state,
    logger: P({ level: 'silent' }),
    browser: ['Dennis Bot', 'Chrome', '1.0']
  })
  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async (u) => {
    if (u.qr) qr = await QRCode.toDataURL(u.qr)
    if (u.connection === 'open') {
      qr = null
      console.log("BOT CONNECTED ✅")
    }
    if (u.connection === 'close' && u.lastDisconnect?.error?.output?.statusCode!== DisconnectReason.loggedOut) {
      setTimeout(start, 3000)
    }
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0]
    if (!msg.message) return
    const from = msg.key.remoteJid
    const isGroup = from.endsWith('@g.us')

    // 1. ANTI-DELETE
    if (msg.message.protocolMessage?.type === 0) {
      const saved = store.get(msg.message.protocolMessage.key.id)
      if (saved) {
        await sock.sendMessage(from, { text: `🗑️ *Anti-Delete* From: ${saved.name}` })
        if (saved.type === 'text') await sock.sendMessage(from, { text: `Deleted: ${saved.data}` })
        else if (saved.type === 'image') await sock.sendMessage(from, { image: saved.data, caption: `Deleted image from ${saved.name}` })
        else if (saved.type === 'video') await sock.sendMessage(from, { video: saved.data, caption: `Deleted video` })
      }
      return
    }

    // SAVE MESSAGES
    if (!msg.key.fromMe && from!== 'status@broadcast') {
      try {
        const id = msg.key.id
        const m = msg.message
        if (m.conversation || m.extendedTextMessage?.text) {
          store.set(id, { type: 'text', data: m.conversation || m.extendedTextMessage.text, name: msg.pushName })
        } else if (m.imageMessage &&!m.imageMessage.viewOnce) {
          const buf = await downloadMediaMessage(msg, 'buffer', {}, { logger: P({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage })
          store.set(id, { type: 'image', data: buf, name: msg.pushName })
        } else if (m.videoMessage &&!m.videoMessage.viewOnce) {
          const buf = await downloadMediaMessage(msg, 'buffer', {}, { logger: P({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage })
          store.set(id, { type: 'video', data: buf, name: msg.pushName })
        }
        if (store.size > 150) store.delete(store.keys().next().value)
      } catch {}
    }

    if (msg.key.fromMe) return

    // 2. STATUS LIKE + VIEW
    if (from === 'status@broadcast') {
      try {
        await sock.readMessages([msg.key])
        await sock.sendMessage(from, { react: { text: '❤️', key: msg.key } }, { statusJidList: [msg.key.participant] })
      } catch {}
      return
    }

    // 3. VIEW ONCE OPENER
    try {
      const vo = msg.message.viewOnceMessageV2 || msg.message.viewOnceMessage || msg.message.imageMessage?.viewOnce || msg.message.videoMessage?.viewOnce
      if (vo) {
        const buf = await downloadMediaMessage(msg, 'buffer', {}, { logger: P({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage })
        const inner = msg.message.viewOnceMessageV2?.message || msg.message.viewOnceMessage?.message || msg.message
        const isImg = inner.imageMessage || msg.message.imageMessage
        if (isImg) await sock.sendMessage(from, { image: buf, caption: `👁️ View Once Opened from ${msg.pushName}` })
        else await sock.sendMessage(from, { video: buf, caption: `👁️ View Once Opened from ${msg.pushName}` })
        return
      }
    } catch (e) { console.log("VO error") }

    // 4. FAKE TYPING + AUTO REPLY
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || ""
    if (!text) return

    // Tag all command
    if (text === '.tagall' && isGroup) {
      const meta = await sock.groupMetadata(from)
      let txt = ''
      let mentions = []
      for (let p of meta.participants) { txt += `@${p.id.split('@')[0]} `; mentions.push(p.id) }
      await sock.sendMessage(from, { text: txt, mentions })
      return
    }

    await sock.sendPresenceUpdate('composing', from)
    await delay(3500)
    await sock.sendPresenceUpdate('paused', from)
    await sock.sendMessage(from, { text: `Thanks for contacting Dennis i will be online soon 🙏` })
  })
}

app.get('/', (req, res) => {
  if (qr) res.send(`<img src="${qr}" width="300"><h3>Scan QR - Dennis Bot</h3><script>setTimeout(()=>location.reload(),25000)</script>`)
  else res.send(`<h1>✅ BOT ACTIVE</h1>View Once ✅<br>Anti-Delete ✅<br>Fake Typing ✅<br>Status Like ❤️ ✅<br>Tag All (.tagall) ✅`)
})

app.listen(PORT, () => start())
