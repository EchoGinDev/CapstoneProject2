// EAICS Workspace â€” UI layanan pelanggan agentik (Kelompok B, TRD Â§4.13, NFR-08).
// Semua data live dari backend via proxy Vite (/v1, /internal -> :8000).
import React, { useCallback, useEffect, useRef, useState } from 'react'
import './app.css'
import {
  req, ApiError, getAuthSession, subscribeAuth, devCustomerLogin, devStaffLogin, devCustomerLogout, isDevelopmentAuthEnabled, isDevelopmentStaffAuthEnabled,
  CLOSURE_ITEMS, QA_FIELDS, QA_AUTO_FAIL, QA_FINDING_TYPES, SEVERITIES, REASONS,
} from './api.js'

const CUSTOMER_LINKS = [
  ['/customer/chat', 'Chat dengan layanan'], ['/customer/requests/new', 'Kirim permintaan'],
  ['/customer/requests', 'Lacak permintaan'], ['/customer/conversations', 'Riwayat percakapan'], ['/customer/account', 'Akun'],
]
const STAFF_ROUTES = {
  cs_agent: [['/agent/queue', 'Antrean'], ['/agent/conversations', 'Percakapan'], ['/agent/cases', 'Kasus & tiket']],
  supervisor: [['/supervisor', 'Operasional'], ['/supervisor/queue', 'Antrean'], ['/supervisor/cases', 'Kasus'], ['/supervisor/approvals', 'Persetujuan'], ['/supervisor/sla', 'SLA'], ['/supervisor/audit', 'Audit']],
  complaint_officer: [['/complaints', 'Penanganan keluhan']], knowledge_manager: [['/knowledge', 'Basis pengetahuan']],
  qa_analyst: [['/qa', 'Quality review']], management: [['/management', 'Ringkasan kinerja']], admin: [['/admin', 'Administrasi sistem']],
}
const ROUTES = {
  '/customer/login': { title: 'Masuk ke akun pelanggan', audience: 'public', page: 'customer-login' },
  '/staff/login': { title: 'Masuk staf', audience: 'public', page: 'staff-login' },
  '/customer/chat': { title: 'Chat layanan pelanggan', audience: 'customer', page: 'customer-chat' },
  '/customer/requests/new': { title: 'Kirim permintaan layanan', audience: 'customer', unit: '06' },
  '/customer/requests': { title: 'Lacak permintaan', audience: 'customer', unit: '06' },
  '/customer/conversations': { title: 'Riwayat percakapan', audience: 'customer', page: 'customer-history' },
  '/customer/account': { title: 'Akun pelanggan', audience: 'customer', unit: '14' },
  '/agent/queue': { title: 'Antrean layanan', audience: ['cs_agent', 'supervisor'], page: 'queue' },
  '/agent/conversations': { title: 'Percakapan', audience: ['cs_agent', 'supervisor'], page: 'conv' },
  '/agent/cases': { title: 'Kasus & tiket', audience: ['cs_agent', 'supervisor'], page: 'cases' },
  '/supervisor': { title: 'Ikhtisar operasional', audience: 'supervisor', page: 'dash' },
  '/supervisor/queue': { title: 'Antrean & handoff', audience: 'supervisor', page: 'queue' },
  '/supervisor/cases': { title: 'Kasus', audience: 'supervisor', page: 'cases' },
  '/supervisor/approvals': { title: 'Persetujuan', audience: 'supervisor', page: 'approvals' },
  '/supervisor/sla': { title: 'Pemantauan SLA', audience: 'supervisor', page: 'sla' },
  '/supervisor/audit': { title: 'Audit trail', audience: 'supervisor', page: 'audit' },
  '/complaints': { title: 'Penanganan keluhan', audience: 'complaint_officer', unit: '09' },
  '/knowledge': { title: 'Basis pengetahuan', audience: 'knowledge_manager', unit: '11' },
  '/qa': { title: 'Quality assurance', audience: 'qa_analyst', page: 'qa' },
  '/management': { title: 'Ringkasan kinerja', audience: 'management', page: 'analytics' },
  '/admin': { title: 'Administrasi sistem', audience: 'admin', unit: '14' },
}
function navigate(path) { if (window.location.pathname !== path) window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')) }
function StatePanel({ title, children }) { return <section className="state-panel" role="status"><h2>{title}</h2><p>{children}</p></section> }

/* ---------- komponen kecil ---------- */
function Card({ title, sub, children, wide }) {
  return (
    <div className="card" style={wide ? { gridColumn: '1 / -1' } : undefined}>
      {title && <h3>{title}</h3>}
      {sub && <p className="sub">{sub}</p>}
      {children}
    </div>
  )
}
function Err({ e, onClose }) {
  if (!e) return null
  return <p className="alert err">{e.message || String(e)}{onClose && <button className="btn sm" style={{ marginLeft: 10 }} onClick={onClose}>Tutup</button>}</p>
}
function Empty({ text }) { return <div className="empty">{text}</div> }
function Json({ data }) { return <pre className="dump">{JSON.stringify(data, null, 2)}</pre> }
function Sev({ v }) {
  const cls = v === 'CRITICAL' ? 'b-red' : v === 'HIGH' ? 'b-amber' : v === 'MEDIUM' ? 'b-blue' : 'b-green'
  return <span className={`badge ${cls}`}>{v || '-'}</span>
}
function StateBadge({ v }) {
  const s = String(v || '')
  const cls = /CLOSED|SENT|ACCEPTED|GRANTED/.test(s) ? 'b-green'
    : /BREACHED|DENIED|OPEN|QUEUED|PENDING|RUNNING|AT_RISK/.test(s) ? 'b-amber'
    : /REOPENED|REJECT|FAIL|BLOCK/.test(s) ? 'b-red' : 'b-gray'
  return <span className={`badge ${cls}`}>{s || '-'}</span>
}
function useForm(initial) {
  const [v, setV] = useState(initial)
  const set = (k) => (e) => {
    const t = e.target
    const val = t.type === 'checkbox' ? t.checked : t.value
    setV((o) => ({ ...o, [k]: val }))
  }
  const reset = () => setV(initial)
  return [v, set, reset, setV]
}

/* ================= App ================= */
export default function App() {
  const [path, setPath] = useState(window.location.pathname)
  const [session, setSession] = useState(undefined)
  const [authError, setAuthError] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [navCollapsed, setNavCollapsed] = useState(false)
  const menuButtonRef = useRef(null)
  const navRef = useRef(null)
  const menuWasOpen = useRef(false)
  useEffect(() => {
    const sync = () => { setPath(window.location.pathname); setMenuOpen(false) }
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])
  useEffect(() => {
    if (menuOpen) navRef.current?.querySelector('a, button')?.focus()
    else if (menuWasOpen.current) menuButtonRef.current?.focus()
    menuWasOpen.current = menuOpen
  }, [menuOpen])
  useEffect(() => {
    let active = true
    const load = async () => { try { const value = await getAuthSession(); if (active) { setSession(value); setAuthError(false) } } catch { if (active) { setSession(null); setAuthError(true) } } }
    const unsubscribe = subscribeAuth(load)
    load()
    return () => { active = false; unsubscribe() }
  }, [])

  const route = ROUTES[path]
  const role = session?.principal?.role
  const customerRoute = route?.audience === 'customer'
  const isPublic = path === '/' || path === '/customer/login' || path === '/staff/login'
  const permitted = customerRoute ? role === 'customer' : Array.isArray(route?.audience) ? route.audience.includes(role) : route?.audience === role
  const needsAuth = !isPublic && !session
  const navItems = isPublic || (customerRoute && (!session || role === 'customer')) ? CUSTOMER_LINKS : (STAFF_ROUTES[role] || [])
  const title = route?.title || (isPublic ? 'Layanan pelanggan' : 'Halaman tidak ditemukan')
  const Page = route?.page === 'customer-login' ? CustomerLogin : route?.page === 'staff-login' ? StaffLogin : route?.page === 'customer-chat' ? CustomerChat : route?.page === 'customer-history' ? CustomerHistory : route?.page === 'dash' ? Dash : route?.page === 'queue' ? Queue : route?.page === 'conv' ? Conv : route?.page === 'cases' ? Cases : route?.page === 'approvals' ? Approvals : route?.page === 'qa' ? QA : route?.page === 'analytics' ? Analytics : route?.page === 'sla' ? SLA : route?.page === 'audit' ? Audit : null
  const customerShell = isPublic || customerRoute
  let content
  if (path === '/') content = <CustomerHome />
  else if (path === '/customer/login') content = <CustomerLogin />
  else if (path === '/staff/login') content = <StaffLogin />
  else if (!route) content = <StatePanel title="Halaman tidak ditemukan">Alamat ini tidak tersedia.</StatePanel>
  else if (session === undefined) content = <StatePanel title="Memeriksa sesi">Sesi autentikasi sedang diperiksa.</StatePanel>
  else if (authError) content = <StatePanel title="Sesi tidak dapat diperiksa">Penyedia identitas tidak dapat memeriksa sesi ini. Muat ulang atau hubungi administrator.</StatePanel>
  else if (needsAuth) content = <StatePanel title="Autentikasi diperlukan">Akses memerlukan sesi pelanggan terverifikasi. <a href="/customer/login" onClick={(e) => { e.preventDefault(); navigate('/customer/login') }}>Masuk</a> untuk melanjutkan.</StatePanel>
  else if (!permitted) content = <StatePanel title="Akses tidak diizinkan">Sesi ini tidak memiliki akses ke halaman tersebut.</StatePanel>
  else if (Page) content = <Page role={role} />
  else content = <StatePanel title="Belum tersedia">Alur ini direncanakan pada Unit {route.unit}. Fungsionalitas dan data belum terhubung.</StatePanel>

  return <div className={`product-shell${customerShell ? ' customer-shell' : ' staff-shell'}${navCollapsed ? ' nav-collapsed' : ''}${menuOpen ? ' nav-open' : ''}`} onKeyDown={(event) => { if (event.key === 'Escape' && menuOpen) setMenuOpen(false) }}>
    <a className="skip-link" href="#main-content">Lewati ke konten</a>
    {menuOpen && <button className="nav-scrim" aria-label="Tutup navigasi" onClick={() => setMenuOpen(false)} />}
    <aside className="product-sidebar" aria-label={customerShell ? 'Navigasi portal pelanggan' : 'Navigasi ruang kerja'}>
      <a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }} className="product-brand">
        <span className="product-mark" aria-hidden="true">E</span>
        <span className="brand-copy"><strong>EAICS</strong><small>Enterprise service desk</small></span>
      </a>
      <div className="sidebar-section-label">{customerShell ? 'PORTAL PELANGGAN' : 'RUANG KERJA'}</div>
      <nav ref={navRef} id="primary-navigation" className="primary-navigation" aria-label={customerShell ? 'Navigasi pelanggan' : 'Navigasi staf'}>
        {navItems.map(([href, label], index) => <a className="nav-item" key={href} href={href} title={label} aria-current={path === href ? 'page' : undefined} onClick={(e) => { e.preventDefault(); navigate(href) }}>
          <span className="nav-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><span className="nav-copy">{label}</span><span className="nav-arrow" aria-hidden="true">↗</span>
        </a>)}
        {customerShell && !session && <a className="nav-item nav-login" href="/customer/login" title="Masuk" aria-current={path === '/customer/login' ? 'page' : undefined} onClick={(e) => { e.preventDefault(); navigate('/customer/login') }}>
          <span className="nav-index" aria-hidden="true">↳</span><span className="nav-copy">Masuk akun</span><span className="nav-arrow" aria-hidden="true">↗</span>
        </a>}
        {isPublic && <a className="nav-item nav-login" href="/staff/login" title="Ruang kerja staf" aria-current={path === '/staff/login' ? 'page' : undefined} onClick={(e) => { e.preventDefault(); navigate('/staff/login') }}>
          <span className="nav-index" aria-hidden="true">↳</span><span className="nav-copy">Ruang kerja staf</span><span className="nav-arrow" aria-hidden="true">↗</span>
        </a>}
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-account-mark" aria-hidden="true">{customerShell ? 'C' : (role || 'S').slice(0, 1).toUpperCase()}</div>
        <div className="sidebar-account-copy"><strong>{session?.principal?.role === 'customer' ? 'Akun pelanggan' : role ? role.replaceAll('_', ' ') : customerShell ? 'Layanan terbuka' : 'Sesi staf'}</strong><span>{session ? 'Sesi terverifikasi' : 'Akses mengikuti autentikasi'}</span></div>
        {customerShell && session?.principal?.role === 'customer' && <button className="logout-button" title="Keluar" aria-label="Keluar" onClick={() => { devCustomerLogout(); navigate('/') }}>↗</button>}
      </div>
    </aside>
    <div className="product-mainframe">
      <header className="product-header">
        <div className="header-leading">
          <button ref={menuButtonRef} className="menu-toggle" aria-expanded={menuOpen} aria-controls="primary-navigation" onClick={() => setMenuOpen((v) => !v)} aria-label={menuOpen ? 'Tutup navigasi' : 'Buka navigasi'}><span aria-hidden="true">{menuOpen ? '×' : '☰'}</span></button>
          <button className="collapse-toggle" aria-expanded={!navCollapsed} aria-label={navCollapsed ? 'Perluas navigasi' : 'Perkecil navigasi'} title={navCollapsed ? 'Perluas navigasi' : 'Perkecil navigasi'} onClick={() => setNavCollapsed((v) => !v)}><span aria-hidden="true">{navCollapsed ? '»' : '«'}</span></button>
          <div className="header-context"><span className="header-kicker">{customerShell ? 'EAICS / LAYANAN PELANGGAN' : `EAICS / ${(role || 'WORKSPACE').replaceAll('_', ' ').toUpperCase()}`}</span><span className="header-title">{isPublic ? 'Pusat bantuan' : title}</span></div>
        </div>
        <div className="header-trailing">
          <span className="header-environment"><span className="environment-dot" aria-hidden="true" />{session ? 'Sesi aktif' : customerShell ? 'Portal publik' : 'Akses terbatas'}</span>
        </div>
      </header>
      <main id="main-content" className="product-main">
        {!isPublic && <div className="page-heading"><a href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}>Beranda</a><span aria-hidden="true">/</span><h1>{title}</h1></div>}
        {content}
      </main>
      <footer className="product-footer"><span>EAICS</span><span>·</span><span>Pengalaman layanan yang lebih jelas</span></footer>
    </div>
  </div>
}

