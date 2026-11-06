import {
  db,
  authReady,
  collection,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
} from "./firebase-init.js";

// ============================================================================
// CONFIG
// ============================================================================

// Pontos por colocação (índice 0 = 1º lugar). Do 6º em diante, 0 ponto.
const POINTS_TABLE = [20, 14, 10, 7, 4, 0, 0, 0];
function pointsForPosition(pos) {
  return pos >= 1 && pos <= POINTS_TABLE.length ? POINTS_TABLE[pos - 1] : 0;
}

// Senha simples só para evitar edições acidentais na premiação.
// Isso NÃO é segurança de verdade (veja o README) — troque se quiser.
const ORG_PIN = "poker2026";

// Senha do admin pra lançar/editar/excluir etapa e marcar convidado.
// Também NÃO é segurança de verdade — é client-side, só trava a interface
// pra gente comum não usar por engano. Troque aqui se quiser outra.
const ADMIN_PIN = "1504";

// Quantas posições já vêm abertas no formulário de lançamento.
const SLOTS_INICIAIS = 9;

// Quanto cada buy-in (buy-in ou rebuy) soma na premiação, automaticamente.
const VALOR_POR_BUYIN = 5;

// Uma data confirmada em que o grupo jogou (quinta-feira), usada como referência
// pro cálculo de "quinta sim, quinta não". Ajuste aqui se o calendário mudar.
const ETAPA_REFERENCIA = new Date(2026, 8, 10); // 10/09/2026
ETAPA_REFERENCIA.setHours(0, 0, 0, 0);
const CICLO_DIAS = 14; // joga a cada 2 semanas

// Valor de buy-in usado só pra estimar o "valor ganho" no perfil do jogador
// (independe do VALOR_POR_BUYIN da premiação geral, que é outra conta).
const VALOR_BUYIN_PREMIACAO_DIARIA = 15;

// Ano da temporada mostrado no site. Calculado sozinho a partir da data de
// hoje, então não precisa trocar nada na virada do ano.
const TEMPORADA_ANO = new Date().getFullYear();

// ============================================================================
// ESTADO EM MEMÓRIA
// ============================================================================

let etapasMap = new Map(); // dateId -> { date, results:[{name,position}], buyins, updatedAt }
let convidadosSet = new Set(); // nomes marcados como convidado: aparecem no histórico, mas somem do ranking
let colocacaoAtual = [];   // array de nomes por posição (índice 0 = 1º lugar); "" = posição vazia
let etapaEmEdicao = null;  // dateId sendo editado, ou null se é etapa nova
let etapaVisualizando = null; // dateId aberto no modal de visualização
let nomesConfirmadosNaSessao = new Set(); // nomes novos que o usuário já confirmou nesta sessão (não pergunta de novo)
let autocompleteInputAtivo = null; // input de nome que está mostrando sugestões no momento
let adminDesbloqueado = false; // true depois que a senha do admin foi digitada certa nesta visita

// ============================================================================
// HELPERS DE DOM
// ============================================================================

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function formatDateBR(dateId) {
  const [y, m, d] = dateId.split("-");
  return `${d}/${m}/${y}`;
}

function formatMoneyBRL(valor) {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function showToast(msg) {
  const toast = $("#toast");
  toast.textContent = msg;
  toast.classList.remove("hidden");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.add("hidden"), 2800);
}

// Pede a senha do admin (só uma vez por visita — depois de acertar, libera
// lançar/editar/excluir etapa e marcar convidado até a página ser recarregada).
function verificarAdmin() {
  if (adminDesbloqueado) return true;
  const pin = prompt("Senha do admin pra lançar/editar resultado:");
  if (pin === null) return false;
  if (pin !== ADMIN_PIN) {
    showToast("Senha incorreta.");
    return false;
  }
  adminDesbloqueado = true;
  return true;
}

function relativeTime(ts) {
  if (!ts) return "sem registros";
  const diffMs = Date.now() - ts.toDate().getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "agora mesmo";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return `há ${d}d`;
}

// ============================================================================
// TABELA DE PONTUAÇÃO (painel lateral)
// ============================================================================

