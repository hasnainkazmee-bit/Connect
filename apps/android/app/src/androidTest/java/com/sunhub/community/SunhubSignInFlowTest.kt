package com.sunhub.community

import android.app.Activity
import android.app.Application
import android.app.Instrumentation
import android.content.Intent
import android.net.Uri
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import androidx.test.platform.app.InstrumentationRegistry
import java.net.ServerSocket
import java.util.concurrent.atomic.AtomicInteger
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Browser handoff and native persistence, using a local broker instead of real Sunhub accounts. */
class SunhubSignInFlowTest {
    @get:Rule val ui = createComposeRule()
    private val instrumentation
        get() = InstrumentationRegistry.getInstrumentation()

    private fun capture(name: String) {
        instrumentation.waitForIdleSync()
        val context = instrumentation.targetContext
        val uri =
            context.contentResolver.insert(
                android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                android.content.ContentValues().apply {
                    put(android.provider.MediaStore.Downloads.DISPLAY_NAME, "$name.png")
                    put(android.provider.MediaStore.Downloads.MIME_TYPE, "image/png")
                    put(android.provider.MediaStore.Downloads.RELATIVE_PATH, "Download/ConnectQA")
                },
            )!!
        context.contentResolver.openOutputStream(uri)!!.use {
            instrumentation.uiAutomation
                .takeScreenshot()
                .compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
        }
    }

    private class Broker : AutoCloseable {
        private val listener = ServerSocket(0)
        val origin = "http://127.0.0.1:${listener.localPort}"
        val cookie = "sunhub_session=" + "b".repeat(64)
        @Volatile var enabled = false
        @Volatile var challenge = ""
        val exchanges = AtomicInteger()
        private val session =
            JSONObject()
                .put(
                    "user",
                    JSONObject()
                        .put("id", "sunhub-native-test-user")
                        .put("name", "Sunhub Member")
                        .put("email", "member@native.test")
                        .put("account_type", "individual")
                        .put("email_verified_at", "2026-01-01T00:00:00Z")
                        .put("onboarding_completed_at", "2026-01-01T00:00:00Z"),
                )
                .put("companies", org.json.JSONArray())
                .put("activeCompanyId", JSONObject.NULL)
                .put("verificationRequired", true)
        private val worker =
            Thread {
                    while (!listener.isClosed) {
                        val socket =
                            try {
                                listener.accept()
                            } catch (_: Exception) {
                                break
                            }
                        socket.use {
                            val input = it.getInputStream().bufferedReader()
                            val first = input.readLine() ?: return@use
                            val headers = mutableMapOf<String, String>()
                            while (true) {
                                val line = input.readLine() ?: break
                                if (line.isEmpty()) break
                                val split = line.indexOf(':')
                                if (split >= 0)
                                    headers[line.take(split).lowercase()] =
                                        line.substring(split + 1).trim()
                            }
                            val chars = CharArray(headers["content-length"]?.toIntOrNull() ?: 0)
                            var read = 0
                            while (read < chars.size) {
                                val count = input.read(chars, read, chars.size - read)
                                if (count < 0) break
                                read += count
                            }
                            val path = first.split(' ')[1].substringBefore('?')
                            var setCookie = ""
                            var status = "200 OK"
                            val body =
                                when (path) {
                                    "/api/auth/sunhub/config" ->
                                        JSONObject().put("enabled", enabled).toString()
                                    "/api/auth/sunhub/mobile/exchange" -> {
                                        val data = JSONObject(String(chars))
                                        if (
                                            data.optString("code") == "h".repeat(43) &&
                                                SunhubBrowserSignIn.challenge(
                                                    data.optString("verifier")
                                                ) == challenge
                                        ) {
                                            exchanges.incrementAndGet()
                                            setCookie =
                                                "Set-Cookie: $cookie; HttpOnly; SameSite=Lax\r\n"
                                            session.toString()
                                        } else {
                                            status = "400 Bad Request"
                                            "{\"error\":\"Invalid handoff\"}"
                                        }
                                    }
                                    "/api/session" ->
                                        if (headers["cookie"] == cookie) session.toString()
                                        else "{\"user\":null,\"companies\":[]}"
                                    "/api/feed" -> "{\"posts\":[],\"nextCursor\":null}"
                                    else -> "{}"
                                }
                            it.getOutputStream()
                                .write(
                                    ("HTTP/1.1 $status\r\nContent-Type: application/json\r\nContent-Length: ${body.toByteArray().size}\r\n${setCookie}Connection: close\r\n\r\n$body")
                                        .toByteArray()
                                )
                        }
                    }
                }
                .apply {
                    isDaemon = true
                    start()
                }

        override fun close() {
            listener.close()
            worker.join(2_000)
        }
    }

