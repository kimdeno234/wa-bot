const { default: makeWASocket, useMultiFileAuthState } = require("@whiskeysockets/baileys")
const pino = require("pino")
const fs = require("fs")

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth")
  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    browser: ["DENNIS TECH", "Chrome", "1.0"]
  })

  sock.ev.on("creds.update", saveCreds)

  if (!fs.existsSync("./auth/creds.json")) {
    let phone = process.env.PHONE_NUMBER || ""
    if(phone){
      setTimeout(async () => {
        try{
          let code = await sock.requestPairingCode(phone)
          console.log("PAIR CODE: " + code)
        }catch{}
      }, 4000)
    }
  }

  sock.ev.on("connection.update", (up) => {
    const { connection } = up
    if (connection === "open") console.log("✅ DENNIS BOT ACTIVE WITH FAKE TYPING")
    if (connection === "close") startBot()
  })

  sock.ev.on("messages.upsert", async (m) => {
    try {
      const msg = m.messages[0]
      if (!msg.message) return
      const jid = msg.key.remoteJid
      const push = msg.pushName || "there"
      if (msg.key.fromMe) return

      // AUTO TYPING FUNCTION
      const doTyping = async () => {
        await sock.sendPresenceUpdate('composing', jid)
        await new Promise(r => setTimeout(r, 2500))
      }

      // 1. ANTI-VIEWONCE
      let viewOnce = msg.message.viewOnceMessageV2 || msg.message.viewOnceMessage
      if (viewOnce) {
        await doTyping()
        let v = viewOnce.message
        await sock.sendMessage(jid, { forward: { key: msg.key, message: v } })
        await sock.sendMessage(jid, { text: "_ViewOnce Opened ✅ by DENNIS TECH_" })
      }

      // 2. GET TEXT
      let text = ""
      if (msg.message.conversation) text = msg.message.conversation
      if (msg.message.extendedTextMessage) text = msg.message.extendedTextMessage.text
      text = text.toLowerCase()

      // 3. AUTO REPLY WITH FAKE TYPING
      if (text === "hi" || text === "hello" || text === "hey" || text === "habari" || text === "sasa") {
        await doTyping()
        await sock.sendMessage(jid, { text: `Hello 👋\nThanks for contacting DENNIS TECH.\nI'm currently offline, I'll reply shortly.\n\nType *.menu* for services.\n\n_This is auto reply from bot 🤖_` })
      }

      if (text === ".menu" || text === "menu") {
        await doTyping()
        await sock.sendMessage(jid, { text: `*DENNIS TECH BOT MENU* 🤖\n\n*.ping* - speed\n*.alive* - status\n*.menu* - this menu\n\n✅ Auto Reply\n✅ Anti-ViewOnce\n✅ Fake Typing\n✅ 24/7 Active\n\nType.ping to test` })
      }

      if (text === ".ping") {
        await doTyping()
        await sock.sendMessage(jid, { text: "Pong! 80ms ⚡ DENNIS TECH BOT" })
      }

      if (text === ".alive") {
        await doTyping()
        await sock.sendMessage(jid, { text: "✅ DENNIS TECH BOT IS ALIVE 24/7\nFake Typing: ON\nAuto Reply: ON" })
      }

    } catch (e) { console.log(e) }
  })
}
startBot()
