// Копирует WASM-движок из node_modules в public/, чтобы Vite отдавал его как есть
// (.js и .wasm должны лежать рядом и под своими именами).
import { cpSync, mkdirSync } from 'node:fs';

const files = ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm'];
mkdirSync('public/stockfish', { recursive: true });
for (const f of files) cpSync(`node_modules/stockfish/bin/${f}`, `public/stockfish/${f}`);
console.log('Stockfish WASM скопирован в public/stockfish');
