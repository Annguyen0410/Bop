package com.example.twoaccmess

import android.content.Context
import android.util.AtomicFile
import android.webkit.CookieManager
import android.webkit.WebView
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** Non-secret routing metadata only; browser processes never write the encrypted hub settings. */
object SpaceSessions {
    fun writeIndex(context: Context, state: HubState) {
        val file = AtomicFile(File(context.filesDir, "space-index.json"))
        val payload = JSONArray().apply {
            state.slots.forEach { id -> put(JSONObject().put("id", id.name).put("app", state.account(id).appId)) }
        }.toString().toByteArray()
        val stream = file.startWrite()
        try { stream.write(payload); file.finishWrite(stream) }
        catch (failure: Exception) { file.failWrite(stream); throw failure }
    }

    fun index(context: Context): List<Pair<AccountId, HubApp>> = try {
        val json = JSONArray(File(context.filesDir, "space-index.json").readText())
        (0 until json.length()).mapNotNull { i ->
            val value = json.getJSONObject(i)
            AccountId.from(value.optString("id"))?.let { it to HubApps.orDefault(value.optString("app")) }
        }
    } catch (_: Exception) { emptyList() }

    fun supported(): Boolean = try { WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE) }
        catch (_: RuntimeException) { false }

    /** Must be called before settings, clients, cookie managers or any navigation touch this WebView. */
    fun attach(web: WebView, id: AccountId) {
        if (id.legacy) return
        if (WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) {
            WebViewCompat.setProfile(web, WebSessionPolicy.dataSuffix(id))
        } else error("Update Android System WebView or Chrome to use additional spaces. Your existing A–P logins are unchanged.")
    }

    fun cookies(web: WebView, id: AccountId): CookieManager {
        if (id.legacy) return CookieManager.getInstance()
        if (WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) {
            return WebViewCompat.getProfile(web).cookieManager
        }
        error("This WebView engine cannot isolate cookies for additional spaces.")
    }
}
