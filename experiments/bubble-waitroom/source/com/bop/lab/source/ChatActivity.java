package com.bop.lab.source;
import android.app.Activity;
import android.os.Bundle;
import android.widget.*;
public class ChatActivity extends Activity {
    @Override public void onCreate(Bundle b){super.onCreate(b);String chat=getIntent().getStringExtra("chat");LinearLayout root=new LinearLayout(this);root.setOrientation(1);root.setPadding(20,40,20,20);TextView t=new TextView(this);t.setText("ORIGINAL SOURCE CHAT: "+chat+"\nSource UID: "+android.os.Process.myUid()+"\nMessages: "+getSharedPreferences("source",0).getInt(chat,0)+"\nThis UI belongs to source, not room.");t.setTextSize(20);root.addView(t);EditText input=new EditText(this);input.setHint("Type in original chat");root.addView(input);setContentView(root);android.util.Log.i("WAITROOM_SOURCE","OPEN_CHAT "+chat+" uid="+android.os.Process.myUid());}
}
