// Анализ партии целиком на устройстве (без сервера).
import { Chess } from 'chess.js';
import type { Handlers } from './api';
import { MATE_CP, buildResult, mateToCp, uciLineToSan, type PositionEval } from './analysisCore';
import { LocalEngine } from './localEngine';

async function evaluate(engine: LocalEngine, fen: string, depth: number): Promise<PositionEval> {
    const chess = new Chess(fen);
    if (chess.isCheckmate())
        return { cp: chess.turn() === 'w' ? -MATE_CP : MATE_CP, mate: 0, bestMove: null, pv: [] };
    if (chess.isGameOver())
        return { cp: 0, mate: null, bestMove: null, pv: [] };

    const { bestMove, line } = await engine.analyse(fen, depth);
    const sign = chess.turn() === 'w' ? 1 : -1;
    const isMate = line?.mate !== undefined;

    return {
        cp: isMate ? mateToCp(line!.mate!) * sign : (line?.cp ?? 0) * sign,
        mate: isMate ? line!.mate! * sign : null,
        bestMove,
        pv: line ? uciLineToSan(fen, line.pv) : [],
    };
}

export function startLocalAnalysis(pgn: string, depth: number, h: Handlers) {
    let cancelled = false;
    const engine = new LocalEngine();

    void (async () => {
        const game = new Chess();

        try {
            game.loadPgn(pgn);
        } catch (e) {
            h.onError(`Некорректный PGN: ${e instanceof Error ? e.message : e}`);
            return;
        }

        const history = game.history({ verbose: true });

        if (!history.length) {
            h.onError('В PGN нет ходов');
            return;
        }

        const fens = [history[0].before, ...history.map((m) => m.after)];

        try {
            await engine.start();
            const positions: PositionEval[] = [];

            for (let i = 0; i < fens.length; i++) {
                if (cancelled)
                    return;

                const ev = await evaluate(engine, fens[i], depth);

                if (cancelled)
                    return;

                positions.push(ev);
                h.onProgress(i + 1, fens.length, i, ev);
            }

            h.onResult(buildResult(history, positions, depth, game.header()));
        } catch (e) {
            if (!cancelled)
                h.onError(e instanceof Error ? e.message : 'Ошибка движка');
        } finally {
            engine.terminate();
        }
    })();

    return {
        cancel() {
            cancelled = true;
            engine.terminate();
        },
    };
}