function CustomerHome() {
  return <div className="customer-home">
    <section className="customer-intro">
      <div className="intro-copy">
        <p className="eyebrow"><span className="eyebrow-rule" />BANTUAN LAYANAN EAICS</p>
        <h1>Urusan layanan,<br /><em>lebih terarah.</em></h1>
        <p className="intro-description">Mulai percakapan, sampaikan kebutuhan, atau ikuti perkembangan layanan Anda dari satu tempat.</p>
        <div className="intro-primary-row"><a className="btn primary intro-cta" href="/customer/chat" onClick={(e) => { e.preventDefault(); navigate('/customer/chat') }}>Mulai percakapan <span aria-hidden="true">↗</span></a><span className="intro-caption">Jawaban dan status mengikuti data yang tersedia pada layanan.</span></div>
      </div>
      <aside className="welcome-panel" aria-label="Cara memulai">
        <div className="welcome-panel-top"><span className="panel-index">01 / 03</span><span className="panel-mark" aria-hidden="true">E</span></div>
        <p className="eyebrow">MULAI DARI SINI</p>
        <h2>Apa yang ingin Anda urus?</h2>
        <p className="welcome-panel-copy">Pilih jalur yang sesuai. Alur yang memerlukan akun akan meminta Anda masuk terlebih dahulu.</p>
        <a className="welcome-link" href="/customer/chat" onClick={(e) => { e.preventDefault(); navigate('/customer/chat') }}><span><strong>Tanyakan informasi layanan</strong><small>Percakapan bantuan</small></span><b aria-hidden="true">↗</b></a>
        <a className="welcome-link" href="/customer/conversations" onClick={(e) => { e.preventDefault(); navigate('/customer/conversations') }}><span><strong>Lihat percakapan terdahulu</strong><small>Riwayat akun</small></span><b aria-hidden="true">↗</b></a>
      </aside>
    </section>
    <section className="customer-services" aria-labelledby="service-heading">
      <div className="section-heading"><div><p className="eyebrow">JALUR LAYANAN</p><h2 id="service-heading">Pilih langkah berikutnya</h2></div><span className="section-note">Akses akun diperlukan untuk alur personal.</span></div>
      <div className="customer-actions" aria-label="Pilihan bantuan">
        {CUSTOMER_LINKS.slice(0, 4).map(([href, label], index) => <a className="portal-action" key={href} href={href} onClick={(e) => { e.preventDefault(); navigate(href) }}><span className="action-number">0{index + 1}</span><strong>{label}</strong><span>{index === 0 ? 'Ajukan pertanyaan kepada layanan.' : index === 1 ? 'Sampaikan kebutuhan atau kendala.' : index === 2 ? 'Periksa perkembangan permintaan Anda.' : 'Buka percakapan yang tersimpan.'}</span><b aria-hidden="true">↗</b></a>)}
      </div>
    </section>
    <p className="portal-note"><span aria-hidden="true">◇</span> Akses personal memerlukan autentikasi. Login lokal hanya tersedia bila diaktifkan pengelola lingkungan pengembangan.</p>
  </div>
}

