package com.example.twoaccmess

import android.content.Context
import java.io.File

/**
 * Persists the last uncaught (or handled) failure so the user can copy it from the app instead of
 * needing adb/logcat. Every path is defensive: reporting a crash must never cause another one.
 */
object CrashLog {
    private const val FILE = "last-crash.txt"
    private const val LIMIT = 12_000

    fun install(context: Context) {
        try {
            val application = context.applicationContext
            val previous = Thread.getDefaultUncaughtExceptionHandler()
            if (previous is Recorder && previous.application === application) return
            Thread.setDefaultUncaughtExceptionHandler(Recorder(application, previous))
        } catch (_: Throwable) {
            // No diagnostics if the platform refuses; the app must still start.
        }
    }

    fun write(context: Context, label: String, failure: Throwable?) = write(context, label, failure?.stackTraceToString())

    fun write(context: Context, label: String, stack: String?) {
        try {
            val text = buildString {
                appendLine("TwoAccMess failure report")
                appendLine("label=${label.replace('\n', ' ')}")
                appendLine("process=${processName()}")
                appendLine("android=${android.os.Build.VERSION.RELEASE} sdk=${android.os.Build.VERSION.SDK_INT}")
                appendLine("device=${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}")
                appendLine("webview=${WebSessionRuntime.engineVersion() ?: "unknown"}")
                appendLine("at=${System.currentTimeMillis()}")
                appendLine()
                append((stack ?: "(no stack trace)").take(LIMIT))
            }
            file(context).writeText(text)
        } catch (_: Throwable) {
            // Reporting failed; never escalate.
        }
    }

    fun read(context: Context): String? = try {
        val file = file(context)
        if (!file.exists()) null else file.readText().takeIf { it.isNotBlank() }
    } catch (_: Throwable) {
        null
    }

    fun clear(context: Context) {
        try {
            file(context).delete()
        } catch (_: Throwable) {
            // Ignore.
        }
    }

    private fun file(context: Context) = File(context.noBackupFilesDir, FILE)

    private fun processName() = try {
        if (android.os.Build.VERSION.SDK_INT >= 28) android.app.Application.getProcessName() ?: "-"
        else "pid ${android.os.Process.myPid()}"
    } catch (_: Throwable) {
        "-"
    }

    private class Recorder(val application: Context, private val previous: Thread.UncaughtExceptionHandler?) :
        Thread.UncaughtExceptionHandler {
        override fun uncaughtException(thread: Thread, error: Throwable) {
            write(application, "uncaught in ${thread.name}", error)
            if (previous != null) {
                // Keep the platform behaviour: the crash dialog and logcat entry must still happen.
                try {
                    previous.uncaughtException(thread, error)
                } catch (_: Throwable) {
                    error.printStackTrace()
                }
            } else {
                error.printStackTrace()
            }
        }
    }
}
