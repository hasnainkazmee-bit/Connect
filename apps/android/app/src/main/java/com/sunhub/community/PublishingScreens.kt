package com.sunhub.community

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
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
import com.sunhub.core.UploadFile
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

private fun paragraph() = JSONObject().put("type", "paragraph").put("content", JSONArray())

private fun document() =
    JSONObject().put("type", "doc").put("content", JSONArray().put(paragraph()))

internal fun withoutImage(node: JSONObject, url: String): JSONObject {
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
    published: (JSONObject) -> Unit = {},
) {
    var kind by rememberSaveable { mutableStateOf(initial?.text("kind")?.takeIf { it.isNotBlank() } ?: "post") }
    var inlineBackup by rememberSaveable { mutableStateOf(PublicationWriting.document(initial).toString()) }
    var doc by rememberSaveable {
        mutableStateOf(
            PublicationWriting.document(initial).let {
                if (kind == "post") PublicationWriting.caption(it) else it
            }.toString()
        )
    }
    val editor = remember { ContinuousEditorState(doc) }
    editor.synchronize(doc)
    editor.onChange = { doc = it }
    var saved by rememberSaveable { mutableStateOf(initial?.toString()) }
    var mediaJson by rememberSaveable {
        mutableStateOf(initial?.optJSONArray("media")?.toString() ?: "[]")
    }
    var cover by rememberSaveable {
        mutableStateOf(
            initial?.text("cover_media_id").orEmpty().takeUnless { it == "null" }.orEmpty()
        )
    }
    var preview by rememberSaveable { mutableStateOf(false) }
    var dirty by rememberSaveable { mutableStateOf(false) }
    val writingScroll = rememberScrollState()
    LaunchedEffect(preview) { if (preview) writingScroll.scrollTo(0) }
    var leaving by remember { mutableStateOf(false) }
    var optionsOpen by remember { mutableStateOf(false) }
    var moreFormatting by remember { mutableStateOf(false) }
    var attachmentsOpen by remember { mutableStateOf(false) }
    var link by remember { mutableStateOf<String?>(null) }
    val media = JSONArray(mediaJson).objects()
    val body = RichDocumentCodec.plain(JSONObject(doc))
    val headline = PublicationWriting.headline(JSONObject(doc))
    val story =
        JSONObject()
            .put("kind", kind)
            .put("title", "")
            .put("subtitle", "")
            .put("body", body)
            .put("document", if (kind == "post") PublicationWriting.caption(JSONObject(doc)) else JSONObject(doc))
            .put("cover_media_id", cover)
            .put("media", JSONArray(mediaJson))
    fun payload(targetKind: String, publish: Boolean = false) =
        JSONObject(story.toString())
            .put("kind", targetKind)
            .put(
                "title",
                if (targetKind != "post" && (publish || initial?.text("status") == "published"))
                    headline
                else "",
            )
    suspend fun draft(): JSONObject {
        saved?.let {
            return JSONObject(it)
        }
        return model.jsonRequest("POST", "/publications", JSONObject().put("kind", kind)).also {
            saved = it.toString()
        }
    }
    fun save(publish: Boolean, targetKind: String = kind) {
        model.perform({
            val d = draft()
            model.jsonRequest(
                "PATCH",
                "/publications/${d.text("id")}",
                payload(targetKind, publish)
                    .put(
                        "status",
                        if (publish || initial?.text("status") == "published") "published"
                        else "draft",
                    )
                    .put("version", d.getInt("version"))
                    .put("coverMediaId", if (targetKind == "post") JSONObject.NULL else cover.ifBlank { null } ?: JSONObject.NULL),
            )
        }) {
            saved = it.toString()
            dirty = false
            model.load("/publications", true)
            if (publish) published(it)
            close()
        }
    }
    var adjustingJson by rememberSaveable { mutableStateOf("[]") }
    var adjustmentIndex by rememberSaveable { mutableIntStateOf(-1) }
    fun selectedFiles() =
        JSONArray(adjustingJson).objects().map {
            UploadFile(it.text("path"), it.text("name"), it.text("mime"))
        }
    fun storeFiles(files: List<UploadFile>) {
        adjustingJson =
            JSONArray(
                    files.map {
                        JSONObject().put("path", it.path).put("name", it.name).put("mime", it.mime)
                    }
                )
                .toString()
    }
    val pendingFiles by rememberUpdatedState(adjustingJson)
    val context = LocalContext.current
    DisposableEffect(Unit) {
        onDispose {
            if ((context as? android.app.Activity)?.isChangingConfigurations != true) {
                val files =
                    JSONArray(pendingFiles).objects().map {
                        UploadFile(it.text("path"), it.text("name"), it.text("mime"))
                    }
                MediaFiles.discard(files)
            }
        }
    }
    fun uploadFiles(files: List<UploadFile>) {
        model.perform({
            try {
                val existing = JSONArray(mediaJson).objects()
                val combined = existing + files.map { JSONObject().put("mime", it.mime) }
                if (kind == "post" && !PublicationWriting.acceptsPostMedia(combined))
                    error("Posts support up to 4 photos, or one video or PDF. Use a press release for more attachments.")
                if (combined.size > 20) error("Choose up to 20 attachments.")
                val d = draft()
                // Format changes are saved before uploads so server-side media limits
                // match the editor.
                var current =
                    if (d.text("kind") != kind)
                        model.jsonRequest(
                            "PATCH",
                            "/publications/${d.text("id")}",
                            payload(kind)
                                .put(
                                    "status",
                                    if (initial?.text("status") == "published") "published"
                                    else "draft",
                                )
                                .put("version", d.getInt("version"))
                                .put("coverMediaId", cover.ifBlank { null } ?: JSONObject.NULL),
                        )
                    else d
                saved = current.toString()
                for (file in files) {
                    val uploaded = model.uploadOne("/publications/${d.text("id")}/media", file)
                    mediaJson = JSONArray(mediaJson).put(uploaded).toString()
                    if (kind != "post" && uploaded.text("mime").startsWith("image/")) {
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
                    // Persist each successful upload/placement if a later upload fails.
                    if (initial?.text("status") != "published") {
                        current =
                            model.jsonRequest(
                                "PATCH",
                                "/publications/${d.text("id")}",
                                payload(current.text("kind"))
                                    .put("document", JSONObject(doc))
                                    .put("status", "draft")
                                    .put("version", current.getInt("version"))
                                    .put("coverMediaId", cover.ifBlank { null } ?: JSONObject.NULL),
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
    val picker =
        rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
            if (uris.isNotEmpty())
                model.pickMedia(uris, true, publication = true) { files ->
                    val firstPhoto = files.indexOfFirst { it.mime.startsWith("image/") }
                    if (firstPhoto >= 0) {
                        storeFiles(files)
                        adjustmentIndex = firstPhoto
                    } else uploadFiles(files)
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
                    payload(current.text("kind"))
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
            inlineBackup = withoutImage(JSONObject(inlineBackup), m.text("url")).toString()
            model.jsonRequest("DELETE", "/publications/${current.text("id")}/media/${m.text("id")}")
        }) {
            mediaJson = JSONArray(media.filter { it.text("id") != m.text("id") }).toString()
            if (cover == m.text("id")) cover = ""
            dirty = true
        }
    }
    val leave = { if (dirty) leaving = true else close() }
    val mediaValid = PublicationWriting.acceptsPostMedia(media)
    val updateValid = (body.isNotBlank() || media.isNotEmpty()) && body.length <= 4000 && mediaValid
    val releaseValid = headline.length >= 3 && body.trim().length >= 20 && body.length <= 50000
    val canPublish = if (kind == "post") updateValid else releaseValid
    fun changeKind(target: String) {
        if (target == kind || model.busy) return
        editor.hideKeyboard()
        if (target == "post") {
            inlineBackup = doc
            doc = PublicationWriting.caption(JSONObject(doc)).toString()
        } else {
            doc = PublicationWriting.restoreInline(JSONObject(doc), JSONObject(inlineBackup)).toString()
        }
        kind = target
        dirty = true
    }
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
                        Text(
                            if (preview) "Preview" else model.company?.text("name").orEmpty(),
                            Modifier.weight(1f),
                            style = MaterialTheme.typography.titleSmall,
                            maxLines = 1,
                            overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                        )
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
                            onClick = {
                                editor.hideKeyboard()
                                save(true, if (kind == "post") "post" else "press_release")
                            },
                            enabled = canPublish && !model.busy,
                            contentPadding = PaddingValues(horizontal = 18.dp),
                        ) {
                            Text("Publish")
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
                                                editor.hideKeyboard()
                                                picker.launch(
                                                    arrayOf("image/jpeg", "image/png", "image/webp")
                                                )
                                            },
                                        ) {
                                            Icon(Icons.Outlined.AddPhotoAlternate, "Add photo")
                                        }
                                    }
                                    item {
                                        IconButton(
                                            enabled = !model.busy,
                                            onClick = {
                                                editor.hideKeyboard()
                                                picker.launch(arrayOf("video/mp4", "video/webm"))
                                            },
                                        ) {
                                            Icon(Icons.Outlined.Videocam, "Add video")
                                        }
                                    }
                                    if (kind != "post") {
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
                                            onClick = { picker.launch(arrayOf("application/pdf")) },
                                        ) {
                                            Icon(Icons.Outlined.AttachFile, "Add document")
                                        }
                                    }
                                }
                                if (body.length > (if (kind == "post") 3500 else 45000))
                                    Text(
                                        "${body.length}/${if (kind == "post") "4,000" else "50,000"}",
                                        color =
                                            if (body.length > (if (kind == "post") 4000 else 50000)) MaterialTheme.colorScheme.error
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
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        ConnectFilterChip(
                            selected = kind == "post",
                            onClick = { changeKind("post") },
                            label = { Text("Post") },
                            enabled = !model.busy,
                            modifier = Modifier.testTag("publication-format-post"),
                        )
                        ConnectFilterChip(
                            selected = kind != "post",
                            onClick = { changeKind("press_release") },
                            label = { Text("Press release") },
                            enabled = !model.busy,
                            modifier = Modifier.testTag("publication-format-release"),
                        )
                    }
                    if (kind == "post" && !mediaValid)
                        Text("Posts support 4 photos, or one video or PDF. Keep this as a press release or remove attachments.", color = Muted, style = MaterialTheme.typography.bodySmall)
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
                        ContinuousDocumentEditor(
                            model,
                            editor,
                            doc,
                            {
                                doc = it
                                dirty = true
                            },
                            if (kind == "post") "What’s happening at your company?" else "Write your press release…",
                            Modifier.fillMaxWidth().testTag("publication-body"),
                            enabled = !model.busy,
                            minimumLines = if (kind == "post") 2 else 9,
                        )
                        val inlineImages = PublicationWriting.inlineImageUrls(JSONObject(doc))
                        PublicationMediaGallery(model, JSONObject(story.toString()).put("media", JSONArray(media.filter { it.text("url") !in inlineImages })))
                    }
                }
            }
        }
    }
    selectedFiles().getOrNull(adjustmentIndex)?.let { selected ->
        PhotoAdjuster(
            selected,
            PhotoPurpose.Post,
            onCancel = {
                MediaFiles.discard(selectedFiles())
                adjustingJson = "[]"
                adjustmentIndex = -1
            },
            onUse = { adjusted ->
                val files = selectedFiles().toMutableList()
                if (selected.path != adjusted.path) MediaFiles.discard(listOf(selected))
                files[adjustmentIndex] = adjusted
                val next =
                    (adjustmentIndex + 1 until files.size).firstOrNull {
                        files[it].mime.startsWith("image/")
                    }
                if (next == null) {
                    adjustingJson = "[]"
                    adjustmentIndex = -1
                    uploadFiles(files)
                } else {
                    storeFiles(files)
                    adjustmentIndex = next
                }
            },
        )
    }
    if (attachmentsOpen)
        WorkSheet(model, "Attachments", { attachmentsOpen = false }) {
            media.forEach { m ->
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    PostMedia(model, m)
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
                                        inlineBackup = replaceImageDescription(JSONObject(inlineBackup), m.text("url"), alt).toString()
                                        dirty = true
                                    }
                                },
                            ) {
                                Text("Save description")
                            }
                        }
                        if (
                            kind != "post" && !PublicationWriting.inlineImageUrls(JSONObject(doc))
                                .contains(m.text("url"))
                        )
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
internal fun PublicationDrafts(
    model: CommunityModel,
    published: (JSONObject) -> Unit = { model.load("/feed?scope=all", true) },
    close: () -> Unit,
) {
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
            published(it)
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
                            d.optJSONObject("document")
                                ?.let(PublicationWriting::headline)
                                .orEmpty()
                                .ifBlank { d.text("body").take(100).ifBlank { "Untitled draft" } }
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
    if (post.text("kind") == "post") {
        val caption = PublicationWriting.caption(PublicationWriting.document(post))
        if (RichDocumentCodec.plain(caption).isNotBlank()) ReadBlock(model, caption)
        PublicationMediaGallery(model, post)
        return
    }
    val doc = post.optJSONObject("document")
    val embeddedHeadline = PublicationWriting.startsWithHeadline(doc, post.text("title"))
    if (post.text("kind") != "post" && post.text("title").isNotBlank()) {
        if (embeddedHeadline)
            Text(
                publicationLabel(post.text("kind")).uppercase(),
                color = Muted,
                style = MaterialTheme.typography.labelSmall,
            )
        else PublicationHeading(post)
    }
    val inline = doc?.let(PublicationWriting::inlineImageUrls).orEmpty()
    val cover =
        post.optJSONArray("media").objects().firstOrNull {
            it.text("id") == post.text("cover_media_id") && it.text("mime").startsWith("image/")
        }
    if (post.text("kind") != "post" && cover != null && cover.text("url") !in inline)
        InlinePublicationPhoto(model, cover.text("url"), cover.text("alt"))
    if (doc != null) {
        val readable = JSONObject(doc.toString())
        // Give a standalone first line headline styling without removing its marks or later text.
        val first =
            readable.optJSONArray("content").objects().firstOrNull {
                RichDocumentCodec.plain(it).isNotBlank()
            }
        if (
            embeddedHeadline &&
                first?.text("type") == "paragraph" &&
                RichDocumentCodec.plain(first).trim() == post.text("title")
        ) {
            first.put("type", "heading").put("attrs", JSONObject().put("level", 1))
        } else if (embeddedHeadline && first?.text("type") == "paragraph") {
            first.put("_connectHeadline", post.text("title"))
        }
        ReadBlock(model, readable)
    } else Text(post.text("body"), style = MaterialTheme.typography.bodyLarge)
    post
        .optJSONArray("media")
        .objects()
        .filter {
            it.text("url") !in inline &&
                (post.text("kind") == "post" || it.text("id") != cover?.text("id"))
        }
        .forEach {
            if (it.text("mime").startsWith("image/"))
                InlinePublicationPhoto(model, it.text("url"), it.text("alt"))
            else PostMedia(model, it)
        }
}