function renderPointsTable() {
  const ul = $("#points-table");
  ul.innerHTML = "";
  POINTS_TABLE.forEach((pts, i) => {
    const li = document.createElement("li");
    if (pts === 0) li.classList.add("zero");
    li.innerHTML = `<span>${i + 1}º Lugar</span><strong>${pts} pts</strong>`;
    ul.appendChild(li);
  });
}

// ============================================================================
// CLASSIFICAÇÃO GERAL
// ============================================================================

function computeStandings(ignorarData = null) {
  const totals = new Map(); // name -> { points, etapas }
  for (const [data, etapa] of etapasMap.entries()) {
    if (data === ignorarData) continue;
    const jaContou = new Set();
    for (const r of etapa.results) {
      if (convidadosSet.has(r.name)) continue; // convidados aparecem no histórico, não no ranking
      const nome = r.name;
      const atual = totals.get(nome) || { points: 0, etapas: 0 };
      atual.points += pointsForPosition(r.position);
      if (!jaContou.has(nome)) {
        atual.etapas += 1;
        jaContou.add(nome);
      }
      totals.set(nome, atual);
    }
  }
  return Array.from(totals.entries())
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name, "pt-BR"));
}

// Jogador que mais pontuou nas últimas N etapas (N=3, ou menos se a temporada for curta).
function computeEmAlta() {
  const datas = Array.from(etapasMap.keys()).sort().slice(-3);
  if (datas.length === 0) return null;
  const pontosRecentes = new Map();
  for (const data of datas) {
    for (const r of etapasMap.get(data).results) {
      if (convidadosSet.has(r.name)) continue;
      pontosRecentes.set(r.name, (pontosRecentes.get(r.name) || 0) + pointsForPosition(r.position));
    }
  }
  let melhor = null;
  for (const [name, pts] of pontosRecentes) {
    if (pts > 0 && (!melhor || pts > melhor.pts)) melhor = { name, pts };
  }
  return melhor ? { ...melhor, qtdEtapas: datas.length } : null;
}

function renderRanking() {
  const body = $("#ranking-body");
  const standings = computeStandings();
  const totalEtapas = etapasMap.size;

  if (standings.length === 0) {
    body.innerHTML = `<tr><td colspan="4" class="empty-hint">Nenhum resultado lançado ainda. Clique em "Lançar resultado" para começar!</td></tr>`;
    return;
  }

  // Posição de cada jogador antes da última etapa lançada, pra saber quem subiu/desceu.
  const datas = Array.from(etapasMap.keys()).sort();
  const ultimaData = datas[datas.length - 1];
  const standingsAnteriores = computeStandings(ultimaData);
  const posAnterior = new Map(standingsAnteriores.map((j, i) => [j.name, i + 1]));

  const emAlta = computeEmAlta();

  body.innerHTML = "";
  standings.forEach((jogador, i) => {
    const pos = i + 1;
    const tr = document.createElement("tr");
    tr.classList.add("jogador-row");
    if (pos <= 3) tr.classList.add(`rank-${pos}`);
    const inicial = jogador.name.trim().charAt(0).toUpperCase();

    const posAntes = posAnterior.get(jogador.name);
    let seta = "";
    if (posAntes !== undefined) {
      if (pos < posAntes) seta = `<span class="seta-mov subiu" title="Subiu ${posAntes - pos} posição(ões) na última etapa">▲</span>`;
      else if (pos > posAntes) seta = `<span class="seta-mov desceu" title="Desceu ${pos - posAntes} posição(ões) na última etapa">▼</span>`;
    }

    const emAltaHtml = emAlta && emAlta.name === jogador.name
      ? `<span class="em-alta" title="Em alta — ${emAlta.pts} pts nas últimas ${emAlta.qtdEtapas} etapa${emAlta.qtdEtapas === 1 ? "" : "s"}">🔥</span>`
      : "";

    tr.innerHTML = `
      <td><span class="pos-cell"><span class="pos-badge">${pos}°</span>${seta}</span></td>
      <td>
        <div class="jogador-cell">
          ${pos <= 3 ? `<span class="avatar">${inicial}</span>` : ""}
          <span>${jogador.name}</span>
          ${emAltaHtml}
        </div>
      </td>
      <td class="col-num">${jogador.points}</td>
      <td class="col-num">${jogador.etapas}/${totalEtapas}</td>
    `;
    tr.addEventListener("click", () => abrirPerfilJogador(jogador.name));
    body.appendChild(tr);
  });
}

