package com.example.twoaccmess

const val MESSENGER_PACKAGE = "com.facebook.orca"

/** Stable identifiers: A–P retain their old processes/storage; later spaces use named WebView profiles. */
data class AccountId(val ordinal: Int) : Comparable<AccountId> {
    init { require(ordinal >= 0) }
    val name: String get() {
        var value = ordinal.toLong() + 1
        return buildString {
            while (value > 0) { value--; append(('A'.code + (value % 26).toInt()).toChar()); value /= 26 }
        }.reversed()
    }
    val legacy: Boolean get() = ordinal < entries.size
    override fun compareTo(other: AccountId) = ordinal.compareTo(other.ordinal)
    companion object {
        val A = AccountId(0); val B = AccountId(1); val C = AccountId(2); val D = AccountId(3)
        val E = AccountId(4); val F = AccountId(5); val G = AccountId(6); val H = AccountId(7)
        val I = AccountId(8); val J = AccountId(9); val K = AccountId(10); val L = AccountId(11)
        val M = AccountId(12); val N = AccountId(13); val O = AccountId(14); val P = AccountId(15)
        /** Compatibility pool only, NOT a limit on spaces. */
        val entries: List<AccountId> get() = (0..15).map(::AccountId)
        fun from(value: String?): AccountId? {
            if (value.isNullOrEmpty() || value.length > 7 || value.any { it !in 'A'..'Z' }) return null
            var number = 0L
            value.forEach { number = number * 26 + (it - 'A' + 1); if (number > Int.MAX_VALUE) return null }
            return AccountId((number - 1).toInt())
        }
    }
}

data class AccountBinding(
    val accountId: AccountId,
    val label: String = "Account ${accountId.name}",
    val profileSerial: Long? = null,
    val generation: Long = 0,
    val boundAt: Long = 0,
    /** Which catalog app this slot opens as a web session ([HubApps]). */
    val appId: String = HubApps.DEFAULT_ID,
) {
    val app: HubApp get() = HubApps.orDefault(appId)
}

data class AlertKey(val accountId: AccountId, val sourceKey: String)
data class ConversationKey(val accountId: AccountId, val sourceId: String)
data class ObservedMessage(val sender: String?, val text: String, val timestamp: Long?)

data class ObservedAlert(
    val key: AlertKey,
    val conversation: ConversationKey,
    val generation: Long,
    val title: String,
    val messages: List<ObservedMessage>,
    val postedAt: Long,
    val acknowledged: Boolean = false,
    /** Aggregate website marker, not the number of observed conversations/messages. */
    val webUnread: Int? = null,
)

data class HubState(
    val accounts: List<AccountBinding> = AccountId.entries.map { AccountBinding(it) },
    val alerts: Map<AlertKey, ObservedAlert> = emptyMap(),
    val connected: Boolean = false,
    val ready: Boolean = false,
    val disclosureAccepted: Boolean = false,
    val mirrorAlerts: Boolean = true,
    val workPreviews: Boolean = false,
    val overlayRunning: Boolean = false,
    val settingsError: Boolean = false,
    /** Slots the user actually uses. A and B are always on; every other slot is added on demand. */
    val enabledSlots: List<AccountId> = DEFAULT_SLOTS,
    /** Appearance picked in Setup: follow the phone, or force light/dark. */
    val themeChoice: ThemeChoice = ThemeChoice.DEFAULT,
) {
    /** Stable order, two base spaces, and no application-imposed slot count limit. */
    val slots: List<AccountId>
        get() = (enabledSlots + DEFAULT_SLOTS).distinct().sorted().filter { id -> accounts.any { it.accountId == id } }

    fun account(id: AccountId) = accounts.first { it.accountId == id }
    fun pending(id: AccountId) = alerts.values.filter { it.key.accountId == id && !it.acknowledged }
        .map { it.conversation }.distinct().size
    fun conversations(id: AccountId) = alerts.values.filter { it.key.accountId == id }
        .groupBy { it.conversation }.values.map { group ->
            group.maxBy { alert -> alert.postedAt }.copy(acknowledged = group.all { it.acknowledged })
        }
        .sortedByDescending { it.postedAt }

    companion object {
        val DEFAULT_SLOTS = listOf(AccountId.A, AccountId.B)
    }
}

