import { Capacitor, registerPlugin } from '@capacitor/core';

interface ShareTargetPlugin {
    /** Забирает партию, присланную через «Поделиться» (и очищает её на стороне Android). */
    getPending(): Promise<{ text?: string }>;
}

const ShareTarget = registerPlugin<ShareTargetPlugin>('ShareTarget');

/**
 * Вызывает onPgn, когда другое приложение отправило нам PGN через «Поделиться» (только в Android-приложении).
 * Проверяем при запуске и каждый раз, когда приложение снова становится видимым.
 */
export function onSharedPgn(onPgn: (pgn: string) => void, onError?: (message: string) => void): void {
    if (!Capacitor.isNativePlatform()) return;

    let reported = false;
    const check = async () => {
        try {
            const { text } = await ShareTarget.getPending();
            if (text) onPgn(extractPgn(text));
        } catch (e) {
            console.error('ShareTarget:', e);
            if (!reported) {
                reported = true;
                onError?.('Приём партии из других приложений не работает (плагин ShareTarget не подключён)');
            }
        }
    };

    void check();
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void check();
    });
    window.addEventListener('focus', () => void check());
}

/** Из общего текста берём саму партию: некоторые приложения добавляют перед PGN свой текст или ссылку. */
function extractPgn(text: string): string {
    const i = text.search(/\[\w+\s+"/);
    return (i >= 0 ? text.slice(i) : text).trim();
}