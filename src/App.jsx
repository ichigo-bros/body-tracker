import { useState, useRef, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from "recharts";

const C = {
  bg: "#0F1117",
  surface: "#181C27",
  card: "#1E2333",
  border: "#2A3050",
  accent: "#4FFFB0",
  accentDim: "#1A4035",
  text: "#E8EDF5",
  muted: "#6B7594",
  danger: "#FF4F6A",
  warn: "#FFB84F",
};

const METRIC_CONFIG = [
  { key: "weight",      label: "体重",     unit: "kg",   color: "#4FFFB0", yDomain: ["auto","auto"] },
  { key: "bodyFat",     label: "体脂肪率", unit: "%",    color: "#FF6B9D", yDomain: ["auto","auto"] },
  { key: "muscle",      label: "筋肉量",   unit: "kg",   color: "#4FC3FF", yDomain: ["auto","auto"] },
  { key: "bmi",         label: "BMI",       unit: "",     color: "#FFB84F", yDomain: ["auto","auto"] },
  { key: "basalMetab",  label: "基礎代謝", unit: "kcal", color: "#B84FFF", yDomain: ["auto","auto"] },
  { key: "boneMass",    label: "骨量",     unit: "kg",   color: "#4FF0FF", yDomain: ["auto","auto"] },
  { key: "visceralFat", label: "内臓脂肪", unit: "",     color: "#FF8C4F", yDomain: ["auto","auto"] },
];

function toBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = () => rej(new Error("読み込み失敗"));
    r.readAsDataURL(file);
  });
}

function formatDate(iso) {
  const d = new Date(iso);
  return `${d.getMonth()+1}/${d.getDate()}`;
}

function downloadCSV(records) {
  const headers = ["日時", ...METRIC_CONFIG.map(m => `${m.label}(${m.unit})`)];
  const rows = records.map(r =>
    [r.timestamp, ...METRIC_CONFIG.map(m => r[m.key] ?? "")].join(",")
  );
  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "body-data.csv"; a.click();
  URL.revokeObjectURL(url);
}

async function extractFromImage(base64, mediaType) {
  const prompt = `この体組成計の画面写真から数値を読み取り、以下のJSONのみを返してください。
読み取れなかった項目はnullにしてください。単位は不要、数値のみ。

{
  "weight": null,
  "bodyFat": null,
  "muscle": null,
  "bmi": null,
  "basalMetab": null,
  "boneMass": null,
  "visceralFat": null,
  "timestamp": "YYYY-MM-DDTHH:mm"
}

timestampは画面に日時が表示されていればそれを使い、なければ今日の日付(${new Date().toISOString().slice(0,16)})にしてください。
JSONのみ出力。前後に説明文やコードブロックは不要。`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": import.meta.env.VITE_ANTHROPIC_KEY ?? "",
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
          { type: "text", text: prompt }
        ]
      }]
    })
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const data = await res.json();
  const text = data.content.map(b => b.text || "").join("").replace(/```json|```/g, "").trim();
  return JSON.parse(text);
}

function StatCard({ label, value, unit, color }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 18px", minWidth: 110 }}>
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: value != null ? color : C.border, fontVariantNumeric: "tabular-nums" }}>
        {value != null ? value : "—"}
        {value != null && <span style={{ fontSize: 12, fontWeight: 400, color: C.muted, marginLeft: 3 }}>{unit}</span>}
      </div>
    </div>
  );
}

