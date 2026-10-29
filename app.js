import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, GoogleAuthProvider, signInWithCredential, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFirestore, doc, getDoc, getDocs, setDoc, deleteDoc, collection, writeBatch, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseConfig, ADMINS, GOOGLE_CLIENT_ID } from './config.js';

const PRAZO = 7 * 24 * 3600 * 1000;          // confere o acesso a cada 7 dias
const KEY = 'ga_sessao_v1';
const LOGOS = ['logo0.png', 'logo1.png', 'logo2.png'];
let CROPS = [];
let SESSAO = {};
let CROP = null, FASES = [], REF_FATOR = 1;

const fb = initializeApp(firebaseConfig);
const auth = initializeAuth(fb, {persistence: [indexedDBLocalPersistence, browserLocalPersistence]});  // sem o iframe do firebaseapp.com
const db = getFirestore(fb);

// ================= gerador (mesmo código do artefato) =================
const faseIdx = label => { const d = parseInt(label); const i = FASES.findIndex(f => d >= f.d0 && d <= f.d1); return i < 0 ? (d < FASES[0].d0 ? 0 : FASES.length - 1) : i; };
const $ = id => document.getElementById(id);
const nf = (x, d) => Number(x).toLocaleString('pt-BR', {minimumFractionDigits: d, maximumFractionDigits: d});
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const dash = '<span class="dash">–</span>';
const title = s => s.toLowerCase().replace(/(^|\s)\S/g, m => m.toUpperCase());

function read() {
  const v = id => { const t = String($(id).value).trim().replace(/\s/g, ''); return parseFloat(id === 'qtd' ? t.replace(/[.,]/g, '') : t.replace(',', '.')); };
  return {cli: $('cli').value.trim(), qtd: v('qtd'), eg: v('eg'), ep: v('ep'), vz: v('vz'),
          adj: $('adj').checked, ec: FASES.map((_, i) => v('ec' + i)),
          sel: [...document.querySelectorAll('.pgck')].filter(c => c.checked).map(c => +c.value)};
}

function compute(p) {
  const fator = p.ep * p.vz / p.eg;
  const weeks = CROP.weeks.map(w => { const fi = faseIdx(w.label); return {label: w.label, fi, days: w.days.map(d => {
    const load = d.p.reduce((s, [, x, f]) => s + (f ? x * f : 0), 0);
    const ecF = p.ec[fi] > 0 ? p.ec[fi] : FASES[fi].ec;
    let t = d.t != null ? d.t : Math.max(Math.round(load / (ecF * REF_FATOR) * 60), 1);
    if (p.adj && load > 0) {
      // doses fixas: muda só o tempo (água por planta) para a EC ficar na faixa
      const target = p.ec[fi];
      t = Math.max(Math.round(load / (target * fator) * 60), 1);
    }
    if (d.tfix != null) { t = d.tfix;
    }
    const volL = fator * t / 60;
    const prods = d.p.map(([n, x, f]) => ({n, dose: x, f}));
    return {d: d.d, t, vol: volL * 1000, ec: load / volL, prods};
  })}; });
  return {fator, weeks};
}

function header(p, ph) {
  return `<div class="top"><div><h3>Programa de Fertirrigação</h3><div class="crop">${esc(CROP.nome)}</div></div>
    <div class="logos">${LOGOS.map(l => `<img src="${l}" alt="">`).join('')}</div></div>
    <div class="info"><div><b>Produtor</b><span>${esc(title(p.cli))}</span></div><div><b>Plantas</b><span>${nf(p.qtd,0)}</span></div>
    <div><b>Espaç. gotejadores</b><span>${nf(p.eg,2)} m</span></div><div><b>Espaç. plantas</b><span>${nf(p.ep,2)} m</span></div>
    <div><b>Vazão gotejador</b><span>${nf(p.vz,1)} L/h</span></div></div>`;
}
const cell = (v, d) => v ? nf(v, d) : dash;

