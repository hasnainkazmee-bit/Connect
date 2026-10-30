package com.sunhub.community

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.*
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import coil3.network.NetworkHeaders
import coil3.network.httpHeaders
import coil3.request.ImageRequest
import org.json.JSONArray
import org.json.JSONObject

private val formats =
    listOf(
        "post" to "Post",
        "article" to "Article",
        "press_release" to "Press release",
        "case_study" to "Case study",
    )

private fun paragraph() = JSONObject().put("type", "paragraph").put("content", JSONArray())

private fun document() =
    JSONObject().put("type", "doc").put("content", JSONArray().put(paragraph()))

private fun withoutImage(node: JSONObject, url: String): JSONObject {
    val copy = JSONObject(node.toString())
    node.optJSONArray("content")?.let { children ->
        copy.put(
            "content",
            JSONArray(
                children
                    .objects()
                    .filterNot {
                        it.text("type") == "image" && it.optJSONObject("attrs")?.text("src") == url
                    }
                    .map { withoutImage(it, url) }
            ),
        )
    }
    return copy
}

private fun plain(node: JSONObject): String =
    if (node.text("type") == "text") node.text("text")
    else if (node.text("type") == "hardBreak") "\n"
    else
        node.optJSONArray("content").objects().joinToString(
            if (
                node.text("type") in
                    listOf("doc", "blockquote", "bulletList", "orderedList", "listItem")
            )
                "\n"
            else ""
        ) {
            plain(it)
        }

private fun replaceNode(root: JSONObject, path: List<Int>, value: JSONObject): JSONObject {
    val copy = JSONObject(root.toString())
    var parent = copy
    path.dropLast(1).forEach { parent = parent.getJSONArray("content").getJSONObject(it) }
    parent.getJSONArray("content").put(path.last(), value)
    return copy
}

private fun styled(node: JSONObject): AnnotatedString = buildAnnotatedString {
    node.optJSONArray("content").objects().forEach { child ->
        if (child.text("type") == "hardBreak") append("\n")
        else {
            val start = length
            append(child.text("text"))
            val end = length
            child.optJSONArray("marks").objects().forEach { mark ->
                when (mark.text("type")) {
                    "bold" -> addStyle(SpanStyle(fontWeight = FontWeight.Bold), start, end)
                    "italic" -> addStyle(SpanStyle(fontStyle = FontStyle.Italic), start, end)
                    "underline" ->
                        addStyle(SpanStyle(textDecoration = TextDecoration.Underline), start, end)
                    "strike" ->
                        addStyle(SpanStyle(textDecoration = TextDecoration.LineThrough), start, end)
                    "code" -> addStyle(SpanStyle(fontFamily = FontFamily.Monospace), start, end)
                    "link" -> {
                        val url = mark.optJSONObject("attrs")?.text("href").orEmpty()
                        addStringAnnotation("link", url, start, end)
                        addStyle(
                            SpanStyle(color = Navy, textDecoration = TextDecoration.Underline),
                            start,
                            end,
                        )
                    }
                }
            }
        }
    }
}

// Keep ranges around the actual edit, so changing one word retains all other formatting.
private fun edited(old: AnnotatedString, text: String): AnnotatedString {
    var left = 0
    while (left < minOf(old.length, text.length) && old[left] == text[left]) left++
    var right = 0
    while (
        right < minOf(old.length - left, text.length - left) &&
            old[old.length - 1 - right] == text[text.length - 1 - right]
    ) right++
    val oldEnd = old.length - right
    val newEnd = text.length - right
    val delta = text.length - old.length
    fun start(v: Int) =
        when {
            v <= left -> v
            v >= oldEnd -> v + delta
            else -> left
        }
    fun end(v: Int) =
        when {
            v < left -> v
            v >= oldEnd -> v + delta
            else -> newEnd
        }
    return buildAnnotatedString {
        append(text)
        old.spanStyles.forEach { r ->
            val a = start(r.start).coerceIn(0, text.length)
            val b = end(r.end).coerceIn(a, text.length)
            if (a < b) addStyle(r.item, a, b)
        }
        old.getStringAnnotations(0, old.length).forEach { r ->
            val a = start(r.start).coerceIn(0, text.length)
            val b = end(r.end).coerceIn(a, text.length)
            if (a < b) addStringAnnotation(r.tag, r.item, a, b)
        }
    }
}