// ============================================================================
// SIDEBAR: LISTA DE ETAPAS
// ============================================================================

function renderEtapasList() {
  const container = $("#lista-etapas");
  // Mais recente primeiro, com a última etapa já aberta/visível.
  const etapas = Array.from(etapasMap.values()).sort((a, b) => b.date.localeCompare(a.date));

  if (etapas.length === 0) {
    container.innerHTML = `<p class="empty-hint">Nenhuma etapa lançada ainda.</p>`;
    return;
  }

  container.innerHTML = "";
  etapas.forEach((etapa, i) => {
    const item = document.createElement("div");
    const ehAtual = i === 0;
    item.className = "etapa-item" + (ehAtual ? " etapa-item-atual" : "");

    if (ehAtual) {
      const ordenado = [...etapa.results].sort((a, b) => a.position - b.position);
      item.innerHTML = `
        <div class="etapa-item-head">
          <div>
            <span class="etapa-tag-atual">Última etapa</span>
            <div class="data">${formatDateBR(etapa.date)}</div>
          </div>
          <span class="qtd">${etapa.results.length} jogador${etapa.results.length === 1 ? "" : "es"}</span>
        </div>
        <ol class="etapa-item-preview">
          ${ordenado.map((r) => `<li><span>${r.position}º ${r.name}${convidadosSet.has(r.name) ? " 🎟️" : ""}</span><strong>${pointsForPosition(r.position)} pts</strong></li>`).join("")}
        </ol>
      `;
    } else {
      item.innerHTML = `
        <div>
          <div class="data">${formatDateBR(etapa.date)}</div>
          <div class="qtd">${etapa.results.length} jogador${etapa.results.length === 1 ? "" : "es"}</div>
        </div>
        <span>›</span>
      `;
    }
    item.addEventListener("click", () => abrirVisualizacaoEtapa(etapa.date));
    container.appendChild(item);
  });
}

// ============================================================================
// BADGE "ATUALIZADO"
// ============================================================================

function ultimaAtualizacao() {
  let maisRecente = null;
  for (const etapa of etapasMap.values()) {
    if (etapa.updatedAt && (!maisRecente || etapa.updatedAt.toMillis() > maisRecente.toMillis())) {
      maisRecente = etapa.updatedAt;
    }
  }
  return maisRecente;
}

function renderBadge() {
  $("#badge-atualizado").textContent = "atualizado " + relativeTime(ultimaAtualizacao());
}
setInterval(renderBadge, 30000);

// ============================================================================
// PRÓXIMA ETAPA (quinta sim, quinta não)
// ============================================================================

function calcularProximaEtapa() {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const diffDias = Math.round((hoje - ETAPA_REFERENCIA) / 86400000);
  const ciclos = Math.ceil(diffDias / CICLO_DIAS);
  const proxima = new Date(ETAPA_REFERENCIA);
  proxima.setDate(ETAPA_REFERENCIA.getDate() + ciclos * CICLO_DIAS);
  return proxima;
}

function renderProximaEtapa() {
  const el = $("#proxima-etapa");
  if (!el) return;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const proxima = calcularProximaEtapa();
  const diffDias = Math.round((proxima - hoje) / 86400000);
  const dd = String(proxima.getDate()).padStart(2, "0");
  const mm = String(proxima.getMonth() + 1).padStart(2, "0");
  let quando;
  if (diffDias === 0) quando = "hoje";
  else if (diffDias === 1) quando = "amanhã";
  else quando = `em ${diffDias} dias`;
  el.textContent = `🗓️ Próxima etapa: ${quando} (${dd}/${mm})`;
}

// ============================================================================
// NOMES CONHECIDOS (autocomplete + detecção de jogador novo)
// ============================================================================

function coletarNomesConhecidos() {
  const nomes = new Set();
  for (const etapa of etapasMap.values()) {
    for (const r of etapa.results) nomes.add(r.name);
  }
  return nomes;
}

// ============================================================================
// CABEÇALHO / SUBTÍTULO
// ============================================================================

