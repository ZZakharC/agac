import './style.scss';
import { Chess } from 'chess.js';
import { renderBoard } from './board';
import { BADGE_MARK, CLASS_LABEL, CLASS_MARK, esc, formatEval, winPercent } from './utils';
import type { AnalysisResult, MoveAnalysis, PositionEval } from './types';
import { startAnalysis, getMode, setMode, getServer, setServer, type Mode } from './api';
import { startLocalAnalysis } from './localAnalysis';
import { buildExport, exportFileName, parseImport, saveFile } from './io';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

interface State {
    pgn: string;
    fens: string[];
    sans: string[];
    ucis: string[];
    positions: (PositionEval | null)[];
    analysis: MoveAnalysis[] | null;
    result: AnalysisResult | null;
    ply: number;
    flipped: boolean;
    elapsedMs: number | null;
}

const state: State = {
    fens: [new Chess().fen()], sans: [], ucis: [], positions: [],
    analysis: null, result: null, ply: 0, flipped: false, pgn: "", elapsedMs: null
};

let job: { cancel(): void } | null = null;
let progressText = '';
let startedAt = 0;
let ticker: number | undefined;

function formatDuration(ms: number): string {
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)} с`;
    const total = Math.round(ms / 1000);
    return `${Math.floor(total / 60)} мин ${total % 60} с`;
}

function startTimer() {
    startedAt = performance.now();
    clearInterval(ticker);
    ticker = window.setInterval(
        () => setStatus(`${progressText} · ${formatDuration(performance.now() - startedAt)}`),
        200,
    );
}

/** Останавливает таймер и возвращает прошедшее время, мс. */
function stopTimer(): number {
    clearInterval(ticker);
    ticker = undefined;
    return performance.now() - startedAt;
}

function loadGame(pgn: string) {
    const g = new Chess();
    g.loadPgn(pgn);

    const h = g.history({ verbose: true });

    if (!h.length)
        throw new Error('В PGN нет ходов');

    state.elapsedMs = null;
    state.fens = [h[0].before, ...h.map((m) => m.after)];
    state.sans = h.map((m) => m.san);
    state.ucis = h.map((m) => m.from + m.to + (m.promotion ?? ''));
    state.positions = new Array(state.fens.length).fill(null);
    state.analysis = null;
    state.result = null;
    state.ply = 0;
    state.pgn = pgn;
}

function renderEvalBar() {
    const ev = state.positions[state.ply];
    $('evalfill').style.height = `${ev ? winPercent(ev.cp) : 50}%`;
    $('evalbar').classList.toggle('flipped', state.flipped);
    $('evaltext').textContent = formatEval(ev);
}

function renderGraph() {
    const n = state.fens.length;
    const pts: string[] = [];

    for (let i = 0; i < n; i++) {
        const ev = state.positions[i];
        if (!ev)
            break;

        pts.push(`${i},${100 - winPercent(ev.cp)}`);
    }

    const w = Math.max(n - 1, 1);
    const area = pts.length > 1 ? `<path d="M0,100 L${pts.join(' L')} L${pts.length - 1},100 Z" class="g-fill"/>` : '';
    $('graph').innerHTML = `<svg viewBox="0 0 ${w} 100" preserveAspectRatio="none"><rect class="g-bg" width="${w}" height="100"/>${area}<line x1="0" x2="${w}" y1="50" y2="50" class="g-mid" vector-effect="non-scaling-stroke"/><line x1="${state.ply}" x2="${state.ply}" y1="0" y2="100" class="g-cur" vector-effect="non-scaling-stroke"/></svg>`;
}

function moveButton(i: number) {
    const a = state.analysis?.[i];
    const mark = a ? (CLASS_MARK[a.classification] ?? '') : '';
    return `<button class="mv ${a?.classification ?? ''}" data-ply="${i + 1}">${esc(state.sans[i])}<sup>${mark}</sup></button>`;
}

function renderMoves() {
    let html = '';

    for (let i = 0; i < state.sans.length; i += 2)
        html += `<span class="num">${i / 2 + 1}.</span>${moveButton(i)}${i + 1 < state.sans.length ? moveButton(i + 1) : '<span></span>'}`;

    $('moves').innerHTML = html;
    markCurrentMove();
}

function markCurrentMove() {
    const box = $('moves');
    document.querySelectorAll<HTMLElement>('.mv').forEach((b) => {
        const cur = Number(b.dataset.ply) === state.ply;
        b.classList.toggle('cur', cur);

        if (!cur)
            return;

        const bb = b.getBoundingClientRect();
        const cb = box.getBoundingClientRect();

        if (bb.top < cb.top)
            box.scrollTop -= cb.top - bb.top;
        else if (bb.bottom > cb.bottom)
            box.scrollTop += bb.bottom - cb.bottom;
    });
}

function renderInfo() {
    const p = state.ply;
    const a = p > 0 ? state.analysis?.[p - 1] : null;
    const ev = state.positions[p];
    let html = '';

    if (p > 0) {
        const label = `${Math.floor((p - 1) / 2) + 1}${(p - 1) % 2 === 0 ? '.' : '…'} ${esc(state.sans[p - 1])}`;
        html += `<p class="mvline"><strong>${label}</strong>`;

        if (a)
            html += ` <span class="tag ${a.classification}">${CLASS_LABEL[a.classification]}</span>`;

        html += '</p>';

        if (a && a.loss >= 5 && a.bestMoveSan)
            html += `<p>Лучше было <strong>${esc(a.bestMoveSan)}</strong> — потеря ${a.loss.toFixed(0)}% на победу.</p>`;
    } else
        html += '<p class="mvline"><strong>Начальная позиция</strong></p>';
    if (ev)
        html += `<p class="pv"><b>${formatEval(ev)}</b> ${ev.pv.map(esc).join(' ')}</p>`;
    else if (!job)
        html += '<p class="muted">Вставьте PGN и нажмите «Анализировать».</p>';

    $('info').innerHTML = html;
}

function renderSummary() {
    const box = $('summary');
    const r = state.result;
    box.hidden = !r;

    if (!r)
        return;

    const side = (c: 'w' | 'b', name: string) => {
        const s = r.summary[c];

        return `
            <div>
                <h3>${esc(name)}</h3>
                <span class="acc">${s.accuracy.toFixed(1)}%</span>
                <div class="brilliant"><b>!!</b><span>Блестящие ходы: ${s.counts.brilliant}</span></div>
                <div class="best"><b>★</b><span>Лучшие ходы: ${s.counts.best}</span></div>
                <div class="excellent"><b>!</b><span>Отличные ходы: ${s.counts.excellent}</span></div>
                <div class="good"><b>✓</b><span>Хорошие ходы: ${s.counts.good}</span></div>
                <div class="inaccuracy"><b>?!</b><span>Неточности: ${s.counts.inaccuracy}</span></div>
                <div class="mistake"><b>?</b><span>Ошибки: ${s.counts.mistake}</span></div>
                <div class="miss"><b>✗</b><span>Упущенные возможности: ${s.counts.miss}</span></div>
                <div class="blunder"><b>??</b><span>Грубые ошибки: ${s.counts.blunder}</span></div>
            </div>`;
    };

    box.innerHTML = `<div class="sides">${side('w', r.headers.White || 'Белые')}${side('b', r.headers.Black || 'Чёрные')}</div>`;
}

function render() {
    const cur = state.ply > 0 ? state.analysis?.[state.ply - 1] : null;

    renderBoard($('board'), state.fens[state.ply], {
        flipped: state.flipped,
        lastMove: state.ply > 0 ? state.ucis[state.ply - 1] : null,
        arrow: state.positions[state.ply]?.bestMove ?? null,
        badge: cur
            ? { square: state.ucis[state.ply - 1].slice(2, 4), cls: cur.classification, mark: BADGE_MARK[cur.classification] }
            : null,
    });

    $<HTMLButtonElement>('export').disabled = !state.result;
    renderEvalBar();
    renderGraph();
    renderInfo();
    markCurrentMove();
}

function setPly(p: number) {
    state.ply = Math.max(0, Math.min(state.fens.length - 1, p));
    render();
}

function setStatus(text: string, error = false) {
    const el = $('status');
    el.textContent = text;
    el.classList.toggle('error', error);
}

function setRunning(running: boolean) {
    $('analyze').textContent = running ? 'Остановить' : 'Анализировать';
    $('progress').hidden = !running;
}

$('analyze').addEventListener('click', () => {
    if (job) {
        stopTimer();
        job.cancel();
        job = null;
        setRunning(false);
        setStatus('Анализ остановлен');
        return;
    }

    try {
        loadGame(pgn.value);
    } catch (e) {
        setStatus(e instanceof Error ? e.message : 'Некорректный PGN', true);
        return;
    }

    progressText = 'Запускаем движок…';
    $<HTMLProgressElement>('progress').value = 0;
    startTimer();
    setRunning(true);
    renderMoves();
    renderSummary();

    const finishJob = () => {
        job = null;
        setRunning(false);
    };

    const start = getMode() === 'local' ? startLocalAnalysis : startAnalysis;

    job = start(pgn.value, Number($<HTMLSelectElement>('depth').value), {
        onProgress(done, total, index, ev) {
            state.positions[index] = ev;
            const bar = $<HTMLProgressElement>('progress');
            bar.max = total;
            bar.value = done;
            progressText = `Позиция ${done} из ${total}`;
            render();
        },

        onResult(r) {
            const ms = stopTimer();
            state.elapsedMs = ms;
            state.result = r;
            state.analysis = r.moves;
            state.positions = r.positions;
            finishJob();
            setStatus(`Готово, глубина ${r.depth} · ${formatDuration(ms)}`);
            renderMoves();
            renderSummary();
            render();
        },

        onError(message) {
            stopTimer();
            finishJob();
            setStatus(message, true);
        },
    });

    render();
});

$('first').onclick = () => setPly(0);
$('prev').onclick = () => setPly(state.ply - 1);
$('next').onclick = () => setPly(state.ply + 1);
$('last').onclick = () => setPly(state.fens.length - 1);
$('flip').onclick = () => ((state.flipped = !state.flipped), render());

$('moves').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('.mv');
    if (b) setPly(Number(b.dataset.ply));
});

const graph = $('graph');
let scrubbing = false;

const plyFromX = (clientX: number) => {
    const r = graph.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    return Math.round(t * (state.fens.length - 1));
};

graph.addEventListener('pointerdown', (e) => {
    scrubbing = true;
    graph.setPointerCapture(e.pointerId);
    setPly(plyFromX(e.clientX));
});

graph.addEventListener('pointermove', (e) => {
    if (!scrubbing) return;
    const p = plyFromX(e.clientX);
    if (p !== state.ply) setPly(p);
});

const stopScrub = (e: PointerEvent) => {
    scrubbing = false;
    if (graph.hasPointerCapture(e.pointerId)) graph.releasePointerCapture(e.pointerId);
};

graph.addEventListener('pointerup', stopScrub);
graph.addEventListener('pointercancel', stopScrub);

document.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).matches('textarea, select')) return;
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (keys.includes(e.key)) e.preventDefault();

    switch (e.key) {
        case 'ArrowLeft':
            setPly(state.ply - 1); break;
        case 'ArrowRight':
            setPly(state.ply + 1); break;
        case 'Home':
            setPly(0); break;
        case 'End':
            setPly(state.fens.length - 1); break;
        case 'f':
            $('flip').click(); break;
    }
});

const pgn = $<HTMLTextAreaElement>('pgn');
const copy_pgn = $<HTMLButtonElement>('copy_pgn');
const clear_pgn = $<HTMLButtonElement>('clear_pgn');

copy_pgn.addEventListener("click", () => {
    navigator.clipboard.writeText(pgn.value);
    copy_pgn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" height="24px" width="24px" fill="#e3e3e3"><path d="M9.55,18l-5.7-5.7l1.43-1.42l4.28,4.28l9.18-9.18L20.15,7.4L9.55,18Z"/></svg>`;

    setTimeout(() => {
        copy_pgn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" height="24px" width="24px" fill="#e3e3e3"><path d="M9,18q-0.82,0-1.41-0.59T7,16V4Q7,3.17 7.59,2.59T9,2h9q0.82,0 1.41,0.59T20,4V16q0,0.82-0.59,1.41T18,18H9Zm0-2h9V4H9V16ZM5,22q-0.83,0-1.41-0.59T3,20V6H5V20H16v2H5Zm4-6V4V16Z"/></svg>`;
    }, 1000);
});