function StaffLogin() {
  const [username, setUsername] = useState(''); const [password, setPassword] = useState('')
  const [error, setError] = useState(null); const [loading, setLoading] = useState(false)
  const submit = async (event) => {
    event.preventDefault(); setError(null); setLoading(true)
    try {
      const principal = await devStaffLogin(username, password)
      const destination = { cs_agent: '/agent/queue', supervisor: '/supervisor', complaint_officer: '/complaints', knowledge_manager: '/knowledge', qa_analyst: '/qa', management: '/management', admin: '/admin' }[principal.role]
      if (!destination) throw new ApiError(403, 'FORBIDDEN', 'Akun staf tidak memiliki ruang kerja yang tersedia.')
      navigate(destination)
    } catch (err) { setError(err) } finally { setLoading(false) }
  }
  return <section className="customer-auth"><p className="eyebrow"><span className="eyebrow-rule" />AKSES INTERNAL</p><h2>Ruang kerja staf</h2><p className="auth-intro">Masuk menggunakan akun yang dikelola oleh lingkungan layanan Anda.</p>
    {!isDevelopmentStaffAuthEnabled ? <p className="alert info">Autentikasi staf belum terhubung. Gunakan penyedia identitas organisasi saat tersedia.</p> : <form className="form" onSubmit={submit}>
      <p>Login lokal hanya tersedia di lingkungan pengembangan dan untuk akun yang dikonfigurasi di server.</p>
      <label>Nama pengguna<input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required /></label>
      <label>Kata sandi<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
      {error && <p className="alert err" role="alert">{error.message}</p>}
      <button className="btn primary" disabled={loading}>{loading ? 'Memeriksa…' : 'Masuk'}</button>
    </form>}
  </section>
}

function CustomerLogin() {
  const [username, setUsername] = useState(''); const [password, setPassword] = useState('')
  const [error, setError] = useState(null); const [loading, setLoading] = useState(false)
  const submit = async (event) => { event.preventDefault(); setError(null); setLoading(true); try { await devCustomerLogin(username, password); navigate('/customer/chat') } catch (err) { setError(err) } finally { setLoading(false) } }
  return <section className="customer-auth"><p className="eyebrow"><span className="eyebrow-rule" />AKUN PELANGGAN</p><h2>Selamat datang kembali.</h2><p className="auth-intro">Masuk untuk melihat percakapan dan permintaan yang terkait dengan akun Anda.</p>
    {!isDevelopmentAuthEnabled ? <p className="alert info">Login lokal belum diaktifkan. Minta pengelola menyiapkan autentikasi pengembangan.</p> : <form className="form" onSubmit={submit}>
      <p>Login lokal khusus pengembangan. Gunakan akun yang dikonfigurasi pengelola backend.</p>
      <label>Nama pengguna<input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required /></label>
      <label>Kata sandi<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
      {error && <p className="alert err" role="alert">{error.message}</p>}
      <button className="btn primary" disabled={loading}>{loading ? 'Memeriksa…' : 'Masuk'}</button>
    </form>}
  </section>
}

function CustomerChat() {
  const [text, setText] = useState(() => new URLSearchParams(window.location.search).get('draft') || ''); const [conversationId, setConversationId] = useState(null)
  const [messages, setMessages] = useState([]); const [error, setError] = useState(null); const [notice, setNotice] = useState(null); const [retryInfo, setRetryInfo] = useState(null)
  const [loading, setLoading] = useState(false); const [sending, setSending] = useState(false)
  const submitLock = useRef(false)
  const load = useCallback(async (id) => { setLoading(true); setError(null); try { let cursor = null; const all = []; do { const suffix = cursor ? `?limit=100&cursor=${encodeURIComponent(cursor)}` : '?limit=100'; const data = await req(`/v1/conversations/${encodeURIComponent(id)}/read-model${suffix}`); all.push(...(data.messages || [])); cursor = data.next_cursor } while (cursor); setConversationId(id); setMessages(all) } catch (err) { setError(err) } finally { setLoading(false) } }, [])
  const send = async (event) => {
    event.preventDefault(); const content = text.trim(); if (!content || submitLock.current) return
    submitLock.current = true
    setSending(true); setError(null); setNotice(null)
    const idempotencyKey = retryInfo?.text === content ? retryInfo.key : crypto.randomUUID()
      try { const result = await req('/v1/chat/messages', { method: 'POST', body: { text: content, ...(conversationId ? { conversation_id: conversationId } : {}) }, headers: { 'Idempotency-Key': idempotencyKey } }); if (!result.conversation_id) throw new ApiError(502, 'MISSING_CONVERSATION', 'Layanan tidak mengembalikan referensi percakapan.'); setRetryInfo(null); setConversationId(result.conversation_id); setText(''); setNotice(result.handoff_status === 'ACCEPTED' ? 'Petugas telah menerima permintaan bantuan.' : result.handoff_status === 'QUEUED' || result.handoff_status === 'OFFERED' ? 'Permintaan bantuan masuk antrean; petugas belum mengonfirmasi penerimaan.' : result.handoff_status === 'UNAVAILABLE' ? 'Pesan tersimpan, tetapi status antrean bantuan belum dapat dipastikan.' : 'Pesan diproses oleh layanan.'); await load(result.conversation_id) }
    catch (err) { setRetryInfo({ text: content, key: idempotencyKey }); setError(err) } finally { submitLock.current = false; setSending(false) }
  }
  const handleComposerKeyDown = (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    const form = event.currentTarget.form
    const submitButton = form?.querySelector('button[type="submit"]')
    if (submitButton?.disabled) return
    form?.requestSubmit()
  }
  return <section className="customer-chat">
    <div className="chat-topline"><div><p className="eyebrow"><span className="eyebrow-rule" />RUANG PERCAKAPAN</p><p className="chat-description">Pesan Anda diproses oleh layanan EAICS dan disimpan pada akun setelah dikirim.</p></div>{conversationId && <p className="conversation-ref"><span>REFERENSI</span><strong>{conversationId}</strong></p>}</div>
    {notice && <div className="alert info chat-notice" role="status"><span>{notice}</span><a href="/customer/conversations" onClick={(e) => { e.preventDefault(); navigate('/customer/conversations') }}>Buka riwayat percakapan ↗</a></div>}
    {error && <div className="talkback" role="alert"><span className="talkback-mark" aria-hidden="true">!</span><div><strong>Pesan belum berhasil diproses.</strong><p>{error.message}{error.status === 401 ? <> <a href="/customer/login" onClick={(e) => { e.preventDefault(); navigate('/customer/login') }}>Masuk kembali</a> untuk melanjutkan.</> : error.status === 403 ? ' Hubungi pengelola layanan jika menurut Anda akses ini seharusnya tersedia.' : ' Pesan Anda tetap berada di kolom; pengiriman ulang memakai kunci idempotensi yang sama.'}</p></div></div>}
    <div className="customer-transcript" aria-live="polite" aria-busy={loading}>
      {loading ? <div className="transcript-skeleton" role="status" aria-label="Memuat percakapan"><span /><span /><span /></div> : messages.length ? messages.map((m) => <article className={`customer-message ${m.direction === 'INBOUND' ? 'from-customer' : 'from-service'}`} key={m.message_id || m.sequence_no}>
        <div className="message-byline"><span className="message-avatar" aria-hidden="true">{m.direction === 'INBOUND' ? 'A' : m.author_type === 'AI_AGENT' ? 'E' : 'P'}</span><span><strong>{m.direction === 'INBOUND' ? 'Anda' : m.author_type === 'AI_AGENT' ? 'Asisten layanan' : 'Petugas'}</strong><small>{m.occurred_at ? new Date(m.occurred_at).toLocaleString() : ''}</small></span></div>
        <p>{m.content}</p>
        {(m.citations || []).length > 0 && <div className="message-sources"><span className="source-label">SUMBER INFORMASI</span>{m.citations.map((c, i) => <span className="source-chip" key={c.version_id || c.article_id || i}>↗ {c.title || c.source || 'Referensi layanan'}{c.version ? ` · v${c.version}` : ''}</span>)}</div>}
      </article>) : <div className="chat-empty">
        <div className="empty-emblem" aria-hidden="true"><span>E</span><i /></div>
        <p className="eyebrow">BANTUAN YANG JELAS</p>
        <h2>Mulai dengan yang ingin Anda ketahui.</h2>
        <p>Jelaskan kebutuhan Anda dengan bahasa sendiri. Jika perlu klarifikasi atau bantuan lanjutan, layanan akan memberi tahu langkah berikutnya.</p>
        <div className="starter-prompts" aria-label="Saran pertanyaan">
          {['Saya ingin mengetahui jam operasional layanan.', 'Berapa biaya transfer internasional?', 'Saya ingin berbicara dengan petugas.'].map((prompt) => <button key={prompt} type="button" className="prompt-chip" onClick={() => setText(prompt)}>{prompt}<span aria-hidden="true">↗</span></button>)}
        </div>
      </div>}
    </div>
    <form className="customer-composer" onSubmit={send}>
      <label htmlFor="customer-message">Tulis pesan</label>
      <textarea id="customer-message" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={handleComposerKeyDown} placeholder="Ceritakan apa yang ingin Anda tanyakan…" maxLength={4000} rows={3} required />
      <div className="composer-actions"><span className="composer-hint">Hindari memasukkan kata sandi atau data pembayaran.</span><span className="composer-count">{text.length}/4000</span><button type="submit" className={`btn primary send-button${sending ? ' is-sending' : ''}`} disabled={sending || !text.trim() || error?.status === 401 || error?.status === 403}>{sending ? <><span className="button-spinner" aria-hidden="true" />Mengirim</> : error?.status === 401 ? 'Masuk kembali' : error?.status === 403 ? 'Akses dibatasi' : retryInfo?.text === text.trim() ? 'Coba kirim lagi ↗' : <>Kirim pesan <span aria-hidden="true">↗</span></>}</button></div>
    </form>
    <p className="chat-footnote">Lampiran dan pemrosesan langsung ke model AI tidak tersedia pada alur percakapan ini.</p>
  </section>
}