function renderSubtitle() {
  const el = $("#main-subtitle");
  if (!el) return;
  const total = etapasMap.size;
  if (total === 0) {
    el.textContent = `Temporada ${TEMPORADA_ANO} • nenhuma etapa lançada ainda`;
    return;
  }
  const ultimaData = Array.from(etapasMap.keys()).sort().pop();
  const [, mm, dd] = ultimaData.split("-");
  el.textContent = `Temporada ${TEMPORADA_ANO} • ${total} etapa${total === 1 ? "" : "s"} • Última atualização ${dd}/${mm}`;
}

// ============================================================================
// RENDER GERAL (chamado a cada snapshot do Firestore)
// ============================================================================

function renderTudo() {
  renderRanking();
  renderEtapasList();
  renderBadge();
  renderSubtitle();
  renderPremioSub();
}

// ============================================================================
// CONVIDADOS (aparecem no histórico da etapa, mas somem do ranking)
// ============================================================================

// Adiciona ou remove um nome da lista de convidados guardada no Firestore.
async function toggleConvidado(nome) {
  const ehConvidado = convidadosSet.has(nome);
  const novaLista = ehConvidado
    ? Array.from(convidadosSet).filter((n) => n !== nome)
    : [...Array.from(convidadosSet), nome];
  try {
    await authReady;
    await setDoc(doc(db, "config", "convidados"), { nomes: novaLista });
    showToast(ehConvidado ? `${nome} volta a contar no ranking normalmente.` : `${nome} marcado como convidado — some da Classificação Geral.`);
  } catch (err) {
    console.error(err);
    showToast("Não deu para atualizar. Tente de novo.");
  }
}

// ============================================================================
// MODAL: VISUALIZAR ETAPA
// ============================================================================

function abrirVisualizacaoEtapa(dateId) {
  const etapa = etapasMap.get(dateId);
  if (!etapa) return;
  etapaVisualizando = dateId;

  $("#modal-etapa-data").textContent = formatDateBR(dateId);
  const lista = $("#modal-etapa-lista");
  lista.innerHTML = "";

  const ordenado = [...etapa.results].sort((a, b) => a.position - b.position);
  ordenado.forEach((r) => {
    const li = document.createElement("li");
    if (r.position <= 3) li.classList.add("top3");
    const ehConvidado = convidadosSet.has(r.name);
    li.innerHTML = `
      <span class="colocacao">${r.position}º</span>
      <span style="flex:1">${r.name}${ehConvidado ? ' <span class="tag-convidado">convidado</span>' : ""}</span>
      <span class="etapa-resultado-right">
        <span class="pontos">${pointsForPosition(r.position)} pts</span>
        <button type="button" class="mini-btn convidado-toggle" data-nome="${r.name.replace(/"/g, "&quot;")}"
          title="${ehConvidado ? "Remover marca de convidado (volta a contar no ranking)" : "Marcar como convidado (some do ranking)"}">🎟️</button>
      </span>
    `;
    lista.appendChild(li);
  });

  abrirModal("modal-etapa");
}

$("#modal-etapa-lista").addEventListener("click", (e) => {
  const btn = e.target.closest(".convidado-toggle");
  if (!btn) return;
  if (!verificarAdmin()) return;
  toggleConvidado(btn.dataset.nome);
});

// ============================================================================
// MODAL: PERFIL DO JOGADOR
// ============================================================================

function computePlayerStats(nome) {
  let vitorias = 0, segundos = 0, terceiros = 0, valorGanho = 0, pontos = 0, etapasJogadas = 0;
  const historico = [];
  const datasOrdenadas = Array.from(etapasMap.keys()).sort(); // mais antiga primeiro
  for (const data of datasOrdenadas) {
    const etapa = etapasMap.get(data);
    const resultado = etapa.results.find((r) => r.name === nome);
    if (!resultado) continue;
    etapasJogadas += 1;
    const pts = pointsForPosition(resultado.position);
    pontos += pts;
    if (resultado.position === 1) vitorias += 1;
    else if (resultado.position === 2) segundos += 1;
    else if (resultado.position === 3) terceiros += 1;

    // Etapas antigas (importadas) não têm buy-ins registrados: usa o nº de jogadores do dia como aproximação.
    const buyinsDoDia = etapa.buyins || etapa.results.length;
    if (resultado.position === 1) valorGanho += VALOR_BUYIN_PREMIACAO_DIARIA * buyinsDoDia * 0.7;
    else if (resultado.position === 2) valorGanho += VALOR_BUYIN_PREMIACAO_DIARIA * buyinsDoDia * 0.3;

    historico.push({ date: data, position: resultado.position, pontos: pts });
  }
  historico.reverse(); // mais recente primeiro
  return { nome, vitorias, segundos, terceiros, valorGanho, pontos, etapasJogadas, historico };
}

