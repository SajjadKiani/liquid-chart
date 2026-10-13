import type { ChartEngine } from 'liquid-chart';
import { IndicatorWorkerClient } from '../runtime/client.ts';
import { validateParameters, validateProgram } from '../runtime/contract.ts';
import type { IndicatorProgram } from '../runtime/contract.ts';
import { AIWorkspaceController } from './ai-controller.ts';

type ChatItem = { role: 'user' | 'assistant'; text: string };
type Saved = { programs: IndicatorProgram[]; appliedIds: string[]; selectedId?: string; chat: ChatItem[]; parameters: Record<string, Record<string, number>>; importedIds: string[] };
type Scope = string | { key: string; persistent?: boolean };
const MAX_PROGRAMS = 12;
const MAX_CHAT_ITEMS = 40;
const MAX_CHAT_CHARS = 4000;
const MAX_SAVED_BYTES = 1_500_000;
const blankSaved = (): Saved => ({ programs: [], appliedIds: [], chat: [], parameters: {}, importedIds: [] });

export function createAIWorkspace(options: {
  chart: ChartEngine;
  host: HTMLElement;
  scope: () => Scope;
  onProgress?: (message: string) => void;
}) {
  const { chart, host, scope } = options;
  const client = new IndicatorWorkerClient();
  const controller = new AIWorkspaceController();
  const root = document.createElement('section');
  root.className = 'ai-workspace';
  root.innerHTML = `<header class="ai-head"><span class="eyebrow">LIQUIDCHART</span><h2>Indicator studio</h2><p>Your ideas, plotted.</p></header>
    <div class="ai-tabs" role="tablist" aria-label="Indicator studio">
      <button id="ai-chat-tab" type="button" role="tab" aria-selected="true" aria-controls="ai-chat-panel">Chat</button>
      <button id="ai-indicators-tab" type="button" role="tab" aria-selected="false" aria-controls="ai-indicators-panel" tabindex="-1">Indicators <span class="ai-tab-count" aria-hidden="true">0</span></button>
    </div>
    <div class="ai-status" role="status" aria-live="polite">Checking AI configuration…</div>
    <section id="ai-chat-panel" class="ai-tab-panel ai-chat-panel" role="tabpanel" aria-labelledby="ai-chat-tab">
      <div class="ai-thread" role="log" aria-label="Conversation" aria-live="polite"></div>
      <form class="ai-form"><label class="sr-only" for="ai-request">Describe an indicator</label><textarea id="ai-request" rows="3" maxlength="4000" placeholder="Describe what you want to plot…" required></textarea><div class="ai-form-actions"><label class="ai-web-search"><input id="ai-web-search" type="checkbox" checked /> Web search</label><button type="button" class="ai-cancel" hidden>Cancel</button><button type="submit">Generate ↗</button></div><span class="ai-composer-hint">Ctrl / ⌘ + Enter to generate</span></form>
    </section>
    <section id="ai-indicators-panel" class="ai-tab-panel ai-indicators-panel" role="tabpanel" aria-labelledby="ai-indicators-tab" tabindex="0" hidden>
      <div class="ai-calc-status" role="status" aria-live="polite"></div>
      <div class="ai-artifacts"></div>
    </section>`;
  host.replaceChildren(root);
  const status = root.querySelector<HTMLElement>('.ai-status')!;
  const calcStatus = root.querySelector<HTMLElement>('.ai-calc-status')!;
  const thread = root.querySelector<HTMLElement>('.ai-thread')!;
  const form = root.querySelector<HTMLFormElement>('.ai-form')!;
  const prompt = root.querySelector<HTMLTextAreaElement>('#ai-request')!;
  const submit = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
  const cancelButton = form.querySelector<HTMLButtonElement>('.ai-cancel')!;
  const webSearch = form.querySelector<HTMLInputElement>('#ai-web-search')!;
  try { webSearch.checked = localStorage.getItem('liquidchart.ai.webSearch') !== 'false'; } catch { webSearch.checked = true; }
  webSearch.addEventListener('change', () => {
    try { localStorage.setItem('liquidchart.ai.webSearch', String(webSearch.checked)); } catch { /* preference remains active for this page */ }
  });
  const artifacts = root.querySelector<HTMLElement>('.ai-artifacts')!;
  const chatTab = root.querySelector<HTMLButtonElement>('#ai-chat-tab')!;
  const indicatorsTab = root.querySelector<HTMLButtonElement>('#ai-indicators-tab')!;
  const chatPanel = root.querySelector<HTMLElement>('#ai-chat-panel')!;
  const indicatorsPanel = root.querySelector<HTMLElement>('#ai-indicators-panel')!;
  const indicatorCount = root.querySelector<HTMLElement>('.ai-tab-count')!;
  let chatNeedsScroll = false;
  function activateTab(tab: 'chat' | 'indicators', focus = false) {
    const isChat = tab === 'chat';
    chatTab.setAttribute('aria-selected', String(isChat));
    indicatorsTab.setAttribute('aria-selected', String(!isChat));
    chatTab.tabIndex = isChat ? 0 : -1; indicatorsTab.tabIndex = isChat ? -1 : 0;
    chatPanel.hidden = !isChat; indicatorsPanel.hidden = isChat;
    if (isChat && chatNeedsScroll) { thread.scrollTop = thread.scrollHeight; chatNeedsScroll = false; }
    if (focus) (isChat ? chatTab : indicatorsTab).focus();
  }
  for (const [tab, name] of [[chatTab, 'chat'], [indicatorsTab, 'indicators']] as const) {
    tab.addEventListener('click', () => activateTab(name));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      activateTab(event.key === 'Home' ? 'chat' : event.key === 'End' ? 'indicators' : name === 'chat' ? 'indicators' : 'chat', true);
    });
  }
  prompt.addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing) {
      event.preventDefault();
      if (!submit.disabled) form.requestSubmit();
    }
  });
  let currentKey = '';
  let persistentScope = true;
  let saved = blankSaved();
  let request: AbortController | undefined;
  let requestTicket: ReturnType<AIWorkspaceController['beginRequest']> | undefined;
  let calcTimer: ReturnType<typeof setTimeout> | undefined;
  let undoSnapshot: { saved: Saved; program: IndicatorProgram } | undefined;
  let disposed = false;
  const sessionSaved = new Map<string, Saved>();
  function rememberSession(key: string, value: Saved) {
    sessionSaved.delete(key); sessionSaved.set(key, structuredClone(value));
    while (sessionSaved.size > 32) sessionSaved.delete(sessionSaved.keys().next().value!);
  }
  function recallSession(key: string) {
    const value = sessionSaved.get(key);
    if (!value) return undefined;
    sessionSaved.delete(key); sessionSaved.set(key, value);
    return value;
  }

  function readScope(): { key: string; persistent: boolean } {
    const value = scope();
    return typeof value === 'string' ? { key: value, persistent: true } : { key: value.key, persistent: value.persistent !== false };
  }
  function storageKey(key = currentKey) { return `liquidchart.ai.${key}`; }
  function encode(value: Saved) {
    const text = JSON.stringify(value);
    if (text.length > MAX_SAVED_BYTES) throw new Error('Saved indicator library exceeds its storage limit. Remove older items before adding more.');
    return text;
  }
  function persist() {
    if (disposed) return;
    try {
      const text = encode(saved);
      rememberSession(currentKey, saved);
      if (persistentScope) localStorage.setItem(storageKey(), text);
    } catch (error) {
      calcStatus.textContent = error instanceof Error ? error.message : 'Browser storage is unavailable. Changes will last for this session.';
    }
  }
  function addChat(role: ChatItem['role'], text: string) {
    if (disposed) return;
    const bounded = text.slice(0, MAX_CHAT_CHARS);
    saved.chat.push({ role, text: bounded });
    saved.chat = saved.chat.slice(-MAX_CHAT_ITEMS);
    renderChat(); persist();
  }
  function renderChat() {
    thread.replaceChildren();
    if (!saved.chat.length) {
      chatNeedsScroll = false;
      const intro = document.createElement('p'); intro.className = 'ai-empty';
      intro.textContent = 'Start with an idea. Describe a calculation, its inputs, and how it should look on the chart. Your generated code and settings will live in Indicators.';
      thread.append(intro); return;
    }
    for (const item of saved.chat) {
      const bubble = document.createElement('article'); bubble.className = `ai-message ${item.role}`;
      const label = document.createElement('strong'); label.textContent = item.role === 'user' ? 'You' : 'Indicator assistant';
      const body = document.createElement('p'); body.textContent = item.text;
      bubble.append(label, body); thread.append(bubble);
    }
    if (chatPanel.hidden) chatNeedsScroll = true;
    else { thread.scrollTop = thread.scrollHeight; chatNeedsScroll = false; }
  }
  function validateSaved(raw: unknown): Saved {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Saved workspace data is invalid.');
    const data = raw as Record<string, unknown>;
    if (!Array.isArray(data.programs) || data.programs.length > MAX_PROGRAMS || !Array.isArray(data.chat)) throw new Error('Saved workspace limits are invalid.');
    const programs = data.programs.map(validateProgram);
    const ids = new Set(programs.map(program => program.id));
    if (ids.size !== programs.length) throw new Error('Saved workspace contains duplicate program identifiers.');
    const chat = data.chat.filter((item): item is ChatItem => !!item && typeof item === 'object' && ((item as ChatItem).role === 'user' || (item as ChatItem).role === 'assistant') && typeof (item as ChatItem).text === 'string').slice(-MAX_CHAT_ITEMS).map(item => ({ role: item.role, text: item.text.slice(0, MAX_CHAT_CHARS) }));
    const appliedIds = Array.isArray(data.appliedIds) ? data.appliedIds.filter((id): id is string => typeof id === 'string' && ids.has(id)) : (typeof data.selectedId === 'string' && ids.has(data.selectedId) ? [data.selectedId] : []);
    const selectedId = typeof data.selectedId === 'string' && appliedIds.includes(data.selectedId) ? data.selectedId : appliedIds.at(-1);
    const importedIds = Array.isArray(data.importedIds) ? data.importedIds.filter((id): id is string => typeof id === 'string' && ids.has(id)) : [];
    const parameters: Saved['parameters'] = {};
    if (data.parameters && typeof data.parameters === 'object' && !Array.isArray(data.parameters)) {
      for (const program of programs) {
        const values = (data.parameters as Record<string, unknown>)[program.id];
        if (!values || typeof values !== 'object' || Array.isArray(values)) continue;
        try { parameters[program.id] = validateParameters(program, values); }
        catch { parameters[program.id] = Object.fromEntries(program.parameters.map(param => [param.key, param.default])); }
      }
    }
    return { programs, appliedIds: [...new Set(appliedIds)], selectedId, chat, parameters, importedIds: [...new Set(importedIds)] };
  }
  function selectScope() {
    if (disposed) return false;
    const next = readScope();
    if (next.key === currentKey) return false;
    controller.changeScope();
    request?.abort(); request = undefined; requestTicket = undefined;
    submit.disabled = false; cancelButton.hidden = true; webSearch.disabled = false;
    calcStatus.textContent = '';
    if (calcTimer) clearTimeout(calcTimer);
    undoSnapshot = undefined;
    if (currentKey) rememberSession(currentKey, saved);
    currentKey = next.key; persistentScope = next.persistent;
    let restored: Saved | undefined = recallSession(currentKey);
    if (!restored && persistentScope) {
      try {
        const rawText = localStorage.getItem(storageKey());
        if (rawText && rawText.length <= MAX_SAVED_BYTES) restored = validateSaved(JSON.parse(rawText));
      } catch { restored = undefined; }
    }
    saved = restored ? validateSaved(restored) : blankSaved();
    renderChat(); renderArtifacts();
    if (saved.appliedIds.length) scheduleCalculation(0);
    return true;
  }
  function selectedProgram() { return saved.programs.find(program => program.id === saved.selectedId); }
  function parameters(program: IndicatorProgram) {
    const raw = saved.parameters[program.id] ?? Object.fromEntries(program.parameters.map(param => [param.key, param.default]));
    return validateParameters(program, raw);
  }
  function applyOutput(program: IndicatorProgram, output: Awaited<ReturnType<IndicatorWorkerClient['execute']>>) {
    chart.setIndicator(program.id, output);
  }
  function scheduleCalculation(delay = 100) {
    if (calcTimer) clearTimeout(calcTimer);
    const ticket = controller.beginCalculation();
    const dataset = chart.store.candles.slice();
    calcTimer = setTimeout(async () => {
      const failures: string[] = [];
      for (const id of [...saved.appliedIds]) {
        const program = saved.programs.find(candidate => candidate.id === id);
        if (!program) continue;
        try {
          const output = await client.execute(program, dataset, parameters(program));
          if (disposed || !controller.isCalculationCurrent(ticket) || currentKey !== readScope().key || !saved.appliedIds.includes(id)) return;
          applyOutput(program, output);
        } catch (error) {
          if (disposed || !controller.isCalculationCurrent(ticket)) return;
          failures.push(`${program.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (!disposed && controller.isCalculationCurrent(ticket) && saved.appliedIds.length) calcStatus.textContent = failures.length
        ? `Updated ${saved.appliedIds.length - failures.length} of ${saved.appliedIds.length} applied indicators; failed outputs preserve their prior chart values. ${failures.join(' · ')}`
        : `${saved.appliedIds.length} applied indicator${saved.appliedIds.length === 1 ? '' : 's'} updated for ${dataset.length.toLocaleString()} candles.`;
    }, delay);
  }
  function importProgram(file: File) {
    const ticket = controller.beginImport();
    void (async () => {
      try {
        if (file.size > 1_000_000) throw new Error('Choose an indicator artifact smaller than 1 MB.');
        const program = validateProgram(JSON.parse(await file.text()));
        if (disposed || !controller.isImportCurrent(ticket) || currentKey !== readScope().key) return;
        if (!saved.programs.some(item => item.id === program.id) && saved.programs.length >= MAX_PROGRAMS) throw new Error(`The workspace holds at most ${MAX_PROGRAMS} programs. Remove one before importing another.`);
        const existing = saved.programs.find(item => item.id === program.id);
        if (existing && JSON.stringify(existing) !== JSON.stringify(program)) throw new Error('A different artifact with this identifier is already saved.');
        const dataset = chart.store.candles.slice();
        const output = await client.execute(program, dataset, parameters(program));
        if (disposed || !controller.isImportCurrent(ticket) || currentKey !== readScope().key) return;
        const nextSaved = structuredClone(saved);
        if (!existing) nextSaved.programs.push(program);
        nextSaved.importedIds = [...new Set([...nextSaved.importedIds, program.id])];
        nextSaved.appliedIds = [...new Set([...nextSaved.appliedIds, program.id])]; nextSaved.selectedId = program.id;
        encode(nextSaved);
        applyOutput(program, output);
        saved = nextSaved;
        persist(); renderArtifacts(); activateTab('indicators');
        calcStatus.textContent = `Imported and applied ${program.name}.`; addChat('assistant', `Imported code: ${program.name}.`);
      } catch (error) {
        if (!disposed && controller.isImportCurrent(ticket)) calcStatus.textContent = `Artifact import failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    })();
  }
  function renderArtifacts() {
    artifacts.replaceChildren();
    indicatorCount.textContent = String(saved.programs.length);
    indicatorsTab.setAttribute('aria-label', `Indicators (${saved.programs.length})`);
    const library = document.createElement('div'); library.className = 'ai-library';
    const libraryTitle = document.createElement('strong'); libraryTitle.textContent = saved.programs.length ? `${saved.programs.length} saved · ${saved.appliedIds.length} on chart` : 'Your indicator library';
    const exportButton = document.createElement('button'); exportButton.type = 'button'; exportButton.textContent = 'Export selected'; exportButton.disabled = !selectedProgram();
    exportButton.onclick = () => { const program = selectedProgram(); if (!program) return; const blob = new Blob([JSON.stringify(program, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `${program.id}.indicator.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
    const importButton = document.createElement('button'); importButton.type = 'button'; importButton.className = 'ai-import-button'; importButton.textContent = 'Import artifact';
    const undoRemoval = document.createElement('button'); undoRemoval.type = 'button'; undoRemoval.textContent = 'Undo remove'; undoRemoval.disabled = !undoSnapshot;
    undoRemoval.onclick = () => {
      const snapshot = undoSnapshot; if (!snapshot || disposed) return;
      const ticket = controller.beginCalculation(); const dataset = chart.store.candles.slice();
      try { encode(snapshot.saved); } catch (error) { calcStatus.textContent = error instanceof Error ? error.message : String(error); return; }
      void client.execute(snapshot.program, dataset, snapshot.saved.parameters[snapshot.program.id] ?? Object.fromEntries(snapshot.program.parameters.map(param => [param.key, param.default]))).then(output => {
        if (disposed || !controller.isCalculationCurrent(ticket) || currentKey !== readScope().key) return;
        applyOutput(snapshot.program, output);
        saved = structuredClone(snapshot.saved); undoSnapshot = undefined; persist(); renderArtifacts(); scheduleCalculation(0);
      }).catch(error => { if (!disposed && controller.isCalculationCurrent(ticket)) calcStatus.textContent = `Undo could not restore ${snapshot.program.name}; saved state is unchanged. ${error instanceof Error ? error.message : String(error)}`; });
    };
    const importInput = document.createElement('input'); importInput.type = 'file'; importInput.accept = 'application/json,.json'; importInput.hidden = true;
    importButton.addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', () => { const file = importInput.files?.[0]; if (file) importProgram(file); importInput.value = ''; });
    library.append(libraryTitle, undoRemoval, exportButton, importButton, importInput); artifacts.append(library);
    if (!saved.programs.length) {
      const empty = document.createElement('div'); empty.className = 'ai-library-empty';
      const title = document.createElement('h3'); title.textContent = 'A home for your indicators';
      const hint = document.createElement('p'); hint.textContent = 'Generate an indicator in Chat, or import an artifact. Adjust its parameters and inspect its code here.';
      const start = document.createElement('button'); start.type = 'button'; start.textContent = 'Open Chat ↗'; start.onclick = () => { activateTab('chat'); prompt.focus(); };
      empty.append(title, hint, start); artifacts.append(empty);
    }
    for (const program of saved.programs) {
      const card = document.createElement('article'); card.className = `ai-artifact ${program.id === saved.selectedId ? 'selected' : ''}`;
      const title = document.createElement('h3'); title.textContent = program.name;
      const origin = document.createElement('span'); origin.className = 'ai-code-label'; origin.textContent = saved.importedIds.includes(program.id) ? 'Imported code' : 'Generated artifact';
      const description = document.createElement('p'); description.textContent = program.description;
      const actions = document.createElement('div'); actions.className = 'ai-actions';
      const apply = document.createElement('button'); apply.textContent = program.id === saved.selectedId ? 'Selected' : saved.appliedIds.includes(program.id) ? 'Applied' : 'Apply'; apply.onclick = () => {
        const ticket = controller.beginCalculation(), dataset = chart.store.candles.slice();
        void client.execute(program, dataset, parameters(program)).then(output => {
          if (disposed || !controller.isCalculationCurrent(ticket) || currentKey !== readScope().key) return;
          applyOutput(program, output);
          saved.selectedId = program.id;
          if (!saved.appliedIds.includes(program.id)) saved.appliedIds.push(program.id);
          persist(); renderArtifacts();
        }).catch(error => { if (!disposed && controller.isCalculationCurrent(ticket)) calcStatus.textContent = `Could not apply ${program.name}; saved state is unchanged. ${error instanceof Error ? error.message : String(error)}`; });
      };
      const remove = document.createElement('button'); remove.textContent = 'Remove'; remove.onclick = () => {
        undoSnapshot = { saved: structuredClone(saved), program }; chart.removeIndicator(program.id);
        saved.programs = saved.programs.filter(p => p.id !== program.id); saved.appliedIds = saved.appliedIds.filter(id => id !== program.id);
        saved.importedIds = saved.importedIds.filter(id => id !== program.id); delete saved.parameters[program.id];
        if (saved.selectedId === program.id) saved.selectedId = saved.appliedIds.at(-1);
        persist(); renderArtifacts(); scheduleCalculation(0);
      };
      const code = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = 'Inspect generated code'; const pre = document.createElement('pre'); pre.textContent = program.code; code.append(summary, pre);
      const sources = document.createElement('div'); sources.className = 'ai-sources';
      const importedCode = saved.importedIds.includes(program.id);
      for (const source of program.sources) { const a = document.createElement('a'); a.href = source.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = source.title || source.url; sources.append(a); }
      if (!program.sources.length) {
        const note = document.createElement('span'); note.textContent = importedCode ? 'No sources supplied with this imported artifact.' : 'Generated · no web research';
        sources.append(note);
      }
      const evidence = document.createElement('details'); evidence.className = 'ai-evidence';
      const evidenceTitle = document.createElement('summary'); evidenceTitle.textContent = 'Sources & assumptions';
      const assumptions = document.createElement('p'); assumptions.className = 'ai-assumptions';
      const assumptionText = program.assumptions.length ? `Assumptions: ${program.assumptions.join(' · ')}` : 'No assumptions listed.';
      const researchNote = !importedCode && !program.sources.length ? ' Generated from model knowledge; no web research was used.' : '';
      assumptions.textContent = `${assumptionText}${researchNote} Checks validate output shape and execution limits; they do not prove formula correctness.`;
      actions.append(apply, remove); card.append(title, origin, description, actions);
      for (const param of program.parameters) {
        const label = document.createElement('label'); label.className = 'ai-param'; label.textContent = param.label;
        const input = document.createElement('input'); input.type = 'number'; input.min = String(param.min); input.max = String(param.max); input.step = String(param.step); input.value = String(parameters(program)[param.key]); input.dataset.param = param.key;
        input.addEventListener('change', async () => {
          const candidate = Number(input.value), oldValues = parameters(program);
          if (!Number.isFinite(candidate) || candidate < param.min || candidate > param.max) { input.value = String(oldValues[param.key]); calcStatus.textContent = `${param.label} must be between ${param.min} and ${param.max}.`; return; }
          const ticket = controller.beginCalculation(); const dataset = chart.store.candles.slice();
          const nextValues = { ...oldValues, [param.key]: candidate };
          try {
            const output = await client.execute(program, dataset, nextValues);
            if (disposed || !controller.isCalculationCurrent(ticket) || currentKey !== readScope().key) { input.value = String(parameters(program)[param.key]); return; }
            const nextSaved = structuredClone(saved);
            nextSaved.parameters[program.id] = validateParameters(program, nextValues);
            if (!nextSaved.appliedIds.includes(program.id)) nextSaved.appliedIds.push(program.id);
            nextSaved.selectedId = program.id; encode(nextSaved);
            applyOutput(program, output); saved = nextSaved; persist(); renderArtifacts();
            calcStatus.textContent = `${param.label} updated for ${program.name}.`;
          } catch (error) {
            if (!disposed && controller.isCalculationCurrent(ticket)) calcStatus.textContent = `${param.label} was not changed. The previous value and chart output remain active. ${error instanceof Error ? error.message : String(error)}`;
            input.value = String(oldValues[param.key]);
          }
        });
        label.append(input); card.append(label);
      }
      const provenance = document.createElement('p'); provenance.className = 'ai-provenance'; provenance.textContent = importedCode ? 'Imported code · review before use' : program.sources.length ? 'Web research · review linked sources' : 'Model knowledge · no web research';
      const checks = document.createElement('p'); checks.className = 'ai-check-note'; checks.textContent = 'Execution checked. Formula correctness is not guaranteed.';
      evidence.append(evidenceTitle, sources, assumptions);
      card.append(provenance, checks, evidence, code); artifacts.append(card);
    }
  }

  cancelButton.addEventListener('click', () => {
    if (!request || !requestTicket) return;
    const aborted = request, ticket = requestTicket;
    controller.cancelRequest(ticket); aborted.abort(); request = undefined; requestTicket = undefined;
    submit.disabled = false; cancelButton.hidden = true; webSearch.disabled = false;
    if (!disposed) status.textContent = 'Request cancelled.';
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const text = prompt.value.trim(); if (!text || request) return;
    addChat('user', text); prompt.value = '';
    const abort = new AbortController(); request = abort; requestTicket = controller.beginRequest();
    const ticket = requestTicket;
    const useWebSearch = webSearch.checked;
    submit.disabled = true; cancelButton.hidden = false; webSearch.disabled = true; status.textContent = 'Sending request…';
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let receivedResult = false;
    let streamBytes = 0;
    let eventCount = 0;
    const handleEvent = async (eventValue: unknown) => {
      if (!controller.isRequestCurrent(ticket)) return;
      if (receivedResult) throw new Error('AI service sent events after its result.');
      if (++eventCount > 100) throw new Error('AI service exceeded the event count limit.');
      if (!eventValue || typeof eventValue !== 'object' || Array.isArray(eventValue)) throw new Error('AI service sent an invalid event.');
      const item = eventValue as Record<string, unknown>;
      if (item.type === 'progress' && typeof item.message === 'string') { status.textContent = item.message.slice(0, 500); options.onProgress?.(status.textContent); return; }
      if (item.type === 'error' && typeof item.message === 'string') throw new Error(item.message.slice(0, 1000));
      if (item.type !== 'result') throw new Error('AI service sent an unknown event type.');
      const program = validateProgram(item.program);
      const sameId = saved.programs.find(existing => existing.id === program.id);
      if (!sameId && saved.programs.length >= MAX_PROGRAMS) throw new Error(`The workspace holds at most ${MAX_PROGRAMS} programs. Remove one before generating another.`);
      if (sameId && JSON.stringify(sameId) !== JSON.stringify(program)) throw new Error('Generated program reused an identifier for different code.');
      let output: Awaited<ReturnType<IndicatorWorkerClient['execute']>> | undefined;
      for (let attempt = 0; attempt < 4; attempt++) {
        const dataTicket = controller.beginDatasetCheck();
        output = await client.execute(program, chart.store.candles.slice(), parameters(program));
        if (abort.signal.aborted || !controller.isRequestCurrent(ticket)) return;
        if (!controller.isRequestCurrent(ticket) || currentKey !== readScope().key) return;
        if (controller.isDatasetCurrent(dataTicket)) break;
        output = undefined;
      }
      if (!output) throw new Error('The dataset kept changing while the indicator was being calculated. Submit the request again.');
      if (abort.signal.aborted || !controller.isRequestCurrent(ticket)) return;
      const nextSaved = structuredClone(saved);
      if (!sameId) nextSaved.programs.push(program);
      nextSaved.appliedIds = [...new Set([...nextSaved.appliedIds, program.id])]; nextSaved.selectedId = program.id;
      encode(nextSaved);
      applyOutput(program, output); saved = nextSaved; persist();
      addChat('assistant', `${program.name}: ${program.description}`); renderArtifacts();
      status.textContent = `Applied ${program.name}. Review code, sources, and assumptions in Indicators.`;
      activateTab('indicators', chatPanel.contains(document.activeElement));
      artifacts.querySelector<HTMLElement>('.ai-artifact.selected')?.scrollIntoView({ block: 'nearest' });
      receivedResult = true;
    };
    try {
      const response = await fetch('/api/indicators/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request: text, webSearch: useWebSearch, ...(selectedProgram() ? { previous: selectedProgram() } : {}) }), signal: abort.signal });
      if (!response.ok) {
        let message = `AI service returned HTTP ${response.status}.`;
        try {
          const body = await response.text();
          if (body.length <= 10_000) {
            const parsed: unknown = JSON.parse(body);
            if (parsed && typeof parsed === 'object' && typeof (parsed as { error?: unknown }).error === 'string') message = (parsed as { error: string }).error.slice(0, 1000);
          }
        } catch { /* retain the HTTP status fallback */ }
        throw new Error(message);
      }
      if (!response.body) throw new Error('AI service returned an empty response stream.');
      reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
      while (true) {
        const { value, done } = await reader.read(); streamBytes += value?.byteLength ?? 0;
        if (streamBytes > 1_500_000) throw new Error('AI response exceeded the stream size limit.');
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        if (buffer.length > 1_100_000) throw new Error('AI response exceeded the event size limit.');
        let newline: number;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
          if (line) await handleEvent(JSON.parse(line));
        }
        if (done) break;
      }
      if (buffer.trim()) await handleEvent(JSON.parse(buffer));
      if (!receivedResult && controller.isRequestCurrent(ticket)) throw new Error('AI stream ended without an indicator result.');
    } catch (error) {
      if (!controller.isRequestCurrent(ticket)) return;
      if (error instanceof DOMException && error.name === 'AbortError') status.textContent = 'Request cancelled.';
      else { const message = error instanceof Error ? error.message : String(error); status.textContent = message; addChat('assistant', `Unable to generate an indicator: ${message}`); }
    } finally {
      try { await reader?.cancel(); } catch { /* closed stream */ }
      if (request === abort && controller.isRequestCurrent(ticket)) { request = undefined; requestTicket = undefined; submit.disabled = false; cancelButton.hidden = true; webSearch.disabled = false; }
    }
  });

  selectScope();
  fetch('/api/ai/status').then(async response => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const value = await response.json();
    if (disposed) return;
    if (typeof value.configured !== 'boolean') throw new Error('Malformed AI status response.');
    const detail = typeof value.message === 'string' ? value.message.trim().slice(0, 300) : '';
    status.textContent = `${value.configured ? 'AI provider configured. Describe the indicator you want.' : 'AI provider is not configured. Add the server API key to enable generation.'}${detail ? ` ${detail}` : ''}`;
  }).catch(() => { if (!disposed) status.textContent = 'AI service unavailable. Start the local API service to generate indicators.'; });
  return {
    datasetChanged() { if (disposed) return; selectScope(); controller.dataChanged(); scheduleCalculation(); },
    destroy() { if (disposed) return; disposed = true; controller.changeScope(); request?.abort(); request = undefined; if (calcTimer) clearTimeout(calcTimer); client.destroy(); root.remove(); },
  };
}