function CustomerHistory() {
  const [items, setItems] = useState([]); const [selected, setSelected] = useState(null); const [error, setError] = useState(null); const [loading, setLoading] = useState(true); const [nextCursor, setNextCursor] = useState(null)
  const load = useCallback(async (cursor = null, append = false) => { setLoading(true); setError(null); try { const query = cursor ? `?limit=20&cursor=${encodeURIComponent(cursor)}` : '?limit=20'; const data = await req(`/v1/customer/conversations${query}`); setItems((current) => append ? [...current, ...(data.items || [])] : data.items || []); setNextCursor(data.next_cursor || null) } catch (err) { setError(err) } finally { setLoading(false) } }, [])
  useEffect(() => { load() }, [load])
  const detail = async (id) => { setError(null); try { let cursor = null; let data; const messages = []; do { const suffix = cursor ? `?limit=100&cursor=${encodeURIComponent(cursor)}` : '?limit=100'; data = await req(`/v1/conversations/${encodeURIComponent(id)}/read-model${suffix}`); messages.push(...(data.messages || [])); cursor = data.next_cursor } while (cursor); setSelected({ ...data, messages }) } catch (err) { setError(err) } }
  return <section className="customer-history"><div className="row"><p className="sub">Percakapan yang terkait dengan akun Anda.</p><button className="btn sm" onClick={load}>Muat ulang</button></div>
    {error && <p className="alert err" role="alert">{error.message}</p>}{loading && !items.length ? <Empty text="Memuat riwayat…" /> : !items.length ? <Empty text="Belum ada percakapan." /> : <ul className="conversation-list">{items.map((item) => <li key={item.conversation_id}><button className="conversation-list-item" onClick={() => detail(item.conversation_id)}><strong>{item.conversation_id}</strong><span>{item.status} · {new Date(item.last_activity_at).toLocaleString()}</span></button></li>)}</ul>}
    {nextCursor && <button className="btn" disabled={loading} onClick={() => load(nextCursor, true)}>{loading ? 'Memuat…' : 'Muat percakapan sebelumnya'}</button>}
      {selected && <div className="customer-transcript"><h2>{selected.conversation.conversation_id}</h2>{selected.messages.map((m) => <article className={`customer-message ${m.direction === 'INBOUND' ? 'from-customer' : 'from-service'}`} key={m.message_id || m.sequence_no}><p>{m.content}</p><small>{m.direction === 'INBOUND' ? 'Anda' : 'Layanan'}</small>{(m.citations || []).map((citation, i) => <small key={i}>Sumber: {citation.title || citation.source || 'Referensi layanan'}{citation.passage_ref ? ` · ${citation.passage_ref}` : ''}</small>)}</article>)}</div>}
  </section>
}
/* ---------- Dasbor ---------- */
function Dash({ role }) {
  const [d, setD] = useState(null)
  const [e, setE] = useState(null)
  const load = useCallback(async () => {
    setE(null)
    try {
      const [op, res, ho, qa, ob] = await Promise.all([
        req('/v1/analytics/operational', { role }),
        req('/v1/analytics/resolution', { role }),
        req('/v1/analytics/handoff', { role }),
        req('/v1/analytics/qa', { role }),
        req('/internal/outbox-status', { role }),
      ])
      setD({ op, res, ho, qa, ob })
    } catch (err) { setE(err) }
  }, [role])
  useEffect(() => { load() }, [load])
  return (
    <>
      <div className="hero">
        <h2>Selamat datang di EAICS Workspace</h2>
        <p>Antrean prioritas, kasus/tiket, persetujuan tool sensitif, QA ber-sampling, SLA jam kerja Asia/Jakarta, dan audit hash-chain â€” semua live dari backend Kelompok B (FRD/TRD).</p>
        <div className="row mt"><button className="btn" style={{ background: '#fff' }} onClick={load}>Muat ulang</button></div>
      </div>
      <div className="mt" />
      <Err e={e} onClose={() => setE(null)} />
      {!d ? <Card><Empty text="Memuat metrikâ€¦" /></Card> : (
        <>
          <div className="grid g4">
            <Card><div className="stat"><span className="v">{d.op.cases_total}</span><span className="l">Total kasus</span><span className="d">terbuka: {d.op.open_cases}</span></div></Card>
            <Card><div className="stat"><span className="v">{d.op.tickets_total}</span><span className="l">Total tiket</span><span className="d">pelanggaran SLA: {d.op.sla_breached}</span></div></Card>
            <Card><div className="stat"><span className="v">{Math.round((d.op.sla_attainment_ratio || 0) * 100)}%</span><span className="l">Ketercapaian SLA</span><span className="d">breach/started</span></div></Card>
            <Card><div className="stat"><span className="v">{d.ob.pending}</span><span className="l">Outbox pending</span><span className="d">terkirim: {d.ob.sent}</span></div></Card>
          </div>
          <div className="grid g3 mt">
            <Card title="Resolusi" sub={`Target SM-13 ${d.res.target_SM13} (reopen rate)`}>
              <div className="stat"><span className="v">{Math.round((d.res.reopen_rate || 0) * 100)}%</span><span className="l">reopen rate â€¢ tutup: {d.res.closed}</span></div>
            </Card>
            <Card title="Handoff" sub={`Target SM-07 paket lengkap = ${d.ho.target_SM07}`}>
              <div className="stat"><span className="v">{Math.round((d.ho.complete_rate || 0) * 100)}%</span><span className="l">paket lengkap â€¢ total {d.ho.total}</span></div>
            </Card>
            <Card title="QA" sub="Rata-rata total skor review">
              <div className="stat"><span className="v">{d.qa.avg_total}</span><span className="l">n = {d.qa.n} â€¢ auto-fail {Math.round((d.qa.auto_fail_rate || 0) * 100)}%</span></div>
            </Card>
          </div>
        </>
      )}
    </>
  )
}

