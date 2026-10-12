package com.example.twoaccmess

import android.os.Build
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Not part of the suite: a one-off measurement, kept only in the working copy of the round that
 * changed the layout default. It answers one question with the real engine — when the app asks for
 * tiktok.com/messages, does the phone agent land on the feed while the desktop agent reaches the
 * messages page? Anything network-dependent is a poor permanent test, so the recorded numbers, not
 * this file, are the evidence.
 */
@RunWith(AndroidJUnit4::class)
class LayoutProbeTest {
    private fun probe(url: String, desktop: Boolean): String {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        var final = "(no load)"
        val done = CountDownLatch(1)
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            val web = WebView(context)
            web.settings.javaScriptEnabled = true
            web.settings.domStorageEnabled = true
            // The same switches [MessengerWebActivity.prepare] sets for a space.
            web.settings.useWideViewPort = true
            web.settings.loadWithOverviewMode = true
            if (desktop) web.settings.userAgentString = WebSessionPolicy.desktopAgent(web.settings.userAgentString)
            web.webViewClient = object : android.webkit.WebViewClient() {
                override fun onPageFinished(view: WebView, loaded: String) {
                    final = "$loaded | title=${view.title} | code=${view.progress}"
                    if (done.count > 0L) done.countDown()
                }
            }
            web.loadUrl(url)
        }
        if (!done.await(45, TimeUnit.SECONDS)) return "(timed out after 45s)"
        return final
    }

    @Test fun whereTikTokMessagesLands() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val phone = WebSettings.getDefaultUserAgent(context)
        val desktop = WebSessionPolicy.desktopAgent(phone)
        println("PROBE phone   = $phone")
        println("PROBE desktop = $desktop")
        println("PROBE tiktok/phone   : ${probe("https://www.tiktok.com/messages", desktop = false)}")
        println("PROBE tiktok/desktop : ${probe("https://www.tiktok.com/messages", desktop = true)}")
        println("PROBE zalo/phone     : ${probe("https://chat.zalo.me/", desktop = false)}")
        println("PROBE zalo/desktop   : ${probe("https://chat.zalo.me/", desktop = true)}")
        println("PROBE android=${Build.VERSION.RELEASE} api=${Build.VERSION.SDK_INT} model=${Build.MODEL}")
    }
}
