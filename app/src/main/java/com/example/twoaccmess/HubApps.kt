package com.example.twoaccmess

/**
 * The apps the hub can host. Each entry is one HTTPS entry point plus the hosts its main-frame
 * navigation may use, so a slot can hold a session per app without inventing a native integration.
 *
 * [packages] lists the installed apps whose phone notifications this build can attribute to a slot.
 * An app without packages is web-only: it raises no "Account X has a message" card from notifications,
 * though a space for it that is open right now still badges off its own tab title ([WebUnread]).
 * Packages are left empty where a phone app mixes messages with likes/job alerts/feed noise (Facebook),
 * because a card titled "Account X has a message" has to stay accurate.
 */
data class HubApp(
    val id: String,
    val label: String,
    val home: String,
    val hosts: List<String>,
    val accent: Int,
    val note: String,
    /** Installed package names that post this app's notifications. Empty means web-only. */
    val packages: List<String> = emptyList(),
    /**
     * True when this service's *phone* layout has no messages view, so a fresh space for it must ask for
     * the desktop site or the user never reaches their chats at all. Measured against the live sites; see
     * [WebSessionPolicy.defaultDesktop]. Where the phone layout does have the messages page, it stays the
     * default, because that is the layout the service builds to fit an arbitrary screen width.
     */
    val desktopSite: Boolean = false,
) {
    /** True only for apps whose phone notifications this build can observe. */
    val observed: Boolean get() = packages.isNotEmpty()
}

object HubApps {
    const val DEFAULT_ID = "messenger"
    const val MESSENGER_ID = "messenger"

