# CLAUDE.md — Build Syndor Mini (chat tim: user + AI agent)

Dokumen ini adalah instruksi kerja untuk Claude Code. Baca sampai habis sebelum mulai.

## Tujuan
Membangun **Syndor Mini**: aplikasi chat seperti Syndor (syndor.dev), satu ruang chat berisi user dan beberapa AI agent. Agent dipanggil dengan `@mention`, membalas atas namanya sendiri, dan bisa saling oper tugas (contoh: Claude pegang frontend, lalu menulis `@Codex` untuk minta Codex cek API).

**Definisi selesai:** `npm run dev` jalan tanpa error, `http://localhost:5173` menampilkan UI (sidebar Channels/People/Agents, header channel, daftar pesan, kotak input), dan mengirim `@Claude @Codex ayo selesaikan halaman login` di #launch menghasilkan balasan Claude lalu Codex, masing-masing **satu kali**.

## Keputusan yang sudah ditetapkan (jangan diubah tanpa izin user)
| Aspek | Pilihan |
|---|---|
| Sistem | Windows, terminal PowerShell |
| Frontend | Vite 8 + React 19, **JavaScript (JSX), bukan TypeScript** |
| Backend | Node.js + Express 5 + Socket.IO 4.8 (chat realtime) |
| Cara agent hidup | Server yang memanggil API model (bukan MCP). Versi MCP = tahap 2 |
| Provider AI | `mock` dulu (tanpa API key), lalu OpenRouter gratis dengan daftar model berurutan di `OPENROUTER_MODELS` (model utama + cadangan; fallback `openrouter/free`) |
| Panggilan API | `fetch` bawaan Node, tanpa SDK (hindari error beda versi) |
| Penyimpanan | File `data/messages.json` (tanpa database) |

Kode di bawah sudah diuji jalan (build sukses, UI tampil, alur oper agent benar). **Tulis file persis seperti isinya**; jangan refactor, ganti library, atau tambah TypeScript/Tailwind.

## Aturan kerja
1. Kerjakan langkah berurutan. Setelah tiap langkah, cek hasilnya sebelum lanjut.
2. Pakai perintah PowerShell. Jangan pakai `rm -rf`, `export`, atau `&&` gaya bash (PowerShell 5 tidak mendukung `&&`; jalankan perintah satu per satu).
3. Jangan pernah menampilkan atau commit isi `.env` (berisi API key).
4. Kalau error, cek bagian **Troubleshooting** dulu. Jangan menurunkan/menaikkan versi paket secara acak.
5. Laporkan ke user dalam Bahasa Indonesia, singkat, tanpa kata ganti orang pertama.

## Langkah 0 — Cek prasyarat
```powershell
node -v
npm -v
```
- Node wajib **v20.19+ atau v22.12+** (syarat Vite 8). Kalau lebih rendah atau `node` tidak dikenal: minta user install Node LTS dari https://nodejs.org, tutup lalu buka lagi terminal, ulangi cek.
- Kalau `npm` error "running scripts is disabled on this system", jalankan sekali:
  `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` (konfirmasi ke user dulu).

## Langkah 1 — Buat struktur folder
Di folder kerja saat ini (folder tempat CLAUDE.md ini berada):
```powershell
New-Item -ItemType Directory -Force server, src, data | Out-Null
```
Struktur akhir:
```
./
├─ CLAUDE.md
├─ package.json
├─ vite.config.js
├─ index.html
├─ .env.example
├─ .env            (salinan .env.example, tidak di-commit)
├─ .gitignore
├─ server/
│  ├─ index.js     (Express + Socket.IO + orkestrasi @mention)
│  ├─ providers.js (mock / OpenRouter / Anthropic)
│  └─ agents.json  (daftar agent + persona)
├─ src/
│  ├─ main.jsx
│  ├─ App.jsx      (seluruh UI)
│  └─ styles.css
└─ data/           (messages.json dibuat otomatis)
```

## Langkah 2 — Tulis semua file
Buat setiap file di bawah dengan isi persis.

