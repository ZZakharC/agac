// Типы результата живут в analysisCore.ts
import type { AnalysisResult, PositionEval } from './analysisCore';

export type { AnalysisResult, MoveAnalysis, MoveClass, PositionEval, SideSummary } from './analysisCore';

export type ServerMessage =
    { type: 'progress'; done: number; total: number; index: number; evaluation: PositionEval }
    | { type: 'result'; result: AnalysisResult }
    | { type: 'error'; message: string }
    | { type: 'cancelled' };