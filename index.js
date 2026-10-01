import makeWASocket, { useMultiFileAuthState, DisconnectReason, downloadMediaMessage } from '@whiskeysockets/baileys'
import express from 'express'
import QRCode from 'qrcode'
import P from 'pino'

const app = express()
let qrCodeData = null
const delay = ms => new Promise(r => setTimeout(r, ms))

// ===== CONFIG =====
const AUTO_REPLY = `Thanks for contacting Dennis he will reply soon 🙏`
const STATUS_EMOJI = '❤️'
const store = new Map() // for anti-delete

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth')
  const sock = makeWASocket({
    auth: state,
    logger: P({ level: 'silent' }),
    browser: ['Dennis Bot', 'Chrome', '1.0']
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async (u) => {
    const { qr, connection, lastDisconnect } = u
    if (qr) qrCodeData = await QRCode.toDataURL(qr)
    if (connection === 'open') {
      qrCodeData = null
      console.log("CONNECTED ✅")
    }
    if (connection === 'close') {
      if (lastDisconnect?.error?.output?.statusCode!== DisconnectReason.loggedOut) startBot()
    }
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0]
    if (!msg.message) return
    const from = msg.key.remoteJid
    const isGroup = from.endsWith('@g.us')

    // ===== 1. ANTI-DELETE =====
    if (msg.message.protocolMessage?.type === 0) {
      const delId = msg.message.protocolMessage.key.id
      const saved = store.get(delId)
      if (saved) {
        const who = saved.name || 'Someone'
        await sock.sendMessage(from, { text: `*🗑️ ANTI-DELETE*\n*From:* ${who}\n*Deleted:* ${saved.type}` })
        if (saved.type === 'text') await sock.sendMessage(from, { text: `> ${saved.data}` })
        else if (saved.type === 'image') await sock.sendMessage(from, { image: saved.data, caption: `Deleted image from ${who}` })
        else if (saved.type === 'video') await sock.sendMessage(from, { video: saved.data, caption: `Deleted video from ${who}` })
        else if (saved.type === 'voice') await sock.sendMessage(from, { audio: saved.data, ptt: true })
        else if (saved.type === 'sticker') await sock.sendMessage(from, { sticker: saved.data })
      }
      return
    }

    // SAVE FOR ANTI-DELETE
    if (!msg.key.fromMe && from!== 'status@broadcast') {
      try {
        const id = msg.key.id
        const m = msg.message
        if (m.conversation || m.extendedTextMessage?.text) {
          store.set(id, { type: 'text', data: m.conversation || m.extendedTextMessage.text, name: msg.pushName })
        } else if (m.imageMessage &&!m.imageMessage.viewOnce) {
          const b = await downloadMediaMessage(msg, 'buffer', {}, { logger: P({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage })
          store.set(id, { type: 'image', data: b, name: msg.pushName })
        } else if (m.videoMessage &&!m.videoMessage.viewOnce) {
          const b = await downloadMediaMessage(msg, 'buffer', {}, { logger: P({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage })
          store.set(id, { type: 'video', data: b, name: msg.pushName })
        } else if (m.audioMessage) {
          const b = await downloadMediaMessage(msg, 'buffer', {}, { logger: P({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage })
          store.set(id, { type: 'voice', data: b, name: msg.pushName })
        } else if (m.stickerMessage) {
          const b = await downloadMediaMessage(msg, 'buffer', {}, { logger: P({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage })
          store.set(id, { type: 'sticker', data: b, name: msg.pushName })
        }
        if (store.size > 100) store.delete(store.keys().next().value) // keep 100 only
      } catch {}
    }

    if (msg.key.fromMe) return

    // ===== 2. STATUS AUTO LIKE & VIEW =====
    if (from === 'status@broadcast') {
      try {
        await sock.readMessages([msg.key])
        await sock.sendMessage(from, { react: { text: STATUS_EMOJI, key: msg.key } }, { statusJidList: [msg.key.participant] })
      } catch {}
      return
    }

    // ===== 3. VIEW ONCE READER (FIXED FOR 2026) =====
    try {
      const hasVO = msg.message.viewOnceMessageV2 || msg.message.viewOnceMessage || msg.message.imageMessage?.viewOnce || msg.message.videoMessage?.viewOnce || msg.message.viewOnceMessageV2Extension
      if (hasVO) {
        const buf = await downloadMediaMessage(msg, 'buffer', {}, { logger: P({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage })
        const inner = msg.message.viewOnceMessageV2?.message || msg.message.viewOnceMessage?.message || msg.message
        const isImg = inner.imageMessage || msg.message.imageMessage
        if (isImg) await sock.sendMessage(from, { image: buf, caption: `👁️ *View Once Opened*\nFrom: ${msg.pushName}` })
        else await sock.sendMessage(from, { video: buf, caption: `👁️ *View Once Opened*\nFrom: ${msg.pushName}` })
        return
      }
    } catch (e) { console.log("VO error", e.message) }

    // ===== 4. FAKE TYPING + AUTO REPLY (PRIVATE & GROUP) =====
    const txt = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || ""
    if (!txt) return

    await sock.sendPresenceUpdate('composing', from)
    await delay(3500)
    await sock.sendPresenceUpdate('paused', from)
    await sock.sendMessage(from, { text: AUTO_REPLY })
  })
}

app.get('/', (req, res) => {
  if (qrCodeData) {
    res.send(`<html><body style="text-align:center;padding-top:50px"><h2>Scan to Connect Dennis Bot</h2><img src="${qrCodeData}" style="width:300px"><p>Refresh after scan</p></body></html>`)
  } else {
    res.send(`<h2>✅ Dennis Bot LIVE</h2><p>✅ Fake Typing Private+Groups<br>✅ Auto Reply Private+Groups<br>✅ View Once Reader<br>✅ Anti-Delete<br>✅ Status ❤️ Like</p>`)
  }
})

app.listen(10000, () => console.log("Running on 10000"))
startBot()