function pages(p, r) {
  const today = new Date().toLocaleDateString('pt-BR');
  const out = [];
  const nPg = Math.ceil(r.weeks.length / 4);
  for (let i = 0; i < nPg; i++) {
    const ws = r.weeks.slice(i * 4, i * 4 + 4);
    const nd = Math.max(...ws.map(w => w.days.length));
    const slots = [...Array(nd)].map((_, j) => Math.max(...ws.map(w => w.days[j] ? w.days[j].prods.length : 0)));
    const fis = [...new Set(ws.map(w => w.fi))];
    const ph = fis.map(k => FASES[k].n + (p.adj ? ' ' + nf(p.ec[k], 1) : '')).join(' / ');
    let html = header(p, ph);
    if (i === 0) {
      html += `<div class="bio">` + CROP.bio.map(b =>
        `<div><div class="h"><b>${esc(b.label.toUpperCase())}</b><span>g ou mL/planta · total (kg ou L)</span></div>` +
        b.p.map(([n, x]) => `<div class="row"><span>${esc(n)}</span><span class="n">${cell(x,2)}</span><span class="k">${cell(x * p.qtd / 1000,1)}</span></div>`).join('') +
        `</div>`).join('') + `</div>`;
    }
    html += `<div class="cols">` + ws.map(w => `<div class="wk"><div class="wh"><b>${esc(w.label.toUpperCase())}</b><span>g ou mL/planta · total (kg ou L)</span></div>` +
      slots.map((n, j) => {
        const d = w.days[j];
        const h = 18 + 14 + n * 17;
        if (!d) return `<div class="day" style="height:${h}px"></div>`;
        return `<div class="day" style="height:${h}px"><div class="dh"><b>${esc(d.d.toUpperCase())}</b><b style="color:var(--pT)">EC ${nf(d.ec,2)}</b></div>
          <div class="irr">Irrigação: ${nf(d.t,0)} min · ${nf(d.vol,0)} ml/planta</div>` +
          d.prods.map(q => `<div class="row"><span>${esc(q.n)}</span><span class="n">${cell(q.dose,2)}</span><span class="k">${cell(q.dose * p.qtd / 1000,1)}</span></div>`).join('') + `</div>`;
      }).join('') + `</div>`).join('') + `</div>`;
    out.push({i, html});
  }
  const chosen = out.filter(o => p.sel.includes(o.i));
  return chosen.map((o, k) => o.html + `<div class="foot"><span>Programa de fertirrigação · ${esc(CROP.nome)} · ${esc(title(p.cli))}</span><span>Página ${k+1} de ${chosen.length}</span><span>Emitido em ${today} · ${esc(SESSAO.nome || SESSAO.email)}</span></div>`);
}

