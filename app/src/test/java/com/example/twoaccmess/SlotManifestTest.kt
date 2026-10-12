package com.example.twoaccmess

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.util.Locale

/**
 * The slot pool only works when three declarations agree: the [AccountId] enum, the private web
 * activity that owns each slot, and the manifest process that gives that slot its own cookie store.
 * This test reads the real manifest, so adding a slot to one file and forgetting the others fails the
 * build instead of silently letting two logins share one browser directory.
 */
class SlotManifestTest {
    private val packageName = "com.example.twoaccmess"
    private val manifest = listOf(File("src/main/AndroidManifest.xml"), File("app/src/main/AndroidManifest.xml"))
        .firstOrNull { it.isFile }

    private fun text(): String {
        assertTrue("AndroidManifest.xml was not found from ${File("").absolutePath}", manifest != null)
        return manifest!!.readText()
    }

    @Test fun theManifestDeclaresExactlyOnePrivateProcessPerSlot() {
        val declared = Regex("android:process=\":(messenger_[a-z]+)\"").findAll(text())
            .map { it.groupValues[1] }.toList()
        assertEquals(AccountId.entries.size, declared.size)
        assertEquals(AccountId.entries.size, declared.distinct().size)
        AccountId.entries.forEach { id ->
            val process = WebSessionPolicy.dataSuffix(id)
            assertTrue("manifest must declare :$process", declared.contains(process))
            assertEquals(id, WebSessionPolicy.accountForProcess(packageName, "$packageName:$process"))
        }
        // Nothing outside the declared pool may claim a slot process name.
        declared.forEach { process -> assertNotNull(WebSessionPolicy.accountForProcess(packageName, "$packageName:$process")) }
    }

    @Test fun everyPoolSlotHasItsOwnPrivateActivity() {
        val manifestText = text()
        AccountId.entries.forEach { id ->
            val name = "MessengerWeb${id.name}Activity"
            assertTrue("$name must be declared", manifestText.contains("android:name=\".$name\""))
            val block = activityBlock(manifestText, name)
            assertTrue("$name must not be exported", block.contains("android:exported=\"false\""))
            assertTrue("$name must be singleTask", block.contains("android:launchMode=\"singleTask\""))
            assertTrue("$name must keep its own process", block.contains("android:process=\":${WebSessionPolicy.dataSuffix(id)}\""))
            assertTrue("$name must keep its own task affinity",
                block.contains("android:taskAffinity=\"$packageName.web.${id.name.lowercase(Locale.ROOT)}\""))
        }
    }

    /** The `<activity ... />` element for [name], so assertions cannot match a neighbouring activity. */
    private fun activityBlock(manifestText: String, name: String): String {
        val marker = manifestText.indexOf("android:name=\".$name\"")
        if (marker < 0) return ""
        val open = manifestText.lastIndexOf("<activity", marker)
        val close = manifestText.indexOf("/>", marker)
        return if (open < 0 || close < 0) "" else manifestText.substring(open, close)
    }
}