/* ---------- Antrean ---------- */
function Queue({ role }) {
  const [items, setItems] = useState([])
  const [e, setE] = useState(null)
  const [sel, setSel] = useState(null)
  const [filter, setFilter] = useState({ queue_id: '', skills: '' })
  const [f, setF, resetF] = useForm({ conversation_id: 'CNV-DEMO-1', reason_code: 'CUSTOMER_REQUEST', severity: 'MEDIUM', queue_id: 'Q-GENERAL', skill_tags: '', vulnerability_flag: false, package_complete: true })
  const [t, setT] = useForm({ to_queue: 'Q-GENERAL', reason: '', note: '' })
  const [ho, setHo] = useState(null)

  const load = useCallback(async () => {
    setE(null)
    try {
      const q = new URLSearchParams()
      if (filter.queue_id) q.set('queue_id', filter.queue_id)
      if (filter.skills) q.set('skills', filter.skills)
      const r = await req(`/v1/workspace/queue${q.toString() ? `?${q}` : ''}`, { role })
      setItems(r.items || [])
    } catch (err) { setE(err) }
  }, [role, filter.queue_id, filter.skills])
  useEffect(() => { load(); const tmr = setInterval(load, 8000); return () => clearInterval(tmr) }, [load])

  const enqueue = async () => {
    setE(null)
    try {
      const r = await req('/v1/workspace/queue/enqueue', {
        method: 'POST', role,
        body: {
          conversation_id: f.conversation_id, reason_code: f.reason_code, severity: f.severity,
          queue_id: f.queue_id, skill_tags: f.skill_tags.split(',').map((s) => s.trim()).filter(Boolean),
          vulnerability_flag: f.vulnerability_flag, package_complete: f.package_complete,
        },
      })
      setHo({ ok: true, data: r }); resetF(); load()
    } catch (err) { setE(err) }
  }
  const accept = async (it) => {
    setE(null)
    try {
      await req(`/v1/workspace/handoffs/${it.handoff_id}/accept`, { method: 'POST', role, body: {} })
      setSel(null); load()
    } catch (err) { setE(err) }
  }
  const transfer = async () => {
    if (!sel) return
    setE(null)
    try {
      const r = await req(`/v1/workspace/handoffs/${sel.handoff_id}/transfer`, { method: 'POST', role, body: t })
      setHo({ ok: true, data: r }); load()
    } catch (err) { setE(err) }
  }
  const quickHandoff = async () => {
    setE(null)
    try {
      const r = await req('/v1/handoffs', { method: 'POST', role, body: { conversation_id: f.conversation_id, reason_code: f.reason_code, recent_turns: [] } })
      setHo({ ok: true, data: r })
    } catch (err) { setE(err) }
  }

  return (
    <>
      <Err e={e} onClose={() => setE(null)} />
      <div className="split">
        <Card title={`Antrean (${items.length})`} sub="Diurutkan skor prioritas; refresh otomatis 8 detik (FR-WS-002).">
          <div className="row">
            <input placeholder="Filter queue_id" value={filter.queue_id} onChange={(e) => setFilter({ ...filter, queue_id: e.target.value })} style={{ width: 150 }} />
            <input placeholder="Filter skill (a,b)" value={filter.skills} onChange={(e) => setFilter({ ...filter, skills: e.target.value })} style={{ width: 150 }} />
            <button className="btn sm" onClick={load}>Muat ulang</button>
          </div>
          <div className="mt" style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead><tr><th>Percakapan</th><th>Alasan</th><th>Sev</th><th>Skor</th><th>Tunggu</th><th>Antrean</th><th>Aksi</th></tr></thead>
              <tbody>
                {items.map((q) => (
                  <tr key={q.handoff_id} className={`clickable${sel?.handoff_id === q.handoff_id ? ' sel' : ''}`} onClick={() => { setSel(q); setT((o) => ({ ...o })) }}>
                    <td><b>{q.conversation_id}</b><br /><span style={{ fontSize: 11, color: '#64748b' }}>{q.handoff_id}</span></td>
                    <td>{q.reason_code}</td>
                    <td><Sev v={q.severity} /></td>
                    <td><b>{q.priority_score}</b></td>
                    <td>{q.wait_s}s</td>
                    <td>{q.queue_id}{!q.package_complete && <> <span className="badge b-red">INCOMPLETE</span></>}</td>
                    <td><button className="btn sm primary" onClick={(ev) => { ev.stopPropagation(); accept(q) }}>Terima</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!items.length && <Empty text="Antrean kosong â€” tambah lewat formulir di kanan." />}
          </div>
        </Card>
        <div className="grid">
          <Card title="Tambah ke antrean" sub="Enqueue handoff baru (FR-WS-002).">
            <div className="form">
              <label>Percakapan<input value={f.conversation_id} onChange={setF('conversation_id')} /></label>
              <div className="form2">
                <label>Alasan<select value={f.reason_code} onChange={setF('reason_code')}>{REASONS.map((r) => <option key={r}>{r}</option>)}</select></label>
                <label>Severity<select value={f.severity} onChange={setF('severity')}>{SEVERITIES.map((r) => <option key={r}>{r}</option>)}</select></label>
              </div>
              <div className="form2">
                <label>Queue<input value={f.queue_id} onChange={setF('queue_id')} /></label>
                <label>Skill (koma)<input value={f.skill_tags} onChange={setF('skill_tags')} placeholder="chat,id" /></label>
              </div>
              <label className="check"><input type="checkbox" checked={f.vulnerability_flag} onChange={setF('vulnerability_flag')} /> Nasabah rentan (+bobot prioritas)</label>
              <label className="check"><input type="checkbox" checked={f.package_complete} onChange={setF('package_complete')} /> Paket handoff lengkap</label>
              <div className="row"><button className="btn primary" onClick={enqueue}>Enqueue</button>
                <button className="btn" onClick={quickHandoff} title="Tool handoff mentah (BR-HO-01/06)">Cek paket handoff</button></div>
            </div>
          </Card>
          <Card title="Alihkan (transfer)" sub="Wajib catatan â€” BR-WS-04. Pilih baris antrean dulu.">
            {!sel ? <Empty text="Belum ada handoff dipilih." /> : (
              <div className="form">
                <div className="kv"><dt>Handoff</dt><dd>{sel.handoff_id}</dd><dt>Percakapan</dt><dd>{sel.conversation_id}</dd></div>
                <label>Ke antrean<input value={t.to_queue} onChange={setT('to_queue')} /></label>
                <label>Alasan<input value={t.reason} onChange={setT('reason')} /></label>
                <label>Catatan (wajib)<textarea value={t.note} onChange={setT('note')} rows={2} /></label>
                <div className="row"><button className="btn primary" onClick={transfer}>Transfer</button></div>
              </div>
            )}
          </Card>
          {ho && <Card title="Hasil" sub={ho.ok ? 'Berhasil' : 'Info'}><Json data={ho.data} /></Card>}
        </div>
      </div>
    </>
  )
}

/* ---------- Percakapan ---------- */
function Conv({ role }) {
  const [cid, setCid] = useState('CNV-DEMO-1')
  const [d, setD] = useState(null)
  const [e, setE] = useState(null)
  const [sug, setSug] = useState(null)
  const open = async () => {
    setE(null); setD(null); setSug(null)
    try { setD(await req(`/v1/workspace/conversations/${cid}`, { role })) }
    catch (err) { setE(err) }
  }
  const suggest = async () => {
    setE(null)
    try { setSug(await req('/v1/copilot/suggest', { method: 'POST', role, body: { conversation_id: cid } })) }
    catch (err) { setE(err) }
  }
  return (
    <>
      <Err e={e} onClose={() => setE(null)} />
      <Card title="Buka percakapan" sub="Satu layar: percakapan, klasifikasi, tool, handoff, kasus, tiket, dan SLA (FR-WS-003 / I-11).">
        <div className="row"><input value={cid} onChange={(e) => setCid(e.target.value)} style={{ minWidth: 260 }} />
          <button className="btn primary" onClick={open}>Buka</button>
          <button className="btn" onClick={suggest}>Saran copilot</button></div>
      </Card>
      {sug && <Card title="Saran copilot"><Json data={sug} /></Card>}
      {d && (
        <div className="grid g2 mt">
          <Card title={`Handoff â€¢ ${d.conversation_id}`} sub={d.conversation?.intent_current || 'Status handoff dan tingkat risiko'}>
            {d.handoff ? (
              <div className="kv">
                <dt>Alasan</dt><dd>{d.handoff.reason_code}</dd>
                <dt>Status</dt><dd><StateBadge v={d.handoff.state} /></dd>
                <dt>Skor</dt><dd>{d.handoff.priority_score}</dd>
                <dt>Severity</dt><dd><Sev v={d.handoff.severity} /></dd>
                <dt>Diterima</dt><dd>{d.handoff.accepted_by || '-'}</dd>
              </div>
            ) : <Empty text="Belum ada handoff untuk percakapan ini." />}
          </Card>
          <Card title={`Kasus (${d.cases.length}) â€¢ Tiket (${d.tickets.length})`}>
            <div className="kv">
              {d.cases.map((c) => (<React.Fragment key={c.case_id}><dt>{c.case_id}</dt><dd><StateBadge v={c.status} /> <Sev v={c.severity_confirmed} /></dd></React.Fragment>))}
              {d.tickets.map((t) => (<React.Fragment key={t.ticket_id}><dt>{t.ticket_id}</dt><dd><StateBadge v={t.status} /></dd></React.Fragment>))}
              {!d.cases.length && !d.tickets.length && <dt>-</dt>}
            </div>
            <h3 className="mt">SLA</h3>
            <div className="kv">{d.sla.map((s) => (<React.Fragment key={s.sla_id}><dt>{s.sla_id}</dt><dd><StateBadge v={s.state} /> â€¢ {s.resolution_due_at}</dd></React.Fragment>))}</div>
          </Card>
          <Card title={`Transkrip (${d.messages?.length || 0})`} sub={d.conversation ? `${d.conversation.status} â€¢ ${d.conversation.language}` : 'Data percakapan belum tersedia'} wide>
            {!d.messages?.length ? <Empty text="Belum ada pesan." /> : (
              <ul className="timeline">{d.messages.map((m) => (
                <li key={m.sequence_no}><b>{m.author_type} Â· {m.direction}</b>
                  <div className="t">{m.occurred_at}</div><p>{m.content}</p>
                  {!!m.citations?.length && <small>Sitasi: {m.citations.map((c) => c.title || c.article_id || 'sumber').join(', ')}</small>}
                </li>))}</ul>
            )}
            <div className="grid g2 mt">
              <div><h3>Klasifikasi intent</h3>{d.intents?.length ? <Json data={d.intents} /> : <Empty text="Belum ada klasifikasi." />}</div>
              <div><h3>Eksekusi tool</h3>{d.tool_calls?.length ? <Json data={d.tool_calls} /> : <Empty text="Belum ada pemanggilan tool." />}</div>
            </div>
          </Card>
        </div>
      )}
    </>
  )
}

/* ---------- Kasus & Tiket ---------- */
function Cases({ role }) {
  const [e, setE] = useState(null)
  const [out, setOut] = useState(null)
  const [ct, setCt, resetCt] = useForm({ conversation_id: 'CNV-DEMO-1', type: 'GENERAL', priority: 'NORMAL', description: 'Dana belum masuk ke rekening tujuan' })
  const [cc, setCc, resetCc] = useForm({ conversation_id: 'CNV-DEMO-1', category: 'TRANSACTION_DISPUTE', severity_proposed: 'HIGH', description: 'Tidak mengenal transaksi Rp1.200.000', vulnerability_flag: false })
  const [cx, setCx] = useForm({ case_id: '', reason: '' })
  const [check, setCheck] = useState({ outcome_recorded: true })
  const [ev, setEv] = useForm({ case_id: '', description: 'Transaction detail showing date, amount and merchant', reason: 'Verifikasi sengketa' })

  const run = async (fn) => { setE(null); setOut(null); try { const r = await fn(); setOut(r) } catch (err) { setE(err) } }
  const mkTicket = () => run(() => req('/v1/tickets', { method: 'POST', role, body: { ...ct } }).then((r) => { resetCt(); return r }))
  const mkCase = () => run(() => req('/v1/cases', { method: 'POST', role, body: { ...cc } }).then((r) => { resetCc(); return r }))
  const close = () => run(() => req(`/v1/cases/${cx.case_id}/close`, { method: 'POST', role, body: { checklist: check } }))
  const reopen = () => run(() => req(`/v1/cases/${cx.case_id}/reopen`, { method: 'POST', role, body: { reason: cx.reason || 'Nasabah melapor masalah berlanjut' } }))
  const evReq = () => run(() => req(`/v1/cases/${ev.case_id}/evidence-requests`, { method: 'POST', role, body: { items: [{ description: ev.description }], reason: ev.reason } }))

  return (
    <>
      <Err e={e} onClose={() => setE(null)} />
      {out && <Card title="Hasil operasi"><Json data={out} /></Card>}
      <div className="grid g2 mt">
        <Card title="Buat tiket" sub="Tool B untuk A: create_crm_ticket (I-01).">
          <div className="form">
            <label>Percakapan<input value={ct.conversation_id} onChange={setCt('conversation_id')} /></label>
            <div className="form2">
              <label>Tipe<input value={ct.type} onChange={setCt('type')} /></label>
              <label>Prioritas<select value={ct.priority} onChange={setCt('priority')}>{['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((o) => <option key={o}>{o}</option>)}</select></label>
            </div>
            <label>Deskripsi<textarea value={ct.description} onChange={setCt('description')} rows={2} /></label>
            <div className="row"><button className="btn primary" onClick={mkTicket}>Buat tiket</button></div>
          </div>
        </Card>
        <Card title="Buat kasus" sub="BR-CASE-09: AI usul HIGH/CRITICAL â†’ perlu konfirmasi manusia.">
          <div className="form">
            <label>Percakapan<input value={cc.conversation_id} onChange={setCc('conversation_id')} /></label>
            <div className="form2">
              <label>Kategori<select value={cc.category} onChange={setCc('category')}>{['TRANSACTION_DISPUTE', 'GENERAL', 'COMPLAINT', 'FRAUD', 'ACCOUNT'].map((o) => <option key={o}>{o}</option>)}</select></label>
              <label>Severity usul<select value={cc.severity_proposed} onChange={setCc('severity_proposed')}>{SEVERITIES.map((o) => <option key={o}>{o}</option>)}</select></label>
            </div>
            <label>Deskripsi<textarea value={cc.description} onChange={setCc('description')} rows={2} /></label>
            <label className="check"><input type="checkbox" checked={cc.vulnerability_flag} onChange={setCc('vulnerability_flag')} /> Nasabah rentan</label>
            <div className="row"><button className="btn primary" onClick={mkCase}>Buat kasus</button></div>
          </div>
        </Card>
        <Card title="Tutup / buka kembali" sub="BR-CASE-05: penutupan ditolak bila ada butir kurang (peran supervisor).">
          <div className="form">
            <label>Case ID<input value={cx.case_id} onChange={setCx('case_id')} placeholder="CAS-â€¦" /></label>
            {CLOSURE_ITEMS.map(([k, label]) => (
              <label className="check" key={k}><input type="checkbox" checked={!!check[k]} onChange={(ev) => setCheck({ ...check, [k]: ev.target.checked })} />{label}</label>
            ))}
            <div className="row"><button className="btn primary" onClick={close}>Tutup kasus</button></div>
            <label>Alasan reopen<input value={cx.reason} onChange={setCx('reason')} /></label>
            <div className="row"><button className="btn" onClick={reopen}>Buka kembali</button></div>
          </div>
        </Card>
        <Card title="Minta bukti" sub="BR-EV-01: deskripsi generik (mis. 'bukti') ditolak E_VALIDATION.">
          <div className="form">
            <label>Case ID<input value={ev.case_id} onChange={setEv('case_id')} placeholder="CAS-â€¦" /></label>
            <label>Deskripsi bukti<input value={ev.description} onChange={setEv('description')} /></label>
            <label>Alasan<input value={ev.reason} onChange={setEv('reason')} /></label>
            <div className="row"><button className="btn primary" onClick={evReq}>Kirim permintaan</button></div>
          </div>
        </Card>
      </div>
    </>
  )
}

/* ---------- Persetujuan ---------- */
function Approvals({ role }) {
  const [e, setE] = useState(null)
  const [list, setList] = useState([])
  const [onlyPending, setOnlyPending] = useState(true)
  const [det, setDet] = useState(null)
  const [f, setF, resetF] = useForm({ conversation_id: 'CNV-DEMO-1', tool_name: 'card_status_update', args: '{"card_id":"CARD-1","status":"BLOCKED"}', justification: 'Dugaan fraud, blokir sementara', risk_class: 'WRITE_MEDIUM' })
  const [dec, setDec] = useForm({ decision: 'GRANTED', comment: 'Setuju, argumen sesuai' })

  const load = useCallback(async () => {
    setE(null)
    try { const r = await req(`/v1/approvals${onlyPending ? '?state=pending' : ''}`, { role }); setList(r.items || []) }
    catch (err) { setE(err) }
  }, [role, onlyPending])
  useEffect(() => { load() }, [load])

  const create = async () => {
    setE(null)
    try {
      const args = JSON.parse(f.args)
      const r = await req('/v1/approvals', { method: 'POST', role, body: { conversation_id: f.conversation_id, tool_name: f.tool_name, args, justification: f.justification, risk_class: f.risk_class } })
      setDet(r); resetF(); load()
    } catch (err) { setE(err instanceof SyntaxError ? new ApiError(0, '', 'Args harus JSON valid.') : err) }
  }
  const open = async (aid) => { setE(null); try { setDet(await req(`/v1/approvals/${aid}`, { role })) } catch (err) { setE(err) } }
  const decide = async () => {
    if (!det) return
    setE(null)
    try {
      const r = await req(`/v1/approvals/${det.approval_id}/decide`, { method: 'POST', role, body: dec })
      setDet(r); load()
    } catch (err) { setE(err) }
  }

  return (
    <>
      <Err e={e} onClose={() => setE(null)} />
      <div className="split">
        <Card title={`Daftar (${list.length})`} sub="RBAC-02: peminta tak boleh menyetujui sendiri.">
          <div className="row"><label className="check"><input type="checkbox" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} /> Hanya pending</label>
            <button className="btn sm" onClick={load}>Muat ulang</button></div>
          <div className="mt" style={{ overflowX: 'auto' }}>
            <table className="tbl"><thead><tr><th>ID</th><th>Tool</th><th>Peminta</th><th>Keputusan</th></tr></thead>
              <tbody>{list.map((a) => (
                <tr key={a.approval_id} className="clickable" onClick={() => open(a.approval_id)}>
                  <td style={{ fontSize: 11 }}>{a.approval_id}</td><td>{a.tool_name}</td><td>{a.requested_by}</td>
                  <td>{a.decision ? <StateBadge v={a.decision} /> : <span className="badge b-amber">PENDING</span>}</td>
                </tr>))}
              </tbody></table>
            {!list.length && <Empty text="Tidak ada permintaan." />}
          </div>
        </Card>
        <div className="grid">
          <Card title="Minta persetujuan" sub="Gerbang tool tulis sensitif (FR-ORC-005).">
            <div className="form">
              <label>Percakapan<input value={f.conversation_id} onChange={setF('conversation_id')} /></label>
              <div className="form2">
                <label>Tool<input value={f.tool_name} onChange={setF('tool_name')} /></label>
                <label>Kelas risiko<input value={f.risk_class} onChange={setF('risk_class')} /></label>
              </div>
              <label>Args (JSON)<textarea value={f.args} onChange={setF('args')} rows={3} /></label>
              <label>Justifikasi<input value={f.justification} onChange={setF('justification')} /></label>
              <div className="row"><button className="btn primary" onClick={create}>Ajukan</button></div>
            </div>
          </Card>
          <Card title="Detail & keputusan" sub="Bandingkan hash argumen sebelum menyetujui (BR-ORC-07). Komentar wajib.">
            {!det ? <Empty text="Pilih permintaan di kiri." /> : (
              <div className="form">
                <div className="kv"><dt>ID</dt><dd>{det.approval_id}</dd><dt>Tool</dt><dd>{det.tool_name}</dd>
                  <dt>Peminta</dt><dd>{det.requested_by}</dd><dt>Keputusan</dt><dd>{det.decision ? <StateBadge v={det.decision} /> : 'PENDING'}</dd></div>
                <label>Hash argumen (sha256)<code className="hash">{det.arguments_hash}</code></label>
                <label>Snapshot argumen</label><Json data={det.arguments_snapshot} />
                <div className="form2">
                  <label>Keputusan<select value={dec.decision} onChange={setDec('decision')}><option>GRANTED</option><option>DENIED</option></select></label>
                </div>
                <label>Komentar (wajib)<input value={dec.comment} onChange={setDec('comment')} /></label>
                <div className="row"><button className="btn primary" onClick={decide}>Kirim keputusan</button></div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  )
}

/* ---------- QA ---------- */
function QA({ role }) {
  const [e, setE] = useState(null)
  const [out, setOut] = useState(null)
  const [sum, setSum] = useState(null)
  const [seed, setSeed] = useState(42)
  const [sc, setSc] = useForm({ item_id: '', auto_fail: '' })
  const [scores, setScores] = useState({ identitas: 8, sitasi: 8, klasifikasi: 8, tool: 8, bukti: 8, komunikasi: 8, komitmen: 8, penutupan: 8 })
  const [fo, setFo] = useForm({ review_id: '', type: 'individual_coaching', severity: 'MEDIUM', description: '' })

  const loadSum = useCallback(async () => {
    try { setSum(await req('/v1/analytics/qa', { role })) } catch { /* peran tanpa analytics.read */ }
  }, [role])
  useEffect(() => { loadSum() }, [loadSum])

  const sample = async () => { setE(null); try { const r = await req('/v1/qa/sample', { method: 'POST', role, body: { seed: Number(seed) } }); setOut(r); } catch (err) { setE(err) } }
  const review = async () => {
    setE(null)
    try {
      const s = Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, Number(v)]))
      const r = await req('/v1/qa/reviews', { method: 'POST', role, body: { item_id: sc.item_id, scores: s, ...(sc.auto_fail ? { auto_fail: sc.auto_fail } : {}) } })
      setOut(r); loadSum()
    } catch (err) { setE(err) }
  }
  const finding = async () => { setE(null); try { const r = await req('/v1/qa/findings', { method: 'POST', role, body: { ...fo } }); setOut(r) } catch (err) { setE(err) } }

  return (
    <>
      <p className="alert info">Review hanya dapat dilakukan oleh pengguna yang memiliki izin QA. Akses ditentukan oleh sesi terverifikasi.</p>
      <Err e={e} onClose={() => setE(null)} />
      {sum && (
        <div className="grid g4">
          <Card><div className="stat"><span className="v">{sum.n}</span><span className="l">Review</span></div></Card>
          <Card><div className="stat"><span className="v">{sum.avg_total}</span><span className="l">Rata-rata total</span></div></Card>
          <Card><div className="stat"><span className="v">{Math.round((sum.auto_fail_rate || 0) * 100)}%</span><span className="l">Auto-fail rate</span></div></Card>
          <Card><div className="stat"><span className="v">{sum.by_field ? Object.keys(sum.by_field).length : 0}</span><span className="l">Dimensi nilai</span></div></Card>
        </div>
      )}
      {out && <Card title="Hasil"><Json data={out} /></Card>}
      <div className="grid g3 mt">
        <Card title="Tarik sampel" sub="10% acak + 100% kasus risiko, ber-seed (FR-QA).">
          <div className="form"><label>Seed<input type="number" value={seed} onChange={(e) => setSeed(e.target.value)} /></label>
            <div className="row"><button className="btn primary" onClick={sample}>Tarik sampel</button></div></div>
        </Card>
        <Card title="Nilai (review)" sub="Skor 0â€“10 per dimensi.">
          <div className="form">
            <label>Item ID (case)<input value={sc.item_id} onChange={setSc('item_id')} placeholder="CAS-â€¦" /></label>
            <div className="form2">{QA_FIELDS.map((fld) => (
              <label key={fld}>{fld}<input type="number" min={0} max={10} value={scores[fld]} onChange={(e) => setScores({ ...scores, [fld]: e.target.value })} /></label>))}
            </div>
            <label>Auto-fail<select value={sc.auto_fail} onChange={setSc('auto_fail')}><option value="">â€” tidak ada â€”</option>{QA_AUTO_FAIL.map((o) => <option key={o}>{o}</option>)}</select></label>
            <div className="row"><button className="btn primary" onClick={review}>Simpan review</button></div>
          </div>
        </Card>
        <Card title="Temuan" sub="Dirouting otomatis: coaching / knowledge / root-cause.">
          <div className="form">
            <label>Review ID<input value={fo.review_id} onChange={setFo('review_id')} /></label>
            <div className="form2">
              <label>Tipe<select value={fo.type} onChange={setFo('type')}>{QA_FINDING_TYPES.map((o) => <option key={o}>{o}</option>)}</select></label>
              <label>Severity<select value={fo.severity} onChange={setFo('severity')}>{SEVERITIES.map((o) => <option key={o}>{o}</option>)}</select></label>
            </div>
            <label>Deskripsi<textarea value={fo.description} onChange={setFo('description')} rows={2} /></label>
            <div className="row"><button className="btn primary" onClick={finding}>Catat temuan</button></div>
          </div>
        </Card>
      </div>
    </>
  )
}

/* ---------- Analitik ---------- */
function Analytics({ role }) {
  const [e, setE] = useState(null)
  const [d, setD] = useState(null)
  const load = useCallback(async () => {
    setE(null)
    try {
      const [op, tree, res, ho, qa] = await Promise.all([
        req('/v1/analytics/operational', { role }),
        req('/v1/analytics/driver-tree', { role }),
        req('/v1/analytics/resolution', { role }),
        req('/v1/analytics/handoff', { role }),
        req('/v1/analytics/qa', { role }),
      ])
      setD({ op, tree, res, ho, qa })
    } catch (err) { setE(err) }
  }, [role])
  useEffect(() => { load() }, [load])
  const csv = async (kind) => {
    setE(null)
    try {
      const text = await req(`/v1/analytics/export.csv?kind=${kind}`, { role, download: true })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }))
      a.download = `eaics-${kind}.csv`; a.click(); URL.revokeObjectURL(a.href)
    } catch (err) { setE(err) }
  }
  const treeRows = d ? Object.entries(d.tree).flatMap(([cat, subs]) => Object.entries(subs).map(([sub2, n]) => ({ cat, sub: sub2, n }))) : []
  return (
    <>
      <Err e={e} onClose={() => setE(null)} />
      <div className="row"><button className="btn sm" onClick={load}>Muat ulang</button>
        <button className="btn sm" onClick={() => csv('cases')}>Unduh CSV kasus</button>
        <button className="btn sm" onClick={() => csv('handoffs')}>Unduh CSV handoff</button></div>
      {!d ? <Card><Empty text="Memuat analitikâ€¦" /></Card> : (
        <>
          <div className="grid g4 mt">
            <Card><div className="stat"><span className="v">{d.op.cases_total}</span><span className="l">Kasus â€¢ tiket {d.op.tickets_total}</span></div></Card>
            <Card><div className="stat"><span className="v">{Math.round(d.op.sla_attainment_ratio * 100)}%</span><span className="l">Ketercapaian SLA</span></div></Card>
            <Card><div className="stat"><span className="v">{Math.round(d.res.reopen_rate * 100)}%</span><span className="l">Reopen rate (target {d.res.target_SM13})</span></div></Card>
            <Card><div className="stat"><span className="v">{d.qa.avg_total}</span><span className="l">Rata-rata QA (n={d.qa.n})</span></div></Card>
          </div>
          <Card title="Driver tree 2 tingkat" sub="Kategori â†’ sub-kategori (FR-ANA).">
            <div style={{ overflowX: 'auto' }}><table className="tbl"><thead><tr><th>Kategori</th><th>Sub-kategori</th><th>Jumlah</th></tr></thead>
              <tbody>{treeRows.map((r, i) => <tr key={i}><td>{r.cat}</td><td>{r.sub}</td><td><b>{r.n}</b></td></tr>)}</tbody></table>
              {!treeRows.length && <Empty text="Belum ada data." />}</div>
          </Card>
          <Card title="Handoff per alasan"><Json data={d.ho} /></Card>
        </>
      )}
    </>
  )
}

