package in.sevenby.paylistener;

import android.content.Context;
import android.content.SharedPreferences;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** Sends captured payment texts to the 7Pay gateway (upi.credit endpoint). */
public class Forwarder {
    public static final String PREFS = "7pay";
    private static String lastText = "";
    private static long lastAt = 0;

    /** Only forward things that look like an incoming payment. */
    public static boolean shouldForward(String text) {
        if (text == null) return false;
        String t = text.toLowerCase(Locale.ROOT);
        return t.contains("receiv") || t.contains("credit");
    }

    public static synchronized void forward(final Context ctx, final String source, final String text) {
        if (!shouldForward(text)) return;
        long now = System.currentTimeMillis();
        if (text.equals(lastText) && now - lastAt < 30000) return; // duplicate notification update
        lastText = text;
        lastAt = now;

        new Thread(new Runnable() {
            @Override public void run() {
                SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
                String url = p.getString("url", "");
                if (url == null || url.trim().isEmpty() || !url.contains("token=")) {
                    log(ctx, "NOT SENT — open the app and save your gateway URL first");
                    return;
                }
                int code = -1;
                String err = "";
                for (int attempt = 0; attempt < 3; attempt++) {
                    try {
                        HttpURLConnection c = (HttpURLConnection) new URL(url.trim()).openConnection();
                        c.setConnectTimeout(10000);
                        c.setReadTimeout(15000);
                        c.setDoOutput(true);
                        c.setRequestMethod("POST");
                        c.setRequestProperty("Content-Type", "text/plain; charset=utf-8");
                        OutputStream os = c.getOutputStream();
                        os.write(text.getBytes("UTF-8"));
                        os.close();
                        code = c.getResponseCode();
                        c.disconnect();
                        if (code >= 200 && code < 300) break;
                    } catch (Exception e) {
                        err = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
                    }
                    try { Thread.sleep(3000L * (attempt + 1)); } catch (InterruptedException ignored) {}
                }
                String snippet = text.length() > 60 ? text.substring(0, 60) + "…" : text;
                log(ctx, "[" + source + "] " + (code > 0 ? "HTTP " + code : "FAILED: " + err) + " — " + snippet);
            }
        }).start();
    }

    public static void log(Context ctx, String line) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String stamp = new SimpleDateFormat("dd MMM HH:mm", Locale.US).format(new Date());
        String all = stamp + "  " + line + "\n" + p.getString("log", "");
        if (all.length() > 4000) all = all.substring(0, 4000);
        p.edit().putString("log", all).apply();
    }
}
