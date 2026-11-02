package com.sunhub.community

import android.content.Context
import android.net.Uri
import android.util.Base64
import java.security.MessageDigest
import java.security.SecureRandom
import org.json.JSONObject

/** Only a short-lived, PKCE-bound handoff travels through the browser callback. */
internal class SunhubBrowserSignIn(
    context: Context,
    private val origin: String,
    private val applicationId: String = context.packageName,
) {
    private val store = SessionStore(context, "sunhub-browser-sign-in", "sunhub-browser-sign-in-v1")
    val redirectUri = "$applicationId://auth/sunhub"

    sealed interface Callback {
        data class Exchange(val code: String, val verifier: String) : Callback

        data class Failure(val reason: String) : Callback

        data object Ignore : Callback
    }

    @Synchronized
    fun begin(intent: String, accountType: String, now: Long = System.currentTimeMillis()): Uri {
        require(intent in setOf("login", "signup"))
        require(accountType in setOf("company", "individual"))
        val base = Uri.parse(origin)
        require(base.userInfo == null && base.query == null && base.fragment == null)
        require(base.path.isNullOrEmpty() || base.path == "/")
        require(
            base.scheme == "https" ||
                (BuildConfig.DEBUG &&
                    base.scheme == "http" &&
                    base.host in setOf("10.0.2.2", "localhost", "127.0.0.1"))
        )
        val verifier = randomToken()
        val state = randomToken()
        store.save(
            JSONObject()
                .put("verifier", verifier)
                .put("state", state)
                .put("created", now)
                .put("origin", origin)
                .toString()
        )
        return base
            .buildUpon()
            .path("/api/auth/sunhub/start")
            .appendQueryParameter("platform", "android")
            .appendQueryParameter("code_challenge", challenge(verifier))
            .appendQueryParameter("state", state)
            .appendQueryParameter("redirect_uri", redirectUri)
            .appendQueryParameter("intent", intent)
            .appendQueryParameter("accountType", accountType)
            .build()
    }

    fun isCallback(uri: Uri?): Boolean =
        uri != null &&
            uri.scheme == applicationId &&
            uri.encodedAuthority == "auth" &&
            uri.encodedPath == "/sunhub" &&
            uri.fragment == null

    @Synchronized
    fun accept(uri: Uri, now: Long = System.currentTimeMillis()): Callback {
        if (!isCallback(uri)) return Callback.Ignore
        val pending =
            store.read()?.let { runCatching { JSONObject(it) }.getOrNull() }
                ?: return Callback.Ignore
        val created = pending.optLong("created")
        if (
            pending.optString("origin") != origin ||
                created > now + 30_000 ||
                now - created > 600_000
        ) {
            cancel()
            return Callback.Failure("expired")
        }
        val keys = uri.queryParameterNames
        if (
            keys.any { it !in setOf("state", "code", "error") } ||
                keys.any { uri.getQueryParameters(it).size != 1 }
        )
            return Callback.Failure("failed")
        val state = uri.getQueryParameter("state").orEmpty()
        if (!MessageDigest.isEqual(state.toByteArray(), pending.optString("state").toByteArray()))
            return Callback.Failure("failed")
        val error = uri.getQueryParameter("error")
        val code = uri.getQueryParameter("code")
        if ((error == null) == (code == null)) return Callback.Failure("failed")
        if (error != null) {
            cancel()
            return Callback.Failure(error.takeIf { it in errors } ?: "failed")
        }
        if (code == null || !code.matches(Regex("[A-Za-z0-9_-]{20,256}")))
            return Callback.Failure("failed")
        val verifier = pending.optString("verifier")
        if (!verifier.matches(Regex("[A-Za-z0-9_-]{43}"))) {
            cancel()
            return Callback.Failure("failed")
        }
        cancel()
        return Callback.Exchange(code, verifier)
    }

    @Synchronized fun cancel() = store.clear()

    companion object {
        private val errors =
            setOf(
                "unavailable",
                "cancelled",
                "expired",
                "failed",
                "account_conflict",
                "email_unverified",
            )

        private fun encode(value: ByteArray): String =
            Base64.encodeToString(value, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)

        private fun randomToken(): String =
            encode(ByteArray(32).also { SecureRandom().nextBytes(it) })

        fun challenge(verifier: String): String =
            encode(
                MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII))
            )

        fun message(reason: String): String =
            when (reason) {
                "account_conflict" ->
                    "This email already has a Connect account. Sign in to Connect on the web with your existing credentials, then link Sunhub in account settings. You can use Sunhub here after linking."
                "email_unverified" -> "Verify your email with Sunhub, then try again."
                "cancelled" ->
                    "Sunhub sign-in was cancelled. You can try again or use your Connect login."
                "expired" -> "This sign-in has expired. Please try again."
                "unavailable" ->
                    "Sunhub sign-in is temporarily unavailable. You can still use your Connect login."
                else -> "We couldn’t complete Sunhub sign-in. Please try again."
            }
    }
}
