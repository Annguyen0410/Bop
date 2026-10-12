package com.bop.lab.source;
import android.content.*;
public class UpdateReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c,Intent i){SourceActivity.post(c,i.getStringExtra("chat")==null?"Alpha":i.getStringExtra("chat"));}
}