/** One predictable media stage per feed card. Original files remain available on tap. */
@Composable
internal fun PublicationMediaGallery(
    model: CommunityModel,
    post: JSONObject,
    compactRelease: Boolean = false,
) {
    val media = PublicationWriting.attachments(post)
    val photosOnly = media.all { it.text("mime").startsWith("image/") }
    val release = post.text("kind") == "press_release"
    val shown =
        if (release && compactRelease)
            listOfNotNull(
                media.find { it.text("id") == post.text("cover_media_id") } ?: media.firstOrNull()
            )
        else media
    if (shown.isNotEmpty()) key(shown.map { it.text("id") }) {
        val pager = rememberPagerState(pageCount = { shown.size })
        val scope = rememberCoroutineScope()
        Column {
            HorizontalPager(pager, key = { shown[it].text("id") }) { page ->
                PostMedia(model, shown[page], 1f)
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
                        Icon(Icons.Outlined.ChevronLeft, if (photosOnly) "Previous photo" else "Previous attachment")
                    }
                    Text(
                        "${pager.currentPage + 1} of ${shown.size} ${if (photosOnly) "photos" else "attachments"}",
                        color = Muted,
                        style = MaterialTheme.typography.labelSmall,
                    )
                    IconButton(
                        enabled = pager.currentPage < shown.lastIndex,
                        onClick = {
                            scope.launch { pager.animateScrollToPage(pager.currentPage + 1) }
                        },
                    ) {
                        Icon(Icons.Outlined.ChevronRight, if (photosOnly) "Next photo" else "Next attachment")
                    }
                }
        }
    }
}