private fun inlineNodes(text: AnnotatedString): JSONArray {
    val result = JSONArray()
    val links = text.getStringAnnotations("link", 0, text.length)
    val bounds =
        (listOf(0, text.length) +
                text.spanStyles.flatMap { listOf(it.start, it.end) } +
                links.flatMap { listOf(it.start, it.end) } +
                text.text.indices.filter { text[it] == '\n' }.flatMap { listOf(it, it + 1) })
            .distinct()
            .sorted()
    bounds.zipWithNext().forEach { (a, b) ->
        if (a < b) {
            val value = text.text.substring(a, b)
            if (value == "\n") result.put(JSONObject().put("type", "hardBreak"))
            else {
                val marks = linkedMapOf<String, JSONObject>()
                fun mark(kind: String) {
                    marks[kind] = JSONObject().put("type", kind)
                }
                text.spanStyles
                    .filter { it.start <= a && it.end >= b }
                    .forEach {
                        val style = it.item
                        if ((style.fontWeight?.weight ?: 0) >= 600) mark("bold")
                        if (style.fontStyle == FontStyle.Italic) mark("italic")
                        if (style.textDecoration?.contains(TextDecoration.Underline) == true)
                            mark("underline")
                        if (style.textDecoration?.contains(TextDecoration.LineThrough) == true)
                            mark("strike")
                        if (style.fontFamily == FontFamily.Monospace) mark("code")
                    }
                links
                    .lastOrNull { it.start <= a && it.end >= b }
                    ?.let {
                        marks["link"] =
                            JSONObject()
                                .put("type", "link")
                                .put("attrs", JSONObject().put("href", it.item))
                    }
                result.put(
                    JSONObject()
                        .put("type", "text")
                        .put("text", value)
                        .put("marks", JSONArray(marks.values.toList()))
                )
            }
        }
    }
    return result
}