let last = null;
function update() {
  const p = read();
  const filled = p.cli && [p.qtd, p.eg, p.ep, p.vz].every(x => isFinite(x) && x > 0);
  const ecOk = !p.adj || p.ec.every(x => isFinite(x) && x > 0 && x <= 5);
  const selOk = p.sel.length > 0;
  if (!filled || !ecOk || !selOk) {
    last = null; $('go').disabled = true; if ($('sh')) $('sh').disabled = true;
    $('sF').textContent = '–'; $('sE').textContent = '–';
    if (!ecOk) { $('msg').textContent = 'Confira a EC de cada fase (ex.: 1,4).'; $('msg').className = 'msg err'; }
    else if (filled && !selOk) { $('msg').textContent = 'Marque pelo menos uma folha para o cliente.'; $('msg').className = 'msg err'; }
    else { $('msg').textContent = 'Preencha os dados do produtor para gerar o PDF.'; $('msg').className = 'msg'; }
    $('pgc').textContent = '';
    $('pv').innerHTML = `<div class="empty"><b>A prévia aparece aqui</b><span>Preencha produtor, plantas, espaçamentos e vazão. As páginas do programa são montadas na hora, com doses, EC e totais em kg.</span></div>`;
    return;
  }
  $('go').disabled = false; if ($('sh')) $('sh').disabled = false; if ($('msg').className.includes('err') || $('msg').textContent.startsWith('Preencha')) { $('msg').textContent = ''; $('msg').className = 'msg'; }
  const r = compute(p);
  const ecs = r.weeks.flatMap(w => w.days.map(d => d.ec)).filter(x => isFinite(x) && x > 0);
  $('sF').textContent = nf(r.fator, 2);
  $('sE').textContent = nf(Math.min(...ecs), 2) + ' a ' + nf(Math.max(...ecs), 2);
  const hs = pages(p, r);
  last = {p, hs};
  $('pgc').textContent = `${hs.length} ${hs.length > 1 ? 'páginas' : 'página'} · A4 deitado`;
  $('pv').innerHTML = hs.map(h => `<div class="sheet"><div class="inner"><div class="pg">${h}</div></div></div>`).join('');
  fit();
}
function fit() {
  document.querySelectorAll('.sheet').forEach(s => {
    const sc = s.clientWidth / 1123;
    s.firstElementChild.style.transform = `scale(${sc})`;
    s.style.height = (794 * sc) + 'px';
  });
}
function buildCrop() {
  CROP = CROPS.find(c => c.id === $('crop').value) || CROPS[0];
  FASES = CROP.fases.map(([n, d0, d1, ec]) => ({n, d0, d1, ec}));
  REF_FATOR = CROP.ref[0] * CROP.ref[1] / CROP.ref[2];
  const bioEnd = parseInt(CROP.bio[CROP.bio.length - 1].label);
  $('phs').innerHTML = FASES.map((f, i) => `<label class="nm" for="ec${i}">${f.n}<small>${f.d0} a ${f.d1} dias${f.d1 <= bioEnd + 7 && i === 0 ? ' · só bioestimulantes' : ''}</small></label><input type="text" id="ec${i}" inputmode="decimal" value="${nf(f.ec, 1)}" aria-label="EC ${f.n} em mS/cm"${$('adj').checked ? '' : ' disabled'}>`).join('');
  FASES.forEach((_, i) => $('ec' + i).addEventListener('input', update));
  const nPg = Math.ceil(CROP.weeks.length / 4);
  const lab = i => { const ws = CROP.weeks.slice(i * 4, i * 4 + 4); const fis = [...new Set(ws.map(w => faseIdx(w.label)))];
    return `Folha ${i + 1} · ${parseInt(ws[0].label)} a ${parseInt(ws[ws.length - 1].label)} dias · ${fis.map(k => FASES[k].n).join(' / ')}${i === 0 ? ' + bioestimulantes' : ''}`; };
  $('pgs').innerHTML = `<label class="chk all" for="pgall"><input type="checkbox" id="pgall" checked><span>Todas as folhas</span></label>` +
    [...Array(nPg)].map((_, i) => `<label class="chk" for="pg${i}"><input type="checkbox" class="pgck" id="pg${i}" value="${i}" checked><span>${lab(i)}</span></label>`).join('');
  $('pgall').addEventListener('change', e => { document.querySelectorAll('.pgck').forEach(c => c.checked = e.target.checked); update(); });
  document.querySelectorAll('.pgck').forEach(c => c.addEventListener('change', () => { const cs = [...document.querySelectorAll('.pgck')]; $('pgall').checked = cs.every(x => x.checked); $('pgall').indeterminate = !$('pgall').checked && cs.some(x => x.checked); update(); }));
}

// ================= sessão e acesso =================
const lerCache = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } };
const salvarCache = c => { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) {} };
async function apagarTudo(cacheTambem) {
  try { localStorage.removeItem(KEY); } catch (e) {}
  CROPS = []; SESSAO = {};
  $('pv').innerHTML = ''; $('crop').innerHTML = '';
  if (cacheTambem && 'caches' in window) { for (const k of await caches.keys()) if (k.startsWith('ga-')) await caches.delete(k); }
}
const comPrazo = (p, ms) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(Object.assign(new Error('timeout'), {code: 'unavailable'})), ms))]);
const dataBR = t => new Date(t).toLocaleDateString('pt-BR');

function gate(msg, {login = false, trocar = false} = {}) {
  $('main').hidden = true; $('gate').hidden = false;
  $('gmsg').textContent = msg; $('gbtn').hidden = !login; if (login) botaoGoogle(); $('logout2').hidden = !trocar;
}

async function sincronizar(user) {
  const email = user.email.toLowerCase();
  const admin = ADMINS.map(e => e.toLowerCase()).includes(email);
  let nome = user.displayName || email, ids = null;
  if (!admin) {
    const a = await comPrazo(getDoc(doc(db, 'acessos', email)), 10000);
    if (!a.exists() || a.data().ativo !== true) return {revogado: true};
    nome = a.data().nome || nome; ids = a.data().culturas || [];
  }
  let crops = [];
  if (admin) {
    const qs = await comPrazo(getDocs(collection(db, 'culturas')), 10000);
    qs.forEach(d => crops.push({...JSON.parse(d.data().dados), ordem: d.data().ordem ?? 99}));
  } else {
    for (const id of ids) {
      const d = await comPrazo(getDoc(doc(db, 'culturas', id)), 10000);
      if (d.exists()) crops.push({...JSON.parse(d.data().dados), ordem: d.data().ordem ?? 99});
    }
  }
  crops.sort((a, b) => a.ordem - b.ordem);
  const c = {email, nome, admin, crops, ok: Date.now()};
  salvarCache(c);
  return c;
}