function MetricChart({ records, metric }) {
  const data = records
    .filter(r => r[metric.key] != null)
    .map(r => ({ date: formatDate(r.timestamp), value: r[metric.key] }));
  if (data.length < 1) return null;
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 8px 8px" }}>
      <div style={{ fontSize: 12, color: C.muted, paddingLeft: 12, marginBottom: 8 }}>
        {metric.label}{metric.unit && ` (${metric.unit})`}
      </div>
      <ResponsiveContainer width="100%" height={120}>
        <LineChart data={data} margin={{ top: 2, right: 16, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
          <XAxis dataKey="date" tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} domain={metric.yDomain} />
          <Tooltip contentStyle={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text }} labelStyle={{ color: C.muted }} />
          <Line type="monotone" dataKey="value" stroke={metric.color} strokeWidth={2} dot={{ r: 3, fill: metric.color }} activeDot={{ r: 5 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function RecordRow({ record, onDelete }) {
  const d = new Date(record.timestamp);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr repeat(7, auto) auto", gap: 8, alignItems: "center", padding: "10px 14px", borderBottom: `1px solid ${C.border}`, fontSize: 13 }}>
      <span style={{ color: C.muted }}>{d.toLocaleString("ja-JP", { month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit" })}</span>
      {METRIC_CONFIG.map(m => (
        <span key={m.key} style={{ color: record[m.key] != null ? C.text : C.border, textAlign: "right", minWidth: 48 }}>
          {record[m.key] != null ? `${record[m.key]}${m.unit}` : "—"}
        </span>
      ))}
      <button onClick={() => onDelete(record.id)} style={{ background: "none", border: "none", cursor: "pointer", color: C.muted, fontSize: 16, padding: "0 4px" }}>✕</button>
    </div>
  );
}

export default function App() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);
  const [extracted, setExtracted] = useState(null);
  const [tab, setTab] = useState("dashboard");
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef();

  const processFile = useCallback(async (file) => {
    if (!file || !file.type.startsWith("image/")) { setError("画像ファイルを選択してください"); return; }
    setLoading(true); setError(null); setExtracted(null);
    try {
      const b64 = await toBase64(file);
      setPreview(`data:${file.type};base64,${b64}`);
      const result = await extractFromImage(b64, file.type);
      setExtracted(result);
    } catch (e) {
      setError(e.message || "読み取りに失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleFiles = useCallback((files) => { if (files[0]) processFile(files[0]); }, [processFile]);
  const handleDrop = useCallback((e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }, [handleFiles]);

  const saveRecord = () => {
    if (!extracted) return;
    const record = { ...extracted, id: Date.now() };
    setRecords(prev => [...prev, record].sort((a,b) => new Date(a.timestamp)-new Date(b.timestamp)));
    setExtracted(null); setPreview(null);
  };

  const deleteRecord = (id) => setRecords(prev => prev.filter(r => r.id !== id));
  const latest = records[records.length - 1];

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'Inter', 'Noto Sans JP', sans-serif" }}>
      <div style={{ borderBottom: `1px solid ${C.border}`, padding: "16px 24px", display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: C.accent, boxShadow: `0 0 12px ${C.accent}` }} />
        <span style={{ fontWeight: 700, fontSize: 16, letterSpacing: "0.05em" }}>BODY METRICS</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {["dashboard", "history"].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ background: tab === t ? C.accentDim : "none", color: tab === t ? C.accent : C.muted, border: `1px solid ${tab === t ? C.accent : C.border}`, borderRadius: 8, padding: "6px 16px", cursor: "pointer", fontSize: 13 }}>
              {t === "dashboard" ? "ダッシュボード" : "記録一覧"}
            </button>
          ))}
          {records.length > 0 && (
            <button onClick={() => downloadCSV(records)} style={{ background: "none", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontSize: 13 }}>↓ CSV</button>
          )}
        </div>
      </div>

      <div style={{ maxWidth: 960, margin: "0 auto", padding: "24px 16px", display: "flex", flexDirection: "column", gap: 24 }}>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => !loading && fileRef.current.click()}
          style={{ border: `2px dashed ${dragOver ? C.accent : C.border}`, borderRadius: 16, padding: "28px 20px", display: "flex", alignItems: "center", gap: 20, cursor: loading ? "wait" : "pointer", background: dragOver ? C.accentDim : C.surface, transition: "all 0.2s" }}
        >
          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => handleFiles(e.target.files)} />
          {preview ? (
            <img src={preview} alt="preview" style={{ height: 80, borderRadius: 8, objectFit: "cover" }} />
          ) : (
            <div style={{ width: 64, height: 64, borderRadius: 12, background: C.accentDim, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, flexShrink: 0 }}>📷</div>
          )}
          <div style={{ flex: 1 }}>
            {loading ? (
              <><div style={{ color: C.accent, fontWeight: 600, marginBottom: 4 }}>読み取り中…</div><div style={{ color: C.muted, fontSize: 13 }}>AIが数値を解析しています</div></>
            ) : extracted ? (
              <>
                <div style={{ color: C.accent, fontWeight: 600, marginBottom: 8 }}>✓ 読み取り完了</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {METRIC_CONFIG.map(m => extracted[m.key] != null && (
                    <span key={m.key} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, padding: "3px 10px", fontSize: 12 }}>
                      {m.label}: <strong>{extracted[m.key]}{m.unit}</strong>
                    </span>
                  ))}
                </div>
                <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                  <button onClick={(e) => { e.stopPropagation(); saveRecord(); }} style={{ background: C.accent, color: "#0F1117", border: "none", borderRadius: 8, padding: "8px 20px", fontWeight: 700, cursor: "pointer", fontSize: 14 }}>保存する</button>
                  <button onClick={(e) => { e.stopPropagation(); setExtracted(null); setPreview(null); }} style={{ background: "none", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 16px", cursor: "pointer", fontSize: 14 }}>キャンセル</button>
                </div>
              </>
            ) : (
              <><div style={{ fontWeight: 600, marginBottom: 4 }}>写真をドロップ、またはタップして選択</div><div style={{ color: C.muted, fontSize: 13 }}>体組成計の画面を撮影した写真を読み込みます</div></>
            )}
          </div>
        </div>

        {error && (
          <div style={{ background: "#2A1520", border: `1px solid ${C.danger}`, borderRadius: 10, padding: "12px 16px", color: C.danger, fontSize: 13 }}>⚠ {error}</div>
        )}

        {tab === "dashboard" && (
          <>
            {latest ? (
              <div>
                <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>最新の記録</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                  {METRIC_CONFIG.map(m => <StatCard key={m.key} label={m.label} value={latest[m.key]} unit={m.unit} color={m.color} />)}
                </div>
              </div>
            ) : (
              <div style={{ textAlign: "center", color: C.muted, padding: "40px 0", fontSize: 14 }}>写真を読み込むと、ここに数値が表示されます</div>
            )}
            {records.length > 1 && (
              <div>
                <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>推移グラフ</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
                  {METRIC_CONFIG.map(m => <MetricChart key={m.key} records={records} metric={m} />)}
                </div>
              </div>
            )}
          </>
        )}

        {tab === "history" && (
          <div style={{ background: C.surface, borderRadius: 12, overflow: "hidden", border: `1px solid ${C.border}` }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr repeat(7, auto) auto", gap: 8, padding: "10px 14px", fontSize: 11, color: C.muted, borderBottom: `1px solid ${C.border}` }}>
              <span>日時</span>
              {METRIC_CONFIG.map(m => <span key={m.key} style={{ textAlign: "right", minWidth: 48 }}>{m.label}</span>)}
              <span />
            </div>
            {records.length === 0 ? (
              <div style={{ padding: "32px", textAlign: "center", color: C.muted, fontSize: 14 }}>記録がありません</div>
            ) : (
              [...records].reverse().map(r => <RecordRow key={r.id} record={r} onDelete={deleteRecord} />)
            )}
          </div>
        )}
      </div>
    </div>
  );
}