@Composable
internal fun PublicationComposer(
    model: CommunityModel,
    initial: JSONObject?,
    close: () -> Unit,
    published: () -> Unit = {},
) {
    var kind by rememberSaveable { mutableStateOf(initial?.text("kind") ?: "post") }
    var title by rememberSaveable { mutableStateOf(initial?.text("title").orEmpty()) }
    var subtitle by rememberSaveable { mutableStateOf(initial?.text("subtitle").orEmpty()) }
    var body by rememberSaveable { mutableStateOf(initial?.text("body").orEmpty()) }
    var doc by rememberSaveable {
        mutableStateOf(
            (initial?.optJSONObject("document")
                    ?: document().also {
                        if (body.isNotBlank())
                            it.getJSONArray("content")
                                .getJSONObject(0)
                                .put(
                                    "content",
                                    JSONArray()
                                        .put(JSONObject().put("type", "text").put("text", body)),
                                )
                    })
                .toString()
        )
    }
    var saved by rememberSaveable { mutableStateOf(initial?.toString()) }
    var mediaJson by rememberSaveable {
        mutableStateOf(initial?.optJSONArray("media")?.toString() ?: "[]")
    }
    var cover by rememberSaveable { mutableStateOf(initial?.text("cover_media_id").orEmpty()) }
    var preview by rememberSaveable { mutableStateOf(false) }
    var dirty by rememberSaveable { mutableStateOf(false) }
    var leaving by remember { mutableStateOf(false) }
    var formatSelection by remember { mutableStateOf<((String) -> Unit)?>(null) }
    var link by remember { mutableStateOf<String?>(null) }
    val media = JSONArray(mediaJson).objects()
    val story =
        JSONObject()
            .put("kind", kind)
            .put("title", title)
            .put("subtitle", subtitle)
            .put("body", body)
            .put("document", if (kind == "post") JSONObject.NULL else JSONObject(doc))
            .put("media", JSONArray(mediaJson))
    suspend fun draft(): JSONObject {
        saved?.let {
            return JSONObject(it)
        }
        val result = model.jsonRequest("POST", "/publications", JSONObject().put("kind", kind))
        saved = result.toString()
        return result
    }
    fun save(publish: Boolean) {
        model.perform({
            val d = draft()
            val request =
                JSONObject(story.toString())
                    .put("status", if (publish) "published" else "draft")
                    .put("version", d.getInt("version"))
                    .put("coverMediaId", cover.ifBlank { null } ?: JSONObject.NULL)
            model.jsonRequest("PATCH", "/publications/${d.text("id")}", request)
        }) {
            saved = it.toString()
            dirty = false
            model.load("/publications", true)
            if (publish) published()
            close()
        }
    }
    val picker =
        rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
            if (uris.isNotEmpty())
                model.pickMedia(uris, true) { files ->
                    model.perform({
                        try {
                            val d = draft()
                            val added = JSONArray(mediaJson)
                            for (file in files) {
                                added.put(
                                    model.uploadOne("/publications/${d.text("id")}/media", file)
                                )
                                mediaJson = added.toString()
                            }
                            d
                        } finally {
                            MediaFiles.discard(files)
                        }
                    }) {
                        dirty = true
                    }
                }
        }
    val leave = { if (dirty) leaving = true else close() }
    val canPublish =
        if (kind == "post") body.trim().isNotEmpty() || media.isNotEmpty()
        else title.trim().length >= 3 && plain(JSONObject(doc)).trim().length >= 20
    WorkSheet(
        model,
        if (preview) "Preview" else if (initial == null) "Create a post" else "Continue your draft",
        leave,
        if (kind == "post") "Post" else "Publish",
        canPublish,
        save = { save(true) },
        secondaryAction = "Save & close",
        secondary = { save(false) },
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Column(Modifier.weight(1f)) {
                Text(
                    model.company?.text("name").orEmpty(),
                    style = MaterialTheme.typography.titleSmall,
                    maxLines = 1,
                    overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                )
                Text(
                    if (dirty) "Unsaved changes" else "Your company’s voice",
                    color = Muted,
                    style = MaterialTheme.typography.labelSmall,
                )
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(!preview, { preview = false }, label = { Text("Write") })
            FilterChip(preview, { preview = true }, label = { Text("Preview") })
        }
        if (preview) {
            PublicationBody(model, story)
        } else {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(formats) { (value, label) ->
                    FilterChip(
                        kind == value,
                        {
                            if (
                                kind == "post" &&
                                    value != "post" &&
                                    plain(JSONObject(doc)) != body &&
                                    body.isNotBlank()
                            )
                                doc =
                                    document()
                                        .also {
                                            it.getJSONArray("content")
                                                .getJSONObject(0)
                                                .put(
                                                    "content",
                                                    JSONArray()
                                                        .put(
                                                            JSONObject()
                                                                .put("type", "text")
                                                                .put("text", body)
                                                        ),
                                                )
                                        }
                                        .toString()
                            if (value == "post" && kind != "post") body = plain(JSONObject(doc))
                            kind = value
                            dirty = true
                        },
                        label = { Text(label) },
                    )
                }
            }
            if (kind == "post")
                OutlinedTextField(
                    body,
                    {
                        body = it.take(4000)
                        dirty = true
                    },
                    placeholder = { Text("What’s happening at your company?") },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 5,
                    shape = RoundedCornerShape(12.dp),
                )
            else {
                WorkField(
                    "Story title",
                    title,
                    {
                        title = it
                        dirty = true
                    },
                    limit = 180,
                )
                WorkField(
                    "Story subtitle",
                    subtitle,
                    {
                        subtitle = it
                        dirty = true
                    },
                    limit = 300,
                    hint = "Optional. Give your reader a reason to read on.",
                )
                LazyRow(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                    items(
                        listOf(
                            "bold" to "Bold",
                            "italic" to "Italic",
                            "underline" to "Underline",
                            "heading" to "Heading",
                            "bulletList" to "List",
                            "blockquote" to "Quote",
                            "link" to "Link",
                        )
                    ) { (command, label) ->
                        OutlinedButton(
                            enabled = formatSelection != null,
                            onClick = {
                                if (command == "link") link = "https://"
                                else formatSelection?.invoke(command)
                            },
                        ) {
                            Text(label, style = MaterialTheme.typography.labelSmall)
                        }
                    }
                }
                Text(
                    "Select text to format it. Add a paragraph as your story grows.",
                    color = Muted,
                    style = MaterialTheme.typography.labelSmall,
                )
                val root = JSONObject(doc)
                root.getJSONArray("content").objects().forEachIndexed { index, node ->
                    key(index) {
                        StoryBlock(
                            model,
                            node,
                            listOf(index),
                            { path, replacement ->
                                doc = replaceNode(JSONObject(doc), path, replacement).toString()
                                dirty = true
                            },
                            { formatSelection = it },
                        )
                    }
                }
                TextButton(
                    onClick = {
                        val d = JSONObject(doc)
                        d.getJSONArray("content").put(paragraph())
                        doc = d.toString()
                        dirty = true
                    }
                ) {
                    Icon(Icons.Outlined.Add, null)
                    Text("Add paragraph")
                }
            }
            OutlinedButton(
                enabled = !model.busy && media.size < 12,
                onClick = {
                    picker.launch(
                        arrayOf(
                            "image/jpeg",
                            "image/png",
                            "image/webp",
                            "video/mp4",
                            "video/webm",
                            "application/pdf",
                        )
                    )
                },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Icon(Icons.Outlined.AttachFile, null)
                Spacer(Modifier.width(8.dp))
                Text("Add photos, video, or a document")
            }
            if (model.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            media.forEach { m ->
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    PostMedia(model, m)
                    if (m.text("mime").startsWith("image/")) {
                        var alt by remember(m.text("id")) { mutableStateOf(m.text("alt")) }
                        WorkField(
                            "Image description",
                            alt,
                            { alt = it },
                            limit = 250,
                            hint = "Help everyone understand this image.",
                        )
                        Row {
                            TextButton(
                                enabled = !model.busy,
                                onClick = {
                                    model.perform({
                                        model.jsonRequest(
                                            "PATCH",
                                            "/publications/${JSONObject(saved!!).text("id")}/media/${m.text("id")}",
                                            JSONObject().put("alt", alt),
                                        )
                                    }) {
                                        mediaJson =
                                            JSONArray(
                                                    media.map {
                                                        if (it.text("id") == m.text("id"))
                                                            JSONObject(it.toString())
                                                                .put("alt", alt)
                                                        else it
                                                    }
                                                )
                                                .toString()
                                    }
                                },
                            ) {
                                Text("Save description")
                            }
                            TextButton(
                                onClick = {
                                    cover = m.text("id")
                                    dirty = true
                                }
                            ) {
                                Text(if (cover == m.text("id")) "Cover image ✓" else "Use as cover")
                            }
                        }
                        if (kind != "post")
                            TextButton(
                                onClick = {
                                    val d = JSONObject(doc)
                                    d.getJSONArray("content")
                                        .put(
                                            JSONObject()
                                                .put("type", "image")
                                                .put(
                                                    "attrs",
                                                    JSONObject()
                                                        .put("src", m.text("url"))
                                                        .put("alt", alt),
                                                )
                                        )
                                    doc = d.toString()
                                    dirty = true
                                }
                            ) {
                                Text("Place in story")
                            }
                    }
                    TextButton(
                        enabled = !model.busy,
                        onClick = {
                            model.perform({
                                val updatedDocument = withoutImage(JSONObject(doc), m.text("url"))
                                val currentDraft = JSONObject(saved!!)
                                val updated =
                                    model.jsonRequest(
                                        "PATCH",
                                        "/publications/${currentDraft.text("id")}",
                                        JSONObject(story.toString())
                                            .put(
                                                "document",
                                                if (kind == "post") JSONObject.NULL
                                                else updatedDocument,
                                            )
                                            .put("status", "draft")
                                            .put("version", currentDraft.getInt("version"))
                                            .put(
                                                "coverMediaId",
                                                if (cover.isBlank() || cover == m.text("id"))
                                                    JSONObject.NULL
                                                else cover,
                                            ),
                                    )
                                saved = updated.toString()
                                doc = updatedDocument.toString()
                                model.jsonRequest(
                                    "DELETE",
                                    "/publications/${JSONObject(saved!!).text("id")}/media/${m.text("id")}",
                                )
                            }) {
                                mediaJson =
                                    JSONArray(media.filter { it.text("id") != m.text("id") })
                                        .toString()
                                if (cover == m.text("id")) cover = ""
                                dirty = true
                            }
                        },
                    ) {
                        Text("Remove attachment")
                    }
                }
            }
        }
    }
    if (leaving)
        AlertDialog(
            onDismissRequest = { leaving = false },
            title = { Text("Save your draft?") },
            text = { Text("Pick it up anytime from Drafts, on your phone or the web.") },
            confirmButton = {
                TextButton(enabled = !model.busy, onClick = { save(false) }) {
                    Text("Save & close")
                }
            },
            dismissButton = { TextButton(onClick = { leaving = false }) { Text("Keep writing") } },
        )
    if (link != null)
        AlertDialog(
            onDismissRequest = { link = null },
            title = { Text("Add a link") },
            text = { WorkField("Web address", link.orEmpty(), { link = it }, limit = 2000) },
            confirmButton = {
                TextButton(
                    enabled = link?.matches(Regex("https?://[^\\s]+")) == true,
                    onClick = {
                        formatSelection?.invoke("link:" + link)
                        link = null
                    },
                ) {
                    Text("Add link")
                }
            },
            dismissButton = { TextButton(onClick = { link = null }) { Text("Cancel") } },
        )
}

