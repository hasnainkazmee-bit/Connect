package com.sunhub.community

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import com.sunhub.core.CommunityClient
import org.json.JSONObject
import org.junit.Rule
import org.junit.Test

/**
 * End-to-end company identity, multiple emoji reactions, threaded replies and failed-send drafts.
 */
class PostInteractionsTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()

    private fun visible(text: String) =
        ui.waitUntil(20_000) { ui.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty() }

    private fun tag(value: String) =
        ui.waitUntil(20_000) { ui.onAllNodesWithTag(value).fetchSemanticsNodes().isNotEmpty() }

    private fun click(text: String) =
        ui.onAllNodes(hasText(text) and hasClickAction()).onLast().performClick()

    private fun action(tag: String) =
        ui.onNodeWithTag(tag).performSemanticsAction(SemanticsActions.OnClick) { it() }

    private fun closeSheet() = ui.onAllNodesWithContentDescription("Close").onLast().performClick()

    private fun capture(name: String) {
        ui.waitForIdle()
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
    fun lateMutationResponsesPreserveNewerUnrelatedCounts() {
        val current =
            JSONObject(
                "{\"id\":\"post\",\"comment_count\":8,\"reaction_count\":3,\"body\":\"A project\"}"
            )
        val staleReaction = JSONObject("{\"id\":\"post\",\"comment_count\":6,\"reaction_count\":4}")
        val mergedReaction = mergeSocialPost(current, staleReaction, SocialPostChange.Reactions)
        check(
            mergedReaction.getInt("comment_count") == 8 &&
                mergedReaction.getInt("reaction_count") == 4
        )
        val staleComment = JSONObject("{\"id\":\"post\",\"comment_count\":9,\"reaction_count\":2}")
        val mergedComment = mergeSocialPost(mergedReaction, staleComment, SocialPostChange.Comments)
        check(
            mergedComment.getInt("comment_count") == 9 &&
                mergedComment.getInt("reaction_count") == 4
        )
        check(mergedComment.getString("body") == "A project")
    }

    @Test
    fun arbitraryReactions_companyActors_threadedReplies_andFailedDraft() {
        check(BuildConfig.API_URL in setOf("http://10.0.2.2:4101", "http://10.0.2.2:4102"))
        val suffix = System.currentTimeMillis().toString()
        val password = "ConnectInteractions123!"
        val email = "reaction$suffix@native.test"
        val name = "Reaction Solar $suffix"
        val a = CommunityClient(BuildConfig.API_URL, ":memory:", true)
        val b = CommunityClient(BuildConfig.API_URL, ":memory:", true)
        fun register(client: CommunityClient, address: String, company: String) =
            client.postJson(
                "/auth/register",
                JSONObject()
                    .put("name", "Team member")
                    .put("email", address)
                    .put("password", password)
                    .put("companyName", company)
                    .toString(),
            )
        try {
            register(a, email, name)
            register(b, "project$suffix@native.test", "Project Solar $suffix")
            val post =
                JSONObject(
                    b.postJson(
                        "/posts",
                        JSONObject().put("body", "A new project to celebrate $suffix").toString(),
                    )
                )
            val postId = post.getString("id")
            fun postMatcher(tag: String) =
                hasTestTag(tag) and hasAnyAncestor(hasTestTag("post-actions-$postId"))
            fun postAction(tag: String) =
                ui.onNode(postMatcher(tag)).performSemanticsAction(SemanticsActions.OnClick) {
                    it()
                }

            b.postJson("/posts/$postId/reactions", "{\"emoji\":\"👍\",\"reacted\":true}")
            val original =
                JSONObject(
                        b.postJson(
                            "/posts/$postId/comments",
                            "{\"body\":\"What would you like to know about this project?\"}",
                        )
                    )
                    .getJSONObject("created_comment")

            ui.waitUntil(20_000) {
                ui.onAllNodesWithText("Explore the community first")
                    .fetchSemanticsNodes()
                    .isNotEmpty() ||
                    ui.onAllNodesWithTag("news-feed").fetchSemanticsNodes().isNotEmpty()
            }
            if (
                ui.onAllNodesWithText("Explore the community first")
                    .fetchSemanticsNodes()
                    .isNotEmpty()
            )
                click("Explore the community first")
            if (
                ui.onAllNodesWithContentDescription("Account and company")
                    .fetchSemanticsNodes()
                    .isNotEmpty()
            ) {
                ui.onNodeWithContentDescription("Account and company").performClick()
                click("Sign out")
                visible("Sign in")
            }
            click("Sign in")
            visible("Work email")
            ui.onNodeWithText("Work email").performTextInput(email)
            ui.onNodeWithText("Password").performTextInput(password)
            click("Sign in")
            visible("Share an update")
            ui.onNodeWithTag("news-feed").performScrollToNode(hasTestTag("react-$postId"))
            action("react-$postId")
            tag("emoji-picker")
            ui.waitUntil(20_000) {
                ui.onAllNodes(
                        SemanticsMatcher("emoji grid") {
                            it.config
                                .getOrNull(
                                    androidx.compose.ui.semantics.SemanticsProperties.TestTag
                                )
                                ?.startsWith("emoji-") == true
                        }
                    )
                    .fetchSemanticsNodes()
                    .size > 5
            }
            capture("native-emoji-picker")
            ui.onNodeWithTag("emoji-search").performTextInput("rocket")
            tag("emoji-🚀")
            action("emoji-🚀")
            ui.waitUntil(20_000) {
                ui.onAllNodes(postMatcher("reaction-🚀")).fetchSemanticsNodes().isNotEmpty()
            }
            ui.onNodeWithTag("news-feed").performScrollToNode(postMatcher("reaction-👍"))
            postAction("reaction-👍")
            ui.waitUntil(20_000) {
                val reactions =
                    JSONObject(
                            a.get(
                                "/feed?companyId=" +
                                    JSONObject(b.get("/session")).getString("activeCompanyId")
                            )
                        )
                        .getJSONArray("posts")
                        .getJSONObject(0)
                        .getJSONArray("reactions")
                        .objects()
                reactions.count { it.optBoolean("reacted") } == 2
            }
            postAction("reaction-🚀")
            ui.waitUntil(20_000) {
                ui.onAllNodes(postMatcher("reaction-🚀")).fetchSemanticsNodes().isEmpty()
            }
            postAction("who-reacted")
            tag("reaction-actors")
            visible("All 2")
            visible(name)
            click("👍 2")
            visible(name)
            capture("native-who-reacted")
            closeSheet()

            ui.onNodeWithTag("news-feed").performScrollToNode(hasTestTag("comments-$postId"))
            action("comments-$postId")
            tag("comments-sheet")
            tag("comment-${original.text("id")}")
            ui.onNode(
                    hasText("Reply") and
                        hasAnyAncestor(hasTestTag("comment-${original.text("id")}"))
                )
                .performClick()
            ui.onNodeWithTag("comment-draft").assertIsFocused()
            ui.onNodeWithTag("comment-draft").performTextInput("How large is the installation?")
            action("send-comment")
            visible("How large is the installation?")
            val firstReply =
                JSONObject(a.get("/posts/$postId/comments/${original.text("id")}/replies"))
                    .getJSONArray("comments")
                    .getJSONObject(0)
            ui.onNode(
                    hasText("Reply") and
                        hasAnyAncestor(hasTestTag("comment-${firstReply.text("id")}"))
                )
                .performScrollTo()
                .performClick()
            ui.onNodeWithTag("comment-draft").performTextInput("And when was it commissioned?")
            action("send-comment")
            visible("And when was it commissioned?")
            val replies =
                JSONObject(a.get("/posts/$postId/comments/${original.text("id")}/replies"))
                    .getJSONArray("comments")
                    .objects()
            check(replies.size == 2)
            check(replies.last().text("parent_id") == original.text("id"))
            check(replies.last().text("reply_to_id") == firstReply.text("id"))
            ui.onNodeWithTag("comments-list").performScrollToNode(hasText("Hide replies"))
            click("Hide replies")
            ui.onNodeWithText("And when was it commissioned?").assertDoesNotExist()
            click("View 2 replies")
            visible("And when was it commissioned?")
            capture("native-threaded-comments")

            ui.onNodeWithTag("comment-draft")
                .performTextInput("Keep this question visible for customers.")
            action("send-comment")
            visible("Keep this question visible for customers.")
            val ownRoot =
                JSONObject(a.get("/posts/$postId/comments"))
                    .getJSONArray("comments")
                    .objects()
                    .last()
            b.postJson(
                "/posts/$postId/comments",
                JSONObject()
                    .put("body", "Our team can help with that.")
                    .put("parentId", ownRoot.text("id"))
                    .toString(),
            )
            closeSheet()
            action("comments-$postId")
            tag("comment-${ownRoot.text("id")}")
            ui.onNodeWithTag("comments-list")
                .performScrollToNode(hasTestTag("comment-${ownRoot.text("id")}"))
            ui.onNode(
                    hasContentDescription("Comment options") and
                        hasAnyAncestor(hasTestTag("comment-${ownRoot.text("id")}"))
                )
                .performClick()
            click("Delete comment")
            click("Delete")
            visible("This comment was deleted.")
            click("View 1 reply")
            visible("Our team can help with that.")

            ui.onNodeWithTag("comment-draft")
                .performTextInput("This draft must survive a failed request.")
            closeSheet()
            action("comments-$postId")
            tag("comments-sheet")
            ui.onNodeWithTag("comment-draft")
                .assertTextContains("This draft must survive a failed request.")
            val currentSession = CommunityClient(BuildConfig.API_URL, ":memory:", true)
            try {
                currentSession.restoreSession(
                    checkNotNull(
                        SessionStore(InstrumentationRegistry.getInstrumentation().targetContext)
                            .read()
                    )
                )
                currentSession.postJson("/auth/logout", "{}")
            } finally {
                currentSession.destroy()
            }
            action("send-comment")
            ui.waitUntil(20_000) {
                runCatching { ui.onNodeWithTag("send-comment").assertIsEnabled() }.isSuccess
            }
            ui.onNodeWithTag("comment-draft")
                .assertTextContains("This draft must survive a failed request.")
            closeSheet()
            ui.onNodeWithContentDescription("Account and company").performClick()
            click("Sign out")
            visible("Sign in")
        } finally {
            a.destroy()
            b.destroy()
        }
    }
}
