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
      models: (process.env.OPENROUTER_MODELS || agent.model || process.env.OPENROUTER_MODEL || "openrouter/free").split(",").map(s => s.trim()).filter(Boolean),
      max_tokens: 1000,
      reasoning: { exclude: true },
      messages: [
        { role: "system", content: agent.system },
        { role: "user", content: transcript(history, agent) },
      ],
    }
  );
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error("Balasan kosong dari OpenRouter");
  console.log(`[${agent.name}] model: ${data.model}`);
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
