package in.sevenby.paylistener;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Telephony;
import android.telephony.SmsMessage;

/** Forwards incoming bank credit SMS to the gateway. */
public class SmsReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context ctx, Intent intent) {
        try {
            SmsMessage[] parts = Telephony.Sms.Intents.getMessagesFromIntent(intent);
            if (parts == null || parts.length == 0) return;
            String from = parts[0].getDisplayOriginatingAddress();
            StringBuilder sb = new StringBuilder();
            for (SmsMessage m : parts) sb.append(m.getMessageBody());
            Forwarder.forward(ctx, "SMS " + from, sb.toString().trim());
        } catch (Exception ignored) {}
    }
}
