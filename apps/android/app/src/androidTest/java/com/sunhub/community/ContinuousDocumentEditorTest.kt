package com.sunhub.community

import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/** Exercises the actual native Editable/Spannable implementation, independently of API fixtures. */
class ContinuousDocumentEditorTest {
    private val sample =
        """{"type":"doc","content":[{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Project news"}]},{"type":"paragraph","content":[{"type":"text","text":"A solar roof","marks":[{"type":"bold"}]},{"type":"hardBreak"},{"type":"text","text":"Read more","marks":[{"type":"link","attrs":{"href":"https://example.com/project","target":"_blank","rel":"noopener noreferrer"}}]}]},{"type":"orderedList","attrs":{"start":4},"content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Designed"}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Installed"}]}]}]},{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"Built together","marks":[{"type":"italic"},{"type":"underline"},{"type":"strike"}]}]}]},{"type":"codeBlock","content":[{"type":"text","text":"42 kW\nCommissioned"}]},{"type":"image","attrs":{"src":"/api/post-media/12345678-1234-1234-1234-123456789abc","alt":"Crew on the roof","title":"Commissioning day"}},{"type":"horizontalRule"}]}"""

    private fun equalJson(expected: JSONObject, actual: JSONObject) {
        // JSONObject key order is not significant; this fixture is generated in stable insertion
        // order.
        assertEquals(expected.toString(), actual.toString())
    }

    @Test
    fun untouchedDocumentRetainsAllNestedBlocksMarksAndImageMetadata() {
        val d = JSONObject(sample)
        equalJson(d, RichDocumentCodec.encode(RichDocumentCodec.decode(d), d))
    }

    @Test
    fun rawNewlineTextNodeInsideCodeBlockRemainsText() {
        val d =
            JSONObject(
                """{"type":"doc","content":[{"type":"codeBlock","content":[{"type":"text","text":"\n"}]}]}"""
            )
        equalJson(d, RichDocumentCodec.encode(RichDocumentCodec.decode(d), d))
    }

    @Test
    fun typingInOneParagraphPreservesLinksListsImagesAndNeighboringMarks() {
        val d = JSONObject(sample)
        val text = RichDocumentCodec.decode(d)
        val start = text.indexOf("solar")
        text.replace(start, start + 5, "commercial solar")
        val updated = RichDocumentCodec.encode(text, d)
        val expected = JSONObject(sample.replace("A solar roof", "A commercial solar roof"))
        equalJson(expected, updated)
    }