/* ---------- SLA & Outbox ---------- */
function SLA({ role }) {
  const [e, setE] = useState(null)
  const [out, setOut] = useState(null)
  const [st, setSt] = useState(null)
  const [f, setF] = useForm({ object_type: 'CASE', category: 'TRANSACTION_DISPUTE', severity: 'HIGH', created_at: '2026-03-06T09:30:00+00:00' })
  const [nt, setNt] = useForm({ channel: 'REGISTERED_EMAIL', target: 'nasabah@example.test' })

  const status = useCallback(async () => { try { setSt(await req('/internal/outbox-status', { role })) } catch { /* abaikan */ } }, [role])
  useEffect(() => { status() }, [status])
  const calc = async () => { setE(null); try { setOut(await req('/v1/sla/calculate', { method: 'POST', role, body: f })) } catch (err) { setE(err) } }
  const tick = async () => { setE(null); try { setOut(await req('/internal/sla-tick', { method: 'POST', role })); status() } catch (err) { setE(err) } }
  const drain = async () => { setE(null); try { setOut(await req('/internal/outbox-drain', { method: 'POST', role })); status() } catch (err) { setE(err) } }
  const notify = async () => { setE(null); try { setOut(await req('/v1/notifications', { method: 'POST', role, body: { ...nt } })) } catch (err) { setE(err) } }

  return (
    <>
      <Err e={e} onClose={() => setE(null)} />
      {st && <div className="grid g2"><Card><div className="stat"><span className="v">{st.pending}</span><span className="l">Outbox pending</span></div></Card>
        <Card><div className="stat"><span className="v">{st.sent}</span><span className="l">Outbox terkirim</span></div></Card></div>}
      {out && <Card title="Hasil"><Json data={out} /></Card>}
      <div className="grid g3 mt">
        <Card title="Hitung SLA" sub="Jam kerja Asia/Jakarta; Jumat sore â†’ Senin (US-SLA-01).">
          <div className="form">
            <div className="form2">
              <label>Objek<select value={f.object_type} onChange={setF('object_type')}><option>CASE</option><option>TICKET</option></select></label>
              <label>Severity<select value={f.severity} onChange={setF('severity')}>{SEVERITIES.map((o) => <option key={o}>{o}</option>)}</select></label>
            </div>
            <label>Kategori<input value={f.category} onChange={setF('category')} /></label>
            <label>Dibuat (ISO)<input value={f.created_at} onChange={setF('created_at')} /></label>
            <div className="row"><button className="btn primary" onClick={calc}>Hitung</button></div>
          </div>
        </Card>
        <Card title="SLA tick & outbox" sub="Beat pendeteksi breach + drain CRM (FR-SLA-003/005).">
          <div className="row"><button className="btn primary" onClick={tick}>Jalankan tick</button>
            <button className="btn" onClick={drain}>Drain outbox</button>
            <button className="btn sm" onClick={status}>Status</button></div>
        </Card>
        <Card title="Notifikasi" sub="Hanya kanal REGISTERED_* yang diizinkan.">
          <div className="form">
            <label>Kanal<select value={nt.channel} onChange={setNt('channel')}>{['REGISTERED_EMAIL', 'REGISTERED_SMS', 'REGISTERED_PUSH', 'REGISTERED_WHATSAPP'].map((o) => <option key={o}>{o}</option>)}</select></label>
            <label>Tujuan<input value={nt.target} onChange={setNt('target')} /></label>
            <div className="row"><button className="btn primary" onClick={notify}>Kirim</button></div>
          </div>
        </Card>
      </div>
    </>
  )
}

