import path from 'node:path';
import { Chess } from 'chess.js';
import { Stockfish } from '../engine/Stockfish.js';
import {
    MATE_CP,
    buildResult,
    mateToCp,
    uciLineToSan,
    type AnalysisResult,
    type PositionEval,
} from './analysisCore.js';

export type { AnalysisResult, MoveAnalysis, MoveClass, PositionEval, SideSummary } from './analysisCore.js';

export const STOCKFISH_PATH = process.env.STOCKFISH_PATH ?? path.resolve('engines/stockfish');
export const STOCKFISH_THREADS = Number(process.env.STOCKFISH_THREADS ?? 4);
export const STOCKFISH_HASH = Number(process.env.STOCKFISH_HASH ?? 256);

export interface ProgressInfo {
    done: number;
    total: number;
    index: number;
    evaluation: PositionEval;
}

export interface AnalyzeOptions {
    depth?: number;
    signal?: AbortSignal;
    onProgress?: (p: ProgressInfo) => void;
}

export class InvalidPgnError extends Error { }

export class AnalysisService {
    async analyzePgn(pgn: string, opts: AnalyzeOptions = {}): Promise<AnalysisResult> {
        const depth = Math.max(1, Math.min(24, Math.round(opts.depth ?? 16)));

        const game = new Chess();

        try {
            game.loadPgn(pgn);
        } catch (e) {
            throw new InvalidPgnError(`Некорректный PGN: ${e instanceof Error ? e.message : e}`);
        }

        const history = game.history({ verbose: true });
        if (!history.length) throw new InvalidPgnError('В PGN нет ходов');

        const fens = [history[0].before, ...history.map((m) => m.after)];

        const engine = new Stockfish({
            path: STOCKFISH_PATH,
            threads: STOCKFISH_THREADS,
            hash: STOCKFISH_HASH,
        });

        opts.signal?.addEventListener('abort', () => void engine.quit(), { once: true });
        await engine.start();

        try {
            const positions: PositionEval[] = [];
            const startFen = history[0].before;
            const uciMoves = history.map((m) => m.from + m.to + (m.promotion ?? ''));

            for (let i = 0; i < fens.length; i++) {
                opts.signal?.throwIfAborted();

                const evaluation = await this.evaluate(engine, fens[i], depth, {
                    startFen,
                    moves: uciMoves.slice(0, i),
                });

                positions.push(evaluation);
                opts.onProgress?.({ done: i + 1, total: fens.length, index: i, evaluation });
            }
            return buildResult(history, positions, depth, game.header());
        } finally {
            await engine.quit();
        }
    }

    private async evaluate(engine: Stockfish, fen: string, depth: number, history?: { startFen: string; moves: string[] }): Promise<PositionEval> {
        const chess = new Chess(fen);
        if (chess.isCheckmate())
            return { cp: chess.turn() === 'w' ? -MATE_CP : MATE_CP, mate: 0, bestMove: null, pv: [] };
        if (chess.isGameOver())
            return { cp: 0, mate: null, bestMove: null, pv: [] };

        const { lines, bestMove } = await engine.analyse(history?.startFen ?? fen, {
            depth,
            moves: history?.moves,
        });

        const top = lines[0];
        const sign = chess.turn() === 'w' ? 1 : -1;
        const isMate = top?.mate !== undefined;

        return {
            cp: isMate ? mateToCp(top.mate!) * sign : (top?.cp ?? 0) * sign,
            mate: isMate ? top.mate! * sign : null,
            bestMove,
            pv: top ? uciLineToSan(fen, top.pv) : [],
        };
    }
}