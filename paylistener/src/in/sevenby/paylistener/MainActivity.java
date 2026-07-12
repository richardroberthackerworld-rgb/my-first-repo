package in.sevenby.paylistener;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Typeface;
import android.os.Bundle;
import android.provider.Settings;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

public class MainActivity extends Activity {
    private TextView status, log;
    private EditText url;
    private SharedPreferences prefs;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences(Forwarder.PREFS, MODE_PRIVATE);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (16 * getResources().getDisplayMetrics().density);
        root.setPadding(pad, pad, pad, pad);

        TextView h = new TextView(this);
        h.setText("7Pay Listener");
        h.setTextSize(24);
        h.setTypeface(null, Typeface.BOLD);
        root.addView(h);

        TextView sub = new TextView(this);
        sub.setText("Forwards payment notifications (GPay / PhonePe / Paytm / bank apps) and bank SMS to your 7Pay gateway so payments auto-capture.");
        sub.setPadding(0, 0, 0, pad);
        root.addView(sub);

        url = new EditText(this);
        url.setHint("https://7pay.7by.in/api.php?action=upi.credit&token=...");
        url.setText(prefs.getString("url", "https://7pay.7by.in/api.php?action=upi.credit&token="));
        root.addView(url);

        Button save = new Button(this);
        save.setText("Save gateway URL");
        save.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                prefs.edit().putString("url", url.getText().toString().trim()).apply();
                Toast.makeText(MainActivity.this, "Saved", Toast.LENGTH_SHORT).show();
                refresh();
            }
        });
        root.addView(save);

        Button notif = new Button(this);
        notif.setText("1 · Grant notification access");
        notif.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS));
            }
        });
        root.addView(notif);

        Button sms = new Button(this);
        sms.setText("2 · Grant SMS permission");
        sms.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                requestPermissions(new String[]{android.Manifest.permission.RECEIVE_SMS}, 1);
            }
        });
        root.addView(sms);

        Button test = new Button(this);
        test.setText("3 · Send test to gateway");
        test.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                Forwarder.forward(MainActivity.this, "TEST", "Rs.1.00 credited — test from 7Pay Listener");
                Toast.makeText(MainActivity.this, "Test sent — log updates below", Toast.LENGTH_SHORT).show();
                log.postDelayed(new Runnable() { @Override public void run() { refresh(); } }, 4000);
            }
        });
        root.addView(test);

        status = new TextView(this);
        status.setTextSize(16);
        status.setPadding(0, pad, 0, pad / 2);
        root.addView(status);

        log = new TextView(this);
        log.setTextSize(12);
        log.setTypeface(Typeface.MONOSPACE);
        root.addView(log, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        ScrollView sv = new ScrollView(this);
        sv.addView(root);
        setContentView(sv);
        refresh();
    }

    @Override
    protected void onResume() {
        super.onResume();
        refresh();
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        refresh();
    }

    private void refresh() {
        String enabled = Settings.Secure.getString(getContentResolver(), "enabled_notification_listeners");
        boolean notifOk = enabled != null && enabled.contains(getPackageName());
        boolean smsOk = checkSelfPermission(android.Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED;
        boolean urlOk = prefs.getString("url", "").contains("token=") &&
                !prefs.getString("url", "").endsWith("token=");
        status.setText("Notifications: " + (notifOk ? "✅" : "❌ tap 1") +
                "    SMS: " + (smsOk ? "✅" : "❌ tap 2") +
                "    URL: " + (urlOk ? "✅" : "❌ paste token"));
        log.setText(prefs.getString("log", "(no activity yet)"));
    }
}
