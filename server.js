const express = require("express");
const http = require("http");
const WebSocket = require("ws");

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
      forumMessages.push({ type: "forum", from: msg.from || "unknown", text: msg.text });
      broadcast({ type: "forum", from: msg.from || "unknown", text: msg.text });
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
