import React, { useState } from "react";

const API = import.meta.env.VITE_API || "http://localhost:3000";

// 3 preset: kısa / orta / uzun
const LENGTH_PRESETS = [
  { key: "short",  label: "Kısa"  },
  { key: "medium", label: "Orta"  },
  { key: "long",   label: "Uzun"  },
];

export default function App() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [error, setError] = useState("");
  const [lengthKey, setLengthKey] = useState("medium"); // varsayılan

  async function handleSubmit(e) {
    e.preventDefault();
    setError(""); setTitle(""); setSummary("");

    if (!url.trim()) {
      setError("Lütfen linki girin.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API}/api/extractive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, length: lengthKey }), // << yalnızca length
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
        <h1 className="title">Web Ozetleyiciye Hosgeldiniz</h1>

        {/* 3'lü seçenek */}
        <div className="seg" role="group" aria-label="Özet uzunluğu">
          {LENGTH_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={`seg-btn ${lengthKey === p.key ? "active" : ""}`}
              aria-pressed={lengthKey === p.key}
              onClick={() => setLengthKey(p.key)}
              disabled={loading}
            >
              {p.label}
            </button>
          ))}
        </div>

        <form className="form" onSubmit={handleSubmit}>
          <input
            className="input"
            placeholder="enter your link..."
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

        <footer className="footer">https://github.com/senolemrekoctas</footer>
      </div>
    </div>
  );
}
