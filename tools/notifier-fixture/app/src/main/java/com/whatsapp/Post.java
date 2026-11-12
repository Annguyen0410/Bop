package com.whatsapp;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Person;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Posts one MessagingStyle notification, which is the strongest proof of "a conversation is active"
 * that [com.example.twoaccmess.AlertFilter] accepts. Used only by the device-verification script.
 */
public class Post extends BroadcastReceiver {
    static final String CHANNEL = "fixture_chat";
    static final String ACTION_POST = "com.whatsapp.FIXTURE_POST";
    static final String ACTION_CLEAR = "com.whatsapp.FIXTURE_CLEAR";

    static void ensureChannel(Context context) {
        NotificationChannel channel = new NotificationChannel(CHANNEL, "Fixture chat", NotificationManager.IMPORTANCE_DEFAULT);
        context.getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (intent == null || intent.getAction() == null) return;
        if (ACTION_CLEAR.equals(intent.getAction())) {
            manager.cancelAll();
            return;
        }
        if (!ACTION_POST.equals(intent.getAction())) return;
        ensureChannel(context);

        String tag = intent.getStringExtra("tag");
        if (tag == null) tag = "fixture-chat";
        String text = intent.getStringExtra("text");
        if (text == null) text = "Fixture message";
        String sender = intent.getStringExtra("sender");
        if (sender == null) sender = "Sam";
        long when = System.currentTimeMillis();

        Person person = new Person.Builder().setName(sender).build();
        Notification.MessagingStyle style = new Notification.MessagingStyle(person)
                .setConversationTitle(sender)
                .addMessage(new Notification.MessagingStyle.Message(text, when, person));
        Notification notification = new Notification.Builder(context, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_dialog_email)
                .setContentTitle(sender)
                .setContentText(text)
                .setStyle(style)
                .setCategory(Notification.CATEGORY_MESSAGE)
                .setWhen(when)
                .setShowWhen(true)
                .setAutoCancel(true)
                .build();
        manager.notify(tag, 1, notification);
    }
}
