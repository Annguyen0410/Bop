package com.example.twoaccmess

import android.webkit.WebView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.webkit.WebStorageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class SpaceProfilesInstrumentedTest {
    @Test fun dynamicSpacesNeverShareCookiesAndClearingOneLeavesTheOtherAlone() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        var first: WebView? = null
        var second: WebView? = null
        val set = CountDownLatch(2)
        instrumentation.runOnMainSync {
            assertTrue("Test device needs MULTI_PROFILE; no shared-storage fallback is allowed", WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE))
            assertTrue("Test device needs profile-specific full browsing-data deletion", WebViewFeature.isFeatureSupported(WebViewFeature.DELETE_BROWSING_DATA))
            first = WebView(context); second = WebView(context)
            SpaceSessions.attach(first!!, AccountId(10000))
            SpaceSessions.attach(second!!, AccountId(10001))
            SpaceSessions.cookies(first!!, AccountId(10000)).setCookie("https://bop-test.invalid", "identity=first; Secure") { assertTrue(it); set.countDown() }
            SpaceSessions.cookies(second!!, AccountId(10001)).setCookie("https://bop-test.invalid", "identity=second; Secure") { assertTrue(it); set.countDown() }
        }
        assertTrue("Cookie callbacks timed out", set.await(20, TimeUnit.SECONDS))
        try {
            val deleted = CountDownLatch(1)
            instrumentation.runOnMainSync {
                assertTrue(SpaceSessions.cookies(first!!, AccountId(10000)).getCookie("https://bop-test.invalid").contains("identity=first"))
                assertTrue(SpaceSessions.cookies(second!!, AccountId(10001)).getCookie("https://bop-test.invalid").contains("identity=second"))
                if (WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE) && WebViewFeature.isFeatureSupported(WebViewFeature.DELETE_BROWSING_DATA)) {
                    WebStorageCompat.deleteBrowsingData(WebViewCompat.getProfile(first!!).webStorage) { deleted.countDown() }
                }
            }
            assertTrue("Profile-specific deletion timed out", deleted.await(20, TimeUnit.SECONDS))
            instrumentation.runOnMainSync {
                assertNull(SpaceSessions.cookies(first!!, AccountId(10000)).getCookie("https://bop-test.invalid"))
                assertTrue(SpaceSessions.cookies(second!!, AccountId(10001)).getCookie("https://bop-test.invalid").contains("identity=second"))
            }
        } finally {
            instrumentation.runOnMainSync {
                first?.destroy(); second?.destroy()
            }
        }
    }
}