### 2.1 `package.json`
````json
{
  "name": "syndor-mini",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "engines": {
    "node": ">=20.19.0"
  },
  "scripts": {
    "dev": "concurrently -k -n server,web -c cyan,magenta \"npm:dev:server\" \"npm:dev:web\"",
    "dev:server": "node --watch server/index.js",
    "dev:web": "vite",
    "build": "vite build",
    "start": "node server/index.js"
  },
  "dependencies": {
    "dotenv": "^18.0.9",
    "express": "^5.3.0",
    "react": "^19.3.1",
    "react-dom": "^19.3.1",
    "socket.io": "^4.8.4",
    "socket.io-client": "^4.8.4"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^6.1.2",
    "concurrently": "^10.0.6",
    "vite": "^8.3.5"
  }
}
````

### 2.2 `vite.config.js`
````js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Semua request /socket.io dan /api diteruskan ke server Node (port 3001),
// jadi frontend cukup dibuka di http://localhost:5173 tanpa masalah CORS.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/socket.io": { target: "http://localhost:3001", ws: true },
      "/api": "http://localhost:3001",
    },
  },
});
````

### 2.3 `index.html`
````html
<!doctype html>
<html lang="id">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Syndor Mini</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
````

### 2.4 `.env.example`
````ini
# Salin file ini menjadi .env lalu isi sesuai kebutuhan.

# Nama yang tampil sebagai user di chat
USER_NAME=Farizal

# Pilihan provider: mock | openrouter | anthropic
#  - mock       : tanpa API key, balasan contoh (pakai ini dulu untuk cek UI)
#  - openrouter : satu key untuk banyak model, ada model gratis (openrouter/free)
#  - anthropic  : langsung ke Claude API
PROVIDER=mock

# --- OpenRouter (https://openrouter.ai/keys) ---
OPENROUTER_API_KEY=
# Model default untuk semua agent kalau agents.json tidak mengatur model
OPENROUTER_MODEL=openrouter/free

# --- Anthropic (https://platform.claude.com) ---
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-haiku-5-5

# Batas berapa kali agent boleh saling oper (@mention) dalam satu putaran
MAX_HOPS=3

PORT=3001
````

### 2.5 `.gitignore`
````text
node_modules
dist
.env
data/messages.json
````

### 2.6 `server/agents.json`
````json
[
  {
    "id": "claude",
    "name": "Claude",
    "color": "#d97757",
    "role": "Frontend engineer",
    "system": "Kamu adalah Claude, agent di workspace tim bernama Syndor Mini. Peranmu: frontend engineer (UI, React, CSS). Rekan agent: @Codex (backend/API). Jawab singkat seperti chat tim (maks 3 kalimat), dalam bahasa yang dipakai user. Kalau ada bagian yang bukan keahlianmu, oper dengan menulis @Codex beserta permintaan jelas. Jangan mention @Codex kalau tidak perlu."
  },
  {
    "id": "codex",
    "name": "Codex",
    "color": "#4f6bd8",
    "role": "Backend engineer",
    "system": "Kamu adalah Codex, agent di workspace tim bernama Syndor Mini. Peranmu: backend engineer (API, database, autentikasi). Rekan agent: @Claude (frontend). Jawab singkat seperti chat tim (maks 3 kalimat), dalam bahasa yang dipakai user. Oper ke @Claude hanya kalau benar-benar butuh bantuan frontend."
  }
]
````

### 2.7 `server/providers.js`
````js
// Pemanggil model AI. Sengaja memakai fetch bawaan Node (tanpa SDK)
// supaya tidak ada error karena beda versi paket.
//
// Riwayat chat dikirim sebagai SATU pesan user berisi transkrip.
// Cara ini menghindari error "roles must alternate" di Anthropic API
// dan tetap jalan di semua model OpenRouter.

const TIMEOUT_MS = 60_000;

function transcript(history, agent) {
  const lines = history.map((m) => `${m.author}: ${m.text}`).join("\n");
  return (
    `Berikut riwayat terbaru di channel ini:\n\n${lines}\n\n` +
    `Tulis balasan berikutnya sebagai ${agent.name}. ` +
    `Tulis isi pesannya saja, tanpa awalan "${agent.name}:".`
  );
}

async function postJSON(url, headers, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error?.message || JSON.stringify(data).slice(0, 300);
      throw new Error(`HTTP ${res.status}: ${msg}`);
    }
    return data;
  } catch (err) {
    if (err.name === "AbortError") throw new Error("Timeout: model tidak menjawab dalam 60 detik");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenRouter(agent, history) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY kosong di file .env");
  const data = await postJSON(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      Authorization: `Bearer ${key}`,
      "HTTP-Referer": "http://localhost:5173",
      "X-OpenRouter-Title": "Syndor Mini",
    },
    {
      model: agent.model || process.env.OPENROUTER_MODEL || "openrouter/free",
      max_tokens: 400,
      messages: [
        { role: "system", content: agent.system },
        { role: "user", content: transcript(history, agent) },
      ],
    }
  );
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error("Balasan kosong dari OpenRouter");
  return text.trim();
}

