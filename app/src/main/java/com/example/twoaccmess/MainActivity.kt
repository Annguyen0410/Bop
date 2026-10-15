package com.example.twoaccmess

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.example.twoaccmess.ui.theme.TwoAccMessTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.DateFormat
import java.util.Date

private val Ink = Color(0xFF211B38)
private val Lilac = Color(0xFFE3D9FF)
private val Lime = Color(0xFFD8F875)
private val Peach = Color(0xFFFFDBCA)

open class MainActivity : ComponentActivity() {
    private var selected by mutableStateOf<AccountId?>(null)
    private var refreshVersion by mutableIntStateOf(0)
    private var nativeTools by mutableStateOf(false)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        selected = accountId(savedInstanceState?.getString(ACCOUNT_EXTRA) ?: intent.getStringExtra(ACCOUNT_EXTRA).orEmpty())
        nativeTools = savedInstanceState?.getBoolean(NATIVE_TOOLS_EXTRA) ?: intent.getBooleanExtra(NATIVE_TOOLS_EXTRA, false)
        setContent {
            val state by HubRepository.state.collectAsState()
            TwoAccMessTheme(darkTheme = ThemeChoice.dark(this, state.themeChoice), dynamicColor = false) {
                HubScreen(this, state, selected, { selected = it }, refreshVersion, { refreshVersion++ }, nativeTools, { nativeTools = it })
            }
        }
    }
    override fun onResume() {
        super.onResume()
        refreshVersion++
        HubNotificationListener.refresh()
        if (!HubPlatform.notificationAccess(this)) {
            HubRepository.disconnected(); HubNotificationListener.invalidateAll(); HubNotifications.clear(this)
        }
        if (HubRepository.isLocked(this)) HubRepository.clearPreviews()
    }
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent); setIntent(intent)
        selected = accountId(intent.getStringExtra(ACCOUNT_EXTRA).orEmpty())
        nativeTools = intent.getBooleanExtra(NATIVE_TOOLS_EXTRA, false)
    }
    override fun onSaveInstanceState(outState: Bundle) {
        outState.putString(ACCOUNT_EXTRA, selected?.name)
        outState.putBoolean(NATIVE_TOOLS_EXTRA, nativeTools)
        super.onSaveInstanceState(outState)
    }
    companion object {
        const val ACCOUNT_EXTRA = "account"
        const val NATIVE_TOOLS_EXTRA = "native-tools"
        fun accountId(value: String) = AccountId.from(value)
    }
}
class HubPanelActivity : MainActivity()

