import { Chess } from 'chess.js';

const PIECES: Record<string, string> = { k: 'K', q: 'Q', r: 'R', b: 'B', n: 'N', p: 'P' };
const FILES = 'abcdefgh';

export interface BoardOptions {
    flipped: boolean;
    lastMove?: string | null; // UCI
    arrow?: string | null; // UCI
    badge?: { square: string; cls: string; mark: string } | null;
}

function center(sq: string, flipped: boolean) {
    const f = FILES.indexOf(sq[0]);
    const r = Number(sq[1]) - 1;
    return { x: (flipped ? 7 - f : f) + 0.5, y: (flipped ? r : 7 - r) + 0.5 };
}

export function renderBoard(el: HTMLElement, fen: string, o: BoardOptions): void {
    const board = new Chess(fen).board();
    const last = o.lastMove ? [o.lastMove.slice(0, 2), o.lastMove.slice(2, 4)] : [];
    let html = '';

    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            const row = o.flipped ? 7 - y : y;
            const col = o.flipped ? 7 - x : x;
            const sq = FILES[col] + (8 - row);
            const p = board[row][col];
            const cls = ['sq', (row + col) % 2 ? 'dark' : 'light', last.includes(sq) ? 'last' : ''].join(' ');

            html += `<div class="${cls}">`;

            if (x === 0)
                html += `<i class="co r">${8 - row}</i>`;
            if (y === 7)
                html += `<i class="co f">${FILES[col]}</i>`;
            if (p) {
                const color = p.color === 'w' ? 'w' : 'b';
                const piece = PIECES[p.type];

                html += `
                <img
                    class="pc ${color}"
                    src="/pieces/${color}${piece}.svg"
                    alt=""
                    draggable="false"
                >`;
            }
            if (o.badge && o.badge.square === sq)
                html += `<b class="badge ${o.badge.cls}">${o.badge.mark}</b>`;

            html += '</div>';
        }
    }

    if (o.arrow) {
        const a = center(o.arrow.slice(0, 2), o.flipped);
        const b = center(o.arrow.slice(2, 4), o.flipped);
        html += `<svg class="arrow" viewBox="0 0 8 8"><defs><marker id="ah" markerWidth="4" markerHeight="4" refX="2.6" refY="2" orient="auto"><path d="M0 0L4 2L0 4z"/></marker></defs><line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" marker-end="url(#ah)"/></svg>`;
    }
    el.innerHTML = html;
}