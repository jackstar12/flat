import { useEffect, useRef, useState } from "react";
import { Heart, RefreshCw, ShoppingBag, X } from "lucide-react";
import { api } from "./api";
import "./tgtg.css";

type Review = { date: string; buy_again?: boolean; verdict?: string; quote: string };
type Pickup = { start?: string; end?: string } | null;
type Sample = { observed: string; price: number | null; stock: number | null; pickup: Pickup };
type Bag = Sample & {
  id: string; merchant: string; bag: string; address: string; distance: number | null;
  min: number | null; max: number | null; stock_min: number | null; rating: number | null; rating_count: number | null;
  stable: boolean; days: number; samples: number; fresh: boolean; in_latest: boolean;
  cover: boolean; logo: boolean; generic_cover: boolean; app_favorite?: boolean; local_favorite?: boolean; reviews?: Review[];
};
type Catalog = { items: Bag[]; personal: boolean; last_success: string | null; coverage: { app_favorites?: number }; last_attempt: { status: string } | null };
const money = (n: number | null) => n === null ? "—" : new Intl.NumberFormat("de-AT", { style: "currency", currency: "EUR" }).format(n);
const time = (s?: string | null) => s ? new Intl.DateTimeFormat("de-AT", { timeZone: "Europe/Vienna", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(s)) : "—";
const pickup = (p: Pickup) => p?.start && p.end ? `${time(p.start)} – ${time(p.end)}` : "Kein Abholfenster gespeichert";
const verdict = (r: Review) => r.buy_again === false ? "Nicht wieder kaufen" : r.buy_again === true ? "Wieder kaufen" : r.verdict === "negative" ? "Negatives Feedback" : r.verdict === "positive" ? "Positives Feedback" : "Bewertet";

function Photo({ bag, kind }: { bag: Bag; kind: "cover" | "logo" }) {
  const [failed, setFailed] = useState(false);
  return !failed && bag[kind] ? <img src={`/api/tgtg/photo?id=${encodeURIComponent(bag.id)}&kind=${kind}`} alt={kind === "cover" ? `${bag.merchant} Angebotsfoto` : ""} loading="lazy" decoding="async" onError={() => setFailed(true)} /> : <span className="tg-photo-fallback"><ShoppingBag size={kind === "cover" ? 30 : 17} />{kind === "cover" && "Kein Foto"}</span>;
}

export function TgtgView() {
  const [data, setData] = useState<Catalog | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [radius, setRadius] = useState(3);
  const [sort, setSort] = useState("distance");
  const [stable, setStable] = useState(false);
  const [rated, setRated] = useState(false);
  const [favorites, setFavorites] = useState(false);
  const [source, setSource] = useState("app");
  const [selected, setSelected] = useState<Bag | null>(null);
  const [history, setHistory] = useState<Sample[] | null>(null);
  const [historyError, setHistoryError] = useState("");
  const generation = useRef(0);
  const detailGeneration = useRef(0);
  const dialog = useRef<HTMLDialogElement>(null);
  async function refresh() {
    const current = ++generation.current;
    setLoading(true); setError("");
    try { const next = await api<Catalog>("/api/tgtg/catalog"); if (current === generation.current) setData(next); }
    catch (e) { if (current === generation.current) setError(e instanceof Error ? e.message : "Daten nicht verfügbar."); }
    finally { if (current === generation.current) setLoading(false); }
  }
  useEffect(() => { void refresh(); return () => { generation.current++; detailGeneration.current++; }; }, []);
  async function open(bag: Bag) {
    const current = ++detailGeneration.current;
    setSelected(bag); setHistory(null); setHistoryError("");
    dialog.current?.showModal();
    try { const rows = await api<Sample[]>(`/api/tgtg/history?id=${encodeURIComponent(bag.id)}`); if (current === detailGeneration.current) setHistory(rows); }
    catch (e) { if (current === detailGeneration.current) setHistoryError(e instanceof Error ? e.message : "Verlauf nicht verfügbar."); }
  }
  function close() { detailGeneration.current++; dialog.current?.close(); setSelected(null); }
  const tokens = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const rows = (data?.items ?? []).filter(b => tokens.every(t => `${b.merchant} ${b.address} ${b.bag} ${b.id}`.toLocaleLowerCase().includes(t)) &&
    (radius === 999 || b.distance !== null && b.distance <= radius) && (!stable || b.stable) && (!rated || (b.rating ?? 0) >= 4.5 && (b.rating_count ?? 0) >= 30) &&
    (!favorites || !data?.personal || (source === "app" ? b.app_favorite : b.local_favorite)));
  rows.sort((a, b) => sort === "rating" ? (b.rating ?? -1) - (a.rating ?? -1) : sort === "price" ? (a.price ?? Infinity) - (b.price ?? Infinity) : (a.distance ?? Infinity) - (b.distance ?? Infinity));
  return <section className="tgtg" aria-label="TGTG">
    <div className="tg-heading"><div><span className="tg-eyebrow">GRAZ · UNIVIERTEL</span><h2>TGTG</h2></div><button className="secondary-button" disabled={loading} onClick={() => void refresh()}><RefreshCw size={16} />Aktualisieren</button></div>
    <div className="tg-filters"><input aria-label="Sackerl suchen" type="search" placeholder="Geschäft, Straße oder Sackerl" value={query} onChange={e => setQuery(e.target.value)} />
      <select aria-label="Umkreis" value={radius} onChange={e => setRadius(Number(e.target.value))}><option value={1}>1 km</option><option value={2}>2 km</option><option value={3}>3 km</option><option value={999}>Alle gespeicherten</option></select>
      <select aria-label="Sortierung" value={sort} onChange={e => setSort(e.target.value)}><option value="distance">Nächste zuerst</option><option value="rating">Beste Bewertung</option><option value="price">Günstigste zuerst</option></select>
      <div className="tg-chips"><label><input type="checkbox" checked={stable} onChange={e => setStable(e.target.checked)} />Unveränderter Preis</label><label><input type="checkbox" checked={rated} onChange={e => setRated(e.target.checked)} />★ 4,5+ · 30+ Bewertungen</label></div>
    </div>
    {data?.personal && <div className="tg-tabs"><button aria-pressed={!favorites} onClick={() => setFavorites(false)}>Alle Sackerl</button><button aria-pressed={favorites} onClick={() => setFavorites(true)}><Heart size={15} />Favoriten ({data.coverage.app_favorites})</button></div>}
    {data?.personal && favorites && <div className="tg-source"><select aria-label="Favoritenquelle" value={source} onChange={e => setSource(e.target.value)}><option value="app">TGTG-App-Favoriten</option><option value="local">Tracker-Präferenzen</option></select><small>{source === "app" ? "Gespeicherter App-Stand · nur lesen" : "Lokale Präferenzen, keine App-Favoriten"}</small></div>}
    <div className="tg-meta"><strong>{loading && !data ? "Lädt…" : `${rows.length} Sackerl`}</strong><span>Letzter Stand: {time(data?.last_success)}{data?.last_attempt?.status === "error" ? " · Abruf fehlgeschlagen" : ""}</span></div>
    <p className="tg-note">Luftlinie · Unverändert über 2+ beobachtete Tage ≠ garantierter Fixpreis. Zeiten: Wien.</p>
    {error && <p role="alert" className="tg-error">{error}</p>}
    <div className="tg-grid">{rows.map(b => { const review = b.reviews?.at(-1); return <article className="tg-card" key={b.id}>
      <div className="tg-cover"><Photo bag={b} kind="cover" /><span className="tg-stock">{b.stock === null ? "Bestand unbekannt" : b.stock === 0 ? "Zuletzt ausverkauft" : `${b.stock} zuletzt verfügbar`}</span>{b.app_favorite && <span className="tg-heart" aria-label="TGTG-App-Favorit">♥</span>}{b.generic_cover && <span className="tg-generic">TGTG-Kategoriefoto</span>}</div>
      <div className="tg-body"><div className="tg-store"><div className="tg-logo"><Photo bag={b} kind="logo" /></div><div><h3>{b.merchant}</h3><p title={b.address}>{b.address}</p></div></div><p className="tg-bag-name">{b.bag}</p>
        <div className="tg-rating"><strong>{b.rating === null ? "Keine Bewertung" : `${b.rating.toFixed(2)} ★`}</strong><span>({b.rating_count ?? "—"})</span><span className="tg-distance">{b.distance === null ? "Distanz unbekannt" : `${b.distance.toFixed(2)} km`}</span></div>
        <div className="tg-pickup"><div><small>Abholung</small>{pickup(b.pickup)}</div><strong>{money(b.price)}</strong></div>
        <div className="tg-prices"><div><small>Beobachtet min. – max.</small><strong>{money(b.min)} – {money(b.max)}</strong></div><div><small>Minimum mit Bestand</small><strong>{money(b.stock_min)}</strong></div></div>
        <div className="tg-tags"><span>{b.stable ? "Unverändert" : b.days < 2 ? "Wenig Verlauf" : "Variabel / unvollständig"} · {b.days} Tage</span>{b.local_favorite && <span>Tracker-Präferenz</span>}{review && <span className={review.buy_again === false || review.verdict === "negative" ? "tg-negative" : ""}>{verdict(review)}</span>}</div>
        <div className="tg-bottom"><small>{b.fresh ? "Frische Beobachtung" : "Veraltet · Bestand prüfen"}<br />{time(b.observed)}{!b.in_latest && " · Nicht im letzten Abruf"}</small><button onClick={() => void open(b)}>Verlauf{data?.personal ? " & Feedback" : ""}</button></div>
      </div></article>; })}</div>
    {data && !rows.length && <p className="tg-empty">Keine passenden Sackerl.</p>}
    <dialog ref={dialog} className="tg-dialog" onCancel={() => { detailGeneration.current++; setSelected(null); }}><div className="tg-dialog-head"><h3>{selected?.merchant} · {selected?.bag}</h3><button aria-label="Verlauf schließen" onClick={close}><X size={20} /></button></div>
      {selected?.reviews?.map((r, i) => <div className="tg-review" key={i}><strong>{verdict(r)}</strong> · {r.date}<p>{r.quote}</p></div>)}
      {historyError ? <p role="alert">{historyError}</p> : history === null ? <p>Lädt…</p> : <><p className="tg-note">{history.length} Beobachtungen · Bestand ist keine Kaufgarantie.</p><div className="tg-table"><table><thead><tr><th>Beobachtet</th><th>Preis</th><th>Bestand</th><th>Abholung</th></tr></thead><tbody>{history.map((h, i) => <tr key={i}><td>{time(h.observed)}</td><td>{money(h.price)}</td><td>{h.stock ?? "—"}</td><td>{pickup(h.pickup)}</td></tr>)}</tbody></table></div></>}
    </dialog>
  </section>;
}
