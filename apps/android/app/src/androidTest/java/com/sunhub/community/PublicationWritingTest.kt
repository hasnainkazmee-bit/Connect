package com.sunhub.community

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class PublicationWritingTest {
    private fun doc(vararg blocks: JSONObject) =
        JSONObject().put("type", "doc").put("content", JSONArray(blocks.toList()))

    private fun paragraph(text: String) =
        JSONObject()
            .put("type", "paragraph")
            .put("content", JSONArray().put(JSONObject().put("type", "text").put("text", text)))

    @Test
    fun legacyIntroStaysEditableAndAttachmentsAreNotInsertedAutomatically() {
        val image =
            JSONObject(
                """{"type":"image","attrs":{"src":"/api/post-media/cover","alt":"Original alt"}}"""
            )
        val initial =
            JSONObject()
                .put("title", "A new solar roof")
                .put("subtitle", "Built with the community")
                .put("document", doc(paragraph("Every original paragraph stays."), image))
                .put("cover_media_id", "cover")
                .put(
                    "media",
                    JSONArray(
                        """[{"id":"cover","mime":"image/png","url":"/api/post-media/cover","alt":"Original alt"},{"id":"extra","mime":"image/png","url":"/api/post-media/extra","alt":"More progress"}]"""
                    ),
                )
        val merged = PublicationWriting.document(initial)
        assertEquals(
            "A new solar roof\nBuilt with the community\nEvery original paragraph stays.\n",
            RichDocumentCodec.plain(merged),
        )
        assertEquals(1, PublicationWriting.inlineImageUrls(merged).size)
        assertEquals(
            1,
            merged.getJSONArray("content").objects().count { it.text("type") == "image" },
        )
        val reopened =
            PublicationWriting.document(JSONObject(initial.toString()).put("document", merged))
        assertEquals(merged.toString(), reopened.toString())
    }

    @Test
    fun postsSeparateLegacyImagesWithoutLosingRichCaptionOrAttachments() {
        val rich = JSONObject("""{"type":"doc","content":[{"type":"image","attrs":{"src":"/api/post-media/a","alt":"Roof"}},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"A milestone","marks":[{"type":"bold"}]}]},{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"Our work"}]},{"type":"image","attrs":{"src":"/api/post-media/b"}}]}]}""")
        val before = rich.toString()
        val caption = PublicationWriting.caption(rich)
        assertTrue(PublicationWriting.inlineImageUrls(caption).isEmpty())
        assertTrue(caption.toString().contains("bold"))
        assertEquals("A milestone\nOur work", RichDocumentCodec.plain(caption))
        assertEquals(before, PublicationWriting.restoreInline(caption, rich).toString())
        assertEquals(before, rich.toString())
        caption.getJSONArray("content").getJSONObject(0).getJSONArray("content").getJSONObject(0).put("text", "Edited caption")
        val restored = PublicationWriting.restoreInline(caption, rich)
        assertTrue(RichDocumentCodec.plain(restored).contains("Edited caption"))
        assertEquals(2, PublicationWriting.inlineImageUrls(restored).size)
    }

    @Test
    fun legacyPhotoCaptionsRemainWritingAndNeverReturnAsDeletedMetadata() {
        val rich = JSONObject("""{"type":"doc","content":[{"type":"image","attrs":{"src":"/api/post-media/a","title":"Commissioning day","alt":"Roof"}},{"type":"paragraph","content":[{"type":"text","text":"Project details"}]}]}""")
        val caption = PublicationWriting.caption(rich)
        assertEquals("Commissioning day\nProject details", RichDocumentCodec.plain(caption))
        assertEquals(rich.toString(), PublicationWriting.restoreInline(caption, rich).toString())
        caption.getJSONArray("content").getJSONObject(0).getJSONArray("content").getJSONObject(0).put("text", "Edited caption")
        val edited = PublicationWriting.restoreInline(caption, rich)
        assertTrue(RichDocumentCodec.plain(edited).contains("Edited caption"))
        assertFalse(edited.toString().contains("Commissioning day"))
        assertFalse(edited.getJSONArray("content").getJSONObject(0).getJSONObject("attrs").has("title"))
        val deleted = PublicationWriting.restoreInline(doc(paragraph("Project details")), rich)
        assertEquals(setOf("/api/post-media/a"), PublicationWriting.inlineImageUrls(deleted))
        assertFalse(deleted.toString().contains("Commissioning day"))
    }

    @Test
    fun deletingAnAttachmentAndChangingStructureNeverRestoresDeletedPhotos() {
        val rich = JSONObject("""{"type":"doc","content":[{"type":"blockquote","content":[{"type":"image","attrs":{"src":"/api/post-media/deleted"}},{"type":"paragraph","content":[{"type":"text","text":"Earlier caption"}]}]},{"type":"image","attrs":{"src":"/api/post-media/kept"}}]}""")
        val edited = doc(paragraph("A newly structured caption"))
        val cleanedBackup = withoutImage(rich, "/api/post-media/deleted")
        val restored = PublicationWriting.restoreInline(edited, cleanedBackup)
        assertEquals(setOf("/api/post-media/kept"), PublicationWriting.inlineImageUrls(restored))
        assertTrue(RichDocumentCodec.plain(restored).contains("A newly structured caption"))
        val again = PublicationWriting.restoreInline(PublicationWriting.caption(restored), restored)
        assertEquals(restored.toString(), again.toString())
        assertEquals(1, again.getJSONArray("content").objects().count { it.text("type") == "image" })
    }

    @Test
    fun postAttachmentsAreDeduplicatedAndLimitsRejectMixedMedia() {
        val image = JSONObject().put("id", "a").put("url", "/api/post-media/a").put("mime", "image/png")
        val video = JSONObject().put("id", "v").put("url", "/api/post-media/v").put("mime", "video/mp4")
        val post = JSONObject().put("media", JSONArray().put(image).put(image).put(video))
        assertEquals(2, PublicationWriting.attachments(post).size)
        assertTrue(PublicationWriting.acceptsPostMedia(List(4) { image }))
        assertTrue(PublicationWriting.acceptsPostMedia(listOf(video)))
        assertFalse(PublicationWriting.acceptsPostMedia(List(5) { image }))
        assertFalse(PublicationWriting.acceptsPostMedia(listOf(image, video)))
    }

    @Test
    fun firstLineMetadataNeverTruncatesTheWritingOrSplitsEmoji() {
        val line = "a".repeat(179) + "☀️" + " more"
        val original = doc(paragraph("\n\n$line\nFull body remains."))
        val before = original.toString()
        assertTrue(PublicationWriting.headline(original).length <= 180)
        assertEquals(before, original.toString())
        val surrogate = doc(paragraph("a".repeat(179) + "🚀"))
        assertEquals("a".repeat(179), PublicationWriting.headline(surrogate))
    }

    @Test
    fun existingIntroMarksAndRichBlocksRemainIntact() {
        val rich =
            JSONObject(
                """{"type":"doc","content":[{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Project news","marks":[{"type":"bold"}]}]},{"type":"paragraph","content":[{"type":"text","text":"The summary"}]},{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"Keep this quote"}]}]}]}"""
            )
        val initial =
            JSONObject()
                .put("title", "Project news")
                .put("subtitle", "The summary")
                .put("document", rich)
        assertEquals(rich.toString(), PublicationWriting.document(initial).toString())
        assertTrue(PublicationWriting.startsWithHeadline(rich, "Project news"))
        assertFalse(PublicationWriting.startsWithHeadline(rich, "Something different"))
    }

    @Test
    fun savedUnifiedDraftCanReopenWithoutRevivingOldMetadata() {
        val initial =
            JSONObject()
                .put("title", "Original title")
                .put("subtitle", "Original subtitle")
                .put("document", doc(paragraph("Body text")))
        val merged = PublicationWriting.document(initial)
        merged
            .getJSONArray("content")
            .getJSONObject(0)
            .getJSONArray("content")
            .getJSONObject(0)
            .put("text", "Updated first line")
        val saved = JSONObject().put("title", "").put("subtitle", "").put("document", merged)
        assertEquals(merged.toString(), PublicationWriting.document(saved).toString())
        assertEquals("Updated first line", PublicationWriting.headline(merged))
        assertFalse(
            RichDocumentCodec.plain(PublicationWriting.document(saved)).contains("Original title")
        )
    }
}