function abrirPerfilJogador(nome) {
  const stats = computePlayerStats(nome);
  $("#jogador-nome").textContent = stats.nome;
  $("#jogador-valor-ganho").textContent = formatMoneyBRL(stats.valorGanho);
  $("#jogador-vitorias").textContent = stats.vitorias;
  $("#jogador-segundos").textContent = stats.segundos;
  $("#jogador-terceiros").textContent = stats.terceiros;
  $("#jogador-pontos").textContent = stats.pontos;
  $("#jogador-etapas").textContent = stats.etapasJogadas;

  const lista = $("#jogador-historico-lista");
  lista.innerHTML = stats.historico.length
    ? stats.historico
        .map(
          (h) => `
      <li data-date="${h.date}">
        <span class="jogador-hist-data">${formatDateBR(h.date)}</span>
        <span class="jogador-hist-pos">${h.position}º</span>
        <span class="jogador-hist-pts">${h.pontos} pts</span>
      </li>`
        )
        .join("")
    : `<li class="empty-hint">Nenhuma etapa ainda.</li>`;

  abrirModal("modal-jogador");
}

// Clicar numa linha do histórico do perfil abre o detalhe daquela etapa.
$("#jogador-historico-lista").addEventListener("click", (e) => {
  const li = e.target.closest("li[data-date]");
  if (!li) return;
  fecharModal("modal-jogador");
  abrirVisualizacaoEtapa(li.dataset.date);
});

// ============================================================================
// MODAL: LANÇAR / EDITAR ETAPA
// ============================================================================

// Autocomplete próprio (em vez de <datalist> nativo — o popup nativo do navegador
// é posicionado pelo SO e pode aparecer fora do lugar em telas embutidas/zoom).
function esconderAutocomplete() {
  const box = $("#autocomplete-box");
  box.classList.add("hidden");
  box.innerHTML = "";
  autocompleteInputAtivo = null;
}

function mostrarAutocomplete(input) {
  const idxAtual = Number(input.dataset.idx);
  const termo = input.value.trim().toLowerCase();
  const usadosEmOutraPosicao = new Set(
    colocacaoAtual
      .filter((n, j) => j !== idxAtual && n)
      .map((n) => n.toLowerCase())
  );
  const sugestoes = Array.from(coletarNomesConhecidos())
    .filter((n) => !usadosEmOutraPosicao.has(n.toLowerCase()) && (!termo || n.toLowerCase().includes(termo)))
    .sort((a, b) => a.localeCompare(b, "pt-BR"))
    .slice(0, 8);

  if (sugestoes.length === 0) {
    esconderAutocomplete();
    return;
  }

  const box = $("#autocomplete-box");
  box.innerHTML = sugestoes
    .map((n) => `<div class="autocomplete-item" data-nome="${n.replace(/"/g, "&quot;")}">${n}</div>`)
    .join("");
  const rect = input.getBoundingClientRect();
  box.style.left = `${rect.left}px`;
  box.style.top = `${rect.bottom + 4}px`;
  box.style.width = `${rect.width}px`;
  box.classList.remove("hidden");
  autocompleteInputAtivo = input;
}

$("#autocomplete-box").addEventListener("mousedown", (e) => {
  const item = e.target.closest(".autocomplete-item");
  if (!item || !autocompleteInputAtivo) return;
  e.preventDefault(); // evita que o input perca o foco antes do clique ser processado
  const input = autocompleteInputAtivo;
  const nome = item.dataset.nome;
  const i = Number(input.dataset.idx);
  input.value = nome;
  colocacaoAtual[i] = nome;
  input.classList.remove("is-novo"); // veio da lista de conhecidos, não precisa confirmar
  esconderAutocomplete();
});