    private fun withEditor(
        doc: String = "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[]}]}",
        run: (DocumentEditText, ContinuousEditorState) -> Unit,
    ) {
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            val state = ContinuousEditorState(doc)
            val view =
                DocumentEditText(
                    InstrumentationRegistry.getInstrumentation().targetContext,
                    state,
                    null,
                )
            state.view = view
            try {
                run(view, state)
            } finally {
                view.dispose()
            }
        }
    }

    @Test
    fun enterCreatesParagraphsAndHeadingFormattingUsesTheCursorParagraph() =
        withEditor { view, state ->
            view.insertText("A milestone")
            view.setSelection(3)
            view.format("heading")
            view.setSelection(view.length())
            view.insertText("\nThe details go here.")
            val content = JSONObject(state.document()).getJSONArray("content")
            assertEquals(2, content.length())
            assertEquals("heading", content.getJSONObject(0).getString("type"))
            assertEquals("paragraph", content.getJSONObject(1).getString("type"))
            assertEquals(
                "The details go here.",
                content.getJSONObject(1).getJSONArray("content").getJSONObject(0).getString("text"),
            )
        }

    @Test
    fun selectionFormattingTogglesWithoutChangingOtherWordsAndLinkKeepsItsLabel() =
        withEditor { view, state ->
            view.insertText("Solar project news")
            view.setSelection(6, 13)
            view.format("bold")
            view.format("link:https://example.com/project")
            view.format("bold")
            val pieces =
                JSONObject(state.document())
                    .getJSONArray("content")
                    .getJSONObject(0)
                    .getJSONArray("content")
                    .objects()
            assertEquals(listOf("Solar ", "project", " news"), pieces.map { it.getString("text") })
            assertNull(pieces.first().optJSONArray("marks"))
            assertEquals("link", pieces[1].getJSONArray("marks").getJSONObject(0).getString("type"))
            assertEquals(
                "https://example.com/project",
                pieces[1]
                    .getJSONArray("marks")
                    .getJSONObject(0)
                    .getJSONObject("attrs")
                    .getString("href"),
            )
            assertNull(pieces.last().optJSONArray("marks"))
        }

    @Test
    fun caretFormattingAppliesToNewTypingAndImageInsertionKeepsBothSidesOfTheCursor() =
        withEditor { view, state ->
            view.format("italic")
            view.insertText("Before. After.")
            assertEquals(
                "italic",
                JSONObject(state.document())
                    .getJSONArray("content")
                    .getJSONObject(0)
                    .getJSONArray("content")
                    .getJSONObject(0)
                    .getJSONArray("marks")
                    .getJSONObject(0)
                    .getString("type"),
            )
            view.format("italic")
            view.setSelection(8)
            val image =
                JSONObject(
                    "{\"type\":\"image\",\"attrs\":{\"src\":\"/api/post-media/12345678-1234-1234-1234-123456789abc\",\"alt\":\"Our team\",\"title\":\"New project\"}}"
                )
            view.insertImage(image)
            val content = JSONObject(state.document()).getJSONArray("content")
            assertEquals(3, content.length())
            assertTrue(RichDocumentCodec.plain(content.getJSONObject(0)).startsWith("Before."))
            equalJson(image, content.getJSONObject(1))
            assertEquals("After.", RichDocumentCodec.plain(content.getJSONObject(2)))
            val reopened = RichDocumentCodec.decode(JSONObject(state.document()))
            assertEquals(
                1,
                reopened.getSpans(0, reopened.length, DocumentObjectSpan::class.java).size,
            )
        }

    @Test
    fun caretFormattingCanBeTurnedOffBeforeTypingAgain() = withEditor { view, state ->
        view.format("italic")
        view.insertText("one")
        view.format("italic")
        view.insertText(" two")
        val pieces =
            JSONObject(state.document())
                .getJSONArray("content")
                .getJSONObject(0)
                .getJSONArray("content")
        assertEquals("one", pieces.getJSONObject(0).getString("text"))
        assertEquals(
            "italic",
            pieces.getJSONObject(0).getJSONArray("marks").getJSONObject(0).getString("type"),
        )
        assertEquals(" two", pieces.getJSONObject(1).getString("text"))
        assertNull(pieces.getJSONObject(1).optJSONArray("marks"))
    }

    @Test
    fun inheritedCaretFormattingCanBeTurnedOff() =
        withEditor(
            """{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"one","marks":[{"type":"bold"}]}]}]}"""
        ) { view, state ->
            view.setSelection(view.length())
            view.format("bold")
            view.insertText(" two")
            val pieces =
                JSONObject(state.document())
                    .getJSONArray("content")
                    .getJSONObject(0)
                    .getJSONArray("content")
            assertEquals("one", pieces.getJSONObject(0).getString("text"))
            assertNull(pieces.getJSONObject(1).optJSONArray("marks"))
        }

    @Test
    fun editingLegacyListAndQuotePreservesTheirContainerIdentity() =
        withEditor(sample) { view, state ->
            val position = view.text.indexOf("Installed") + "Installed".length
            view.setSelection(position)
            view.insertText(" and commissioned")
            val actual = JSONObject(state.document())
            equalJson(JSONObject(sample.replace("Installed", "Installed and commissioned")), actual)
            val list = actual.getJSONArray("content").getJSONObject(2)
            assertEquals(4, list.getJSONObject("attrs").getInt("start"))
        }
}
