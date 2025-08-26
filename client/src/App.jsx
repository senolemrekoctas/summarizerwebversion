import React, { useState } from "react";

const API = "http://localhost:3000";

// Özet uzunluğu ön ayarları (extractive için ratio + max cümle sınırı)
const LENGTH_PRESETS = [
  { key: "cok-kisa",  label: "Çok Kısa",  ratio: 0.05, max: 1 },
  { key: "kisa",      label: "Kısa",      ratio: 0.10, max: 2 },
  { key: "orta",      label: "Orta",      ratio: 0.18, max: 5 },
  { key: "uzun",      label: "Uzun",      ratio: 0.30, max: 7 },
  { key: "cok-uzun",  label: "Çok Uzun",  ratio: 0.45, max: 10 },
];

export default function App() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [error, setError] = useState("");
  const [lengthKey, setLengthKey] = useState("orta"); 

  const active = LENGTH_PRESETS.find((p) => p.key === lengthKey) ?? LENGTH_PRESETS[2];

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setTitle("");
    setSummary("");

    if (!url.trim()) {
      setError("Lütfen haber linki girin.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API}/api/extractive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // seçilen ön ayarı gönderiyoruz (max kesin sınırdır)
        body: JSON.stringify({ url, ratio: active.ratio, max: active.max }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "İstek başarısız.");
      setTitle(data.title || "");
      setSummary(data.summary || "");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <div className="card">
        <h1 className="title">cartcurt haber ozetleyiciye hosheldiniz</h1>

        {/* ÖZET UZUNLUĞU SEÇİM TUŞLARI */}
        <div className="seg" role="group" aria-label="Özet uzunluğu">
          {LENGTH_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={
                "seg-btn " +
                (lengthKey === p.key ? "active " : "") +
                `preset-${p.key}`
              }
              aria-pressed={lengthKey === p.key}
              onClick={() => setLengthKey(p.key)}
              disabled={loading}
              title={`${p.label} • hedef en çok ${p.max} cümle`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="seg-hint">
          Seçili: <b>{active.label}</b> • hedef: <b>en çok {active.max} cümle</b> (ratio≈{active.ratio})
        </div>

        <form className="form" onSubmit={handleSubmit}>
          <input
            className="input"
            placeholder="haberin linkini yaziniz..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={loading}
          />
          <button className="btn" type="submit" disabled={loading}>
            {loading ? "ÖZETLENİYOR..." : "ÖZET GÖR"}
          </button>
        </form>

        {error && <div className="alert">❌ {error}</div>}

        {(title || summary) && (
          <div className="result">
            {title && <h2 className="result-title">{title}</h2>}
            {summary && <p className="result-text">{summary}</p>}
          </div>
        )}

        <footer className="footer">made by emre (github)</footer>
      </div>
    </div>
  );
}
