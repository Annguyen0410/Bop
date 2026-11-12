package com.example.twoaccmess

/**
 * The conversation a web space was last looking at.
 *
 * A tapped alert can say *who* wrote (the phone's own notification carries that) but not which web address of
 * the site that chat lives at, and Bop never reads message contents to find out. What it can do is remember
 * the conversation the user last had open in a slot and go back there, so "open Messenger" lands in the chat
 * the user was in rather than on an inbox they then have to search. These are the two rules that make that
 * safe to persist:
 *
 * - [isThread] decides whether an address is a conversation rather than an inbox, a login screen or a
 *   redirect, so a sign-in page never becomes the place a slot opens next time;
 * - [sameThread] compares two addresses by path, because the sites rewrite tracking parameters onto a thread
 *   they have already opened — comparing the whole address made the space reload a chat it was already on.
 *
 * Pure Kotlin, no Android types, so both rules are unit-tested rather than described.
 */
object MessengerThread {
    /** Conversation shapes seen in the wild: messenger.com/t/<id>, facebook.com/messages/t/<id>, …/e2ee/t/<id>. */
    private val THREAD_PATH = Regex("/(?:messages/)?(?:e2ee/)?t/[^/?#]+")

    private val ALLOWED_SCHEMES = setOf("https", "http")

    /** The path of an address, or null when it is not an HTTP address at all. A trailing slash is dropped:
     *  `/t/<id>/` and `/t/<id>` are one conversation, and treating them as two reloaded the open chat. */
    fun pathOf(url: String): String? {
        val uri = try { java.net.URI(url.trim()) } catch (_: Exception) { return null }
        if (uri.scheme?.lowercase() !in ALLOWED_SCHEMES) return null
        val path = uri.path ?: return null
        return if (path.length > 1) path.trimEnd('/') else path
    }

    /** True when this address is a conversation, so it is worth remembering as one. */
    fun isThread(url: String): Boolean {
        val path = pathOf(url) ?: return false
        return THREAD_PATH.containsMatchIn(path)
    }

    /** True when two addresses point at the same conversation, whatever tracking parameters they carry. */
    fun sameThread(left: String, right: String): Boolean {
        val a = pathOf(left)
        val b = pathOf(right)
        return if (a == null || b == null) left == right else a == b
    }
}