function renderColocacaoLista() {
  const ol = $("#lista-colocacao");
  const nomesConhecidos = coletarNomesConhecidos();
  ol.innerHTML = "";
  colocacaoAtual.forEach((nome, i) => {
    const li = document.createElement("li");
    const ehNova = nome && !nomesConhecidos.has(nome) && !nomesConfirmadosNaSessao.has(nome.toLowerCase());
    li.innerHTML = `
      <span class="colocacao-num">${i + 1}</span>
      <input type="text" class="input nome-input${ehNova ? " is-novo" : ""}" data-idx="${i}"
        value="${nome ? nome.replace(/"/g, "&quot;") : ""}"
        placeholder="Nome do jogador" autocomplete="off" />
      <span class="pontos-preview">${pointsForPosition(i + 1)} pts</span>
      <button type="button" class="mini-btn remove" data-remove="${i}" title="Limpar posição">✕</button>
    `;
    ol.appendChild(li);
  });
}

function abrirLancamento({ dateId = null, prefill = null, buyins = 0 } = {}) {
  etapaEmEdicao = dateId;
  const slots = Array(SLOTS_INICIAIS).fill("");
  if (prefill) {
    prefill.forEach((r) => {
      // Se por acaso a posição passar do número de slots abertos, estica a lista.
      while (slots.length < r.position) slots.push("");
      slots[r.position - 1] = r.name;
    });
  }
  colocacaoAtual = slots;
  nomesConfirmadosNaSessao = new Set();

  $("#lancar-eyebrow").textContent = dateId ? "Editar etapa" : "Nova etapa";
  $("#input-data-etapa").value = dateId || new Date().toISOString().slice(0, 10);
  $("#input-buyins").value = buyins ? String(buyins) : "";
  $("#lancar-erro").classList.add("hidden");
  renderColocacaoLista();
  abrirModal("modal-lancar");
}

$("#input-data-etapa").addEventListener("change", () => {
  const val = $("#input-data-etapa").value;
  const listaVazia = colocacaoAtual.every((n) => !n);
  // Se já existe uma etapa nessa data e a lista ainda está vazia, oferece carregar.
  if (val && etapasMap.has(val) && listaVazia) {
    const etapa = etapasMap.get(val);
    const confirmar = confirm(`Já existe uma etapa em ${formatDateBR(val)}. Carregar os jogadores já lançados para editar?`);
    if (confirmar) {
      etapaEmEdicao = val;
      const slots = Array(SLOTS_INICIAIS).fill("");
      etapa.results.forEach((r) => {
        while (slots.length < r.position) slots.push("");
        slots[r.position - 1] = r.name;
      });
      colocacaoAtual = slots;
      $("#lancar-eyebrow").textContent = "Editar etapa";
      $("#input-buyins").value = etapa.buyins ? String(etapa.buyins) : "";
      renderColocacaoLista();
    }
  } else {
    etapaEmEdicao = etapasMap.has(val) ? val : null;
  }
});

$("#btn-add-posicao").addEventListener("click", () => {
  colocacaoAtual.push("");
  renderColocacaoLista();
});

// Digitar atualiza o estado em memória sem re-renderizar (não perde o foco/cursor)
// e atualiza as sugestões do autocomplete.
$("#lista-colocacao").addEventListener("input", (e) => {
  const input = e.target.closest(".nome-input");
  if (!input) return;
  const i = Number(input.dataset.idx);
  colocacaoAtual[i] = input.value;
  mostrarAutocomplete(input);
});

// Ao focar um campo, mostra as sugestões (mesmo antes de digitar).
$("#lista-colocacao").addEventListener("focusin", (e) => {
  const input = e.target.closest(".nome-input");
  if (!input) return;
  mostrarAutocomplete(input);
});

