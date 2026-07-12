package in.sevenby.paylistener;

import android.app.Notification;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

/** Watches every app's notifications; payment-looking ones get forwarded. */
public class PayListenerService extends NotificationListenerService {

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        try {
            if (sbn.getPackageName().equals(getPackageName())) return;
            Notification n = sbn.getNotification();
            if (n == null || n.extras == null) return;
            Bundle ex = n.extras;
            CharSequence title = ex.getCharSequence(Notification.EXTRA_TITLE);
            CharSequence big = ex.getCharSequence(Notification.EXTRA_BIG_TEXT);
            CharSequence text = ex.getCharSequence(Notification.EXTRA_TEXT);
            String body = ((title == null ? "" : title + " ") +
                    (big != null ? big : (text == null ? "" : text))).trim();
            if (!body.isEmpty()) {
                Forwarder.forward(getApplicationContext(), sbn.getPackageName(), body);
            }
        } catch (Exception ignored) {}
    }
}
