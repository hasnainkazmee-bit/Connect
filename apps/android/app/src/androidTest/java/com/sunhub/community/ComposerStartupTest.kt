package com.sunhub.community

import android.app.Application
import android.os.SystemClock
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.lifecycle.ViewModelStore
import androidx.test.platform.app.InstrumentationRegistry
import java.net.ServerSocket
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Rule
import org.junit.Test

/** The first usable editor frame must not wait for a draft or any other API response. */
class ComposerStartupTest {
    @get:Rule val ui = createComposeRule()

    @Test fun opensImmediatelyWhileEveryApiResponseIsBlocked_withoutCreatingAnEmptyDraft() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as Application
        SessionStore(app).clear(); PushNotifications.clear(app)
        app.getSharedPreferences("connect-intro", 0).edit().putBoolean("seen", true).commit()
        val companyId = UUID.randomUUID().toString()
        val session = JSONObject().put("user", JSONObject().put("id", UUID.randomUUID().toString()).put("name", "Local owner")
            .put("account_type", "company").put("email_verified_at", "2026-01-01T00:00:00Z").put("onboarding_completed_at", "2026-01-01T00:00:00Z"))
            .put("companies", JSONArray().put(JSONObject().put("id", companyId).put("name", "Local Solar").put("role", "owner")))
            .put("activeCompanyId", companyId)
        val server = ServerSocket(0)
        val blocked = AtomicBoolean(false)
        val release = CountDownLatch(1)
        val paths = CopyOnWriteArrayList<String>()
        val listener = thread(isDaemon = true) {
            while (!server.isClosed) {
                val socket = try { server.accept() } catch (_: Exception) { break }
                thread(isDaemon = true) {
                    socket.use { connection ->
                        runCatching {
                            val path = connection.getInputStream().bufferedReader().readLine().orEmpty().split(' ').getOrNull(1).orEmpty()
                            paths.add(path)
                            if (blocked.get()) release.await()
                            val body = when (path.substringBefore('?')) {
                                "/api/session" -> session.toString()
                                "/api/feed" -> "{\"posts\":[],\"nextCursor\":null}"
                                else -> "{}"
                            }
                            connection.getOutputStream().write(("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.toByteArray().size}\r\nConnection: close\r\n\r\n$body").toByteArray())
                        }
                    }
                }
            }
        }
        val models = ViewModelStore()
        lateinit var model: CommunityModel
        try {
            ui.runOnUiThread { model = CommunityModel(app, "http://127.0.0.1:${server.localPort}"); models.put("startup", model) }
            ui.setContent { MaterialTheme { ConnectApp(model) } }
            ui.waitUntil(20_000) { !model.booting && model.signedIn && model.admin }
            ui.onNodeWithTag("navigation-create").assertIsDisplayed()
            blocked.set(true)
            ui.runOnUiThread { model.load("/feed?scope=all", true) }
            val started = SystemClock.elapsedRealtime()
            ui.onNodeWithTag("navigation-create").performClick()
            ui.waitUntil(1_500) { ui.onAllNodesWithTag("publication-body").fetchSemanticsNodes().isNotEmpty() }
            val elapsed = SystemClock.elapsedRealtime() - started
            check(elapsed < 1_500) { "Editor startup waited ${elapsed}ms with API responses blocked." }
            ui.onNodeWithTag("publication-body").assertIsDisplayed()
            check(paths.none { it.startsWith("/api/publications") }) { "Opening the composer must not create an empty remote draft." }
            android.util.Log.i("ConnectQA", "Composer ready in ${elapsed}ms with API blocked; no draft request.")
            ui.onNodeWithContentDescription("Close").performClick()
        } finally {
            release.countDown(); server.close(); listener.join(1_000)
            ui.runOnUiThread { models.clear() }
            SessionStore(app).clear(); PushNotifications.clear(app)
        }
    }
}
