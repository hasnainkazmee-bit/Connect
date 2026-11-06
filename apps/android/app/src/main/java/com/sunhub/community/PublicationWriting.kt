package com.sunhub.community

import org.json.JSONArray
import org.json.JSONObject

/** The writing document is authoritative; metadata never replaces or truncates its content. */
internal object PublicationWriting {
    private fun textBlock(text: String, heading: Boolean = false) =
        JSONObject()
            .put("type", if (heading) "heading" else "paragraph")
            .apply { if (heading) put("attrs", JSONObject().put("level", 1)) }
            .put("content", JSONArray().put(JSONObject().put("type", "text").put("text", text)))

    fun document(initial: JSONObject?): JSONObject {
        val document =
            initial?.optJSONObject("document")?.let { JSONObject(it.toString()) }
                ?: JSONObject()
                    .put("type", "doc")
                    .put(
                        "content",
                        JSONArray().apply {
                            initial
                                ?.text("body")
                                .orEmpty()
                                .takeIf { it.isNotBlank() }
                                ?.let { put(textBlock(it)) }
                        },
                    )
        val nodes = document.optJSONArray("content").objects().toMutableList()
        val title = initial?.text("title").orEmpty()
        val subtitle = initial?.text("subtitle").orEmpty()
        if (title.isNotBlank() && headline(document) != title) nodes.add(0, textBlock(title, true))
        if (
            subtitle.isNotBlank() &&
                RichDocumentCodec.plain(document)
                    .lineSequence()
                    .map { it.trim() }
                    .take(3)
                    .none { it == subtitle }
        ) {
            val titlePosition =
                nodes.indexOfFirst { RichDocumentCodec.plain(it).trim().isNotBlank() }
            nodes.add(
                if (title.isNotBlank() && titlePosition >= 0) titlePosition + 1 else 0,
                textBlock(subtitle),
            )
        }
        // Attachments stay separate unless the writer explicitly placed them inline.
        if (nodes.isEmpty())
            nodes.add(JSONObject().put("type", "paragraph").put("content", JSONArray()))
        return document.put("content", JSONArray(nodes))
    }

    /** Posts keep all writing, including existing visible photo captions. */
    fun caption(document: JSONObject): JSONObject = JSONObject(document.toString()).apply {
        document.optJSONArray("content")?.let { children ->
            put("content", JSONArray(children.objects().mapNotNull { child ->
                if (child.text("type") == "image")
                    child.optJSONObject("attrs")?.text("title")?.takeIf { it.isNotBlank() }?.let { textBlock(it) }
                else caption(child)
            }))
        }
    }

    /** An unchanged switch is exact. Edited captions remain prose, never resurrected metadata. */
    fun restoreInline(caption: JSONObject, reference: JSONObject): JSONObject {
        if (caption.toString() == PublicationWriting.caption(reference).toString()) return JSONObject(reference.toString())
        return restoreEditedInline(caption, reference)
    }

    private fun restoredImage(original: JSONObject) = JSONObject(original.toString()).apply {
        optJSONObject("attrs")?.remove("title")
    }

    private fun restoreEditedInline(caption: JSONObject, reference: JSONObject): JSONObject {
        val restored = JSONObject(caption.toString())
        val current = restored.optJSONArray("content")?.objects()?.toMutableList() ?: return restored
        val originals = reference.optJSONArray("content").objects()
        var index = 0
        originals.forEach { original ->
            if (original.text("type") == "image") {
                current.add(index.coerceAtMost(current.size), restoredImage(original))
                index++
                // A legacy photo caption is now an editable paragraph. Preserve its edits.
                if (!original.optJSONObject("attrs")?.text("title").isNullOrBlank() &&
                    current.getOrNull(index)?.text("type") == "paragraph") index++
            } else {
                current.getOrNull(index)?.let { child ->
                    if (child.text("type") == original.text("type"))
                        current[index] = restoreEditedInline(child, original)
                    else {
                        // Structural edits can remove an anchor; keep its photos after the writing.
                        imageNodes(original).forEach { current.add(restoredImage(it)) }
                    }
                } ?: imageNodes(original).forEach { current.add(restoredImage(it)) }
                index++
            }
        }
        return restored.put("content", JSONArray(current))
    }

    private fun imageNodes(node: JSONObject): List<JSONObject> =
        if (node.text("type") == "image") listOf(node)
        else node.optJSONArray("content").objects().flatMap(::imageNodes)

    fun attachments(post: JSONObject): List<JSONObject> =
        post.optJSONArray("media").objects().distinctBy { it.text("url").ifBlank { it.text("id") } }

    fun acceptsPostMedia(media: List<JSONObject>) =
        media.size <= 4 && (media.all { it.text("mime").startsWith("image/") } || media.size <= 1)

    private fun firstLine(document: JSONObject): String =
        RichDocumentCodec.plain(document)
            .lineSequence()
            .map { it.trim() }
            .firstOrNull { it.isNotEmpty() }
            .orEmpty()

    fun headline(document: JSONObject): String {
        val line = firstLine(document)
        var end = minOf(line.length, 180)
        if (end < line.length && end > 0 && Character.isHighSurrogate(line[end - 1])) end--
        return line.substring(0, end)
    }

    fun startsWithHeadline(document: JSONObject?, title: String) =
        title.isNotBlank() && document != null && firstLine(document) == title

    fun summary(post: JSONObject): String {
        val body = post.text("body")
        val first = body.lineSequence().firstOrNull { it.isNotBlank() }.orEmpty()
        return if (post.text("kind") != "post" && first.trim() == post.text("title"))
            body.substring(body.indexOf(first) + first.length).trimStart('\r', '\n')
        else body
    }

    fun inlineImageUrls(node: JSONObject): Set<String> = buildSet {
        if (node.text("type") == "image") node.optJSONObject("attrs")?.text("src")?.let { add(it) }
        node.optJSONArray("content").objects().forEach { addAll(inlineImageUrls(it)) }
    }
}
