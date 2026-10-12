package com.example.twoaccmess

import java.util.Locale

/** Last known state of one embedded browser process, written by that process and read by the hub. */
data class WebSessionStatus(
    val account: AccountId,
    val process: String,
    val sdk: Int,
    val suffix: String,
    /** Non-null when this process could not get its own browser data directory: the browser must stay closed. */
    val isolationFailure: String?,
    val stage: String,
    val detail: String,
    val engine: String?,
    val recordedAt: Long,
)

/** Pure text handling so diagnostics can be unit-tested without Android. No cookies or URLs are stored. */
object WebSessionReport {
    const val VERSION = 1
    const val STAGE_PREPARED = "prepared"
    const val STAGE_ENGINE = "engine"
    const val STAGE_BROWSER = "browser"
    const val STAGE_ERROR = "error"

    fun file(account: AccountId) = "web-session-${account.name.lowercase(Locale.ROOT)}.txt"

    fun encode(status: WebSessionStatus): String = buildString {
        append("v=$VERSION\n")
        append("account=${status.account.name}\n")
        append("process=${status.process.replace('\n', ' ')}\n")
        append("sdk=${status.sdk}\n")
        append("suffix=${status.suffix.replace('\n', ' ')}\n")
        append("isolation=${status.isolationFailure?.replace('\n', ' ') ?: "ok"}\n")
        append("stage=${status.stage.replace('\n', ' ')}\n")
        append("detail=${status.detail.replace('\n', ' ')}\n")
        append("engine=${status.engine?.replace('\n', ' ') ?: "unknown"}\n")
        append("at=${status.recordedAt}\n")
    }

    /** Returns null when the file is not a session report we can trust. Fail closed, never guess an account. */
    fun decode(text: String): WebSessionStatus? {
        val fields = text.lineSequence().mapNotNull { line ->
            val cut = line.indexOf('=')
            if (cut <= 0) null else line.substring(0, cut).trim() to line.substring(cut + 1).trim()
        }.toMap()
        val account = AccountId.from(fields["account"]) ?: return null
        val engine = fields["engine"]?.takeIf { it.isNotBlank() && it != "unknown" }
        return WebSessionStatus(
            account = account,
            process = fields["process"].orEmpty(),
            sdk = fields["sdk"]?.toIntOrNull() ?: 0,
            suffix = fields["suffix"].orEmpty(),
            isolationFailure = when (val isolation = fields["isolation"]) {
                "ok" -> null
                null -> "state unknown (missing isolation field)"
                else -> isolation
            },
            stage = fields["stage"].orEmpty(),
            detail = fields["detail"].orEmpty(),
            engine = engine,
            recordedAt = fields["at"]?.toLongOrNull() ?: 0L,
        )
    }

    fun isolationLine(status: WebSessionStatus?): String = when {
        status == null -> "No session started yet · tap Open web to test"
        status.isolationFailure != null -> "Blocked · browser storage was not isolated (${status.isolationFailure})"
        status.stage == STAGE_ERROR -> "Failed · ${status.detail.ifBlank { "unknown error" }}"
        status.stage == STAGE_ENGINE -> "Engine created · loading Meta's page · WebView ${status.engine ?: "unknown"}"
        status.stage == STAGE_BROWSER -> "Ready · separate storage · WebView ${status.engine ?: "unknown"}"
        else -> "Prepared · separate storage · WebView ${status.engine ?: "unknown"}"
    }

    /** One-line digest of a stored failure report, safe to show on the main screen. */
    fun crashSummary(report: String?, limit: Int = 400): String? {
        val lines = report?.lines()?.map { it.trim() }?.filter { it.isNotEmpty() } ?: return null
        if (lines.isEmpty()) return null
        val cause = lines.firstOrNull { it.contains("Exception") || it.contains("Error") || it.contains("Throwable") }
            ?: lines.last()
        val label = lines.firstOrNull { it.startsWith("label=") }?.removePrefix("label=")?.trim()
        val head = if (label.isNullOrEmpty()) cause else "$label · $cause"
        return if (head.length <= limit) head else head.take((limit - 1).coerceAtLeast(1)) + "…"
    }

    /** Copyable block for the user to paste into a bug report. Contains no credentials or page URLs. */
    fun diagnostics(platform: String, crash: String?, sessions: List<Pair<AccountId, WebSessionStatus?>>): String = buildString {
        appendLine("TwoAccMess web session diagnostics")
        appendLine(platform)
        sessions.forEach { (id, status) ->
            appendLine("Web ${id.name}: ${isolationLine(status)}")
            if (status != null) {
                appendLine("  process=${status.process.ifBlank { "unknown" }} sdk=${status.sdk} suffix=${status.suffix.ifBlank { "unknown" }} stage=${status.stage.ifBlank { "unknown" }}")
                if (status.detail.isNotBlank()) appendLine("  detail=${status.detail}")
                if (status.isolationFailure != null) appendLine("  isolation=${status.isolationFailure}")
            }
        }
        if (crash != null) {
            appendLine()
            appendLine("Last failure report:")
            appendLine(crash)
        }
    }
}
