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
    fun legacyIntroAndPhotosBecomeEditableWithoutDuplicateCover() {
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
            "A new solar roof\nBuilt with the community\nEvery original paragraph stays.\n\n",
            RichDocumentCodec.plain(merged),
        )
        assertEquals(2, PublicationWriting.inlineImageUrls(merged).size)
        assertEquals(
            2,
            merged.getJSONArray("content").objects().count { it.text("type") == "image" },
        )
        val reopened =
            PublicationWriting.document(JSONObject(initial.toString()).put("document", merged))
        assertEquals(merged.toString(), reopened.toString())
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