@Composable
private fun StoryBlock(
    model: CommunityModel,
    node: JSONObject,
    path: List<Int>,
    change: (List<Int>, JSONObject) -> Unit,
    select: ((String) -> Unit) -> Unit,
) {
    val type = node.text("type")
    when (type) {
        "paragraph",
        "heading",
        "codeBlock" -> {
            var value by remember(path, type) { mutableStateOf(TextFieldValue(styled(node))) }
            fun commit(next: TextFieldValue) {
                value = next
                change(
                    path,
                    JSONObject(node.toString()).put("content", inlineNodes(next.annotatedString)),
                )
            }
            val command: (String) -> Unit = { action ->
                when (action) {
                    "heading" ->
                        change(
                            path,
                            JSONObject(node.toString())
                                .put("type", if (type == "heading") "paragraph" else "heading")
                                .put("attrs", JSONObject().put("level", 2)),
                        )
                    "blockquote",
                    "bulletList" -> {
                        val child = JSONObject(node.toString()).put("type", "paragraph")
                        change(
                            path,
                            JSONObject()
                                .put("type", action)
                                .put(
                                    "content",
                                    JSONArray()
                                        .put(
                                            if (action == "bulletList")
                                                JSONObject()
                                                    .put("type", "listItem")
                                                    .put("content", JSONArray().put(child))
                                            else child
                                        ),
                                ),
                        )
                    }
                    else -> {
                        val a = value.selection.min
                        val b = value.selection.max
                        if (a < b) {
                            val formatted = buildAnnotatedString {
                                append(value.annotatedString)
                                when {
                                    action == "bold" ->
                                        addStyle(SpanStyle(fontWeight = FontWeight.Bold), a, b)
                                    action == "italic" ->
                                        addStyle(SpanStyle(fontStyle = FontStyle.Italic), a, b)
                                    action == "underline" ->
                                        addStyle(
                                            SpanStyle(textDecoration = TextDecoration.Underline),
                                            a,
                                            b,
                                        )
                                    action.startsWith("link:") ->
                                        addStringAnnotation(
                                            "link",
                                            action.removePrefix("link:"),
                                            a,
                                            b,
                                        )
                                }
                            }
                            commit(value.copy(annotatedString = formatted))
                        }
                    }
                }
            }
            OutlinedTextField(
                value,
                { commit(it.copy(annotatedString = edited(value.annotatedString, it.text))) },
                modifier =
                    Modifier.fillMaxWidth().onFocusChanged { if (it.isFocused) select(command) },
                placeholder = { Text(if (type == "heading") "Heading" else "Tell your story…") },
                minLines = if (type == "heading") 1 else 3,
                textStyle =
                    if (type == "heading") MaterialTheme.typography.titleLarge
                    else MaterialTheme.typography.bodyLarge,
                shape = RoundedCornerShape(10.dp),
            )
        }
        "image" -> {
            AsyncImage(
                publicationImage(model, node.optJSONObject("attrs")?.text("src").orEmpty()),
                node.optJSONObject("attrs")?.text("alt"),
                Modifier.fillMaxWidth().height(190.dp),
                contentScale = ContentScale.Fit,
            )
            TextButton(onClick = { change(path, paragraph()) }) { Text("Remove from story") }
        }
        "horizontalRule" -> HorizontalDivider()
        else ->
            Column(
                Modifier.padding(
                    start = if (type in listOf("blockquote", "listItem")) 12.dp else 0.dp
                ),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (type == "blockquote")
                    Text("Quote", color = Muted, style = MaterialTheme.typography.labelSmall)
                node.optJSONArray("content").objects().forEachIndexed { index, child ->
                    StoryBlock(model, child, path + index, change, select)
                }
            }
    }
}

