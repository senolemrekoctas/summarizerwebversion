import express from "express";
import cors from "cors";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

const app = express();
const PORT = process.env.PORT || 3000;


app.use(cors({ origin: true, methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["Content-Type"] }));
app.use(express.json({ limit: "1mb" }));
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});


const TR_STOPWORDS = new Set([
  "acaba","ama","aslında","az","bazı","belki","biri","birkaç","birçok","böyle","bu","çok","çünkü","da","daha","de","defa","diye","eğer","en","gibi","hem","hep","hepsi","her","hiç","ile","ise","için","kadar","ki","kim","mı","mi","mu","mü","nasıl","ne","neden","nerde","nerede","nereye","niçin","niye","o","sanki","siz","şey","sonra","şu","tüm","ve","veya","ya","yani","olarak","üzere","fakat","ancak","herhangi","hiçbir","herkes","her şey","hemen","artık","yine","bile","bazen","özellikle","olsa","olduğu","olduğunu","olan","olanlar","olabilir","olmak","etmek","yapmak","var","yok","göre","kendi","kendisi","arada","aynı","bana","bende","beni","benim","biz","bizim","sizin","sizi","sizde","sana","seni","senin","onun","onlar","onları","onların","şimdi","bugün","yarın","dün","bir","iki","üç","dört","beş","altı","yedi","sekiz","dokuz","on"
]);

function splitSentences(text) {
  return text.replace(/\s+/g, " ").split(/(?<=[\.\!\?])\s+|\n+/).map(s => s.trim()).filter(Boolean);
}
function tokenize(text) {
  const cleaned = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  return cleaned.split(" ").filter(w => w && w.length > 1 && !TR_STOPWORDS.has(w));
}
function buildTfidfVectors(sentences) {
  const docs = sentences.map(tokenize);
  const vocab = new Map();
  for (const d of docs) for (const w of d) if (!vocab.has(w)) vocab.set(w, vocab.size);
  const V = vocab.size, N = docs.length;

  const tf = docs.map(doc => {
    const vec = new Float32Array(V);
    const counts = new Map();
    for (const w of doc) counts.set(w, (counts.get(w) || 0) + 1);
    const L = doc.length || 1;
    for (const [w, c] of counts) vec[vocab.get(w)] = c / L;
    return vec;
  });

  const df = new Uint32Array(V);
  for (const doc of docs) { const seen = new Set(doc); for (const w of seen) df[vocab.get(w)]++; }

  const idf = new Float32Array(V);
  for (let j = 0; j < V; j++) idf[j] = Math.log((1 + N) / (1 + df[j])) + 1;

  return tf.map(vec => { const out = new Float32Array(V); for (let j = 0; j < V; j++) out[j] = vec[j] * idf[j]; return out; });
}
function cosine(a,b){ let dot=0,na=0,nb=0; for(let i=0;i<a.length;i++){const x=a[i],y=b[i]; dot+=x*y; na+=x*x; nb+=y*y;} return (!na||!nb)?0:dot/(Math.sqrt(na)*Math.sqrt(nb));}
function buildSimilarityMatrix(vectors){ const n=vectors.length; const M=Array.from({length:n},()=>new Float32Array(n));
  for(let i=0;i<n;i++){ for(let j=i+1;j<n;j++){ const s=cosine(vectors[i],vectors[j]); M[i][j]=s; M[j][i]=s; } M[i][i]=0; } return M; }
function pageRank(M,{d=0.85,tol=1e-6,maxIter=100}={}){ const n=M.length; if(!n)return[]; const S=Array.from({length:n},()=>new Float32Array(n));
  for(let i=0;i<n;i++){ let sum=0; for(let j=0;j<n;j++) sum+=M[i][j]; if(!sum) for(let j=0;j<n;j++) S[i][j]=1/n; else for(let j=0;j<n;j++) S[i][j]=M[i][j]/sum; }
  let r=new Float32Array(n).fill(1/n),tele=(1-d)/n;
  for(let it=0;it<maxIter;it++){ const r2=new Float32Array(n);
    for(let i=0;i<n;i++){ let acc=0; for(let j=0;j<n;j++) acc+=r[j]*S[j][i]; r2[i]=tele+d*acc; }
    let diff=0; for(let i=0;i<n;i++) diff+=Math.abs(r2[i]-r[i]); r=r2; if(diff<tol) break; }
  return Array.from(r);
}