async function callAnthropic(agent, history) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY kosong di file .env");
  const data = await postJSON(
    "https://api.anthropic.com/v1/messages",
    { "x-api-key": key, "anthropic-version": "2023-06-01" },
    {
      model: agent.model || process.env.ANTHROPIC_MODEL || "claude-haiku-5-5",
      max_tokens: 400,
      system: agent.system,
      messages: [{ role: "user", content: transcript(history, agent) }],
    }
  );
  const text = (data?.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  if (!text) throw new Error("Balasan kosong dari Anthropic");
  return text;
}

// Mode tanpa API key: balasan contoh untuk mengetes UI dan alur oper-tugas.
async function callMock(agent, history) {
  await new Promise((r) => setTimeout(r, 900 + Math.random() * 600));
  const last = history[history.length - 1]?.text || "";
  if (agent.id === "claude") {
    return /api|backend|server|login|database/i.test(last)
      ? "Bagian frontend aku pegang: form login, validasi input, dan state loading. @Codex bisa cek endpoint API-nya?"
      : "Siap, aku kerjakan sisi UI-nya dulu. (mode mock — isi API key di .env untuk jawaban asli)";
  }
  return "Oke, endpoint POST /api/login aku siapkan dengan validasi token. Nanti kabari kalau butuh format respons lain. (mode mock)";
}

export async function generateReply(agent, history) {
  const provider = (process.env.PROVIDER || "mock").toLowerCase();
  if (provider === "openrouter") return callOpenRouter(agent, history);
  if (provider === "anthropic") return callAnthropic(agent, history);
  return callMock(agent, history);
}
````

### 2.8 `server/index.js`
````js
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
````

### 2.9 `src/main.jsx`
````jsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
````

### 2.10 `src/App.jsx`
````jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";

// Satu koneksi untuk seluruh aplikasi. Path relatif -> lewat proxy Vite.
const socket = io({ autoConnect: false });

function Avatar({ name, color, square }) {
  return (
    <span className={`avatar ${square ? "square" : ""}`} style={{ background: color || "#6b7280" }}>
      {name?.[0]?.toUpperCase()}
    </span>
  );
}

// Tebalkan @Nama di dalam teks pesan
function renderText(text, agents) {
  const names = agents.map((a) => a.name).join("|");
  if (!names) return text;
  const parts = text.split(new RegExp(`(@(?:${names})\\b)`, "gi"));
  return parts.map((p, i) =>
    p.startsWith("@") ? <span key={i} className="mention">{p}</span> : p
  );
}

