package com.sunhub.community

import android.app.Activity
import android.app.Instrumentation
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.drawable.BitmapDrawable
import android.view.View
import android.view.ViewGroup
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.core.content.FileProvider
import androidx.test.platform.app.InstrumentationRegistry
import com.sunhub.core.CommunityClient
import java.io.File
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Exercises the real picker callback, crop export, upload and rendered native image. */
class PublicationPhotoTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()
    private val instrumentation
        get() = InstrumentationRegistry.getInstrumentation()

    private fun tag(name: String) =
        ui.waitUntil(20_000) { ui.onAllNodesWithTag(name).fetchSemanticsNodes().isNotEmpty() }

    private fun text(value: String) =
        ui.waitUntil(20_000) { ui.onAllNodesWithText(value).fetchSemanticsNodes().isNotEmpty() }

    private fun click(value: String) =
        ui.onAllNodes(hasText(value) and hasClickAction()).onLast().performClick()

    private fun editors(view: View): List<DocumentEditText> =
        when (view) {
            is DocumentEditText -> listOf(view)
            is ViewGroup -> (0 until view.childCount).flatMap { editors(view.getChildAt(it)) }
            else -> emptyList()
        }

    private fun renderedPhoto(): BitmapDrawable? {
        var result: BitmapDrawable? = null
        instrumentation.runOnMainSync {
            android.view.inspector.WindowInspector.getGlobalWindowViews()
                .flatMap(::editors)
                .forEach { editor ->
                    editor.text
                        .getSpans(0, editor.length(), DocumentObjectSpan::class.java)
                        .forEach { span -> (span.drawable as? BitmapDrawable)?.let { result = it } }
                }
        }
        return result
    }

    private fun capture(name: String): Bitmap {
        instrumentation.waitForIdleSync()
        android.os.SystemClock.sleep(500)
        val image = instrumentation.uiAutomation.takeScreenshot()
        val context = instrumentation.targetContext
        val values =
            android.content.ContentValues().apply {
                put(android.provider.MediaStore.Downloads.DISPLAY_NAME, "$name.png")
                put(android.provider.MediaStore.Downloads.MIME_TYPE, "image/png")
                put(android.provider.MediaStore.Downloads.RELATIVE_PATH, "Download/ConnectQA")
            }
        val uri =
            context.contentResolver.insert(
                android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                values,
            )!!
        context.contentResolver.openOutputStream(uri)!!.use {
            image.compress(Bitmap.CompressFormat.PNG, 100, it)
        }
        return image
    }

    private fun assertPhotoPixels(bitmap: Bitmap) {
        var teal = 0
        for (y in 0 until bitmap.height step 3) for (x in 0 until bitmap.width step 3) {
            val p = bitmap.getPixel(x, y)
            if (Color.red(p) < 45 && Color.green(p) > 145 && Color.blue(p) > 130) teal++
        }
        assertTrue(
            "The real photo must be visible on screen, not just stored in document JSON. Teal samples=$teal",
            teal > 2000,
        )
    }

    @Test
    fun selectedPhotoIsAdjustedUploadedAndVisibleBeforeAndAfterPublishing() {
        check(BuildConfig.API_URL in setOf("http://10.0.2.2:4101", "http://10.0.2.2:4102"))
        val suffix = System.currentTimeMillis().toString()
        val client = CommunityClient(BuildConfig.API_URL, ":memory:", true)
        val context = instrumentation.targetContext
        val source =
            File(context.cacheDir, "attachments/photo-$suffix.png").apply { parentFile!!.mkdirs() }
        val uri = FileProvider.getUriForFile(context, context.packageName + ".attachments", source)
        val resultIntent = Intent().setData(uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        val monitor =
            instrumentation.addMonitor(
                IntentFilter(Intent.ACTION_OPEN_DOCUMENT).apply {
                    addDataType("*/*")
                    addCategory(Intent.CATEGORY_OPENABLE)
                },
                Instrumentation.ActivityResult(Activity.RESULT_OK, resultIntent),
                true,
            )
        try {
            client.postJson(
                "/auth/register",
                JSONObject()
                    .put("name", "Photo Owner")
                    .put("email", "photo$suffix@native.test")
                    .put("password", "NativePhoto123!")
                    .put("companyName", "Photo Solar $suffix")
                    .toString(),
            )
            ui.waitUntil(20_000) {
                ui.onAllNodesWithTag("news-feed").fetchSemanticsNodes().isNotEmpty() ||
                    ui.onAllNodesWithText("Explore the community first")
                        .fetchSemanticsNodes()
                        .isNotEmpty()
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
                text("Sign in")
            }
            ui.onNodeWithTag("navigation-create").performClick()
            text("Work email")
            ui.onNodeWithText("Work email").performTextInput("photo$suffix@native.test")
            ui.onNodeWithText("Password").performTextInput("NativePhoto123!")
            click("Sign in")
            tag("publication-composer")
            source.parentFile!!.mkdirs()
            val fixture = Bitmap.createBitmap(800, 600, Bitmap.Config.ARGB_8888)
            Canvas(fixture).apply {
                drawColor(Color.rgb(10, 190, 170))
                drawRect(300f, 220f, 500f, 380f, Paint().apply { color = Color.rgb(245, 115, 20) })
            }
            source.outputStream().use { fixture.compress(Bitmap.CompressFormat.PNG, 100, it) }
            fixture.recycle()
            ui.onNodeWithTag("publication-body")
                .performClick()
                .performTextInput("Progress from Photo Solar $suffix")
            val uploadsBefore =
                File(context.cacheDir, "uploads").listFiles().orEmpty().map { it.name }.toSet()
            ui.onNodeWithContentDescription("Add photo").performClick()
            tag("photo-adjuster")
            ui.onNodeWithContentDescription("Cancel photo adjustment").performClick()
            ui.waitUntil(20_000) {
                ui.onAllNodesWithTag("photo-adjuster").fetchSemanticsNodes().isEmpty()
            }
            ui.onNodeWithTag("publication-body")
                .assertTextContains("Progress from Photo Solar $suffix", substring = true)
            assertEquals(0, org.json.JSONArray(client.get("/publications")).length())
            assertEquals(
                uploadsBefore,
                File(context.cacheDir, "uploads").listFiles().orEmpty().map { it.name }.toSet(),
            )
            ui.onNodeWithContentDescription("Add photo").performClick()
            tag("photo-adjuster")
            assertEquals(2, monitor.hits)
            click("4:5")
            ui.waitUntil(20_000) {
                ui.onAllNodes(hasText("Use photo") and isEnabled())
                    .fetchSemanticsNodes()
                    .isNotEmpty()
            }
            capture("native-photo-adjustment")
            click("Use photo")
            ui.waitUntil(20_000) { renderedPhoto() != null }
            val drawable = renderedPhoto()!!
            assertEquals(0.8f, drawable.intrinsicWidth.toFloat() / drawable.intrinsicHeight, .01f)
            assertPhotoPixels(capture("native-photo-upload-visible"))
            ui.waitUntil(20_000) {
                ui.onAllNodes(hasText("Publish") and isEnabled()).fetchSemanticsNodes().isNotEmpty()
            }
            val drafts = org.json.JSONArray(client.get("/publications")).objects()
            assertEquals(1, drafts.size)
            val draft = drafts.single()
            assertEquals(1, draft.getJSONArray("media").length())
            assertEquals(
                1,
                PublicationWriting.inlineImageUrls(draft.getJSONObject("document")).size,
            )
            click("Publish")
            click("Update")
            ui.waitUntil(20_000) {
                ui.onAllNodesWithTag("publication-composer").fetchSemanticsNodes().isEmpty()
            }
            text("Progress from Photo Solar $suffix")
            ui.waitUntil(20_000) {
                ui.onAllNodesWithContentDescription("Post image").fetchSemanticsNodes().isNotEmpty()
            }
            assertPhotoPixels(capture("native-photo-published"))
            val feed =
                JSONObject(
                    client.get(
                        "/feed?companyId=" +
                            JSONObject(client.get("/session")).text("activeCompanyId")
                    )
                )
            val post = feed.getJSONArray("posts").getJSONObject(0)
            assertEquals("post", post.text("kind"))
            assertEquals(1, post.getJSONArray("media").length())
            assertEquals(1, PublicationWriting.inlineImageUrls(post.getJSONObject("document")).size)
            ui.onNodeWithContentDescription("Account and company").performClick()
            click("Sign out")
        } finally {
            instrumentation.removeMonitor(monitor)
            source.delete()
            client.destroy()
        }
    }
}