object HubReducer {
    /**
     * Maps one observed notification to the one slot it can describe, or null. Unknown packages never
     * resolve. A bound Messenger installation is matched by profile serial exactly as in 1.4, whatever
     * web app the slot later opens. Other apps have no Android binding, so they are claimed by their
     * app choice and only while exactly one enabled slot uses that app: two slots of one app cannot be
     * told apart, so neither is claimed instead of one being guessed. A bound slot counts here too,
     * because its Android binding is about Messenger, not about its web app choice.
     */
    fun resolve(state: HubState, packageName: String, profileSerial: Long): AccountBinding? {
        if (!state.ready || !state.disclosureAccepted || !state.connected || profileSerial < 0) return null
        val app = HubApps.byPackage(packageName) ?: return null
        val enabled = state.slots.map { state.account(it) }
        if (app.id == HubApps.MESSENGER_ID) return enabled.singleOrNull { it.profileSerial == profileSerial }
        return enabled.singleOrNull { it.appId == app.id }
    }

    fun bind(state: HubState, id: AccountId, serial: Long?, label: String, boundAt: Long = 0): HubState {
        require(serial == null || serial >= 0)
        require(state.accounts.none { it.accountId != id && serial != null && it.profileSerial == serial })
        val current = state.account(id)
        return state.copy(
            accounts = state.accounts.map {
                if (it.accountId == id) current.copy(
                    label = label.trim().take(40).ifBlank { "Account ${id.name}" },
                    profileSerial = serial,
                    generation = current.generation + 1,
                    boundAt = boundAt,
                ) else it
            },
            alerts = state.alerts.filterKeys { it.accountId != id },
        )
    }

    /**
     * [resolve] already decided which slot an alert belongs to, including web-only slots. A web-session
     * alert ([WebUnread], [fromWebSession] = true) comes from this app's own open page, so it does not
     * need the phone-notification listener to be connected; a listener alert still does.
     */
    fun upsert(state: HubState, alert: ObservedAlert, fromWebSession: Boolean = false): HubState {
        if ((!state.connected && !fromWebSession) || alert.key.accountId !in state.slots ||
            state.account(alert.key.accountId).generation != alert.generation ||
            alert.postedAt < state.account(alert.key.accountId).boundAt ||
            alert.key.accountId != alert.conversation.accountId) return state
        val old = state.alerts[alert.key]
        val sameContent = old?.messages == alert.messages && old?.title == alert.title && old?.postedAt == alert.postedAt
        val next = alert.copy(acknowledged = sameContent && old?.acknowledged == true)
        val alerts = state.alerts + (alert.key to next)
        val keep = alerts.values.filter { it.key.accountId == alert.key.accountId }
            .sortedByDescending { it.postedAt }.take(100).map { it.key }.toSet()
        return state.copy(alerts = alerts.filterKeys { it.accountId != alert.key.accountId || it in keep })
    }

    /** Baselines/decreases update state silently; only a fresh increase reopens an acknowledged card. */
    fun webReading(state: HubState, id: AccountId, count: Int, incoming: Boolean, at: Long): HubState {
        if (id !in state.slots) return state
        val binding = state.account(id)
        val key = AlertKey(id, WebUnread.sourceKey(id))
        val old = state.alerts[key]
        val unread = count.coerceIn(0, WebUnread.MAX)
        if (unread == 0) return remove(state, key.sourceKey)
        if (old?.webUnread == unread) return state
        val alert = ObservedAlert(key, ConversationKey(id, WebUnread.CONVERSATION), binding.generation,
            WebUnread.cardTitle(id), listOf(ObservedMessage(null, WebUnread.cardText(binding.app, unread), null)),
            postedAt = if (incoming) maxOf(at, (old?.postedAt ?: 0L) + 1) else old?.postedAt ?: at,
            acknowledged = if (incoming) false else old?.acknowledged ?: true,
            webUnread = unread)
        // Silent reconciliations must retain acknowledgement, unlike a new incoming alert.
        val updated = upsert(state, alert, fromWebSession = true)
        return updated.copy(alerts = updated.alerts.mapValues { (source, value) ->
            if (source == key) value.copy(acknowledged = alert.acknowledged) else value
        })
    }

