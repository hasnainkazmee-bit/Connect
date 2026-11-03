package com.sunhub.community

import android.app.Application
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.*
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.lifecycle.ViewModelStore
import androidx.test.platform.app.InstrumentationRegistry
import com.sunhub.core.CommunityClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.json.JSONObject
import org.junit.Rule
import org.junit.Test

class NotificationFlowTest {
    @get:Rule val ui = createComposeRule()
    private fun waitText(text: String) = ui.waitUntil(20_000) { ui.onAllNodesWithText(text, substring = true).fetchSemanticsNodes().isNotEmpty() }

    @Test fun liveInbox_preferences_commentTap_andLogoutIsolation() {
        check(BuildConfig.API_URL == "http://10.0.2.2:4102")
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as Application
        SessionStore(app).clear(); PushNotifications.clear(app)
        app.getSharedPreferences("connect-intro", 0).edit().putBoolean("seen", true).commit()
        val suffix = System.currentTimeMillis().toString()
        val password = "PushNativeTest123!"
        val email = "push$suffix@native.test"
        val owner = CommunityClient(BuildConfig.API_URL, ":memory:", true)
        val commenter = CommunityClient(BuildConfig.API_URL, ":memory:", true)
        val models = ViewModelStore()
        lateinit var model: CommunityModel
        fun register(client: CommunityClient, email: String, name: String) = JSONObject(client.postJson("/auth/register", JSONObject().put("name", name).put("email", email).put("password", password).put("companyName", name).toString()))
        try {
            register(owner, email, "Push Solar $suffix")
            val reviewer = register(commenter, "commenter$suffix@native.test", "Review Solar $suffix")
            val post = JSONObject(owner.postJson("/posts", JSONObject().put("body", "A project with a live notification $suffix").toString()))
            ui.runOnUiThread { model = CommunityModel(app); models.put("push", model) }
            ui.setContent { MaterialTheme(shapes = ConnectShapes, colorScheme = androidx.compose.material3.lightColorScheme(primary = Ink, onPrimary = androidx.compose.ui.graphics.Color.White, surface = androidx.compose.ui.graphics.Color.White, onSurface = Ink, onSurfaceVariant = Muted, background = Pale)) { ConnectApp(model) } }
            ui.waitUntil(20_000) { !model.booting }
            ui.runOnUiThread { model.authenticate(email, password) }
            ui.waitUntil(20_000) { model.signedIn && model.sessionReady && !model.busy }
            ui.onNodeWithContentDescription("Notifications", useUnmergedTree = true).performClick()
            waitText("Your activity")
            // No manual refresh: the authenticated user event stream invalidates the inbox.
            val message = "A useful project update $suffix"
            commenter.postJson("/posts/${post.getString("id")}/comments", JSONObject().put("body", message).toString())
            ui.waitUntil(20_000) { model.pages["/notifications"]?.optJSONArray("notifications").objects().any { it.text("url").contains(post.getString("id")) } }
            ui.waitUntil(10_000) { model.pages["/notifications"]?.optInt("unread") == 0 }
            val firstNotice = model.pages["/notifications"]!!.optJSONArray("notifications").objects().first { it.text("url").contains(post.getString("id")) }
            check(firstNotice.text("id") in model.readNotificationIds)
            ui.onNodeWithTag("notification-${firstNotice.text("id")}").assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, "Read"))
            ui.onNodeWithText("Mark all as read").assertDoesNotExist()
            ui.onNodeWithContentDescription("Notification settings").performClick()
            waitText("Show message previews")
            val messages = ui.onNodeWithTag("notification-preference-messages")
            messages.assertIsOn().performClick()
            ui.waitUntil(10_000) { model.pages["/notifications/preferences"]?.optBoolean("messages") == false }
            check(!JSONObject(owner.get("/notifications/preferences")).getBoolean("messages"))
            ui.onNodeWithText("Show message previews").assertExists()
            InstrumentationRegistry.getInstrumentation().waitForIdleSync()
            val capture = android.content.ContentValues().apply {
                put(android.provider.MediaStore.Downloads.DISPLAY_NAME, "notification-settings-054.png")
                put(android.provider.MediaStore.Downloads.MIME_TYPE, "image/png")
                put(android.provider.MediaStore.Downloads.RELATIVE_PATH, "Download/ConnectQA")
            }
            val target = app.contentResolver.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, capture)!!
            app.contentResolver.openOutputStream(target)!!.use {
                InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot().compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
            }
            ui.onNodeWithContentDescription("View notifications").performClick()
            val item = model.pages["/notifications"]!!.optJSONArray("notifications").objects().first { it.text("url").contains(post.getString("id")) }
            ui.onNodeWithText(item.text("title")).performClick()
            waitText(message)
            // A notification opened the existing post/comments experience, not a browser URL.
            check(model.signedIn)
            ui.waitUntil(10_000) { model.pages["/notifications"]?.optInt("unread") == 0 }
            val followUp = JSONObject(commenter.postJson("/posts/${post.getString("id")}/comments", JSONObject().put("body", "A follow-up while reading $suffix").toString()))
            ui.waitUntil(15_000) { model.pages["/notifications"]?.optJSONArray("notifications").objects().any { it.text("url").contains(followUp.getJSONObject("created_comment").getString("id")) } }
            // Related content is open; the context endpoint clears the new item without reopening the inbox.
            ui.waitUntil(10_000) { model.pages["/notifications"]?.optInt("unread") == 0 }
            check(JSONObject(owner.get("/notifications")).getInt("unread") == 0)
            val readFollowUp = model.pages["/notifications"]!!.optJSONArray("notifications").objects().first { it.text("url").contains(followUp.getJSONObject("created_comment").getString("id")) }
            check(readFollowUp.text("id") in model.readNotificationIds)
            val otherCompany = reviewer.getJSONArray("companies").getJSONObject(0).getString("id")
            runBlocking { withContext(Dispatchers.Main) { model.openNotification(NotificationDestination("companyChat", otherCompany), null) } }
            check(model.chatCompany?.text("id") == otherCompany && model.tab == Tab.Messages)
            ui.runOnUiThread { model.logout() }
            ui.waitUntil(15_000) { !model.signedIn && !model.busy }
            check(PushDeviceStore(app).binding() == null)
            check(SessionStore(app).read() == null)
        } finally {
            ui.runOnUiThread { models.clear() }
            owner.destroy(); commenter.destroy(); PushNotifications.clear(app); SessionStore(app).clear()
        }
    }
}
