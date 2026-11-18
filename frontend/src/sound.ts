// Звуки партии из файлов: public/sounds/{move,capture,castle,check,end}.mp3
export type Sound = 'move' | 'capture' | 'castle' | 'check' | 'end';

const EXT = 'mp3'; // поменяйте, если файлы в другом формате (ogg, wav)
const BASE = `${import.meta.env.BASE_URL}sounds/`;
const KEY = 'muted';

const FILES: Record<Sound, string> = {
    move: `${BASE}move.${EXT}`,
    capture: `${BASE}capture.${EXT}`,
    castle: `${BASE}castle.${EXT}`,
    check: `${BASE}check.${EXT}`,
    end: `${BASE}end.${EXT}`,
};

let muted = (() => {
    try {
        return localStorage.getItem(KEY) === '1';
    } catch {
        return false;
    }
})();

export const isMuted = () => muted;

export function setMuted(value: boolean): void {
    muted = value;
    try {
        localStorage.setItem(KEY, value ? '1' : '0');
    } catch { }
}

const players = new Map<Sound, HTMLAudioElement>();
const missing = new Set<Sound>(); // файлы, которые не удалось загрузить

function player(kind: Sound): HTMLAudioElement {
    let audio = players.get(kind);
    if (!audio) {
        audio = new Audio(FILES[kind]);
        audio.preload = 'auto';
        audio.addEventListener('error', () => missing.add(kind));
        players.set(kind, audio);
    }
    return audio;
}

/** Загружает все звуки заранее, чтобы первый ход не звучал с задержкой. */
export function preloadSounds(): void {
    (Object.keys(FILES) as Sound[]).forEach(player);
}

export function playSound(kind: Sound): void {
    if (muted) return;
    // нет файла (например, castle.mp3) — играем обычный звук хода
    if (missing.has(kind) && kind !== 'move') return playSound('move');
    const audio = player(kind);
    audio.currentTime = 0;
    // браузер может отклонить воспроизведение до первого действия пользователя
    void audio.play().catch(() => { });
}