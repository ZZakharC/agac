import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { analysisRouter } from './routes/analysis.js';
import { attachAnalysisSocket } from './websocket/analysis.js';
import { STOCKFISH_HASH, STOCKFISH_PATH, STOCKFISH_THREADS } from './services/AnalysisService.js';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? 'localhost';
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
    console.log(`\n\x1b[1mAPI server running:\n\x1b[0m`);
    console.log(`  \x1b[1;32m->\x1b[0m  Local:   http://\x1b[1mlocalhost:${PORT}\x1b[0m/api`);
    console.log(`  \x1b[1;32m->\x1b[0m  WebSocket: ws://\x1b[1mlocalhost:${PORT}\x1b[0m/ws/analysis\n`);

    if (HOST === '0.0.0.0' || HOST === '::') {
        for (const [name, addresses] of Object.entries(networkInterfaces()))
            for (const address of addresses ?? [])
                if (address.family === 'IPv4' && !address.internal)
                    console.log(`  \x1b[1;34m->\x1b[0m  Network: <http/ws>://\x1b[1m${address.address}:${PORT}\x1b[0m/<api/ws>\t\x1b[30m${name}\x1b[0m`);

        console.log();
    }

    console.log(`\x1b[1mStockfish\x1b[0m: ${STOCKFISH_PATH} \x1b[30mT: ${STOCKFISH_THREADS} H: ${STOCKFISH_HASH}\n\x1b[0m`);
});