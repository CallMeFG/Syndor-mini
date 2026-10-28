import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { generateReply } from "./providers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "messages.json");
const PORT = Number(process.env.PORT || 3001);
const MAX_HOPS = Number(process.env.MAX_HOPS || 3);
const USER_NAME = process.env.USER_NAME || "Kamu";
const PROVIDER = (process.env.PROVIDER || "mock").toLowerCase();

const agents = JSON.parse(readFileSync(path.join(__dirname, "agents.json"), "utf8"));
const channels = [
  { id: "launch", name: "launch", kind: "channel" },
  { id: "general", name: "general", kind: "channel" },
  ...agents.map((a) => ({ id: `dm-${a.id}`, name: a.name, kind: "dm", agentId: a.id })),
];

// ---------- Penyimpanan sederhana (file JSON) ----------
let messages = [];
if (existsSync(DATA_FILE)) {
  try { messages = JSON.parse(readFileSync(DATA_FILE, "utf8")); } catch { messages = []; }
}
let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(DATA_FILE, JSON.stringify(messages.slice(-500), null, 2));
  }, 300);
}

let seq = Date.now();
function addMessage(msg) {
  const full = { id: String(seq++), ts: Date.now(), ...msg };
  messages.push(full);
  io.emit("message", full);
  save();
  return full;
}

// ---------- Deteksi @mention ----------
function mentionedAgents(text) {
  const found = [];
  for (const a of agents) {
    const re = new RegExp(`@${a.name}\\b`, "i");
    if (re.test(text) && !found.includes(a)) found.push(a);
  }
  return found;
}

// Antrian per channel supaya agent menjawab bergiliran, tidak tumpang tindih.
const queues = new Map();
function enqueue(channelId, job) {
  const prev = queues.get(channelId) || Promise.resolve();
  const next = prev.then(job).catch((e) => console.error(e));
  queues.set(channelId, next);
  return next;
}

// `done` = agent yang sudah menjawab di putaran ini, supaya tidak menjawab dua kali.
async function runAgent(agent, channelId, hop, done) {
  if (done.has(agent.id)) return;
  done.add(agent.id);
  io.emit("typing", { channelId, agentId: agent.id, typing: true });
  try {
    const history = messages
      .filter((m) => m.channelId === channelId)
      .slice(-20)
      .map((m) => ({ author: m.authorName, text: m.text }));
    const text = await generateReply(agent, history);
    const msg = addMessage({
      channelId, authorId: agent.id, authorName: agent.name, kind: "agent", text,
    });
    // Agent menyebut agent lain -> oper tugas (dibatasi MAX_HOPS agar tidak looping)
    if (hop < MAX_HOPS) {
      for (const next of mentionedAgents(msg.text)) {
        await runAgent(next, channelId, hop + 1, done);
      }
    }
  } catch (err) {
    console.error(`[${agent.name}]`, err.message);
    addMessage({
      channelId, authorId: "system", authorName: "System", kind: "system",
      text: `${agent.name} gagal menjawab: ${err.message}`,
    });
  } finally {
    io.emit("typing", { channelId, agentId: agent.id, typing: false });
  }
}

// ---------- HTTP + Socket.IO ----------
const app = express();
app.get("/api/health", (_req, res) => res.json({ ok: true, provider: PROVIDER }));

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

io.on("connection", (socket) => {
  socket.emit("init", {
    me: { id: "user", name: USER_NAME },
    agents: agents.map(({ system, ...rest }) => rest),
    channels,
    messages,
    provider: PROVIDER,
  });

  socket.on("send", ({ channelId, text }) => {
    text = String(text || "").trim().slice(0, 4000);
    const channel = channels.find((c) => c.id === channelId);
    if (!text || !channel) return;

    addMessage({ channelId, authorId: "user", authorName: USER_NAME, kind: "user", text });

    // Di DM agent selalu menjawab; di channel hanya agent yang di-@mention.
    const targets = channel.kind === "dm"
      ? agents.filter((a) => a.id === channel.agentId)
      : mentionedAgents(text);

    enqueue(channelId, async () => {
      const done = new Set();
      for (const agent of targets) await runAgent(agent, channelId, 0, done);
    });
  });

  socket.on("clear", ({ channelId }) => {
    messages = messages.filter((m) => m.channelId !== channelId);
    save();
    io.emit("cleared", { channelId });
  });
});

// Mode produksi: sajikan hasil build frontend (npm run build lalu npm start)
const dist = path.join(__dirname, "..", "dist");
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get("/{*splat}", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

httpServer.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} sudah dipakai. Ganti PORT di .env atau tutup proses lain.`);
    process.exit(1);
  }
  throw err;
});

httpServer.listen(PORT, () => {
  console.log(`Server Syndor Mini jalan di http://localhost:${PORT} (provider: ${PROVIDER})`);
});