@Composable
private fun InlinePublicationPhoto(model: CommunityModel, url: String, alt: String) {
    var ratio by remember(url) { mutableStateOf<Float?>(null) }
    var open by remember(url) { mutableStateOf(false) }
    if (open)
        Dialog(
            onDismissRequest = { open = false },
            properties = DialogProperties(usePlatformDefaultWidth = false),
        ) {
            Box(Modifier.fillMaxSize().background(Ink)) {
                AsyncImage(
                    publicationImage(model, url),
                    alt,
                    Modifier.fillMaxSize(),
                    contentScale = ContentScale.Fit,
                )
                FilledTonalIconButton(
                    onClick = { open = false },
                    modifier = Modifier.align(Alignment.TopEnd).padding(16.dp),
                ) {
                    Icon(Icons.Outlined.Close, "Close photo")
                }
            }
        }
    AsyncImage(
        publicationImage(model, url),
        alt.ifBlank { "Post image" },
        Modifier.fillMaxWidth()
            .then(ratio?.let { Modifier.aspectRatio(it) } ?: Modifier.height(180.dp))
            .clickable { open = true },
        contentScale = ContentScale.Fit,
        onSuccess = { state ->
            val image = state.result.image
            if (image.width > 0 && image.height > 0) ratio = image.width.toFloat() / image.height
        },
    )
}

