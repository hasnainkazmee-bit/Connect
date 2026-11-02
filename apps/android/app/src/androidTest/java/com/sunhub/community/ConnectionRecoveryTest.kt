package com.sunhub.community

import android.app.Application
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModelStore
import androidx.test.platform.app.InstrumentationRegistry
import java.net.ServerSocket
import java.net.SocketException
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread
import org.junit.Rule
import org.junit.Test

/** A real Rust HTTP failure followed by recovery, without a public endpoint or adb reverse. */
class ConnectionRecoveryTest {
    @get:Rule val ui = createComposeRule()

    @Test
    fun retry_recoversFirstLoad_andReturningToApp_recoversSavedContent() {
        check(BuildConfig.API_URL in setOf("http://10.0.2.2:4101", "http://10.0.2.2:4102")) {
            "Use the isolated Android test build."
        }
        val application =
            InstrumentationRegistry.getInstrumentation().targetContext.applicationContext
                as Application
        SessionStore(application).clear()
        application
            .getSharedPreferences("connect-intro", android.content.Context.MODE_PRIVATE)
            .edit()
            .putBoolean("seen", true)
            .commit()
        val responding = AtomicBoolean(false)
        val socket = ServerSocket(0)
        val server =
            thread(isDaemon = true) {
                try {
                    while (!socket.isClosed) socket.accept().use { connection ->
                        if (responding.get()) {
                            val request =
                                connection.getInputStream().bufferedReader().readLine().orEmpty()
                            val body =
                                if (request.contains("/api/session"))
                                    """{"user":null,"companies":[]}"""
                                else """{"posts":[],"nextCursor":null}"""
                            connection
                                .getOutputStream()
                                .write(
                                    ("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.toByteArray().size}\r\nConnection: close\r\n\r\n$body")
                                        .toByteArray()
                                )
                        }
                    }
                } catch (_: SocketException) {
                    /* Test teardown closes the listener. */
                }
            }
        val models = ViewModelStore()
        val fontScale = mutableFloatStateOf(1f)
        lateinit var model: CommunityModel
        try {
            ui.runOnUiThread {
                model = CommunityModel(application, "http://127.0.0.1:${socket.localPort}")
                models.put("connection-recovery", model)
            }
            ui.setContent {
                val density = LocalDensity.current
                CompositionLocalProvider(
                    LocalDensity provides Density(density.density, fontScale.floatValue)
                ) {
                    MaterialTheme { ConnectApp(model) }
                }
            }
            ui.waitUntil(20_000) {
                ui.onAllNodesWithText("Retry").fetchSemanticsNodes().isNotEmpty()
            }
            responding.set(true)
            ui.onNodeWithText("Retry").performClick()
            ui.waitUntil(20_000) { !model.offline && model.pages.containsKey("/feed?scope=all") }
            ui.onNodeWithText("Retry").assertDoesNotExist()
            // Exercise the same sp scaling used by Android without mutating global
            // emulator configuration while instrumentation owns its main thread.
            ui.runOnUiThread { fontScale.floatValue = 1.3f }
            ui.onNodeWithText("The industry, in motion.").assertDoesNotExist()
            ui.onNodeWithText("Sign in").assertIsDisplayed().assertHeightIsAtLeast(48.dp)
            ui.onNodeWithText("No posts yet. Follow companies to hear what they’re working on.")
                .assertExists()

            responding.set(false)
            ui.onNodeWithTag("navigation-Home").performClick()
            ui.waitUntil(20_000) { model.offline }
            ui.onNodeWithText("Offline · showing saved content").assertExists()
            responding.set(true)
            ui.runOnUiThread {
                model.observe(false)
                model.observe(true)
            }
            ui.waitUntil(20_000) { !model.offline }
            ui.onNodeWithText("Retry").assertDoesNotExist()
        } finally {
            ui.runOnUiThread { models.clear() }
            socket.close()
            server.join(2_000)
        }
    }
}
