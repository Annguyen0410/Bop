package com.example.twoaccmess

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Accuracy rules for hub cards. The device cross-check in the instrumented tests pins these constants
 * to the platform's `Notification.CATEGORY_*` values, so a renamed constant cannot silently turn a
 * promo into a "has a message" card.
 */
class AlertFilterTest {
    @Test fun anythingThatProvesAConversationIsKept() {
        // A messaging payload or a conversation shortcut is proof, whatever the category claims.
        assertTrue(AlertFilter.messageLike(null, hasMessagingStyle = true, hasConversation = false))
        assertTrue(AlertFilter.messageLike(AlertFilter.CATEGORY_PROMO, hasMessagingStyle = true, hasConversation = false))
        assertTrue(AlertFilter.messageLike(AlertFilter.CATEGORY_SOCIAL, hasMessagingStyle = false, hasConversation = true))
        assertTrue(AlertFilter.messageLike(AlertFilter.CATEGORY_STATUS, hasMessagingStyle = true, hasConversation = true))
    }

    @Test fun messageCategoriesAreAlwaysAccepted() {
        listOf(AlertFilter.CATEGORY_MESSAGE, AlertFilter.CATEGORY_EMAIL, AlertFilter.CATEGORY_CALL,
            AlertFilter.CATEGORY_MISSED_CALL).forEach { category ->
            assertTrue(category, AlertFilter.messageLike(category, false, false))
        }
    }

    @Test fun categoriesThatAreNeverAMessageAreRejected() {
        listOf(AlertFilter.CATEGORY_PROMO, AlertFilter.CATEGORY_SOCIAL, AlertFilter.CATEGORY_RECOMMENDATION,
            AlertFilter.CATEGORY_STATUS, AlertFilter.CATEGORY_PROGRESS, AlertFilter.CATEGORY_SERVICE,
            AlertFilter.CATEGORY_TRANSPORT, AlertFilter.CATEGORY_SYSTEM, AlertFilter.CATEGORY_ERROR,
            AlertFilter.CATEGORY_ALARM, AlertFilter.CATEGORY_EVENT, AlertFilter.CATEGORY_REMINDER,
            AlertFilter.CATEGORY_LOCATION, AlertFilter.CATEGORY_STOPWATCH, AlertFilter.CATEGORY_WORKOUT,
            AlertFilter.CATEGORY_NAVIGATION).forEach { category ->
            assertFalse(category, AlertFilter.messageLike(category, false, false))
        }
    }

    @Test fun anUnknownOrMissingCategoryKeepsTheMessage() {
        // Many chat apps never set a category; dropping those would lose real messages.
        assertTrue(AlertFilter.messageLike(null, false, false))
        assertTrue(AlertFilter.messageLike("", false, false))
        assertTrue(AlertFilter.messageLike("something-new-android-added", false, false))
    }

    @Test fun everyKnownCategoryIsClassifiedExactlyOnce() {
        // The instrumented tests compare these strings with android.app.Notification.CATEGORY_* on a
        // device; keeping the list explicit here documents every category the rule knows about.
        val known = listOf(AlertFilter.CATEGORY_MESSAGE, AlertFilter.CATEGORY_EMAIL, AlertFilter.CATEGORY_CALL,
            AlertFilter.CATEGORY_MISSED_CALL, AlertFilter.CATEGORY_PROMO, AlertFilter.CATEGORY_SOCIAL,
            AlertFilter.CATEGORY_RECOMMENDATION, AlertFilter.CATEGORY_STATUS, AlertFilter.CATEGORY_PROGRESS,
            AlertFilter.CATEGORY_SERVICE, AlertFilter.CATEGORY_TRANSPORT, AlertFilter.CATEGORY_SYSTEM,
            AlertFilter.CATEGORY_ERROR, AlertFilter.CATEGORY_ALARM, AlertFilter.CATEGORY_EVENT,
            AlertFilter.CATEGORY_REMINDER, AlertFilter.CATEGORY_LOCATION, AlertFilter.CATEGORY_STOPWATCH,
            AlertFilter.CATEGORY_WORKOUT, AlertFilter.CATEGORY_NAVIGATION)
        assertEquals(known.size, known.distinct().size)
        // The rule answers for every one of them without falling back to "unknown".
        assertEquals("msg", AlertFilter.CATEGORY_MESSAGE)
        assertEquals("social", AlertFilter.CATEGORY_SOCIAL)
        assertEquals("sys", AlertFilter.CATEGORY_SYSTEM)
        known.forEach { category ->
            val message = category in listOf(AlertFilter.CATEGORY_MESSAGE, AlertFilter.CATEGORY_EMAIL,
                AlertFilter.CATEGORY_CALL, AlertFilter.CATEGORY_MISSED_CALL)
            assertEquals(category, message, AlertFilter.messageLike(category, false, false))
        }
    }
}