    fun remove(state: HubState, sourceKey: String) = state.copy(
        alerts = state.alerts.filterKeys { it.sourceKey != sourceKey },
    )

    /**
     * Active-source refresh removes vanished notifications without losing dismissal state. A web-session
     * source is not a notification at all, so it survives every refresh of the notification set and only
     * [HubRepository.clearWeb] ends it.
     */
    fun retainSources(state: HubState, sources: Set<String>) = state.copy(alerts = state.alerts.filterKeys {
        it.accountId in state.slots && (it.sourceKey in sources || WebUnread.isSource(it.sourceKey))
    })

    fun acknowledge(state: HubState, key: ConversationKey) = state.copy(
        alerts = state.alerts.mapValues { (_, value) ->
            if (value.conversation == key) value.copy(acknowledged = true) else value
        },
    )

    /**
     * Dismissal coming back from a notification card. An empty [sources] set is ignored on purpose:
     * a card that lost its payload must never wipe alerts it does not name.
     */
    fun acknowledgeSources(state: HubState, id: AccountId, sources: Collection<String>): HubState {
        if (sources.isEmpty()) return state
        return state.copy(
            alerts = state.alerts.mapValues { (key, value) ->
                if (key.accountId == id && key.sourceKey in sources) value.copy(acknowledged = true) else value
            },
        )
    }

    fun enableSlot(state: HubState, id: AccountId) =
        if (id in state.slots) state else state.copy(enabledSlots = state.slots + id,
            accounts = if (state.accounts.any { it.accountId == id }) state.accounts else state.accounts + AccountBinding(id))

    /** Reuse a removed space (its local session is retained), then allocate a new stable identifier. */
    fun nextFree(state: HubState): AccountId? =
        state.accounts.map { it.accountId }.sorted().firstOrNull { it !in state.slots }
            ?: state.accounts.maxOf { it.accountId.ordinal }.takeIf { it < Int.MAX_VALUE - 1 }?.let { AccountId(it + 1) }

    fun rename(state: HubState, id: AccountId, label: String) = state.copy(accounts = state.accounts.map {
        if (it.accountId == id) it.copy(label = label.trim().take(40).ifBlank { "Account ${id.name}" }) else it
    })

    /** A and B stay available; removing any other slot also drops its binding and observed alerts. */
    fun disableSlot(state: HubState, id: AccountId): HubState {
        if (id == AccountId.A || id == AccountId.B) return state
        return state.copy(
            enabledSlots = state.slots - id,
            // Keep the label and app choice so re-adding the slot does not surprise the user.
            accounts = state.accounts.map { if (it.accountId == id) AccountBinding(id, generation = it.generation + 1, appId = it.appId) else it },
            alerts = state.alerts.filterKeys { it.accountId != id },
        )
    }

    fun selectApp(state: HubState, id: AccountId, appId: String): HubState {
        val app = HubApps.byId(appId) ?: return state
        if (state.accounts.none { it.accountId == id } || state.account(id).appId == app.id) return state
        return state.copy(
            accounts = state.accounts.map { if (it.accountId == id) it.copy(appId = app.id) else it },
            // Alerts describe the app the slot used; a new app choice clears them instead of relabelling them.
            alerts = state.alerts.filterKeys { it.accountId != id },
        )
    }

    fun disconnect(state: HubState) = state.copy(connected = false,
        alerts = state.alerts.filterKeys { WebUnread.isSource(it.sourceKey) })
}