    @Test
    fun ownLoginStaysPrimaryAndSunhubReturnPersistsAcrossNativeRestart() {
        val app = instrumentation.targetContext.applicationContext as Application
        SessionStore(app).clear()
        val stores = mutableListOf<ViewModelStore>()
        Broker().use { broker ->
            fun model(): CommunityModel {
                val holder = ViewModelStore().also { stores.add(it) }
                return ViewModelProvider(
                    holder,
                    object : ViewModelProvider.Factory {
                        override fun <T : ViewModel> create(modelClass: Class<T>): T {
                            @Suppress("UNCHECKED_CAST")
                            return CommunityModel(app, broker.origin) as T
                        }
                    },
                )[CommunityModel::class.java]
            }
            val model = model()
            var signedIn = false
            val launched = java.util.concurrent.atomic.AtomicReference<Uri?>()
            val browser =
                object : Instrumentation.ActivityMonitor() {
                    override fun onStartActivity(intent: Intent): Instrumentation.ActivityResult? {
                        if (
                            intent.action == Intent.ACTION_VIEW &&
                                intent.data?.path == "/api/auth/sunhub/start"
                        ) {
                            launched.set(intent.data)
                            return Instrumentation.ActivityResult(Activity.RESULT_CANCELED, null)
                        }
                        return null
                    }
                }
            instrumentation.addMonitor(browser)
            try {
                ui.setContent {
                    MaterialTheme { AuthScreen(model, "login", {}, { signedIn = true }) }
                }
                ui.waitUntil(20_000) { !model.booting }
                ui.onNodeWithText("Work email").assertExists()
                ui.onNodeWithText("Password").assertExists()
                ui.onNodeWithText("Sign in with Sunhub").assertDoesNotExist()
                broker.enabled = true
                ui.runOnIdle { model.loadSunhubConfiguration() }
                ui.waitUntil(20_000) { model.sunhubEnabled }
                val primary =
                    ui.onNode(hasText("Sign in") and hasClickAction())
                        .fetchSemanticsNode()
                        .boundsInRoot
                val secondary =
                    ui.onNodeWithText("Sign in with Sunhub").fetchSemanticsNode().boundsInRoot
                assertTrue(secondary.top >= primary.bottom)
                capture("native-sunhub-login")
                ui.onNodeWithText("Sign in with Sunhub").performScrollTo().performClick()
                ui.waitUntil(20_000) { launched.get() != null }
                val start = launched.get()!!
                assertEquals("login", start.getQueryParameter("intent"))
                assertNull(start.getQueryParameter("verifier"))
                broker.challenge = start.getQueryParameter("code_challenge")!!
                val callback =
                    Uri.parse(
                        start.getQueryParameter("redirect_uri") +
                            "?code=" +
                            "h".repeat(43) +
                            "&state=" +
                            start.getQueryParameter("state")
                    )
                ui.runOnIdle { model.handleSunhubCallback(callback) }
                ui.waitUntil(20_000) { signedIn && model.signedIn }
                ui.waitUntil(20_000) { SessionStore(app).read() == broker.cookie }
                assertEquals(1, broker.exchanges.get())
                assertEquals(
                    "Sunhub Member",
                    model.session!!.getJSONObject("user").getString("name"),
                )
                assertFalse(model.needsOnboarding)
                ui.runOnIdle { model.handleSunhubCallback(callback) }
                ui.waitForIdle()
                assertEquals(1, broker.exchanges.get())
                val restored = model()
                ui.waitUntil(20_000) { !restored.booting && restored.signedIn }
                assertEquals(
                    "Sunhub Member",
                    restored.session!!.getJSONObject("user").getString("name"),
                )
                assertFalse(
                    app.getSharedPreferences("session", 0).all.toString().contains(broker.cookie)
                )
            } finally {
                instrumentation.removeMonitor(browser)
                instrumentation.runOnMainSync { stores.forEach { it.clear() } }
                SessionStore(app).clear()
                SunhubBrowserSignIn(app, broker.origin).cancel()
            }
        }
    }

    @Test
    fun coldBrowserFailureReturnsToConnectLoginWithUsefulGuidance() {
        val app = instrumentation.targetContext.applicationContext as Application
        SessionStore(app).clear()
        app.getSharedPreferences("connect-intro", 0).edit().clear().commit()
        val holder = ViewModelStore()
        Broker().use { broker ->
            broker.enabled = true
            val pending = SunhubBrowserSignIn(app, broker.origin)
            val start = pending.begin("login", "company")
            val model =
                ViewModelProvider(
                    holder,
                    object : ViewModelProvider.Factory {
                        override fun <T : ViewModel> create(modelClass: Class<T>): T {
                            @Suppress("UNCHECKED_CAST")
                            return CommunityModel(app, broker.origin) as T
                        }
                    },
                )[CommunityModel::class.java]
            try {
                ui.setContent { MaterialTheme { ConnectApp(model) } }
                ui.runOnIdle {
                    model.handleSunhubCallback(
                        Uri.parse(
                            pending.redirectUri +
                                "?state=" +
                                start.getQueryParameter("state") +
                                "&error=account_conflict"
                        )
                    )
                }
                ui.waitUntil(20_000) {
                    ui.onAllNodesWithText("Welcome back.").fetchSemanticsNodes().isNotEmpty()
                }
                ui.onNodeWithText("Work email").assertExists()
                ui.onNodeWithText("Password").assertExists()
                ui.onNodeWithText("This email already has a Connect account.", substring = true)
                    .assertExists()
                assertFalse(model.signedIn)
                assertEquals(0, broker.exchanges.get())
                capture("native-sunhub-link-guidance")
            } finally {
                instrumentation.runOnMainSync { holder.clear() }
                SessionStore(app).clear()
                pending.cancel()
            }
        }
    }
}
