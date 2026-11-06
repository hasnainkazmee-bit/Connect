package com.sunhub.community

import android.app.Application
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModelStore
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test

/** Real Compose layout: all attachment types share a square without changing order. */
class PublicationMediaLayoutTest {
    @get:Rule val ui = createComposeRule()
    private lateinit var model: CommunityModel
    private val store = ViewModelStore()

    @Before fun prepare() {
        ui.runOnIdle {
            model = CommunityModel(InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as Application)
            store.put("media-layout", model)
        }
    }

    @After fun finish() { ui.runOnIdle { store.clear() } }

    private fun media(id: String, mime: String) = JSONObject()
        .put("id", id).put("mime", mime).put("url", "").put("name", "$id attachment").put("alt", "Roof photo")

    private fun show(kind: String, vararg media: JSONObject) {
        val post = JSONObject().put("kind", kind).put("media", JSONArray(media.toList()))
        ui.setContent {
            MaterialTheme {
                Box(Modifier.width(300.dp)) { PublicationMediaGallery(model, post, compactRelease = kind == "press_release") }
            }
        }
    }

    private fun square() {
        ui.waitForIdle()
        val visible = ui.onAllNodesWithTag("post-media-frame").fetchSemanticsNodes()
            .first { it.boundsInRoot.width > 0 && it.boundsInRoot.left >= 0 }
        assertEquals(visible.boundsInRoot.width, visible.boundsInRoot.height, 1f)
    }

    @Test fun mixedLegacyGalleryKeepsItsOrderAndSquareForEveryAttachment() {
        show("post", media("photo", "image/png"), media("proposal", "application/pdf"), media("video", "video/mp4"))
        ui.onNodeWithContentDescription("Roof photo").assertIsDisplayed()
        square()
        ui.onNodeWithContentDescription("Next attachment").performClick()
        ui.onNodeWithText("proposal attachment").assertIsDisplayed()
        square()
        ui.onNodeWithContentDescription("Next attachment").performClick()
        ui.onNodeWithText("Play video").assertIsDisplayed()
        square()
        ui.onNodeWithText("3 of 3 attachments").assertIsDisplayed()
    }

    @Test fun removingTheSelectedLastAttachmentResetsToTheRemainingPhoto() {
        var attachments by mutableStateOf(listOf(media("photo", "image/png"), media("proposal", "application/pdf")))
        ui.setContent {
            MaterialTheme {
                Box(Modifier.width(300.dp)) {
                    PublicationMediaGallery(model, JSONObject().put("kind", "post").put("media", JSONArray(attachments)))
                }
            }
        }
        ui.onNodeWithContentDescription("Next attachment").performClick()
        ui.onNodeWithText("Open document").assertIsDisplayed()
        ui.runOnIdle { attachments = attachments.take(1) }
        ui.onNodeWithContentDescription("Roof photo").assertIsDisplayed()
        ui.onNodeWithText("Open document").assertDoesNotExist()
        square()
    }

    @Test fun releaseWithoutPhotosStillShowsItsVideoPreview() {
        show("press_release", media("video", "video/mp4"))
        ui.onNodeWithText("Play video").assertIsDisplayed()
        square()
    }

    @Test fun releaseWithoutPhotosStillShowsItsDocumentPreview() {
        show("press_release", media("proposal", "application/pdf"))
        ui.onNodeWithText("Open document").assertIsDisplayed()
        square()
    }
}
