package com.example.twoaccmess

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The rules behind "open the conversation this slot was in" — see [MessengerThread]. */
class MessengerThreadTest {
    @Test
    fun `a conversation is recognised on both Messenger addresses and on the Facebook messages path`() {
        assertTrue(MessengerThread.isThread("https://www.messenger.com/t/1234567890"))
        assertTrue(MessengerThread.isThread("https://www.facebook.com/messages/t/1234567890"))
        assertTrue(MessengerThread.isThread("https://www.facebook.com/messages/e2ee/t/1234567890"))
    }

    @Test
    fun `an inbox, a login screen or a non-web address is never remembered as a conversation`() {
        assertFalse(MessengerThread.isThread("https://www.facebook.com/messages/"))
        assertFalse(MessengerThread.isThread("https://www.messenger.com/"))
        assertFalse(MessengerThread.isThread("https://www.facebook.com/login/?next=x"))
        assertFalse(MessengerThread.isThread(""))
        assertFalse(MessengerThread.isThread("not a url"))
        assertFalse(MessengerThread.isThread("file:///t/secret"))
        assertFalse(MessengerThread.isThread("javascript:alert(1)"))
    }

    @Test
    fun `the same conversation with fresh tracking parameters counts as the same conversation`() {
        val clean = "https://www.messenger.com/t/1234567890"
        assertTrue(MessengerThread.sameThread(clean, "$clean?ref=notification"))
        assertTrue(MessengerThread.sameThread("$clean/", clean))
        assertFalse(MessengerThread.sameThread(clean, "https://www.messenger.com/t/999"))
    }

    @Test
    fun `addresses that do not parse fall back to an exact comparison instead of throwing`() {
        assertTrue(MessengerThread.sameThread("about:blank", "about:blank"))
        assertFalse(MessengerThread.sameThread("about:blank", "about:blank#x"))
    }
}
