"""Verify recorded evidence, not a substitute for running the emulator UI experiment."""
import hashlib, json, pathlib, re
ROOT=pathlib.Path(__file__).resolve().parent
E=ROOT/'evidence'
def text(stage,kind):return (E/(stage+'-'+kind+'.txt')).read_text(encoding='utf-8')
def count(stage):return int(re.search(r'Stack bubble count: (\d+)',text(stage,'shell')).group(1))
def snoozed(stage):
    data=text(stage,'notifications').split('Snoozed notifications:',1)[1].split('Ranking Config:',1)[0]
    return '|Alpha|' in data
assert count('23-final-two-plus-overlay')==2
assert snoozed('24-final-real-park-plus-overlay')
assert snoozed('25-final-update-plus-overlay')
assert count('24-final-real-park-plus-overlay')==2
assert count('25-final-update-plus-overlay')==2
assert 'WaitroomSourceOverlay' in text('25-final-update-plus-overlay','windows')
assert snoozed('15-last-build-snoozed') and not snoozed('16-last-build-return')
log=(E/'logcat.txt').read_text()
assert 'NOTIFY_AS_SOURCE_DENIED' in log
assert 'SNOOZE_REQUEST Alpha ms=120000' in log
assert re.search(r'POST Alpha seq=6 uid=10229',log)
assert re.search(r'OPEN_CHAT Alpha uid=10229',log)
assert 'ORIGINAL_PENDING_INTENT_SENT_WITH_VISIBLE_SENDER_OPT_IN' in log
ui=(E/'ui.xml').read_text()
assert 'ORIGINAL SOURCE CHAT: Alpha' in ui and 'Messages: 6' in ui
# Timestamp of snooze removal -> timer repost from the final APK's 25-second test.
lines=[x for x in log.splitlines() if x.strip()]
removed=next(x for x in lines if '21:15:56.968' in x and 'REMOVED Alpha reason=18' in x)
returned=next(x for x in lines if '21:16:22.095' in x and 'POST Alpha' in x)
report={
 'environment':'Android 17/API 37 emulator-5554; unrooted Play Store image; no physical phone used',
 'sourceUid':10229,'roomUid':10230,
 'probes':{'notificationSnooze':True,'timerRestoresNotification':True,'timerObservedSeconds':25.127,
 'sourceUpdatesSnoozedMessage':True,'originalChatOpenedByVisibleSender':True,'foreignRepostDeniedWithoutDelegation':True,
 'systemBubbleStackCountBefore':2,'systemBubbleStackCountDuringSnooze':2,'sourceOverlayStillPresent':True},
 'userAcceptance':{'hideOriginalBubbleInsideBop':False,'dragForeignBubbleIntoRoom':'not implemented or tested','restoreOriginalBubbleOnDemand':'not implemented; foreign notification repost denied',
 'messengerAndZaloCompatibility':'not tested'},
 'artifacts':[]}
for name in ['waitroom-source-lab.apk','waitroom-room-lab.apk']:
 p=ROOT/'artifacts'/name;report['artifacts'].append({'file':'artifacts/'+name,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
(E/'results.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
