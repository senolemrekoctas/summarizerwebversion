import express from "express";
import cors from "cors";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// --- Türkçe stopword listesi ---
const TR_STOPWORDS = new Set([
  "acaba","ama","aslında","az","bazı","belki","biri","birkaç","birçok","böyle","bu","çok","çünkü","da","daha","de","defa","diye","eğer","en","gibi","hem","hep","hepsi","her","hiç","ile","ise","için","kadar","ki","kim","mı","mi","mu","mü","nasıl","ne","neden","nerde","nerede","nereye","niçin","niye","o","sanki","siz","şey","sonra","şu","tüm","ve","veya","ya","yani","olarak","üzere","fakat","ancak","herhangi","hiçbir","herkes","her şey","hemen","artık","yine","bile","bazen","özellikle","olsa","olduğu","olduğunu","olan","olanlar","olabilir","olmak","etmek","yapmak","var","yok","göre","kendi","kendisi","arada","aynı","bana","bende","beni","benim","biz","bizim","sizin","sizi","sizde","sana","seni","senin","onun","onlar","onları","onların","şimdi","bugün","yarın","dün","bir","iki","üç","dört","beş","altı","yedi","sekiz","dokuz","on"
]);

// ---------- Yardımcılar ----------
function splitSentences(text) {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[\.\!\?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function tokenize(text) {
  const cleaned = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned
    .split(" ")
    .filter((w) => w && w.length > 1 && !TR_STOPWORDS.has(w));
}

function buildTfidfVectors(sentences) {
  const docs = sentences.map(tokenize);
  const vocab = new Map();
  for (const d of docs) for (const w of d) if (!vocab.has(w)) vocab.set(w, vocab.size);

  const V = vocab.size, N = docs.length;

  const tf = docs.map((doc) => {
    const vec = new Float32Array(V);
    const counts = new Map();
    for (const w of doc) counts.set(w, (counts.get(w) || 0) + 1);
    const L = doc.length || 1;
    for (const [w, c] of counts) vec[vocab.get(w)] = c / L;
    return vec;
  });

  const df = new Uint32Array(V);
  for (const doc of docs) {
    const seen = new Set(doc);
    for (const w of seen) df[vocab.get(w)]++;
  }

  const idf = new Float32Array(V);
  for (let j = 0; j < V; j++) idf[j] = Math.log((1 + N) / (1 + df[j])) + 1;

  return tf.map((vec) => {
    const out = new Float32Array(V);
    for (let j = 0; j < V; j++) out[j] = vec[j] * idf[j];
    return out;
  });
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    dot += x * y; na += x * x; nb += y * y;
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function buildSimilarityMatrix(vectors) {
  const n = vectors.length;
  const M = Array.from({ length: n }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const s = cosine(vectors[i], vectors[j]);
      M[i][j] = s; M[j][i] = s;
    }
  }
  for (let i = 0; i < n; i++) M[i][i] = 0;
  return M;
}

function pageRank(M, { d = 0.85, tol = 1e-6, maxIter = 100 } = {}) {
  const n = M.length;
  if (!n) return [];
  const S = Array.from({ length: n }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) {
    let sum = 0; for (let j = 0; j < n; j++) sum += M[i][j];
    if (!sum) for (let j = 0; j < n; j++) S[i][j] = 1 / n;
    else for (let j = 0; j < n; j++) S[i][j] = M[i][j] / sum;
  }
  let r = new Float32Array(n).fill(1 / n);
  const teleport = (1 - d) / n;
  for (let it = 0; it < maxIter; it++) {
    const r2 = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let acc = 0; for (let j = 0; j < n; j++) acc += r[j] * S[j][i];
      r2[i] = teleport + d * acc;
    }
    let diff = 0; for (let i = 0; i < n; i++) diff += Math.abs(r2[i] - r[i]);
    r = r2; if (diff < tol) break;
  }
  return Array.from(r);
}

async function fetchArticleText(url) {
  const res = await fetch(`${API}/api/extractive`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ url, length: lengthKey }), // sadece length
});

  if (!res.ok) throw new Error(`Kaynak alınamadı (${res.status})`);
  const html = await res.text();
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  const text = (article?.textContent || dom.window.document.body.textContent || "")
    .replace(/\s+/g, " ")
    .trim();
  const title = article?.title || dom.window.document.title || "";
  if (!text || text.length < 200) {
    throw new Error("Makale metni çıkarılamadı ya da çok kısa.");
  }
  return { text, title };
}

// ---------- YENİ: kelime bütçesine göre extractive özet ----------
function extractiveSummarize(text, { length = "medium" } = {}) {
  const sents = splitSentences(text);
  if (sents.length <= 2) return text.trim();

  // 1) cümleleri skorla
  const vectors = buildTfidfVectors(sents);
  const M = buildSimilarityMatrix(vectors);
  const scores = pageRank(M);
  const rankedIdx = scores.map((s, i) => i).sort((a, b) => scores[b] - scores[a]);

  // 2) toplam kelimeye göre hedef bütçe + maksimum cümle oranı
  const totalWords = text.trim().split(/\s+/).length;

  // daha ayrık profiller: kısa az, uzun gerçekten uzun
  const PROFILES = {
    short:  { ratio: 0.06, minW: 40,  maxW: 90,  maxFrac: 0.18 }, // en fazla cümlelerin %18'i
    medium: { ratio: 0.12, minW: 120, maxW: 220, maxFrac: 0.35 },
    long:   { ratio: 0.22, minW: 220, maxW: 420, maxFrac: 0.60 },
  };
  const p = PROFILES[length] || PROFILES.medium;

  let target = Math.round(totalWords * p.ratio);
  if (target < p.minW) target = p.minW;
  if (target > p.maxW) target = p.maxW;

  const maxSentences = Math.max(1, Math.floor(sents.length * p.maxFrac));

  // 3) hedef kelimeye (ve cümle sınırına) ulaşana kadar ekle
  const picked = [];
  let acc = 0;
  for (const i of rankedIdx) {
    const w = sents[i].split(/\s+/).length;
    picked.push(i);
    acc += w;
    if (acc >= target || picked.length >= maxSentences) break;
  }

  // 4) orijinal sıraya göre birleştir
  picked.sort((a, b) => a - b);
  return picked.map(i => sents[i]).join(" ");
}

// ---------- Rotalar ----------
app.get("/", (req, res) => res.send("Summarizer API ayakta ✅"));

app.post("/api/extractive", async (req, res) => {
  try {
    const { url, length } = req.body || {}; // 'short' | 'medium' | 'long'
    if (!url) return res.status(400).json({ error: "url zorunlu" });
    new URL(url);

    const { text, title } = await fetchArticleText(url);
    const mode = ["short", "medium", "long"].includes(length) ? length : "medium";
    const summary = extractiveSummarize(text, { length: mode });

    res.json({ title, summary, mode: "extractive", length: mode });
  } catch (e) {
    res.status(500).json({ error: e.message || "Bilinmeyen hata" });
  }
});

app.listen(PORT, () => {
  console.log(`Server http://localhost:${PORT} üzerinde.`);
});