// Ao sair do campo: esconde o autocomplete, normaliza, checa duplicidade e confirma nomes novos.
$("#lista-colocacao").addEventListener(
  "focusout",
  (e) => {
    const input = e.target.closest(".nome-input");
    if (!input) return;
    esconderAutocomplete();
    const i = Number(input.dataset.idx);
    const nome = input.value.replace(/\s+/g, " ").trim();

    if (!nome) {
      colocacaoAtual[i] = "";
      return;
    }

    const duplicado = colocacaoAtual.some((n, j) => j !== i && n && n.toLowerCase() === nome.toLowerCase());
    if (duplicado) {
      showToast(`${nome} já está nessa etapa em outra posição.`);
      colocacaoAtual[i] = "";
      input.value = "";
      return;
    }

    const nomesConhecidos = coletarNomesConhecidos();
    const jaConfirmado = nomesConfirmadosNaSessao.has(nome.toLowerCase());
    if (!nomesConhecidos.has(nome) && !jaConfirmado) {
      const confirmar = confirm(`"${nome}" ainda não está no ranking. Adicionar esse jogador?`);
      if (!confirmar) {
        colocacaoAtual[i] = "";
        input.value = "";
        return;
      }
      nomesConfirmadosNaSessao.add(nome.toLowerCase());
      input.classList.add("is-novo");

      const ehConvidado = confirm(
        `"${nome}" é convidado?\n\nConvidado aparece no histórico da etapa, mas não entra na Classificação Geral.\n\nOK = é convidado. Cancelar = jogador normal, entra no ranking.`
      );
      if (ehConvidado) toggleConvidado(nome);
    } else {
      input.classList.remove("is-novo");
    }

    colocacaoAtual[i] = nome;
    input.value = nome;
  },
  true
);

$("#lista-colocacao").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-remove]");
  if (!btn) return;
  const i = Number(btn.dataset.remove);
  colocacaoAtual[i] = "";
  renderColocacaoLista();
});

// Soma (ou subtrai) delta*VALOR_POR_BUYIN na premiação guardada no Firestore.
async function ajustarPremiacaoPorBuyins(delta) {
  if (!delta) return;
  const ref = doc(db, "config", "premiacao");
  const snap = await getDoc(ref);
  const atual = snap.exists() ? snap.data().valor || 0 : 0;
  const novo = Math.max(0, atual + delta * VALOR_POR_BUYIN);
  await setDoc(ref, { valor: novo });
  carregarPremiacao();
}

$("#btn-salvar-etapa").addEventListener("click", async () => {
  const dateId = $("#input-data-etapa").value;
  const erroEl = $("#lancar-erro");
  erroEl.classList.add("hidden");

  if (!dateId) {
    erroEl.textContent = "Escolha a data da etapa.";
    erroEl.classList.remove("hidden");
    return;
  }

  const nomesPreenchidos = colocacaoAtual.filter((n) => n && n.trim());
  if (nomesPreenchidos.length < 2) {
    erroEl.textContent = "Preencha pelo menos 2 jogadores.";
    erroEl.classList.remove("hidden");
    return;
  }

  const buyinsRaw = $("#input-buyins").value.trim();
  const buyins = buyinsRaw === "" ? 0 : Number(buyinsRaw);
  if (buyinsRaw !== "" && (!Number.isInteger(buyins) || buyins < 0)) {
    erroEl.textContent = "Buy-ins deve ser um número inteiro, 0 ou mais.";
    erroEl.classList.remove("hidden");
    return;
  }

  const results = nomesPreenchidos.map((name, i) => ({ name, position: i + 1 }));
  const buyinsAntigos = etapaEmEdicao ? (etapasMap.get(etapaEmEdicao)?.buyins || 0) : 0;

  try {
    await authReady;
    await setDoc(doc(db, "etapas", dateId), {
      date: dateId,
      results,
      buyins,
      updatedAt: serverTimestamp(),
    });
    showToast(`Etapa de ${formatDateBR(dateId)} salva!`);
    fecharModal("modal-lancar");
    try {
      await ajustarPremiacaoPorBuyins(buyins - buyinsAntigos);
    } catch (err) {
      console.error(err);
      showToast("Etapa salva, mas não deu para atualizar a premiação automaticamente.");
    }
  } catch (err) {
    console.error(err);
    erroEl.textContent = "Não deu para salvar. Confira sua conexão e as regras do Firestore.";
    erroEl.classList.remove("hidden");
  }
});

// ============================================================================
// EXCLUIR / EDITAR A PARTIR DO MODAL DE VISUALIZAÇÃO
// ============================================================================

$("#btn-editar-etapa").addEventListener("click", () => {
  if (!verificarAdmin()) return;
  const etapa = etapasMap.get(etapaVisualizando);
  fecharModal("modal-etapa");
  abrirLancamento({ dateId: etapa.date, prefill: etapa.results, buyins: etapa.buyins || 0 });
});

