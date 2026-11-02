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
        // Legacy covers and gallery photos become part of the same visible writing canvas.
        val inline = inlineImageUrls(document)
        val images =
            initial?.optJSONArray("media").objects().filter {
                it.text("mime").startsWith("image/") && it.text("url") !in inline
            }
        images.forEach { media ->
            val image =
                JSONObject()
                    .put("type", "image")
                    .put(
                        "attrs",
                        JSONObject().put("src", media.text("url")).put("alt", media.text("alt")),
                    )
            if (media.text("id") == initial?.text("cover_media_id")) {
                val intro = if (title.isNotBlank()) 1 else 0
                nodes.add(
                    (intro + if (subtitle.isNotBlank()) 1 else 0).coerceAtMost(nodes.size),
                    image,
                )
            } else nodes.add(image)
        }
        if (nodes.isEmpty())
            nodes.add(JSONObject().put("type", "paragraph").put("content", JSONArray()))
        return document.put("content", JSONArray(nodes))
    }

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
