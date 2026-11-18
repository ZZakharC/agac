package com.zzakharc.chessanalyzer;

import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * Принимает текст или файл PGN, отправленный из другого приложения через «Поделиться».
 * Полученный текст хранится, пока веб-часть не заберёт его методом getPending().
 */
@CapacitorPlugin(name = "ShareTarget")
public class ShareTargetPlugin extends Plugin {
    private static final String TAG = "ShareTarget";
    private static final int MAX_BYTES = 1024 * 1024;

    private String pending;

    // приложение запущено через «Поделиться» (холодный старт)
    @Override
    public void load() {
        capture(getActivity().getIntent());
    }

    // приложение уже было открыто
    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        capture(intent);
    }

    @PluginMethod
    public void getPending(PluginCall call) {
        JSObject result = new JSObject();
        result.put("text", pending);
        pending = null;
        call.resolve(result);
    }

    private void capture(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;

        Log.d(TAG, "intent type=" + intent.getType() + " extras="
                + (intent.getExtras() != null ? intent.getExtras().keySet() : null));

        String text = null;

        // EXTRA_TEXT бывает не String, а, например, SpannableString, поэтому читаем как CharSequence
        CharSequence extraText = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        if (extraText != null) text = extraText.toString();

        if (text == null) {
            Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (uri != null) text = readUri(uri);
        }

        if (text == null) {
            ClipData clip = intent.getClipData();
            if (clip != null && clip.getItemCount() > 0) {
                CharSequence t = clip.getItemAt(0).getText();
                if (t != null) text = t.toString();
                else if (clip.getItemAt(0).getUri() != null) text = readUri(clip.getItemAt(0).getUri());
            }
        }

        if (text == null || text.trim().isEmpty()) {
            Log.d(TAG, "в intent нет ни текста, ни файла");
            return;
        }

        Log.d(TAG, "получено символов: " + text.length());
        pending = text;

        // чтобы при пересоздании активности (поворот экрана) партия не пришла второй раз
        getActivity().setIntent(new Intent());
    }

    private String readUri(Uri uri) {
        try (InputStream in = getContext().getContentResolver().openInputStream(uri)) {
            if (in == null) return null;
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0 && out.size() < MAX_BYTES) out.write(buf, 0, n);
            return out.toString(StandardCharsets.UTF_8.name());
        } catch (Exception e) {
            Log.d(TAG, "не удалось прочитать " + uri + ": " + e);
            return null;
        }
    }
}