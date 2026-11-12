package com.whatsapp;

import android.app.Activity;
import android.os.Bundle;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Just enough UI to grant the notification permission and post by hand if a script is not usable. */
public class Main extends Activity {
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Post.ensureChannel(this);
        LinearLayout body = new LinearLayout(this);
        body.setOrientation(LinearLayout.VERTICAL);
        body.setPadding(48, 96, 48, 48);
        TextView note = new TextView(this);
        note.setText("Fixture only. Posts a MessagingStyle notification as com.whatsapp so Bop's "
                + "notification path can be verified on a device without a real account.");
        Button post = new Button(this);
        post.setText("Post a message");
        post.setOnClickListener(view -> {
            android.content.Intent intent = new android.content.Intent("com.whatsapp.FIXTURE_POST");
            intent.putExtra("text", "Fixture message " + System.currentTimeMillis());
            sendBroadcast(intent);
        });
        Button clear = new Button(this);
        clear.setText("Clear notifications");
        clear.setOnClickListener(view -> sendBroadcast(new android.content.Intent("com.whatsapp.FIXTURE_CLEAR")));
        body.addView(note);
        body.addView(post);
        body.addView(clear);
        setContentView(body);
    }
}
