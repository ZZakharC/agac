import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync, statSync } from 'node:fs';

export interface EngineLine {
    multipv: number;
    depth: number;
    cp?: number; // со стороны игрока, чей ход
    mate?: number; // со стороны игрока, чей ход
    pv: string[]; // UCI
}
export interface EngineResult {
    bestMove: string | null;
    lines: EngineLine[];
}
export interface AnalyseOptions {
    depth?: number;
    movetime?: number;
    multiPv?: number;
    moves?: string[];
}
export interface EngineConfig {
    path: string;
    threads?: number;
    hash?: number;
}

type LineListener = (line: string) => void;

function parseInfo(line: string): EngineLine | null {
    if (line.includes('lowerbound') || line.includes('upperbound')) return null;
    const t = line.split(' ');
    const pvIdx = t.indexOf('pv');
    const scoreIdx = t.indexOf('score');
    if (pvIdx < 0 || scoreIdx < 0) return null;
    const num = (key: string) => {
        const i = t.indexOf(key);
        return i >= 0 ? Number(t[i + 1]) : undefined;
    };
    const kind = t[scoreIdx + 1];
    const value = Number(t[scoreIdx + 2]);
    return {
        multipv: num('multipv') ?? 1,
        depth: num('depth') ?? 0,
        cp: kind === 'cp' ? value : undefined,
        mate: kind === 'mate' ? value : undefined,
        pv: t.slice(pvIdx + 1),
    };
}

/** Тонкая обёртка над UCI-процессом Stockfish. */
export class Stockfish {
    private proc: ChildProcessWithoutNullStreams | null = null;
    private listeners = new Set<LineListener>();
    private failListeners = new Set<(err: Error) => void>();
    private queue: Promise<unknown> = Promise.resolve();
    private closing = false;
    private config: EngineConfig
    
    constructor(config: EngineConfig) {
        this.config = config;
    }

    async start(): Promise<void> {
        const { path, threads = 16, hash = 64 } = this.config;
        if (!existsSync(path)) throw new Error(`Stockfish не найден: ${path}`);
        if (statSync(path).isDirectory())
            throw new Error(`${path} — папка. Укажите путь к исполняемому файлу (STOCKFISH_PATH).`);

        const proc = spawn(path, [], { stdio: ['pipe', 'pipe', 'pipe'] });
        this.proc = proc;
        createInterface({ input: proc.stdout }).on('line', (line) => {
            for (const fn of [...this.listeners]) fn(line);
        });
        const fail = (err: Error) => {
            for (const fn of [...this.failListeners]) fn(err);
        };
        proc.on('error', fail);
        proc.on('exit', (code) => {
            if (!this.closing) fail(new Error(`Stockfish завершился (code ${code})`));
        });
        proc.stdin.on('error', () => { });

        this.send('uci');
        await this.waitFor((l) => l === 'uciok');
        this.send(`setoption name Threads value ${threads}`);
        this.send(`setoption name Hash value ${hash}`);
        this.send('isready');
        await this.waitFor((l) => l === 'readyok');
    }

    /** Запросы выполняются строго по очереди: UCI не умеет считать две позиции сразу. */
    analyse(fen: string, opts: AnalyseOptions = {}): Promise<EngineResult> {
        const run = () => this.runAnalysis(fen, opts);
        const p = this.queue.then(run, run);
        this.queue = p.catch(() => { });
        return p;
    }

    stop(): void {
        this.send('stop');
    }

    async quit(): Promise<void> {
        if (!this.proc || this.closing) return;
        this.closing = true;
        this.send('quit');
        const proc = this.proc;
        setTimeout(() => proc.kill(), 500).unref();
    }

    private async runAnalysis(fen: string, opts: AnalyseOptions): Promise<EngineResult> {
        const { depth = 18, movetime, multiPv = 1 } = opts;
        const lines = new Map<number, EngineLine>();
        const { moves } = opts;
        this.send(`setoption name MultiPV value ${multiPv}`);
        this.send(moves?.length ? `position fen ${fen} moves ${moves.join(' ')}` : `position fen ${fen}`);
        this.send(movetime ? `go movetime ${movetime}` : `go depth ${depth}`);

        const last = await this.waitFor((line) => {
            if (line.startsWith('info')) {
                const p = parseInfo(line);
                if (p) lines.set(p.multipv, p);
                return false;
            }
            return line.startsWith('bestmove');
        });
        const best = last.split(' ')[1];
        return {
            bestMove: best && best !== '(none)' ? best : null,
            lines: [...lines.values()].sort((a, b) => a.multipv - b.multipv),
        };
    }

    private send(cmd: string): void {
        this.proc?.stdin.write(cmd + '\n');
    }

    private waitFor(pred: (line: string) => boolean): Promise<string> {
        return new Promise((resolve, reject) => {
            const cleanup = () => {
                this.listeners.delete(onLine);
                this.failListeners.delete(onFail);
            };
            const onLine = (line: string) => {
                if (pred(line)) {
                    cleanup();
                    resolve(line);
                }
            };
            const onFail = (err: Error) => {
                cleanup();
                reject(err);
            };
            this.listeners.add(onLine);
            this.failListeners.add(onFail);
        });
    }
}