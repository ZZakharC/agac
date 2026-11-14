import type { Server } from 'node:http';
import { WebSocketServer } from 'ws';
import { AnalysisService } from '../services/AnalysisService.js';

const service = new AnalysisService();

export function attachAnalysisSocket(server: Server): void {
    const wss = new WebSocketServer({ server, path: '/ws/analysis' });

    wss.on('connection', (ws) => {
        let controller: AbortController | null = null;
        const send = (msg: unknown) => {
            if (ws.readyState === ws.OPEN)
                ws.send(JSON.stringify(msg));
        };

        ws.on('message', async (raw) => {
            let msg: { type?: string; pgn?: unknown; depth?: unknown };

            try {
                msg = JSON.parse(raw.toString());
            } catch {
                return send({ type: 'error', message: 'Некорректный JSON' });
            }

            if (msg.type === 'cancel')
                return controller?.abort();
            if (msg.type !== 'analyze')
                return;
            if (controller)
                return send({ type: 'error', message: 'Анализ уже идёт' });
            if (typeof msg.pgn !== 'string' || !msg.pgn.trim())
                return send({ type: 'error', message: 'Поле pgn обязательно' });

            const ctrl = (controller = new AbortController());

            try {
                const result = await service.analyzePgn(msg.pgn, {
                    depth: Number(msg.depth) || undefined,
                    signal: ctrl.signal,
                    onProgress: (p) => send({ type: 'progress', ...p }),
                });
                send({ type: 'result', result });
            } catch (e) {
                if (ctrl.signal.aborted)
                    send({ type: 'cancelled' });
                else
                    send({ type: 'error', message: e instanceof Error ? e.message : 'Ошибка анализа' });
            } finally {
                controller = null;
            }
        });

        ws.on('close', () => controller?.abort());
    });
}