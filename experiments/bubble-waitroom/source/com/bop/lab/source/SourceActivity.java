package com.bop.lab.source;

import android.app.*;
import android.content.*;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.graphics.Color;
import android.graphics.drawable.Icon;
import android.os.Bundle;
import android.provider.Settings;
import android.view.*;
import android.widget.*;
import java.util.*;

public class SourceActivity extends Activity {
    static final String CHANNEL = "lab_conversations";
    static TextView overlay;
    static WindowManager wm;
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        LinearLayout root = new LinearLayout(this); root.setOrientation(1); root.setPadding(24,60,24,20);
        TextView heading = new TextView(this); heading.setText("SOURCE APP - owns chat and messages\nNot Messenger or Zalo"); heading.setTextSize(21); root.addView(heading);
        add(root,"Post Alpha bubble",()->post(this,"Alpha"));
        add(root,"Post Beta bubble",()->post(this,"Beta"));
        add(root,"Update Alpha message",()->post(this,"Alpha"));
        add(root,"Notification / bubble settings",()->startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,getPackageName())));
        add(root,"Overlay permission",()->startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, android.net.Uri.parse("package:"+getPackageName()))));
        add(root,"Show source overlay",()->showOverlay(this));
        add(root,"Remove source overlay",()->{if(overlay!=null){wm.removeView(overlay);overlay=null;}});
        add(root,"Grant room notification delegation",()->{getSystemService(NotificationManager.class).setNotificationDelegate("com.bop.lab.room");Toast.makeText(this,"Source explicitly cooperates now",0).show();});
        setContentView(root);
        if(android.os.Build.VERSION.SDK_INT>=33 && checkSelfPermission("android.permission.POST_NOTIFICATIONS")!=0) requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"},1);
    }
    void add(LinearLayout root,String title,Runnable action){Button b=new Button(this);b.setText(title);b.setOnClickListener(v->action.run());root.addView(b);}
    public static void post(Context c,String chat) {
        NotificationManager nm=c.getSystemService(NotificationManager.class);
        NotificationChannel channel=new NotificationChannel(CHANNEL,"Lab chats",NotificationManager.IMPORTANCE_HIGH);
        nm.createNotificationChannel(channel);
        int seq=c.getSharedPreferences("source",0).getInt(chat,0)+1;
        c.getSharedPreferences("source",0).edit().putInt(chat,seq).commit();
        Intent intent=new Intent(c,ChatActivity.class).setAction("chat."+chat).putExtra("chat",chat);
        Person person=new Person.Builder().setName(chat).setImportant(true).build();
        ShortcutInfo shortcut=new ShortcutInfo.Builder(c,chat).setShortLabel(chat).setIntent(new Intent(intent).setAction(Intent.ACTION_VIEW)).setLongLived(true).setPerson(person).setIcon(Icon.createWithResource(c,android.R.drawable.sym_action_chat)).build();
        c.getSystemService(ShortcutManager.class).addDynamicShortcuts(Collections.singletonList(shortcut));
        PendingIntent pi=PendingIntent.getActivity(c,chat.equals("Alpha")?1:2,intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        // Android requires a mutable bubble launch token to attach its embedding launch options.
        // Keep the target explicit and contentIntent immutable; only this bubble token is mutable.
        PendingIntent bubblePi=PendingIntent.getActivity(c,chat.equals("Alpha")?11:12,intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_MUTABLE);
        Notification n=new Notification.Builder(c,CHANNEL).setSmallIcon(android.R.drawable.sym_action_chat).setContentTitle(chat).setContentText("Message "+seq+" from source app").setContentIntent(pi).setShortcutId(chat).setCategory(Notification.CATEGORY_MESSAGE)
            .setStyle(new Notification.MessagingStyle(new Person.Builder().setName("Me").build()).addMessage("Message "+seq+" from source app",System.currentTimeMillis(),person))
            .setBubbleMetadata(new Notification.BubbleMetadata.Builder(bubblePi,Icon.createWithResource(c,android.R.drawable.sym_action_chat)).setDesiredHeight(420).build()).build();
        nm.notify(chat,chat.equals("Alpha")?1:2,n);
        android.util.Log.i("WAITROOM_SOURCE","POST "+chat+" seq="+seq+" uid="+android.os.Process.myUid());
    }
    static void showOverlay(Context c){
        if(!Settings.canDrawOverlays(c)){Toast.makeText(c,"Grant overlay permission first",0).show();return;}
        if(overlay!=null)return;
        wm=c.getSystemService(WindowManager.class);overlay=new TextView(c);overlay.setText("SOURCE\nOVERLAY");overlay.setTextColor(Color.WHITE);overlay.setBackgroundColor(Color.rgb(0,110,190));overlay.setGravity(Gravity.CENTER);
        WindowManager.LayoutParams p=new WindowManager.LayoutParams(160,160,WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,android.graphics.PixelFormat.TRANSLUCENT);p.gravity=Gravity.TOP|Gravity.LEFT;p.x=30;p.y=550;p.setTitle("WaitroomSourceOverlay");wm.addView(overlay,p);
        overlay.setOnClickListener(v->c.startActivity(new Intent(c,ChatActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("chat","Alpha")));
    }
}