@Composable
internal fun PublicationDrafts(model: CommunityModel, close: () -> Unit) {
    var editing by remember { mutableStateOf<JSONObject?>(null) }
    LaunchedEffect(Unit) { model.load("/publications", true) }
    if (editing != null) {
        PublicationComposer(
            model,
            editing,
            {
                editing = null
                model.load("/publications", true)
            },
        ) {
            close()
            model.load("/feed?scope=all", true)
        }
        return
    }
    WorkSheet(model, "Your company’s drafts", close) {
        Text("A thought worth coming back to.", style = MaterialTheme.typography.headlineSmall)
        val drafts = model.pages["/publications"]?.optJSONArray("items").objects()
        drafts.forEach { d ->
            OutlinedCard(onClick = { editing = d }, modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    Text(
                        formats.find { it.first == d.text("kind") }?.second ?: "Post",
                        color = Muted,
                        style = MaterialTheme.typography.labelSmall,
                    )
                    Text(
                        d.text("title").ifBlank {
                            d.text("body").take(100).ifBlank { "Untitled draft" }
                        },
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Text(
                        "Continue writing →",
                        color = Muted,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        }
        if (drafts.isEmpty()) Text("Drafts you save on any device will appear here.", color = Muted)
    }
}

@Composable
internal fun PublicationHeading(post: JSONObject, modifier: Modifier = Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(
            formats.find { it.first == post.text("kind") }?.second.orEmpty().uppercase(),
            color = Muted,
            style = MaterialTheme.typography.labelSmall,
        )
        Text(post.text("title"), style = MaterialTheme.typography.headlineSmall)
        if (post.text("subtitle").isNotBlank())
            Text(post.text("subtitle"), style = MaterialTheme.typography.bodyLarge, color = Muted)
    }
}

@Composable
internal fun PublicationBody(model: CommunityModel, post: JSONObject) {
    if (post.text("kind") != "post" && post.text("title").isNotBlank()) PublicationHeading(post)
    val doc = post.optJSONObject("document")
    if (doc != null) ReadBlock(model, doc)
    else Text(post.text("body"), style = MaterialTheme.typography.bodyLarge)
    val inline = doc?.toString().orEmpty()
    post
        .optJSONArray("media")
        .objects()
        .filter { !inline.contains(it.text("url")) }
        .forEach { PostMedia(model, it) }
}

@Composable
private fun ReadBlock(model: CommunityModel, node: JSONObject) {
    val type = node.text("type")
    val uri = LocalUriHandler.current
    when (type) {
        "paragraph",
        "heading",
        "codeBlock" -> {
            val text = styled(node)
            Text(
                text,
                style =
                    when (type) {
                        "heading" -> MaterialTheme.typography.titleLarge
                        else -> MaterialTheme.typography.bodyLarge
                    },
                modifier = Modifier.fillMaxWidth(),
            )
            text
                .getStringAnnotations("link", 0, text.length)
                .distinctBy { it.item }
                .forEach { link ->
                    TextButton(
                        onClick = {
                            if (link.item.startsWith("https://") || link.item.startsWith("http://"))
                                uri.openUri(link.item)
                        }
                    ) {
                        Text(text.text.substring(link.start, link.end) + " ↗")
                    }
                }
        }
        "image" ->
            AsyncImage(
                publicationImage(model, node.optJSONObject("attrs")?.text("src").orEmpty()),
                node.optJSONObject("attrs")?.text("alt"),
                Modifier.fillMaxWidth().height(220.dp),
                contentScale = ContentScale.Fit,
            )
        "horizontalRule" -> HorizontalDivider()
        else ->
            Column(
                Modifier.padding(
                    start = if (type in listOf("blockquote", "listItem")) 12.dp else 0.dp
                ),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                node.optJSONArray("content").objects().forEachIndexed { i, child ->
                    if (type in listOf("bulletList", "orderedList"))
                        Row {
                            Text(if (type == "bulletList") "• " else "${i+1}. ")
                            Column(Modifier.weight(1f)) { ReadBlock(model, child) }
                        }
                    else ReadBlock(model, child)
                }
            }
    }
}

@Composable
internal fun PublicationCard(model: CommunityModel, post: JSONObject) {
    Card(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        shape = RoundedCornerShape(15.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White),
    ) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text(
                post.text("author_name"),
                color = Muted,
                style = MaterialTheme.typography.labelMedium,
            )
            PublicationBody(model, post)
        }
    }
}

@Composable
internal fun publicationImage(model: CommunityModel, path: String): ImageRequest {
    val context = LocalContext.current
    return remember(
        path,
        model.session?.optJSONObject("user")?.text("id"),
        model.company?.text("id"),
    ) {
        val builder = ImageRequest.Builder(context).data(mediaUrl(model, path))
        if (path.startsWith("/api/post-media/"))
            builder.httpHeaders(NetworkHeaders.Builder().set("Cookie", model.mediaCookie()).build())
        builder.build()
    }
}
