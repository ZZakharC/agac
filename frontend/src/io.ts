import { Capacitor } from '@capacitor/core';
import type { AnalysisResult } from './types';

export interface ExportFile {
    format: 'agac-analysis';
    version: 1;
    pgn: string;
    result: AnalysisResult;
    elapsedMs?: number;
}

export const buildExport = (pgn: string, result: AnalysisResult, elapsedMs?: number): ExportFile => ({
    format: 'agac-analysis',
    version: 1,
    pgn,
    result,
    ...(elapsedMs ? { elapsedMs: Math.round(elapsedMs) } : {}),
});

export function parseImport(text: string): ExportFile {
    let data: Partial<ExportFile> | null;

    try {
        data = JSON.parse(text);
    } catch {
        throw new Error('Файл не является JSON');
    }

    if (data?.format !== 'agac-analysis')
        throw new Error('Это не файл анализа партии');
    
    const r = data.result;
    
    if (typeof data.pgn !== 'string' ||
        !Array.isArray(r?.positions) ||
        !Array.isArray(r?.moves) ||
        !r.summary?.w ||
        !r.summary?.b
    )
        throw new Error('Файл повреждён');
    return data as ExportFile;
}

export const exportFileName = (result: AnalysisResult): string => {
    const clean = (s: string | null | undefined, fallback: string) => (s || fallback).replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 30);
    const { White, Black } = result.headers;

    return `${clean(White, 'white')}-vs-${clean(Black, 'black')}-d${result.depth}.json`;
};

// Браузер скачивание файла; приложение системное окно Поделиться
export async function saveFile(name: string, data: string): Promise<void> {
    if (Capacitor.isNativePlatform()) {
        const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
        const { Share } = await import('@capacitor/share');
        const file = await Filesystem.writeFile({
            path: name,
            data,
            directory: Directory.Cache,
            encoding: Encoding.UTF8,
        });

        await Share.share({ title: name, url: file.uri });
        
        return;
    }
    
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}