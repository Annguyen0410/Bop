import pathlib, subprocess, time, sys, xml.etree.ElementTree as ET, json, re
ROOT=pathlib.Path(__file__).resolve().parent
ADB=pathlib.Path.home()/'AppData/Local/Android/Sdk/platform-tools/adb.exe'
OUT=ROOT/'evidence'; OUT.mkdir(exist_ok=True)

def adb(*args):
    p=subprocess.run([str(ADB),'-s','emulator-5554',*args],capture_output=True,timeout=45)
    if p.returncode: raise RuntimeError(p.stderr.decode(errors='replace')+p.stdout.decode(errors='replace'))
    return p.stdout.decode(errors='replace')
def dump():
    adb('shell','uiautomator','dump','/sdcard/waitroom.xml');adb('pull','/sdcard/waitroom.xml',str(OUT/'ui.xml'))
    return ET.parse(OUT/'ui.xml')
def tap(label):
    for n in dump().iter('node'):
        if re.search(re.escape(label.lower()) + r'(?!\d)', n.get('text','').lower()):
            x1,y1,x2,y2=map(int,re.findall(r'\d+',n.get('bounds')))
            # Source bubbles/flyouts can cover the centre of a button; tap its exposed right edge.
            x=x2-40 if n.get('class')=='android.widget.Button' else (x1+x2)//2
            adb('shell','input','tap',str(x),str((y1+y2)//2));time.sleep(1);return
    raise RuntimeError('Missing UI control: '+label)
def capture(name):
    p=subprocess.run([str(ADB),'-s','emulator-5554','exec-out','screencap','-p'],capture_output=True,check=True,timeout=30)
    (OUT/(name+'.png')).write_bytes(p.stdout)
    (OUT/(name+'-notifications.txt')).write_text(adb('shell','dumpsys','notification','--noredact'),encoding='utf-8')
    (OUT/(name+'-systemui.txt')).write_text(adb('shell','dumpsys','activity','service','com.android.systemui/.SystemUIService'),encoding='utf-8')
    (OUT/(name+'-shell.txt')).write_text(adb('shell','dumpsys','activity','service','com.android.systemui/.SystemUIService','WMShell'),encoding='utf-8')
    (OUT/(name+'-windows.txt')).write_text(adb('shell','dumpsys','window','windows'),encoding='utf-8')
def launch(package,activity):return adb('shell','am','start','-n',package+'/'+activity)

def main():
    command=sys.argv[1]
    if command=='setup':
        for kind in ['source','room']: print(adb('install','-r',str(ROOT/'artifacts'/('waitroom-'+kind+'-lab.apk'))).strip())
        adb('shell','pm','grant','com.bop.lab.source','android.permission.POST_NOTIFICATIONS')
        adb('shell','cmd','notification','allow_listener','com.bop.lab.room/.RoomListener')
        adb('shell','cmd','notification','set_bubbles','com.bop.lab.source','1')
        launch('com.bop.lab.source','.SourceActivity');time.sleep(2)
        tap('Post Alpha')
        # The first bubble opens SystemUI education over the app; dismiss it without using root.
        adb('shell','input','tap','1000','1800');launch('com.bop.lab.source','.SourceActivity');time.sleep(1)
        tap('Post Beta')
        adb('shell','cmd','notification','set_bubbles_channel','com.bop.lab.source','lab_conversations','true')
        tap('Post Alpha');tap('Post Beta');adb('shell','input','keyevent','HOME');time.sleep(2);capture('01-two-source-bubbles')
        launch('com.bop.lab.room','.RoomActivity');time.sleep(2);capture('02-room-ready')
    elif command=='tap':tap(sys.argv[2])
    elif command=='capture':capture(sys.argv[2])
    elif command=='room':launch('com.bop.lab.room','.RoomActivity')
    elif command=='source':launch('com.bop.lab.source','.SourceActivity')
    elif command=='ui':
        for n in dump().iter('node'):
            if n.get('text') or n.get('content-desc'):print(ascii(n.get('text') or n.get('content-desc')),n.get('bounds'))
    elif command=='update':print(adb('shell','am','broadcast','-n','com.bop.lab.source/.UpdateReceiver','-a','com.bop.lab.TEST_MESSAGE','--es','chat','Alpha').strip())
    elif command=='logs':(OUT/'logcat.txt').write_text(adb('logcat','-d','-s','WAITROOM_SOURCE:I','WAITROOM_ROOM:I','AndroidRuntime:E'),encoding='utf-8')
    else:raise ValueError(command)
if __name__=='__main__':main()
