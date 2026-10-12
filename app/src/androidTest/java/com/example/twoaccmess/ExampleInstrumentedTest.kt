package com.example.twoaccmess

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.performTextReplacement
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.Before
import androidx.compose.ui.test.performTextInput
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class ExampleInstrumentedTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    @Before fun resetTestState() {
        compose.waitUntil(10_000) { HubRepository.state.value.ready }
        compose.runOnIdle {
            HubRepository.state.value.slots.filter { it != AccountId.A && it != AccountId.B }.forEach { HubRepository.removeSlot(it) }
            HubRepository.bind(AccountId.A, null, "Account A")
            HubRepository.bind(AccountId.B, null, "Account B")
            HubRepository.selectApp(AccountId.A, "messenger")
            HubRepository.selectApp(AccountId.B, "messenger")
            HubRepository.clearPreviews()
            HubRepository.acceptDisclosure()
        }
    }

    @Test fun webEntryPointsRemainAvailableWithoutNativeProfileBindings() {
        compose.waitUntil(10_000) { HubRepository.state.value.ready }
        if (!HubRepository.state.value.disclosureAccepted) {
            compose.onNodeWithText("I understand · continue").performScrollTo().performClick()
        }
        compose.runOnIdle {
            assertTrue(HubRepository.bind(AccountId.A, null, "Account A"))
            assertTrue(HubRepository.bind(AccountId.B, null, "Account B"))
        }
        // Only the two base slots are visible until the user adds one.
        assertEquals(listOf(AccountId.A, AccountId.B), HubRepository.state.value.slots)
        HubRepository.state.value.slots.forEach { id ->
            val button = compose.onNodeWithTag("open-${id.name}").performScrollTo()
            if (android.os.Build.VERSION.SDK_INT >= WebSessionPolicy.MIN_ANDROID) button.assertIsEnabled()
            else button.assertIsNotEnabled()
        }
        compose.onNodeWithTag("add-slot").performScrollTo().assertExists()
        AccountId.entries.forEach { id ->
            val target = MessengerWeb.intent(compose.activity, id).component!!
            val info = compose.activity.packageManager.getActivityInfo(target, 0)
            assertEquals(WebSessionPolicy.processName(compose.activity.packageName, id), info.processName)
            assertFalse("Browser activities must not be externally launchable", info.exported)
            assertEquals(android.content.pm.ActivityInfo.LAUNCH_SINGLE_TASK, info.launchMode)
        }
        compose.onNodeWithTag("nav-alerts").performClick()
        compose.onNodeWithText("Catch up.").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("nav-spaces").performClick()
        compose.onNodeWithTag("open-A").performScrollTo().assertExists()
        compose.onNodeWithTag("open-B").performScrollTo().assertExists()
    }

    @Test fun everySlotOwnsItsProcessStorageChannelAndPicturePicker() {
        compose.waitUntil(10_000) { HubRepository.state.value.ready }
        if (!HubRepository.state.value.disclosureAccepted) {
            compose.onNodeWithText("I understand · continue").performScrollTo().performClick()
        }
        val packageName = compose.activity.packageName
        val manager = compose.activity.getSystemService(android.app.NotificationManager::class.java)
        assertEquals(listOf(AccountId.A, AccountId.B), HubRepository.state.value.slots)
        compose.runOnIdle {
            assertTrue(HubRepository.addSlot(AccountId.C))
            assertTrue(HubRepository.addSlot(AccountId.D))
        }
        assertEquals(4, HubRepository.state.value.slots.size)
        assertEquals(AccountId.E, HubReducer.nextFree(HubRepository.state.value))
        // Slots are no longer capped at four: the Add slot button opens the app chooser and creates
        // the next free letter with its own process. This is the UI path a user takes.
        compose.onNodeWithTag("add-slot").performScrollTo().performClick()
        compose.onNodeWithTag("app-choice-instagram").performClick()
        compose.runOnIdle {
            assertEquals(5, HubRepository.state.value.slots.size)
            assertEquals(AccountId.E, HubRepository.state.value.slots.last())
            assertEquals("instagram", HubRepository.state.value.account(AccountId.E).appId)
            assertEquals(AccountId.F, HubReducer.nextFree(HubRepository.state.value))
        }
        assertEquals(AccountId.entries.size, AccountId.entries.map { WebSessionPolicy.processName(packageName, it) }.distinct().size)
        assertEquals(AccountId.entries.size, AccountId.entries.map { AvatarPolicy.slot(it) }.distinct().size)
        compose.runOnIdle {
            HubNotifications.createChannels(compose.activity, HubRepository.state.value.slots)
            AccountId.entries.forEach { id ->
                val info = compose.activity.packageManager.getActivityInfo(MessengerWeb.intent(compose.activity, id).component!!, 0)
                assertEquals(WebSessionPolicy.processName(packageName, id), info.processName)
                assertEquals(id, WebSessionPolicy.accountForProcess(packageName, info.processName))
                assertFalse(info.exported)
                assertTrue(info.taskAffinity.endsWith(".web.${id.name.lowercase()}"))
                // A slot name outside the declared pool must never resolve to a stored picture.
                assertEquals(0L, AvatarStore.stamp(compose.activity, "account_../q"))
                assertFalse("An unsafe slot name must never resolve", AvatarStore.has(compose.activity, "account_../q"))
                if (android.os.Build.VERSION.SDK_INT >= 26) {
                    val channel = manager.getNotificationChannel(HubNotifications.channel(id))
                    if (id in HubRepository.state.value.slots) assertNotNull("Enabled account ${id.name} needs its own alert channel", channel)
                    else assertNull("Removed or disabled accounts must not keep channels", channel)
                }
            }
            assertEquals(AccountId.entries.size, AccountId.entries.map {
                compose.activity.packageManager.getActivityInfo(MessengerWeb.intent(compose.activity, it).component!!, 0).taskAffinity
            }.distinct().size)
        }
        HubRepository.state.value.slots.forEach { id ->
            compose.onNodeWithTag("page-list").performScrollToNode(hasTestTag("space-menu-${id.name}"))
            compose.onNodeWithTag("space-menu-${id.name}").performClick()
            compose.onNodeWithTag("avatar-pick-${id.name}").assertExists()
            compose.onNodeWithTag("app-pick-${id.name}").assertExists()
            compose.onNodeWithText("Done").performClick()
        }
        // Removing an added slot hides its card again and leaves the two base slots alone.
        compose.runOnIdle { assertTrue(HubRepository.removeSlot(AccountId.E)) }
        compose.runOnIdle { assertTrue(HubRepository.removeSlot(AccountId.D)) }
        assertEquals(listOf(AccountId.A, AccountId.B, AccountId.C), HubRepository.state.value.slots)
        // The removed letters come back to the pool for the next slot the user creates.
        assertEquals(AccountId.D, HubReducer.nextFree(HubRepository.state.value))
        compose.runOnIdle { assertTrue(HubRepository.removeSlot(AccountId.C)) }
        assertEquals(listOf(AccountId.A, AccountId.B), HubRepository.state.value.slots)
        compose.onNodeWithTag("nav-settings").performClick()
        compose.onNodeWithTag("page-list").performScrollToNode(hasText("Native Messenger routes"))
        compose.onNodeWithText("Native Messenger routes").assertIsDisplayed()
        compose.onNodeWithTag("page-list").performScrollToNode(hasTestTag("send-test-alerts"))
        compose.onNodeWithTag("send-test-alerts").assertExists()
        compose.onNodeWithTag("nav-spaces").performClick()
    }

    @Test fun renameSearchAndGuideAreAvailableThroughTheNewNavigation() {
        compose.onNodeWithTag("space-menu-A").performScrollTo().performClick()
        compose.onNodeWithTag("rename-A").performClick()
        compose.onNodeWithTag("space-name").performTextReplacement("Friends")
        compose.onNodeWithText("Save").performClick()
        compose.runOnIdle { assertEquals("Friends", HubRepository.state.value.account(AccountId.A).label) }
        compose.onNodeWithTag("space-search").performScrollTo().performTextInput("Friends")
        compose.onNodeWithTag("open-A").performScrollTo().assertExists()
        compose.onNodeWithTag("open-B").assertDoesNotExist()
        compose.onNodeWithTag("nav-guide").performClick()
        compose.onNodeWithText("The tiny manual.").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("page-list").performScrollToNode(hasText("02 / No fixed slot ceiling"))
        compose.onNodeWithText("02 / No fixed slot ceiling").performClick()
        compose.onNodeWithText("Bop no longer imposes a 16-space limit.", substring = true).performScrollTo().assertIsDisplayed()
    }

    @Test fun moreThanSixteenSpacesPersistWithoutLosingTheirApps() {
        compose.runOnIdle {
            repeat(15) { HubRepository.addSlot(HubReducer.nextFree(HubRepository.state.value)!!) }
            HubRepository.selectApp(AccountId(16), "telegram")
        }
        assertEquals(17, HubRepository.state.value.slots.size)
        compose.onNodeWithTag("page-list").performScrollToNode(hasTestTag("open-Q"))
        compose.onNodeWithTag("open-Q").assertIsEnabled()
        compose.waitUntil(10_000) { SpaceSessions.index(compose.activity).any { it.first == AccountId(16) && it.second.id == "telegram" } }
        assertEquals(DynamicWebActivity::class.java.name, MessengerWeb.intent(compose.activity, AccountId(16)).component!!.className)
        assertEquals("Q", MessengerWeb.intent(compose.activity, AccountId(16)).getStringExtra(MessengerWeb.EXTRA_SLOT))
    }

    @Test fun alertFilterMatchesThePlatformCategoriesAndRejectsFeedNoise() {
        // The JVM tests pin the strings; this run proves they are the platform's own values, so a
        // renamed constant cannot silently turn a promo into an "Account X has a message" card.
        assertEquals(android.app.Notification.CATEGORY_MESSAGE, AlertFilter.CATEGORY_MESSAGE)
        assertEquals(android.app.Notification.CATEGORY_EMAIL, AlertFilter.CATEGORY_EMAIL)
        assertEquals(android.app.Notification.CATEGORY_CALL, AlertFilter.CATEGORY_CALL)
        assertEquals(android.app.Notification.CATEGORY_MISSED_CALL, AlertFilter.CATEGORY_MISSED_CALL)
        assertEquals(android.app.Notification.CATEGORY_PROMO, AlertFilter.CATEGORY_PROMO)
        assertEquals(android.app.Notification.CATEGORY_SOCIAL, AlertFilter.CATEGORY_SOCIAL)
        assertEquals(android.app.Notification.CATEGORY_RECOMMENDATION, AlertFilter.CATEGORY_RECOMMENDATION)
        assertEquals(android.app.Notification.CATEGORY_STATUS, AlertFilter.CATEGORY_STATUS)
        assertEquals(android.app.Notification.CATEGORY_PROGRESS, AlertFilter.CATEGORY_PROGRESS)
        assertEquals(android.app.Notification.CATEGORY_SERVICE, AlertFilter.CATEGORY_SERVICE)
        assertEquals(android.app.Notification.CATEGORY_TRANSPORT, AlertFilter.CATEGORY_TRANSPORT)
        assertEquals(android.app.Notification.CATEGORY_SYSTEM, AlertFilter.CATEGORY_SYSTEM)
        assertEquals(android.app.Notification.CATEGORY_ERROR, AlertFilter.CATEGORY_ERROR)
        assertEquals(android.app.Notification.CATEGORY_ALARM, AlertFilter.CATEGORY_ALARM)
        assertEquals(android.app.Notification.CATEGORY_EVENT, AlertFilter.CATEGORY_EVENT)
        assertEquals(android.app.Notification.CATEGORY_REMINDER, AlertFilter.CATEGORY_REMINDER)
        assertEquals(android.app.Notification.CATEGORY_LOCATION_SHARING, AlertFilter.CATEGORY_LOCATION)
        assertEquals(android.app.Notification.CATEGORY_STOPWATCH, AlertFilter.CATEGORY_STOPWATCH)
        assertEquals(android.app.Notification.CATEGORY_WORKOUT, AlertFilter.CATEGORY_WORKOUT)
        assertEquals(android.app.Notification.CATEGORY_NAVIGATION, AlertFilter.CATEGORY_NAVIGATION)
        // A like/comment notification must not claim a slot, a chat message must.
        assertFalse(AlertFilter.messageLike(android.app.Notification.CATEGORY_SOCIAL, false, false))
        assertTrue(AlertFilter.messageLike(android.app.Notification.CATEGORY_MESSAGE, false, false))
        assertTrue(AlertFilter.messageLike(null, true, false))
    }

    @Test fun theAppearanceChoiceIsAppliedAndPersisted() {
        compose.waitUntil(10_000) { HubRepository.state.value.ready }
        if (!HubRepository.state.value.disclosureAccepted) {
            compose.onNodeWithText("I understand · continue").performScrollTo().performClick()
        }
        // Each choice round-trips through the encrypted settings and the cross-process mirror.
        ThemeChoice.entries.forEach { choice ->
            compose.runOnIdle { HubRepository.setTheme(compose.activity, choice) }
            assertEquals(choice, HubRepository.state.value.themeChoice)
            assertEquals(choice, HubThemeStore.read(compose.activity))
        }
        compose.runOnIdle { HubRepository.setTheme(compose.activity, ThemeChoice.SYSTEM) }
        compose.onNodeWithTag("nav-settings").performClick()
        ThemeChoice.entries.forEach { choice ->
            compose.onNodeWithTag("theme-${choice.name.lowercase()}").performScrollTo().assertExists()
        }
        compose.onNodeWithTag("theme-dark").performScrollTo().performClick()
        compose.runOnIdle { assertEquals(ThemeChoice.DARK, HubRepository.state.value.themeChoice) }
        compose.onNodeWithTag("theme-light").performScrollTo().performClick()
        compose.runOnIdle { assertEquals(ThemeChoice.LIGHT, HubRepository.state.value.themeChoice) }
        compose.onNodeWithTag("theme-system").performScrollTo().performClick()
        compose.runOnIdle { assertEquals(ThemeChoice.SYSTEM, HubRepository.state.value.themeChoice) }
        compose.onNodeWithTag("nav-spaces").performClick()
    }

    @Test fun cockpitRoutesSyntheticAlertsWithoutMixingAccountsAndPersistsOnlyEncryptedSettings() {
        compose.waitUntil(10_000) { HubRepository.state.value.ready }
        if (!HubRepository.state.value.disclosureAccepted) {
            compose.onNodeWithText("I understand · continue").performScrollTo().performClick()
        }
        compose.onNodeWithTag("open-A").performScrollTo().assertExists()
        compose.onNodeWithTag("open-B").performScrollTo().assertExists()
        compose.onNodeWithTag("nav-alerts").performClick()
        compose.runOnIdle {
            assertTrue(HubRepository.bind(AccountId.A, null, "Account A"))
            assertTrue(HubRepository.bind(AccountId.B, null, "Account B"))
            assertTrue(HubRepository.bind(AccountId.A, 0, "Alice test"))
            assertTrue(HubRepository.bind(AccountId.B, 10, "Bob test"))
            HubRepository.connected()
            val now = System.currentTimeMillis() + 100
            // Synthetic test events only. These do not prove live Messenger/work-profile access.
            HubRepository.ingest(MESSENGER_PACKAGE, 0, "test-A", "same-thread", "Alex on A",
                listOf(ObservedMessage("Alex", "Private test preview A", now)), now)
            HubRepository.ingest(MESSENGER_PACKAGE, 10, "test-B", "same-thread", "Alex on B",
                listOf(ObservedMessage("Alex", "Private test preview B", now + 1)), now + 1)
        }
        compose.onNodeWithText("Alice test").performScrollTo().performClick()
        compose.onNodeWithText("Alex on A").performScrollTo().assertIsDisplayed().performClick()
        compose.onNodeWithText("Alice test / Alex on A").assertIsDisplayed()
        compose.onNodeWithText("Private test preview A").assertIsDisplayed()
        assertNull(HubNotificationListener.route(AlertKey(AccountId.A, "test-A")))
        compose.runOnIdle {
            val error = HubPlatform.openAlert(compose.activity, AlertKey(AccountId.A, "test-A"))
            assertNotNull("Expired/no capability routes must not launch another account", error)
        }
        compose.onNodeWithText("Acknowledge in hub").performScrollTo().performClick()
        compose.runOnIdle {
            assertEquals(0, HubRepository.state.value.pending(AccountId.A))
            assertEquals(1, HubRepository.state.value.pending(AccountId.B))
        }
        compose.onNodeWithText("Bob test").performScrollTo().performClick()
        compose.onNodeWithText("Alex on B").performScrollTo().assertIsDisplayed().performClick()
        compose.onNodeWithText("Bob test / Alex on B").assertIsDisplayed()
        compose.onNodeWithText("Private test preview B").assertIsDisplayed()
        val file = File(compose.activity.noBackupFilesDir, "hub-settings.enc")
        compose.waitUntil(10_000) { file.exists() && file.length() > 20 }
        assertFalse(String(file.readBytes(), Charsets.ISO_8859_1).contains("Alice test"))
        assertFalse(String(file.readBytes(), Charsets.ISO_8859_1).contains("Private test preview"))
        assertFalse(compose.activity.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_ALLOW_BACKUP != 0)
        compose.onNodeWithText("Clear hub cards").performScrollTo().performClick()
        compose.onNodeWithText("You're all caught up").performScrollTo().assertExists()
        compose.runOnIdle {
            assertTrue(HubRepository.state.value.alerts.isEmpty())
            HubRepository.disconnected()
            HubRepository.bind(AccountId.A, null, "Account A")
            HubRepository.bind(AccountId.B, null, "Account B")
        }
    }
}