export default function App() {
  const [connected, setConnected] = useState(false);
  const [me, setMe] = useState(null);
  const [agents, setAgents] = useState([]);
  const [channels, setChannels] = useState([]);
  const [messages, setMessages] = useState([]);
  const [provider, setProvider] = useState("");
  const [active, setActive] = useState("launch");
  const [typing, setTyping] = useState({}); // { "channelId:agentId": true }
  const [draft, setDraft] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    socket.connect();
    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    socket.on("init", (d) => {
      setMe(d.me); setAgents(d.agents); setChannels(d.channels);
      setMessages(d.messages); setProvider(d.provider);
    });
    socket.on("message", (m) =>
      setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]))
    );
    socket.on("typing", ({ channelId, agentId, typing: t }) =>
      setTyping((prev) => ({ ...prev, [`${channelId}:${agentId}`]: t }))
    );
    socket.on("cleared", ({ channelId }) =>
      setMessages((prev) => prev.filter((m) => m.channelId !== channelId))
    );
    return () => { socket.removeAllListeners(); socket.disconnect(); };
  }, []);

  const channel = channels.find((c) => c.id === active);
  const visible = useMemo(() => messages.filter((m) => m.channelId === active), [messages, active]);
  const typingAgents = agents.filter((a) => typing[`${active}:${a.id}`]);
  const agentById = (id) => agents.find((a) => a.id === id);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [visible.length, typingAgents.length]);

  // Autocomplete @mention: aktif kalau kata terakhir diawali "@"
  const mentionQuery = draft.match(/@(\w*)$/)?.[1];
  const suggestions = mentionQuery !== undefined
    ? agents.filter((a) => a.name.toLowerCase().startsWith(mentionQuery.toLowerCase()))
    : [];

  function pickMention(agent) {
    setDraft((d) => d.replace(/@(\w*)$/, `@${agent.name} `));
    inputRef.current?.focus();
  }

  function send(e) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || !connected) return;
    socket.emit("send", { channelId: active, text });
    setDraft("");
  }

  function onKeyDown(e) {
    if (e.key === "Tab" && suggestions.length) { e.preventDefault(); pickMention(suggestions[0]); }
    else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  }

  const title = channel?.kind === "dm" ? channel.name : `# ${channel?.name ?? ""}`;
  const members = channel?.kind === "dm"
    ? [me?.name, channel.name]
    : [me?.name, ...agents.map((a) => a.name)];

  function selectChannel(id) { setActive(id); setMenuOpen(false); }

  return (
    <div className="app">
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <div className="brand">SYNDOR <span>mini</span></div>

        <div className="section">Channels</div>
        {channels.filter((c) => c.kind === "channel").map((c) => (
          <button key={c.id} className={`item ${active === c.id ? "active" : ""}`} onClick={() => selectChannel(c.id)}>
            <span className="hash">#</span>{c.name}
          </button>
        ))}

        <div className="section">People</div>
        {me && (
          <div className="item static"><Avatar name={me.name} />{me.name}<span className="you">you</span></div>
        )}

        <div className="section">Agents</div>
        {channels.filter((c) => c.kind === "dm").map((c) => {
          const a = agentById(c.agentId);
          return (
            <button key={c.id} className={`item ${active === c.id ? "active" : ""}`} onClick={() => selectChannel(c.id)}>
              <Avatar name={a?.name} color={a?.color} square />
              <span className="grow">{c.name}</span>
              <span className="role">{a?.role}</span>
            </button>
          );
        })}

        <div className="status">
          <span className={`dot ${connected ? "on" : ""}`} />
          {connected ? "Terhubung" : "Menghubungkan…"}
          {provider && <span className="provider">{provider}</span>}
        </div>
      </aside>

      {menuOpen && <div className="scrim" onClick={() => setMenuOpen(false)} />}

      <main className="main">
        <header className="topbar">
          <button className="menu" onClick={() => setMenuOpen(true)} aria-label="Menu">☰</button>
          <h1>{title}</h1>
          <span className="members">{members.filter(Boolean).join(" · ")}</span>
          <button className="clear" onClick={() => socket.emit("clear", { channelId: active })} title="Hapus riwayat channel ini">
            Bersihkan
          </button>
        </header>

        <div className="messages" ref={listRef}>
          {visible.length === 0 && (
            <div className="empty">
              <p>Belum ada pesan di {title}.</p>
              <p className="hint">
                {channel?.kind === "dm"
                  ? `Tulis apa saja, ${channel.name} akan membalas.`
                  : "Coba: @Claude @Codex ayo selesaikan halaman login."}
              </p>
            </div>
          )}

          {visible.map((m) => {
            const a = agentById(m.authorId);
            if (m.kind === "system") return <div key={m.id} className="system">{m.text}</div>;
            return (
              <div key={m.id} className="msg">
                <Avatar name={m.authorName} color={a?.color} square={m.kind === "agent"} />
                <div className="body">
                  <div className="meta">
                    <strong>{m.authorName}</strong>
                    {m.kind === "agent" && <span className="badge">Agent</span>}
                    {m.kind === "user" && <span className="badge">You</span>}
                    <time>{new Date(m.ts).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</time>
                  </div>
                  <div className="text">{renderText(m.text, agents)}</div>
                </div>
              </div>
            );
          })}

          {typingAgents.map((a) => (
            <div key={a.id} className="msg typing">
              <Avatar name={a.name} color={a.color} square />
              <div className="body">
                <div className="meta"><strong>{a.name}</strong><span className="badge">Agent</span></div>
                <div className="dots"><i /><i /><i /></div>
              </div>
            </div>
          ))}
        </div>

        <form className="composer" onSubmit={send}>
          {suggestions.length > 0 && (
            <div className="suggest">
              {suggestions.map((a) => (
                <button type="button" key={a.id} onClick={() => pickMention(a)}>
                  <Avatar name={a.name} color={a.color} square /> {a.name} <span className="role">{a.role}</span>
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={channel?.kind === "dm" ? `Pesan ke ${channel.name}` : `Pesan ke ${title} — ketik @ untuk memanggil agent`}
          />
          <button type="submit" disabled={!draft.trim() || !connected}>Kirim</button>
        </form>
      </main>
    </div>
  );
}
````

### 2.11 `src/styles.css`
````css
:root {
  --bg: #ffffff;
  --side: #f4f4f6;
  --ink: #1d1d22;
  --muted: #6b6b76;
  --line: #e6e6ea;
  --accent: #d97757;
  --hover: #eaeaee;
  --bubble: #f7f7f9;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #17171b; --side: #1f1f24; --ink: #ececf1; --muted: #9a9aa6;
    --line: #2c2c33; --hover: #2a2a31; --bubble: #222228;
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
body { font-family: Inter, system-ui, sans-serif; background: var(--bg); color: var(--ink); font-size: 14px; }
button { font: inherit; color: inherit; cursor: pointer; }

.app { display: grid; grid-template-columns: 240px 1fr; height: 100%; }

/* Sidebar */
.sidebar { background: var(--side); border-right: 1px solid var(--line); padding: 16px 10px; display: flex; flex-direction: column; gap: 2px; overflow-y: auto; }
.brand { font-weight: 700; letter-spacing: .08em; font-size: 15px; padding: 4px 8px 14px; }
.brand span { font-weight: 500; letter-spacing: 0; color: var(--muted); font-size: 12px; }
.section { font-size: 12px; color: var(--muted); padding: 14px 8px 6px; }
.item { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; background: none; border: 0; border-radius: 6px; padding: 7px 8px; }
.item:hover { background: var(--hover); }
.item.active { background: var(--bg); box-shadow: 0 1px 2px rgba(0,0,0,.06); font-weight: 600; }
.item.static { cursor: default; }
.item.static:hover { background: none; }
.hash { color: var(--muted); width: 22px; text-align: center; }
.grow { flex: 1; }
.role { font-size: 11px; color: var(--muted); font-weight: 400; }
.you { font-size: 11px; color: var(--muted); margin-left: auto; }
.status { margin-top: auto; display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); padding: 12px 8px 0; border-top: 1px solid var(--line); }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #d4a017; }
.dot.on { background: #22a06b; }
.provider { margin-left: auto; background: var(--hover); padding: 2px 6px; border-radius: 4px; }

.avatar { width: 22px; height: 22px; border-radius: 50%; display: inline-grid; place-items: center; color: #fff; font-size: 11px; font-weight: 600; flex: none; }
.avatar.square { border-radius: 5px; }

/* Main */
.main { display: flex; flex-direction: column; min-width: 0; height: 100%; }
.topbar { display: flex; align-items: center; gap: 12px; padding: 14px 20px; border-bottom: 1px solid var(--line); }
.topbar h1 { font-size: 16px; margin: 0; }
.members { color: var(--muted); font-size: 12px; margin-left: auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.clear { background: none; border: 1px solid var(--line); border-radius: 6px; padding: 4px 10px; font-size: 12px; color: var(--muted); }
.clear:hover { background: var(--hover); }
.menu { display: none; background: none; border: 0; font-size: 18px; padding: 0 4px; }

.messages { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 18px; }
.empty { margin: auto; text-align: center; color: var(--muted); }
.hint { font-size: 13px; background: var(--bubble); padding: 8px 12px; border-radius: 8px; display: inline-block; }
.msg { display: flex; gap: 12px; }
.msg .avatar { width: 34px; height: 34px; font-size: 14px; }
.msg .avatar.square { border-radius: 8px; }
.body { min-width: 0; }
.meta { display: flex; align-items: baseline; gap: 8px; margin-bottom: 3px; }
.meta time { font-size: 11px; color: var(--muted); }
.badge { font-size: 10px; color: var(--muted); border: 1px solid var(--line); border-radius: 4px; padding: 0 5px; }
.text { line-height: 1.55; white-space: pre-wrap; word-break: break-word; font-size: 15px; }
.mention { color: var(--accent); font-weight: 600; }
.system { align-self: center; font-size: 12px; color: #c0392b; background: rgba(192,57,43,.08); padding: 6px 12px; border-radius: 6px; max-width: 90%; }

.dots { display: flex; gap: 4px; padding: 8px 0; }
.dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--muted); animation: blink 1.2s infinite; }
.dots i:nth-child(2) { animation-delay: .2s; }
.dots i:nth-child(3) { animation-delay: .4s; }
@keyframes blink { 0%, 80%, 100% { opacity: .25 } 40% { opacity: 1 } }

/* Composer */
.composer { position: relative; display: flex; gap: 8px; padding: 14px 20px 18px; border-top: 1px solid var(--line); }
.composer textarea { flex: 1; resize: none; border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; font: inherit; font-size: 14px; background: var(--bg); color: var(--ink); max-height: 140px; }
.composer textarea:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
.composer > button { background: var(--ink); color: var(--bg); border: 0; border-radius: 8px; padding: 0 16px; font-weight: 600; }
.composer > button:disabled { opacity: .35; cursor: default; }
.suggest { position: absolute; bottom: calc(100% - 6px); left: 20px; background: var(--bg); border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,.12); padding: 4px; min-width: 220px; }
.suggest button { display: flex; align-items: center; gap: 8px; width: 100%; background: none; border: 0; padding: 7px 8px; border-radius: 6px; text-align: left; }
.suggest button:hover, .suggest button:first-child { background: var(--hover); }
.suggest .role { margin-left: auto; }

/* Layar sempit (HP) */
@media (max-width: 720px) {
  .app { grid-template-columns: 1fr; }
  .sidebar { position: fixed; inset: 0 auto 0 0; width: 260px; z-index: 20; transform: translateX(-100%); transition: transform .2s; }
  .sidebar.open { transform: none; }
  .scrim { position: fixed; inset: 0; background: rgba(0,0,0,.35); z-index: 10; }
  .menu { display: block; }
  .members { display: none; }
  .clear { margin-left: auto; }
  .messages, .composer, .topbar { padding-left: 16px; padding-right: 16px; }
}
````


## Langkah 3 — Buat `.env` dan install
```powershell
Copy-Item .env.example .env
npm install
```
Pastikan output akhir tanpa `ERR!`. Peringatan `npm WARN` atau "packages are looking for funding" boleh diabaikan.

## Langkah 4 — Uji build lalu jalankan (mode mock)
```powershell
npm run build
```
Harus berakhir dengan `✓ built in ...`. Lalu:
```powershell
npm run dev
```
Tunggu sampai muncul dua baris ini:
- `[web] ➜ Local: http://localhost:5173/`
- `[server] Server Syndor Mini jalan di http://localhost:3001 (provider: mock)`

`npm run dev` adalah proses yang terus berjalan. Jalankan di background atau minta user menjalankannya di terminal terpisah, jangan menunggu prosesnya selesai.

## Langkah 5 — Verifikasi UI
Minta user membuka `http://localhost:5173` di browser, lalu cek checklist ini:
- [ ] Sidebar kiri: SYNDOR mini, Channels (#launch, #general), People (nama user), Agents (Claude, Codex).
- [ ] Pojok kiri bawah: titik hijau "Terhubung" dan label `mock`.
- [ ] Ketik `@Co`, lalu muncul popup saran Codex. Tab atau klik mengisi `@Codex `.
- [ ] Kirim `@Claude @Codex ayo selesaikan halaman login`. Muncul titik-titik mengetik, lalu Claude membalas (sambil menyebut @Codex), lalu Codex membalas. **Codex hanya sekali.**
- [ ] Klik agent Claude di sidebar (DM), kirim "halo". Claude membalas tanpa perlu di-mention.
- [ ] Tombol "Bersihkan" mengosongkan channel aktif.
- [ ] Refresh halaman, riwayat chat tetap ada.

Kalau semua lolos, laporkan ke user bahwa tahap UI selesai.

## Langkah 6 — Sambungkan ke AI asli (OpenRouter gratis)
Jalankan hanya setelah Langkah 5 lolos dan user setuju.
1. User membuat akun dan API key di https://openrouter.ai/keys. Tidak perlu kartu.
2. User sendiri yang mengisi `.env`. Jangan minta key-nya ditempel ke chat.
   ```
   PROVIDER=openrouter
   OPENROUTER_API_KEY=sk-or-...
   OPENROUTER_MODEL=openrouter/free
   ```
3. Hentikan `npm run dev` (Ctrl+C) lalu jalankan lagi. Perubahan `.env` baru terbaca setelah restart. Label di pojok kiri bawah berubah jadi `openrouter`.
4. Ulangi tes kirim pesan. Kalau muncul pesan merah "gagal menjawab", baca isi errornya di Troubleshooting.

Catatan batas gratis OpenRouter: sekitar 20 request/menit dan 50 request/hari. Satu pesan yang memanggil 2 agent memakai 2 request. Kalau habis, muncul error 429; tunggu besok atau ganti `PROVIDER=mock`.

Opsional: memakai Claude API langsung dengan `PROVIDER=anthropic`, `ANTHROPIC_API_KEY=...`, `ANTHROPIC_MODEL=claude-haiku-5-5` (berbayar per token).

## Troubleshooting
| Gejala | Penyebab & solusi |
|---|---|
| `Vite requires Node.js version 20.19+ or 22.12+` | Node terlalu lama. Install Node LTS terbaru, buka terminal baru. |
| `running scripts is disabled on this system` | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| `Port 3001 sudah dipakai` / `EADDRINUSE` | Ada server lama masih jalan. Tutup terminal lama, atau `Get-NetTCPConnection -LocalPort 3001` lalu `Stop-Process -Id <OwningProcess>`, atau ganti `PORT` di `.env` **dan** target di `vite.config.js`. |
| Port 5173 dipakai | Vite otomatis pindah ke 5174; buka URL yang tercetak di terminal. |
| UI tampil tapi "Menghubungkan…" terus | Server (`[server]`) belum jalan atau crash. Cek log terminal baris `[server]`. |
| `HTTP 401` | API key salah/kosong. Cek `.env`, tanpa spasi atau tanda kutip, lalu restart. |
| `HTTP 402` | Saldo OpenRouter negatif; berlaku juga untuk model gratis. |
| `HTTP 429` / Rate limit | Kuota gratis habis. Tunggu, atau pakai `mock`. |
| `HTTP 404` model | Nama model salah. Kembalikan ke `openrouter/free`. |
| `Timeout` | Model gratis sedang sibuk. Kirim ulang. |
| Balasan berisi catatan berpikir / terpotong | Model reasoning terpilih; kunci `OPENROUTER_MODEL` ke model non-reasoning, `reasoning.exclude` sudah aktif. |
| Balasan aneh seperti "User Safety: safe" | Router `openrouter/free` memilih model safety/guard/classifier. Isi `OPENROUTER_MODELS` dengan daftar model chat (dipisah koma) supaya router tidak memilih acak. Nama model terpakai tercetak di log `[server] [Agent] model: ...`. |
| `Balasan kosong dari OpenRouter` | Model gratis tidak mengembalikan teks. Kirim ulang, atau isi `OPENROUTER_MODELS` dengan model utama + cadangan; OpenRouter otomatis pindah ke model berikutnya kalau model pertama gagal. |
| Agent saling balas terus | Turunkan `MAX_HOPS` di `.env` (default 3). |
| `npm install` gagal di jaringan kampus | Coba jaringan lain/hotspot, lalu `npm cache clean --force` dan ulangi. |

## Cara kerja singkat (untuk dijelaskan ke user bila ditanya)
- **Socket.IO**: browser dan server terhubung terus-menerus, jadi pesan dan status "mengetik" muncul realtime tanpa refresh.
- **Aturan menjawab**: di channel hanya agent yang di-@mention yang menjawab; di DM agent selalu menjawab.
- **Oper tugas**: kalau balasan agent menyebut `@AgentLain`, agent itu ikut menjawab. Dibatasi `MAX_HOPS` dan set `done` supaya tiap agent maksimal sekali per putaran.
- **Antrian per channel**: agent menjawab bergiliran, tidak tumpang tindih.
- **Riwayat ke model**: 20 pesan terakhir dikirim sebagai satu transkrip. Ini menghindari error urutan role di API.
- **Menambah agent**: tambah objek baru di `server/agents.json` (`id`, `name`, `color`, `role`, `system`, opsional `model`), lalu restart server.

## Tahap berikutnya (jangan dikerjakan tanpa diminta user)
1. Streaming balasan token per token.
2. Endpoint MCP per agent (seperti Syndor asli) supaya Claude Code bisa "masuk" ke chat.
3. Mode Mixture of Agents: 2 agent menjawab paralel, 1 agent merangkum.
4. Deploy (contoh: `npm run build` lalu `npm start` di satu server).
