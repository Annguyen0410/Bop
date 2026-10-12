package com.example.twoaccmess

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WebSessionReportTest {
    private fun status(id: AccountId = AccountId.A, failure: String? = null, stage: String = WebSessionReport.STAGE_BROWSER) =
        WebSessionStatus(
            account = id,
            process = "com.example.twoaccmess:messenger_${id.name.lowercase()}",
            sdk = 34,
            suffix = WebSessionPolicy.dataSuffix(id),
            isolationFailure = failure,
            stage = stage,
            detail = "opened ${WebSessionPolicy.HOME}",
            engine = "130.0.6723.86",
            recordedAt = 1_700_000_000_000,
        )

    @Test fun statusSurvivesEncodeDecodeRoundTrip() {
        val original = status()
        val decoded = WebSessionReport.decode(WebSessionReport.encode(original))
        assertNotNull(decoded)
        assertEquals(original, decoded)
    }

    @Test fun isolationFailureAndDetailArePreservedWithoutBreakingLines() {
        val original = status(failure = "IllegalStateException: illegal\nsecond line", stage = WebSessionReport.STAGE_ERROR)
            .copy(detail = "web session A · blocked\nreason")
        val text = WebSessionReport.encode(original)
        assertEquals(10, text.trim().lines().size)
        val decoded = WebSessionReport.decode(text)
        assertNotNull(decoded)
        assertEquals("IllegalStateException: illegal second line", decoded!!.isolationFailure)
        assertEquals("web session A · blocked reason", decoded.detail)
    }

    @Test fun unknownOrOversizedAccountNeverGuessesASession() {
        assertEquals(AccountId(16), WebSessionReport.decode("account=Q\nstage=browser\nisolation=ok\n")?.account)
        assertNull(WebSessionReport.decode("account=AAAAAAAA\nstage=browser\nisolation=ok\n"))
        assertNull(WebSessionReport.decode("account=P2\nstage=browser\nisolation=ok\n"))
        assertNull(WebSessionReport.decode("account=c\nstage=browser\nisolation=ok\n"))
        assertNull(WebSessionReport.decode(""))
        assertNull(WebSessionReport.decode("v=1\nprocess=x\n"))
    }

    @Test fun everySlotWritesAndReadsItsOwnReport() {
        AccountId.entries.forEach { id ->
            val decoded = WebSessionReport.decode(WebSessionReport.encode(status(id = id)))
            assertEquals(id, decoded?.account)
            assertEquals(WebSessionPolicy.dataSuffix(id), decoded?.suffix)
        }
        assertEquals(AccountId.entries.size, AccountId.entries.map { WebSessionReport.file(it) }.distinct().size)
    }

    @Test fun missingIsolationFieldFailsClosed() {
        val decoded = WebSessionReport.decode("account=B\nstage=prepared\nsuffix=messenger_b\n")
        assertNotNull(decoded)
        assertEquals(AccountId.B, decoded!!.account)
        assertNotNull("A report without an isolation field must not be treated as isolated", decoded.isolationFailure)
        assertTrue(WebSessionReport.isolationLine(decoded).startsWith("Blocked"))
    }

    @Test fun isolationLineExplainsEveryVisibleState() {
        assertTrue(WebSessionReport.isolationLine(null).contains("No session started"))
        assertTrue(WebSessionReport.isolationLine(status(failure = "SecurityException: nope")).startsWith("Blocked"))
        assertTrue(WebSessionReport.isolationLine(status(stage = WebSessionReport.STAGE_ERROR)).startsWith("Failed"))
        val ready = WebSessionReport.isolationLine(status())
        assertTrue(ready.contains("Ready"))
        assertTrue(ready.contains("130.0.6723.86"))
        assertTrue(WebSessionReport.isolationLine(status(stage = WebSessionReport.STAGE_PREPARED)).startsWith("Prepared"))
        // Distinguishes "engine was created then the process died" from "never reached a browser".
        assertTrue(WebSessionReport.isolationLine(status(stage = WebSessionReport.STAGE_ENGINE)).startsWith("Engine created"))
    }

    @Test fun crashSummaryDigestsTheStoredReport() {
        val report = """
            TwoAccMess failure report
            label=web session A · The browser engine could not start
            process=com.example.twoaccmess:messenger_a
            android=14 sdk=34
            at=1700000000000

            java.lang.RuntimeException: Unable to start WebView
                at com.example.twoaccmess.MessengerWebActivity.createBrowser(MessengerWebActivity.kt:210)
        """.trimIndent()
        val summary = WebSessionReport.crashSummary(report)
        assertNotNull(summary)
        assertTrue(summary!!.startsWith("web session A · The browser engine could not start"))
        assertTrue(summary.contains("RuntimeException"))
        assertNull(WebSessionReport.crashSummary(null))
        assertNull(WebSessionReport.crashSummary("   "))
        val short = WebSessionReport.crashSummary(report, limit = 20)
        assertEquals(20, short!!.length)
        assertTrue(short.endsWith("…"))
    }

    @Test fun diagnosticsBlockListsBothSessionsAndTheFailureReport() {
        val block = WebSessionReport.diagnostics(
            "TwoAccMess 1.1-web-preview · Android 14 (API 34) · Google Pixel",
            "label=uncaught in com.example.twoaccmess:messenger_a\njava.lang.IllegalStateException: boom",
            listOf(AccountId.A to status(), AccountId.B to null),
        )
        assertTrue(block.startsWith("TwoAccMess web session diagnostics"))
        assertTrue(block.contains("Web A: Ready"))
        assertTrue(block.contains("Web B: No session started yet"))
        assertTrue(block.contains("process=com.example.twoaccmess:messenger_a"))
        assertTrue(block.contains("Last failure report:"))
        assertTrue(block.contains("IllegalStateException: boom"))
        // The report is the artifact a user pastes; it must never carry credentials or page URLs.
        assertFalse(block.contains("cookie", ignoreCase = true))
        assertFalse(block.contains("password", ignoreCase = true))
    }

    @Test fun sessionFileNamesAreStableAndDistinct() {
        assertEquals(WebSessionReport.file(AccountId.A), WebSessionReport.file(AccountId.A))
        assertEquals("web-session-a.txt", WebSessionReport.file(AccountId.A))
        assertEquals("web-session-b.txt", WebSessionReport.file(AccountId.B))
        assertEquals("web-session-c.txt", WebSessionReport.file(AccountId.C))
        assertEquals("web-session-d.txt", WebSessionReport.file(AccountId.D))
        // The pool grew in 1.6; the naming rule (one file per slot) did not change.
        assertEquals("web-session-p.txt", WebSessionReport.file(AccountId.P))
        assertEquals(AccountId.entries.size, AccountId.entries.map { WebSessionReport.file(it) }.distinct().size)
    }
}