function iniciar(c) {
  SESSAO = c; CROPS = c.crops;
  $('gate').hidden = true; $('main').hidden = false;
  $('who').textContent = c.nome + (c.nome !== c.email ? ' · ' + c.email : '');
  $('tabGer').hidden = $('tabAdm').hidden = !c.admin;
  $('valid').textContent = `Acesso confirmado em ${dataBR(c.ok)}. Funciona sem internet até ${dataBR(c.ok + PRAZO)}; conecte antes disso para renovar e receber as atualizações.`;
  if (!CROPS.length) {
    $('crop').innerHTML = ''; $('ger').hidden = !c.admin ? false : $('ger').hidden;
    $('pv').innerHTML = `<div class="empty"><b>Nenhuma cultura liberada</b><span>${c.admin ? 'Envie o arquivo de culturas no Painel.' : 'Fale com o responsável para liberar as culturas.'}</span></div>`;
    $('go').disabled = true;
    return;
  }
  const atual = $('crop').value;
  $('crop').innerHTML = CROPS.map(x => `<option value="${x.id}">${esc(x.nome)}</option>`).join('');
  if (CROPS.some(x => x.id === atual)) $('crop').value = atual;
  buildCrop(); update();
}

async function verificar(user, silencioso) {
  const c = lerCache();
  const email = user.email.toLowerCase();
  if (navigator.onLine) {
    let r = null;
    try { r = await sincronizar(user); }
    catch (e) { if (e && e.code === 'permission-denied') r = {revogado: true}; /* senão: sem conexão de verdade, cai no modo offline */ }
    if (r && r.revogado) { await apagarTudo(true); gate('Seu acesso não está liberado. Fale com o responsável pelo programa.', {trocar: true}); return; }
    if (r) { iniciar(r); return; }
  }
  if (c && c.email === email && Date.now() - c.ok < PRAZO) { if (!silencioso || SESSAO.email !== email) iniciar(c); return; }
  await apagarTudo(false);
  gate('Faz mais de 7 dias que o acesso não é confirmado. Conecte o celular à internet e abra o app de novo.', {trocar: true});
}

onAuthStateChanged(auth, async user => {
  if (!user) { await apagarTudo(false); gate('Entre com a sua conta Google para usar o gerador.', {login: true}); return; }
  gate('Conferindo o seu acesso…');
  await verificar(user);
});
// Login com o botão do Google (Google Identity Services): não depende do firebaseapp.com
let gisPronto = null;
function carregarGIS() {
  if (gisPronto) return gisPronto;
  gisPronto = new Promise((ok, erro) => { const sc = document.createElement('script'); sc.src = 'https://accounts.google.com/gsi/client'; sc.async = true;
    sc.onload = () => ok(); sc.onerror = () => { gisPronto = null; erro(new Error('gis')); }; document.head.appendChild(sc); });
  return gisPronto;
}
async function botaoGoogle() {
  if (!navigator.onLine) { $('gmsg').textContent = 'Para entrar a primeira vez é preciso internet.'; return; }
  try { await carregarGIS(); } catch (e) { $('gmsg').textContent = 'Não foi possível carregar o login do Google. Confira a internet e abra de novo.'; return; }
  google.accounts.id.initialize({client_id: GOOGLE_CLIENT_ID, auto_select: false, cancel_on_tap_outside: true,
    callback: async resp => {
      $('gmsg').textContent = 'Entrando…';
      try { await signInWithCredential(auth, GoogleAuthProvider.credential(resp.credential)); }
      catch (e) { $('gmsg').textContent = 'Não foi possível entrar (' + (e.code || e.message) + '). Tente de novo.'; }
    }});
  $('gbtn').innerHTML = '';
  google.accounts.id.renderButton($('gbtn'), {theme: 'filled_blue', size: 'large', text: 'signin_with', shape: 'pill', locale: 'pt-BR', width: 260});
}
const sair = async () => { await apagarTudo(false); try { window.google?.accounts?.id?.disableAutoSelect(); } catch (e) {} await signOut(auth); };
$('logout').addEventListener('click', sair);
$('logout2').addEventListener('click', sair);

