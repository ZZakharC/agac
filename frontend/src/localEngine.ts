// Stockfish (WASM, single-thread) в Web Worker. Говорит по UCI через postMessage.
const ENGINE_URL = `${import.meta.env.BASE_URL}stockfish/stockfish-19-lite-single.js`;

export interface LocalLine {
    depth: number;
    cp?: number;
    mate?: number;
    pv: string[];
}

export interface LocalResult {
    bestMove: string | null;
    line: LocalLine | null;
}

function parseInfo(line: string): LocalLine | null {
    if (line.includes('lowerbound') || line.includes('upperbound'))
        return null;

    const t = line.split(' ');
    const pvIdx = t.indexOf('pv');
    const scoreIdx = t.indexOf('score');

    if (pvIdx < 0 || scoreIdx < 0)
        return null;

    const di = t.indexOf('depth');
    const kind = t[scoreIdx + 1];
    const value = Number(t[scoreIdx + 2]);

    return {
        depth: di >= 0 ? Number(t[di + 1]) : 0,
        cp: kind === 'cp' ? value : undefined,
        mate: kind === 'mate' ? value : undefined,
        pv: t.slice(pvIdx + 1),
    };
}

export class LocalEngine {
    private worker: Worker | null = null;
    private listeners = new Set<(line: string) => void>();
    private failListeners = new Set<(err: Error) => void>();

    async start(): Promise<void> {
        const worker = new Worker(ENGINE_URL);
        this.worker = worker;

        worker.onmessage = (e: MessageEvent) => {
            for (const raw of String(e.data).split('\n')) {
                const line = raw.trim();
                if (line)
                    for (const fn of [...this.listeners])
                        fn(line);
            }
        };

        worker.onerror = () => this.fail(new Error('Не удалось запустить движок (файлы stockfish не найдены?)'));

        this.send('uci');
        await this.waitFor((l) => l === 'uciok', 30_000);
        this.send('setoption name Hash value 16');
        this.send('isready');
        await this.waitFor((l) => l === 'readyok', 30_000);
    }

    async analyse(fen: string, depth: number): Promise<LocalResult> {
        let top = null as LocalLine | null;
        this.send(`position fen ${fen}`);
        this.send(`go depth ${depth}`);

        const last = await this.waitFor((line) => {
            if (line.startsWith('info')) {
                const p = parseInfo(line);

                if (p)
                    top = p;

                return false;
            }
            return line.startsWith('bestmove');
        });

        const best = last.split(' ')[1];

        return { bestMove: best && best !== '(none)' ? best : null, line: top };
    }

    terminate(): void {
        if (!this.worker) return;
        this.worker.terminate();
        this.worker = null;
        this.fail(new Error('Остановлено'));
    }

    private send(cmd: string): void {
        this.worker?.postMessage(cmd);
    }

    private fail(err: Error): void {
        for (const fn of [...this.failListeners])
            fn(err);
    }

    private waitFor(pred: (line: string) => boolean, timeoutMs?: number): Promise<string> {
        return new Promise((resolve, reject) => {
            const timer = timeoutMs
                ? setTimeout(() => (cleanup(), reject(new Error('Движок не отвечает'))), timeoutMs)
                : undefined;

            const cleanup = () => {
                clearTimeout(timer);
                this.listeners.delete(onLine);
                this.failListeners.delete(onFail);
            };

            const onLine = (line: string) => {
                if (pred(line)) (cleanup(), resolve(line));
            };

            const onFail = (err: Error) => (cleanup(), reject(err));

            this.listeners.add(onLine);
            this.failListeners.add(onFail);
        });
    }
}