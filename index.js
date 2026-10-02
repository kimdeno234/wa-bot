i8import makeWASocket, { useMultiFileAuthState, downloadMediaMessage, DisconnectReason } from '@whiskeysockets/baileys'
import express from 'express'
import QRCode from 'qrcode'
import P from 'pino'

const app = express()
const PORT = process.env.PORT || 10000
let qr = null
const db = new Map()
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('auth')
  const sock = makeWASocket({
    auth: state,
    logger: P({ level: 'silent' }),
    browser: ['Dennis', 'Chrome', '1.0'],
    syncFullHistory: false,
    markOnlineOnConnect: false
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async (a) => {
    if (a.qr) qr = await QRCode.toDataURL(a.qr)
    if (a.connection === 'open') {
      qr = null
      console.log('BOT ACTIVE')
    }
    if (a.connection === 'close') {
      const c = a.lastDisconnect?.error?.output?.statusCode
      if (c!== DisconnectReason.loggedOut) setTimeout(start, 3000)
    }
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const m = messages[0]
    if (!m.message) return
    const jid = m.key.remoteJid
    const push = m.pushName || 'User'

    // ANTI DELETE
    if (m.message.protocolMessage && m.message.protocolMessage.type === 0) {
      const old = db.get(m.message.protocolMessage.key.id)
      if (old) {
        try {
          await sock.sendMessage(jid, { text: `*ANTIDELETE* from ${old.push}` })
          if (old.type === 'text') await sock.sendMessage(jid, { text: old.data })
          if (old.type === 'img') await sock.sendMessage(jid, { image: old.data, caption: `Deleted img from ${old.push}` })
          if (old.type === 'vid') await sock.sendMessage(jid, { video: old.data, caption: `Deleted vid` })
          if (old.type === 'stick') await sock.sendMessage(jid, { sticker: old.data })
        } catch {}
      }
      return
    }

    // SAVE FOR ANTI DELETE
    if (!m.key.fromMe && jid!== 'status@broadcast') {
      try {
        const id = m.key.id
        const t = m.message.conversation || m.message.extendedTextMessage?.text
        if (t) db.set(id, { type: 'text', data: t, push })
        if (m.message.imageMessage &&!m.message.imageMessage.viewOnce) {
          const buf = await downloadMediaMessage(m, 'buffer', {}, { logger: P({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage })
          db.set(id, { type: 'img', data: buf, push })
        }
        if (m.message.videoMessage &&!m.message.videoMessage.viewOnce) {
          const buf = await downloadMediaMessage(m, 'buffer', {}, { logger: P({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage })
          db.set(id, { type: 'vid', data: buf, push })
        }
        if (m.message.stickerMessage) {
          const buf = await downloadMediaMessage(m, 'buffer', {}, { logger: P({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage })
          db.set(id, { type: 'stick', data: buf, push })
        }
      } catch {}
    }

    if (m.key.fromMe) return

    // STATUS LIKE
    if (jid === 'status@broadcast') {
      try {
        await sock.readMessages([m.key])
        await sock.sendMessage(jid, { react: { text: '❤️', key: m.key } }, { statusJidList: [m.key.participant] })
      } catch {}
      return
    }

    // VIEW ONCE OPENER
    try {
      let vo = null
      if (m.message.viewOnceMessageV2) vo = m.message.viewOnceMessageV2.message
      else if (m.message.viewOnceMessage) vo = m.message.viewOnceMessage.message
      else if (m.message.imageMessage?.viewOnce || m.message.videoMessage?.viewOnce || m.message.audioMessage?.viewOnce) vo = m.message

      if (vo) {
        const buf = await downloadMediaMessage({ key: m.key, message: vo }, 'buffer', {}, { logger: P({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage })
        if (buf) {
          if (vo.imageMessage) await sock.sendMessage(jid, { image: buf, caption: `*VIEW ONCE* from ${push}` })
          if (vo.videoMessage) await sock.sendMessage(jid, { video: buf, caption: `*VIEW ONCE* from ${push}` })
          if (vo.audioMessage) await sock.sendMessage(jid, { audio: buf, mimetype: 'audio/ogg; codecs=opus', ptt: true })
        }
        return
      }
    } catch (e) { console.log('vo err', e.message) }

    const text = m.message.conversation || m.message.extendedTextMessage?.text || m.message.imageMessage?.caption || ''
    if (!text) return

    // COMMANDS
    if (text === '.ping') {
      await sock.sendMessage(jid, { text: `Pong! Active ✅` })
      return
    }
    if (text === '.menu') {
      await sock.sendMessage(jid, { text: `*DENNIS BOT MENU*\n\n.ping\n.tagall\n.menu\n\nAuto:\n- ViewOnce opener\n- AntiDelete\n- Status view+like\n- Typing + Reply` })
      return
    }
    if (text === '.tagall' && jid.endsWith('@g.us')) {
      const meta = await sock.groupMetadata(jid)
      const mems = meta.participants.map(p => p.id)
      let out = ''
      mems.forEach(x => out += `@${x.split('@')[0]} `)
      await sock.sendMessage(jid, { text: out, mentions: mems })
      return
    }

    // AUTO REPLY + TYPING
    await sock.sendPresenceUpdate('composing', jid)
    await sleep(3000)
    await sock.sendPresenceUpdate('paused', jid)
    await sock.sendMessage(jid, { text: `Hi ${push} 👋\nBot Active ✅\nType.menu` })
  })
}

app.get('/', (req, res) => {
  if (qr) {
    res.send(`<center><h2>SCAN QR - DENNIS BOT</h2><img src="${qr}" width="320" style="border:10px solid #000;border-radius:20px"><p>WhatsApp > Linked Devices > Link</p><script>setTimeout(()=>location.reload(),20000)</script></center>`)
  } else {
    res.send(`<center><h1>BOT ACTIVE ✅</h1><p>ViewOnce</p><p>AntiDelete</p><p>Status Like</p><p>TagAll Ping Menu</p><p>Typing AutoReply</p></center>`)
  }
})

app.listen(PORT, () => {
  console.log('Port ' + PORT)
  start()
})
