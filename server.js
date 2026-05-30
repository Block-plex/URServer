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

testUpload();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let seed = Math.floor(Math.random() * 5000000);

let forumMessages = [];

app.use(express.static("public"));

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
