package com.sunhub.community

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.*
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil3.compose.AsyncImage
import coil3.network.NetworkHeaders
import coil3.network.httpHeaders
import coil3.request.ImageRequest
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

private val formats = listOf("post" to "Post", "press_release" to "Press release")

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

@OptIn(ExperimentalMaterial3Api::class)
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
    var doc by rememberSaveable {
        mutableStateOf(
            (initial?.optJSONObject("document")
                    ?: document().also { d ->
                        val text = initial?.text("body").orEmpty()
                        if (text.isNotBlank())
                            d.getJSONArray("content")
                                .getJSONObject(0)
                                .put(
                                    "content",
                                    JSONArray()
                                        .put(JSONObject().put("type", "text").put("text", text)),
                                )
                    })
                .toString()
        )
    }
    val editor = remember { ContinuousEditorState(doc) }
    editor.synchronize(doc)
    editor.onChange = { doc = it }
    var saved by rememberSaveable { mutableStateOf(initial?.toString()) }
    var mediaJson by rememberSaveable {
        mutableStateOf(initial?.optJSONArray("media")?.toString() ?: "[]")
    }
    var cover by rememberSaveable { mutableStateOf(initial?.text("cover_media_id").orEmpty()) }
    var preview by rememberSaveable { mutableStateOf(false) }
    var dirty by rememberSaveable { mutableStateOf(false) }
    val writingScroll = rememberScrollState()
    LaunchedEffect(preview) { if (preview) writingScroll.scrollTo(0) }
    var showSubtitle by rememberSaveable { mutableStateOf(subtitle.isNotBlank()) }
    var leaving by remember { mutableStateOf(false) }
    var formatsOpen by remember { mutableStateOf(false) }
    var optionsOpen by remember { mutableStateOf(false) }
    var moreFormatting by remember { mutableStateOf(false) }
    var attachmentsOpen by remember { mutableStateOf(false) }
    var link by remember { mutableStateOf<String?>(null) }
    val media = JSONArray(mediaJson).objects()
    val body = RichDocumentCodec.plain(JSONObject(doc))
    val isPost = kind == "post"
    val story =
        JSONObject()
            .put("kind", kind)
            .put("title", title)
            .put("subtitle", subtitle)
            .put("body", body)
            .put("document", JSONObject(doc))
            .put("cover_media_id", cover)
            .put("media", JSONArray(mediaJson))
    suspend fun draft(): JSONObject {
        saved?.let {
            return JSONObject(it)
        }
        return model.jsonRequest("POST", "/publications", JSONObject().put("kind", kind)).also {
            saved = it.toString()
        }
    }
    fun save(publish: Boolean) {
        model.perform({
            val d = draft()
            model.jsonRequest(
                "PATCH",
                "/publications/${d.text("id")}",
                JSONObject(story.toString())
                    .put(
                        "status",
                        if (publish || initial?.text("status") == "published") "published"
                        else "draft",
                    )
                    .put("version", d.getInt("version"))
                    .put("coverMediaId", cover.ifBlank { null } ?: JSONObject.NULL),
            )
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
                model.pickMedia(uris, true, publication = !isPost) { files ->
                    model.perform({
                        try {
                            val existing = JSONArray(mediaJson).objects()
                            if (existing.size + files.size > if (isPost) 4 else 20)
                                error(
                                    if (isPost) "Choose up to 4 photos, or one video or PDF."
                                    else "A press release can include up to 20 attachments."
                                )
                            if (isPost) {
                                val types = existing.map { it.text("mime") } + files.map { it.mime }
                                if (types.any { !it.startsWith("image/") } && types.size > 1)
                                    error("Choose up to 4 photos, or one video or PDF.")
                            }
                            val d = draft()
                            // Format changes are saved before uploads so server-side media limits
                            // match the editor.
                            var current =
                                if (d.text("kind") != kind)
                                    model.jsonRequest(
                                        "PATCH",
                                        "/publications/${d.text("id")}",
                                        JSONObject(story.toString())
                                            .put(
                                                "status",
                                                if (initial?.text("status") == "published")
                                                    "published"
                                                else "draft",
                                            )
                                            .put("version", d.getInt("version"))
                                            .put(
                                                "coverMediaId",
                                                cover.ifBlank { null } ?: JSONObject.NULL,
                                            ),
                                    )
                                else d
                            saved = current.toString()
                            for (file in files) {
                                val uploaded =
                                    model.uploadOne("/publications/${d.text("id")}/media", file)
                                mediaJson = JSONArray(mediaJson).put(uploaded).toString()
                                if (!isPost && uploaded.text("mime").startsWith("image/")) {
                                    editor.insertImage(
                                        JSONObject()
                                            .put("type", "image")
                                            .put(
                                                "attrs",
                                                JSONObject()
                                                    .put("src", uploaded.text("url"))
                                                    .put("alt", uploaded.text("alt")),
                                            )
                                    )
                                    doc = editor.document()
                                }
                                dirty = true
                                // Persist each successful placement, so a later failed upload
                                // cannot orphan its inline photo.
                                if (initial?.text("status") != "published") {
                                    current =
                                        model.jsonRequest(
                                            "PATCH",
                                            "/publications/${d.text("id")}",
                                            JSONObject(story.toString())
                                                .put("title", title)
                                                .put("subtitle", subtitle)
                                                .put("document", JSONObject(doc))
                                                .put("status", "draft")
                                                .put("version", current.getInt("version"))
                                                .put(
                                                    "coverMediaId",
                                                    cover.ifBlank { null } ?: JSONObject.NULL,
                                                ),
                                        )
                                    saved = current.toString()
                                }
                            }
                            current
                        } finally {
                            MediaFiles.discard(files)
                        }
                    }) {
                        dirty = true
                    }
                }
        }
    fun removeAttachment(m: JSONObject) {
        model.perform({
            val updatedDoc = withoutImage(JSONObject(doc), m.text("url"))
            val current = JSONObject(saved!!)
            val updated =
                model.jsonRequest(
                    "PATCH",
                    "/publications/${current.text("id")}",
                    JSONObject(story.toString())
                        .put("document", updatedDoc)
                        .put(
                            "status",
                            if (initial?.text("status") == "published") "published" else "draft",
                        )
                        .put("version", current.getInt("version"))
                        .put(
                            "coverMediaId",
                            if (cover.isBlank() || cover == m.text("id")) JSONObject.NULL else cover,
                        ),
                )
            saved = updated.toString()
            doc = updatedDoc.toString()
            model.jsonRequest("DELETE", "/publications/${current.text("id")}/media/${m.text("id")}")
        }) {
            mediaJson = JSONArray(media.filter { it.text("id") != m.text("id") }).toString()
            if (cover == m.text("id")) cover = ""
            dirty = true
        }
    }
    val leave = { if (dirty) leaving = true else close() }
    val mediaValid =
        media.size <= 4 && (media.all { it.text("mime").startsWith("image/") } || media.size <= 1)
    val canPublish =
        if (isPost) (body.isNotBlank() || media.isNotEmpty()) && body.length <= 4000 && mediaValid
        else title.trim().length >= 3 && body.trim().length >= 20 && body.length <= 50000
    Dialog(
        onDismissRequest = { if (!model.busy) leave() },
        properties =
            DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        BackHandler { if (!model.busy) leave() }
        Box(
            Modifier.fillMaxSize().systemBarsPadding().imePadding(),
            contentAlignment = Alignment.TopCenter,
        ) {
            Scaffold(
                modifier =
                    Modifier.widthIn(max = FeedWidthDp.dp)
                        .fillMaxSize()
                        .clip(ConnectCardShape)
                        .testTag("publication-composer"),
                containerColor = Color.White,
                topBar = {
                    Row(
                        Modifier.fillMaxWidth()
                            .background(Pale)
                            .padding(horizontal = 6.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        IconButton(onClick = leave, enabled = !model.busy) {
                            Icon(Icons.Outlined.Close, "Close")
                        }
                        Box(Modifier.weight(1f)) {
                            TextButton(
                                onClick = { formatsOpen = true },
                                enabled = !model.busy && !preview,
                            ) {
                                Text(
                                    if (isPost) "Post" else "Press release",
                                    maxLines = 1,
                                    style = MaterialTheme.typography.titleSmall,
                                )
                                Icon(Icons.Outlined.ExpandMore, null, Modifier.size(18.dp))
                            }
                            DropdownMenu(
                                expanded = formatsOpen,
                                onDismissRequest = { formatsOpen = false },
                            ) {
                                formats.forEach { (value, label) ->
                                    DropdownMenuItem(
                                        text = { Text(label) },
                                        leadingIcon = {
                                            Icon(
                                                if (value == "post")
                                                    Icons.Outlined.ChatBubbleOutline
                                                else Icons.Outlined.Campaign,
                                                null,
                                            )
                                        },
                                        onClick = {
                                            kind = value
                                            dirty = true
                                            formatsOpen = false
                                        },
                                    )
                                }
                            }
                        }
                        Box {
                            IconButton(onClick = { optionsOpen = true }, enabled = !model.busy) {
                                Icon(Icons.Outlined.MoreHoriz, "Writing options")
                            }
                            DropdownMenu(
                                expanded = optionsOpen,
                                onDismissRequest = { optionsOpen = false },
                            ) {
                                DropdownMenuItem(
                                    text = { Text(if (preview) "Continue writing" else "Preview") },
                                    leadingIcon = { Icon(Icons.Outlined.Visibility, null) },
                                    onClick = {
                                        if (!preview) editor.hideKeyboard()
                                        preview = !preview
                                        optionsOpen = false
                                    },
                                )
                                DropdownMenuItem(
                                    text = { Text("Save & close") },
                                    leadingIcon = { Icon(Icons.Outlined.Save, null) },
                                    onClick = {
                                        optionsOpen = false
                                        save(false)
                                    },
                                )
                                if (!isPost && !showSubtitle)
                                    DropdownMenuItem(
                                        text = { Text("Add a subtitle") },
                                        onClick = {
                                            showSubtitle = true
                                            optionsOpen = false
                                        },
                                    )
                                if (media.isNotEmpty())
                                    DropdownMenuItem(
                                        text = { Text("Manage attachments (${media.size})") },
                                        onClick = {
                                            attachmentsOpen = true
                                            optionsOpen = false
                                        },
                                    )
                            }
                        }
                        ConnectButton(
                            onClick = { save(true) },
                            enabled = canPublish && !model.busy,
                            contentPadding = PaddingValues(horizontal = 18.dp),
                        ) {
                            Text(if (isPost) "Post" else "Publish")
                        }
                    }
                },
                bottomBar = {
                    if (!preview)
                        Surface(color = Color.White, shadowElevation = 3.dp) {
                            Row(
                                Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                LazyRow(
                                    Modifier.weight(1f),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    item {
                                        IconButton(
                                            enabled = !model.busy,
                                            onClick = {
                                                picker.launch(
                                                    arrayOf("image/jpeg", "image/png", "image/webp")
                                                )
                                            },
                                        ) {
                                            Icon(Icons.Outlined.AddPhotoAlternate, "Add photo")
                                        }
                                    }
                                    if (isPost)
                                        item {
                                            IconButton(
                                                enabled = !model.busy,
                                                onClick = {
                                                    picker.launch(
                                                        arrayOf("video/mp4", "video/webm")
                                                    )
                                                },
                                            ) {
                                                Icon(Icons.Outlined.Videocam, "Add video")
                                            }
                                        }
                                    if (!isPost) {
                                        item {
                                            IconButton(
                                                onClick = { link = "https://" },
                                                enabled = !model.busy,
                                            ) {
                                                Icon(Icons.Outlined.Link, "Add link")
                                            }
                                        }
                                        item {
                                            IconButton(
                                                onClick = {
                                                    editor.command("heading")
                                                    dirty = true
                                                },
                                                enabled = !model.busy,
                                            ) {
                                                Icon(Icons.Outlined.Title, "Heading")
                                            }
                                        }
                                        item {
                                            IconButton(
                                                onClick = {
                                                    editor.command("subheading")
                                                    dirty = true
                                                },
                                                enabled = !model.busy,
                                            ) {
                                                Icon(Icons.Outlined.FormatSize, "Subheading")
                                            }
                                        }
                                        item {
                                            Box {
                                                IconButton(
                                                    onClick = { moreFormatting = true },
                                                    enabled = !model.busy,
                                                ) {
                                                    Icon(
                                                        Icons.Outlined.TextFormat,
                                                        "Text formatting",
                                                    )
                                                }
                                                DropdownMenu(
                                                    expanded = moreFormatting,
                                                    onDismissRequest = { moreFormatting = false },
                                                ) {
                                                    listOf(
                                                            "bold" to "Bold",
                                                            "italic" to "Italic",
                                                            "underline" to "Underline",
                                                            "paragraph" to "Normal text",
                                                        )
                                                        .forEach { (command, label) ->
                                                            DropdownMenuItem(
                                                                text = { Text(label) },
                                                                onClick = {
                                                                    editor.command(command)
                                                                    dirty = true
                                                                    moreFormatting = false
                                                                },
                                                            )
                                                        }
                                                }
                                            }
                                        }
                                    }
                                    item {
                                        IconButton(
                                            enabled = !model.busy,
                                            onClick = {
                                                picker.launch(
                                                    if (isPost) arrayOf("application/pdf")
                                                    else
                                                        arrayOf(
                                                            "video/mp4",
                                                            "video/webm",
                                                            "application/pdf",
                                                        )
                                                )
                                            },
                                        ) {
                                            Icon(
                                                Icons.Outlined.AttachFile,
                                                if (isPost) "Add document"
                                                else "Add video or document",
                                            )
                                        }
                                    }
                                }
                                Text(
                                    if (isPost) "${body.length}/4,000"
                                    else
                                        "${body.trim().split(Regex("\\s+")).count { it.isNotEmpty() }} words",
                                    color =
                                        if (body.length > if (isPost) 4000 else 50000)
                                            MaterialTheme.colorScheme.error
                                        else Muted,
                                    style = MaterialTheme.typography.labelSmall,
                                    modifier = Modifier.padding(end = 8.dp),
                                )
                            }
                        }
                },
            ) { padding ->
                Column(
                    Modifier.fillMaxSize()
                        .padding(padding)
                        .verticalScroll(writingScroll)
                        .padding(horizontal = 24.dp, vertical = 18.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Icon(Icons.Outlined.Business, null, Modifier.size(20.dp), tint = Muted)
                        Column {
                            Text(
                                model.company?.text("name").orEmpty(),
                                style = MaterialTheme.typography.labelLarge,
                                color = Ink,
                            )
                            Text(
                                if (preview) "Preview"
                                else if (initial != null) "Continue your draft"
                                else "Public · Your company’s voice",
                                style = MaterialTheme.typography.labelSmall,
                                color = Muted,
                            )
                        }
                    }
                    model.error?.let {
                        Text(
                            it,
                            color = MaterialTheme.colorScheme.error,
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    if (model.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
                    if (preview) PublicationBody(model, story)
                    else {
                        if (!isPost) {
                            WritingTitleField(
                                title,
                                "Headline",
                                MaterialTheme.typography.headlineLarge.copy(
                                    fontWeight = FontWeight.Bold,
                                    color = Ink,
                                ),
                            ) {
                                title = it.take(180)
                                dirty = true
                            }
                            if (showSubtitle)
                                WritingTitleField(
                                    subtitle,
                                    "Add a subtitle",
                                    MaterialTheme.typography.titleMedium.copy(color = Muted),
                                ) {
                                    subtitle = it.take(300)
                                    dirty = true
                                }
                            media
                                .firstOrNull { it.text("id") == cover }
                                ?.let { PostMedia(model, it, 16f / 9f) }
                        }
                        ContinuousDocumentEditor(
                            model,
                            editor,
                            doc,
                            {
                                doc = it
                                dirty = true
                            },
                            if (isPost) "What’s happening at your company?" else "Tell your story…",
                            Modifier.fillMaxWidth().testTag("publication-body"),
                        )
                        val attachments =
                            if (isPost) media
                            else
                                media.filter {
                                    !it.text("mime").startsWith("image/") ||
                                        (it.text("id") != cover && !doc.contains(it.text("url")))
                                }
                        if (attachments.isNotEmpty()) {
                            PublicationMediaGallery(
                                model,
                                JSONObject()
                                    .put("kind", "post")
                                    .put("media", JSONArray(attachments)),
                            )
                            TextButton(onClick = { attachmentsOpen = true }) {
                                Text("Manage attachments (${media.size})")
                            }
                        }
                        if (isPost && (!mediaValid || body.length > 4000))
                            Text(
                                "This update needs more room. Switch to a press release to keep everything.",
                                color = MaterialTheme.colorScheme.error,
                                style = MaterialTheme.typography.bodySmall,
                            )
                    }
                }
            }
        }
    }
    if (attachmentsOpen)
        WorkSheet(model, "Attachments", { attachmentsOpen = false }) {
            media.forEach { m ->
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    PostMedia(model, m, if (isPost) 1f else 16f / 9f)
                    if (m.text("mime").startsWith("image/")) {
                        var alt by remember(m.text("id")) { mutableStateOf(m.text("alt")) }
                        WorkField("Image description", alt, { alt = it }, limit = 250)
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
                                        doc =
                                            replaceImageDescription(
                                                    JSONObject(doc),
                                                    m.text("url"),
                                                    alt,
                                                )
                                                .toString()
                                        dirty = true
                                    }
                                },
                            ) {
                                Text("Save description")
                            }
                            if (!isPost)
                                TextButton(
                                    onClick = {
                                        cover = if (cover == m.text("id")) "" else m.text("id")
                                        if (cover.isNotBlank())
                                            doc =
                                                withoutImage(JSONObject(doc), m.text("url"))
                                                    .toString()
                                        dirty = true
                                    }
                                ) {
                                    Text(
                                        if (cover == m.text("id")) "Remove cover"
                                        else "Use as cover"
                                    )
                                }
                        }
                        if (!isPost && !doc.contains(m.text("url")))
                            TextButton(
                                onClick = {
                                    editor.insertImage(
                                        JSONObject()
                                            .put("type", "image")
                                            .put(
                                                "attrs",
                                                JSONObject()
                                                    .put("src", m.text("url"))
                                                    .put("alt", alt),
                                            )
                                    )
                                    doc = editor.document()
                                    dirty = true
                                    attachmentsOpen = false
                                }
                            ) {
                                Text("Insert at cursor")
                            }
                    }
                    TextButton(enabled = !model.busy, onClick = { removeAttachment(m) }) {
                        Text("Remove attachment", color = MaterialTheme.colorScheme.error)
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
            dismissButton = {
                Row {
                    TextButton(onClick = close) { Text("Discard changes") }
                    TextButton(onClick = { leaving = false }) { Text("Keep writing") }
                }
            },
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
                        editor.command("link:" + link)
                        dirty = true
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
private fun WritingTitleField(
    value: String,
    hint: String,
    style: TextStyle,
    change: (String) -> Unit,
) {
    BasicTextField(
        value,
        change,
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
        textStyle = style,
        cursorBrush = androidx.compose.ui.graphics.SolidColor(Ink),
        decorationBox = { inner ->
            Box(Modifier.padding(vertical = 8.dp)) {
                if (value.isEmpty()) Text(hint, style = style, color = Color(0xff8794a3))
                inner()
            }
        },
    )
}

private fun replaceImageDescription(node: JSONObject, url: String, alt: String): JSONObject =
    JSONObject(node.toString()).also { copy ->
        if (copy.text("type") == "image" && copy.optJSONObject("attrs")?.text("src") == url)
            copy.getJSONObject("attrs").put("alt", alt)
        copy.optJSONArray("content")?.let {
            copy.put(
                "content",
                JSONArray(it.objects().map { child -> replaceImageDescription(child, url, alt) }),
            )
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
                        publicationLabel(d.text("kind")),
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
internal fun PublicationHeading(
    post: JSONObject,
    modifier: Modifier = Modifier,
    compact: Boolean = false,
) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(
            publicationLabel(post.text("kind")).uppercase(),
            color = Muted,
            style = MaterialTheme.typography.labelSmall,
        )
        Text(
            post.text("title"),
            style = MaterialTheme.typography.headlineSmall,
            maxLines = if (compact) 3 else Int.MAX_VALUE,
            overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
        )
        if (post.text("subtitle").isNotBlank())
            Text(
                post.text("subtitle"),
                style = MaterialTheme.typography.bodyLarge,
                color = Muted,
                maxLines = if (compact) 2 else Int.MAX_VALUE,
                overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
            )
    }
}

@Composable
internal fun PublicationBody(model: CommunityModel, post: JSONObject) {
    if (post.text("kind") != "post" && post.text("title").isNotBlank()) PublicationHeading(post)
    val cover =
        post.optJSONArray("media").objects().firstOrNull {
            it.text("id") == post.text("cover_media_id") && it.text("mime").startsWith("image/")
        }
    if (post.text("kind") != "post" && cover != null) PostMedia(model, cover, 16f / 9f)
    val doc = post.optJSONObject("document")
    if (doc != null) ReadBlock(model, doc)
    else Text(post.text("body"), style = MaterialTheme.typography.bodyLarge)
    val inline = doc?.toString().orEmpty()
    post
        .optJSONArray("media")
        .objects()
        .filter {
            !inline.contains(it.text("url")) &&
                (post.text("kind") == "post" || it.text("id") != cover?.text("id"))
        }
        .forEach { PostMedia(model, it) }
}

/** One predictable media stage per feed card. Original files remain available on tap. */
@Composable
internal fun PublicationMediaGallery(
    model: CommunityModel,
    post: JSONObject,
    compactRelease: Boolean = false,
) {
    val media = post.optJSONArray("media").objects()
    val images = media.filter { it.text("mime").startsWith("image/") }
    val release = post.text("kind") == "press_release"
    val shown =
        if (release && compactRelease)
            listOfNotNull(
                images.find { it.text("id") == post.text("cover_media_id") } ?: images.firstOrNull()
            )
        else images
    if (shown.isNotEmpty()) {
        val pager = rememberPagerState(pageCount = { shown.size })
        val scope = rememberCoroutineScope()
        Column {
            HorizontalPager(pager, key = { shown[it].text("id") }) { page ->
                PostMedia(model, shown[page], if (release) 16f / 9f else 1f)
            }
            if (shown.size > 1)
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    IconButton(
                        enabled = pager.currentPage > 0,
                        onClick = {
                            scope.launch { pager.animateScrollToPage(pager.currentPage - 1) }
                        },
                    ) {
                        Icon(Icons.Outlined.ChevronLeft, "Previous photo")
                    }
                    Text(
                        "${pager.currentPage + 1} of ${shown.size} photos",
                        color = Muted,
                        style = MaterialTheme.typography.labelSmall,
                    )
                    IconButton(
                        enabled = pager.currentPage < shown.lastIndex,
                        onClick = {
                            scope.launch { pager.animateScrollToPage(pager.currentPage + 1) }
                        },
                    ) {
                        Icon(Icons.Outlined.ChevronRight, "Next photo")
                    }
                }
        }
    }
    if (!release || !compactRelease)
        media.filter { !it.text("mime").startsWith("image/") }.forEach { PostMedia(model, it) }
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
    var reading by rememberSaveable(post.text("id")) { mutableStateOf(false) }
    if (reading)
        WorkSheet(model, publicationLabel(post.text("kind")), { reading = false }) {
            PublicationBody(model, post)
        }
    Card(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        shape = ConnectCardShape,
        colors = CardDefaults.cardColors(containerColor = Color.White),
    ) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text(
                post.text("author_name"),
                color = Muted,
                style = MaterialTheme.typography.labelMedium,
            )
            if (post.text("kind") != "post") PublicationHeading(post, compact = true)
            if (post.text("body").isNotBlank())
                Text(
                    post.text("body"),
                    maxLines = 5,
                    overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.bodyMedium,
                )
            PublicationMediaGallery(model, post, compactRelease = true)
            TextButton(onClick = { reading = true }) {
                Text(
                    if (post.text("kind") == "press_release") "Read press release"
                    else "Open update"
                )
            }
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
