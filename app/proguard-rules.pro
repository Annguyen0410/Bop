# Release build rules. The app has no reflection, no serialization library and no JS bridge, so the
# default AGP rules are enough; these entries only make sure the pieces Android calls by name survive
# shrinking in the store build.

# The notification listener is bound by the system through its manifest entry.
-keep class com.example.twoaccmess.HubNotificationListener { *; }

# The application class is instantiated from the manifest and must keep its attachBaseContext hook.
-keep class com.example.twoaccmess.HubApplication { *; }

# The overlay service and the alert action receiver are started by the system.
-keep class com.example.twoaccmess.FloatingHubService { *; }
-keep class com.example.twoaccmess.HubAlertActionReceiver { *; }

# Every slot activity is launched by class name from MessengerWeb; keep them and their slot fields.
-keep class com.example.twoaccmess.MessengerWeb*Activity { *; }
-keep class com.example.twoaccmess.DynamicWebActivity { *; }

# WebView JS is never bridged into the app, so no JavaScript interface names need keeping.
# Keep line numbers readable in a crash report while still shrinking.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile