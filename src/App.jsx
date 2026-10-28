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
function renderMentions(text, agents, keyPrefix) {
  const names = agents.map((a) => a.name).join("|");
  if (!names) return [text];
  const parts = text.split(new RegExp(`(@(?:${names})\\b)`, "gi"));
  return parts.map((p, i) =>
    p.startsWith("@") ? <span key={`${keyPrefix}-${i}`} className="mention">{p}</span> : p
  );
}

// Teks di antara `backtick` jadi kode inline; sisanya tetap dicek @mention
function renderText(text, agents) {
  const parts = text.split(/(`[^`\n]+`)/g);
  return parts.flatMap((p, i) =>
    p.length > 2 && p.startsWith("`") && p.endsWith("`")
      ? [<code key={i} className="inline-code">{p.slice(1, -1)}</code>]
      : renderMentions(p, agents, i)
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