@Composable
private fun ReadBlock(model: CommunityModel, node: JSONObject) {
    val type = node.text("type")
    val uri = LocalUriHandler.current
    when (type) {
        "paragraph",
        "heading",
        "codeBlock" -> {
            val original = styled(node)
            val headline = node.text("_connectHeadline")
            val headlineStyle = MaterialTheme.typography.headlineSmall
            val text =
                if (headline.isNotBlank())
                    buildAnnotatedString {
                        append(original)
                        val start = original.text.indexOf(headline)
                        if (start >= 0)
                            addStyle(
                                SpanStyle(
                                    fontWeight = FontWeight.Bold,
                                    fontSize = headlineStyle.fontSize,
                                ),
                                start,
                                start + headline.length,
                            )
                    }
                else original
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
        "image" -> Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            InlinePublicationPhoto(
                model,
                node.optJSONObject("attrs")?.text("src").orEmpty(),
                node.optJSONObject("attrs")?.text("alt").orEmpty(),
            )
            node.optJSONObject("attrs")?.text("title")?.takeIf { it.isNotBlank() }?.let {
                Text(it, color = Muted, style = MaterialTheme.typography.bodySmall)
            }
        }
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
            if (post.text("kind") == "post" && post.optJSONObject("document") != null)
                PublicationBody(model, post)
            else {
                if (post.text("kind") != "post") PublicationHeading(post, compact = true)
                if (post.text("body").isNotBlank())
                    Text(
                        PublicationWriting.summary(post),
                        maxLines = 5,
                        overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                PublicationMediaGallery(model, post, compactRelease = true)
            }
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
