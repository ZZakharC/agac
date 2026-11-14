import { Capacitor } from '@capacitor/core';
import type { AnalysisResult, PositionEval, ServerMessage } from './types';

const DEFAULT_WS = (import.meta.env.VITE_WS_URL as string | undefined) ?? 'ws://localhost:3000/ws/analysis';
const KEY = 'serverUrl';
const CONNECT_TIMEOUT_MS = 8000;

export type Mode = 'local' | 'server';

export const getMode = (): Mode => {
    try {
        const v = localStorage.getItem('mode');
        if (v === 'local' || v === 'server') return v;
    } catch { }

    return Capacitor.isNativePlatform() ? 'local' : 'server';
};

export const setMode = (m: Mode): void => {
    try {
        localStorage.setItem('mode', m);
    } catch { }
};

export const getServer = (): string => {
    try {
        return localStorage.getItem(KEY) ?? '';
    } catch {
        return '';
    }
};

export const setServer = (v: string): void => {
    try {
        localStorage.setItem(KEY, v.trim());
    } catch { }
};

function wsUrl(): string {
    const raw = getServer().trim();
    if (!raw) return DEFAULT_WS;
    let u = raw.replace(/^http/i, 'ws').replace(/\/+$/, '');
    if (!/^wss?:\/\//i.test(u)) u = `ws://${u}`;
    return u.endsWith('/ws/analysis') ? u : `${u}/ws/analysis`;
}

export interface Handlers {
    onProgress(done: number, total: number, index: number, ev: PositionEval): void;
    onResult(r: AnalysisResult): void;
    onError(message: string): void;
}

export function startAnalysis(pgn: string, depth: number, h: Handlers) {
    if (Capacitor.isNativePlatform() && !getServer()) {
        queueMicrotask(() => h.onError('Укажите адрес сервера: IP компьютера и порт'));
        return { cancel() { } };
    }

    const ws = new WebSocket(wsUrl());
    let finished = false;
    const finish = () => {
        finished = true;
        clearTimeout(timer);
        ws.close();
    };

    const timer = setTimeout(() => {
        if (ws.readyState === WebSocket.CONNECTING) {
            finish();
            h.onError('Сервер не отвечает. Проверьте адрес, Wi-Fi и брандмауэр');
        }
    }, CONNECT_TIMEOUT_MS);

    ws.onopen = () => {
        clearTimeout(timer);
        ws.send(JSON.stringify({ type: 'analyze', pgn, depth }));
    };

    ws.onmessage = (e) => {
        const m = JSON.parse(e.data) as ServerMessage;
        if (m.type === 'progress')
            h.onProgress(m.done, m.total, m.index, m.evaluation);
        else if (m.type === 'result')
            (finish(), h.onResult(m.result));
        else if (m.type === 'error')
            (finish(), h.onError(m.message));
        else
            finish();
    };

    ws.onerror = () => {
        if (!finished)
            (finish(), h.onError('Нет соединения с сервером'));
    };

    ws.onclose = () => {
        if (!finished) {
            finished = true
            clearTimeout(timer)
            h.onError('Соединение прервано');
        }
    };

    return { cancel: finish };
}