@Composable
private fun HubScreen(activity: MainActivity, state: HubState, selected: AccountId?, select: (AccountId?) -> Unit,
                      refreshVersion: Int, refresh: () -> Unit, nativeTools: Boolean, showNativeTools: (Boolean) -> Unit) {
    var page by rememberSaveable { mutableStateOf("Spaces") }
    LaunchedEffect(nativeTools) { if (nativeTools) page = "Alerts" else if (page == "Alerts") page = "Spaces" }
    var query by rememberSaveable { mutableStateOf("") }
    var filter by rememberSaveable { mutableStateOf<String?>(null) }
    var noteDraft by rememberSaveable { mutableStateOf("") }
    var noteHost by rememberSaveable { mutableStateOf("") }
    var notePort by rememberSaveable { mutableStateOf("38671") }
    var noteToken by rememberSaveable { mutableStateOf("") }
    var pairingCode by rememberSaveable { mutableStateOf("") }
    var notesError by remember { mutableStateOf("") }
    val linkedNotes = state.notes
    val scope = rememberCoroutineScope()
    LaunchedEffect(state.ready, state.notesHost, state.notesPort, state.notesToken) {
        if (state.ready) {
            noteHost = state.notesHost
            notePort = state.notesPort.toString()
            noteToken = state.notesToken
        }
    }
    fun syncNotesNow() {
        val port = notePort.toIntOrNull() ?: 0
        scope.launch {
            try {
                val merged = withContext(Dispatchers.IO) { LinkedNotes.sync(noteHost, port, noteToken, HubRepository.linkedNotes()) }
                HubRepository.saveLinkedNotes(merged); notesError = "Synced with desktop."
            } catch (failure: Exception) { notesError = "Not connected yet: ${failure.message ?: "check Wi‑Fi and the desktop pairing details"}" }
        }
    }
    val localNetworkPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) { HubRepository.startNotesSync(); syncNotesNow() }
        else notesError = "Allow local network access to connect to your paired desktop."
    }
    fun syncNotes() {
        if (Build.VERSION.SDK_INT >= 37 && ContextCompat.checkSelfPermission(activity, "android.permission.ACCESS_LOCAL_NETWORK") != PackageManager.PERMISSION_GRANTED) {
            localNetworkPermission.launch("android.permission.ACCESS_LOCAL_NETWORK")
        } else syncNotesNow()
    }
    fun pairNotes() {
        val parsed = LinkedNotes.parsePairingCode(pairingCode)
        if (parsed != null) { noteHost = parsed.host; notePort = parsed.port.toString(); noteToken = parsed.token }
        val port = notePort.toIntOrNull()
        val privateHost = LinkedNotes.normalizePrivateHost(noteHost)
        if (privateHost == null || port != 38671 || !noteToken.matches(Regex("[a-fA-F0-9]{64}"))) {
            notesError = "Enter the desktop's private Wi‑Fi IPv4, port 38671 and 64-character pairing token."; return
        }
        noteHost = privateHost
        HubRepository.pairNotes(noteHost, port, noteToken)
        notesError = "Paired. Syncing while this app stays open."
        syncNotes()
    }
    val imagePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) scope.launch {
            val caption = noteDraft
            val picture = withContext(Dispatchers.IO) { LinkedNotes.image(activity, uri) }
            if (picture == null) notesError = "Couldn't use this picture; choose a smaller image."
            else {
                HubRepository.saveLinkedNotes(listOf(LinkedNotes.create(caption, picture.first, picture.second)))
                noteDraft = ""; notesError = ""
                syncNotes()
            }
        }
    }
    var appPicker by remember { mutableStateOf<AccountId?>(null) }
    var adding by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf<AccountId?>(null) }
    var renaming by remember { mutableStateOf<AccountId?>(null) }
    var removing by remember { mutableStateOf<AccountId?>(null) }
    var binding by remember { mutableStateOf<AccountId?>(null) }
    var detail by remember(selected) { mutableStateOf<AlertKey?>(null) }
    var workConsent by remember { mutableStateOf(false) }
    var diagnosticsOpen by rememberSaveable { mutableStateOf(false) }
    val environments = remember(refreshVersion) { HubPlatform.environments(activity) }
    var profileSupport by remember(refreshVersion) { mutableStateOf<Boolean?>(null) }
    LaunchedEffect(refreshVersion) { profileSupport = withContext(Dispatchers.IO) { SpaceSessions.supported() } }
    fun feedback(text: String?) { text?.let { Toast.makeText(activity, it, Toast.LENGTH_LONG).show() } }
    fun settings(intent: Intent) { if (!HubPlatform.openSettings(activity, intent)) feedback("This setting is unavailable on your phone.") }
    fun refreshBubble() {
        if (!state.overlayRunning) return
        try { activity.startService(Intent(activity, FloatingHubService::class.java).setAction(FloatingHubService.REFRESH)) }
        catch (_: IllegalStateException) { feedback("Reopen the bubble to apply this change.") }
        catch (_: SecurityException) { feedback("Check the floating-window permission.") }
    }
    val postingPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { refresh() }
    fun allowNotifications() {
        if (Build.VERSION.SDK_INT >= 33) postingPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        else settings(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:${activity.packageName}")))
    }
    fun toggleBubble() {
        when {
            state.overlayRunning -> activity.stopService(Intent(activity, FloatingHubService::class.java))
            !Settings.canDrawOverlays(activity) -> settings(HubPlatform.overlaySettings(activity))
            !HubPlatform.canNotify(activity) -> allowNotifications()
            else -> try { ContextCompat.startForegroundService(activity, Intent(activity, FloatingHubService::class.java).setAction(FloatingHubService.START)) }
                catch (_: IllegalStateException) { feedback("Keep Bop open and try again.") }
                catch (_: SecurityException) { feedback("Check bubble and notification permissions.") }
        }
    }
    var avatarTarget by remember { mutableStateOf<String?>(null) }
    val avatarPicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        val target = avatarTarget; avatarTarget = null
        if (uri != null && target != null) scope.launch {
            val saved = withContext(Dispatchers.IO) { AvatarStore.save(activity, target, uri) }
            if (saved) { refreshBubble(); refresh() } else feedback("Couldn't read this picture. Your previous icon is unchanged.")
        }
    }
    fun pickAvatar(target: String) {
        avatarTarget = target
        try { avatarPicker.launch("image/*") }
        catch (_: ActivityNotFoundException) { avatarTarget = null; feedback("No photo picker is available.") }
    }
    if (!state.ready) { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }; return }
    if (!state.disclosureAccepted) { Onboarding { HubRepository.acceptDisclosure() }; return }
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        bottomBar = {
            Surface(color = MaterialTheme.colorScheme.surface, tonalElevation = 1.dp) {
                Row(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 12.dp, vertical = 10.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    listOf("Spaces" to "◒", "Alerts" to "◉", "Notes" to "✎", "Settings" to "⚙", "Guide" to "?").forEach { (label, glyph) ->
                        val active = page == label
                        Column(Modifier.weight(1f).clip(RoundedCornerShape(20.dp))
                            .background(if (active) MaterialTheme.colorScheme.secondaryContainer else Color.Transparent)
                            .clickable { page = label; showNativeTools(label == "Alerts") }
                            .testTag("nav-${label.lowercase()}").padding(vertical = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(glyph, fontSize = 21.sp, color = if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(label, style = MaterialTheme.typography.labelSmall, fontWeight = if (active) FontWeight.Bold else FontWeight.Medium)
                        }
                    }
                }
            }
        }
    ) { insets ->
        LazyColumn(Modifier.fillMaxSize().padding(insets).testTag("page-list"), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
            item {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Image(painterResource(R.drawable.bop_avatar), "Bop", Modifier.size(42.dp).clip(RoundedCornerShape(14.dp)))
                    Text("bop", Modifier.weight(1f).padding(start = 10.dp), fontSize = 29.sp, fontWeight = FontWeight.Black, letterSpacing = (-1).sp)
                    Surface(color = MaterialTheme.colorScheme.surfaceContainerHigh, shape = CircleShape) {
                        Text(if (state.connected) "●  Alerts on" else "○  Alerts off", Modifier.padding(horizontal = 12.dp, vertical = 8.dp), style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
            when (page) {
                "Spaces" -> {
                    item {
                        Card(shape = RoundedCornerShape(32.dp), colors = CardDefaults.cardColors(containerColor = Ink)) {
                            Box(Modifier.fillMaxWidth().padding(22.dp)) {
                                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                                    Text("YOUR LITTLE INTERNET", color = Lilac, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.8.sp)
                                    Text("All your people.\nOne happy place.", color = Color.White, fontSize = 32.sp, lineHeight = 35.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-1).sp)
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Text("${state.slots.size} spaces  /  ${state.slots.map { state.account(it).appId }.distinct().size} apps", color = Lilac, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                                        Surface(color = Lime, shape = CircleShape, modifier = Modifier.clickable { adding = true }.testTag("add-slot")) {
                                            Text("＋ Add", color = Ink, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 18.dp, vertical = 14.dp))
                                        }
                                    }
                                }
                            }
                        }
                    }
                    item {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            MiniTile("Floating bubble", if (state.overlayRunning) "On · tap to stop" else "Off · tap to start", "↗", Lime, Modifier.weight(1f), ::toggleBubble)
                            MiniTile("New chats", "${state.slots.sumOf { state.pending(it) }} observed", "✳", Lilac, Modifier.weight(1f)) { page = "Alerts"; showNativeTools(true) }
                        }
                    }
                    item {
                        OutlinedTextField(query, { query = it }, modifier = Modifier.fillMaxWidth().testTag("space-search"),
                            placeholder = { Text("Find a space or an app") }, leadingIcon = { Text("⌕", fontSize = 25.sp) },
                            trailingIcon = { if (query.isNotEmpty()) TextButton(onClick = { query = "" }) { Text("Clear") } },
                            singleLine = true, shape = RoundedCornerShape(22.dp))
                    }
                    item {
                        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            item { FilterChip(selected = filter == null, onClick = { filter = null }, label = { Text("All spaces") }) }
                            items(state.slots.map { state.account(it).app }.distinctBy { it.id }) { app ->
                                FilterChip(selected = filter == app.id, onClick = { filter = if (filter == app.id) null else app.id }, label = { Text(app.label) })
                            }
                        }
                    }
                    val visible = state.slots.map { state.account(it) }.filter {
                        (filter == null || it.appId == filter) && (query.isBlank() || "${it.label} ${it.app.label} ${it.accountId.name}".contains(query.trim(), true))
                    }
                    item { SectionTitle("Your spaces", "${visible.size}") }
                    items(visible.chunked(2), key = { row -> row.joinToString { it.accountId.name } }) { row ->
                        BoxWithConstraints(Modifier.fillMaxWidth()) {
                            if (maxWidth < 320.dp) Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                                row.forEach { account -> SpaceCard(activity, account, state.pending(account.accountId), refreshVersion, Modifier.fillMaxWidth(),
                                    { feedback(MessengerWeb.open(activity, account.accountId, account.app)) }, { menu = account.accountId }) }
                            } else Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                row.forEach { account -> SpaceCard(activity, account, state.pending(account.accountId), refreshVersion, Modifier.weight(1f),
                                    { feedback(MessengerWeb.open(activity, account.accountId, account.app)) }, { menu = account.accountId }) }
                                if (row.size == 1) Spacer(Modifier.weight(1f))
                            }
                        }
                    }
                    if (visible.isEmpty()) item { EmptyCard("No matches", "Try another name, or clear your filter.") }
                    item { OutlinedButton(onClick = { adding = true }, modifier = Modifier.fillMaxWidth().testTag("add-space-bottom"), shape = RoundedCornerShape(22.dp)) { Text("＋  New space") } }
                }
                "Alerts" -> {
                    item { PageHeading("Catch up.", "Observed notifications, not a full inbox.") }
                    if (!state.connected) item {
                        ActionCard("Connect your alerts", "Let Bop collect supported message notifications.", "Enable access") {
                            settings(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
                        }
                    }
                    item {
                        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            item { FilterChip(selected = selected == null, onClick = { detail = null; select(null) }, label = { Text("All") }) }
                            items(state.slots) { id -> FilterChip(selected = selected == id, onClick = { detail = null; select(id) },
                                label = { Text(state.account(id).label) }) }
                        }
                    }
                    val current = detail?.let { state.alerts[it] }
                    if (current != null) item {
                        ConversationCard(current, state.account(current.key.accountId), { detail = null },
                            { feedback(HubPlatform.openAlert(activity, current.key)) }, { HubRepository.acknowledge(current.conversation) })
                    } else {
                        val alerts = state.slots.filter { selected == null || it == selected }.flatMap { state.conversations(it) }.sortedByDescending { it.postedAt }
                        if (alerts.isEmpty()) item { EmptyCard("You're all caught up", if (state.connected) "No observed alerts. Muted chats may not appear here." else "Connect notification access to get started.") }
                        items(alerts, key = { "${it.key.accountId.name}:${it.key.sourceKey}" }) { alert ->
                            AlertCard(alert, state.account(alert.key.accountId)) { detail = alert.key }
                        }
                    }
                    item { Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = { HubNotificationListener.refresh(); refresh() }, modifier = Modifier.weight(1f)) { Text("Refresh") }
                        TextButton(onClick = { HubRepository.clearPreviews(); HubNotifications.clear(activity) }, modifier = Modifier.weight(1f)) { Text("Clear hub cards") }
                    } }
                }
                "Notes" -> {
                    item { PageHeading("Little notes.", "A tiny chat for things worth keeping.") }
                    item {
                        SettingsCard("Pair with desktop") {
                            Text("On desktop Notes, start LAN sync and copy its pairing code. Paste it here, or enter the private IP, port and token separately. Same private Wi‑Fi only; transfers are encrypted.", style = MaterialTheme.typography.bodySmall)
                            OutlinedTextField(pairingCode, { pairingCode = it.trim().take(180) }, modifier = Modifier.fillMaxWidth().testTag("notes-pairing-code"), label = { Text("Paste desktop pairing code") }, singleLine = true)
                            OutlinedTextField(noteHost, { noteHost = it.trim().take(15) }, modifier = Modifier.fillMaxWidth().testTag("notes-host"), label = { Text("Desktop private IPv4") }, singleLine = true)
                            OutlinedTextField(notePort, { notePort = it.filter(Char::isDigit).take(5) }, modifier = Modifier.fillMaxWidth().testTag("notes-port"), label = { Text("Port") }, singleLine = true)
                            OutlinedTextField(noteToken, { noteToken = it.filter(Char::isLetterOrDigit).take(64) }, modifier = Modifier.fillMaxWidth().testTag("notes-token"), label = { Text("Pairing token") }, singleLine = true)
                            Text("Sync status: ${state.notesSyncStatus}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Button(onClick = { pairNotes() }, modifier = Modifier.weight(1f)) { Text("Pair / sync") }
                                OutlinedButton(onClick = { HubRepository.clearNotesPairing(); noteToken = ""; notesError = "Pairing removed." }, modifier = Modifier.weight(1f)) { Text("Unpair") }
                            }
                            if (notesError.isNotBlank()) Text(notesError, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
                        }
                    }
                    item {
                        SettingsCard("Add a note") {
                            OutlinedTextField(noteDraft, { noteDraft = it.take(4000) }, modifier = Modifier.fillMaxWidth().testTag("note-draft"), label = { Text("Text or reminder") }, minLines = 2, maxLines = 5)
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Button(onClick = { if (noteDraft.isNotBlank()) { HubRepository.saveLinkedNotes(listOf(LinkedNotes.create(noteDraft))); noteDraft = ""; syncNotes() } }, modifier = Modifier.weight(1f), enabled = noteDraft.isNotBlank()) { Text("Save note") }
                                OutlinedButton(onClick = { imagePicker.launch("image/*") }, modifier = Modifier.weight(1f)) { Text("＋ Image") }
                            }
                        }
                    }
                    val visibleNotes = linkedNotes.filter { it.deletedAt <= 0 }
                    if (visibleNotes.isEmpty()) item { EmptyCard("Nothing jotted down", "Text notes and images you save here will also appear on the paired desktop.") }
                    items(visibleNotes.asReversed(), key = { it.id }) { note ->
                        SettingsCard(note.sender + " · " + DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(note.timestamp))) {
                            if (note.text.isNotBlank()) Text(note.text)
                            if (note.image.isNotBlank()) LinkedNotes.decodeImage(note.image)?.let { bitmap -> Image(bitmap.asImageBitmap(), "Attached note image", Modifier.fillMaxWidth().heightIn(max = 320.dp).clip(RoundedCornerShape(18.dp)), contentScale = ContentScale.Fit) }
                            TextButton(onClick = {
                                HubRepository.saveLinkedNotes(linkedNotes + LinkedNotes.tombstone(note))
                                syncNotes()
                            }) { Text("Delete on both devices") }
                        }
                    }
                    item { OutlinedButton(onClick = { syncNotes() }, modifier = Modifier.fillMaxWidth()) { Text("Sync now") } }
                }
                "Settings" -> {
                    item { PageHeading("Make it yours.", "Small tweaks. Your kind of Bop.") }
                    if (state.settingsError) item { EmptyCard("Settings need attention", "Changes couldn't be saved. Unlock your phone and try again.") }
                    item {
                        SettingsCard("Appearance") {
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                ThemeChoice.entries.forEach { choice ->
                                    FilterChip(state.themeChoice == choice, { HubRepository.setTheme(activity, choice); refreshBubble(); refresh() },
                                        label = { Text(choice.name.lowercase().replaceFirstChar { it.uppercase() }) }, modifier = Modifier.weight(1f).testTag("theme-${choice.name.lowercase()}"))
                                }
                            }
                        }
                    }
                    item {
                        SettingsCard("Bubble studio") {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Avatar(activity, AvatarPolicy.BUBBLE, "", 56, refreshVersion, Color(0xFF7862BC), brand = true)
                                Column(Modifier.weight(1f).padding(start = 12.dp)) { Text("Edge-hugging bubble", fontWeight = FontWeight.SemiBold); Text("Drag. Drop. It docks.", style = MaterialTheme.typography.bodySmall) }
                            }
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                OutlinedButton(onClick = { pickAvatar(AvatarPolicy.BUBBLE) }, modifier = Modifier.testTag("avatar-pick-bubble")) { Text("Choose picture") }
                                TextButton(onClick = { AvatarStore.clear(activity, AvatarPolicy.BUBBLE); refreshBubble(); refresh() }) { Text("Reset") }
                            }
                            Button(onClick = ::toggleBubble, modifier = Modifier.fillMaxWidth()) { Text(if (state.overlayRunning) "Stop bubble" else "Start bubble") }
                        }
                    }
                    item {
                        SettingsCard("Permissions & alerts") {
                            SettingRow("Notification access", if (HubPlatform.notificationAccess(activity)) "Allowed" else "Off", "Manage") { settings(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)) }
                            SettingRow("Bop notifications", if (HubPlatform.canNotify(activity)) "Allowed" else "Off", "Manage", ::allowNotifications)
                            SettingRow("Float over apps", if (Settings.canDrawOverlays(activity)) "Allowed" else "Off", "Manage") { settings(HubPlatform.overlaySettings(activity)) }
                            ToggleRow("Message cards", state.mirrorAlerts) { HubRepository.setMirror(it) }
                            ToggleRow("Work previews", state.workPreviews) { if (it) workConsent = true else HubRepository.setWorkPreviews(false) }
                            OutlinedButton(onClick = { if (!HubNotifications.sendTest(activity, state)) feedback("Allow Bop notifications first.") },
                                modifier = Modifier.fillMaxWidth().testTag("send-test-alerts")) { Text("Send test alerts") }
                        }
                    }
                    item {
                        val batteryExempt = remember(refreshVersion) { HubPlatform.batteryExempt(activity) }
                        val reliability = HubReliability.checks(
                            notifyAllowed = HubPlatform.canNotify(activity),
                            listenerAccess = HubPlatform.notificationAccess(activity),
                            listenerConnected = state.connected,
                            overlayAllowed = Settings.canDrawOverlays(activity),
                            batteryExempt = batteryExempt,
                            webProfiles = profileSupport)
                        val oem = HubReliability.oemAdvice(Build.MANUFACTURER, Build.BRAND)
                            ?: OemAdvice("generic", "Your phone", HubReliability.GENERIC_STEPS)
                        fun repair(key: ReliabilityCheck.Key) = when (key) {
                            ReliabilityCheck.Key.Notifications -> allowNotifications()
                            ReliabilityCheck.Key.Listener -> settings(HubPlatform.listenerSettings())
                            ReliabilityCheck.Key.ListenerAlive -> {
                                HubPlatform.requestListenerRebind(activity); HubNotificationListener.refresh(); refresh()
                            }
                            ReliabilityCheck.Key.Overlay -> settings(HubPlatform.overlaySettings(activity))
                            ReliabilityCheck.Key.Battery -> settings(HubPlatform.batterySettings(activity))
                            ReliabilityCheck.Key.WebProfiles -> page = "Guide"
                        }
                        SettingsCard("Runs on every phone") {
                            Text(HubReliability.statusLine(reliability), style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.SemiBold,
                                color = if (HubReliability.allOk(reliability)) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error)
                            reliability.forEach { check ->
                                SettingRow(check.title, check.status, if (check.ok) "Manage" else "Fix") { repair(check.key) }
                                if (!check.ok) Text(check.advice, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            Text("${oem.label} · extra steps", fontWeight = FontWeight.SemiBold)
                            oem.steps.forEach { Text("• $it", style = MaterialTheme.typography.bodySmall) }
                            OutlinedButton(onClick = {
                                val targets = HubPlatform.autoStartSettings(oem.key) + HubPlatform.appDetailsSettings(activity)
                                if (targets.none { HubPlatform.openSettings(activity, it) })
                                    feedback("Open Settings → Apps → Bop and allow background activity.")
                            }, modifier = Modifier.fillMaxWidth().testTag("oem-settings")) { Text("Open ${oem.label} settings") }
                            Text(HubPlatform.deviceLabel(activity), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    item {
                        SettingsCard("Native Messenger routes") {
                            Text("Optional · separate from your web logins", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            state.slots.filter { state.account(it).appId == HubApps.MESSENGER_ID || state.account(it).profileSerial != null }.forEach { id ->
                                SettingRow(state.account(id).label, if (state.account(id).profileSerial == null) "Not linked" else "Profile ${state.account(id).profileSerial}", "Link") { binding = id }
                            }
                        }
                    }
                    item {
                        SettingsCard("About Bop") {
                            Text("2.0 · made for your many selves", style = MaterialTheme.typography.bodyMedium)
                            SettingRow("Browser profiles", when (profileSupport) { true -> "Dynamic spaces supported"; false -> "Update System WebView for extra spaces"; null -> "Checking…" }, "Guide") { page = "Guide" }
                            TextButton(onClick = { diagnosticsOpen = !diagnosticsOpen }) { Text(if (diagnosticsOpen) "Hide diagnostics" else "Session diagnostics") }
                            if (diagnosticsOpen) {
                                val crash = CrashLog.read(activity)
                                val report = WebSessionReport.diagnostics("Bop · Android ${Build.VERSION.RELEASE}", crash, state.slots.map { it to WebSessionRuntime.read(activity, it) })
                                Text(report.take(2400), style = MaterialTheme.typography.bodySmall)
                                Row { TextButton(onClick = { copy(activity, report) }) { Text("Copy report") }; TextButton(onClick = { CrashLog.clear(activity); refresh() }) { Text("Clear crash") } }
                            }
                        }
                    }
                }
                "Guide" -> {
                    item { PageHeading("The tiny manual.", "Everything useful. Nothing in your way.") }
                    item { MiniTile("Welcome to Bop", "One hub. Many versions of you.", "✳", Peach, Modifier.fillMaxWidth()) {} }
                    items(GuideContent.sections) { section -> GuideCard(section.first, section.second) }
                    item { Text("Bop is an independent hub, not an official client of these services.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
            }
        }
    }
    if (adding || appPicker != null) AppPicker(
        title = if (adding) "A new little space" else "Choose an app", dismiss = { adding = false; appPicker = null },
        choose = { app ->
            val id = if (adding) HubReducer.nextFree(HubRepository.state.value) else appPicker
            if (id == null) feedback("Couldn't allocate a new space.")
            else if (!id.legacy && profileSupport != true) feedback("Update Android System WebView or Chrome before adding more spaces. Existing spaces are unchanged.")
            else { if (adding) HubRepository.addSlot(id); HubRepository.selectApp(id, app.id); filter = null; query = ""; refresh() }
            adding = false; appPicker = null
        })
    menu?.let { id ->
        val account = state.account(id)
        AlertDialog(onDismissRequest = { menu = null }, title = { Text(account.label) }, text = {
            Column {
                Text("${account.app.label} · space ${id.name}", style = MaterialTheme.typography.bodySmall)
                MenuAction("Rename", "rename-${id.name}") { menu = null; renaming = id }
                MenuAction("Change app", "app-pick-${id.name}") { menu = null; appPicker = id }
                MenuAction("Choose picture", "avatar-pick-${id.name}") { menu = null; pickAvatar(AvatarPolicy.slot(id)) }
                MenuAction("Reset picture", "avatar-clear-${id.name}") { AvatarStore.clear(activity, AvatarPolicy.slot(id)); refreshBubble(); refresh(); menu = null }
                if (id != AccountId.A && id != AccountId.B) MenuAction("Remove space", "slot-remove-${id.name}") { menu = null; removing = id }
            }
        }, confirmButton = { TextButton(onClick = { menu = null }) { Text("Done") } })
    }
    renaming?.let { id ->
        var label by remember(id) { mutableStateOf(state.account(id).label) }
        AlertDialog(onDismissRequest = { renaming = null }, title = { Text("Name this space") },
            text = { OutlinedTextField(label, { label = it.take(40) }, label = { Text("Name") }, singleLine = true, modifier = Modifier.testTag("space-name")) },
            confirmButton = { TextButton(onClick = { HubRepository.rename(id, label); refreshBubble(); renaming = null }) { Text("Save") } },
            dismissButton = { TextButton(onClick = { renaming = null }) { Text("Cancel") } })
    }
    removing?.let { id -> AlertDialog(onDismissRequest = { removing = null }, title = { Text("Remove ${state.account(id).label}?") },
        text = { Text("This hides the space and clears its hub alerts. Its local login and picture stay on this phone; clear the session from its browser first if you want to log out.") },
        confirmButton = { TextButton(onClick = { HubRepository.removeSlot(id); if (selected == id) select(null); filter = null; removing = null; refreshBubble() }) { Text("Remove") } },
        dismissButton = { TextButton(onClick = { removing = null }) { Text("Keep") } }) }
    binding?.let { id -> BindingDialog(state.account(id), state.accounts, environments, { binding = null }) { serial, label ->
        if (HubRepository.bind(id, serial, label)) { binding = null; HubNotificationListener.refresh() } else feedback("That installation is already linked to another space.")
    } }
    if (workConsent) AlertDialog(onDismissRequest = { workConsent = false }, title = { Text("Allow work previews?") },
        text = { Text("Permitted work sender names and excerpts will be visible in this personal-profile app. Only enable with your administrator's permission. Work notifications stay generic outside the hub.") },
        confirmButton = { TextButton(onClick = { HubRepository.setWorkPreviews(true); workConsent = false }) { Text("Allow") } },
        dismissButton = { TextButton(onClick = { workConsent = false }) { Text("Keep off") } })
}

private object GuideContent {
    val sections = listOf(
        "01 / Your spaces" to "Each space keeps its own website login. Add a space, choose an app, then sign in on its official HTTPS page. Rename it or add a picture from its ⋯ menu. A and B are your permanent starter spaces. Removing a space hides it, but keeps its local session and picture; use Options → Clear local session in its browser to log out first.",
        "02 / No fixed slot ceiling" to "Bop no longer imposes a 16-space limit. A–P keep their existing private processes and logins. Extra spaces use named WebView profiles with separate cookies and website storage, supported by up-to-date Android System WebView/Chrome. If your engine doesn't support this, extra spaces stay blocked rather than sharing a login. Available storage and your WebView provider still impose practical limits. All spaces share Bop's Android UID; this is not work-profile security isolation.",
        "03 / A bubble that hugs the edge" to "Allow notifications and display-over-other-apps in Settings, then start the bubble. Drag it: on release it docks flush to the nearest left or right edge. Tap to pick a space. Opening a menu or a browser never moves the bubble. It hides while the phone is locked; you can stop it in Settings or its notification.",
        "04 / What alerts really mean" to "Alerts come from this phone's own installed apps, never from background web polling. Allow notification access in Settings. Messenger requires an installation linked to a space; other supported apps need exactly one space for that app. Two spaces for the same app are ambiguous, so neither gets guessed alerts. Likes, promos and feed notifications are filtered when Android identifies their category. Notifications with an unknown category may still be shown; accuracy depends on the source app. Muted chats and already-open chats may post nothing. A web-only site cannot send background cards.",
        "05 / Read, dismiss, repeat" to "Tap an alert to see its observed excerpt; Open conversation uses the original app's notification action when still valid. Dismiss in Bop clears its badge, not the real unread status. Swiping a Bop notification acknowledges it for this process; restarting the app can observe an active source again. Bop isn't a complete inbox and can't force an app to generate a missing notification.",
        "06 / Privacy & pictures" to "No Bop server or analytics. WebView keeps cookies, cache and site key material privately on the phone. The hub does not extract credentials or scrape messages. Notification excerpts and action tokens stay in memory. Broad Android notification access is filtered to supported packages. Work previews are off by default. Screenshots and screen recording are allowed, so check for private content before sharing. Chosen pictures are square-cropped without stretching and stored only on this device.",
        "07 / Browser basics" to "The browser always shows the page's domain. Only the selected service's allowed HTTPS origins can open. Use Options to switch desktop/mobile, pick another space or clear this local session. Attachments use Android's document picker; camera/microphone, external popups, downloads and background push aren't enabled. The service controls login, encrypted-history recovery and availability; Bop cannot bypass its restrictions.",
        "08 / Something feels off?" to "Update Android System WebView/Chrome and check your connection. For alerts, check notification access, the source app's permissions and whether you have duplicate spaces for the app. Try Send test alerts in Settings. Session diagnostics can be copied from Settings without passwords, cookies or page URLs. Never share a password, recovery code or secure-storage PIN."
    )
}

@Composable private fun Onboarding(accept: () -> Unit) {
    LazyColumn(Modifier.fillMaxSize().systemBarsPadding(), contentPadding = PaddingValues(26.dp), verticalArrangement = Arrangement.spacedBy(24.dp)) {
        item { Image(painterResource(R.drawable.bop_avatar), "Bop", Modifier.size(96.dp).clip(RoundedCornerShape(30.dp))) }
        item { Text("Many yous.\nOne Bop.", fontSize = 46.sp, lineHeight = 48.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-2).sp) }
        item { Text("A little home for all your accounts.", style = MaterialTheme.typography.titleLarge) }
        item { SettingsCard("Before we start") {
            Text("Sign in only on each app's official website. Separate local sessions; no Bop server or credential extraction.")
            Text("Notification access and the floating bubble are optional. Alerts are partial, not a complete inbox. Work previews stay off.")
            Text("Web logins may be unsupported by the service. Screenshots are allowed. The full Guide is always one tap away.")
        } }
        item { Button(accept, Modifier.fillMaxWidth().heightIn(min = 56.dp), shape = RoundedCornerShape(22.dp)) { Text("I understand · continue") } }
    }
}

@Composable private fun PageHeading(title: String, subtitle: String) {
    Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Text(title, fontSize = 32.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-1).sp)
        Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
@Composable private fun SectionTitle(title: String, suffix: String) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(title, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
        Text(suffix, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
@Composable private fun MiniTile(title: String, subtitle: String, glyph: String, color: Color, modifier: Modifier, click: () -> Unit) {
    Card(modifier.clickable(onClick = click), shape = RoundedCornerShape(26.dp), colors = CardDefaults.cardColors(containerColor = color)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(glyph, fontSize = 27.sp, color = Ink, fontWeight = FontWeight.Bold)
            Text(title, fontWeight = FontWeight.Bold, color = Ink, style = MaterialTheme.typography.titleSmall)
            Text(subtitle, color = Ink.copy(alpha = .7f), style = MaterialTheme.typography.labelMedium)
        }
    }
}
@Composable private fun SpaceCard(activity: MainActivity, account: AccountBinding, pending: Int, refresh: Int, modifier: Modifier, open: () -> Unit, menu: () -> Unit) {
    val accent = Color(account.app.accent)
    Card(modifier, shape = RoundedCornerShape(28.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Avatar(activity, AvatarPolicy.slot(account.accountId), account.accountId.name, 44, refresh, accent)
                Spacer(Modifier.weight(1f))
                TextButton(menu, Modifier.size(48.dp).testTag("space-menu-${account.accountId.name}"), contentPadding = PaddingValues(0.dp)) { Text("⋯", fontSize = 24.sp) }
            }
            Text(account.label, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleMedium)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(6.dp).background(accent, CircleShape))
                Text(account.app.label, Modifier.padding(start = 6.dp).weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (pending > 0) Text(AccountAlerts.badge(pending).orEmpty(), fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
            }
            FilledTonalButton(open, Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("open-${account.accountId.name}"),
                enabled = Build.VERSION.SDK_INT >= WebSessionPolicy.MIN_ANDROID, shape = RoundedCornerShape(16.dp)) { Text("Open  ↗") }
        }
    }
}
@Composable private fun Avatar(activity: MainActivity, key: String, fallback: String, size: Int, refresh: Int, accent: Color, brand: Boolean = false) {
    var picture by remember(key, refresh) { mutableStateOf<Bitmap?>(null) }
    LaunchedEffect(key, refresh) { picture = withContext(Dispatchers.IO) { AvatarStore.read(activity, key) } }
    Box(Modifier.size(size.dp).clip(CircleShape).background(accent.copy(alpha = .12f)), contentAlignment = Alignment.Center) {
        val image = picture
        when {
            image != null -> Image(image.asImageBitmap(), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
            brand -> Image(painterResource(R.drawable.bop_avatar), null, Modifier.fillMaxSize())
            else -> Text(fallback, fontSize = if (fallback.length > 2) 12.sp else 18.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
        }
    }
}
@Composable private fun SettingsCard(title: String, content: @Composable ColumnScope.() -> Unit) {
    Card(Modifier.fillMaxWidth(), shape = RoundedCornerShape(26.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) { Text(title, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium); content() }
    }
}
@Composable private fun SettingRow(title: String, status: String, action: String, click: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) { Text(title, style = MaterialTheme.typography.bodyMedium); Text(status, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        TextButton(click) { Text(action) }
    }
}
@Composable private fun ToggleRow(title: String, checked: Boolean, change: (Boolean) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) { Text(title, Modifier.weight(1f)); Switch(checked, change) }
}
@Composable private fun MenuAction(label: String, tag: String, click: () -> Unit) {
    TextButton(click, Modifier.fillMaxWidth().testTag(tag)) { Text(label, Modifier.fillMaxWidth()) }
}
@Composable private fun EmptyCard(title: String, text: String) { SettingsCard(title) { Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) } }
@Composable private fun ActionCard(title: String, text: String, action: String, click: () -> Unit) { SettingsCard(title) { Text(text); Button(click) { Text(action) } } }
@Composable private fun GuideCard(title: String, body: String) {
    var expanded by rememberSaveable { mutableStateOf(false) }
    Card(Modifier.fillMaxWidth().clickable { expanded = !expanded }, shape = RoundedCornerShape(24.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) { Text(title, Modifier.weight(1f), fontWeight = FontWeight.Bold); Text(if (expanded) "−" else "+", fontSize = 24.sp) }
            if (expanded) Text(body, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
@Composable private fun AppPicker(title: String, dismiss: () -> Unit, choose: (HubApp) -> Unit) {
    var query by remember { mutableStateOf("") }
    AlertDialog(onDismissRequest = dismiss, title = { Text(title) }, text = {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedTextField(query, { query = it }, singleLine = true, placeholder = { Text("Find an app") }, shape = RoundedCornerShape(18.dp))
            Column(Modifier.heightIn(max = 360.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                HubApps.ALL.filter { it.label.contains(query, true) }.forEach { app ->
                    Surface(color = MaterialTheme.colorScheme.surfaceContainerHigh, shape = RoundedCornerShape(16.dp),
                        modifier = Modifier.fillMaxWidth().clickable { choose(app) }.testTag("app-choice-${app.id}")) {
                        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.size(10.dp).background(Color(app.accent), CircleShape))
                            Text(app.label, Modifier.weight(1f).padding(start = 12.dp), fontWeight = FontWeight.SemiBold)
                            Text("↗")
                        }
                    }
                }
            }
        }
    }, confirmButton = { TextButton(dismiss) { Text("Cancel") } })
}
@Composable private fun BindingDialog(current: AccountBinding, accounts: List<AccountBinding>, environments: List<MessengerEnvironment>, dismiss: () -> Unit, save: (Long?, String) -> Unit) {
    var label by remember { mutableStateOf(current.label) }; var serial by remember { mutableStateOf(current.profileSerial) }
    AlertDialog(onDismissRequest = dismiss, title = { Text("Link Messenger") }, text = {
        Column(Modifier.heightIn(max = 400.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            OutlinedTextField(label, { label = it.take(40) }, label = { Text("Space name") }, singleLine = true)
            Text("Links an Android installation, not your website login.", style = MaterialTheme.typography.bodySmall)
            if (environments.isEmpty()) Text("No accessible Messenger installation. Check your profiles.")
            environments.forEach { env -> OutlinedButton({ serial = env.serial }, enabled = env.available && accounts.none { it.accountId != current.accountId && it.profileSerial == env.serial }) { Text("${if (serial == env.serial) "✓ " else ""}${env.title}") } }
            TextButton({ serial = null }) { Text("Unlink") }
        }
    }, confirmButton = { TextButton({ save(serial, label) }) { Text("Save") } }, dismissButton = { TextButton(dismiss) { Text("Cancel") } })
}
@Composable private fun AlertCard(alert: ObservedAlert, account: AccountBinding, select: () -> Unit) {
    Card(Modifier.fillMaxWidth().clickable(onClick = select), shape = RoundedCornerShape(24.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row { Text("${account.app.label} / ${account.label}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary, modifier = Modifier.weight(1f)); if (!alert.acknowledged) Text("●", color = MaterialTheme.colorScheme.primary) }
            Text(alert.title, fontWeight = FontWeight.Bold)
            Text(alert.messages.lastOrNull()?.text ?: "Preview unavailable", maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium)
            Text(DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(alert.postedAt)), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
@Composable private fun ConversationCard(alert: ObservedAlert, account: AccountBinding, back: () -> Unit, open: () -> Unit, acknowledge: () -> Unit) {
    SettingsCard("${account.label} / ${alert.title}") {
        TextButton(back) { Text("‹ Back to alerts") }
        Text("Notification excerpts · not complete history", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        alert.messages.forEach { message -> Surface(color = MaterialTheme.colorScheme.surfaceContainerHigh, shape = RoundedCornerShape(18.dp)) {
            Column(Modifier.fillMaxWidth().padding(14.dp)) { message.sender?.let { Text(it, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.labelMedium) }; Text(message.text) }
        } }
        Button(open, Modifier.fillMaxWidth()) { Text("Open conversation") }
        OutlinedButton(acknowledge, Modifier.fillMaxWidth()) { Text("Acknowledge in hub") }
    }
}
private fun copy(activity: MainActivity, report: String) {
    try { activity.getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText("Bop diagnostics", report)); Toast.makeText(activity, "Report copied", Toast.LENGTH_SHORT).show() }
    catch (_: SecurityException) { Toast.makeText(activity, "Clipboard access is blocked", Toast.LENGTH_SHORT).show() }
}
