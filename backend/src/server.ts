import { createServer } from 'node:http';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { analysisRouter } from './routes/analysis.js';
import { attachAnalysisSocket } from './websocket/analysis.js';
import { STOCKFISH_HASH, STOCKFISH_PATH, STOCKFISH_THREADS } from './services/AnalysisService.js';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "localhost";
const origins = process.env.CORS_ORIGIN?.split(',').map((s) => s.trim());

const app = express();

app.use(cors({ origin: origins ?? true }));
app.use(express.json({ limit: '1mb' }));
app.use('/api', analysisRouter);
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: err.message });
});

const server = createServer(app);
attachAnalysisSocket(server);

server.listen(PORT, HOST, () => {
    console.log(`API:       http://${HOST}:${PORT}/api`);
    console.log(`WebSocket: ws://${HOST}:${PORT}/ws/analysis`);
    console.log(`Stockfish: ${STOCKFISH_PATH} T: ${STOCKFISH_THREADS} H: ${STOCKFISH_HASH}`);
});