// reconfere quando volta a internet ou o app volta para a tela (no máximo a cada 6 h)
const reconferir = () => { const u = auth.currentUser, c = lerCache(); if (u && navigator.onLine && (!c || Date.now() - c.ok > 6 * 3600 * 1000)) verificar(u, true); };
window.addEventListener('online', reconferir);
document.addEventListener('visibilitychange', () => { if (!document.hidden) reconferir(); });
setInterval(() => { const c = lerCache(); if (SESSAO.email && (!c || Date.now() - c.ok >= PRAZO)) { const u = auth.currentUser; if (u) verificar(u, true); } }, 60 * 1000);

// ================= tela do gerador =================
$('crop').addEventListener('change', () => { buildCrop(); update(); });
window.addEventListener('resize', fit);
['cli','qtd','eg','ep','vz'].forEach(id => $(id).addEventListener('input', update));
$('adj').addEventListener('change', () => { FASES.forEach((_, i) => $('ec' + i).disabled = !$('adj').checked); update(); });
document.fonts && document.fonts.ready.then(fit);

async function montarPDF() {
  const box = $('render');
  const {jsPDF} = window.jspdf;
  const pdf = new jsPDF({orientation: 'landscape', unit: 'mm', format: 'a4'});
  for (let i = 0; i < last.hs.length; i++) {
    box.innerHTML = `<div class="pg">${last.hs[i]}</div>`;
    const canvas = await html2canvas(box.firstElementChild, {scale: 2.2, backgroundColor: '#ffffff', useCORS: true, logging: false});
    if (i) pdf.addPage();
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 297, 210);
    $('msg').textContent = `Montando o PDF… página ${i + 1} de ${last.hs.length}`;
  }
  box.innerHTML = '';
  const name = 'Adubacao_' + (CROP.nome.split(' ')[0] + '_' + title(last.p.cli)).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') + '.pdf';
  return {pdf, name};
}
$('f').addEventListener('submit', async e => {
  e.preventDefault(); if (!last) return;
  const btn = $('go'); btn.disabled = true; $('msg').className = 'msg'; $('msg').textContent = 'Montando o PDF…';
  try { const {pdf, name} = await montarPDF(); pdf.save(name); $('msg').textContent = 'PDF salvo: ' + name; }
  catch (err) { $('render').innerHTML = ''; $('msg').className = 'msg err'; $('msg').textContent = 'Não foi possível gerar o PDF. Tente de novo.'; }
  finally { btn.disabled = false; }
});
if (navigator.canShare && navigator.canShare({files: [new File(['x'], 'x.pdf', {type: 'application/pdf'})]})) {
  $('sh').hidden = false;
  $('sh').addEventListener('click', async () => {
    if (!last) return; const btn = $('sh'); btn.disabled = true; $('msg').className = 'msg'; $('msg').textContent = 'Montando o PDF…';
    try { const {pdf, name} = await montarPDF(); const file = new File([pdf.output('blob')], name, {type: 'application/pdf'});
      await navigator.share({files: [file], title: name}); $('msg').textContent = 'PDF compartilhado: ' + name; }
    catch (err) { $('render').innerHTML = ''; if (err && err.name === 'AbortError') $('msg').textContent = 'Compartilhamento cancelado.'; else { $('msg').className = 'msg err'; $('msg').textContent = 'Não foi possível compartilhar. Use Baixar PDF.'; } }
    finally { btn.disabled = false; }
  });
}

