package com.sunhub.community

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import com.sunhub.core.CommunityClient
import java.io.FileInputStream
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

    private fun gone(text: String) =
        ui.waitUntil(timeoutMillis = 20_000) {
            ui.onAllNodesWithText(text).fetchSemanticsNodes().isEmpty()
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

    private fun shell(command: String): String =
        InstrumentationRegistry.getInstrumentation()
            .uiAutomation
            .executeShellCommand(command)
            .use { descriptor ->
                FileInputStream(descriptor.fileDescriptor).use { String(it.readBytes()) }
            }

    private fun adaptiveLayout() {
        val oldSize =
            Regex("Override size: (\\S+)").find(shell("wm size"))?.groupValues?.get(1) ?: "reset"
        val oldDensity =
            Regex("Override density: (\\S+)").find(shell("wm density"))?.groupValues?.get(1)
                ?: "reset"
        try {
            ui.onNodeWithTag("news-feed").performScrollToIndex(0)
            ui.onNodeWithTag("navigation-rail").assertDoesNotExist()
            ui.onNodeWithTag("navigation-create").assertHeightIsAtLeast(48.dp)
            ui.onNodeWithText("Share an update").assertDoesNotExist()
            ui.onNodeWithText("The industry, in motion.").assertDoesNotExist()
            ui.onNodeWithText("All posts").assertDoesNotExist()
            capture("native-adaptive-phone")
            shell("wm size 1600x1200")
            shell("wm density 160")
            ui.waitUntil(20_000) {
                ui.onAllNodesWithTag("navigation-rail").fetchSemanticsNodes().isNotEmpty()
            }
            ui.onNodeWithTag("content-lane").assertWidthIsEqualTo(720.dp)
            ui.onNodeWithTag("navigation-create").assertIsDisplayed()
            capture("native-adaptive-tablet")
        } finally {
            shell("wm density $oldDensity")
            shell("wm size $oldSize")
        }
        ui.waitUntil(20_000) {
            ui.onAllNodesWithTag("navigation-rail").fetchSemanticsNodes().isEmpty()
        }
    }

    @Test
    fun companyDiscovery_requestAcceptance_chatAndPublishing() {
        check(BuildConfig.API_URL in setOf("http://10.0.2.2:4101", "http://10.0.2.2:4102")) {
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
        ui.waitUntil(20_000) {
            ui.onAllNodesWithTag("navigation-create").fetchSemanticsNodes().isNotEmpty()
        }
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
        ui.onNodeWithContentDescription("Send request").assertIsEnabled().performSemanticsAction(
            androidx.compose.ui.semantics.SemanticsActions.OnClick
        ) {
            it()
        }
        visible("Request sent. You can chat once they accept.")
        val incoming = JSONObject(b.get("/network")).getJSONArray("incoming").getJSONObject(0)
        b.postJson("/requests/${incoming.getString("id")}/respond", "{\"action\":\"accept\"}")
        visible("Write a message…")
        ui.onNodeWithText("Write a message…").performTextInput("Here is the project scope.")
        // Invoke the enabled send action without racing Android's keyboard animation.
        ui.onNodeWithContentDescription("Send").assertIsEnabled().performSemanticsAction(
            androidx.compose.ui.semantics.SemanticsActions.OnClick
        ) {
            it()
        }
        visible("Here is the project scope.")
        val network = JSONObject(b.get("/network"))
        val connection = network.getJSONArray("connections").getJSONObject(0).getString("id")
        ui.waitUntil(20_000) {
            JSONObject(b.get("/conversations/$connection/messages"))
                .getJSONArray("messages")
                .length() == 2
        }
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
        ui.waitUntil(20_000) {
            ui.onAllNodesWithTag("navigation-create").fetchSemanticsNodes().isNotEmpty()
        }
        ui.onNodeWithTag("navigation-create").performClick()
        ui.onNodeWithText("What’s happening at your company?")
            .performTextInput("Native Android project update $suffix")
        click("Publish")
        click("Update")
        ui.waitUntil(20_000) {
            ui.onAllNodesWithTag("publication-composer").fetchSemanticsNodes().isEmpty()
        }
        try {
            visible("Native Android project update $suffix")
        } catch (failure: Throwable) {
            capture("native-publish-refresh-failure")
            ui.runOnIdle {
                val model =
                    androidx.lifecycle.ViewModelProvider(ui.activity)[CommunityModel::class.java]
                android.util.Log.e(
                    "ConnectQA",
                    "tab=${model.tab}; error=${model.error}; feed=" +
                        model.pages["/feed?scope=all"]
                            ?.optJSONArray("posts")
                            .objects()
                            .take(3)
                            .map { it.text("body") },
                )
            }
            ui.onNodeWithTag("news-feed").printToLog("ConnectQA")
            throw failure
        }
        // The profile workspace and editor use the same API as the web app.
        ui.onNodeWithContentDescription("Account and company").performClick()
        click("Company profile")
        visible("Edit profile")
        capture("native-company-showcase")
        click("Edit profile")
        visible("Company username")
        ui.onNodeWithText("Company username").performTextClearance()
        ui.onNodeWithText("Company username").performTextInput("android-" + suffix)
        capture("native-profile-editor")
        click("Save changes")
        gone("Save changes")
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
        ui.onNodeWithTag("navigation-create").performClick()
        ui.onNodeWithText("Headline").assertDoesNotExist()
        ui.onNodeWithText("Press release").assertDoesNotExist()
        ui.onNodeWithTag("publication-body")
            .performClick()
            .performTextInput(
                "Android field notes $suffix\nA thoughtful solar project starts with listening to the community. $suffix"
            )
        capture("native-publication-editor")
        // The final format choice can be cancelled without changing any writing.
        click("Publish")
        visible("Publish as")
        capture("native-publication-choice")
        click("Keep writing")
        ui.onNodeWithTag("publication-body")
            .assertTextContains("Android field notes $suffix", substring = true)
        ui.onNodeWithContentDescription("Writing options").performClick()
        click("Save & close")
        ui.waitUntil(20_000) {
            ui.onAllNodesWithTag("publication-composer").fetchSemanticsNodes().isEmpty()
        }
        // Reopen a rich draft containing a real uploaded image, then edit around it.
        val draft =
            org.json.JSONArray(a.get("/publications")).objects().first {
                it.text("body").startsWith("Android field notes $suffix")
            }
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val photo = java.io.File(context.cacheDir, "native-editor-photo.png")
        context.resources.openRawResource(R.drawable.connect_icon).use { source ->
            photo.outputStream().use { source.copyTo(it) }
        }
        val uploaded =
            JSONObject(
                a.uploadFile(
                    "/publications/${draft.text("id")}/media",
                    com.sunhub.core.UploadFile(photo.absolutePath, photo.name, "image/png"),
                )
            )
        photo.delete()
        val richDocument = draft.getJSONObject("document")
        richDocument
            .getJSONArray("content")
            .put(
                JSONObject()
                    .put("type", "image")
                    .put(
                        "attrs",
                        JSONObject()
                            .put("src", uploaded.text("url"))
                            .put("alt", "Connect company mark"),
                    )
            )
        richDocument
            .getJSONArray("content")
            .put(JSONObject().put("type", "paragraph").put("content", org.json.JSONArray()))
        a.requestJson(
            "PATCH",
            "/publications/${draft.text("id")}",
            JSONObject()
                .put("kind", "press_release")
                .put("title", draft.text("title"))
                .put("subtitle", draft.text("subtitle"))
                .put("document", richDocument)
                .put("status", "draft")
                .put("version", draft.getInt("version"))
                .toString(),
        )
        ui.onNodeWithContentDescription("Account and company").performClick()
        visible("Drafts")
        click("Drafts")
        visible("Android field notes $suffix")
        click("Android field notes $suffix")
        ui.waitUntil(20_000) {
            ui.onAllNodesWithTag("publication-composer").fetchSemanticsNodes().isNotEmpty()
        }
        ui.onNodeWithTag("publication-body").performScrollTo().performClick()
        val bodyLength =
            ui.onNodeWithTag("publication-body")
                .fetchSemanticsNode()
                .config[androidx.compose.ui.semantics.SemanticsProperties.EditableText]
                .length
        ui.onNodeWithTag("publication-body")
            .performTextInputSelection(androidx.compose.ui.text.TextRange(bodyLength))
        ui.onNodeWithTag("publication-body").performTextInput("Project progress shared.")
        capture("native-inline-photo-editor")
        ui.onNodeWithContentDescription("Writing options").performClick()
        click("Preview")
        ui.onNodeWithText("Preview").assertIsDisplayed()
        ui.onNodeWithText(
                "A thoughtful solar project starts with listening to the community. $suffix"
            )
            .assertIsDisplayed()
        visible("Android field notes $suffix")
        capture("native-publication-preview")
        click("Publish")
        click("Press release")
        ui.waitUntil(20_000) {
            ui.onAllNodesWithTag("publication-composer").fetchSemanticsNodes().isEmpty()
        }
        visible("Android field notes $suffix")
        capture("native-bottom-navigation")
        val feed =
            JSONObject(
                a.get(
                    "/feed?companyId=" + JSONObject(a.get("/session")).getString("activeCompanyId")
                )
            )
        check(feed.getJSONArray("posts").getJSONObject(0).getString("kind") == "press_release")
        // A real activity recreation must preserve the signed-in company and saved session.
        ui.activityRule.scenario.recreate()
        ui.waitUntil(20_000) {
            ui.onAllNodesWithTag("navigation-create").fetchSemanticsNodes().isNotEmpty()
        }
        adaptiveLayout()
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
