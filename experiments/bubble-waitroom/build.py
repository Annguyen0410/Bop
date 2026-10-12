"""Local lab only: compile two apps with the installed SDK, no downloads or Bop changes."""
import os
import pathlib
import subprocess
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent
SDK = pathlib.Path.home() / 'AppData/Local/Android/Sdk'
TOOLS = SDK / 'build-tools/37.0.0'
JAVA = pathlib.Path('C:/Program Files/Android/Android Studio/jbr/bin')
ANDROID = SDK / 'platforms/android-37.0/android.jar'
OUT = pathlib.Path('D:/bop-dev/waitroom-lab-build')

def run(*args):
    print('RUN', str(args[0]), flush=True)
    subprocess.run([str(a) for a in args], check=True)

for name in ['source', 'room']:
    work = OUT / name
    classes = work / 'classes'; dex = work / 'dex'
    classes.mkdir(parents=True, exist_ok=True); dex.mkdir(exist_ok=True)
    run(JAVA/'javac.exe', '-encoding', 'UTF-8', '-source', '8', '-target', '8', '-classpath', ANDROID, '-d', classes, *sorted((ROOT/name).rglob('*.java')))
    jar = work/'classes.jar'
    with zipfile.ZipFile(jar, 'w') as z:
        for file in classes.rglob('*.class'): z.write(file,file.relative_to(classes).as_posix())
    run(JAVA/'java.exe','-cp',TOOLS/'lib/d8.jar','com.android.tools.r8.D8','--min-api','30','--lib',ANDROID,'--output',dex,jar)
    apk = work/'unsigned.apk'
    run(TOOLS/'aapt.exe','package','-f','-M',ROOT/name/'AndroidManifest.xml','-I',ANDROID,'-F',apk)
    with zipfile.ZipFile(apk,'a') as z: z.write(dex/'classes.dex','classes.dex')
    aligned = work/'aligned.apk'
    run(TOOLS/'zipalign.exe','-f','4',apk,aligned)
    final = ROOT/'artifacts'/('waitroom-'+name+'-lab.apk'); final.parent.mkdir(exist_ok=True)
    run(JAVA/'java.exe','-jar',TOOLS/'lib/apksigner.jar','sign','--ks',pathlib.Path.home()/'.android/debug.keystore','--ks-key-alias','androiddebugkey','--ks-pass','pass:android','--key-pass','pass:android','--out',final,aligned)
    run(JAVA/'java.exe','-jar',TOOLS/'lib/apksigner.jar','verify','--verbose',final)
    print('APK',final.name,final.stat().st_size,flush=True)
