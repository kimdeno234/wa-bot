import makeWASocket, { useMultiFileAuthState, downloadMediaMessage, DisconnectReason } from '@whiskeysockets/baileys'
import express from 'express'
import QRCode from 'qrcode'
import P from 'pino'

const app = express()
const PORT = process.env.PORT || 10000
let qr = null
const store = new Map() // for antidelete
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function startBot(){
const { state, saveCreds } = await useMultiFileAuthState('auth')
const sock = makeWASocket({
auth: state,
logger: P({level:'silent'}),
browser:['Dennis Bot','Chrome','1.0'],
markOnlineOnConnect:false,
syncFullHistory:false
})
sock.ev.on('creds.update', saveCreds)
sock.ev.on('connection.update', async u=>{
if(u.qr) qr = await QRCode.toDataURL(u.qr)
if(u.connection==='open'){ qr=null; console.log('BOT ACTIVE ✅') }
if(u.connection==='close'){
const c = u.lastDisconnect?.error?.output?.statusCode
if(c!==DisconnectReason.loggedOut) setTimeout(startBot,3000)
}
})

sock.ev.on('messages.upsert', async ({messages})=>{
const msg = messages[0]
if(!msg.message) return
const from = msg.key.remoteJid
const isGroup = from.endsWith('@g.us')

// 1. ANTI DELETE
if(msg.message.protocolMessage?.type===0){
const deleted = store.get(msg.message.protocolMessage.key.id)
if(deleted){
try{
await sock.sendMessage(from,{text:`*🗑️ ANTI-DELETE*\n*From:* ${deleted.name}\n*Time:* ${new Date().toLocaleString()}`})
if(deleted.type==='text') await sock.sendMessage(from,{text:`*Deleted:* ${deleted.data}`})
if(deleted.type==='image') await sock.sendMessage(from,{image:deleted.data,caption:`*Deleted Image from ${deleted.name}*`})
if(deleted.type==='video') await sock.sendMessage(from,{video:deleted.data,caption:`*Deleted Video*`})
if(deleted.type==='sticker') await sock.sendMessage(from,{sticker:deleted.data})
if(deleted.type==='voice') await sock.sendMessage(from,{audio:deleted.data,mimetype:'audio/ogg; codecs=opus',ptt:true})
}catch{}
}
return
}

// SAVE MESSAGES
if(!msg.key.fromMe && from!=='status@broadcast'){
try{
const id = msg.key.id
const name = msg.pushName||'Unknown'
if(msg.message.conversation || msg.message.extendedTextMessage?.text){
store.set(id,{type:'text',data:msg.message.conversation||msg.message.extendedTextMessage.text,name})
}else if(msg.message.imageMessage &&!msg.message.imageMessage.viewOnce){
const b = await downloadMediaMessage(msg,'buffer',{},{logger:P({level:'silent'}),reuploadRequest:sock.updateMediaMessage})
store.set(id,{type:'image',data:b,name})
}else if(msg.message.videoMessage &&!msg.message.videoMessage.viewOnce){
const b = await downloadMediaMessage(msg,'buffer',{},{logger:P({level:'silent'}),reuploadRequest:sock.updateMediaMessage})
store.set(id,{type:'video',data:b,name})
}else if(msg.message.stickerMessage){
const b = await downloadMediaMessage(msg,'buffer',{},{logger:P({level:'silent'}),reuploadRequest:sock.updateMediaMessage})
store.set(id,{type:'sticker',data:b,name})
}else if(msg.message.audioMessage){
const b = await downloadMediaMessage(msg,'buffer',{},{logger:P({level:'silent'}),reuploadRequest:sock.updateMediaMessage})
store.set(id,{type:'voice',data:b,name})
}
if(store.size>300) store.delete(store.keys().next().value)
}catch{}
}
if(msg.key.fromMe) return

// 2. STATUS VIEW + LIKE
if(from==='status@broadcast'){
try{
await sock.readMessages([msg.key])
await sock.sendMessage(from,{react:{text:'❤️',key:msg.key}},{statusJidList:[msg.key.participant]})
}catch{}
return
}

// 3. VIEW ONCE - 100% WORKING
try{
let vo = null
if(msg.message.viewOnceMessageV2) vo = msg.message.viewOnceMessageV2.message
else if(msg.message.viewOnceMessage) vo = msg.message.viewOnceMessage.message
else if(msg.message.imageMessage?.viewOnce || msg.message.videoMessage?.viewOnce || msg.message.audioMessage?.viewOnce) vo = msg.message
if(vo){
console.log('VIEW ONCE FOUND')
const buf = await downloadMediaMessage({key:msg.key,message:vo},'buffer',{},{logger:P({level:'silent'}),reuploadRequest:sock.updateMediaMessage})
if(buf){
if(vo.imageMessage) await sock.sendMessage(from,{image:buf,caption:`👁️ *VIEW ONCE OPENED*\nFrom: ${msg.pushName}`})
if(vo.videoMessage) await sock.sendMessage(from,{video:buf,caption:`👁️ *VIEW ONCE OPENED*\nFrom: ${msg.pushName}`})
if(vo.audioMessage) await sock.sendMessage(from,{audio:buf,mimetype:'audio/ogg; codecs=opus',ptt:true})
}
return
}
}catch(e){ console.log('VO ERR',e.message) }

// 4. COMMANDS
const text = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || msg.message.videoMessage?.caption || ''
const args = text.trim().split(/ +/)

if(text.startsWith('.tagall') && isGroup){
const meta = await sock.groupMetadata(from)
const mems = meta.participants.map(p=>p.id)
let t=`*Dennis Bot Tag All*\n*Group:* ${meta.subject}\n*Total:* ${mems.length}\n\n`
mems.forEach(m=> t+=`@${m.split('@')[0]} `)
await sock.sendMessage(from,{text:t,mentions:mems})
return
}
if(text.toLowerCase()==='.ping'){
await sock.sendMessage(from,{text:`*Pong!* 🏓\nSpeed: ${Date.now()- (msg.messageTimestamp*1000)}ms\nBot: Active ✅`})
return
}
if(text.toLowerCase()==='.menu'){
await sock.sendMessage(from,{text:`*DENNIS BOT MENU*\n\n✅.ping - speed\n✅.tagall - tag all members\n✅ View Once opener - auto\n✅ Anti-Delete - auto\n✅ Status Like ❤️ - auto\n✅ Auto Reply - auto\n✅ Fake Typing - auto\n\n*Bot by Dennis +254182629455*`})
return
}

if(!text) return
// 5. FAKE TYPING + AUTO REPLY
await sock.sendPresenceUpdate('composing',from)
await sleep(3500)
await sock.sendPresenceUpdate('paused',from)
await sock.sendMessage(from,{text:`Hi ${msg.pushName} 👋\nI'm Dennis Bot\n\nYour message: "${text.slice(0,50)}"\n\nI'll reply soon 🙏\nType *.menu* for commands\n\n_✅ Online_`} )
})
}

app.get('/',(req,res)=>{
if(qr) res.send(`<center><h2>DENNIS BOT QR</h2><img src="${qr}" width="300" style="border:10px solid black;border-radius:20px"><p>WhatsApp > Linked Devices > Link > Scan</p><script>setTimeout(()=>location.reload(),20000)</script></center>`)
else res.send(`<center style="font-family:sans-serif;padding:20px"><h1>✅ BOT ACTIVE</h1><p>View Once ✅</p><p>Anti-Delete Text/Image/Video/Sticker/Voice ✅</p><p>Status Like + View ✅</p><p>Fake Typing ✅</p><p>Auto Reply ✅</p><p>.tagall.ping.menu ✅</p></center>`)
})
app.listen(PORT,()=>{console.log(PORT); startBot()})
