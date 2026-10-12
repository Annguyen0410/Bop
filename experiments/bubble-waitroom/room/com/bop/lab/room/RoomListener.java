package com.bop.lab.room;
import android.app.*;
import android.service.notification.*;
import java.util.*;
public class RoomListener extends NotificationListenerService {
    static final String SOURCE="com.bop.lab.source";
    static RoomListener instance;
    static Map<String,StatusBarNotification> saved=new HashMap<>();
    static String result="Waiting for listener connection";
    static void log(String s){result=s;android.util.Log.i("WAITROOM_ROOM",s);}
    @Override public void onListenerConnected(){instance=this;log("CONNECTED uid="+android.os.Process.myUid());refresh();}
    @Override public void onListenerDisconnected(){instance=null;log("DISCONNECTED");}
    @Override public void onNotificationPosted(StatusBarNotification s){if(SOURCE.equals(s.getPackageName())){saved.put(s.getTag(),s);log("POST "+s.getTag()+" bubbleFlag="+((s.getNotification().flags&Notification.FLAG_BUBBLE)!=0));}}
    @Override public void onNotificationRemoved(StatusBarNotification s,RankingMap r,int reason){if(SOURCE.equals(s.getPackageName()))log("REMOVED "+s.getTag()+" reason="+reason);}
    void refresh(){for(StatusBarNotification s:getActiveNotifications())if(SOURCE.equals(s.getPackageName()))saved.put(s.getTag(),s);}
    void park(long ms){refresh();StatusBarNotification s=saved.get("Alpha");if(s==null){log("NO_ALPHA");return;}snoozeNotification(s.getKey(),ms);log("SNOOZE_REQUEST Alpha ms="+ms);}
    void cancelAlpha(){refresh();StatusBarNotification s=saved.get("Alpha");if(s==null){log("NO_ALPHA");return;}cancelNotification(s.getKey());log("CANCEL_ALPHA_REQUEST destructive-not-parking");}
    String inspect(){refresh();StringBuilder b=new StringBuilder("Listener UID "+android.os.Process.myUid()+"\n");for(StatusBarNotification s:getActiveNotifications())if(SOURCE.equals(s.getPackageName()))b.append("ACTIVE ").append(s.getTag()).append(" bubble=").append((s.getNotification().flags&Notification.FLAG_BUBBLE)!=0).append("\n");for(StatusBarNotification s:getSnoozedNotifications())if(SOURCE.equals(s.getPackageName()))b.append("PARKED ").append(s.getTag()).append(" text=").append(s.getNotification().extras.getCharSequence(Notification.EXTRA_TEXT)).append("\n");b.append(result);return b.toString();}
    void openOriginal(){StatusBarNotification s=saved.get("Alpha");if(s==null){log("NO_ALPHA");return;}try{ActivityOptions options=ActivityOptions.makeBasic();options.setPendingIntentBackgroundActivityStartMode(ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOW_IF_VISIBLE);s.getNotification().contentIntent.send(this,0,null,null,null,null,options.toBundle());log("ORIGINAL_PENDING_INTENT_SENT_WITH_VISIBLE_SENDER_OPT_IN");}catch(PendingIntent.CanceledException e){log("OPEN_FAILED "+e);}}
    void restoreAsSource(){StatusBarNotification s=saved.get("Alpha");if(s==null){log("NO_ALPHA");return;}try{getSystemService(NotificationManager.class).notifyAsPackage(SOURCE,s.getTag(),s.getId(),s.getNotification());log("NOTIFY_AS_SOURCE_ACCEPTED");}catch(SecurityException e){log("NOTIFY_AS_SOURCE_DENIED "+e.getMessage());}}
}
