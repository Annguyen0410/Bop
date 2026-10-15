package com.example.twoaccmess

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LinkedNotesTest {
    @Test fun textNotesMergeByIdInStableChronologicalOrder() {
        val first = LinkedNotes.create("first", timestamp = 1L)
        val second = LinkedNotes.create("second", timestamp = 2L)
        val merged = LinkedNotes.merge(listOf(first), listOf(first, second))
        assertEquals(listOf(first.id, second.id), merged.map { it.id })
        assertEquals("first", merged.first().text)
    }

    @Test fun invalidAndOversizeNotesAreRejected() {
        assertNull(LinkedNotes.normalize(LinkedNote("x", "ignored", sender = "Android", timestamp = 1)))
        assertNull(LinkedNotes.normalize(LinkedNote("valid-id-123", " ", sender = "Android", timestamp = 1)))
        val oversize = "A".repeat(666_668)
        assertNull(LinkedNotes.normalize(LinkedNote("valid-id-123", "", oversize, "image/jpeg", "Android", 1)))
        val normalized = LinkedNotes.normalize(LinkedNote("valid-id-123", "x".repeat(8000), sender = "Android", timestamp = 1))
        assertEquals(4000, normalized?.text?.length)
    }

    @Test fun imageAndSenderMetadataAreBoundedAndCanonical() {
        val token = "a".repeat(64)
        val parsed = LinkedNotes.parsePairingCode("BOPNOTES1:192.168.1.4:38671:$token")
        assertEquals("192.168.1.4", parsed?.host)
        assertEquals(38671, parsed?.port)
        assertNull(LinkedNotes.parsePairingCode("BOPNOTES1:192X168X1X4:38671:$token"))
        val image = "AQID"
        val android = LinkedNotes.normalize(LinkedNote("image-note-123", "", image, "image/png", "Android", 10))
        assertEquals("image/png", android?.mime)
        assertEquals("Android", android?.sender)
        val unexpectedSender = LinkedNotes.normalize(LinkedNote("image-note-456", "", image, "image/gif", "spoofed", 10))
        assertEquals("image/jpeg", unexpectedSender?.mime)
        assertEquals("Desktop", unexpectedSender?.sender)
        assertEquals(2, LinkedNotes.merge(listOf(android!!), listOf(unexpectedSender!!)).size)
        val deleted = LinkedNotes.tombstone(android)
        assertTrue(LinkedNotes.merge(listOf(android), listOf(deleted)).any { it.deletedAt > 0 })
    }
}
