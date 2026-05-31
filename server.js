const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand
} = require("@aws-sdk/client-s3");

const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.ACCESS_KEY,
        secretAccessKey: process.env.SECRET_ACCESS_KEY
    }
});
const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
    }
});

async function sendVerificationEmail(email, code) {
    await transporter.sendMail({
        from: `"badgrr games" <${process.env.GMAIL_USER}>`,
        to: email,
        subject: "Your badgrr verification code!",
        html: `
        <div style="font-family: Verdana; margin: 10px; padding: 5px; border: 1px solid #ccc; text-align: center;">
          <h1>Hi!</h1>
          <hr>
          <h3>Your one step away from starting your account. </h3>
          <h2>Please enter this verification code in the website:</h2>
          <h1><b>${code}</b></h1>
          <hr>
          <p>badgrr games</p>
        </div>
        `
    });
}


async function testUpload() {
    const command = new PutObjectCommand({
        Bucket: "users",
        Key: "test.txt",
        Body: "Hello R2!"
    });

    await s3.send(command);
    console.log("Uploaded test.txt");
}


async function testRead() {
    const command = new GetObjectCommand({
        Bucket: "users",
        Key: "test.txt"
    });

    const response = await s3.send(command);
    const text = await response.Body.transformToString();

    console.log("Read from R2:", text);
}

function validateSignup({ username, password, email }) {

    // 8 — fields not filled in
    if (!username || !password || !email) {
        return { ok: false, code: 8 };
    }

    // 2 — email not valid at all
    const emailFormat = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
    if (!emailFormat.test(email)) {
        return { ok: false, code: 2 };
    }

    // 1 — email is not Gmail
    const gmailOnly = /^[A-Za-z0-9._%+-]+@gmail\.com$/;
    if (!gmailOnly.test(email)) {
        return { ok: false, code: 1 };
    }

    // 6 — username wrong length
    if (username.length < 3 || username.length > 15) {
        return { ok: false, code: 6 };
    }

    // 7 — username has spaces or unsupported symbols
    const usernameRegex = /^[A-Za-z0-9_]+$/;
    if (!usernameRegex.test(username)) {
        return { ok: false, code: 7 };
    }

    // 3 — password wrong length
    if (password.length < 8 || password.length > 20) {
        return { ok: false, code: 3 };
    }

    // 4 — password has spaces
    if (password.includes(" ")) {
        return { ok: false, code: 4 };
    }

    // 5 — password too unsecure
    const uniqueChars = new Set(password).size;
    if (uniqueChars < 4) {
        return { ok: false, code: 5 };
    }

    // 0 — wait for verify code
    return { ok: true, code: 0 };
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let seed = Math.floor(Math.random() * 5000000);

let forumMessages = [];

app.use(express.static("public"));

const pendingVerifications = new Map();

const players = new Map(); // id -> { x, y, ws }

function broadcast(obj) {
  const data = JSON.stringify(obj);
  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) c.send(data);
  });
}

wss.on("connection", (ws) => {
  console.log("WS client connected");

  for (let i = 0; i < forumMessages.length; i++) {
    ws.send(JSON.stringify(forumMessages[i]));
  }

  broadcast({ type: "seed", seed: seed});

  ws.on("message", (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    console.log(msg);

    if (msg.type === "chat") {
      broadcast({ type: "chat", from: msg.from || "unknown", text: msg.text });
    }

    if (msg.type === "move") {
      const { id, x, y } = msg;
      if (!id) return;
      players.set(id, { x, y, ws });

      // send full state to everyone
      const state = {};
      for (const [pid, p] of players.entries()) {
        state[pid] = { x: p.x, y: p.y };
      }
      broadcast({ type: "state", players: state });
    }
    if(msg.type === "forum") {
      console.log("Forum message:", msg.text);
      forumMessages.push({ type: "forum", from: msg.from || "unknown", text: msg.text, likes: 0, dislikes: 0 });
      broadcast({ type: "forum", from: msg.from || "unknown", text: msg.text, likes: 0, dislikes: 0 });
    }
    if(msg.type === "reply") {
      console.log("Forum message (reply):", msg.text);
      forumMessages.push({ type: "reply", from: msg.from || "unknown", text: msg.text, likes: 0, dislikes: 0 , replying: msg.replyingTo });
      broadcast({ type: "reply", from: msg.from || "unknown", text: msg.text, likes: 0, dislikes: 0 , replying: msg.replyingTo });
    }
    if(msg.type === "like") {
      for(let i = 0; i < forumMessages.length; i++) {
        if(forumMessages[i].text === msg.text) {
          forumMessages[i].likes++;
          broadcast({ type: "like", count: forumMessages[i].likes, text: forumMessages[i].text });
          break;
        }
      }
    }
    if(msg.type === "dislike") {
      for(let i = 0; i < forumMessages.length; i++) {
        if(forumMessages[i].text === msg.text) {
          forumMessages[i].dislikes++;
          broadcast({ type: "dislike", count: forumMessages[i].dislikes, text: forumMessages[i].text });
          break;
        }
      }
    }
    if(msg.type === "signup") {
      const { username, password, email } = msg;
      const validation = validateSignup({ username, password, email });
      if (!validation.ok) {
        const code = generateCode();
        try {
          await sendVerificationEmail(email, code);
        } catch (err) {
          console.error("Email failed:", err);
        }

        pendingVerifications.set(email, { code, username, password });
        ws.send(JSON.stringify({ type: "signup", ok: false, code: validation.code }));
        return;
      }else {
        ws.send(JSON.stringify({ type: "signup", ok: true, code: 0 }));
      }
    }
  });

  ws.on("close", () => {
    // optional: remove player entries whose ws === this ws
    for (const [id, p] of players.entries()) {
      if (p.ws === ws) players.delete(id);
    }
    console.log("WS client disconnected");
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("HTTP/WS on", PORT));
