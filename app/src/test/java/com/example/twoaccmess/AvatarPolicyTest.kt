package com.example.twoaccmess

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AvatarPolicyTest {
    @Test fun everyStoredPictureHasItsOwnValidSlotName() {
        assertEquals("bubble", AvatarPolicy.slot(null))
        assertEquals("account_a", AvatarPolicy.slot(AccountId.A))
        assertEquals("account_b", AvatarPolicy.slot(AccountId.B))
        assertEquals("account_c", AvatarPolicy.slot(AccountId.C))
        assertEquals("account_d", AvatarPolicy.slot(AccountId.D))
        assertEquals("account_p", AvatarPolicy.slot(AccountId.P))
        assertEquals(1 + AccountId.entries.size,
            (listOf(AvatarPolicy.slot(null)) + AccountId.entries.map { AvatarPolicy.slot(it) }).distinct().size)
        assertEquals("account_c.png", AvatarPolicy.fileFor(AvatarPolicy.slot(AccountId.C)))
        AccountId.entries.forEach { assertTrue(AvatarPolicy.slot(it), AvatarPolicy.valid(AvatarPolicy.slot(it))) }
    }

    @Test fun staleOrInventedSlotsAreRejected() {
        listOf("bubble", "account_a", "account_d", "account_p", "account_q", "account_z", "account_aa").forEach { assertTrue(it, AvatarPolicy.valid(it)) }
        listOf("", "account_aaaaaaaa", "account_1", "account", "bubble.png", "../account_a", "account_A", "account_a/../b").forEach {
            assertFalse("'$it' must never resolve to a stored picture", AvatarPolicy.valid(it))
        }
    }

    @Test fun storedCopiesAreSquaredDownButSmallOnesAreNotUpscaled() {
        assertEquals(0, AvatarPolicy.square(0, 0))
        assertEquals(0, AvatarPolicy.square(120, 40, max = 0))
        assertEquals(40, AvatarPolicy.square(120, 40))
        assertEquals(4000, AvatarPolicy.square(4000, 5000, max = 4000))
        assertEquals(AvatarPolicy.MAX_EDGE, AvatarPolicy.square(4032, 3024))
        // A narrow picture is stored at its own width: the stored copy is never upscaled to 256.
        assertEquals(100, AvatarPolicy.square(100, 3000))
        assertEquals(256, AvatarPolicy.MAX_EDGE)
    }

    @Test fun everyPictureIsCenterCroppedToASquareWithoutStretchingIt() {
        // Landscape: the sides come off, the height stays whole.
        assertEquals(AvatarCrop(50, 0, 300), AvatarPolicy.crop(400, 300))
        // Portrait: the top and bottom come off, the width stays whole.
        assertEquals(AvatarCrop(0, 150, 100), AvatarPolicy.crop(100, 400))
        // Already square: nothing is cropped at all.
        assertEquals(AvatarCrop(0, 0, 256), AvatarPolicy.crop(256, 256))
        // Nonsense sizes never produce a crop that could divide by zero.
        assertEquals(AvatarCrop(0, 0, 0), AvatarPolicy.crop(0, 400))
        assertEquals(AvatarCrop(0, 0, 0), AvatarPolicy.crop(-5, 400))
        listOf(400 to 300, 300 to 400, 4032 to 3024, 3024 to 4032, 1 to 9).forEach { (width, height) ->
            val crop = AvatarPolicy.crop(width, height)
            // Both stored sides come from the same crop, so the aspect ratio can never be forced.
            assertTrue("$width x $height", crop.left >= 0 && crop.top >= 0)
            assertTrue("$width x $height", crop.left + crop.size <= width && crop.top + crop.size <= height)
            assertEquals(minOf(width, height), crop.size)
        }
    }

    @Test fun decodeSamplingKeepsTheBitmapCloseToTheStoredSize() {
        assertEquals(1, AvatarPolicy.sampleSize(0, -5))
        assertEquals(1, AvatarPolicy.sampleSize(256, 256))
        assertEquals(2, AvatarPolicy.sampleSize(512, 512))
        assertEquals(2, AvatarPolicy.sampleSize(513, 513))
        assertEquals(4, AvatarPolicy.sampleSize(1024, 1024))
        assertEquals(16, AvatarPolicy.sampleSize(4096, 3072))
        // The sampled bitmap is never larger than twice the stored edge.
        listOf(300, 640, 1080, 4032, 8000).forEach { edge ->
            val sampled = edge / AvatarPolicy.sampleSize(edge, edge)
            assertTrue("$edge sampled to $sampled", sampled <= 2 * AvatarPolicy.MAX_EDGE)
        }
    }
}
