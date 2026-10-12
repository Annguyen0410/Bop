package com.example.twoaccmess

import android.app.Application
import android.content.Context
import android.os.Build
import android.webkit.WebView
import java.io.File

/**
 * Per-account browser isolation. It runs in the private `:messenger_a` / `:messenger_b` process and
 * never throws: an isolation failure has to reach the screen as text, not as a process crash.
 */
object WebSessionRuntime {
    @Volatile private var prepared = false
    @Volatile private var accountValue: AccountId? = null
    @Volatile private var isolationFailureValue: String? = null

    val account: AccountId? get() = accountValue
    val isolationFailure: String? get() = isolationFailureValue
    val isolated: Boolean get() = accountValue != null && isolationFailureValue == null

    /**
     * Called from [Application.attachBaseContext], i.e. before content providers, CookieManager or any
     * WebView can initialize Chromium, so the suffix really applies to this process' data directory.
     */
    fun prepare(application: Application) {
        if (prepared) return
        prepared = true
        if (Build.VERSION.SDK_INT < WebSessionPolicy.MIN_ANDROID) return
        val process = processName()
        val id = WebSessionPolicy.accountForProcess(application.packageName, process)
        accountValue = id
        // Any other process keeps the default directory and must never create a WebView.
        if (id == null) return
        try {
            WebView.setDataDirectorySuffix(WebSessionPolicy.dataSuffix(id))
        } catch (failure: Throwable) {
            isolationFailureValue = describe(failure)
        }
        record(application, id, WebSessionReport.STAGE_PREPARED, detail = isolationFailureValue ?: "")
    }

    fun processName(): String = try {
        if (Build.VERSION.SDK_INT >= 28) Application.getProcessName() ?: "-"
        else "pid ${android.os.Process.myPid()}"
    } catch (_: Throwable) {
        "-"
    }

    /**
     * Engine version for the report. This loads the WebView provider on purpose: a broken engine then
     * fails inside this guarded call (before the activity builds a page) instead of mid-navigation.
     */
    fun engineVersion(): String? = try {
        if (Build.VERSION.SDK_INT >= 26) WebView.getCurrentWebViewPackage()?.versionName else null
    } catch (_: Throwable) {
        null
    }

    /** Rewrites the status file for this account so the hub screen can show what happened off-process. */
    fun record(context: Context, id: AccountId, stage: String, detail: String = "") {
        val status = WebSessionStatus(
            account = id,
            process = processName(),
            sdk = Build.VERSION.SDK_INT,
            suffix = WebSessionPolicy.dataSuffix(id),
            isolationFailure = if (id.legacy) isolationFailureValue else null,
            stage = stage,
            detail = detail.replace('\n', ' ').take(400),
            engine = engineVersion(),
            recordedAt = System.currentTimeMillis(),
        )
        try {
            statusFile(context, id).writeText(WebSessionReport.encode(status))
        } catch (_: Throwable) {
            // A missing status file only costs diagnostics.
        }
    }

    /** Records a handled failure and stores it for the next app start. */
    fun failure(context: Context, id: AccountId, label: String, failure: Throwable) {
        record(context, id, WebSessionReport.STAGE_ERROR, detail = "$label · ${describe(failure)}")
        CrashLog.write(context, "web session ${id.name} · $label", failure)
    }

    fun read(context: Context, id: AccountId): WebSessionStatus? = try {
        val file = statusFile(context, id)
        if (file.exists()) WebSessionReport.decode(file.readText()) else null
    } catch (_: Throwable) {
        null
    }

    fun statusFile(context: Context, id: AccountId) = File(context.filesDir, WebSessionReport.file(id))

    private fun describe(failure: Throwable) = "${failure.javaClass.simpleName}: ${failure.message ?: "no message"}"
}
