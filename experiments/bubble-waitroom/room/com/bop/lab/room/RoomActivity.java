package com.bop.lab.room;
import android.app.*;
import android.os.*;
import android.content.*;
import android.provider.Settings;
import android.widget.*;
public class RoomActivity extends Activity {
    TextView status; Handler handler=new Handler();
    Runnable refresh=new Runnable(){public void run(){RoomListener l=RoomListener.instance;status.setText(l==null?"Listener disconnected. Enable notification access.":l.inspect());handler.postDelayed(this,1000);}};
    @Override public void onCreate(Bundle b){super.onCreate(b);LinearLayout root=new LinearLayout(this);root.setOrientation(1);root.setPadding(20,60,20,20);TextView title=new TextView(this);title.setText("BOP WAITROOM - EXPERIMENT ONLY\nOther app owns Alpha and Beta\nNo fake embedding / no root");title.setTextSize(20);root.addView(title);
        add(root,"Enable notification access",()->startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)));
        add(root,"Park Alpha for 25 seconds",()->{if(RoomListener.instance!=null)RoomListener.instance.park(25000);});
        add(root,"Park Alpha for 2 minutes",()->{if(RoomListener.instance!=null)RoomListener.instance.park(120000);});
        add(root,"Open original Alpha chat",()->{if(RoomListener.instance!=null)RoomListener.instance.openOriginal();});
        add(root,"Try restore as source (permission probe)",()->{if(RoomListener.instance!=null)RoomListener.instance.restoreAsSource();});
        add(root,"Cancel Alpha notification (destructive test)",()->{if(RoomListener.instance!=null)RoomListener.instance.cancelAlpha();});
        status=new TextView(this);status.setTextSize(14);root.addView(status);setContentView(root);
    }
    void add(LinearLayout root,String label,Runnable action){Button b=new Button(this);b.setText(label);b.setOnClickListener(v->action.run());root.addView(b);}
    @Override public void onResume(){super.onResume();handler.post(refresh);}
    @Override public void onPause(){handler.removeCallbacks(refresh);super.onPause();}
}