clear_pgn.addEventListener("click", () => {
    pgn.value = "";
});

const modeSel = $<HTMLSelectElement>('mode');
const serverField = $('server_field');
const serverInput = $<HTMLInputElement>('server');

modeSel.value = getMode();
serverInput.value = getServer();

const syncMode = () => { serverField.style.display = modeSel.value === 'server' ? '' : 'none'; };

syncMode();
modeSel.addEventListener('change', () => { setMode(modeSel.value as Mode); syncMode(); });
serverInput.addEventListener('change', () => setServer(serverInput.value));

$('export').addEventListener('click', async () => {
    if (!state.result)
        return;

    try {
        await saveFile(exportFileName(state.result), JSON.stringify(buildExport(state.pgn, state.result, state.elapsedMs ?? undefined)));
        setStatus('Анализ экспортирован');
    } catch (e) {
        if (!(e instanceof Error && /cancel/i.test(e.message)))
            setStatus('Не удалось сохранить файл', true);
    }
});

$('import').addEventListener('click', () => $<HTMLInputElement>('import_file').click());

$<HTMLInputElement>('import_file').addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file)
        return;

    try {
        const text = await file.text();
        input.value = ''; // чтобы можно было выбрать тот же файл повторно
        const data = parseImport(text);

        job?.cancel();
        job = null;
        setRunning(false);

        loadGame(data.pgn);
        const r = data.result;
        if (r.positions.length !== state.fens.length || r.moves.length !== state.sans.length)
            throw new Error('Анализ не соответствует партии');

        state.result = r;
        state.analysis = r.moves;
        state.positions = r.positions;
        $<HTMLTextAreaElement>('pgn').value = data.pgn;
        renderMoves();
        renderSummary();
        render();
        setStatus(`Импортировано, глубина ${r.depth}`);
    } catch (err) {
        input.value = '';
        setStatus(err instanceof Error ? err.message : 'Не удалось прочитать файл', true);
    }
});

render();