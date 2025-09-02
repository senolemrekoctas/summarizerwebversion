import React, { useState } from "react";

const API_URL =
  (import.meta.env && import.meta.env.VITE_API) ||
  (location.hostname === "localhost"
    ? "http://localhost:3000"
    : "https://summarizerwebversion.onrender.com");

if (import.meta.env?.DEV) console.log("API_URL ->", API_URL);

const LENGTH_PRESETS = [
  { key: "short",  label: "Short" },
  { key: "medium", label: "Medium" },
  { key: "long",   label: "Long"  },
];

export default function App() {
  const [url, setUrl] = useState("");
  const [lengthKey, setLengthKey] = useState("medium");
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError(""); setTitle(""); setSummary("");

    let u = url.trim();
    if (!u) { setError("Lütfen linki girin."); return; }
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;

    try {
      setLoading(true);
      const res = await fetch(`${API_URL}/api/summarize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: u, length: lengthKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "İstek başarısız.");
      setTitle(data.title || "");
      setSummary(data.summary || "");
    } catch (err) {
      console.error(err);
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <div className="card">
        <h1 className="title">Web Ozetleyiciye Hosgeldiniz</h1>

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
            {/* Liste modunda da paragraf gibi gelir; istersen burada \n'lere <li> yapabiliriz */}
            {summary && <pre className="result-text" style={{ whiteSpace: "pre-wrap" }}>{summary}</pre>}
          </div>
        )}

        <footer className="footer">https://github.com/senolemrekoctas</footer>
      </div>
    </div>
  );
}
