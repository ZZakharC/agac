import type { MoveClass, PositionEval } from './types';

export const winPercent = (cp: number) => {
    const c = Math.max(-1000, Math.min(1000, cp));
    return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1);
};

export function formatEval(ev?: PositionEval | null): string {
    if (!ev)
        return '…';
    if (ev.mate === 0)
        return ev.cp > 0 ? '1-0' : '0-1';
    if (ev.mate !== null)
        return `${ev.mate > 0 ? '+' : '-'}M${Math.abs(ev.mate)}`;

    const v = ev.cp / 100;

    return `${v > 0 ? '+' : v < 0 ? '-' : ''}${Math.abs(v).toFixed(1)}`;
}

export const CLASS_LABEL: Record<MoveClass, string> = {
    brilliant: 'Блестящий ход',
    best: 'Лучший ход',
    excellent: 'Отличный ход',
    good: 'Хороший ход',
    inaccuracy: 'Неточность',
    mistake: 'Ошибка',
    miss: 'Упущенная возможность',
    blunder: 'Грубая ошибка',
};

export const CLASS_MARK: Partial<Record<MoveClass, string>> = {
    brilliant: '!!',
    inaccuracy: '?!',
    mistake: '?',
    miss: '✗',
    blunder: '??',
};

export const BADGE_MARK: Record<MoveClass, string> = {
    brilliant: '!!',
    best: '★',
    excellent: '!',
    good: '✓',
    inaccuracy: '?!',
    mistake: '?',
    miss: '✗',
    blunder: '??',
};

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);