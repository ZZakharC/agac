import { Router } from 'express';
import { AnalysisService, InvalidPgnError } from '../services/AnalysisService.js';

export const analysisRouter = Router();
const service = new AnalysisService();

analysisRouter.get('/health', (_req, res) => {
    res.json({ ok: true });
});

// Простой синхронный вариант (без прогресса). Для UI лучше WebSocket.
analysisRouter.post('/analysis', async (req, res, next) => {
    const { pgn, depth } = req.body ?? {};
    if (typeof pgn !== 'string' || !pgn.trim()) {
        res.status(400).json({ error: 'Поле pgn обязательно' });
        return;
    }
    const ac = new AbortController();
    res.on('close', () => {
        if (!res.writableEnded) ac.abort();
    });
    try {
        res.json(await service.analyzePgn(pgn, { depth: Number(depth) || undefined, signal: ac.signal }));
    } catch (e) {
        if (e instanceof InvalidPgnError) {
            res.status(400).json({ error: e.message });
            return;
        }
        next(e);
    }
});