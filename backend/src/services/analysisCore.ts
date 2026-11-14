import { Chess, type Move } from 'chess.js';

export const MATE_CP = 10_000;

const MAX_CP_LOSS = 1_000;

const WIN_PERCENT_FACTOR = 0.00368208;

// Пороги по потере шансов на победу 
const LOSS_THRESHOLDS = { excellent: 2, good: 5, inaccuracy: 10, mistake: 15 } as const;

const MISS_MIN_OPPONENT_LOSS = 10; // соперник перед этим потерял >=10% шансов
const MISS_MIN_WIN_BEFORE = 60;    // у нас был явный перевес
const MISS_MIN_WIN_AFTER = 40;     // позиция не проиграна, иначе это зевок
const MISSED_MATE_MAX_MOVES = 10;
const MISSED_MATE_MIN_SLOWDOWN = 1;

const BRILLIANT_MAX_LOSS = 2;
const BRILLIANT_MAX_WIN_BEFORE = 90; // уже полностью выигранную позицию не считаем
const BRILLIANT_MIN_WIN_AFTER = 40;
const BRILLIANT_MIN_MATERIAL_LOSS = 2;

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export type MoveClass = 'brilliant' | 'best' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'miss' | 'blunder';

// Оценка позиции с точки зрения белых
export interface PositionEval {
    cp: number;
    mate: number | null;
    bestMove: string | null;
    pv: string[];
}

export interface MoveAnalysis {
    ply: number;
    color: 'w' | 'b';
    san: string;
    uci: string;
    bestMoveSan: string | null;
    loss: number;
    cpLoss: number;
    accuracy: number;
    classification: MoveClass;
}

export interface SideSummary {
    accuracy: number;
    acpl: number;
    counts: Record<MoveClass, number>;
}

export interface AnalysisResult {
    headers: Record<string, string | null>;
    depth: number;
    positions: PositionEval[];
    moves: MoveAnalysis[];
    summary: {
        w: SideSummary;
        b: SideSummary;
    };
}

// ============================================================
// Math
// ============================================================

const clamp = (
    value: number,
    min: number,
    max: number,
): number => Math.max(min, Math.min(max, value));

// Преобразует оценку в сантипешках в эвристическую вероятность победы
export function winPercent(cp: number): number {
    const value = clamp(cp, -1000, 1000);

    return 100 / (
        1 + Math.exp(-WIN_PERCENT_FACTOR * value)
    );
}

// Преобразует расстояние до мата в оценку, аналогичную оценке в сантипешках
export function mateToCp(mate: number): number {
    if (mate === 0) return 0;

    const distance = Math.abs(mate);

    const value = Math.max(
        1,
        MATE_CP - distance * 10,
    );

    return Math.sign(mate) * value;
}

// Возвращает оценку с точки зрения запрашиваемого игрока
function scoreForColor(position: PositionEval, fen: string, color: 'w' | 'b'): number {
    let whiteScore: number;

    if (position.mate === 0) {
        const sideToMove = fen.split(' ')[1] === 'b' ? 'b' : 'w';
        const winner = sideToMove === 'w' ? 'b' : 'w';

        whiteScore = winner === 'w' ? MATE_CP : -MATE_CP;
    } else if (position.mate !== null)
        whiteScore = mateToCp(position.mate);
    else
        whiteScore = position.cp;

    return color === 'w' ? whiteScore : -whiteScore;
}

// ============================================================
// Accuracy
// ============================================================

// Оценивает точность хода на основе потери вероятности выигрыша. 
function accuracyFromLoss(loss: number): number {
    const accuracy =
        103.1668 * Math.exp(-0.04354 * Math.max(0, loss))
        - 3.1669;

    return clamp(accuracy, 0, 100);
}

// ============================================================
// UCI / SAN
// ============================================================

function normalizeUci(uci: string | null): string | null {
    if (!uci) return null;

    const value = uci.trim().toLowerCase();

    return /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(value)
        ? value
        : null;
}

// Преобразует principal variation из формата UCI в формат SAN.
export function uciLineToSan(fen: string, uci: string[], limit = 6): string[] {
    const out: string[] = [];

    try {
        const chess = new Chess(fen);

        for (const raw of uci.slice(0, limit)) {
            const move = normalizeUci(raw);

            if (!move) break;

            try {
                const result = chess.move({
                    from: move.slice(0, 2),
                    to: move.slice(2, 4),
                    promotion: move[4] as 'q' | 'r' | 'b' | 'n' | undefined,
                });

                out.push(result.san);
            } catch {
                break;
            }
        }
    } catch {
        return [];
    }

    return out;
}

// ============================================================
// Material evaluation
// ============================================================

// Баланс материала с точки зрения выбранного игрока
function materialDiff(fen: string, color: 'w' | 'b'): number {
    let white = 0;
    let black = 0;

    const board = fen.split(' ')[0];

    for (const ch of board) {
        const value = VALUE[ch.toLowerCase()];

        if (value === undefined) continue;

        if (ch === ch.toUpperCase())
            white += value;
        else
            black += value;
    }

    return color === 'w' ? white - black : black - white;
}

// Проверяет, является ли ход жертвой материала
function isSacrifice(move: Move, afterEval: PositionEval): boolean {
    if (afterEval.pv.length < 2) return false;

    const initialMaterial = materialDiff(move.before, move.color);

    try {
        const chess = new Chess(move.after);

        chess.move(afterEval.pv[0]);
        chess.move(afterEval.pv[1]);

        const resultingMaterial = materialDiff(chess.fen(), move.color);

        return (
            initialMaterial - resultingMaterial
            >= BRILLIANT_MIN_MATERIAL_LOSS
        );
    } catch {
        return false;
    }
}