function sentenceFeatureBoost(sent, idx, totalCount) {
  const hasNumber = /\b\d+([.,]\d+)?\b/.test(sent);
  const hasPercent = /% ?\d+/.test(sent);
  const hasCurrency = /(₺|TL|USD|EUR|\$|€)/i.test(sent);
  const properLike = (sent.match(/\b[ÇĞİÖŞÜA-Z][\p{L}'\-\.]{2,}\b/gu) || []).length;
  const tokens = sent.split(/\s+/).length;

  const posPrior = 1.0 - Math.min(0.35, (idx / Math.max(1, totalCount)) * 0.35);
  const brevity = Math.max(0, Math.min(1, 18 / Math.max(8, tokens)));

  let bonus = 0;
  if (hasNumber) bonus += 0.10;
  if (hasPercent) bonus += 0.05;
  if (hasCurrency) bonus += 0.08;
  bonus += Math.min(0.12, properLike * 0.01);
  bonus += posPrior * 0.12;
  bonus += brevity * 0.06;

  return bonus;
}
function normalize(arr) {
  const max = Math.max(...arr), min = Math.min(...arr);
  if (max === min) return arr.map(() => 0.5);
  return arr.map(v => (v - min) / (max - min));
}
function selectWithMMR(vectors, baseScores, targetWordBudget, maxSentences, sentences, lambda = 0.75) {
  const n = vectors.length;
  const picked = [];
  const available = new Set(Array.from({ length: n }, (_, i) => i));
  const sentLens = sentences.map(s => s.split(/\s+/).length);
  let accWords = 0;

  let best = baseScores.map((s, i) => [s, i]).sort((a,b) => b[0] - a[0])[0][1];
  picked.push(best); available.delete(best); accWords += sentLens[best];

  while (picked.length < maxSentences && accWords < targetWordBudget && available.size > 0) {
    let bestI = null, bestScore = -Infinity;
    for (const i of available) {
      let maxSim = 0;
      for (const j of picked) {
        const a = vectors[i], b = vectors[j];
        let dot=0, na=0, nb=0;
        for (let k=0;k<a.length;k++){ const x=a[k], y=b[k]; dot+=x*y; na+=x*x; nb+=y*y; }
        const sim = (!na||!nb) ? 0 : (dot / (Math.sqrt(na)*Math.sqrt(nb)));
        if (sim > maxSim) maxSim = sim;
      }
      const mmr = lambda * baseScores[i] - (1 - lambda) * maxSim;
      if (mmr > bestScore) { bestScore = mmr; bestI = i; }
    }
    picked.push(bestI);
    available.delete(bestI);
    accWords += sentLens[bestI];
  }
  return picked.sort((a,b)=>a-b);
}


async function fetchArticle(url) {
  const res = await fetch(url, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (compatible; SummarizerBot/1.0)" } });
  if (!res.ok) throw new Error(`Kaynak alınamadı (${res.status})`);
  const htmlRaw = await res.text();
  const dom = new JSDOM(htmlRaw, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  const text = (article?.textContent || dom.window.document.body.textContent || "").replace(/\s+/g, " ").trim();
  const title = article?.title || dom.window.document.title || "";
  const html = article?.content || "";
  if (!text || text.length < 200) throw new Error("Makale metni çıkarılamadı ya da çok kısa.");
  return { text, title, html };
}


function norm(s){ return (s||"").replace(/\s+/g," ").trim(); }
function extractListFromHtml(html){
  if (!html) return [];
  const frag = new JSDOM(`<body>${html}</body>`).window.document;
  const items = Array.from(frag.querySelectorAll("li"))
    .map(li => norm(li.textContent))
    .filter(x => x && /[A-Za-zÇĞİÖŞÜçğıöşü]/.test(x))
    .filter(x => x.length <= 60)
    .filter(x => !/[.:!?]$/.test(x));
  return Array.from(new Set(items));
}
function extractListFromText(text){
  const lines = text.split(/\n+/).map(norm).filter(Boolean);
  const looksItem = (l) =>
    /^(\*|-|•|\d{1,2}\)|\d{1,2}\.|\(\d{1,2}\))\s*\S/.test(l) ||
    (l.length <= 50 &&
      /[A-Za-zÇĞİÖŞÜçğıöşü]/.test(l) &&
      !/[.:!?]$/.test(l) &&
      (/^([A-ZÇĞİÖŞÜ][\p{L}'\-\.]+(?:\s+[A-ZÇĞİÖŞÜ][\p{L}'\-\.]+){0,3})(\s*\(.*\))?$/u.test(l) ||
       /^[A-Z0-9]{2,8}(\s*\(.*\))?$/.test(l)));
  const blocks=[]; let cur=[];
  for (const l of lines) {
    if (looksItem(l)) cur.push(l);
    else { if (cur.length) { blocks.push(cur); cur=[]; } }
  }
  if (cur.length) blocks.push(cur);
  blocks.sort((a,b)=>b.length-a.length);
  return Array.from(new Set((blocks[0]||[])));
}
function detectList(title, text, html) {
  const s = `${title}\n${text.slice(0,2000)}`;
  const htmlItems = extractListFromHtml(html);
  const textItems = extractListFromText(text);
  const items = (htmlItems.length >= 3 ? htmlItems : textItems);
  const likelyListy = /(işte|tam liste|madde|kadrosu|rakipleri|eşleşmeler|program|fikstür|şunlar)/i.test(s);
  return (items.length >= 3 || likelyListy) ? items : [];
}
function listHeading(title, text) {
  const m = title.match(/([\p{Lu}ÇĞİÖŞÜ][\p{L}]+(?:\s+[\p{Lu}ÇĞİÖŞÜ][\p{L}]+){0,3})\s*'nin/i);
  if (m) return `${m[1]}'nin listesi:`;
  return "Öne çıkan maddeler:";
}
function buildListSummary({ mode, items, title, text }) {
  const heading = listHeading(title, text);
  const base = `${heading}\n\n${items.join("\n")}`;
  if (mode === "short") return base;
  const extra = extractiveSummarize(text, { length: mode === "medium" ? "short" : "medium" });
  const tag = mode === "medium" ? "Özet" : "Detaylar";
  return `${base}\n\n${tag}: ${extra}`;
}


function extractiveSummarize(text, { length = "medium" } = {}) {
  const sents = splitSentences(text);
  if (sents.length <= 2) return text.trim();

  const vectors = buildTfidfVectors(sents);
  const M = buildSimilarityMatrix(vectors);
  const pr = pageRank(M);
  const prN = normalize(pr);
  const feat = sents.map((s, i) => sentenceFeatureBoost(s, i, sents.length));
  const base = prN.map((v, i) => v * 0.75 + feat[i] * 0.25);
  const baseN = normalize(base);

  const totalWords = text.trim().split(/\s+/).length;
  const PROFILES = {
    short:  { ratio: 0.06, minW: 50,  maxW: 110, maxFrac: 0.18 },
    medium: { ratio: 0.12, minW: 130, maxW: 260, maxFrac: 0.35 },
    long:   { ratio: 0.22, minW: 230, maxW: 480, maxFrac: 0.60 },
  };
  const p = PROFILES[length] || PROFILES.medium;

  let target = Math.round(totalWords * p.ratio);
  if (target < p.minW) target = p.minW;
  if (target > p.maxW) target = p.maxW;
  const maxSentences = Math.max(1, Math.floor(sents.length * p.maxFrac));

  const picked = selectWithMMR(vectors, baseN, target, maxSentences, sents, 0.75);
  return picked.map(i => sents[i]).join(" ");
}


async function ollamaChat(messages, {
  model = 'qwen2.5:14b-instruct',
  temperature = 0.2,
  num_predict = 650,
  num_ctx = 8192,
} = {}) {
  const res = await fetch('http://localhost:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, stream: false, options: { temperature, num_predict, num_ctx }, messages })
  });
  if (!res.ok) {
    const t = await res.text().catch(()=> '');
    throw new Error('Ollama HTTP ' + res.status + ' ' + t);
  }
  const data = await res.json();
  return (data?.message?.content || '').trim();
}
function chunkText(text, maxChars = 6000, overlap = 300) {
  const chunks = []; let i = 0;
  while (i < text.length) {
    const end = Math.min(i + maxChars, text.length);
    chunks.push(text.slice(i, end));
    if (end === text.length) break;
    i = Math.max(0, end - overlap);
  }
  return chunks;
}
async function abstractiveOllamaSmart(text, { length = 'medium', model = 'qwen2.5:14b-instruct' } = {}) {
  const limits = { short: 220, medium: 380, long: 650 };
  const bullets = { short: 6,  medium: 10,   long: 14 };
  const sys = `Türkçe profesyonel özetleyicisin.
- Metindeki bilgiye sadık kal.
- Önemli kişi/rakam/tarihleri koru.
- Kısa ve bilgi yoğun yaz.`;

  const parts = chunkText(text, 6000, 300);
  const partials = [];
  for (const ch of parts) {
    const user = `Bu parçayı en fazla ${bullets[length]} maddede özetle.
- Her madde tek cümle, gereksiz giriş yok.
- Sadece bu parçadaki bilgileri kullan.

PARÇA:
"""${ch}"""`;
    const out = await ollamaChat(
      [{ role: 'system', content: sys }, { role: 'user', content: user }],
      { model, temperature: 0.2, num_predict: limits[length], num_ctx: 8192 }
    );
    partials.push(out);
  }

  const combined = partials.join('\n');
  const finalUser =
    length === 'short'
    ? `Aşağıdaki maddeleri tekrarsız tek listede birleştir. En fazla ${bullets.short} madde.
Başlık yazma, sadece maddeler:
${combined}`
    : `Aşağıdaki maddeleri tekrarsız bir özet haline getir.
- Önce kısa bir paragraf, ardından en fazla ${bullets[length]} madde.
- Gereksiz tekrar yok, rakam/tarih/kurumlar korunmalı.
${combined}`;

  const final = await ollamaChat(
    [{ role: 'system', content: sys }, { role: 'user', content: finalUser }],
    { model, temperature: 0.2, num_predict: limits[length], num_ctx: 8192 }
  );
  return final.trim();
}


app.get("/", (_req, res) => res.send("Summarizer API ayakta ✅"));
app.get("/health", (_req, res) => res.json({ ok: true }));


app.post("/api/summarize", async (req, res) => {
  try {
    const { url, length = "medium" } = req.body || {};
    if (!url) return res.status(400).json({ error: "url zorunlu" });
    new URL(url);

    const { text, title, html } = await fetchArticle(url);

    
    const items = detectList(title, text, html);
    if (items.length >= 3) {
      const summary = buildListSummary({ mode: length, items, title, text });
      return res.json({ title, summary, mode: "list", length });
    }

   
    try {
      const abstr = await abstractiveOllamaSmart(text, { length, model: 'qwen2.5:14b-instruct' });
      if (abstr) return res.json({ title, summary: abstr, mode: "ollama", length });
    } catch (e) {
      console.warn("Ollama hata, extractive'e düşüyorum:", e.message);
    }

    
    const ext = extractiveSummarize(text, { length });
    res.json({ title, summary: ext, mode: "extractive", length });
  } catch (e) {
    console.error("[/api/summarize] Hata:", e);
    res.status(500).json({ error: e.message || "Bilinmeyen hata" });
  }
});


app.post("/api/extractive", async (req, res) => {
  try {
    const { url, length = "medium" } = req.body || {};
    if (!url) return res.status(400).json({ error: "url zorunlu" });
    new URL(url);
    const { text, title, html } = await fetchArticle(url);

    const items = detectList(title, text, html);
    if (items.length >= 3) {
      const summary = buildListSummary({ mode: length, items, title, text });
      return res.json({ title, summary, mode: "list", length });
    }

    const ext = extractiveSummarize(text, { length });
    res.json({ title, summary: ext, mode: "extractive", length });
  } catch (e) {
    console.error("[/api/extractive] Hata:", e);
    res.status(500).json({ error: e.message || "Bilinmeyen hata" });
  }
});

app.listen(PORT, () => {
  console.log(`Server http://localhost:${PORT} üzerinde.`);
});