$("#btn-excluir-etapa").addEventListener("click", async () => {
  if (!etapaVisualizando) return;
  if (!verificarAdmin()) return;
  const ok = confirm(`Excluir a etapa de ${formatDateBR(etapaVisualizando)}? Essa ação não pode ser desfeita.`);
  if (!ok) return;
  const etapa = etapasMap.get(etapaVisualizando);
  try {
    await authReady;
    await deleteDoc(doc(db, "etapas", etapaVisualizando));
    showToast("Etapa excluída.");
    fecharModal("modal-etapa");
    if (etapa?.buyins) {
      try {
        await ajustarPremiacaoPorBuyins(-etapa.buyins);
      } catch (err) {
        console.error(err);
        showToast("Etapa excluída, mas não deu para ajustar a premiação automaticamente.");
      }
    }
  } catch (err) {
    console.error(err);
    showToast("Não deu para excluir. Tente de novo.");
  }
});

// ============================================================================
// PREMIAÇÃO
// ============================================================================

async function carregarPremiacao() {
  const snap = await getDoc(doc(db, "config", "premiacao"));
  const valor = snap.exists() ? snap.data().valor : 0;
  $("#premio-valor").textContent = formatMoneyBRL(valor);
}

function renderPremioSub() {
  const el = $("#premio-sub");
  if (!el) return;
  const total = etapasMap.size;
  el.textContent = total === 0 ? "nenhuma etapa realizada ainda" : `${total} etapa${total === 1 ? "" : "s"} realizada${total === 1 ? "" : "s"}`;
}

$("#btn-editar-premio").addEventListener("click", async () => {
  const pin = prompt("Senha do organizador para editar a premiação:");
  if (pin !== ORG_PIN) {
    if (pin !== null) showToast("Senha incorreta.");
    return;
  }
  const novo = prompt("Novo valor da premiação (só números, ex: 800):");
  if (novo === null) return;
  const valor = Number(novo.replace(",", "."));
  if (Number.isNaN(valor) || valor < 0) {
    showToast("Valor inválido.");
    return;
  }
  try {
    await authReady;
    await setDoc(doc(db, "config", "premiacao"), { valor });
    showToast("Premiação atualizada!");
    carregarPremiacao();
  } catch (err) {
    console.error(err);
    showToast("Não deu para salvar a premiação.");
  }
});

// ============================================================================
// MODAIS: abrir/fechar genérico
// ============================================================================

function abrirModal(id) {
  $(`#${id}`).classList.remove("hidden");
}
function fecharModal(id) {
  $(`#${id}`).classList.add("hidden");
  esconderAutocomplete();
}
$$(".modal-close, [data-close]").forEach((el) => {
  el.addEventListener("click", () => fecharModal(el.dataset.close));
});
$$(".modal").forEach((modal) => {
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.add("hidden");
  });
});

$("#btn-lancar").addEventListener("click", () => {
  if (!verificarAdmin()) return;
  abrirLancamento();
});
$("#btn-nova-etapa").addEventListener("click", () => {
  if (!verificarAdmin()) return;
  abrirLancamento();
});

// ============================================================================
// INTROZINHA AO ABRIR
// ============================================================================

(function () {
  const splash = $("#splash");
  if (!splash) return;
  const esconderSplash = () => {
    splash.classList.add("splash-hide");
    setTimeout(() => splash.remove(), 550);
  };
  splash.addEventListener("click", esconderSplash);
  setTimeout(esconderSplash, 2200);
})();

// ============================================================================
// BOOT
// ============================================================================

renderPointsTable();
carregarPremiacao();
renderProximaEtapa();
if ($("#temporada-ano")) $("#temporada-ano").textContent = TEMPORADA_ANO;

onSnapshot(
  collection(db, "etapas"),
  (snapshot) => {
    etapasMap = new Map();
    snapshot.forEach((docSnap) => {
      etapasMap.set(docSnap.id, docSnap.data());
    });
    renderTudo();
  },
  (err) => {
    console.error(err);
    $("#ranking-body").innerHTML = `<tr><td colspan="4" class="empty-hint">Não deu para carregar os dados. Confira firebase-config.js e as regras do Firestore (veja o README).</td></tr>`;
  }
);

onSnapshot(
  doc(db, "config", "convidados"),
  (snap) => {
    convidadosSet = new Set(snap.exists() ? snap.data().nomes || [] : []);
    renderTudo(); // a lista de convidados muda o ranking, então recalcula tudo
  },
  (err) => console.error(err)
);