// ============================================================
// Move classification
// ============================================================

interface ClassifyInput {
    loss: number;
    isBest: boolean;
    winBefore: number;
    winAfter: number;
    opponentLoss: number;
    brilliant: boolean;
    missedMate: boolean;
}

function classify(input: ClassifyInput): MoveClass {
    const { loss, isBest, winBefore, winAfter, opponentLoss, brilliant, missedMate } = input;

    if (brilliant) return 'brilliant';
    if (isBest) return 'best';
    if (missedMate && winAfter >= MISS_MIN_WIN_AFTER) return 'miss';
    if (loss < LOSS_THRESHOLDS.excellent) return 'excellent';
    if (loss < LOSS_THRESHOLDS.good) return 'good';
    if (loss < LOSS_THRESHOLDS.inaccuracy) return 'inaccuracy';

    if (opponentLoss >= MISS_MIN_OPPONENT_LOSS && winBefore >= MISS_MIN_WIN_BEFORE && winAfter >= MISS_MIN_WIN_AFTER)
        return 'miss';

    return loss < LOSS_THRESHOLDS.mistake ? 'mistake' : 'blunder';
}

// ============================================================
// Statistics
// ============================================================

const emptyCounts = (): Record<MoveClass, number> => ({
    brilliant: 0,
    best: 0,
    excellent: 0,
    good: 0,
    inaccuracy: 0,
    mistake: 0,
    miss: 0,
    blunder: 0,
});

function average(values: number[]): number {
    if (values.length === 0) return 0;

    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

// ============================================================
// Main analysis result builder
// ============================================================

export function buildResult(history: Move[], positions: PositionEval[], depth: number, headers: Record<string, string | null>): AnalysisResult {
    if (positions.length !== history.length + 1)
        throw new Error(
            `Invalid analysis data: expected ${history.length + 1} positions, received ${positions.length}.`,
        );

    const counts = { w: emptyCounts(), b: emptyCounts() };
    const accuracyValues = { w: [] as number[], b: [] as number[] };
    const cpLossValues = { w: [] as number[], b: [] as number[] };
    const moveLosses: number[] = [];

    const moves = history.map((move, index): MoveAnalysis => {
        const color = move.color;

        const before = positions[index];
        const after = positions[index + 1];

        const uci = (
            move.from +
            move.to +
            (move.promotion ?? '')
        ).toLowerCase();

        const bestMove = normalizeUci(before.bestMove);
        const isBest = bestMove !== null && uci === bestMove;
        const scoreBefore = scoreForColor(before, move.before, color);
        const scoreAfter = scoreForColor(after, move.after, color);

        // Изменение вероятности победы
        const winBefore = winPercent(scoreBefore);
        const winAfter = winPercent(scoreAfter);
        const sign = color === 'w' ? 1 : -1;
        const loss = isBest ? 0 : Math.max(0, winBefore - winAfter);

        // Потеря в сантипешках
        const cpLoss = isBest
            ? 0
            : clamp(
                scoreBefore - scoreAfter,
                0,
                MAX_CP_LOSS,
            );

        const sacrifice = isSacrifice(move, after);
        const opponentLoss = index > 0 ? moveLosses[index - 1] : 0;
        moveLosses.push(loss);

        const brilliant =
            sacrifice &&
            loss <= BRILLIANT_MAX_LOSS &&
            winBefore <= BRILLIANT_MAX_WIN_BEFORE &&
            winAfter >= BRILLIANT_MIN_WIN_AFTER;

        let missedMate = false;

        if (
            before.mate !== null &&
            before.mate !== 0 &&
            Math.sign(before.mate) === sign &&
            Math.abs(before.mate) <= MISSED_MATE_MAX_MOVES
        ) {
            const delivered = after.mate === 0 && scoreAfter > 0;

            const mateLeft =
                after.mate !== null && after.mate !== 0 && Math.sign(after.mate) === sign
                    ? Math.abs(after.mate)
                    : null;

            const slowdown = mateLeft === null ? Infinity : mateLeft - (Math.abs(before.mate) - 1);

            missedMate = !delivered && slowdown >= MISSED_MATE_MIN_SLOWDOWN;
        }

        const classification = classify({ loss, isBest, winBefore, winAfter, opponentLoss, brilliant, missedMate });
        const accuracy = accuracyFromLoss(loss);

        counts[color][classification]++;

        accuracyValues[color].push(accuracy);
        cpLossValues[color].push(cpLoss);

        const bestMoveSan = bestMove
            ? (
                uciLineToSan(
                    move.before,
                    [bestMove],
                    1,
                )[0] ?? null
            )
            : null;

        return {
            ply: index + 1,
            color,
            san: move.san,
            uci,
            bestMoveSan,
            loss,
            cpLoss,
            accuracy,
            classification,
        };
    });

    // ========================================================
    // Side summaries
    // ========================================================

    const side = (color: 'w' | 'b'): SideSummary => {
        const acpl = average(cpLossValues[color]);

        return {
            accuracy: average(accuracyValues[color]),
            acpl,
            counts: counts[color],
        };
    };

    return {
        headers,
        depth,
        positions,
        moves,

        summary: {
            w: side('w'),
            b: side('b'),
        },
    };
}
