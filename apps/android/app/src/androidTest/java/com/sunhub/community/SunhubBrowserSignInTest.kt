package com.sunhub.community

import android.net.Uri
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.*
import org.junit.Test

class SunhubBrowserSignInTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val origin = "https://connect.sunhubapp.com"
    private val broker
        get() = SunhubBrowserSignIn(context, origin)

    private val now = 1_800_000_000_000L
    private val code = "a".repeat(43)

    private fun callback(start: Uri, suffix: String = "code=$code") =
        Uri.parse("${broker.redirectUri}?state=${start.getQueryParameter("state")}&$suffix")

    @After fun cleanup() = broker.cancel()

    @Test
    fun challengeMatchesStandardS256Vector() {
        assertEquals(
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
            SunhubBrowserSignIn.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
        )
    }

    @Test
    fun browserStartContainsOnlyChallengeAndIntentAndSurvivesStoreRecreation() {
        val start = broker.begin("signup", "individual", now)
        assertEquals("/api/auth/sunhub/start", start.path)
        assertEquals("https", start.scheme)
        assertEquals("connect.sunhubapp.com", start.host)
        assertEquals("signup", start.getQueryParameter("intent"))
        assertEquals("individual", start.getQueryParameter("accountType"))
        assertEquals("android", start.getQueryParameter("platform"))
        assertEquals(broker.redirectUri, start.getQueryParameter("redirect_uri"))
        assertEquals(43, start.getQueryParameter("state")!!.length)
        assertNull(start.getQueryParameter("verifier"))
        val stored = context.getSharedPreferences("sunhub-browser-sign-in", 0).all.toString()
        val result =
            broker.accept(callback(start), now + 1) as SunhubBrowserSignIn.Callback.Exchange
        assertEquals(code, result.code)
        assertEquals(
            start.getQueryParameter("code_challenge"),
            SunhubBrowserSignIn.challenge(result.verifier),
        )
        assertFalse(stored.contains(result.verifier))
        assertFalse(stored.contains(start.getQueryParameter("state")!!))
        assertEquals(SunhubBrowserSignIn.Callback.Ignore, broker.accept(callback(start), now + 2))
    }

    @Test
    fun wrongStateOrRedirectCannotConsumeValidAttempt() {
        val start = broker.begin("login", "company", now)
        assertEquals(
            SunhubBrowserSignIn.Callback.Ignore,
            broker.accept(Uri.parse("https://evil.test/auth/sunhub?code=$code"), now),
        )
        assertEquals(
            SunhubBrowserSignIn.Callback.Ignore,
            broker.accept(Uri.parse("${broker.redirectUri}/extra?code=$code"), now),
        )
        assertEquals(
            SunhubBrowserSignIn.Callback.Failure("failed"),
            broker.accept(Uri.parse("${broker.redirectUri}?state=wrong&code=$code"), now),
        )
        assertTrue(broker.accept(callback(start), now + 1) is SunhubBrowserSignIn.Callback.Exchange)
    }

    @Test
    fun duplicateParametersTokensFragmentsAndMixedResultsAreRejected() {
        val start = broker.begin("login", "company", now)
        for (suffix in
            listOf(
                "code=$code&code=$code",
                "code=$code&error=failed",
                "access_token=secret",
                "code=short",
            )) {
            assertEquals(
                SunhubBrowserSignIn.Callback.Failure("failed"),
                broker.accept(callback(start, suffix), now),
            )
        }
        assertEquals(
            SunhubBrowserSignIn.Callback.Ignore,
            broker.accept(Uri.parse(callback(start).toString() + "#token"), now),
        )
        assertTrue(broker.accept(callback(start), now + 1) is SunhubBrowserSignIn.Callback.Exchange)
    }

    @Test
    fun expiredChangedOriginAndCancelledAttemptsCannotAuthenticate() {
        val start = broker.begin("login", "company", now)
        assertEquals(
            SunhubBrowserSignIn.Callback.Failure("expired"),
            broker.accept(callback(start), now + 600_001),
        )
        assertEquals(SunhubBrowserSignIn.Callback.Ignore, broker.accept(callback(start), now + 1))
        val next = broker.begin("login", "company", now)
        assertEquals(
            SunhubBrowserSignIn.Callback.Failure("expired"),
            SunhubBrowserSignIn(context, "https://other.example").accept(callback(next), now),
        )
        val cancelled = broker.begin("login", "company", now)
        broker.cancel()
        assertEquals(SunhubBrowserSignIn.Callback.Ignore, broker.accept(callback(cancelled), now))
    }

    @Test
    fun brokerErrorsAreFixedMessagesAndConsumeAttempt() {
        val start = broker.begin("login", "company", now)
        val result =
            broker.accept(callback(start, "error=account_conflict"), now)
                as SunhubBrowserSignIn.Callback.Failure
        assertTrue(SunhubBrowserSignIn.message(result.reason).contains("on the web"))
        assertEquals(SunhubBrowserSignIn.Callback.Ignore, broker.accept(callback(start), now))
        val unknown = broker.begin("login", "company", now)
        assertEquals(
            SunhubBrowserSignIn.Callback.Failure("failed"),
            broker.accept(callback(unknown, "error=untrusted-copy"), now),
        )
    }
}
