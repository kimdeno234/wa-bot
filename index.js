import makeWASocket, { useMultiFileAuthState, DisconnectReason, downloadMediaMessage } from '@whiskeysockets/baileys'
import express from 'express'
import QRCode from 'qrcode'
import P from 'pino'

const app = express()
let qrCodeData = null
const delay = ms => new Promise(r => setTimeout(r, ms))

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

    // FAKE TYPING FOR BOTH PRIVATE AND GROUPS
    async function fakeTyping() {
      await sock.sendPresenceUpdate('composing', from)
      await delay(4000) // typing 4 seconds
      await sock.sendPresenceUpdate('paused', from)
    }

    // 1. STATUS LIKE
    if (from === 'status@broadcast') {
      try {
        await sock.readMessages([msg.key])
        await sock.sendMessage(from, { react: { text: '❤️', key: msg.key } }, { statusJidList: [msg.key.participant] })
      } catch(e) {}
      return
    }

    // 2. VIEW ONCE
    try {
      let vm = msg.message.viewOnceMessageV2?.message || msg.message.viewOnceMessage?.message
      if (vm) {
        await fakeTyping()
        const type = Object.keys(vm)[0]
        const buffer = await downloadMediaMessage({ message: vm, key: msg.key }, 'buffer', {}, { logger: P({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage })
        if (type === 'imageMessage') await sock.sendMessage(from, { image: buffer, caption: 'Opened' })
        else if (type === 'videoMessage') await sock.sendMessage(from, { video: buffer, caption: 'Opened' })
        return
      }
    } catch(e){}

    // 3. AUTO REPLY - PRIVATE + GROUPS
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || ""
    if (!text) return
    await fakeTyping()
    await sock.sendMessage(from, { text: AUTO_REPLY_TEXT })
  })
}

app.get('/', (req,res)=>{
  if(qrCodeData) res.send(`<img src="${qrCodeData}" style="width:300px">`)
  else res.send(`✅ LIVE - Fake Typing in Private & Groups + Status Like + View Once`)
})

app.listen(10000, ()=>console.log("ON"))
startBot()