// ================= painel do administrador =================
function aba(adm) { $('ger').hidden = adm; $('adm').hidden = !adm; $('tabGer').classList.toggle('on', !adm); $('tabAdm').classList.toggle('on', adm); if (adm) carregarPainel(); else fit(); }
$('tabGer').addEventListener('click', () => aba(false));
$('tabAdm').addEventListener('click', () => aba(true));
let CULTS = [];
async function carregarPainel() {
  if (!navigator.onLine) { $('aMsg').textContent = 'O painel precisa de internet.'; return; }
  try {
    const qs = await getDocs(collection(db, 'culturas'));
    CULTS = []; qs.forEach(d => CULTS.push({id: d.id, nome: d.data().nome, ordem: d.data().ordem ?? 99}));
    CULTS.sort((a, b) => a.ordem - b.ordem);
    $('cLista').innerHTML = CULTS.length ? CULTS.map(c => `<span class="chip">${esc(c.nome)}</span>`).join('') : '<span class="msg">Nenhuma cultura enviada ainda.</span>';
    const marc = new Set([...document.querySelectorAll('.aCk:checked')].map(x => x.value));
    $('aCult').innerHTML = CULTS.map(c => `<label><input type="checkbox" class="aCk" value="${c.id}"${marc.has(c.id) ? ' checked' : ''}>${esc(c.nome)}</label>`).join('');
    const us = await getDocs(collection(db, 'acessos'));
    const rows = []; us.forEach(d => rows.push({email: d.id, ...d.data()}));
    rows.sort((a, b) => (a.nome || a.email).localeCompare(b.nome || b.email));
    const nomeC = id => (CULTS.find(c => c.id === id) || {nome: id}).nome;
    $('aLista').innerHTML = rows.length ? rows.map(r => `<tr class="${r.ativo ? '' : 'off'}"><td>${esc(r.nome || '')}</td><td>${esc(r.email)}</td><td>${(r.culturas || []).map(id => `<span class="chip">${esc(nomeC(id))}</span>`).join('') || '–'}</td><td>${r.ativo ? 'Ativo' : 'Bloqueado'}</td>
      <td style="white-space:nowrap"><button data-ed="${esc(r.email)}">Editar</button> <button data-tg="${esc(r.email)}">${r.ativo ? 'Bloquear' : 'Ativar'}</button> <button class="danger" data-rm="${esc(r.email)}">Remover</button></td></tr>`).join('')
      : '<tr><td colspan="5" class="msg">Ninguém liberado ainda.</td></tr>';
    $('aLista').querySelectorAll('[data-ed]').forEach(b => b.onclick = () => { const r = rows.find(x => x.email === b.dataset.ed);
      $('aEmail').value = r.email; $('aNome').value = r.nome || ''; $('aAtivo').checked = !!r.ativo;
      document.querySelectorAll('.aCk').forEach(x => x.checked = (r.culturas || []).includes(x.value)); window.scrollTo({top: 0, behavior: 'smooth'}); });
    $('aLista').querySelectorAll('[data-tg]').forEach(b => b.onclick = async () => { const r = rows.find(x => x.email === b.dataset.tg);
      await setDoc(doc(db, 'acessos', r.email), {...r, email: undefined, ativo: !r.ativo, atualizado: serverTimestamp()}, {merge: true}).catch(() => {}); carregarPainel(); });
    $('aLista').querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => { if (!confirmar(b)) return; await deleteDoc(doc(db, 'acessos', b.dataset.rm)); carregarPainel(); });
  } catch (e) { $('aMsg').textContent = 'Não foi possível carregar o painel (' + (e.code || e.message) + ').'; }
}
// confirmação em dois toques, sem janela do navegador
function confirmar(b) { if (b.dataset.ok) return true; b.dataset.ok = '1'; const t = b.textContent; b.textContent = 'Tocar de novo para remover'; setTimeout(() => { delete b.dataset.ok; b.textContent = t; }, 4000); return false; }
$('aSalvar').addEventListener('click', async () => {
  const email = $('aEmail').value.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { $('aMsg').textContent = 'Digite um e-mail válido.'; return; }
  const culturas = [...document.querySelectorAll('.aCk:checked')].map(x => x.value);
  try { await setDoc(doc(db, 'acessos', email), {nome: $('aNome').value.trim(), ativo: $('aAtivo').checked, culturas, atualizado: serverTimestamp()});
    $('aMsg').textContent = 'Acesso salvo para ' + email + '.'; $('aEmail').value = ''; $('aNome').value = ''; $('aAtivo').checked = true; document.querySelectorAll('.aCk').forEach(x => x.checked = false); carregarPainel(); }
  catch (e) { $('aMsg').textContent = 'Não foi possível salvar (' + (e.code || e.message) + ').'; }
});
$('cArq').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const lista = JSON.parse(await f.text());
    if (!Array.isArray(lista) || !lista.every(c => c.id && c.nome && c.weeks && c.fases)) throw new Error('arquivo inválido');
    const b = writeBatch(db);
    lista.forEach((c, i) => b.set(doc(db, 'culturas', c.id), {nome: c.nome, ordem: i, dados: JSON.stringify(c), atualizado: serverTimestamp()}));
    await b.commit();
    $('cMsg').textContent = `${lista.length} culturas enviadas: ${lista.map(c => c.nome).join(', ')}.`;
    e.target.value = ''; carregarPainel(); verificar(auth.currentUser, true);
  } catch (err) { $('cMsg').textContent = 'Não foi possível enviar (' + (err.code || err.message) + ').'; }
});

// ================= app offline =================
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