    val MESSENGER = HubApp("messenger", "Messenger", WebSessionPolicy.HOME, listOf("facebook.com", "messenger.com"),
        0xFF5375FF.toInt(), "Meta's messaging website. Cards need a Messenger installation bound to the slot.",
        listOf(MESSENGER_PACKAGE))
    val FACEBOOK = HubApp("facebook", "Facebook", "https://www.facebook.com/", listOf("facebook.com", "messenger.com"),
        0xFF1877F2.toInt(), "The Facebook website, including its messages page. Facebook's own notifications mix likes, comments and page posts with messages, so this app raises no cards from them; Messenger carries those, while a Facebook space that is open still badges its slot off its own tab title.")
    val INSTAGRAM = HubApp("instagram", "Instagram", "https://www.instagram.com/direct/inbox/",
        listOf("instagram.com", "facebook.com"), 0xFFE1306C.toInt(),
        "Instagram direct messages. Cards need this app in exactly one slot.", listOf("com.instagram.android"))
    val WHATSAPP = HubApp("whatsapp", "WhatsApp", "https://web.whatsapp.com/",
        listOf("whatsapp.com", "whatsapp.net"), 0xFF25D366.toInt(),
        "WhatsApp Web needs you to link this phone by QR code, and this space asks for the desktop site because WhatsApp Web's phone layout serves its own landing page instead of the chat list. Cards need this app in exactly one slot.",
        listOf("com.whatsapp", "com.whatsapp.w4b"), desktopSite = true)
    val TIKTOK = HubApp("tiktok", "TikTok", "https://www.tiktok.com/messages",
        listOf("tiktok.com"), 0xFF6B4BFF.toInt(),
        "TikTok messages. This space asks for the desktop site, because TikTok's phone layout answers /messages by redirecting to the For You feed, where no chat exists. Cards need this app in exactly one slot.",
        listOf("com.zhiliaoapp.musically", "com.ss.android.ugc.trill"), desktopSite = true)
    val TELEGRAM = HubApp("telegram", "Telegram", "https://web.telegram.org/",
        listOf("telegram.org", "t.me"), 0xFF2AABEE.toInt(),
        "Telegram Web: sign in with your phone number (the code arrives in your Telegram app) or scan a QR code shown on another device. Cards need this app in exactly one slot.",
        listOf("org.telegram.messenger", "org.telegram.messenger.web", "org.thunderdog.challegram"))
    val ZALO = HubApp("zalo", "Zalo", "https://chat.zalo.me/",
        listOf("zalo.me", "zaloapp.com"), 0xFF0068FF.toInt(),
        "Zalo Web chat. This space asks for the desktop site, because Zalo's phone layout sends chat.zalo.me to the Play Store listing instead of the chat. Cards need this app in exactly one slot.",
        listOf("com.zing.zalo"), desktopSite = true)
    val X = HubApp("x", "X", "https://x.com/messages", listOf("x.com", "twitter.com"),
        0xFF1DA1F2.toInt(), "X direct messages. Cards need this app in exactly one slot.",
        listOf("com.twitter.android", "com.twitter.android.lite"))
    val THREADS = HubApp("threads", "Threads", "https://www.threads.com/",
        listOf("threads.com", "threads.net"), 0xFF8B5CF6.toInt(),
        "Threads resolve. Cards need this app in exactly one slot.",
        listOf("com.instagram.barcelona"))
    val REDDIT = HubApp("reddit", "Reddit", "https://www.reddit.com/chat/",
        listOf("reddit.com", "redd.it"), 0xFFFF4500.toInt(), "Reddit chat. Cards need this app in exactly one slot.",
        listOf("com.reddit.frontpage"))
    val DISCORD = HubApp("discord", "Discord", "https://discord.com/app",
        listOf("discord.com", "discord.gg", "discordapp.com"), 0xFF5865F2.toInt(),
        "The Discord web app (invite links included). Cards need this app in exactly one slot.",
        listOf("com.discord"))
    val SNAPCHAT = HubApp("snapchat", "Snapchat", "https://web.snapchat.com/",
        listOf("snapchat.com"), 0xFFF5C518.toInt(),
        "Snapchat for Web. Cards need this app in exactly one slot.", listOf("com.snapchat.android"))
    val LINKEDIN = HubApp("linkedin", "LinkedIn", "https://www.linkedin.com/messaging/",
        listOf("linkedin.com"), 0xFF0A66C2.toInt(),
        "LinkedIn messaging. Cards need this app in exactly one slot.", listOf("com.linkedin.android"))
    val VIBER = HubApp("viber", "Viber", "https://web.viber.com/",
        listOf("viber.com"), 0xFF7360F2.toInt(),
        "Viber for Web. Cards need this app in exactly one slot.", listOf("com.viber.voip"))
    val SKYPE = HubApp("skype", "Skype", "https://web.skype.com/",
        listOf("skype.com", "live.com", "microsoft.com", "microsoftonline.com"), 0xFF00AFF0.toInt(),
        "Skype for Web. Sign-in continues on Microsoft's own live.com/microsoft.com pages, which is why those hosts are allowed in this slot. Cards need this app in exactly one slot.",
        listOf("com.skype.raider"))
    val GOOGLE_CHAT = HubApp("googlechat", "Google Chat", "https://chat.google.com/",
        listOf("chat.google.com", "accounts.google.com", "myaccount.google.com"), 0xFF00AC47.toInt(),
        "Google Chat on the web. Sign-in stays on Google's own accounts page. Cards need this app in exactly one slot.",
        listOf("com.google.android.apps.dynamite"))
    val VK = HubApp("vk", "VK", "https://vk.com/im",
        listOf("vk.com", "vk.me", "vk.cc"), 0xFF0077FF.toInt(), "VK messages. Cards need this app in exactly one slot.",
        listOf("com.vkontakte.android"))
    val BLUESKY = HubApp("bluesky", "Bluesky", "https://bsky.app/messages",
        listOf("bsky.app", "bsky.social"), 0xFF0085FF.toInt(),
        "Bluesky chat. Cards need this app in exactly one slot.", listOf("xyz.blueskyweb.app"))
    val WECHAT = HubApp("wechat", "WeChat", "https://web.wechat.com/",
        listOf("wechat.com", "weixin.qq.com"), 0xFF07C160.toInt(),
        "WeChat for Web links the session by scanning a QR code with WeChat on your phone. Cards need this app in exactly one slot.",
        listOf("com.tencent.mm"))

    val ALL = listOf(MESSENGER, FACEBOOK, INSTAGRAM, WHATSAPP, TIKTOK, TELEGRAM, ZALO, X, THREADS, REDDIT,
        DISCORD, SNAPCHAT, LINKEDIN, VIBER, SKYPE, GOOGLE_CHAT, VK, BLUESKY, WECHAT)
    val DEFAULT = MESSENGER

    fun byId(id: String?): HubApp? = ALL.firstOrNull { it.id == id }

    /** Stored ids are validated on read, so a stale or hand-edited id falls back to Messenger. */
    fun orDefault(id: String?): HubApp = byId(id) ?: DEFAULT

    fun label(id: String?): String = orDefault(id).label

    /** The app that owns [packageName]; an unknown package fails closed instead of being guessed. */
    fun byPackage(packageName: String?): HubApp? = packageName?.let { name -> ALL.firstOrNull { name in it.packages } }

    /** Apps whose phone notifications can raise a card in this build. */
    fun observing(): List<HubApp> = ALL.filter { it.observed }

    fun observingCount(): Int = observing().size

    /** Only the web-only apps, so copy can say exactly which apps cannot raise a card. */
    fun webOnly(): List<HubApp> = ALL.filter { !it.observed }

    fun observingLabels(): String = observing().joinToString(", ") { it.label }
}