/* ---------- Audit ---------- */
function Audit({ role }) {
  const [corr, setCorr] = useState('')
  const [trail, setTrail] = useState(null)
  const [e, setE] = useState(null)
  const open = async () => {
    setE(null); setTrail(null)
    try { const r = await req(`/v1/audit/trail/${corr}`, { role }); setTrail(r.trail || []) }
    catch (err) { setE(err) }
  }
  return (
    <>
      <p className="alert info">Butuh peran <b>supervisor</b> (izin audit.read). Setiap respons API menyertakan correlation_id di header.</p>
      <Err e={e} onClose={() => setE(null)} />
      <Card title="Lacak correlation_id" sub="Trail append-only + hash-chain (US-SEC-01).">
        <div className="row"><input value={corr} onChange={(e) => setCorr(e.target.value)} placeholder="COR-â€¦" style={{ minWidth: 300 }} />
          <button className="btn primary" onClick={open}>Lacak</button></div>
      </Card>
      {trail && (
        <Card title={`Jejak (${trail.length} kejadian)`}>
          {!trail.length ? <Empty text="Tidak ada kejadian untuk ID ini." /> : (
            <ul className="timeline">{trail.map((t, i) => (
              <li key={i}><b>{t.action || t.event || JSON.stringify(t).slice(0, 80)}</b>
                <div className="t">{t.timestamp || t.ts || t.created_at || ''} â€¢ {t.actor_id || t.actor || ''} â€¢ {t.service || ''}</div>
              </li>))}</ul>
          )}
          <h3 className="mt">Mentah</h3><Json data={trail} />
        </Card>
      )}
    </>
  )
}
