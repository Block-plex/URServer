const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const dgram = require("dgram");

const app = express();
const server = http.createServer(app);

// Serve /public folder
app.use(express.static("public"));

// WebSocket chat server
const wss = new WebSocket.Server({ server });

wss.on("connection", (ws) => {
    console.log("WS client connected");

    ws.on("message", (data) => {
        let msg;
        try { msg = JSON.parse(data); } catch { return; }

        if (msg.type === "chat") {
            const out = JSON.stringify({ type:"chat", text:msg.text });
            wss.clients.forEach(c => {
                if (c.readyState === WebSocket.OPEN) c.send(out);
            });
        }
    });
});

// UDP movement server
const udp = dgram.createSocket("udp4");
const players = new Map();

udp.on("message", (msg, rinfo) => {
    const parts = msg.toString().split(" ");
    if (parts[0] === "MOVE") {
        const id = parts[1];
        const x = parseFloat(parts[2]);
        const y = parseFloat(parts[3]);

        players.set(id, { x, y });

        const snapshot = [];
        for (const [pid, p] of players.entries()) {
            snapshot.push(`${pid}:${p.x},${p.y}`);
        }

        udp.send(Buffer.from("STATE " + snapshot.join("|")), rinfo.port, rinfo.address);
    }
});

// Ports
const HTTP_PORT = process.env.PORT || 3000;
const UDP_PORT = 40000;

server.listen(HTTP_PORT, () => console.log("HTTP/WS on", HTTP_PORT));
udp.bind(UDP_PORT, () => console.log("UDP on", UDP_PORT));
