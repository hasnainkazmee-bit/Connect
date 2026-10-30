package com.sunhub.community

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import com.sunhub.core.CommunityClient
import org.json.JSONObject
import org.junit.Rule
import org.junit.Test

/** Uses the isolated API on port 4101; never run this scenario against production. */
class NativeFlowTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()

    private fun visible(text: String) =
        ui.waitUntil(timeoutMillis = 20_000) {
            ui.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty()
        }

    private fun click(text: String) =
        ui.onAllNodes(hasText(text) and hasClickAction()).onLast().performClick()

    private fun capture(name: String) {
        ui.waitForIdle()
        // Compose semantics can settle before Android has drawn a newly opened dialog.
        InstrumentationRegistry.getInstrumentation().waitForIdleSync()
        android.os.SystemClock.sleep(500)
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val values =
            android.content.ContentValues().apply {
                put(android.provider.MediaStore.Downloads.DISPLAY_NAME, "$name.png")
                put(android.provider.MediaStore.Downloads.MIME_TYPE, "image/png")
                put(android.provider.MediaStore.Downloads.RELATIVE_PATH, "Download/ConnectQA")
            }
        val target =
            context.contentResolver.insert(
                android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                values,
            )!!
        context.contentResolver.openOutputStream(target)!!.use {
            InstrumentationRegistry.getInstrumentation()
                .uiAutomation
                .takeScreenshot()
                .compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
        }
    }

    @Test
    fun companyDiscovery_requestAcceptance_chatAndPublishing() {
        check(BuildConfig.API_URL == "http://10.0.2.2:4101") {
            "Build instrumentation with -PsunhubApiUrl=http://10.0.2.2:4101 and run the isolated test API."
        }
        val suffix = System.currentTimeMillis().toString()
        val aName = "Android Solar $suffix"
        val bName = "Native EPC $suffix"
        val email = "android$suffix@native.test"
        val password = "AndroidFlow123!"
        val a = CommunityClient(BuildConfig.API_URL, ":memory:", true)
        val b = CommunityClient(BuildConfig.API_URL, ":memory:", true)
        fun register(client: CommunityClient, address: String, name: String) =
            JSONObject(
                client.postJson(
                    "/auth/register",
                    JSONObject()
                        .put("name", name)
                        .put("email", address)
                        .put("password", password)
                        .put("companyName", name)
                        .toString(),
                )
            )
        register(a, email, aName)
        val recipient = register(b, "recipient$suffix@native.test", bName)
        visible("Sign in")
        if (ui.onAllNodesWithText("Explore the community first").fetchSemanticsNodes().isNotEmpty())
            click("Explore the community first")
        click("Messages")
        visible("Work email")
        ui.onNodeWithText("Work email").performTextInput(email)
        ui.onNodeWithText("Password").performTextInput(password)
        click("Sign in")
        visible("All companies")
        click("Home")
        visible("Share an update")
        val restored = CommunityClient(BuildConfig.API_URL, ":memory:", true)
        restored.restoreSession(
            checkNotNull(
                SessionStore(InstrumentationRegistry.getInstrumentation().targetContext).read()
            )
        )
        check(
            JSONObject(restored.get("/session")).getJSONObject("user").getString("email") == email
        )
        restored.destroy()
        ui.onNodeWithTag("main-tabs").performTouchInput { swipeLeft() }
        visible("Search companies…")
        ui.onNodeWithText("Search companies…").performTextInput(bName)
        visible(bName)
        ui.waitUntil(20_000) {
            ui.onAllNodesWithTag("company-${recipient.getString("activeCompanyId")}")
                .fetchSemanticsNodes()
                .isNotEmpty()
        }
        ui.onNodeWithTag("company-${recipient.getString("activeCompanyId")}").performClick()
        visible("Follow")
        click("Follow")
        visible("Following")
        click("Message")
        visible("Say hello…")
        ui.onNodeWithText("Say hello…").performTextInput("Can you help with a solar installation?")
        ui.onNodeWithContentDescription("Send request").performClick()
        visible("Request sent. You can chat once they accept.")
        val incoming = JSONObject(b.get("/network")).getJSONArray("incoming").getJSONObject(0)
        b.postJson("/requests/${incoming.getString("id")}/respond", "{\"action\":\"accept\"}")
        visible("Write a message…")
        ui.onNodeWithText("Write a message…").performTextInput("Here is the project scope.")
        ui.onNodeWithContentDescription("Send").performClick()
        visible("Here is the project scope.")
        val network = JSONObject(b.get("/network"))
        val connection = network.getJSONArray("connections").getJSONObject(0).getString("id")
        val history =
            JSONObject(b.get("/conversations/$connection/messages")).getJSONArray("messages")
        check(history.length() == 2)
        check(
            history.getJSONObject(0).getString("body") == "Can you help with a solar installation?"
        )
        ui.onNodeWithContentDescription("Back").performClick()
        click("Network")
        visible("1 connections")
        click("Home")
        visible("Share an update")
        click("Share an update")
        ui.onNodeWithText("What’s happening at your company?")
            .performTextInput("Native Android project update $suffix")
        click("Post")
        visible("Native Android project update $suffix")
        // The profile workspace and editor use the same API as the web app.
        ui.onNodeWithContentDescription("Account and company").performClick()
        click("Company profile")
        visible("Edit profile")
        click("Edit profile")
        visible("Company username")
        ui.onNodeWithText("Company username").performTextClearance()
        ui.onNodeWithText("Company username").performTextInput("android-" + suffix)
        capture("native-profile-editor")
        click("Save changes")
        visible("@android-" + suffix)
        click("Invite employees")
        visible("Invite employee")
        click("Invite employee")
        ui.onNodeWithText("Employee’s work email").performTextInput("employee$suffix@native.test")
        click("Create invitation")
        visible("Your invitation is ready.")
        capture("native-employee-invite")
        ui.onNode(hasText("/join/android-" + suffix, substring = true)).assertExists()
        ui.onNodeWithContentDescription("Close").performClick()
        ui.onNodeWithContentDescription("Close").performClick()
        ui.onNodeWithContentDescription("Back").performClick()
        click("Home")
        click("Share an update")
        click("Article")
        ui.onNodeWithText("Story title").performTextInput("Android field notes $suffix")
        ui.onNodeWithText("Tell your story…")
            .performScrollTo()
            .performTextInput("A thoughtful solar project starts with listening to the community.")
        click("Save & close")
        visible("Drafts")
        click("Drafts")
        visible("Android field notes $suffix")
        click("Android field notes $suffix")
        click("Preview")
        visible("Android field notes $suffix")
        capture("native-publication-preview")
        click("Publish")
        visible("Android field notes $suffix")
        capture("native-bottom-navigation")
        val feed =
            JSONObject(
                a.get(
                    "/feed?companyId=" + JSONObject(a.get("/session")).getString("activeCompanyId")
                )
            )
        check(feed.getJSONArray("posts").getJSONObject(0).getString("kind") == "article")
        // A real activity recreation must preserve the signed-in company and saved session.
        ui.activityRule.scenario.recreate()
        visible("Share an update")
        ui.onNodeWithContentDescription("Account and company").performClick()
        click("Sign out")
        visible("Sign in")
        // A visitor who starts from a company profile should land in that conversation after login.
        click("Companies")
        ui.onNodeWithText("Search companies…").performTextInput(bName)
        ui.waitUntil(20_000) {
            ui.onAllNodesWithTag("company-${recipient.getString("activeCompanyId")}")
                .fetchSemanticsNodes()
                .isNotEmpty()
        }
        ui.onNodeWithTag("company-${recipient.getString("activeCompanyId")}").performClick()
        visible("Message")
        click("Message")
        visible("Work email")
        ui.onNodeWithText("Work email").performTextInput(email)
        ui.onNodeWithText("Password").performTextInput(password)
        click("Sign in")
        visible("Write a message…")
        ui.onNodeWithContentDescription("Account and company").performClick()
        click("Sign out")
        visible("Sign in")
        a.destroy()
        b.destroy()
    }
}
